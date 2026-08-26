export const FIELD_OPTIONS: { value: string; label: string }[] = [
  { value: "fromEmail", label: "Absender-E-Mail" },
  { value: "fromDomain", label: "Absender-Domain" },
  { value: "subject", label: "Betreff" },
  { value: "aiCategory", label: "KI-Kategorie" },
  { value: "aiPriority", label: "KI-Priorität" },
  { value: "keywords", label: "Schlüsselwörter" },
  { value: "hasAttachments", label: "Hat Anhänge" },
  { value: "attachmentFilename", label: "Anhang-Dateiname" },
];

export const OPERATOR_OPTIONS: Record<string, { value: string; label: string }[]> = {
  fromEmail: [
    { value: "equals", label: "ist gleich" },
    { value: "contains", label: "enthält" },
    { value: "endsWith", label: "endet mit" },
  ],
  fromDomain: [{ value: "equals", label: "ist gleich" }],
  subject: [{ value: "contains", label: "enthält" }],
  aiCategory: [
    { value: "equals", label: "ist gleich" },
    { value: "contains", label: "enthält" },
  ],
  aiPriority: [
    { value: "equals", label: "ist gleich" },
  ],
  keywords: [
    { value: "equals", label: "ist gleich" },
    { value: "contains", label: "enthält" },
  ],
  hasAttachments: [{ value: "equals", label: "ist gleich" }],
  attachmentFilename: [
    { value: "contains", label: "enthält" },
    { value: "endsWith", label: "endet mit" },
  ],
};

export const ACTION_OPTIONS: { value: string; label: string; needsValue: boolean }[] = [
  { value: "add_label", label: "Label zuweisen", needsValue: true },
  { value: "move_folder", label: "In Ordner verschieben", needsValue: true },
  { value: "set_category", label: "Kategorie setzen", needsValue: true },
  { value: "set_priority", label: "Priorität setzen", needsValue: true },
  { value: "move_trash", label: "In Papierkorb", needsValue: false },
  { value: "move_spam", label: "Als Spam markieren", needsValue: false },
  { value: "mark_newsletter", label: "Als Newsletter markieren", needsValue: false },
  { value: "queue_ai_analysis", label: "KI-Analyse anstoßen", needsValue: false },
];

export const PRIORITY_VALUES = [
  { value: "low", label: "Niedrig" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "Hoch" },
  { value: "urgent", label: "Dringend" },
];

export function formatDate(value: string | null) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.valueOf())) return "-";
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

