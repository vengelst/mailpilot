import { simpleParser } from "mailparser";
import { Readable } from "node:stream";
import type { ImapAttachmentMeta, ImapMessageMeta } from "../types";

/**
 * Heuristically determine a folder's special-use role from its IMAP flags
 * and path name. Handles both standard RFC 6154 flags and common localized names.
 */
export function detectSpecialUse(path: string, flags: string[] = []) {
  const lower = path.toLowerCase();
  if (flags.includes("\\Inbox") || lower === "inbox") return "inbox";
  if (flags.includes("\\Sent") || lower.includes("sent")) return "sent";
  if (flags.includes("\\Trash") || lower.includes("trash") || lower.includes("papierkorb")) return "trash";
  if (flags.includes("\\Junk") || lower.includes("junk") || lower.includes("spam")) return "spam";
  if (flags.includes("\\Archive") || lower.includes("archive")) return "archive";
  return undefined;
}

/** Return the first non-empty string from a list of candidates. */
export function pickString(...candidates: unknown[]) {
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const trimmed = candidate.trim();
      if (trimmed) return trimmed;
    }
  }
  return undefined;
}

/** Return the first finite number from a list of candidates (coercing bigint/string). */
export function pickNumber(...candidates: unknown[]) {
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
export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

/**
 * Recursively walk the BODYSTRUCTURE tree and extract attachment metadata.
 * Distinguishes true attachments from inline text parts by checking
 * disposition, filename presence, and MIME type.
 */
export function collectAttachments(structure: unknown, output: ImapAttachmentMeta[] = []): ImapAttachmentMeta[] {
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
export async function parseMailSource(source?: Buffer) {
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

/** IMAP FETCH fields for index sync — no full MIME `source` (bodies load on open). */
export const SYNC_INDEX_FETCH = {
  uid: true,
  envelope: true,
  flags: true,
  size: true,
  bodyStructure: true,
} as const;

export type RawSyncFetchMessage = {
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
  bodyStructure?: unknown;
};

/**
 * Map envelope + BODYSTRUCTURE into index metadata without downloading the
 * full message source. Snippet falls back to subject until the body is opened.
 */
export function mapEnvelopeToMeta(raw: RawSyncFetchMessage): ImapMessageMeta {
  const attachments = collectAttachments(raw.bodyStructure);
  const envelope = raw.envelope;
  const subject = (envelope?.subject ?? "").trim();
  const snippet = subject.slice(0, 140);
  return {
    uid: BigInt(raw.uid),
    messageId: envelope?.messageId,
    subject: envelope?.subject,
    fromName: envelope?.from?.[0]?.name,
    fromEmail: envelope?.from?.[0]?.address,
    toEmails: envelope?.to?.map((x) => x.address || "").filter(Boolean) || [],
    ccEmails: envelope?.cc?.map((x) => x.address || "").filter(Boolean) || [],
    date: envelope?.date,
    snippet,
    textPreview: snippet,
    hasAttachments: attachments.length > 0,
    attachmentCount: attachments.length,
    flags: Array.from(raw.flags || []),
    size: Number(raw.size || 0),
    attachments,
  };
}

/** Crude HTML-to-plain-text conversion (strips tags, collapses whitespace). */
export function htmlToPlainText(html: string) {
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
export async function streamToBuffer(stream: Readable) {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** Consume an arbitrary async iterable (Buffer, Uint8Array, string chunks) into a Buffer. */
export async function asyncIterableToBuffer(input: AsyncIterable<unknown>) {
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
export async function webReadableStreamToBuffer(stream: ReadableStream<Uint8Array>) {
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
export async function readBinaryPayload(value: unknown): Promise<Buffer | null> {
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

/** Safely coerce an unknown value (bigint, number, or numeric string) to bigint. */
export function toBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string" && value) return BigInt(value);
  return BigInt(0);
}

