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
  const allowedActionsExample = JSON.stringify(
    {
      summary: "kurze Zusammenfassung dessen, was du vorhast",
      actions: [
        {
          type: "categorize",
          emailId: "<emailId>",
          category: "invoice",
          reason: "kurze Begründung",
          confidence: 0.9,
        },
        {
          type: "move",
          emailId: "<emailId>",
          targetFolder: "<existing folder path>",
          reason: "kurze Begründung",
          confidence: 0.92,
        },
        {
          type: "move_trash",
          emailId: "<emailId>",
          reason: "warum Papierkorb sicher ist",
          confidence: 0.97,
        },
        {
          type: "move_spam",
          emailId: "<emailId>",
          reason: "warum Spam sicher ist",
          confidence: 0.95,
        },
        {
          type: "mark_read",
          emailId: "<emailId>",
          reason: "optional",
          confidence: 0.6,
        },
        {
          type: "create_contact_candidate",
          emailId: "<emailId>",
          reason: "Kontakt im Inhalt erkannt",
          confidence: 0.85,
        },
      ],
    },
    null,
    2,
  );

  return [
    "Du bist ein E-Mail-Assistent für MailPilot. Der Benutzer beschreibt einen",
    "Auftrag in Freitext. Erzeuge daraus einen Plan aus diskreten, sicheren",
    "Aktionen pro E-Mail. Antworte AUSSCHLIESSLICH mit JSON, ohne Markdown.",
    "",
    "Erlaubte Aktionstypen:",
    "  - categorize       (nur lokale Kategorie setzen, IMAP unangetastet)",
    "  - move             (Verschieben nach existierendem Ordnerpfad)",
    "  - move_trash       (Move nach Trash — KEIN endgültiges Löschen)",
    "  - move_spam        (Move nach Spam/Junk)",
    "  - mark_read        (\\Seen-Flag setzen)",
    "  - create_contact_candidate (Kontaktvorschlag aus E-Mail-Inhalt)",
    "",
    "Strenge Regeln:",
    "  - emailId muss aus der Liste kommen, die du gleich bekommst.",
    "  - targetFolder muss aus availableFolders kommen.",
    "  - Bei Unsicherheit: confidence niedrig oder gar keine Aktion.",
    "  - Lieber weniger, dafür sichere Aktionen.",
    "  - Niemals dauerhaftes Löschen vorschlagen.",
    "",
    "Auftrag des Benutzers:",
    JSON.stringify(input.prompt),
    "",
    "Verfügbare Ordnerpfade:",
    JSON.stringify(input.availableFolders),
    "",
    "Kandidaten-Mails (nur Metadaten):",
    JSON.stringify(input.candidates),
    "",
    "Erwartetes JSON-Schema:",
    allowedActionsExample,
  ].join("\n");
}
