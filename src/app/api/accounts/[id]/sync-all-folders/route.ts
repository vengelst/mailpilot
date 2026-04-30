import { NextRequest } from "next/server";
import { z } from "zod";
import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import { writeAuditLog } from "@/server/audit/auditLog";
import { prisma } from "@/server/db/prisma";
import {
  syncFolderEmailsIncremental,
  syncFolders,
  SyncBusyError,
} from "@/server/imap/imapService";
import { runSpamCheckJob } from "@/server/automation/spamCheckJob";
import { runBlockedSenderJob } from "@/server/automation/blockedSenderJob";
import { runRulesEngineBatchJob } from "@/server/automation/rulesEngineJob";
import { getOrCreateAutomationSettings } from "@/server/automation/settings";

/**
 * Header-only sync across the whole IMAP folder tree.
 *
 *   - Lists every folder + subfolder via `syncFolders` (this also refreshes
 *     the local `MailFolder` rows and counts).
 *   - Runs `syncFolderEmailsIncremental` per folder.
 *   - Bodies are NOT fetched here — body cache is filled lazily on email open
 *     or AI analysis.
 *
 * Skips folders that throw SyncBusyError (another sync already running for
 * that folder) so a stuck folder does not block the whole batch.
 */
const schema = z.object({
  mode: z.enum(["incremental", "full"]).optional(),
});

async function resolveId(params: Promise<{ id: string }> | { id: string }) {
  return (await Promise.resolve(params)).id;
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  let accountId: string | null = null;
  try {
    accountId = await resolveId(context.params);
    const payload = schema.parse(await req.json().catch(() => ({})));
    const mode = payload.mode ?? "incremental";

    const account = await prisma.mailAccount.findFirst({
      where: { id: accountId, userId: session.userId },
      select: { id: true },
    });
    if (!account) return fail("Account not found", 404);

    await writeAuditLog({
      userId: session.userId,
      accountId,
      action: "sync.all_folders.started",
      actor: "user",
      afterJson: { accountId, mode },
    });

    const folders = await syncFolders(accountId, session.userId);

    let totalNew = 0;
    let totalFlagsUpdated = 0;
    let totalRemoved = 0;
    let totalSpamFlagged = 0;
    let totalSpamMoved = 0;
    let totalBlockedMatched = 0;
    let totalBlockedMoved = 0;
    let totalCheckedRules = 0;
    let totalAppliedRules = 0;
    const automationSettings = await getOrCreateAutomationSettings(session.userId);
    const perFolder: Array<{
      folderPath: string;
      newMails: number;
      flagsUpdated: number;
      removedFromIndex: number;
      uidValidityChanged: boolean;
      spamFlagged: number;
      spamMoved: number;
      blockedMatched: number;
      blockedMoved: number;
      checkedRules: number;
      appliedRules: number;
      skipped?: "busy" | "error";
      error?: string;
    }> = [];

    for (const folder of folders) {
      try {
        // sync-all-folders intentionally only does header-level incremental
        // even when mode === "full" — a true paged-fullsync per folder for
        // every folder would be too expensive for an "alle Ordner" click.
        // The dedicated single-folder Vollsync button covers that case.
        const result = await syncFolderEmailsIncremental(
          accountId,
          session.userId,
          folder.path,
        );
        const spamResult = await runSpamCheckJob({
          userId: session.userId,
          emailIds: result.emailIds,
        });
        const blockedResult = await runBlockedSenderJob({
          userId: session.userId,
          emailIds: result.emailIds,
        });
        const rulesResult = automationSettings.autoApplyUserRules
          ? await runRulesEngineBatchJob({
              userId: session.userId,
              emailIds: result.emailIds,
            })
          : { processedEmails: result.emailIds.length, checkedRules: 0, appliedRules: 0 };
        totalNew += result.newMails;
        totalFlagsUpdated += result.flagsUpdated;
        totalRemoved += result.removedFromIndex;
        totalSpamFlagged += spamResult.flagged;
        totalSpamMoved += spamResult.moved;
        totalBlockedMatched += blockedResult.matched;
        totalBlockedMoved += blockedResult.moved;
        totalCheckedRules += rulesResult.checkedRules;
        totalAppliedRules += rulesResult.appliedRules;
        perFolder.push({
          folderPath: folder.path,
          newMails: result.newMails,
          flagsUpdated: result.flagsUpdated,
          removedFromIndex: result.removedFromIndex,
          uidValidityChanged: result.uidValidityChanged,
          spamFlagged: spamResult.flagged,
          spamMoved: spamResult.moved,
          blockedMatched: blockedResult.matched,
          blockedMoved: blockedResult.moved,
          checkedRules: rulesResult.checkedRules,
          appliedRules: rulesResult.appliedRules,
        });
      } catch (error) {
        if (error instanceof SyncBusyError) {
          perFolder.push({
            folderPath: folder.path,
            newMails: 0,
            flagsUpdated: 0,
            removedFromIndex: 0,
            uidValidityChanged: false,
            spamFlagged: 0,
            spamMoved: 0,
            blockedMatched: 0,
            blockedMoved: 0,
            checkedRules: 0,
            appliedRules: 0,
            skipped: "busy",
          });
          continue;
        }
        const message = error instanceof Error ? error.message : "sync failed";
        perFolder.push({
          folderPath: folder.path,
          newMails: 0,
          flagsUpdated: 0,
          removedFromIndex: 0,
          uidValidityChanged: false,
          spamFlagged: 0,
          spamMoved: 0,
          blockedMatched: 0,
          blockedMoved: 0,
          checkedRules: 0,
          appliedRules: 0,
          skipped: "error",
          error: message.slice(0, 200),
        });
      }
    }

    await writeAuditLog({
      userId: session.userId,
      accountId,
      action: "sync.all_folders.finished",
      actor: "user",
      afterJson: {
        accountId,
        mode,
        folderCount: folders.length,
        totalNew,
        totalFlagsUpdated,
        totalRemoved,
        totalSpamFlagged,
        totalSpamMoved,
        totalBlockedMatched,
        totalBlockedMoved,
        totalCheckedRules,
        totalAppliedRules,
      },
    });

    return ok({
      accountId,
      folderCount: folders.length,
      totalNew,
      totalFlagsUpdated,
      totalRemoved,
      totalSpamFlagged,
      totalSpamMoved,
      totalBlockedMatched,
      totalBlockedMoved,
      totalCheckedRules,
      totalAppliedRules,
      perFolder,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed";
    if (accountId && session.userId) {
      await writeAuditLog({
        userId: session.userId,
        accountId,
        action: "sync.all_folders.failed",
        actor: "system",
        afterJson: { accountId, error: message.slice(0, 500) },
      });
    }
    return fail(message, 400);
  }
}
