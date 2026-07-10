/**
 * IMAP Service Layer
 *
 * High-level orchestration between the IMAP protocol client (`imapClient`)
 * and the Prisma database layer. This module owns:
 *   - Account credential resolution and decryption
 *   - Folder CRUD (create, rename, copy, delete) with local DB bookkeeping
 *   - Incremental and full email synchronisation (envelope + flags + body cache)
 *   - Message operations: mark read/unread, move, bulk actions
 *   - Attachment download
 *   - Permanent purge of Trash/Spam folders (the only destructive IMAP path)
 *
 * All IMAP interactions go through `imapClient` helpers; this module never
 * opens raw TCP sockets itself.
 */

import { prisma } from "@/server/db/prisma";
import { decryptSecret } from "@/server/security/crypto";
import {
  type BulkMoveResult,
  bulkMoveMessages,
  copyImapFolderMessages,
  createImapFolder,
  deleteImapFolder,
  downloadAttachmentPart,
  fetchFlagsByUidRange,
  fetchFolderMessagesPaged,
  fetchMessageBody,
  fetchMessagesByUidRange,
  getMailboxStatus,
  type ImapAccountConfig,
  type ImapMessageMeta,
  type ImapSession,
  listImapFolders,
  moveMessage,
  moveMessageDirect,
  moveMessageToSpecialFolder,
  renameImapFolder,
  purgeFolderMessages,
  resolveSpecialFolderPath,
  resolveUidByMessageId,
  searchUidBySubjectDate,
  setMessageSeen,
  testImapConnection,
  withImapSession,
} from "@/server/imap/imapClient";

/**
 * Sync concurrency control.
 *
 * SCOPE — INTENTIONALLY SINGLE-PROCESS:
 * This guard prevents two simultaneous sync requests for the same
 * (accountId, folderPath) from clobbering each other within ONE Node.js
 * process. It is a deliberate MVP choice and matches the current production
 * topology (single `mailpilot-app` container behind Nginx, no horizontal
 * scaling).
 *
 * KNOWN LIMITATION:
 * If the deployment ever runs multiple replicas (PM2 cluster mode, multiple
 * containers behind a load balancer, blue/green during a deploy), this lock
 * is per-replica only and does NOT prevent two replicas from syncing the
 * same folder in parallel. In that case the consequences are bounded:
 *   - upserts are idempotent on `(accountId, folderPath, imapUid)`
 *   - flag refresh is convergent
 *   - UIDVALIDITY rebuild deletes only the local index for THAT folder
 *   - no IMAP-side mutation other than `messageMove`/`messageFlagsAdd`
 * so the worst case is wasted work, not data loss.
 *
 * UPGRADE PATH (when needed):
 * Replace `withSyncLock` body with PostgreSQL advisory locks, e.g.
 *   SELECT pg_try_advisory_lock(hashtext($1)::bigint);
 *   ...
 *   SELECT pg_advisory_unlock(hashtext($1)::bigint);
 * Hash key: `${accountId}::${folderPath}`. Held for the duration of the
 * transaction or session. No schema changes required.
 */
const activeSyncs = new Set<string>();
function syncLockKey(accountId: string, folderPath: string) {
  return `${accountId}\x00${folderPath}`;
}
export class SyncBusyError extends Error {
  constructor(accountId: string, folderPath: string) {
    super(`Sync already running for account ${accountId} folder ${folderPath}`);
    this.name = "SyncBusyError";
  }
}
async function withSyncLock<T>(
  accountId: string,
  folderPath: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = syncLockKey(accountId, folderPath);
  if (activeSyncs.has(key)) {
    throw new SyncBusyError(accountId, folderPath);
  }
  activeSyncs.add(key);
  try {
    return await fn();
  } finally {
    activeSyncs.delete(key);
  }
}

const BIG_ZERO = BigInt(0);
const BIG_ONE = BigInt(1);
const FULL_SYNC_BATCH_SIZE = 100;

/** Safely converts a nullable BigInt to a string for JSON-serializable results. */
function bigIntToString(value: bigint | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.toString();
}

/**
 * Resolves and decrypts the IMAP connection configuration for a mail account.
 *
 * @param accountId - The database ID of the mail account.
 * @param userId - The owning user's ID (used for access control).
 * @returns The raw account record and a ready-to-use IMAP config with decrypted password.
 * @throws If the account does not exist or does not belong to the user.
 */
export async function getAccountConfig(accountId: string, userId: string) {
  const account = await prisma.mailAccount.findFirst({
    where: { id: accountId, userId },
  });
  if (!account) {
    throw new Error("Mail account not found");
  }

  return {
    account,
    config: {
      host: account.imapHost,
      port: account.imapPort,
      secure: account.imapSecure,
      username: account.imapUsername,
      password: decryptSecret(account.encryptedImapPassword),
    },
  };
}

/**
 * Tests whether the IMAP server is reachable with the stored credentials.
 *
 * @param accountId - The database ID of the mail account.
 * @param userId - The owning user's ID.
 * @returns The connection test result from the low-level IMAP client.
 */
export async function testAccountConnection(accountId: string, userId: string) {
  const { config } = await getAccountConfig(accountId, userId);
  return testImapConnection(config);
}

/**
 * Synchronises the list of IMAP mailbox folders into the local database.
 *
 * Fetches the full folder tree from the IMAP server and upserts each entry
 * into `MailFolder`. This ensures local state reflects renames, new folders,
 * and flag changes without touching message data.
 *
 * @param accountId - The database ID of the mail account.
 * @param userId - The owning user's ID.
 * @returns The raw list of IMAP folders returned by the server.
 */
export async function syncFolders(accountId: string, userId: string) {
  const { config } = await getAccountConfig(accountId, userId);
  const folders = await listImapFolders(config);

  await Promise.all(
    folders.map((folder) =>
      prisma.mailFolder.upsert({
        where: {
          accountId_path: {
            accountId,
            path: folder.path,
          },
        },
        update: {
          displayName: folder.displayName,
          delimiter: folder.delimiter,
          flags: folder.flags,
        },
        create: {
          accountId,
          path: folder.path,
          displayName: folder.displayName,
          delimiter: folder.delimiter,
          flags: folder.flags,
        },
      }),
    ),
  );

  return folders;
}

/** Strips leading/trailing slashes and whitespace from a folder path. */
function normalizeFolderPath(value: string) {
  return value.trim().replace(/^\/+|\/+$/g, "");
}

/** Guards against destructive operations on system-protected folders (e.g. INBOX). */
async function assertFolderNotProtected(
  folderPath: string,
  kind: "delete" | "rename" | "copy",
) {
  const lower = folderPath.toLowerCase();
  const protectedPaths = new Set(["inbox"]);
  if (protectedPaths.has(lower)) {
    throw new Error(`Ordner "${folderPath}" ist geschützt und kann nicht per ${kind} geändert werden.`);
  }
}

/**
 * Creates a new IMAP folder on the server and syncs the folder list.
 *
 * @param input.accountId - The mail account ID.
 * @param input.userId - The owning user's ID.
 * @param input.folderPath - The desired folder path/name.
 * @returns The updated folder list after creation.
 * @throws If the folder name is empty.
 */
export async function createFolderForAccount(input: {
  accountId: string;
  userId: string;
  folderPath: string;
}) {
  const path = normalizeFolderPath(input.folderPath);
  if (!path) throw new Error("Ordnername darf nicht leer sein.");
  const { config } = await getAccountConfig(input.accountId, input.userId);
  await createImapFolder(config, path);
  return syncFolders(input.accountId, input.userId);
}

/**
 * Deletes an IMAP folder and removes all associated local index data.
 *
 * Protected folders (e.g. INBOX) cannot be deleted. After the IMAP deletion,
 * both the EmailIndex entries and the MailFolder row for this path are purged.
 *
 * @param input.accountId - The mail account ID.
 * @param input.userId - The owning user's ID.
 * @param input.folderPath - The folder to delete.
 * @returns The updated folder list after deletion.
 * @throws If the folder is protected or does not exist.
 */
export async function deleteFolderForAccount(input: {
  accountId: string;
  userId: string;
  folderPath: string;
}) {
  const path = normalizeFolderPath(input.folderPath);
  if (!path) throw new Error("Ordnername darf nicht leer sein.");
  await assertFolderNotProtected(path, "delete");
  const { config } = await getAccountConfig(input.accountId, input.userId);
  await deleteImapFolder(config, path);
  await prisma.emailIndex.deleteMany({ where: { accountId: input.accountId, folderPath: path } });
  await prisma.mailFolder.deleteMany({ where: { accountId: input.accountId, path } });
  return syncFolders(input.accountId, input.userId);
}

/**
 * Renames an IMAP folder and updates all local references (index + folder row).
 *
 * @param input.accountId - The mail account ID.
 * @param input.userId - The owning user's ID.
 * @param input.fromPath - The current folder path.
 * @param input.toPath - The desired new folder path.
 * @returns The updated folder list after renaming.
 * @throws If either path is empty or the source folder is protected.
 */
export async function renameFolderForAccount(input: {
  accountId: string;
  userId: string;
  fromPath: string;
  toPath: string;
}) {
  const fromPath = normalizeFolderPath(input.fromPath);
  const toPath = normalizeFolderPath(input.toPath);
  if (!fromPath || !toPath) throw new Error("Quell- und Zielordner sind erforderlich.");
  await assertFolderNotProtected(fromPath, "rename");
  const { config } = await getAccountConfig(input.accountId, input.userId);
  await renameImapFolder(config, fromPath, toPath);
  await prisma.emailIndex.updateMany({
    where: { accountId: input.accountId, folderPath: fromPath },
    data: { folderPath: toPath },
  });
  await prisma.mailFolder.updateMany({
    where: { accountId: input.accountId, path: fromPath },
    data: { path: toPath, displayName: toPath },
  });
  return syncFolders(input.accountId, input.userId);
}

/**
 * Copies all messages from one IMAP folder into a new target folder.
 *
 * Creates the target folder first, then performs a server-side COPY of all
 * messages. Finally syncs the folder list so the new folder appears locally.
 *
 * @param input.accountId - The mail account ID.
 * @param input.userId - The owning user's ID.
 * @param input.fromPath - The source folder to copy from.
 * @param input.toPath - The target folder to create and copy into.
 * @returns The updated folder list.
 * @throws If either path is empty or the source folder is protected.
 */
export async function copyFolderForAccount(input: {
  accountId: string;
  userId: string;
  fromPath: string;
  toPath: string;
}) {
  const fromPath = normalizeFolderPath(input.fromPath);
  const toPath = normalizeFolderPath(input.toPath);
  if (!fromPath || !toPath) throw new Error("Quell- und Zielordner sind erforderlich.");
  await assertFolderNotProtected(fromPath, "copy");
  const { config } = await getAccountConfig(input.accountId, input.userId);
  await createImapFolder(config, toPath);
  await copyImapFolderMessages(config, fromPath, toPath);
  return syncFolders(input.accountId, input.userId);
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

    // Rebuild attachments: delete-all + createMany avoids orphaned/stale rows
    await prisma.emailAttachment.deleteMany({
      where: { emailId: { in: batchIds } },
    });
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
 *  - otherwise fetches messages with UID > lastSeenUid (envelope + source)
 *  - refreshes flags for previously-known UIDs without re-downloading bodies
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

      // --- Flag refresh for previously-known messages ---
      let flagsUpdated = 0;
      let removedFromIndex = 0;
      if (lastSeenUid > BIG_ZERO) {
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

/**
 * Sets or removes the \Seen flag on an email via IMAP.
 *
 * @param emailId - The local EmailIndex row ID.
 * @param userId - The owning user's ID (access control).
 * @param seen - `true` to mark as read, `false` to mark as unread.
 * @throws If the email does not exist or does not belong to the user.
 */
export async function markEmailSeen(emailId: string, userId: string, seen: boolean) {
  const email = await prisma.emailIndex.findFirst({
    where: {
      id: emailId,
      account: { userId },
    },
    include: { account: true },
  });
  if (!email) throw new Error("Email not found");

  const { config } = await getAccountConfig(email.accountId, userId);
  await setMessageSeen(config, email.folderPath, email.imapUid, seen);
}

/**
 * Moves an email to a specific target folder using IMAP MOVE.
 *
 * @param emailId - The local EmailIndex row ID.
 * @param userId - The owning user's ID.
 * @param targetFolder - The IMAP folder path to move the message into.
 * @returns The new UID assigned by the destination folder, or null if unknown.
 * @throws If the email does not exist or does not belong to the user.
 */
export async function moveIndexedEmail(emailId: string, userId: string, targetFolder: string): Promise<bigint | null> {
  const email = await prisma.emailIndex.findFirst({
    where: { id: emailId, account: { userId } },
  });
  if (!email) throw new Error("Email not found");
  const { config } = await getAccountConfig(email.accountId, userId);
  const newUid = await moveMessageDirect(config, email.folderPath, email.imapUid, targetFolder);
  return newUid;
}

/**
 * Moves an email to a special-use folder (Trash or Spam) using IMAP.
 *
 * The target folder is resolved via the server's special-use attributes,
 * so it works regardless of the provider's naming convention.
 *
 * @param emailId - The local EmailIndex row ID.
 * @param userId - The owning user's ID.
 * @param target - Either "trash" or "spam".
 * @returns The resolved folder path and the new UID (if the server reports it).
 * @throws If the email does not exist or does not belong to the user.
 */
export async function moveIndexedEmailToSpecial(
  emailId: string,
  userId: string,
  target: "trash" | "spam" | "inbox",
): Promise<{ path: string; newUid: bigint | null }> {
  const email = await prisma.emailIndex.findFirst({
    where: { id: emailId, account: { userId } },
  });
  if (!email) throw new Error("Email not found");
  const { config } = await getAccountConfig(email.accountId, userId);
  return moveMessageToSpecialFolder(config, email.folderPath, email.imapUid, target);
}

/**
 * Body loader with EmailIndex-side cache.
 *
 *  - If `EmailIndex.bodyFetchedAt` is set and `force !== true`, return the
 *    cached `{ text, html, textFromHtml }` without touching IMAP.
 *  - Otherwise fetch from IMAP (`fetchMessageBody`), persist text/html/plain
 *    on the index row, and return the same shape.
 *
 * IMAP stays the source of truth; the cache is opportunistic. Pass
 * `{ force: true }` to bypass the cache (e.g. when the user explicitly
 * requests a refresh). NEVER touch IMAP messages — read-only fetch only.
 */
/**
 * Attempts to resolve the correct IMAP UID for a message whose stored UID
 * may have become stale (e.g. after server-side compaction or UIDVALIDITY
 * change that was missed).
 *
 * Strategy:
 *   1. Try matching by RFC-822 Message-ID header (most reliable).
 *   2. Fall back to SEARCH by subject + date (heuristic).
 *   3. Return null if neither method yields a result.
 *
 * @param config - Decrypted IMAP connection config.
 * @param email - The locally stored email metadata with potential UID.
 * @returns The resolved UID, or null if the message cannot be located.
 */
async function resolveCorrectUid(
  config: ImapAccountConfig,
  email: { messageId: string | null; folderPath: string; imapUid: bigint; subject?: string | null; date?: Date | null },
): Promise<bigint | null> {
  if (email.messageId) {
    const uid = await resolveUidByMessageId(config, email.folderPath, email.messageId);
    if (uid) return uid;
  }

  if (email.subject && email.date) {
    const uid = await searchUidBySubjectDate(config, email.folderPath, email.subject, email.date);
    if (uid) return uid;
  }

  return null;
}

/**
 * Loads the full message body (text, HTML, plain) for a given email.
 *
 * Implements a local cache: if the body was previously fetched and stored in
 * `EmailIndex.bodyFetchedAt`, the cached version is returned without IMAP access.
 * Pass `options.force` to bypass the cache and re-fetch from IMAP.
 *
 * If the initial fetch returns empty content (possibly due to a stale UID),
 * a UID re-resolution is attempted before giving up.
 *
 * @param emailId - The local EmailIndex row ID.
 * @param userId - The owning user's ID.
 * @param options.force - If true, always fetch from IMAP regardless of cache state.
 * @returns The body content (text, html, textFromHtml) and whether it was served from cache.
 * @throws If the email does not exist or does not belong to the user.
 */
export async function loadMessageBody(
  emailId: string,
  userId: string,
  options?: { force?: boolean },
) {
  const email = await prisma.emailIndex.findFirst({
    where: { id: emailId, account: { userId } },
    select: {
      id: true,
      accountId: true,
      folderPath: true,
      imapUid: true,
      messageId: true,
      subject: true,
      date: true,
      bodyText: true,
      bodyHtml: true,
      bodyPlain: true,
      bodyFetchedAt: true,
    },
  });
  if (!email) throw new Error("Email not found");

  // Cache hit: return stored body without IMAP round-trip
  const cachedEmpty = email.bodyFetchedAt && !email.bodyHtml && !email.bodyText;
  if (!options?.force && email.bodyFetchedAt && !cachedEmpty) {
    return {
      text: email.bodyText ?? "",
      html: email.bodyHtml ?? "",
      textFromHtml: email.bodyPlain ?? email.bodyText ?? "",
      cached: true,
    };
  }

  const { config } = await getAccountConfig(email.accountId, userId);

  let body = await fetchMessageBody(config, email.folderPath, email.imapUid);

  // Fallback: if body is empty, the stored UID may be stale — try to re-resolve
  if (!body.text && !body.html) {
    const resolvedUid = await resolveCorrectUid(config, email);
    if (resolvedUid && resolvedUid !== email.imapUid) {
      console.log(`[loadMessageBody] UID resolved: ${email.imapUid} → ${resolvedUid}`);
      try {
        await prisma.emailIndex.update({
          where: { id: email.id },
          data: { imapUid: resolvedUid },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        if (msg.includes("Unique constraint")) {
          await prisma.emailIndex.delete({ where: { id: email.id } });
          console.log(`[loadMessageBody] Deleted stale duplicate entry ${email.id}`);
        } else {
          throw e;
        }
      }
      body = await fetchMessageBody(config, email.folderPath, resolvedUid);
    }
  }

  await prisma.emailIndex.update({
    where: { id: email.id },
    data: {
      bodyText: body.text || null,
      bodyHtml: body.html || null,
      bodyPlain: body.textFromHtml || null,
      bodyFetchedAt: new Date(),
    },
  });
  return { ...body, cached: false };
}

/**
 * Downloads a specific attachment's binary content from IMAP.
 *
 * @param userId - The owning user's ID.
 * @param emailId - The local EmailIndex row ID.
 * @param attachmentId - The local EmailAttachment row ID.
 * @returns The email record, attachment metadata, and raw binary content.
 * @throws If the email, attachment, or IMAP part ID is not found.
 */
export async function loadAttachmentContent(
  userId: string,
  emailId: string,
  attachmentId: string,
) {
  const email = await prisma.emailIndex.findFirst({
    where: { id: emailId, account: { userId } },
    include: {
      attachments: true,
    },
  });
  if (!email) throw new Error("Email not found");

  const attachment = email.attachments.find((item) => item.id === attachmentId);
  if (!attachment) throw new Error("Attachment not found");
  if (!attachment.imapPartId) throw new Error("Attachment part not available on IMAP");

  const { config } = await getAccountConfig(email.accountId, userId);
  const content = await downloadAttachmentPart(config, email.folderPath, email.imapUid, attachment.imapPartId);

  return { email, attachment, content };
}

// ===========================================================================
// Bulk operations
// ===========================================================================

export type BulkAction =
  | "mark_read"
  | "mark_unread"
  | "move_trash"
  | "move_spam"
  | "move_folder";

export type BulkOutcome = {
  emailId: string;
  status: "executed" | "rejected" | "failed";
  reason?: string;
};

const BULK_MAX = 500;

/**
 * Apply one of a fixed whitelist of safe actions to a list of emails.
 *
 * Hard guarantees:
 *   - Caller is authenticated; every emailId is verified to belong to
 *     `userId` before any IMAP call.
 *   - `move_trash` / `move_spam` use IMAP MOVE — never EXPUNGE, never
 *     `\Deleted`. The mail still exists, just in a different folder.
 *   - `move_folder` requires that `targetFolder` exists for the account.
 *   - There is intentionally NO `delete` / `expunge` / `permanent_delete`
 *     action. Permanent removal lives in `emptyTrashOrSpamFolder` and is
 *     gated by an explicit confirm flow.
 */
export async function runBulkEmailAction(input: {
  userId: string;
  action: BulkAction;
  emailIds: string[];
  targetFolder?: string;
}): Promise<{ outcomes: BulkOutcome[] }> {
  if (input.emailIds.length === 0) return { outcomes: [] };
  if (input.emailIds.length > BULK_MAX) {
    throw new Error(
      `Bulk-Aktion auf max. ${BULK_MAX} Mails pro Aufruf begrenzt.`,
    );
  }
  if (input.action === "move_folder" && !input.targetFolder) {
    throw new Error("targetFolder fehlt für move_folder.");
  }

  const owned = await prisma.emailIndex.findMany({
    where: {
      id: { in: input.emailIds },
      account: { userId: input.userId },
    },
    select: {
      id: true,
      accountId: true,
      folderPath: true,
      imapUid: true,
      flags: true,
    },
  });
  const ownedById = new Map(owned.map((row) => [row.id, row]));

  const outcomes: BulkOutcome[] = [];
  // Group emails by accountId to batch credential lookups and IMAP sessions
  const byAccount = new Map<string, typeof owned>();
  for (const row of owned) {
    const list = byAccount.get(row.accountId) ?? [];
    list.push(row);
    byAccount.set(row.accountId, list);
  }
  // Reject emails not owned by this user before any IMAP interaction
  for (const id of input.emailIds) {
    if (!ownedById.has(id)) {
      outcomes.push({ emailId: id, status: "rejected", reason: "not owned by user" });
    }
  }

  for (const [accountId, rows] of byAccount) {
    const { config } = await getAccountConfig(accountId, input.userId);

    if (input.action === "move_trash" || input.action === "move_spam") {
      const specialType = input.action === "move_trash" ? "trash" as const : "spam" as const;
      try {
        const targetPath = await resolveSpecialFolderPath(config, specialType);
        const messages = rows.map((row) => ({ uid: row.imapUid, fromFolder: row.folderPath }));
        const moveResult = await bulkMoveMessages(config, messages, targetPath);

        const failedUids = new Set(moveResult.failed.map((f) => f.uid));

        const movedRows = rows.filter((r) => !failedUids.has(r.imapUid));
        if (movedRows.length > 0) {
          await prisma.emailIndex.updateMany({
            where: { id: { in: movedRows.map((r) => r.id) } },
            data: { folderPath: targetPath },
          });
        }

        for (const row of rows) {
          if (failedUids.has(row.imapUid)) {
            const failInfo = moveResult.failed.find((f) => f.uid === row.imapUid);
            outcomes.push({
              emailId: row.id,
              status: "failed",
              reason: (failInfo?.error ?? "IMAP move failed").slice(0, 200),
            });
          } else {
            outcomes.push({ emailId: row.id, status: "executed" });
          }
        }
      } catch (error) {
        for (const row of rows) {
          outcomes.push({
            emailId: row.id,
            status: "failed",
            reason: (error instanceof Error ? error.message : "action failed").slice(0, 200),
          });
        }
      }
    } else if (input.action === "move_folder") {
      const folders = await listImapFolders(config);
      const target = folders.find((f) => f.path === input.targetFolder);
      if (!target) {
        for (const row of rows) {
          outcomes.push({
            emailId: row.id,
            status: "rejected",
            reason: "Zielordner existiert nicht für diesen Account.",
          });
        }
        continue;
      }

      try {
        const messages = rows.map((row) => ({ uid: row.imapUid, fromFolder: row.folderPath }));
        const moveResult = await bulkMoveMessages(config, messages, input.targetFolder!);

        const failedUids = new Set(moveResult.failed.map((f) => f.uid));

        const movedRows = rows.filter((r) => !failedUids.has(r.imapUid));
        if (movedRows.length > 0) {
          await prisma.emailIndex.updateMany({
            where: { id: { in: movedRows.map((r) => r.id) } },
            data: { folderPath: input.targetFolder! },
          });
        }

        for (const row of rows) {
          if (failedUids.has(row.imapUid)) {
            const failInfo = moveResult.failed.find((f) => f.uid === row.imapUid);
            outcomes.push({
              emailId: row.id,
              status: "failed",
              reason: (failInfo?.error ?? "IMAP move failed").slice(0, 200),
            });
          } else {
            outcomes.push({ emailId: row.id, status: "executed" });
          }
        }
      } catch (error) {
        for (const row of rows) {
          outcomes.push({
            emailId: row.id,
            status: "failed",
            reason: (error instanceof Error ? error.message : "action failed").slice(0, 200),
          });
        }
      }
    } else {
      // mark_read / mark_unread — applied individually per message (IMAP flag ops are UID-scoped)
      for (const row of rows) {
        try {
          if (input.action === "mark_read") {
            await setMessageSeen(config, row.folderPath, row.imapUid, true);
            await prisma.emailIndex.update({
              where: { id: row.id },
              data: {
                flags: Array.from(new Set([...(row.flags ?? []), "\\Seen"])),
              },
            });
          } else if (input.action === "mark_unread") {
            await setMessageSeen(config, row.folderPath, row.imapUid, false);
            await prisma.emailIndex.update({
              where: { id: row.id },
              data: {
                flags: (row.flags ?? []).filter((f) => f !== "\\Seen"),
              },
            });
          }
          outcomes.push({ emailId: row.id, status: "executed" });
        } catch (error) {
          outcomes.push({
            emailId: row.id,
            status: "failed",
            reason: (error instanceof Error ? error.message : "action failed").slice(0, 200),
          });
        }
      }
    }
  }

  return { outcomes };
}

// ===========================================================================
// Empty Trash / Spam — the ONLY path that permanently deletes mails on IMAP
// ===========================================================================

const TRASH_PATH_PATTERNS = [
  /trash/i,
  /papierkorb/i,
  /deleted/i,
  /gel(ö|oe)scht/i,
  /\bbin\b/i,
];
const SPAM_PATH_PATTERNS = [/spam/i, /junk/i, /unerw(ü|ue)nscht/i, /werbung/i];
const TRASH_FLAGS = new Set(["\\Trash"]);
const SPAM_FLAGS = new Set(["\\Junk"]);

/**
 * Classifies a folder as "trash", "spam", or neither based on IMAP flags,
 * special-use attributes, and well-known path naming conventions (multilingual).
 */
function classifyFolderForPurge(
  folder: { path: string; flags?: string[] | null; specialUse?: string },
): "trash" | "spam" | null {
  const flags = folder.flags ?? [];
  const special = folder.specialUse ?? "";
  if (special === "trash" || flags.some((f) => TRASH_FLAGS.has(f))) return "trash";
  if (special === "spam" || flags.some((f) => SPAM_FLAGS.has(f))) return "spam";
  if (TRASH_PATH_PATTERNS.some((re) => re.test(folder.path))) return "trash";
  if (SPAM_PATH_PATTERNS.some((re) => re.test(folder.path))) return "spam";
  return null;
}

/**
 * Permanently delete every message in the given folder — but ONLY if the
 * folder unambiguously is the user's Trash or Spam mailbox. Used by the
 * dedicated `/api/folders/empty` endpoint after explicit user confirm.
 *
 * Throws if:
 *   - the account does not belong to the user
 *   - the folder does not exist on the IMAP server for this account
 *   - the folder is NOT classified as trash/spam — never EXPUNGE INBOX
 *
 * The actual `\Deleted` + EXPUNGE happens in `purgeFolderMessages` which
 * is the single place in the codebase allowed to do that.
 */
export async function emptyTrashOrSpamFolder(input: {
  accountId: string;
  userId: string;
  folderPath: string;
}): Promise<{ kind: "trash" | "spam"; deleted: number }> {
  const { config } = await getAccountConfig(input.accountId, input.userId);
  const folders = await listImapFolders(config);
  const folder = folders.find((f) => f.path === input.folderPath);
  if (!folder) {
    throw new Error("Ordner existiert nicht für diesen Account.");
  }
  const kind = classifyFolderForPurge({
    path: folder.path,
    flags: folder.flags,
    specialUse: folder.specialUse,
  });
  if (!kind) {
    throw new Error(
      "Endgültiges Leeren ist nur für Papierkorb- oder Spam-Ordner erlaubt.",
    );
  }

  const { deleted } = await purgeFolderMessages(config, folder.path);

  // Drop the local index for this folder — the rows now refer to mails that
  // no longer exist on the server.
  await prisma.emailIndex.deleteMany({
    where: { accountId: input.accountId, folderPath: folder.path },
  });
  // Reset the folder-level UID tracking so a follow-up sync starts clean.
  await prisma.mailFolder.updateMany({
    where: { accountId: input.accountId, path: folder.path },
    data: {
      lastSeenUid: BigInt(0),
      lastSyncedAt: new Date(),
      existsCount: 0,
    },
  });

  return { kind, deleted };
}
