/**
 * Automation Runner – Central orchestrator for MailPilot's automation pipeline.
 *
 * This module coordinates the execution of all automation jobs (sync, AI classification,
 * rules engine, blocked-sender filtering, spam checking, contact candidate extraction,
 * and attachment processing) either for a single resource or as a full pipeline across
 * all mail accounts. Every job is individually wrapped in audit logging and error isolation
 * so that a failure in one job does not abort the entire run.
 */

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

/** Describes the automation trigger: what type of job to run and the optional scope. */
type RunInput = {
  type: string;
  accountId?: string;
  emailId?: string;
};

/**
 * Writes a structured audit log entry for a single job lifecycle event.
 * Used internally to track start/finish/failure of each sub-job within a run.
 */
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

/**
 * Executes the automation pipeline for a given user.
 *
 * Depending on `input.type`, this either runs a single targeted job (sync, ai_classify,
 * rules) or the full multi-step pipeline across one or all mail accounts.
 *
 * The full pipeline sequence per account:
 *   1. Sync  →  2. AI Classification  →  3. Blocked Sender Check
 *   4. Spam Check  →  5. Rules Engine  →  6. Contact Candidates  →  7. Attachments
 *
 * Each job is wrapped in its own try/catch so failures are isolated and audited
 * without aborting subsequent jobs.
 *
 * @param userId - The ID of the user whose mailbox automation is being run.
 * @param input  - Describes what to run (type) and optional scope (accountId / emailId).
 * @returns The updated AutomationRun record with final status and aggregated results.
 */
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
      // Full pipeline: resolve target accounts (single or all user accounts)
      const accountIds = input.accountId
        ? [input.accountId]
        : (
            await prisma.mailAccount.findMany({
              where: { userId },
              select: { id: true },
            })
          ).map((a) => a.id);

      // Aggregated counters across all accounts for the run summary
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
        // --- Step 1: Sync emails from remote mailbox ---
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

        // Scope subsequent jobs to only the emails fetched in this sync
        const scopedEmailIds = syncResult.emailIds;

        // --- Step 2: AI classification (only if enabled in settings) ---
        if (settings.autoAnalyzeNewEmails) {
          await writeJobAudit({
            userId,
            runId: run.id,
            accountId,
            job: "aiClassificationJob",
            phase: "started",
          });
          try {
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
          } catch (aiError) {
            await writeJobAudit({
              userId,
              runId: run.id,
              accountId,
              job: "aiClassificationJob",
              phase: "failed",
              details: {
                error: aiError instanceof Error ? aiError.message : "AI classification failed",
              },
            });
          }
        }

        // --- Step 3: Blocked sender filtering ---
        await writeJobAudit({
          userId,
          runId: run.id,
          accountId,
          job: "blockedSenderJob",
          phase: "started",
        });
        try {
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
        } catch (e) {
          await writeJobAudit({
            userId,
            runId: run.id,
            accountId,
            job: "blockedSenderJob",
            phase: "failed",
            details: { error: e instanceof Error ? e.message : "Failed" },
          });
        }

        // --- Step 4: Spam detection and quarantine ---
        await writeJobAudit({
          userId,
          runId: run.id,
          accountId,
          job: "spamCheckJob",
          phase: "started",
        });
        try {
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
        } catch (e) {
          await writeJobAudit({
            userId,
            runId: run.id,
            accountId,
            job: "spamCheckJob",
            phase: "failed",
            details: { error: e instanceof Error ? e.message : "Failed" },
          });
        }

        // --- Step 5: User-defined rules engine (only if enabled) ---
        if (settings.autoApplyUserRules) {
          await writeJobAudit({
            userId,
            runId: run.id,
            accountId,
            job: "rulesEngineJob",
            phase: "started",
          });
          try {
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
          } catch (e) {
            await writeJobAudit({
              userId,
              runId: run.id,
              accountId,
              job: "rulesEngineJob",
              phase: "failed",
              details: { error: e instanceof Error ? e.message : "Failed" },
            });
          }
        }

        // --- Step 6: Extract potential new contacts ---
        await writeJobAudit({
          userId,
          runId: run.id,
          accountId,
          job: "contactCandidateJob",
          phase: "started",
        });
        try {
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
        } catch (e) {
          await writeJobAudit({
            userId,
            runId: run.id,
            accountId,
            job: "contactCandidateJob",
            phase: "failed",
            details: { error: e instanceof Error ? e.message : "Failed" },
          });
        }

        // --- Step 7: Queue attachment processing ---
        await writeJobAudit({
          userId,
          runId: run.id,
          accountId,
          job: "attachmentJob",
          phase: "started",
        });
        try {
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
        } catch (e) {
          await writeJobAudit({
            userId,
            runId: run.id,
            accountId,
            job: "attachmentJob",
            phase: "failed",
            details: { error: e instanceof Error ? e.message : "Failed" },
          });
        }
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
    // Top-level failure: an unrecoverable error escaped individual job isolation
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
