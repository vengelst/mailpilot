/**
 * IMAP Client Module
 *
 * Provides a low-level abstraction over the ImapFlow library for all IMAP
 * operations used by MailPilot: connecting to accounts, listing/managing
 * folders, fetching message metadata and bodies, moving/deleting messages,
 * downloading attachments, and performing UID-based searches.
 *
 * Each exported function manages its own connection lifecycle (connect → operate → logout).
 * For multi-step operations that should share a single TLS connection, use `withImapSession`.
 */

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { Readable } from "node:stream";

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

/** Create a new ImapFlow client instance with logging disabled. */
function buildClient(config: ImapAccountConfig) {
  return new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.username,
      pass: config.password,
    },
    logger: false,
  });
}

/**
 * Heuristically determine a folder's special-use role from its IMAP flags
 * and path name. Handles both standard RFC 6154 flags and common localized names.
 */
function detectSpecialUse(path: string, flags: string[] = []) {
  const lower = path.toLowerCase();
  if (flags.includes("\\Inbox") || lower === "inbox") return "inbox";
  if (flags.includes("\\Sent") || lower.includes("sent")) return "sent";
  if (flags.includes("\\Trash") || lower.includes("trash") || lower.includes("papierkorb")) return "trash";
  if (flags.includes("\\Junk") || lower.includes("junk") || lower.includes("spam")) return "spam";
  if (flags.includes("\\Archive") || lower.includes("archive")) return "archive";
  return undefined;
}

/** Return the first non-empty string from a list of candidates. */
function pickString(...candidates: unknown[]) {
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const trimmed = candidate.trim();
      if (trimmed) return trimmed;
    }
  }
  return undefined;
}

/** Return the first finite number from a list of candidates (coercing bigint/string). */
function pickNumber(...candidates: unknown[]) {
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
    if (typeof candidate === "bigint") return Number(candidate);
    if (typeof candidate === "string" && candidate.trim()) {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

/** Safely cast a value to a record if it's a non-null object. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

/**
 * Recursively walk the BODYSTRUCTURE tree and extract attachment metadata.
 * Distinguishes true attachments from inline text parts by checking
 * disposition, filename presence, and MIME type.
 */
function collectAttachments(structure: unknown, output: ImapAttachmentMeta[] = []): ImapAttachmentMeta[] {
  if (!structure || typeof structure !== "object") return output;

  const part = structure as Record<string, unknown>;
  const type = pickString(part.type)?.toLowerCase();
  const subtype = pickString(part.subtype)?.toLowerCase();
  const mimeType = pickString(part.mimeType) ?? (type && subtype ? `${type}/${subtype}` : undefined);
  const disposition = pickString(part.disposition)?.toLowerCase();

  // Different servers/libraries store filename in different nested fields.
  const params = asRecord(part.parameters);
  const dispositionParams = asRecord(part.dispositionParameters);
  const filename = pickString(
    part.filename,
    part.name,
    params?.name,
    params?.filename,
    dispositionParams?.filename,
    dispositionParams?.name,
  );
  const partId = pickString(part.part, part.partID, part.partId);
  const size = pickNumber(part.size, part.byteLength, part.length, part.bytes);

  // Classify the part: skip text/plain and text/html body parts,
  // but treat anything with an explicit "attachment" disposition, an inline
  // with a filename, or a non-text MIME part with a partId as an attachment.
  const isTextBody = type === "text" && (subtype === "plain" || subtype === "html");
  const isAttachmentByDisposition = disposition === "attachment";
  const isInlineFile = disposition === "inline" && !!filename;
  const isFileLikeNonText = !!mimeType && !isTextBody && !!partId;
  const isAttachment = isAttachmentByDisposition || isInlineFile || isFileLikeNonText;

  if (isAttachment) {
    output.push({
      filename,
      mimeType,
      size,
      partId,
    });
  }

  const childNodes = part.childNodes;
  if (Array.isArray(childNodes)) {
    childNodes.forEach((child) => collectAttachments(child, output));
  }
  return output;
}

/** Parse a raw RFC 5322 message buffer into plain text and HTML strings. */
async function parseMailSource(source?: Buffer) {
  if (!source) {
    console.warn("[parseMailSource] No source buffer received from IMAP");
    return { text: "", html: "" };
  }
  try {
    const parsed = await simpleParser(source);
    const text = (parsed.text ?? "").trim();
    const html = typeof parsed.html === "string" ? parsed.html : "";
    if (!text && !html) {
      console.warn(`[parseMailSource] Parsed source (${source.length} bytes) yielded no text/html`);
    }
    return { text, html };
  } catch (err) {
    console.error("[parseMailSource] Failed to parse mail source:", err);
    return { text: "", html: "" };
  }
}

/** Generate a max-240-char plain-text preview from the message text or stripped HTML. */
function buildTextPreview(text: string, html: string) {
  const fallback = text || html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
  return fallback.replace(/\s+/g, " ").trim().slice(0, 240);
}

/** Crude HTML-to-plain-text conversion (strips tags, collapses whitespace). */
function htmlToPlainText(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Consume a Node.js Readable stream into a single Buffer. */
async function streamToBuffer(stream: Readable) {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** Consume an arbitrary async iterable (Buffer, Uint8Array, string chunks) into a Buffer. */
async function asyncIterableToBuffer(input: AsyncIterable<unknown>) {
  const chunks: Buffer[] = [];
  for await (const chunk of input) {
    if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk);
      continue;
    }
    if (chunk instanceof Uint8Array) {
      chunks.push(Buffer.from(chunk));
      continue;
    }
    if (chunk instanceof ArrayBuffer) {
      chunks.push(Buffer.from(chunk));
      continue;
    }
    if (typeof chunk === "string") {
      chunks.push(Buffer.from(chunk));
      continue;
    }
    if (chunk !== null && chunk !== undefined) {
      chunks.push(Buffer.from(String(chunk)));
    }
  }
  return Buffer.concat(chunks);
}

/** Consume a Web ReadableStream<Uint8Array> into a Buffer. */
async function webReadableStreamToBuffer(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

/**
 * Universal binary reader: accepts Buffer, Uint8Array, string, Node Readable,
 * Web ReadableStream, or async iterable and returns a Buffer.
 * Returns null if the value cannot be converted.
 */
async function readBinaryPayload(value: unknown): Promise<Buffer | null> {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (typeof value === "string") return Buffer.from(value);
  if (value instanceof Readable) return streamToBuffer(value);

  if (typeof value === "object") {
    if (typeof (value as ReadableStream<Uint8Array>).getReader === "function") {
      return webReadableStreamToBuffer(value as ReadableStream<Uint8Array>);
    }
    if (typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function") {
      return asyncIterableToBuffer(value as AsyncIterable<unknown>);
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Shared IMAP Session — reuses a single TLS connection for multiple operations
// ---------------------------------------------------------------------------

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

/**
 * Execute multiple IMAP operations within a single shared connection.
 * Connects, invokes the callback with a session object, and ensures
 * the connection is closed (logout) even on error.
 *
 * @param config - IMAP account credentials
 * @param fn - Async callback receiving the open session
 * @returns The value returned by the callback
 */
export async function withImapSession<T>(
  config: ImapAccountConfig,
  fn: (session: ImapSession) => Promise<T>,
): Promise<T> {
  const client = buildClient(config);
  await client.connect();
  try {
    // Track the message count of the currently opened mailbox to skip
    // fetch calls on empty folders.
    let currentMailboxExists = 0;

    const session: ImapSession = {
      async openMailbox(folderPath: string) {
        const mailbox = (await client.mailboxOpen(folderPath)) as unknown as {
          uidValidity?: number | bigint;
          uidNext?: number | bigint;
          exists?: number;
        };
        currentMailboxExists = Number(mailbox.exists ?? 0);
        return {
          uidValidity: toBigInt(mailbox.uidValidity),
          uidNext: toBigInt(mailbox.uidNext),
          exists: currentMailboxExists,
        };
      },

      async fetchNewMessages(uidRange: string) {
        if (!currentMailboxExists) return [];
        const messages: ImapMessageMeta[] = [];
        for await (const message of client.fetch(
          uidRange,
          {
            uid: true,
            envelope: true,
            flags: true,
            size: true,
            bodyStructure: true,
            source: true,
          } as never,
          { uid: true } as never,
        )) {
          const raw = message as unknown as {
            uid: number;
            envelope?: {
              messageId?: string;
              subject?: string;
              from?: Array<{ name?: string; address?: string }>;
              to?: Array<{ address?: string }>;
              cc?: Array<{ address?: string }>;
              date?: Date;
            };
            flags?: Set<string>;
            size?: number;
            source?: Buffer;
            bodyStructure?: unknown;
          };

          const attachments = collectAttachments(raw.bodyStructure);
          const envelope = raw.envelope;
          const parsed = await parseMailSource(raw.source);
          const textPreview = buildTextPreview(parsed.text, parsed.html);
          messages.push({
            uid: BigInt(raw.uid),
            messageId: envelope?.messageId,
            subject: envelope?.subject,
            fromName: envelope?.from?.[0]?.name,
            fromEmail: envelope?.from?.[0]?.address,
            toEmails: envelope?.to?.map((x) => x.address || "").filter(Boolean) || [],
            ccEmails: envelope?.cc?.map((x) => x.address || "").filter(Boolean) || [],
            date: envelope?.date,
            snippet: textPreview.slice(0, 140),
            textPreview,
            hasAttachments: attachments.length > 0,
            attachmentCount: attachments.length,
            flags: Array.from(raw.flags || []),
            size: Number(raw.size || 0),
            attachments,
          });
        }
        return messages;
      },

      async fetchFlags(uidRange: string) {
        if (!currentMailboxExists) return [];
        const result: Array<{ uid: bigint; flags: string[] }> = [];
        for await (const message of client.fetch(
          uidRange,
          { uid: true, flags: true } as never,
          { uid: true } as never,
        )) {
          const raw = message as unknown as { uid: number | bigint; flags?: Set<string> };
          result.push({
            uid: BigInt(raw.uid),
            flags: Array.from(raw.flags || []),
          });
        }
        return result;
      },

      async fetchMessagesPaged(batchSize, onBatch) {
        if (!currentMailboxExists) return { totalFetched: 0, maxUid: BigInt(0) };
        let totalFetched = 0;
        let maxUid = BigInt(0);

        for (let start = 1; start <= currentMailboxExists; start += batchSize) {
          const end = Math.min(start + batchSize - 1, currentMailboxExists);
          const range = `${start}:${end}`;
          const batch: ImapMessageMeta[] = [];

          for await (const message of client.fetch(
            range,
            {
              uid: true,
              envelope: true,
              flags: true,
              size: true,
              bodyStructure: true,
              source: true,
            } as never,
            { uid: false } as never,
          )) {
            const raw = message as unknown as {
              uid: number | bigint;
              envelope?: {
                messageId?: string;
                subject?: string;
                from?: Array<{ name?: string; address?: string }>;
                to?: Array<{ address?: string }>;
                cc?: Array<{ address?: string }>;
                date?: Date;
              };
              flags?: Set<string>;
              size?: number;
              source?: Buffer;
              bodyStructure?: unknown;
            };

            const attachments = collectAttachments(raw.bodyStructure);
            const envelope = raw.envelope;
            const parsed = await parseMailSource(raw.source);
            const textPreview = buildTextPreview(parsed.text, parsed.html);
            const uid = BigInt(raw.uid);
            if (uid > maxUid) maxUid = uid;
            batch.push({
              uid,
              messageId: envelope?.messageId,
              subject: envelope?.subject,
              fromName: envelope?.from?.[0]?.name,
              fromEmail: envelope?.from?.[0]?.address,
              toEmails: envelope?.to?.map((x) => x.address || "").filter(Boolean) || [],
              ccEmails: envelope?.cc?.map((x) => x.address || "").filter(Boolean) || [],
              date: envelope?.date,
              snippet: textPreview.slice(0, 140),
              textPreview,
              hasAttachments: attachments.length > 0,
              attachmentCount: attachments.length,
              flags: Array.from(raw.flags || []),
              size: Number(raw.size || 0),
              attachments,
            });
          }

          if (batch.length > 0) {
            await onBatch(batch);
            totalFetched += batch.length;
          }
        }

        return { totalFetched, maxUid };
      },
    };

    return await fn(session);
  } finally {
    // Gracefully close the TLS connection if still alive
    if (client.usable) await client.logout();
  }
}

/**
 * Verify that the IMAP credentials are valid by connecting and opening INBOX.
 *
 * @param config - IMAP account credentials
 * @returns `{ ok: true }` on success; throws on authentication/connection failure
 */
export async function testImapConnection(config: ImapAccountConfig) {
  const client = buildClient(config);
  try {
    await client.connect();
    await client.mailboxOpen("INBOX");
    return { ok: true };
  } finally {
    if (client.usable) {
      await client.logout();
    }
  }
}

/**
 * List all folders (mailboxes) on the IMAP server with their flags and
 * detected special-use role.
 *
 * @param config - IMAP account credentials
 * @returns Array of folder info objects
 */
export async function listImapFolders(config: ImapAccountConfig): Promise<ImapFolderInfo[]> {
  const client = buildClient(config);
  try {
    await client.connect();
    const list = await client.list();
    return list.map((folder) => {
      const flags = Array.from(folder.flags || []);
      return {
        path: folder.path,
        displayName: folder.name || folder.path,
        delimiter: folder.delimiter,
        flags,
        specialUse: detectSpecialUse(folder.path, flags),
      };
    });
  } finally {
    if (client.usable) {
      await client.logout();
    }
  }
}

/**
 * Create a new folder (mailbox) on the IMAP server.
 *
 * @param config - IMAP account credentials
 * @param folderPath - Full path of the folder to create (e.g. "INBOX/Projects")
 */
export async function createImapFolder(
  config: ImapAccountConfig,
  folderPath: string,
): Promise<void> {
  const client = buildClient(config);
  try {
    await client.connect();
    await client.mailboxCreate(folderPath);
  } finally {
    if (client.usable) {
      await client.logout();
    }
  }
}

/**
 * Permanently delete a folder (mailbox) from the IMAP server.
 *
 * @param config - IMAP account credentials
 * @param folderPath - Full path of the folder to delete
 */
export async function deleteImapFolder(
  config: ImapAccountConfig,
  folderPath: string,
): Promise<void> {
  const client = buildClient(config);
  try {
    await client.connect();
    await client.mailboxDelete(folderPath);
  } finally {
    if (client.usable) {
      await client.logout();
    }
  }
}

/**
 * Rename (move) a folder on the IMAP server.
 *
 * @param config - IMAP account credentials
 * @param fromPath - Current folder path
 * @param toPath - Desired new folder path
 */
export async function renameImapFolder(
  config: ImapAccountConfig,
  fromPath: string,
  toPath: string,
): Promise<void> {
  const client = buildClient(config);
  try {
    await client.connect();
    await client.mailboxRename(fromPath, toPath);
  } finally {
    if (client.usable) {
      await client.logout();
    }
  }
}

/**
 * Copy all messages from one folder to another (server-side COPY).
 *
 * @param config - IMAP account credentials
 * @param sourcePath - Folder to copy messages from
 * @param targetPath - Folder to copy messages into
 */
export async function copyImapFolderMessages(
  config: ImapAccountConfig,
  sourcePath: string,
  targetPath: string,
): Promise<void> {
  const client = buildClient(config);
  try {
    await client.connect();
    const mailbox = await client.mailboxOpen(sourcePath);
    const exists = mailbox.exists ?? 0;
    if (exists > 0) {
      await client.messageCopy("1:*", targetPath, { uid: false });
    }
  } finally {
    if (client.usable) {
      await client.logout();
    }
  }
}

/** Current state of a mailbox: UID validity epoch, next expected UID, and message count. */
export type ImapMailboxStatus = {
  uidValidity: bigint;
  uidNext: bigint;
  exists: number;
};

/** Safely coerce an unknown value (bigint, number, or numeric string) to bigint. */
function toBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string" && value) return BigInt(value);
  return BigInt(0);
}

/**
 * Open a mailbox and return its current UID validity, next UID, and message count.
 * Used to detect whether a full re-sync is needed (uidValidity changed).
 *
 * @param config - IMAP account credentials
 * @param folderPath - Folder to query
 * @returns Mailbox status with UID state
 */
export async function getMailboxStatus(
  config: ImapAccountConfig,
  folderPath: string,
): Promise<ImapMailboxStatus> {
  const client = buildClient(config);
  try {
    await client.connect();
    const mailbox = (await client.mailboxOpen(folderPath)) as unknown as {
      uidValidity?: number | bigint;
      uidNext?: number | bigint;
      exists?: number;
    };
    return {
      uidValidity: toBigInt(mailbox.uidValidity),
      uidNext: toBigInt(mailbox.uidNext),
      exists: Number(mailbox.exists ?? 0),
    };
  } finally {
    if (client.usable) {
      await client.logout();
    }
  }
}

/**
 * Fetch only the UID and flags for messages in a given UID range.
 * Lightweight operation used for incremental flag-sync without downloading bodies.
 *
 * @param config - IMAP account credentials
 * @param folderPath - Folder to query
 * @param range - IMAP UID range string (e.g. "1:*" or "500:600")
 * @returns Array of uid/flags pairs
 */
export async function fetchFlagsByUidRange(
  config: ImapAccountConfig,
  folderPath: string,
  range: string,
): Promise<Array<{ uid: bigint; flags: string[] }>> {
  const client = buildClient(config);
  const result: Array<{ uid: bigint; flags: string[] }> = [];
  try {
    await client.connect();
    const mailbox = await client.mailboxOpen(folderPath);
    if (!mailbox.exists) return result;

    for await (const message of client.fetch(
      range,
      { uid: true, flags: true } as never,
      { uid: true } as never,
    )) {
      const raw = message as unknown as { uid: number | bigint; flags?: Set<string> };
      result.push({
        uid: BigInt(raw.uid),
        flags: Array.from(raw.flags || []),
      });
    }
    return result;
  } finally {
    if (client.usable) {
      await client.logout();
    }
  }
}

/**
 * Internal helper: fetch full message metadata for a given range (either
 * sequence-number or UID-based depending on `useUid`).
 */
async function fetchMessagesInRange(
  config: ImapAccountConfig,
  folderPath: string,
  range: string,
  useUid: boolean,
): Promise<ImapMessageMeta[]> {
  const client = buildClient(config);
  try {
    await client.connect();
    const mailbox = await client.mailboxOpen(folderPath);
    if (!mailbox.exists) return [];

    const messages: ImapMessageMeta[] = [];
    for await (const message of client.fetch(
      range,
      {
        uid: true,
        envelope: true,
        flags: true,
        size: true,
        bodyStructure: true,
        source: true,
      } as never,
      { uid: useUid } as never,
    )) {
      const raw = message as unknown as {
        uid: number;
        envelope?: {
          messageId?: string;
          subject?: string;
          from?: Array<{ name?: string; address?: string }>;
          to?: Array<{ address?: string }>;
          cc?: Array<{ address?: string }>;
          date?: Date;
        };
        flags?: Set<string>;
        size?: number;
        source?: Buffer;
        bodyStructure?: unknown;
      };

      const attachments = collectAttachments(raw.bodyStructure);
      const envelope = raw.envelope as
        | {
            messageId?: string;
            subject?: string;
            from?: Array<{ name?: string; address?: string }>;
            to?: Array<{ address?: string }>;
            cc?: Array<{ address?: string }>;
            date?: Date;
          }
        | undefined;

      const parsed = await parseMailSource(raw.source);
      const textPreview = buildTextPreview(parsed.text, parsed.html);
      messages.push({
        uid: BigInt(raw.uid),
        messageId: envelope?.messageId,
        subject: envelope?.subject,
        fromName: envelope?.from?.[0]?.name,
        fromEmail: envelope?.from?.[0]?.address,
        toEmails: envelope?.to?.map((x) => x.address || "").filter(Boolean) || [],
        ccEmails: envelope?.cc?.map((x) => x.address || "").filter(Boolean) || [],
        date: envelope?.date,
        snippet: textPreview.slice(0, 140),
        textPreview,
        hasAttachments: attachments.length > 0,
        attachmentCount: attachments.length,
        flags: Array.from(raw.flags || []),
        size: Number(raw.size || 0),
        attachments,
      });
    }

    return messages;
  } finally {
    if (client.usable) {
      await client.logout();
    }
  }
}

/**
 * Fetch the most recent N messages from a folder (by sequence number).
 * Opens its own connection to determine the total count, then fetches the tail.
 *
 * @param config - IMAP account credentials
 * @param folderPath - Folder to query
 * @param maxMessages - Maximum number of messages to return (default 100)
 * @returns Array of message metadata, newest last
 */
export async function fetchFolderMessages(
  config: ImapAccountConfig,
  folderPath: string,
  maxMessages = 100,
): Promise<ImapMessageMeta[]> {
  const client = buildClient(config);
  let mailboxExists = 0;
  try {
    await client.connect();
    const mailbox = await client.mailboxOpen(folderPath);
    mailboxExists = mailbox.exists ?? 0;
  } finally {
    if (client.usable) {
      await client.logout();
    }
  }
  if (!mailboxExists) return [];
  // Calculate the sequence-number range for the latest N messages
  const start = Math.max(1, mailboxExists - maxMessages + 1);
  return fetchMessagesInRange(config, folderPath, `${start}:*`, false);
}

/**
 * Fetch full message metadata for a specific UID range.
 *
 * @param config - IMAP account credentials
 * @param folderPath - Folder to query
 * @param uidRange - IMAP UID range string (e.g. "100:*")
 * @returns Array of message metadata
 */
export async function fetchMessagesByUidRange(
  config: ImapAccountConfig,
  folderPath: string,
  uidRange: string,
): Promise<ImapMessageMeta[]> {
  return fetchMessagesInRange(config, folderPath, uidRange, true);
}

/**
 * Permanently delete every message in `folderPath`.
 *
 * THIS IS THE ONE PLACE in the codebase that flags messages with `\Deleted`
 * and calls EXPUNGE. It is intentionally narrow: caller MUST have already
 * confirmed that the folder is the user's Trash or Spam mailbox via
 * `imapService.emptyTrashOrSpamFolder`. Never call this on INBOX or any
 * regular folder.
 *
 * Returns the number of messages that existed before the purge.
 */
export async function purgeFolderMessages(
  config: ImapAccountConfig,
  folderPath: string,
): Promise<{ deleted: number }> {
  const client = buildClient(config);
  try {
    await client.connect();
    const mailbox = await client.mailboxOpen(folderPath);
    const exists = mailbox.exists ?? 0;
    if (!exists) return { deleted: 0 };
    // imapflow's `messageDelete` flags with \Deleted and expunges in one call.
    // Range "1:*" selects every message in the just-opened mailbox.
    await (client as unknown as { messageDelete: (range: string) => Promise<boolean> })
      .messageDelete("1:*");
    return { deleted: exists };
  } finally {
    if (client.usable) {
      await client.logout();
    }
  }
}

/**
 * Fetch every message of a folder in sequence-number batches and emit them via
 * `onBatch` so the caller can persist each chunk and free memory.
 *
 * Used for the real folder rebuild (full re-sync). Avoids loading the entire
 * folder into memory at once. Does NOT delete or expunge anything on IMAP.
 */
export async function fetchFolderMessagesPaged(
  config: ImapAccountConfig,
  folderPath: string,
  batchSize: number,
  onBatch: (batch: ImapMessageMeta[]) => Promise<void>,
): Promise<{ totalFetched: number; maxUid: bigint }> {
  const client = buildClient(config);
  let totalFetched = 0;
  let maxUid = BigInt(0);
  try {
    await client.connect();
    const mailbox = await client.mailboxOpen(folderPath);
    const exists = mailbox.exists ?? 0;
    if (!exists) return { totalFetched: 0, maxUid };

    for (let start = 1; start <= exists; start += batchSize) {
      const end = Math.min(start + batchSize - 1, exists);
      const range = `${start}:${end}`;
      const batch: ImapMessageMeta[] = [];

      for await (const message of client.fetch(
        range,
        {
          uid: true,
          envelope: true,
          flags: true,
          size: true,
          bodyStructure: true,
          source: true,
        } as never,
        { uid: false } as never,
      )) {
        const raw = message as unknown as {
          uid: number | bigint;
          envelope?: {
            messageId?: string;
            subject?: string;
            from?: Array<{ name?: string; address?: string }>;
            to?: Array<{ address?: string }>;
            cc?: Array<{ address?: string }>;
            date?: Date;
          };
          flags?: Set<string>;
          size?: number;
          source?: Buffer;
          bodyStructure?: unknown;
        };

        const attachments = collectAttachments(raw.bodyStructure);
        const envelope = raw.envelope;
        const parsed = await parseMailSource(raw.source);
        const textPreview = buildTextPreview(parsed.text, parsed.html);
        const uid = BigInt(raw.uid);
        if (uid > maxUid) maxUid = uid;
        batch.push({
          uid,
          messageId: envelope?.messageId,
          subject: envelope?.subject,
          fromName: envelope?.from?.[0]?.name,
          fromEmail: envelope?.from?.[0]?.address,
          toEmails: envelope?.to?.map((x) => x.address || "").filter(Boolean) || [],
          ccEmails: envelope?.cc?.map((x) => x.address || "").filter(Boolean) || [],
          date: envelope?.date,
          snippet: textPreview.slice(0, 140),
          textPreview,
          hasAttachments: attachments.length > 0,
          attachmentCount: attachments.length,
          flags: Array.from(raw.flags || []),
          size: Number(raw.size || 0),
          attachments,
        });
      }

      if (batch.length > 0) {
        await onBatch(batch);
        totalFetched += batch.length;
      }
    }

    return { totalFetched, maxUid };
  } finally {
    if (client.usable) {
      await client.logout();
    }
  }
}

/**
 * Add or remove the \Seen flag on a single message.
 *
 * @param config - IMAP account credentials
 * @param folderPath - Folder containing the message
 * @param uid - Message UID
 * @param seen - true to mark as read, false to mark as unread
 */
export async function setMessageSeen(
  config: ImapAccountConfig,
  folderPath: string,
  uid: bigint,
  seen: boolean,
) {
  const client = buildClient(config);
  const range = uid.toString();
  try {
    await client.connect();
    await client.mailboxOpen(folderPath);
    if (seen) {
      await client.messageFlagsAdd(range, ["\\Seen"], { uid: true });
    } else {
      await client.messageFlagsRemove(range, ["\\Seen"], { uid: true });
    }
  } finally {
    if (client.usable) {
      await client.logout();
    }
  }
}

/**
 * Move a single message to a target folder with folder-existence validation.
 * Returns the new UID assigned in the target folder (if the server reports it).
 *
 * @param config - IMAP account credentials
 * @param fromFolder - Source folder path
 * @param uid - Message UID in the source folder
 * @param targetFolder - Destination folder path
 * @returns New UID in the target folder, or null if the server didn't report it
 */
export async function moveMessage(
  config: ImapAccountConfig,
  fromFolder: string,
  uid: bigint,
  targetFolder: string,
): Promise<bigint | null> {
  const client = buildClient(config);
  try {
    await client.connect();
    const folders = await client.list();
    // Validate that the target folder actually exists before attempting the move
    const exists = folders.some((f) => f.path.toLowerCase() === targetFolder.toLowerCase());
    if (!exists) {
      throw new Error(`Target folder '${targetFolder}' does not exist on IMAP server`);
    }
    await client.mailboxOpen(fromFolder);
    const result = await client.messageMove(uid.toString(), targetFolder, { uid: true });
    // uidMap maps old UID → new UID in the destination folder (RFC 4315 UIDPLUS)
    if (result && result.uidMap) {
      const newUid = result.uidMap.get(Number(uid));
      if (newUid) return BigInt(newUid);
    }
    return null;
  } finally {
    if (client.usable) {
      await client.logout();
    }
  }
}

/**
 * Move a single message without redundant folder validation.
 * The caller is responsible for ensuring targetFolder exists (e.g. via
 * listImapFolders / resolveSpecialFolderPath).
 */
export async function moveMessageDirect(
  config: ImapAccountConfig,
  fromFolder: string,
  uid: bigint,
  targetFolder: string,
): Promise<bigint | null> {
  const client = buildClient(config);
  try {
    await client.connect();
    await client.mailboxOpen(fromFolder);
    const result = await client.messageMove(uid.toString(), targetFolder, { uid: true });
    if (result && result.uidMap) {
      const newUid = result.uidMap.get(Number(uid));
      if (newUid) return BigInt(newUid);
    }
    return null;
  } finally {
    if (client.usable) {
      await client.logout();
    }
  }
}

/**
 * Move a message to a special-use folder (trash or spam) by auto-detecting
 * the target folder path from the server's folder list.
 *
 * @param config - IMAP account credentials
 * @param fromFolder - Source folder path
 * @param uid - Message UID
 * @param type - Target special-use role ("trash" or "spam")
 * @returns The resolved target path and the new UID (if reported)
 */
export async function moveMessageToSpecialFolder(
  config: ImapAccountConfig,
  fromFolder: string,
  uid: bigint,
  type: "trash" | "spam",
): Promise<{ path: string; newUid: bigint | null }> {
  const folders = await listImapFolders(config);
  const target = folders.find((folder) => folder.specialUse === type);
  if (!target) {
    throw new Error(`No ${type} folder found on IMAP server`);
  }
  const newUid = await moveMessageDirect(config, fromFolder, uid, target.path);
  return { path: target.path, newUid };
}

/**
 * Resolve the path of a special-use folder (trash/spam).
 * Uses a single IMAP connection via listImapFolders.
 */
export async function resolveSpecialFolderPath(
  config: ImapAccountConfig,
  type: "trash" | "spam",
): Promise<string> {
  const folders = await listImapFolders(config);
  const target = folders.find((folder) => folder.specialUse === type);
  if (!target) throw new Error(`No ${type} folder found on IMAP server`);
  return target.path;
}

/** Result of a bulk move operation: successfully moved UIDs and per-message failures. */
export type BulkMoveResult = {
  moved: bigint[];
  failed: Array<{ uid: bigint; fromFolder: string; error: string }>;
};

/**
 * Move multiple messages to a target folder using a SINGLE IMAP connection.
 * Groups messages by source folder and executes one MOVE command per group.
 */
export async function bulkMoveMessages(
  config: ImapAccountConfig,
  messages: Array<{ uid: bigint; fromFolder: string }>,
  targetFolder: string,
): Promise<BulkMoveResult> {
  const result: BulkMoveResult = { moved: [], failed: [] };
  if (messages.length === 0) return result;

  const client = buildClient(config);
  try {
    await client.connect();

    // Group messages by source folder to minimize mailbox-open calls
    const byFolder = new Map<string, bigint[]>();
    for (const msg of messages) {
      const list = byFolder.get(msg.fromFolder) ?? [];
      list.push(msg.uid);
      byFolder.set(msg.fromFolder, list);
    }

    for (const [fromFolder, uids] of byFolder) {
      try {
        await client.mailboxOpen(fromFolder);
        const uidList = uids.map((u) => u.toString()).join(",");
        await client.messageMove(uidList, targetFolder, { uid: true });
        result.moved.push(...uids);
      } catch (err) {
        const reason = err instanceof Error ? err.message : "IMAP move failed";
        for (const uid of uids) {
          result.failed.push({ uid, fromFolder, error: reason });
        }
      }
    }
  } finally {
    if (client.usable) await client.logout();
  }
  return result;
}

/** Parsed message body content: plain text, raw HTML, and HTML-converted-to-text fallback. */
export type ImapMessageBody = {
  text: string;
  html: string;
  /** Plain-text derived from HTML (used when no text/plain part exists). */
  textFromHtml: string;
};

/**
 * Fetch and parse the full body (text + HTML) of a single message by UID.
 * Uses a two-pass strategy: first tries fetching the raw source via FETCH,
 * then falls back to ImapFlow's download() if the source wasn't available.
 *
 * @param config - IMAP account credentials
 * @param folderPath - Folder containing the message
 * @param uid - Message UID
 * @returns Parsed body with text, html, and textFromHtml fields
 */
export async function fetchMessageBody(
  config: ImapAccountConfig,
  folderPath: string,
  uid: bigint,
): Promise<ImapMessageBody> {
  const client = buildClient(config);
  try {
    await client.connect();
    await client.mailboxOpen(folderPath);

    // Try fetching source by UID
    for await (const msg of client.fetch(
      uid.toString(),
      { uid: true, source: true } as never,
      { uid: true } as never,
    )) {
      const raw = msg as unknown as Record<string, unknown>;
      const source = await readBinaryPayload(raw.source);
      if (source && source.length > 0) {
        const parsed = await parseMailSource(source);
        return {
          text: parsed.text,
          html: parsed.html,
          textFromHtml: parsed.text || htmlToPlainText(parsed.html),
        };
      }
    }

    // Fallback: download() full message
    try {
      const downloaded = await client.download(uid.toString(), undefined, { uid: true });
      const dlAny = downloaded as unknown as Record<string, unknown>;
      const contentStream = dlAny?.content;
      if (contentStream) {
        const buf = await readBinaryPayload(contentStream);
        if (buf && buf.length > 0) {
          const parsed = await parseMailSource(buf);
          return {
            text: parsed.text,
            html: parsed.html,
            textFromHtml: parsed.text || htmlToPlainText(parsed.html),
          };
        }
      }
    } catch {
      // download fallback failed
    }

    console.warn(`[fetchMessageBody] UID ${uid} not found in ${folderPath}`);
    return { text: "", html: "", textFromHtml: "" };
  } finally {
    if (client.usable) {
      await client.logout();
    }
  }
}

/**
 * Look up a message's UID by its Message-ID header value.
 * Tries both bare and angle-bracketed forms to handle server variations.
 *
 * @param config - IMAP account credentials
 * @param folderPath - Folder to search in
 * @param messageId - RFC 2822 Message-ID (with or without angle brackets)
 * @returns The UID if found, null otherwise
 */
export async function resolveUidByMessageId(
  config: ImapAccountConfig,
  folderPath: string,
  messageId: string,
): Promise<bigint | null> {
  const client = buildClient(config);
  try {
    await client.connect();
    await client.mailboxOpen(folderPath);

    // Strip angle brackets for a normalized search, then retry with brackets if needed
    const cleanId = messageId.replace(/^<|>$/g, "");
    const results = await client.search(
      { header: { "message-id": cleanId } } as never,
      { uid: true } as never,
    );

    if (!results || (Array.isArray(results) && results.length === 0)) {
      const bracketedResults = await client.search(
        { header: { "message-id": `<${cleanId}>` } } as never,
        { uid: true } as never,
      );
      if (bracketedResults && Array.isArray(bracketedResults) && bracketedResults.length > 0) {
        return BigInt(bracketedResults[0]);
      }
      return null;
    }

    if (Array.isArray(results) && results.length > 0) {
      return BigInt(results[0]);
    }
    return null;
  } catch (e) {
    console.warn(`[resolveUidByMessageId] search failed for "${messageId}":`, e);
    return null;
  } finally {
    if (client.usable) {
      await client.logout();
    }
  }
}

/**
 * Search for a message UID by subject and approximate date.
 * First tries an exact date match, then widens to a ±1 day window as fallback.
 * Returns the latest matching UID (highest sequence number).
 *
 * @param config - IMAP account credentials
 * @param folderPath - Folder to search in
 * @param subject - Subject text to match (truncated to 80 chars for SEARCH)
 * @param date - Approximate send date
 * @returns The UID if found, null otherwise
 */
export async function searchUidBySubjectDate(
  config: ImapAccountConfig,
  folderPath: string,
  subject: string,
  date: Date,
): Promise<bigint | null> {
  const client = buildClient(config);
  try {
    await client.connect();
    await client.mailboxOpen(folderPath);

    const onDate = new Date(date);
    onDate.setHours(0, 0, 0, 0);

    const results = await client.search(
      { on: onDate, subject: subject.slice(0, 80) } as never,
      { uid: true } as never,
    );

    if (Array.isArray(results) && results.length > 0) {
      return BigInt(results[results.length - 1]);
    }

    // Widen the search window: 1 day before to 2 days after to account for timezone drift
    const before = new Date(onDate);
    before.setDate(before.getDate() + 2);
    const after = new Date(onDate);
    after.setDate(after.getDate() - 1);

    const widerResults = await client.search(
      { since: after, before, subject: subject.slice(0, 40) } as never,
      { uid: true } as never,
    );

    if (Array.isArray(widerResults) && widerResults.length > 0) {
      return BigInt(widerResults[widerResults.length - 1]);
    }

    return null;
  } catch (e) {
    console.warn(`[searchUidBySubjectDate] failed:`, e);
    return null;
  } finally {
    if (client.usable) {
      await client.logout();
    }
  }
}

/**
 * Download a single attachment part (by IMAP part ID) as a raw Buffer.
 * Handles various runtime return shapes from ImapFlow (stream, buffer, async iterable).
 *
 * @param config - IMAP account credentials
 * @param folderPath - Folder containing the message
 * @param uid - Message UID
 * @param partId - IMAP BODYSTRUCTURE part identifier (e.g. "1.2")
 * @returns Raw attachment data as a Buffer
 * @throws If the attachment stream cannot be read
 */
export async function downloadAttachmentPart(
  config: ImapAccountConfig,
  folderPath: string,
  uid: bigint,
  partId: string,
): Promise<Buffer> {
  const client = buildClient(config);
  try {
    await client.connect();
    await client.mailboxOpen(folderPath);
    const downloaded = (await client.download(uid.toString(), partId, { uid: true })) as unknown;

    // ImapFlow may return the data directly or wrapped in an object with
    // content/source/stream/body/payload fields depending on version and part type.
    const direct = await readBinaryPayload(downloaded);
    if (direct) {
      return direct;
    }

    if (downloaded && typeof downloaded === "object") {
      const candidate = downloaded as {
        content?: unknown;
        source?: unknown;
        stream?: unknown;
        body?: unknown;
        payload?: unknown;
      };
      const payloads = [
        candidate.content,
        candidate.source,
        candidate.stream,
        candidate.body,
        candidate.payload,
      ];
      for (const payload of payloads) {
        const buffer = await readBinaryPayload(payload);
        if (buffer) return buffer;
      }
    }

    throw new Error("Unable to read attachment stream from IMAP");
  } finally {
    if (client.usable) {
      await client.logout();
    }
  }
}
