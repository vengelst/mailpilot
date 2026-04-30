import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { Readable } from "node:stream";

export type ImapAccountConfig = {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
};

export type ImapFolderInfo = {
  path: string;
  displayName: string;
  delimiter?: string;
  flags?: string[];
  specialUse?: string;
};

export type ImapAttachmentMeta = {
  filename?: string;
  mimeType?: string;
  size?: number;
  partId?: string;
};

export type ImapMessageMeta = {
  uid: bigint;
  messageId?: string;
  subject?: string;
  fromName?: string;
  fromEmail?: string;
  toEmails: string[];
  ccEmails: string[];
  date?: Date;
  snippet?: string;
  textPreview?: string;
  hasAttachments: boolean;
  attachmentCount: number;
  flags: string[];
  size?: number;
  attachments: ImapAttachmentMeta[];
};

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

function detectSpecialUse(path: string, flags: string[] = []) {
  const lower = path.toLowerCase();
  if (flags.includes("\\Inbox") || lower === "inbox") return "inbox";
  if (flags.includes("\\Sent") || lower.includes("sent")) return "sent";
  if (flags.includes("\\Trash") || lower.includes("trash") || lower.includes("papierkorb")) return "trash";
  if (flags.includes("\\Junk") || lower.includes("junk") || lower.includes("spam")) return "spam";
  if (flags.includes("\\Archive") || lower.includes("archive")) return "archive";
  return undefined;
}

function pickString(...candidates: unknown[]) {
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const trimmed = candidate.trim();
      if (trimmed) return trimmed;
    }
  }
  return undefined;
}

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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

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

async function parseMailSource(source?: Buffer) {
  if (!source) return { text: "", html: "" };
  try {
    const parsed = await simpleParser(source);
    const text = (parsed.text ?? "").trim();
    const html = typeof parsed.html === "string" ? parsed.html : "";
    return { text, html };
  } catch {
    return { text: "", html: "" };
  }
}

function buildTextPreview(text: string, html: string) {
  const fallback = text || html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
  return fallback.replace(/\s+/g, " ").trim().slice(0, 240);
}

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

async function streamToBuffer(stream: Readable) {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

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

export type ImapMailboxStatus = {
  uidValidity: bigint;
  uidNext: bigint;
  exists: number;
};

function toBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string" && value) return BigInt(value);
  return BigInt(0);
}

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
  const start = Math.max(1, mailboxExists - maxMessages + 1);
  return fetchMessagesInRange(config, folderPath, `${start}:*`, false);
}

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

export async function moveMessage(
  config: ImapAccountConfig,
  fromFolder: string,
  uid: bigint,
  targetFolder: string,
) {
  const client = buildClient(config);
  try {
    await client.connect();
    const folders = await client.list();
    const exists = folders.some((f) => f.path.toLowerCase() === targetFolder.toLowerCase());
    if (!exists) {
      throw new Error(`Target folder '${targetFolder}' does not exist on IMAP server`);
    }
    await client.mailboxOpen(fromFolder);
    await client.messageMove(uid.toString(), targetFolder, { uid: true });
  } finally {
    if (client.usable) {
      await client.logout();
    }
  }
}

export async function moveMessageToSpecialFolder(
  config: ImapAccountConfig,
  fromFolder: string,
  uid: bigint,
  type: "trash" | "spam",
) {
  const folders = await listImapFolders(config);
  const target = folders.find((folder) => folder.specialUse === type);
  if (!target) {
    throw new Error(`No ${type} folder found on IMAP server`);
  }
  await moveMessage(config, fromFolder, uid, target.path);
  return target.path;
}

export type ImapMessageBody = {
  text: string;
  html: string;
  textFromHtml: string;
};

export async function fetchMessageBody(
  config: ImapAccountConfig,
  folderPath: string,
  uid: bigint,
): Promise<ImapMessageBody> {
  const client = buildClient(config);
  try {
    await client.connect();
    await client.mailboxOpen(folderPath);
    const message = (await client.fetchOne(
      uid.toString(),
      { source: true } as never,
      { uid: true } as never,
    )) as unknown as { source?: Buffer };

    const parsed = await parseMailSource(message?.source);
    return {
      text: parsed.text,
      html: parsed.html,
      textFromHtml: parsed.text || htmlToPlainText(parsed.html),
    };
  } finally {
    if (client.usable) {
      await client.logout();
    }
  }
}

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

    // Handle different runtime shapes from imapflow typings/runtime.
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
