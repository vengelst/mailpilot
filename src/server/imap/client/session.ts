import type { ImapAccountConfig, ImapMessageMeta, ImapSession } from "../types";
import { buildClient } from "./buildClient";
import {
  SYNC_INDEX_FETCH,
  mapEnvelopeToMeta,
  toBigInt,
  type RawSyncFetchMessage,
} from "./helpers";

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
          SYNC_INDEX_FETCH as never,
          { uid: true } as never,
        )) {
          messages.push(mapEnvelopeToMeta(message as unknown as RawSyncFetchMessage));
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
      },
    };

    return await fn(session);
  } finally {
    // Gracefully close the TLS connection if still alive
    if (client.usable) await client.logout();
  }
}

