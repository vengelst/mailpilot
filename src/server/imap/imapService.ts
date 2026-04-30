import { prisma } from "@/server/db/prisma";
import { decryptSecret } from "@/server/security/crypto";
import {
  downloadAttachmentPart,
  fetchFlagsByUidRange,
  fetchFolderMessagesPaged,
  fetchMessageBody,
  fetchMessagesByUidRange,
  getMailboxStatus,
  ImapMessageMeta,
  listImapFolders,
  moveMessage,
  moveMessageToSpecialFolder,
  purgeFolderMessages,
  setMessageSeen,
  testImapConnection,
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

function bigIntToString(value: bigint | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.toString();
}

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

export async function testAccountConnection(accountId: string, userId: string) {
  const { config } = await getAccountConfig(accountId, userId);
  return testImapConnection(config);
}

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

async function upsertFetchedMessages(
  accountId: string,
  folderPath: string,
  messages: ImapMessageMeta[],
): Promise<string[]> {
  const emailIds: string[] = [];
  for (const message of messages) {
    const saved = await prisma.emailIndex.upsert({
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
    });
    emailIds.push(saved.id);

    await prisma.emailAttachment.deleteMany({ where: { emailId: saved.id } });
    if (message.attachments.length > 0) {
      await prisma.emailAttachment.createMany({
        data: message.attachments.map((attachment) => ({
          emailId: saved.id,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          size: attachment.size,
          imapPartId: attachment.partId,
        })),
      });
    }
  }
  return emailIds;
}

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
    const status = await getMailboxStatus(config, folderPath);

    let totalUpserted = 0;
    let maxUid = BIG_ZERO;
    const emailIds: string[] = [];
    await fetchFolderMessagesPaged(
      config,
      folderPath,
      FULL_SYNC_BATCH_SIZE,
      async (batch) => {
        const ids = await upsertFetchedMessages(accountId, folderPath, batch);
        emailIds.push(...ids);
        for (const m of batch) if (m.uid > maxUid) maxUid = m.uid;
        totalUpserted += batch.length;
      },
    );

    await prisma.mailFolder.upsert({
      where: { accountId_path: { accountId, path: folderPath } },
      update: {
        uidValidity: status.uidValidity,
        lastSeenUid: maxUid,
        lastSyncedAt: new Date(),
        existsCount: status.exists,
      },
      create: {
        accountId,
        path: folderPath,
        displayName: folderPath,
        uidValidity: status.uidValidity,
        lastSeenUid: maxUid,
        lastSyncedAt: new Date(),
        existsCount: status.exists,
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
      newUidValidity: bigIntToString(status.uidValidity),
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
    const status = await getMailboxStatus(config, folderPath);

    const storedUidValidity = folderRow.uidValidity;
    const uidValidityChanged =
      storedUidValidity !== null && storedUidValidity !== status.uidValidity;

    if (uidValidityChanged) {
      await prisma.emailIndex.deleteMany({ where: { accountId, folderPath } });
      await prisma.mailFolder.update({
        where: { id: folderRow.id },
        data: { uidValidity: status.uidValidity, lastSeenUid: BIG_ZERO },
      });
      // Real full rebuild — paged, no 100-cap.
      // Run inline (lock is already held by this outer call; the inner
      // syncFolderEmailsFull would deadlock if it also tried to acquire). To
      // avoid that we replicate the full-rebuild logic here without re-locking.
      let totalUpserted = 0;
      let maxUid = BIG_ZERO;
      const emailIds: string[] = [];
      await fetchFolderMessagesPaged(
        config,
        folderPath,
        FULL_SYNC_BATCH_SIZE,
        async (batch) => {
          const ids = await upsertFetchedMessages(accountId, folderPath, batch);
          emailIds.push(...ids);
          for (const m of batch) if (m.uid > maxUid) maxUid = m.uid;
          totalUpserted += batch.length;
        },
      );
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
        mode: "incremental",
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

    const lastSeenUid = folderRow.lastSeenUid; // bigint
    let newMessages: ImapMessageMeta[] = [];
    if (status.exists > 0) {
      const nextUid = lastSeenUid + BIG_ONE;
      const range = `${nextUid.toString()}:*`;
      newMessages = await fetchMessagesByUidRange(config, folderPath, range);
      if (lastSeenUid > BIG_ZERO) {
        newMessages = newMessages.filter((m) => m.uid > lastSeenUid);
      }
    }
    const newEmailIds = await upsertFetchedMessages(accountId, folderPath, newMessages);

    let flagsUpdated = 0;
    let removedFromIndex = 0;
    if (lastSeenUid > BIG_ZERO && status.exists > 0) {
      // Flag-refresh range covers every UID we have seen so far (`1:lastSeenUid`).
      // PERFORMANCE NOTE: this is O(folder size) per incremental sync — the IMAP
      // server returns only flags + uid (no source bytes), so it is cheap on the
      // wire but can become noticeable on very large folders (>50k messages).
      // For MVP scope this is accepted. If it ever becomes a bottleneck the
      // mitigation is to time-box (e.g. only refresh flags for messages
      // modified since `lastSyncedAt` via CONDSTORE/MODSEQ if the server
      // advertises it) — that requires opt-in capability detection and is
      // explicitly out of scope here.
      const flagRange = `1:${lastSeenUid.toString()}`;
      const flagSnapshots = await fetchFlagsByUidRange(config, folderPath, flagRange);
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

      for (const snapshot of flagSnapshots) {
        const existing = indexedByUid.get(snapshot.uid);
        if (!existing) continue;
        const beforeSorted = [...existing.flags].sort();
        const afterSorted = [...snapshot.flags].sort();
        const same =
          beforeSorted.length === afterSorted.length &&
          beforeSorted.every((flag, i) => flag === afterSorted[i]);
        if (!same) {
          await prisma.emailIndex.update({
            where: { id: existing.id },
            data: { flags: snapshot.flags },
          });
          flagsUpdated += 1;
        }
      }

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
      mode: "incremental",
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

export async function moveIndexedEmail(emailId: string, userId: string, targetFolder: string) {
  const email = await prisma.emailIndex.findFirst({
    where: { id: emailId, account: { userId } },
  });
  if (!email) throw new Error("Email not found");
  const { config } = await getAccountConfig(email.accountId, userId);
  await moveMessage(config, email.folderPath, email.imapUid, targetFolder);
}

export async function moveIndexedEmailToSpecial(
  emailId: string,
  userId: string,
  target: "trash" | "spam",
) {
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
      bodyText: true,
      bodyHtml: true,
      bodyPlain: true,
      bodyFetchedAt: true,
    },
  });
  if (!email) throw new Error("Email not found");

  if (!options?.force && email.bodyFetchedAt) {
    return {
      text: email.bodyText ?? "",
      html: email.bodyHtml ?? "",
      textFromHtml: email.bodyPlain ?? email.bodyText ?? "",
      cached: true,
    };
  }

  const { config } = await getAccountConfig(email.accountId, userId);
  const body = await fetchMessageBody(config, email.folderPath, email.imapUid);
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
  // Group by accountId so we resolve account credentials once per account.
  const byAccount = new Map<string, typeof owned>();
  for (const row of owned) {
    const list = byAccount.get(row.accountId) ?? [];
    list.push(row);
    byAccount.set(row.accountId, list);
  }
  // emails that do not belong to this user → reject them up front
  for (const id of input.emailIds) {
    if (!ownedById.has(id)) {
      outcomes.push({ emailId: id, status: "rejected", reason: "not owned by user" });
    }
  }

  for (const [accountId, rows] of byAccount) {
    const { config } = await getAccountConfig(accountId, input.userId);

    if (input.action === "move_folder") {
      // Validate the target folder belongs to this account on IMAP.
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
    }

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
        } else if (input.action === "move_trash") {
          const target = await moveIndexedEmailToSpecial(row.id, input.userId, "trash");
          await prisma.emailIndex.update({
            where: { id: row.id },
            data: { folderPath: target },
          });
        } else if (input.action === "move_spam") {
          const target = await moveIndexedEmailToSpecial(row.id, input.userId, "spam");
          await prisma.emailIndex.update({
            where: { id: row.id },
            data: { folderPath: target },
          });
        } else if (input.action === "move_folder") {
          // Re-validation already happened above; ts also know targetFolder is set.
          await moveIndexedEmail(row.id, input.userId, input.targetFolder!);
          await prisma.emailIndex.update({
            where: { id: row.id },
            data: { folderPath: input.targetFolder! },
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
