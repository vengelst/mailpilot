import type { ImapAccountConfig, ImapMailboxStatus, ImapMessageMeta } from "../types";
import { buildClient } from "./buildClient";
import {
  SYNC_INDEX_FETCH,
  mapEnvelopeToMeta,
  toBigInt,
  type RawSyncFetchMessage,
} from "./helpers";

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
export async function fetchMessagesInRange(
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
      SYNC_INDEX_FETCH as never,
      { uid: useUid } as never,
    )) {
      messages.push(mapEnvelopeToMeta(message as unknown as RawSyncFetchMessage));
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
        SYNC_INDEX_FETCH as never,
        { uid: false } as never,
      )) {
        const meta = mapEnvelopeToMeta(message as unknown as RawSyncFetchMessage);
        if (meta.uid > maxUid) maxUid = meta.uid;
        batch.push(meta);
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

