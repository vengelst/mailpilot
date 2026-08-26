import { prisma } from "@/server/db/prisma";
import {
  bulkMoveMessages,
  listImapFolders,
  resolveSpecialFolderPath,
  setMessageSeen,
} from "@/server/imap/imapClient";
import { getAccountConfig } from "./account";

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

