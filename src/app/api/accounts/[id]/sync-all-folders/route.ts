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
import {
  finishSyncAllProgress,
  getSyncAllProgress,
  startSyncAllProgress,
  updateSyncAllProgress,
} from "@/server/automation/syncAllProgress";

/**
 * Header-only sync across the whole IMAP folder tree.
 *
 *   - Lists every folder + subfolder via `syncFolders` (this also refreshes
 *     the local `MailFolder` rows and counts).
 *   - Runs `syncFolderEmailsIncremental` per folder with limited concurrency.
 *   - Spam / blocklist / rules run only when a folder yielded new email IDs.
 *   - Bodies are NOT fetched here — body cache is filled lazily on email open
 *     or AI analysis.
 *
 * Skips folders that throw SyncBusyError (another sync already running for
 * that folder) so a stuck folder does not block the whole batch.
 */
const schema = z.object({
  mode: z.enum(["incremental", "full"]).optional(),
});

/** Parallel IMAP folder syncs — keeps latency down without flooding the server. */
const FOLDER_SYNC_CONCURRENCY = 3;

type FolderSyncRow = {
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
};

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function runWorker() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  const poolSize = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: poolSize }, () => runWorker()));
  return results;
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  let accountId: string | null = null;
  try {
    accountId = (await context.params).id;
    const payload = schema.parse(await req.json().catch(() => ({})));
    const mode = payload.mode ?? "incremental";
    const requestType = req.nextUrl.searchParams.get("request");

    const account = await prisma.mailAccount.findFirst({
      where: { id: accountId, userId: session.userId },
      select: { id: true },
    });
    if (!account) return fail("Account not found", 404);

    if (requestType === "progress") {
      const progress = getSyncAllProgress(session.userId, accountId);
      if (!progress) {
        return ok({ progress: null });
      }
      return ok({ progress });
    }

    await writeAuditLog({
      userId: session.userId,
      accountId,
      action: "sync.all_folders.started",
      actor: "user",
      afterJson: { accountId, mode },
    });

    startSyncAllProgress({
      userId: session.userId,
      accountId,
      mode,
      message: "Ordner werden geladen …",
    });

    const allFolders = await syncFolders(accountId, session.userId);
    const accountSettings = await prisma.mailAccount.findUnique({
      where: { id: accountId },
      select: { excludedFolders: true },
    });
    const excluded = new Set(
      (accountSettings?.excludedFolders ?? []).map((p: string) => p.toLowerCase()),
    );
    const folders = allFolders.filter((f) => !excluded.has(f.path.toLowerCase()));
    const folderRows = await prisma.mailFolder.findMany({
      where: { accountId },
      select: { path: true, existsCount: true },
    });
    const existsCountByPath = new Map<string, number>(
      folderRows.map((row) => [row.path, Math.max(0, row.existsCount ?? 0)]),
    );
    const folderEstimateByPath = new Map<string, number>(
      folders.map((folder) => [folder.path, existsCountByPath.get(folder.path) ?? 0]),
    );
    const totalMails = Array.from(folderEstimateByPath.values()).reduce(
      (sum, folderEstimate) => sum + folderEstimate,
      0,
    );
    let processedMailsEstimate = 0;
    let folderDone = 0;
    let progressChain: Promise<void> = Promise.resolve();
    const bumpProgress = (folderPath: string, folderEstimate: number) => {
      progressChain = progressChain.then(() => {
        folderDone += 1;
        processedMailsEstimate = Math.min(totalMails, processedMailsEstimate + folderEstimate);
        updateSyncAllProgress(session.userId, accountId!, {
          lastFolderPath: folderPath,
          folderDone,
          processedMails: processedMailsEstimate,
          remainingMails: Math.max(0, totalMails - processedMailsEstimate),
          message: `Synchronisiere ${folderPath}`,
        });
      });
      return progressChain;
    };
    updateSyncAllProgress(session.userId, accountId, {
      phase: "running",
      folderTotal: folders.length,
      folderDone: 0,
      totalMails,
      processedMails: 0,
      remainingMails: totalMails,
      isEstimate: true,
      message: "Synchronisation gestartet",
    });

    const automationSettings = await getOrCreateAutomationSettings(session.userId);
    const emptyJobs = {
      spamFlagged: 0,
      spamMoved: 0,
      blockedMatched: 0,
      blockedMoved: 0,
      checkedRules: 0,
      appliedRules: 0,
    };

    const perFolder = await mapPool(folders, FOLDER_SYNC_CONCURRENCY, async (folder) => {
      const folderEstimate = folderEstimateByPath.get(folder.path) ?? 0;
      let row: FolderSyncRow;
      try {
        // sync-all-folders intentionally only does header-level incremental
        // even when mode === "full" — a true paged-fullsync per folder for
        // every folder would be too expensive for an "alle Ordner" click.
        // The dedicated single-folder Vollsync button covers that case.
        const result = await syncFolderEmailsIncremental(
          accountId!,
          session.userId,
          folder.path,
        );

        let spamFlagged = 0;
        let spamMoved = 0;
        let blockedMatched = 0;
        let blockedMoved = 0;
        let checkedRules = 0;
        let appliedRules = 0;
        if (result.emailIds.length > 0) {
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
          spamFlagged = spamResult.flagged;
          spamMoved = spamResult.moved;
          blockedMatched = blockedResult.matched;
          blockedMoved = blockedResult.moved;
          checkedRules = rulesResult.checkedRules;
          appliedRules = rulesResult.appliedRules;
        }

        row = {
          folderPath: folder.path,
          newMails: result.newMails,
          flagsUpdated: result.flagsUpdated,
          removedFromIndex: result.removedFromIndex,
          uidValidityChanged: result.uidValidityChanged,
          spamFlagged,
          spamMoved,
          blockedMatched,
          blockedMoved,
          checkedRules,
          appliedRules,
        };
      } catch (error) {
        if (error instanceof SyncBusyError) {
          row = {
            folderPath: folder.path,
            newMails: 0,
            flagsUpdated: 0,
            removedFromIndex: 0,
            uidValidityChanged: false,
            ...emptyJobs,
            skipped: "busy",
          };
        } else {
          const message = error instanceof Error ? error.message : "sync failed";
          row = {
            folderPath: folder.path,
            newMails: 0,
            flagsUpdated: 0,
            removedFromIndex: 0,
            uidValidityChanged: false,
            ...emptyJobs,
            skipped: "error",
            error: message.slice(0, 200),
          };
        }
      }

      await bumpProgress(folder.path, folderEstimate);
      return row;
    });

    await progressChain;
    const totalNew = perFolder.reduce((sum, r) => sum + r.newMails, 0);
    const totalFlagsUpdated = perFolder.reduce((sum, r) => sum + r.flagsUpdated, 0);
    const totalRemoved = perFolder.reduce((sum, r) => sum + r.removedFromIndex, 0);
    const totalSpamFlagged = perFolder.reduce((sum, r) => sum + r.spamFlagged, 0);
    const totalSpamMoved = perFolder.reduce((sum, r) => sum + r.spamMoved, 0);
    const totalBlockedMatched = perFolder.reduce((sum, r) => sum + r.blockedMatched, 0);
    const totalBlockedMoved = perFolder.reduce((sum, r) => sum + r.blockedMoved, 0);
    const totalCheckedRules = perFolder.reduce((sum, r) => sum + r.checkedRules, 0);
    const totalAppliedRules = perFolder.reduce((sum, r) => sum + r.appliedRules, 0);

    await writeAuditLog({
      userId: session.userId,
      accountId,
      action: "sync.all_folders.finished",
      actor: "user",
      afterJson: {
        accountId,
        mode,
        folderCount: folders.length,
        concurrency: FOLDER_SYNC_CONCURRENCY,
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

    finishSyncAllProgress({
      userId: session.userId,
      accountId,
      phase: "finished",
      message: "Synchronisation abgeschlossen",
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
      finishSyncAllProgress({
        userId: session.userId,
        accountId,
        phase: "failed",
        message: "Synchronisation fehlgeschlagen",
        error: message.slice(0, 500),
      });
    }
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
