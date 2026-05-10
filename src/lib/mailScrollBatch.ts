/** Optionen für „Mails pro Nachladen“ — muss zu `/api/search` `snapLimit` passen (max. 500). */
export const MAIL_SCROLL_BATCH_OPTIONS = [50, 100, 200, 300, 500] as const;
export type MailScrollBatchOption = (typeof MAIL_SCROLL_BATCH_OPTIONS)[number];

export const DEFAULT_MAIL_SCROLL_BATCH: MailScrollBatchOption = 100;

export function snapMailScrollBatchSize(raw: number): MailScrollBatchOption {
  let chosen: MailScrollBatchOption = MAIL_SCROLL_BATCH_OPTIONS[0];
  for (const v of MAIL_SCROLL_BATCH_OPTIONS) {
    if (raw >= v) chosen = v;
  }
  return chosen;
}
