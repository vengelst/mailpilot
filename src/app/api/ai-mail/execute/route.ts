import { NextRequest } from "next/server";
import { z } from "zod";
import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import { prisma } from "@/server/db/prisma";
import { writeAuditLog } from "@/server/audit/auditLog";
import { aiMailPlanSchema, AiMailAction } from "@/server/ai/mailPlan";
import {
  markEmailSeen,
  moveIndexedEmail,
  moveIndexedEmailToSpecial,
  syncFolders,
} from "@/server/imap/imapService";
import { runAiClassificationForEmail } from "@/server/automation/aiClassificationJob";

const schema = z.object({
  accountId: z.string().min(1),
  plan: aiMailPlanSchema,
});

type ActionOutcome = {
  index: number;
  type: AiMailAction["type"];
  emailId: string;
  status: "executed" | "skipped" | "rejected" | "failed";
  reason?: string;
};

export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  try {
    const payload = schema.parse(await req.json());
    const { accountId, plan } = payload;

    const account = await prisma.mailAccount.findFirst({
      where: { id: accountId, userId: session.userId },
      select: { id: true },
    });
    if (!account) return fail("Account not found", 404);

    // Pull a fresh folder list and validate ownership of every emailId before
    // executing anything. The plan came back from the AI / round-tripped via
    // the client — never trust it without revalidating.
    const folders = await syncFolders(accountId, session.userId);
    const allowedFolders = new Set(folders.map((f) => f.path));

    const emailIds = Array.from(new Set(plan.actions.map((a) => a.emailId)));
    const ownedEmails = await prisma.emailIndex.findMany({
      where: {
        id: { in: emailIds },
        accountId,
        account: { userId: session.userId },
      },
      select: { id: true, folderPath: true },
    });
    const ownedById = new Map(ownedEmails.map((e) => [e.id, e]));

    await writeAuditLog({
      userId: session.userId,
      accountId,
      action: "ai.plan.execution.started",
      actor: "user",
      afterJson: {
        accountId,
        actionCount: plan.actions.length,
        summary: plan.summary.slice(0, 200),
      },
    });

    const outcomes: ActionOutcome[] = [];

    for (let i = 0; i < plan.actions.length; i++) {
      const action = plan.actions[i];
      const owned = ownedById.get(action.emailId);
      if (!owned) {
        outcomes.push({
          index: i,
          type: action.type,
          emailId: action.emailId,
          status: "rejected",
          reason: "email not in this account",
        });
        continue;
      }

      try {
        if (action.type === "categorize") {
          await prisma.emailIndex.update({
            where: { id: action.emailId },
            data: { aiCategory: action.category, aiAnalyzed: true },
          });
          outcomes.push({ index: i, type: action.type, emailId: action.emailId, status: "executed" });
        } else if (action.type === "move") {
          if (!allowedFolders.has(action.targetFolder)) {
            outcomes.push({
              index: i,
              type: action.type,
              emailId: action.emailId,
              status: "rejected",
              reason: `unknown folder: ${action.targetFolder}`,
            });
            continue;
          }
          await moveIndexedEmail(action.emailId, session.userId, action.targetFolder);
          await prisma.emailIndex.update({
            where: { id: action.emailId },
            data: { folderPath: action.targetFolder },
          });
          outcomes.push({ index: i, type: action.type, emailId: action.emailId, status: "executed" });
        } else if (action.type === "move_trash") {
          const target = await moveIndexedEmailToSpecial(action.emailId, session.userId, "trash");
          await prisma.emailIndex.update({
            where: { id: action.emailId },
            data: { folderPath: target },
          });
          outcomes.push({ index: i, type: action.type, emailId: action.emailId, status: "executed" });
        } else if (action.type === "move_spam") {
          const target = await moveIndexedEmailToSpecial(action.emailId, session.userId, "spam");
          await prisma.emailIndex.update({
            where: { id: action.emailId },
            data: { folderPath: target },
          });
          outcomes.push({ index: i, type: action.type, emailId: action.emailId, status: "executed" });
        } else if (action.type === "mark_read") {
          await markEmailSeen(action.emailId, session.userId, true);
          outcomes.push({ index: i, type: action.type, emailId: action.emailId, status: "executed" });
        } else if (action.type === "create_contact_candidate") {
          await runAiClassificationForEmail(action.emailId, session.userId);
          outcomes.push({ index: i, type: action.type, emailId: action.emailId, status: "executed" });
        }
      } catch (error) {
        outcomes.push({
          index: i,
          type: action.type,
          emailId: action.emailId,
          status: "failed",
          reason: (error instanceof Error ? error.message : "action failed").slice(0, 200),
        });
      }
    }

    await writeAuditLog({
      userId: session.userId,
      accountId,
      action: "ai.plan.execution.finished",
      actor: "user",
      afterJson: {
        accountId,
        outcomes: outcomes.map((o) => ({
          index: o.index,
          type: o.type,
          status: o.status,
          reason: o.reason,
        })),
      },
    });

    const executed = outcomes.filter((o) => o.status === "executed").length;
    const failed = outcomes.filter((o) => o.status === "failed").length;
    const rejected = outcomes.filter((o) => o.status === "rejected").length;

    return ok({
      executed,
      failed,
      rejected,
      total: outcomes.length,
      outcomes,
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Plan execution failed", 400);
  }
}
