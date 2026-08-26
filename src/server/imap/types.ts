/** IMAP account credentials and connection settings. */
export type ImapAccountConfig = {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
};

/** Metadata for a single IMAP folder (mailbox), including its detected special-use role. */
export type ImapFolderInfo = {
  path: string;
  displayName: string;
  delimiter?: string;
  flags?: string[];
  /** Normalized role: "inbox" | "sent" | "trash" | "spam" | "archive" | undefined */
  specialUse?: string;
};

/** Lightweight metadata about a message attachment (extracted from BODYSTRUCTURE). */
export type ImapAttachmentMeta = {
  filename?: string;
  mimeType?: string;
  size?: number;
  /** IMAP part identifier used to download this specific attachment. */
  partId?: string;
};

/** Full envelope and structure metadata for a single IMAP message. */
export type ImapMessageMeta = {
  uid: bigint;
  messageId?: string;
  subject?: string;
  fromName?: string;
  fromEmail?: string;
  toEmails: string[];
  ccEmails: string[];
  date?: Date;
  /** Short text preview (max 140 chars) for list views. */
  snippet?: string;
  /** Longer plain-text preview (max 240 chars) derived from body. */
  textPreview?: string;
  hasAttachments: boolean;
  attachmentCount: number;
  flags: string[];
  size?: number;
  attachments: ImapAttachmentMeta[];
};

/**
 * A reusable IMAP session that keeps a single TLS connection open
 * across multiple mailbox operations (open, fetch, flag checks).
 */
export interface ImapSession {
  /** Open (SELECT) a mailbox and return its UID state. */
  openMailbox(folderPath: string): Promise<{ uidValidity: bigint; uidNext: bigint; exists: number }>;
  /** Fetch full message metadata for a UID range (e.g. "42:*"). */
  fetchNewMessages(uidRange: string): Promise<ImapMessageMeta[]>;
  /** Fetch only UID + flags for a UID range (lightweight delta sync). */
  fetchFlags(uidRange: string): Promise<Array<{ uid: bigint; flags: string[] }>>;
  /** Iterate through all messages in the current mailbox in sequence-number batches. */
  fetchMessagesPaged(
    batchSize: number,
    onBatch: (batch: ImapMessageMeta[]) => Promise<void>,
  ): Promise<{ totalFetched: number; maxUid: bigint }>;
}

/** Current state of a mailbox: UID validity epoch, next expected UID, and message count. */
export type ImapMailboxStatus = {
  uidValidity: bigint;
  uidNext: bigint;
  exists: number;
};

/** Result of a bulk move operation: successfully moved UIDs and per-message failures. */
export type BulkMoveResult = {
  moved: bigint[];
  failed: Array<{ uid: bigint; fromFolder: string; error: string }>;
};

/** Parsed message body content: plain text, raw HTML, and HTML-converted-to-text fallback. */
export type ImapMessageBody = {
  text: string;
  html: string;
  /** Plain-text derived from HTML (used when no text/plain part exists). */
  textFromHtml: string;
};
