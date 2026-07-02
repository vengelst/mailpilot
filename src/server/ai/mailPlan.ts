import { z } from "zod";

/**
 * Server-side schema for AI-driven mail plans.
 *
 * The AI is asked to return a list of *proposed* per-mail actions. The plan is
 * validated here before it can be executed. Action types are intentionally a
 * narrow whitelist — there is NO endgültig-löschen, NO EXPUNGE, NO papierkorb
 * leeren. "Trash" only ever means an IMAP move into the trash folder.
 */

export const aiMailActionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("categorize"),
      emailId: z.string().min(1),
      category: z.string().min(1),
      reason: z.string().optional(),
      confidence: z.number().min(0).max(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("move"),
      emailId: z.string().min(1),
      targetFolder: z.string().min(1),
      reason: z.string().optional(),
      confidence: z.number().min(0).max(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("move_trash"),
      emailId: z.string().min(1),
      reason: z.string().min(1),
      confidence: z.number().min(0).max(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("move_spam"),
      emailId: z.string().min(1),
      reason: z.string().min(1),
      confidence: z.number().min(0).max(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("mark_read"),
      emailId: z.string().min(1),
      reason: z.string().optional(),
      confidence: z.number().min(0).max(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("create_contact_candidate"),
      emailId: z.string().min(1),
      reason: z.string().optional(),
      confidence: z.number().min(0).max(1),
    })
    .strict(),
]);

export const aiMailPlanSchema = z
  .object({
    summary: z.string(),
    actions: z.array(aiMailActionSchema),
  })
  .strict();

export type AiMailAction = z.infer<typeof aiMailActionSchema>;
export type AiMailPlan = z.infer<typeof aiMailPlanSchema>;

export type AiMailCandidate = {
  id: string;
  subject: string | null;
  fromEmail: string | null;
  fromName: string | null;
  date: string | null;
  folderPath: string;
  snippet: string | null;
  aiCategory: string | null;
  hasAttachments: boolean;
};

export function buildPlanPrompt(input: {
  prompt: string;
  candidates: AiMailCandidate[];
  availableFolders: string[];
}) {
  const compactCandidates = input.candidates.map((c, i) => ({
    idx: i,
    subject: c.subject || "(kein Betreff)",
    from: c.fromName || c.fromEmail || "?",
    folder: c.folderPath,
    snippet: c.snippet ? c.snippet.slice(0, 80) : undefined,
  }));

  return [
    "Du bist ein E-Mail-Assistent für MailPilot. Der Benutzer beschreibt einen",
    "Auftrag in Freitext. Erzeuge daraus einen Plan aus diskreten Aktionen pro E-Mail.",
    "Antworte AUSSCHLIESSLICH mit JSON, ohne Markdown.",
    "",
    "Erlaubte Aktionstypen:",
    "  - categorize       (nur lokale Kategorie setzen)",
    "  - move             (Verschieben nach existierendem Ordnerpfad)",
    "  - move_trash       (Move nach Trash — KEIN endgültiges Löschen)",
    "  - move_spam        (Move nach Spam/Junk)",
    "  - mark_read        (\\Seen-Flag setzen)",
    "  - create_contact_candidate (Kontaktvorschlag aus E-Mail-Inhalt)",
    "",
    "Regeln:",
    "  - emailId ist der numerische Index (idx) aus der Kandidatenliste.",
    "  - targetFolder MUSS ein Pfad aus availableFolders sein.",
    "  - Klassifiziere ALLE Mails die zum Auftrag passen, nicht nur einige wenige.",
    "  - Bei Unsicherheit: confidence niedrig setzen (0.5-0.7), aber trotzdem vorschlagen.",
    "  - Niemals dauerhaftes Löschen vorschlagen.",
    "  - Wenn ein Ordner nicht existiert aber logisch wäre, verwende den nächstbesten existierenden.",
    "",
    "Auftrag des Benutzers:",
    JSON.stringify(input.prompt),
    "",
    "Verfügbare Ordnerpfade:",
    JSON.stringify(input.availableFolders),
    "",
    "Kandidaten-Mails (idx = ID für emailId):",
    JSON.stringify(compactCandidates),
    "",
    'Antworte mit JSON: { "summary": "...", "actions": [{ "type": "move", "emailId": "0", "targetFolder": "INBOX/Kunden", "reason": "...", "confidence": 0.9 }, ...] }',
    "emailId ist IMMER der idx-Wert als String (z.B. \"0\", \"1\", \"42\").",
  ].join("\n");
}

/**
 * After AI responds with numeric index-based emailIds,
 * map them back to real database IDs.
 */
export function remapPlanIds(plan: AiMailPlan, candidates: AiMailCandidate[]): AiMailPlan {
  return {
    summary: plan.summary,
    actions: plan.actions
      .map((action) => {
        const idx = parseInt(action.emailId, 10);
        if (isNaN(idx) || idx < 0 || idx >= candidates.length) return null;
        return { ...action, emailId: candidates[idx].id };
      })
      .filter((a): a is NonNullable<typeof a> => a !== null),
  };
}
