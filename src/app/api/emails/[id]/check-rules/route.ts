import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import { prisma } from "@/server/db/prisma";
import { writeAuditLog } from "@/server/audit/auditLog";
import {
  evaluateRuleCondition,
  type RuleEmail,
} from "@/server/rules/rulesEngine";
import {
  ruleConditionSchema,
  ruleActionContainerSchema,
} from "@/server/rules/schemas";

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  try {
    const { id } = await context.params;

    const email = await prisma.emailIndex.findFirst({
      where: {
        id,
        account: { userId: session.userId },
      },
      select: {
        id: true,
        accountId: true,
        fromEmail: true,
        subject: true,
        hasAttachments: true,
        aiCategory: true,
        aiPriority: true,
        aiKeywords: true,
        labels: true,
        attachments: {
          select: { filename: true },
        },
      },
    });
    if (!email) return fail("Email not found", 404);

    const emailForRules: RuleEmail = {
      ...email,
      attachmentFilenames: email.attachments
        .map((a) => a.filename)
        .filter((f): f is string => !!f),
    };

    const rules = await prisma.mailRule.findMany({
      where: { userId: session.userId, active: true },
      orderBy: { priority: "asc" },
    });

    const labelRules = rules.filter((rule) => {
      const parsed = ruleActionContainerSchema.safeParse(rule.actionJson);
      if (!parsed.success) return false;
      return parsed.data.actions.some((a) => a.type === "add_label");
    });

    let checked = 0;
    const labelsAdded: string[] = [];

    for (const rule of labelRules) {
      const parsedCondition = ruleConditionSchema.safeParse(rule.conditionJson);
      const parsedAction = ruleActionContainerSchema.safeParse(rule.actionJson);
      if (!parsedCondition.success || !parsedAction.success) continue;

      checked++;
      const matched = evaluateRuleCondition(parsedCondition.data, emailForRules);
      if (!matched) continue;

      for (const action of parsedAction.data.actions) {
        if (action.type !== "add_label") continue;
        if (email.labels.includes(action.value)) continue;

        email.labels = [...email.labels, action.value];
        await prisma.emailIndex.update({
          where: { id: email.id },
          data: { labels: email.labels },
        });
        labelsAdded.push(action.value);
      }

      await writeAuditLog({
        userId: session.userId,
        accountId: email.accountId,
        emailId: email.id,
        action: "rule.check_on_open",
        actor: "rule",
        beforeJson: { ruleId: rule.id },
        afterJson: { labelsAdded },
      });

      if (parsedAction.data.stopAfterMatch) break;
    }

    return ok({ checked, labelsAdded });
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Check-rules failed",
      400,
    );
  }
}
