/**
 * Deterministic pre-filter for AI mail-plan prompts.
 *
 * Many natural-language prompts describe a clear search ("Finde alle Mails
 * von Vodafone der letzten 30 Tage"). Sending the WHOLE candidate list to the
 * AI in that case wastes tokens, hides obvious matches under generic
 * heuristics, and makes the mock provider produce noise. So we extract
 * obvious search terms and a time window from the prompt and use them to
 * narrow the candidate set BEFORE the AI runs.
 *
 * This is intentionally cheap and rule-based:
 *   - tokenize on whitespace + punctuation
 *   - lowercase
 *   - drop short tokens (< 4 chars) and German stopwords
 *   - detect "letzte/n N tag/e/n" → optional daysBack override
 *
 * The AI still gets the filtered candidates and can refine further.
 */

const GERMAN_STOPWORDS = new Set([
  "alle",
  "alles",
  "anzahl",
  "auch",
  "aus",
  "bei",
  "beim",
  "bis",
  "bitte",
  "dann",
  "dass",
  "deine",
  "deinen",
  "den",
  "der",
  "des",
  "die",
  "das",
  "diese",
  "diesen",
  "dieses",
  "doch",
  "ein",
  "eine",
  "einen",
  "einer",
  "eines",
  "einem",
  "email",
  "emails",
  "etwa",
  "fertig",
  "finde",
  "fuer",
  "für",
  "gerade",
  "gibt",
  "gib",
  "haben",
  "hier",
  "ich",
  "ihm",
  "ihn",
  "ihr",
  "ihre",
  "ihrer",
  "im",
  "in",
  "ist",
  "ja",
  "jede",
  "jeden",
  "jeder",
  "jedes",
  "jetzt",
  "kann",
  "kein",
  "keine",
  "letzte",
  "letzten",
  "letzter",
  "letztes",
  "liste",
  "mache",
  "mail",
  "mails",
  "mehr",
  "mein",
  "meine",
  "meinen",
  "meinem",
  "mit",
  "monat",
  "monate",
  "monaten",
  "muss",
  "nach",
  "nicht",
  "noch",
  "nur",
  "ohne",
  "oder",
  "schon",
  "soll",
  "sollte",
  "stattdessen",
  "suche",
  "tag",
  "tage",
  "tagen",
  "und",
  "viele",
  "vielen",
  "vom",
  "von",
  "vor",
  "war",
  "warum",
  "was",
  "weil",
  "weiter",
  "welcher",
  "wenn",
  "wer",
  "werden",
  "werde",
  "wieviel",
  "wieviele",
  "zähl",
  "zähle",
  "zaehl",
  "zaehle",
  "wie",
  "wird",
  "wo",
  "woche",
  "wochen",
  "ja",
  "zeig",
  "zeige",
  "zu",
  "zum",
  "zur",
]);

const ENGLISH_STOPWORDS = new Set([
  "all",
  "and",
  "any",
  "count",
  "day",
  "days",
  "email",
  "emails",
  "find",
  "from",
  "give",
  "how",
  "last",
  "list",
  "mail",
  "mails",
  "many",
  "mark",
  "month",
  "months",
  "search",
  "show",
  "the",
  "with",
  "week",
  "weeks",
  "year",
  "years",
]);

/** Short brand tokens (< 4 chars) that should still pass the length filter. */
const SHORT_BRAND_ALLOWLIST = new Set([
  "dhl",
  "ups",
  "dpd",
  "gls",
  "rwe",
  "vw",
  "bmw",
  "ebay",
]);

export type PromptFilter = {
  /** Extracted free-text terms (lowercased) used to match subject/from/snippet/body. */
  terms: string[];
  /** Time window inferred from "letzte 30 Tage", "last 7 days" etc. — null if none. */
  daysBack: number | null;
};

export function extractPromptFilter(prompt: string): PromptFilter {
  const lower = prompt.toLowerCase();

  // German: "letzte 30 tage", "der letzten 7 tage"
  // English: "last 14 days"
  let daysBack: number | null = null;
  const re = /(?:letzten?\s+|last\s+)(\d{1,3})\s*(tage|tagen|days?)/i;
  const match = lower.match(re);
  if (match) {
    const n = parseInt(match[1], 10);
    if (Number.isFinite(n) && n > 0 && n <= 365) daysBack = n;
  }

  const tokens = lower
    .split(/[^\p{L}\p{N}@.\-_]+/u)
    .filter(Boolean)
    // Keep tokens that are >= 4 chars OR known short brands (dhl, ups, …).
    .filter((t) => t.length >= 4 || SHORT_BRAND_ALLOWLIST.has(t))
    .filter((t) => !GERMAN_STOPWORDS.has(t) && !ENGLISH_STOPWORDS.has(t))
    // Drop pure numbers (e.g. "30" from "30 tage")
    .filter((t) => !/^\d+$/.test(t));

  // De-duplicate while preserving order
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const t of tokens) {
    if (!seen.has(t)) {
      seen.add(t);
      terms.push(t);
    }
  }

  return { terms, daysBack };
}

// ---------- Intent detection ----------

export type AiAssistantIntent =
  | "count"
  | "search"
  | "categorize"
  | "organize"
  | "move"
  | "trash"
  | "extract_contacts"
  | "unknown";

const COUNT_PATTERNS = [
  /\bz(ä|ae)hl(e|en)?\b/,
  /\banzahl\b/,
  /\bwie\s*viele?\b/,
  /\bwieviele?\b/,
  /\bcount\b/,
  /\bhow\s+many\b/,
];

const SEARCH_PATTERNS = [
  /\bfind(e|en|et)?\b/,
  /\bsuch(e|en|t)?\b/,
  /\bzeig(e|t|en|en\s+mir)?\b/,
  /\blist(e|en)?\b/,
  /\bwelche\b.*\b(emails|mails)\b/,
  /\bin\s+welch(en|em)\b/,
  /\bsearch\b/,
  /\bshow\s+(me|all)\b/,
];

const TRASH_PATTERNS = [
  /\bpapierkorb\b/,
  /\btrash\b/,
  /\bin\s+den\s+m(ü|ue)ll\b/,
];

const SPAM_OR_MOVE_PATTERNS = [
  /\bverschiebe\b/,
  /\bsortier(e|en)\b/,
  /\borganisier(e|en)\b/,
  /\bin\s+den\s+ordner\b/,
  /\bin\s+spam\b/,
  /\bmark(iere|ier)?\s+als\b/,
  /\bblockier(e|en|t)\b/,
  /\bmove\s+to\b/,
];

const CATEGORIZE_PATTERNS = [
  /\bkategorisier(e|en)\b/,
  /\blabel\b/,
  /\btag(ge)?\b/,
];

const EXTRACT_CONTACTS_PATTERNS = [
  /\bkontakt(e|kandidaten)?\s+(extrahier|erkennen|sammeln)/,
  /\bextrahier(e|en)\s+kontakte?\b/,
  /\bkontakte\s+aus\b/,
  /\bextract\s+contacts?\b/,
];

/**
 * Classify the user prompt into one of the supported intents.
 *
 * Order matters — a prompt like "zähle alle datev mails und verschiebe sie"
 * is genuinely ambiguous, but we treat it as "count" because the explicit
 * verb "zähle" is the primary instruction and we don't want to silently
 * execute moves on counting prompts.
 */
export function detectAssistantIntent(prompt: string): AiAssistantIntent {
  const lower = prompt.toLowerCase();
  if (COUNT_PATTERNS.some((re) => re.test(lower))) return "count";
  if (SEARCH_PATTERNS.some((re) => re.test(lower))) return "search";
  if (TRASH_PATTERNS.some((re) => re.test(lower))) return "trash";
  if (EXTRACT_CONTACTS_PATTERNS.some((re) => re.test(lower))) return "extract_contacts";
  if (CATEGORIZE_PATTERNS.some((re) => re.test(lower))) return "categorize";
  if (SPAM_OR_MOVE_PATTERNS.some((re) => re.test(lower))) return "move";
  return "unknown";
}

/** Whether an intent should produce an action plan (LLM call) or stay deterministic. */
export function intentRunsActionPlan(intent: AiAssistantIntent): boolean {
  return (
    intent === "categorize" ||
    intent === "organize" ||
    intent === "move" ||
    intent === "trash" ||
    intent === "extract_contacts"
  );
}
