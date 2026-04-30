import { prisma } from "@/server/db/prisma";
import { runSyncJob } from "@/server/automation/syncJob";
import { runAiClassificationForEmail, runAiClassificationJob } from "@/server/automation/aiClassificationJob";
import { runRulesEngineBatchJob, runRulesEngineJob } from "@/server/automation/rulesEngineJob";
import { writeAuditLog } from "@/server/audit/auditLog";
import { runBlockedSenderJob } from "@/server/automation/blockedSenderJob";
import { runSpamCheckJob } from "@/server/automation/spamCheckJob";
import { runContactCandidateJob } from "@/server/automation/contactCandidateJob";
import { runAttachmentJob } from "@/server/automation/attachmentJob";
import { getOrCreateAutomationSettings } from "@/server/automation/settings";

type RunInput = {
  type: string;
  accountId?: string;
  emailId?: string;
};

async function writeJobAudit(input: {
  userId: string;
  runId: string;
  accountId?: string;
  emailId?: string;
  job: string;
  phase: "started" | "finished" | "failed";
  details?: unknown;
}) {
  await writeAuditLog({
    userId: input.userId,
    accountId: input.accountId ?? null,
    emailId: input.emailId ?? null,
    action: `automation.job.${input.job}.${input.phase}`,
    actor: "system",
    afterJson: {
      runId: input.runId,
      ...(input.details ? { details: input.details } : {}),
    },
  });
}

export async function runAutomationNow(userId: string, input: RunInput) {
  const settings = await getOrCreateAutomationSettings(userId);
  const run = await prisma.automationRun.create({
    data: {
      userId,
      type: input.type,
      status: "running",
      startedAt: new Date(),
    },
  });
  await writeAuditLog({
    userId,
    accountId: input.accountId ?? null,
    emailId: input.emailId ?? null,
    action: "automation.started",
    actor: "system",
    afterJson: { runId: run.id, type: input.type },
  });

  try {
    let result: unknown = {};
    if (input.type === "sync" && input.accountId) {
      await writeJobAudit({
        userId,
        runId: run.id,
        accountId: input.accountId,
        job: "syncJob",
        phase: "started",
      });
      const sync = await runSyncJob(userId, input.accountId);
      await writeJobAudit({
        userId,
        runId: run.id,
        accountId: input.accountId,
        job: "syncJob",
        phase: "finished",
        details: sync,
      });
      result = sync;
    } else if (input.type === "ai_classify" && input.emailId) {
      await writeJobAudit({
        userId,
        runId: run.id,
        emailId: input.emailId,
        job: "aiClassificationJob",
        phase: "started",
      });
      const ai = await runAiClassificationForEmail(input.emailId, userId);
      await writeJobAudit({
        userId,
        runId: run.id,
        emailId: input.emailId,
        job: "aiClassificationJob",
        phase: "finished",
        details: { analyzed: true },
      });
      result = ai;
    } else if (input.type === "rules" && input.emailId) {
      await writeJobAudit({
        userId,
        runId: run.id,
        emailId: input.emailId,
        job: "rulesEngineJob",
        phase: "started",
      });
      const rules = await runRulesEngineJob(userId, input.emailId);
      await writeJobAudit({
        userId,
        runId: run.id,
        emailId: input.emailId,
        job: "rulesEngineJob",
        phase: "finished",
        details: rules,
      });
      result = rules;
    } else {
      const accountIds = input.accountId
        ? [input.accountId]
        : (
            await prisma.mailAccount.findMany({
              where: { userId },
              select: { id: true },
            })
          ).map((a) => a.id);

      let synced = 0;
      let analyzed = 0;
      let checkedRules = 0;
      let appliedRules = 0;
      let blockedMatched = 0;
      let blockedMoved = 0;
      let spamFlagged = 0;
      let spamMoved = 0;
      let pendingCandidates = 0;
      let totalCandidates = 0;
      let queuedAttachments = 0;

      for (const accountId of accountIds) {
        await writeJobAudit({ userId, runId: run.id, accountId, job: "syncJob", phase: "started" });
        const syncResult = await runSyncJob(userId, accountId);
        synced += syncResult.synced;
        await writeJobAudit({
          userId,
          runId: run.id,
          accountId,
          job: "syncJob",
          phase: "finished",
          details: syncResult,
        });

        const scopedEmailIds = syncResult.emailIds;

        if (settings.autoAnalyzeNewEmails) {
          await writeJobAudit({
            userId,
            runId: run.id,
            accountId,
            job: "aiClassificationJob",
            phase: "started",
          });
          const aiResult = await runAiClassificationJob({
            userId,
            accountId,
            emailIds: scopedEmailIds,
          });
          analyzed += aiResult.analyzedCount;
          await writeJobAudit({
            userId,
            runId: run.id,
            accountId,
            job: "aiClassificationJob",
            phase: "finished",
            details: aiResult,
          });
        }

        await writeJobAudit({
          userId,
          runId: run.id,
          accountId,
          job: "blockedSenderJob",
          phase: "started",
        });
        const blockedResult = await runBlockedSenderJob({ userId, emailIds: scopedEmailIds });
        blockedMatched += blockedResult.matched;
        blockedMoved += blockedResult.moved;
        await writeJobAudit({
          userId,
          runId: run.id,
          accountId,
          job: "blockedSenderJob",
          phase: "finished",
          details: blockedResult,
        });

        await writeJobAudit({
          userId,
          runId: run.id,
          accountId,
          job: "spamCheckJob",
          phase: "started",
        });
        const spamResult = await runSpamCheckJob({
          userId,
          emailIds: scopedEmailIds,
          aiMinConfidenceForSpam: settings.aiMinConfidenceForSpam,
        });
        spamFlagged += spamResult.flagged;
        spamMoved += spamResult.moved;
        await writeJobAudit({
          userId,
          runId: run.id,
          accountId,
          job: "spamCheckJob",
          phase: "finished",
          details: spamResult,
        });

        if (settings.autoApplyUserRules) {
          await writeJobAudit({
            userId,
            runId: run.id,
            accountId,
            job: "rulesEngineJob",
            phase: "started",
          });
          const rulesResult = await runRulesEngineBatchJob({
            userId,
            emailIds: scopedEmailIds,
          });
          checkedRules += rulesResult.checkedRules;
          appliedRules += rulesResult.appliedRules;
          await writeJobAudit({
            userId,
            runId: run.id,
            accountId,
            job: "rulesEngineJob",
            phase: "finished",
            details: rulesResult,
          });
        }

        await writeJobAudit({
          userId,
          runId: run.id,
          accountId,
          job: "contactCandidateJob",
          phase: "started",
        });
        const candidatesResult = await runContactCandidateJob({
          userId,
          accountId,
          emailIds: scopedEmailIds,
        });
        pendingCandidates += candidatesResult.pendingCandidates;
        totalCandidates += candidatesResult.totalCandidates;
        await writeJobAudit({
          userId,
          runId: run.id,
          accountId,
          job: "contactCandidateJob",
          phase: "finished",
          details: candidatesResult,
        });

        await writeJobAudit({
          userId,
          runId: run.id,
          accountId,
          job: "attachmentJob",
          phase: "started",
        });
        const attachmentResult = await runAttachmentJob({
          userId,
          accountId,
          emailIds: scopedEmailIds,
          autoSaveAttachments: settings.autoSaveAttachments,
        });
        queuedAttachments += attachmentResult.queuedAttachments;
        await writeJobAudit({
          userId,
          runId: run.id,
          accountId,
          job: "attachmentJob",
          phase: "finished",
          details: attachmentResult,
        });
      }

      result = {
        accountCount: accountIds.length,
        synced,
        analyzed,
        checkedRules,
        appliedRules,
        blockedMatched,
        blockedMoved,
        spamFlagged,
        spamMoved,
        pendingCandidates,
        totalCandidates,
        queuedAttachments,
        autoApplyAiSuggestions: settings.autoApplyAiSuggestions,
      };
    }

    await writeAuditLog({
      userId,
      accountId: input.accountId ?? null,
      emailId: input.emailId ?? null,
      action: "automation.finished",
      actor: "system",
      afterJson: { runId: run.id, type: input.type, result },
    });

    return prisma.automationRun.update({
      where: { id: run.id },
      data: {
        status: "success",
        finishedAt: new Date(),
        resultJson: result as object,
      },
    });
  } catch (error) {
    await writeJobAudit({
      userId,
      runId: run.id,
      accountId: input.accountId,
      emailId: input.emailId,
      job: "runner",
      phase: "failed",
      details: {
        error: error instanceof Error ? error.message : "Unknown automation error",
      },
    });
    await writeAuditLog({
      userId,
      accountId: input.accountId ?? null,
      emailId: input.emailId ?? null,
      action: "automation.failed",
      actor: "system",
      afterJson: {
        runId: run.id,
        type: input.type,
        error: error instanceof Error ? error.message : "Unknown automation error",
      },
    });
    return prisma.automationRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        error: error instanceof Error ? error.message : "Unknown automation error",
      },
    });
  }
}
