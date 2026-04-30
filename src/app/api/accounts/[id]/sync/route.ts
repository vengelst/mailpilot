import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import { runSyncJob } from "@/server/automation/syncJob";
import { writeAuditLog } from "@/server/audit/auditLog";
import { prisma } from "@/server/db/prisma";
import { FolderSyncResult, SyncBusyError } from "@/server/imap/imapService";
import { runSpamCheckJob } from "@/server/automation/spamCheckJob";
import { runBlockedSenderJob } from "@/server/automation/blockedSenderJob";
import { runRulesEngineBatchJob } from "@/server/automation/rulesEngineJob";
import { getOrCreateAutomationSettings } from "@/server/automation/settings";

const schema = z.object({
  folderPath: z.string().optional(),
  mode: z.enum(["incremental", "full"]).optional(),
});

async function resolveId(params: Promise<{ id: string }>) {
  return (await params).id;
}

function clientResultPayload(result: FolderSyncResult) {
  // Strip emailIds (potentially large) and surface only fields the UI needs.
  // All values here are JSON-safe (strings, numbers, booleans, nulls).
  return {
    accountId: result.accountId,
    folderPath: result.folderPath,
    mode: result.mode,
    synced: result.synced,
    newMails: result.newMails,
    flagsUpdated: result.flagsUpdated,
    removedFromIndex: result.removedFromIndex,
    uidValidityChanged: result.uidValidityChanged,
    oldUidValidity: result.oldUidValidity,
    newUidValidity: result.newUidValidity,
    lastSeenUid: result.lastSeenUid,
  };
}

function userFacingMessage(message: string) {
  if (/^Invalid `prisma\.|PrismaClient/.test(message)) {
    return "Sync fehlgeschlagen — interner Datenbankfehler. Details siehe Audit-Log.";
  }
  return message;
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  let accountId: string | null = null;
  let mode: "incremental" | "full" = "incremental";
  let folderPath: string | null = null;

  try {
    accountId = await resolveId(context.params);
    const payload = schema.parse(await req.json().catch(() => ({})));
    mode = payload.mode ?? "incremental";
    folderPath = payload.folderPath ?? null;

    const account = await prisma.mailAccount.findFirst({
      where: { id: accountId, userId: session.userId },
      select: { id: true },
    });
    if (!account) return fail("Account not found", 404);

    // sync.started is written from inside runSyncJob via the onTargetResolved
    // callback so that the audit always carries the *actually* synchronised
    // folder path, even when the client did not specify one and the server
    // defaulted to INBOX (or the first folder).
    const result = await runSyncJob(session.userId, accountId, payload.folderPath, {
      mode,
      onTargetResolved: async (resolvedFolder) => {
        await writeAuditLog({
          userId: session.userId,
          accountId,
          action: mode === "full" ? "sync.full.started" : "sync.started",
          actor: "user",
          afterJson: {
            accountId,
            requestedFolderPath: folderPath,
            folderPath: resolvedFolder,
            mode,
          },
        });
      },
    });

    const spamResult = await runSpamCheckJob({
      userId: session.userId,
      emailIds: result.emailIds,
    });
    const blockedResult = await runBlockedSenderJob({
      userId: session.userId,
      emailIds: result.emailIds,
    });
    const automationSettings = await getOrCreateAutomationSettings(session.userId);
    const rulesResult = automationSettings.autoApplyUserRules
      ? await runRulesEngineBatchJob({
          userId: session.userId,
          emailIds: result.emailIds,
        })
      : { processedEmails: result.emailIds.length, checkedRules: 0, appliedRules: 0 };

    await writeAuditLog({
      userId: session.userId,
      accountId,
      action: mode === "full" ? "sync.full.finished" : "sync.finished",
      actor: "user",
      afterJson: {
        ...clientResultPayload(result),
        spamFlagged: spamResult.flagged,
        spamMoved: spamResult.moved,
        blockedMatched: blockedResult.matched,
        blockedMoved: blockedResult.moved,
        checkedRules: rulesResult.checkedRules,
        appliedRules: rulesResult.appliedRules,
      },
    });

    return ok({
      ...clientResultPayload(result),
      spamFlagged: spamResult.flagged,
      spamMoved: spamResult.moved,
      blockedMatched: blockedResult.matched,
      blockedMoved: blockedResult.moved,
      checkedRules: rulesResult.checkedRules,
      appliedRules: rulesResult.appliedRules,
    });
  } catch (error) {
    if (error instanceof SyncBusyError) {
      if (accountId && session.userId) {
        await writeAuditLog({
          userId: session.userId,
          accountId,
          action: mode === "full" ? "sync.full.busy" : "sync.busy",
          actor: "system",
          afterJson: { accountId, folderPath, mode },
        });
      }
      return NextResponse.json(
        { error: "Sync läuft bereits für diesen Ordner. Bitte einen Moment warten." },
        { status: 409 },
      );
    }
    const message = error instanceof Error ? error.message : "Sync failed";
    if (message === "Mail account not found") return fail("Account not found", 404);
    if (accountId && session.userId) {
      await writeAuditLog({
        userId: session.userId,
        accountId,
        action: mode === "full" ? "sync.full.failed" : "sync.failed",
        actor: "system",
        afterJson: { accountId, folderPath, mode, error: message.slice(0, 500) },
      });
    }
    return fail(userFacingMessage(message), 400);
  }
}
