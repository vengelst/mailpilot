import type { ImapAccountConfig, ImapMessageBody } from "../types";
import { buildClient } from "./buildClient";
import { htmlToPlainText, parseMailSource, readBinaryPayload } from "./helpers";

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
