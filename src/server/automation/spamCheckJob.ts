/**
 * @module spamCheckJob
 *
 * Rule-based spam detection job that scores incoming emails against known
 * spam patterns (subject lines, body text, sender domains, link domains)
 * and optionally incorporates AI classification confidence. Emails exceeding
 * the score threshold are moved to the spam folder automatically.
 */

import { prisma } from "@/server/db/prisma";
import { moveIndexedEmailToSpecial } from "@/server/imap/imapService";
import { applyEmailIndexFolderMove } from "@/server/imap/service/applyEmailIndexMove";

/** Represents a single spam signal with a human-readable reason and numeric weight. */
type SpamSignal = {
  reason: string;
  score: number;
};

const SUBJECT_PATTERNS: Array<{ re: RegExp; score: number; reason: string }> = [
  { re: /gewonnen|gewinnspiel|jackpot/i, score: 3, reason: "Gewinnversprechen" },
  { re: /dringend|sofort handeln|letzte mahnung/i, score: 2, reason: "Drucksprache" },
  { re: /konto gesperrt|account suspended|verifizieren/i, score: 3, reason: "Phishing-Muster" },
  { re: /passwort laeuft ab|password expires|zugang wird deaktiviert/i, score: 3, reason: "Zugangsdrohung" },
  { re: /sicherheitswarnung|security alert|ungewoehnliche anmeldung/i, score: 2, reason: "Sicherheitsdruck" },
  { re: /offene rechnung|mahnung|zahlung fehlgeschlagen|lastschrift/i, score: 2, reason: "Zahlungsdruck" },
  { re: /bitcoin|krypto|casino|viagra/i, score: 3, reason: "Spam-Schluesselwoerter" },
  { re: /\b(re:|fwd:)\b.{0,8}\b(re:|fwd:)\b/i, score: 2, reason: "Betreff-Verschleierung" },
];

const BODY_PATTERNS: Array<{ re: RegExp; score: number; reason: string }> = [
  { re: /klicken sie hier|click here|jetzt bestaetigen|confirm now/i, score: 2, reason: "Call-to-click" },
  { re: /konto wird geschlossen|account will be closed|gesperrt in 24 stunden/i, score: 3, reason: "Kontosperrungsdruck" },
  { re: /bit\.ly|tinyurl|t\.co|rebrand\.ly/i, score: 3, reason: "Kurzlink" },
];

const SUSPICIOUS_HOSTING_DOMAINS = [
  "netlify.app",
  "vercel.app",
  "github.io",
  "web.app",
  "pages.dev",
  "workers.dev",
];

const BRAND_DOMAIN_RULES: Array<{ brand: RegExp; domains: string[] }> = [
  { brand: /\bionos\b|1&1/i, domains: ["ionos.de", "ionos.com", "1und1.de", "1and1.com"] },
  { brand: /\bpaypal\b/i, domains: ["paypal.com"] },
  { brand: /\bamazon\b/i, domains: ["amazon.de", "amazon.com"] },
  { brand: /\bmicrosoft\b|outlook|office365/i, domains: ["microsoft.com", "outlook.com", "office.com"] },
  { brand: /\bsparkasse\b|deutsche bank|volksbank|postbank/i, domains: ["sparkasse.de", "deutsche-bank.de", "postbank.de"] },
  { brand: /\bdocusign\b/i, domains: ["docusign.com", "docusign.net", "docusign.de"] },
];

/**
 * Extracts the domain part from an email address string.
 * @param from - Raw "from" email address
 * @returns Lowercased domain, or empty string if no "@" found
 */
function senderDomain(from: string) {
  const at = from.lastIndexOf("@");
  if (at < 0) return "";
  return from.slice(at + 1).trim().toLowerCase();
}

/**
 * Parses all HTTP(S) URLs from a text block and returns their hostnames.
 * @param text - Combined body/preview text to scan
 * @returns Array of lowercased hostnames found in URLs
 */
function extractUrlDomains(text: string) {
  const matches = text.match(/https?:\/\/[^\s)>"']+/gi) ?? [];
  const domains: string[] = [];
  for (const raw of matches) {
    try {
      const host = new URL(raw).hostname.toLowerCase();
      if (host) domains.push(host);
    } catch {
      // ignore invalid urls
    }
  }
  return domains;
}

/**
 * Checks whether a domain matches any entry in the expected list (exact or subdomain).
 * @param domain - Domain to verify
 * @param expected - Whitelist of legitimate domains
 */
function domainMatchesAny(domain: string, expected: string[]) {
  return expected.some((d) => domain === d || domain.endsWith(`.${d}`));
}

/**
 * Computes a cumulative spam score for a given email by matching subject,
 * body, sender domain, and embedded URLs against known spam heuristics.
 *
 * @param email - Partial email record with subject, preview, body and sender fields
 * @returns Object containing the total score and the list of triggered signals
 */
function scoreSpam(email: {
  subject: string | null;
  textPreview: string | null;
  snippet: string | null;
  bodyText?: string | null;
  bodyPlain?: string | null;
  fromEmail: string | null;
}) {
  const subject = email.subject ?? "";
  const text = `${email.textPreview ?? ""} ${email.snippet ?? ""} ${email.bodyText ?? ""} ${email.bodyPlain ?? ""}`;
  const from = (email.fromEmail ?? "").toLowerCase();
  const fromDomain = senderDomain(from);
  const urlDomains = extractUrlDomains(text);
  const combined = `${subject} ${text}`;

  const signals: SpamSignal[] = [];

  for (const pattern of SUBJECT_PATTERNS) {
    if (pattern.re.test(subject)) {
      signals.push({ reason: pattern.reason, score: pattern.score });
    }
  }
  for (const pattern of BODY_PATTERNS) {
    if (pattern.re.test(text)) {
      signals.push({ reason: pattern.reason, score: pattern.score });
    }
  }

  if (/xn--/.test(from)) {
    signals.push({ reason: "Punycode-Absender", score: 3 });
  }
  if (!from.includes("@")) {
    signals.push({ reason: "Ungueltiger Absender", score: 2 });
  }
  if ((text.match(/https?:\/\//gi) ?? []).length >= 3) {
    signals.push({ reason: "Viele Links", score: 2 });
  }
  if (fromDomain && /\.(ru|cn|top|click|xyz|rest|quest)$/i.test(fromDomain)) {
    signals.push({ reason: "Verdaechtige TLD", score: 2 });
  }
  if (
    urlDomains.some((d) => SUSPICIOUS_HOSTING_DOMAINS.some((host) => d === host || d.endsWith(`.${host}`)))
  ) {
    signals.push({ reason: "Verdaechtige Link-Hosting-Domain", score: 4 });
  }
  if (
    /e-?mail-?passwort|email-?passwort|mail-?passwort|passwort eingeben|enter (your )?email password|verify your email password/i.test(
      combined,
    ) &&
    urlDomains.length > 0
  ) {
    signals.push({ reason: "Passwortabfrage ueber Mail-Link", score: 5 });
  }
  if (
    /docusign/i.test(combined) &&
    /e-?mail-?passwort|email-?passwort|mail-?passwort|passwort eingeben|enter (your )?email password|verify your email password/i.test(
      combined,
    )
  ) {
    signals.push({ reason: "Unzulaessige Passwortabfrage", score: 5 });
  }
  if (fromDomain && urlDomains.length > 0 && urlDomains.every((d) => d !== fromDomain && !d.endsWith(`.${fromDomain}`))) {
    signals.push({ reason: "Linkdomain passt nicht zum Absender", score: 3 });
  }
  if (
    /docusign/i.test(combined) &&
    urlDomains.length > 0 &&
    urlDomains.some((d) => !domainMatchesAny(d, ["docusign.com", "docusign.net", "docusign.de"]))
  ) {
    signals.push({ reason: "DocuSign mit fremder Linkdomain", score: 5 });
  }
  for (const rule of BRAND_DOMAIN_RULES) {
    if (rule.brand.test(combined) && fromDomain && !domainMatchesAny(fromDomain, rule.domains)) {
      signals.push({ reason: "Marke passt nicht zur Absenderdomain", score: 3 });
    }
  }
  if (subject.length > 8 && subject === subject.toUpperCase()) {
    signals.push({ reason: "Betreff komplett in Grossbuchstaben", score: 1 });
  }

  const totalScore = signals.reduce((sum, s) => sum + s.score, 0);
  return { totalScore, signals };
}

/** Returns true if the folder path already represents a spam/junk folder. */
function looksLikeSpamFolder(path: string) {
  return /spam|junk|unerw(ü|ue)nscht|werbung/i.test(path);
}

/**
 * Main entry point: scores a batch of emails for spam and moves those
 * exceeding the threshold to the user's spam folder via IMAP.
 *
 * @param input.userId - Owner of the mailbox
 * @param input.emailIds - IDs of emails to evaluate
 * @param input.threshold - Minimum score to classify as spam (default 4)
 * @param input.aiMinConfidenceForSpam - AI confidence floor to trust AI spam label (default 0.98)
 * @returns Summary with counts of processed, flagged, and successfully moved emails
 */
export async function runSpamCheckJob(input: {
  userId: string;
  emailIds: string[];
  threshold?: number;
  aiMinConfidenceForSpam?: number;
}) {
  const threshold = input.threshold ?? 4;
  const aiMinConfidenceForSpam = input.aiMinConfidenceForSpam ?? 0.98;
  if (input.emailIds.length === 0) {
    return { processedEmails: 0, flagged: 0, moved: 0 };
  }

  const safeSenders = await prisma.blockedSender.findMany({
    where: { userId: input.userId, action: "allow_inbox", active: true },
    select: { email: true, domain: true },
  });
  const safeEmails = new Set(safeSenders.filter((s) => s.email).map((s) => s.email!.toLowerCase()));
  const safeDomains = safeSenders.filter((s) => s.domain).map((s) => s.domain!.toLowerCase());

  const emails = await prisma.emailIndex.findMany({
    where: {
      id: { in: input.emailIds },
      account: { userId: input.userId },
    },
    select: {
      id: true,
      accountId: true,
      folderPath: true,
      imapUid: true,
      messageId: true,
      subject: true,
      textPreview: true,
      snippet: true,
      bodyText: true,
      bodyPlain: true,
      fromEmail: true,
      aiCategory: true,
      aiConfidence: true,
      aiRecommendedAction: true,
    },
  });

  let flagged = 0;
  let moved = 0;

  for (const email of emails) {
    if (looksLikeSpamFolder(email.folderPath)) continue;

    const from = (email.fromEmail ?? "").toLowerCase();
    const fromDom = senderDomain(from);
    if (safeEmails.has(from) || safeDomains.some((d) => fromDom === d || fromDom.endsWith(`.${d}`))) {
      continue;
    }

    const { signals } = scoreSpam(email);
    // Boost score if AI classification also flags this email as spam with high confidence
    const aiSuggestsSpam =
      (email.aiCategory === "spam" || email.aiRecommendedAction === "mark_spam") &&
      (email.aiConfidence ?? 0) >= aiMinConfidenceForSpam;
    if (aiSuggestsSpam) {
      signals.push({
        reason: `KI stuft als Spam ein (Confidence ${(email.aiConfidence ?? 0).toFixed(2)})`,
        score: 4,
      });
    }
    const finalScore = signals.reduce((sum, s) => sum + s.score, 0);
    if (finalScore < threshold) continue;
    flagged += 1;

    try {
      const { path: targetFolder, newUid } = await moveIndexedEmailToSpecial(email.id, input.userId, "spam");
      await applyEmailIndexFolderMove(email, targetFolder, newUid, {
        aiCategory: "spam",
        aiPriority: "high",
        actionRequired: false,
        aiSummaryShort:
          email.aiCategory === "spam"
            ? undefined
            : `Spam-Check: automatisch als Spam eingestuft (Score ${finalScore}).`,
        aiSummaryLong:
          signals.length > 0
            ? `Erkannte Signale: ${signals.map((s) => s.reason).join(", ")}`
            : undefined,
      });
      moved += 1;
    } catch {
      // keep processing remaining emails even if one move fails
    }
  }

  return {
    processedEmails: emails.length,
    flagged,
    moved,
  };
}
