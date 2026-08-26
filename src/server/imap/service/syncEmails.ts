import { prisma } from "@/server/db/prisma";
import {
  type ImapMessageMeta,
  withImapSession,
} from "@/server/imap/imapClient";
import { getAccountConfig } from "./account";
import { withSyncLock } from "./syncLock";

const BIG_ZERO = BigInt(0);
const BIG_ONE = BigInt(1);
const FULL_SYNC_BATCH_SIZE = 100;

/** Safely converts a nullable BigInt to a string for JSON-serializable results. */
function bigIntToString(value: bigint | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.toString();
}

/**
 * Persists fetched IMAP message metadata into the local EmailIndex.
 *
 * Processes messages in batches of 50 within a Prisma transaction to keep
 * memory usage bounded. For each batch, upserts envelope data and rebuilds
 * the attachment list (delete-all + createMany pattern avoids stale entries).
 *
 * @param accountId - The mail account these messages belong to.
 * @param folderPath - The IMAP folder path the messages live in.
 * @param messages - Array of IMAP message metadata to upsert.
 * @returns Array of database IDs for all upserted EmailIndex rows.
 */
async function upsertFetchedMessages(
  accountId: string,
  folderPath: string,
  messages: ImapMessageMeta[],
): Promise<string[]> {
  if (messages.length === 0) return [];

  const BATCH_SIZE = 50;
  const emailIds: string[] = [];

  // Process in batches of 50 to avoid oversized Prisma transactions
  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const batch = messages.slice(i, i + BATCH_SIZE);
    const results = await prisma.$transaction(
      batch.map((message) =>
        prisma.emailIndex.upsert({
          where: {
            accountId_folderPath_imapUid: {
              accountId,
              folderPath,
              imapUid: message.uid,
            },
          },
          update: {
            messageId: message.messageId,
            subject: message.subject,
            fromName: message.fromName,
            fromEmail: message.fromEmail,
            toEmails: message.toEmails,
            ccEmails: message.ccEmails,
            date: message.date,
            snippet: message.snippet,
            textPreview: message.textPreview,
            hasAttachments: message.hasAttachments,
            attachmentCount: message.attachmentCount,
            flags: message.flags,
            size: message.size,
          },
          create: {
            accountId,
            folderPath,
            imapUid: message.uid,
            messageId: message.messageId,
            subject: message.subject,
            fromName: message.fromName,
            fromEmail: message.fromEmail,
            toEmails: message.toEmails,
            ccEmails: message.ccEmails,
            date: message.date,
            snippet: message.snippet,
            textPreview: message.textPreview,
            hasAttachments: message.hasAttachments,
            attachmentCount: message.attachmentCount,
            flags: message.flags,
            size: message.size,
          },
          select: { id: true },
        }),
      ),
    );
    const batchIds = results.map((r) => r.id);
    emailIds.push(...batchIds);

    // Rebuild attachments only when BODYSTRUCTURE reported any — avoids
    // deleteMany/createMany on every flag/snippet-only upsert.
    const allAttachments = batch.flatMap((message, idx) =>
      message.attachments.map((att) => ({
        emailId: batchIds[idx],
        filename: att.filename ?? null,
        mimeType: att.mimeType ?? null,
        size: att.size ?? null,
        imapPartId: att.partId ?? null,
      })),
    );
    if (allAttachments.length > 0) {
      await prisma.emailAttachment.deleteMany({
        where: { emailId: { in: batchIds } },
      });
      await prisma.emailAttachment.createMany({ data: allAttachments });
    }
  }
  return emailIds;
}

/** Ensures a MailFolder row exists in the DB, creating a minimal stub if absent. */
async function getOrCreateFolderRow(accountId: string, folderPath: string) {
  return prisma.mailFolder.upsert({
    where: { accountId_path: { accountId, path: folderPath } },
    update: {},
    create: {
      accountId,
      path: folderPath,
      displayName: folderPath,
    },
  });
}

export type FolderSyncResult = {
  accountId: string;
  folderPath: string;
  mode: "incremental" | "full";
  synced: number;
  emailIds: string[];
  newMails: number;
  flagsUpdated: number;
  removedFromIndex: number;
  uidValidityChanged: boolean;
  oldUidValidity: string | null;
  newUidValidity: string | null;
  lastSeenUid: string;
};

/**
 * Real full re-index of the entire folder. Streams messages in batches via
 * `fetchFolderMessagesPaged` and upserts each batch so memory stays bounded.
 *
 * Used by the explicit "Vollsync" button and as the rebuild path after a
 * UIDVALIDITY change.
 *
 * Does NOT delete or expunge anything on IMAP. The DB-level deleteMany
 * elsewhere only ever touches the local index for the same (accountId, folderPath).
 */
export async function syncFolderEmailsFull(
  accountId: string,
  userId: string,
  folderPath: string,
): Promise<FolderSyncResult> {
  return withSyncLock(accountId, folderPath, async () => {
    const { config } = await getAccountConfig(accountId, userId);
    const folderRow = await getOrCreateFolderRow(accountId, folderPath);
    const oldUidValidity = folderRow.uidValidity;

    let totalUpserted = 0;
    let maxUid = BIG_ZERO;
    const emailIds: string[] = [];
    let uidValidity = BIG_ZERO;
    let exists = 0;

    await withImapSession(config, async (session) => {
      const status = await session.openMailbox(folderPath);
      uidValidity = status.uidValidity;
      exists = status.exists;

      const { totalFetched, maxUid: sessionMaxUid } = await session.fetchMessagesPaged(
        FULL_SYNC_BATCH_SIZE,
        async (batch) => {
          const ids = await upsertFetchedMessages(accountId, folderPath, batch);
          emailIds.push(...ids);
          totalUpserted += batch.length;
        },
      );
      totalUpserted = totalFetched;
      maxUid = sessionMaxUid;
    });

    await prisma.mailFolder.upsert({
      where: { accountId_path: { accountId, path: folderPath } },
      update: {
        uidValidity,
        lastSeenUid: maxUid,
        lastSyncedAt: new Date(),
        existsCount: exists,
      },
      create: {
        accountId,
        path: folderPath,
        displayName: folderPath,
        uidValidity,
        lastSeenUid: maxUid,
        lastSyncedAt: new Date(),
        existsCount: exists,
      },
    });

    return {
      accountId,
      folderPath,
      mode: "full",
      synced: totalUpserted,
      emailIds,
      newMails: totalUpserted,
      flagsUpdated: 0,
      removedFromIndex: 0,
      uidValidityChanged: false,
      oldUidValidity: bigIntToString(oldUidValidity),
      newUidValidity: bigIntToString(uidValidity),
      lastSeenUid: maxUid.toString(),
    };
  });
}

/**
 * Incremental sync:
 *  - detects UIDVALIDITY change → if changed, drops only the local index for
 *    THIS (accountId, folderPath) and re-runs a real full rebuild
 *  - otherwise fetches messages with UID > lastSeenUid (envelope + structure)
 *  - reconciles flags/index only when EXISTS drifted or dropped
 *  - removes EmailIndex entries whose UID is no longer reported by the server
 *    (this is a LOCAL index cleanup — not an IMAP delete or EXPUNGE)
 */
export async function syncFolderEmailsIncremental(
  accountId: string,
  userId: string,
  folderPath: string,
): Promise<FolderSyncResult> {
  return withSyncLock(accountId, folderPath, async () => {
    const { config } = await getAccountConfig(accountId, userId);
    const folderRow = await getOrCreateFolderRow(accountId, folderPath);

    return withImapSession(config, async (session) => {
      const status = await session.openMailbox(folderPath);

      const storedUidValidity = folderRow.uidValidity;
      const uidValidityChanged =
        storedUidValidity !== null && storedUidValidity !== status.uidValidity;

      // UIDVALIDITY changed: all stored UIDs are invalid — wipe and rebuild
      if (uidValidityChanged) {
        await prisma.emailIndex.deleteMany({ where: { accountId, folderPath } });
        await prisma.mailFolder.update({
          where: { id: folderRow.id },
          data: { uidValidity: status.uidValidity, lastSeenUid: BIG_ZERO },
        });

        let totalUpserted = 0;
        let maxUid = BIG_ZERO;
        const emailIds: string[] = [];
        const { totalFetched, maxUid: sessionMaxUid } = await session.fetchMessagesPaged(
          FULL_SYNC_BATCH_SIZE,
          async (batch) => {
            const ids = await upsertFetchedMessages(accountId, folderPath, batch);
            emailIds.push(...ids);
            totalUpserted += batch.length;
          },
        );
        totalUpserted = totalFetched;
        maxUid = sessionMaxUid;

        await prisma.mailFolder.update({
          where: { id: folderRow.id },
          data: {
            lastSeenUid: maxUid,
            lastSyncedAt: new Date(),
            existsCount: status.exists,
          },
        });

        return {
          accountId,
          folderPath,
          mode: "incremental" as const,
          synced: totalUpserted,
          emailIds,
          newMails: totalUpserted,
          flagsUpdated: 0,
          removedFromIndex: 0,
          uidValidityChanged: true,
          oldUidValidity: bigIntToString(storedUidValidity),
          newUidValidity: bigIntToString(status.uidValidity),
          lastSeenUid: maxUid.toString(),
        };
      }

      // Fetch only messages newer than our last checkpoint (UID > lastSeenUid)
      const lastSeenUid = folderRow.lastSeenUid;
      let newMessages: ImapMessageMeta[] = [];
      if (status.exists > 0) {
        const nextUid = lastSeenUid + BIG_ONE;
        const range = `${nextUid.toString()}:*`;
        newMessages = await session.fetchNewMessages(range);
        // IMAP "UID:*" may include lastSeenUid itself if no newer messages exist — filter it
        if (lastSeenUid > BIG_ZERO) {
          newMessages = newMessages.filter((m) => m.uid > lastSeenUid);
        }
      }
      const newEmailIds = await upsertFetchedMessages(accountId, folderPath, newMessages);

      // --- Flag / index reconcile (expensive: O(folder size)) ---
      // Skip when the mailbox size is unchanged and there are no new UIDs —
      // that covers the common idle Fast-Sync case. Reconcile when EXISTS
      // dropped (deletes/moves) or drifted without new UIDs.
      let flagsUpdated = 0;
      let removedFromIndex = 0;
      const storedExists = folderRow.existsCount ?? 0;
      const existsDropped = status.exists < storedExists;
      const unexplainedDrift =
        newMessages.length === 0 && status.exists !== storedExists;
      const needsFullFlagReconcile =
        lastSeenUid > BIG_ZERO && (existsDropped || unexplainedDrift);

      if (needsFullFlagReconcile) {
        // Fetch current flag state from IMAP for all UIDs up to lastSeenUid
        const flagRange = `1:${lastSeenUid.toString()}`;
        const flagSnapshots =
          status.exists > 0
            ? await session.fetchFlags(flagRange)
            : [];
        const serverUids = new Set<bigint>(flagSnapshots.map((entry) => entry.uid));

        const indexedRows = await prisma.emailIndex.findMany({
          where: {
            accountId,
            folderPath,
            imapUid: { lte: lastSeenUid },
          },
          select: { id: true, imapUid: true, flags: true },
        });
        const indexedByUid = new Map<bigint, (typeof indexedRows)[number]>(
          indexedRows.map((row) => [row.imapUid, row]),
        );

        // Detect flag differences by sorted comparison (order-insensitive)
        const flagUpdates: Array<{ id: string; flags: string[] }> = [];
        for (const snapshot of flagSnapshots) {
          const existing = indexedByUid.get(snapshot.uid);
          if (!existing) continue;
          const beforeSorted = [...existing.flags].sort();
          const afterSorted = [...snapshot.flags].sort();
          const same =
            beforeSorted.length === afterSorted.length &&
            beforeSorted.every((flag, i) => flag === afterSorted[i]);
          if (!same) {
            flagUpdates.push({ id: existing.id, flags: snapshot.flags });
          }
        }
        if (flagUpdates.length > 0) {
          await prisma.$transaction(
            flagUpdates.map(({ id, flags }) =>
              prisma.emailIndex.update({ where: { id }, data: { flags } }),
            ),
          );
          flagsUpdated = flagUpdates.length;
        }

        // Remove local index entries for UIDs that no longer exist on server
        // (e.g. messages permanently deleted or moved by another client)
        const goneIds = indexedRows
          .filter((row) => !serverUids.has(row.imapUid))
          .map((row) => row.id);
        if (goneIds.length > 0) {
          const deleted = await prisma.emailIndex.deleteMany({
            where: {
              accountId,
              folderPath,
              id: { in: goneIds },
            },
          });
          removedFromIndex = deleted.count;
        }
      }

      // Advance the high-water mark to the highest UID we've seen
      let nextLastSeenUid = lastSeenUid;
      for (const m of newMessages) {
        if (m.uid > nextLastSeenUid) nextLastSeenUid = m.uid;
      }
      await prisma.mailFolder.update({
        where: { id: folderRow.id },
        data: {
          uidValidity: status.uidValidity,
          lastSeenUid: nextLastSeenUid,
          lastSyncedAt: new Date(),
          existsCount: status.exists,
        },
      });

      return {
        accountId,
        folderPath,
        mode: "incremental" as const,
        synced: newMessages.length,
        emailIds: newEmailIds,
        newMails: newMessages.length,
        flagsUpdated,
        removedFromIndex,
        uidValidityChanged: false,
        oldUidValidity: bigIntToString(storedUidValidity),
        newUidValidity: bigIntToString(status.uidValidity),
        lastSeenUid: nextLastSeenUid.toString(),
      };
    });
  });
}

/**
 * Entry point for both modes. Default = incremental.
 *
 * NOTE: legacy `maxMessages` parameter is intentionally ignored — fullsync now
 * really means "full". Callers from the route/job pass it, but it has no
 * effect.
 */
export async function syncFolderEmails(
  accountId: string,
  userId: string,
  folderPath: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _maxMessages = 100,
  options?: { mode?: "incremental" | "full" },
): Promise<FolderSyncResult> {
  if (options?.mode === "full") {
    return syncFolderEmailsFull(accountId, userId, folderPath);
  }
  return syncFolderEmailsIncremental(accountId, userId, folderPath);
}

