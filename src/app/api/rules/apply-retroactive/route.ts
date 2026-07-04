import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db/prisma";
import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import { writeAuditLog } from "@/server/audit/auditLog";
import {
  evaluateRuleCondition,
  type RuleEmail,
} from "@/server/rules/rulesEngine";
import {
  ruleConditionSchema,
  ruleActionContainerSchema,
} from "@/server/rules/schemas";

const bodySchema = z.object({
  ruleIds: z.array(z.string().min(1)).optional(),
});

const BATCH_SIZE = 500;

export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  try {
    const body = bodySchema.parse(await req.json());

    const ruleWhere: { userId: string; active: boolean; id?: { in: string[] } } = {
      userId: session.userId,
      active: true,
    };
    if (body.ruleIds && body.ruleIds.length > 0) {
      ruleWhere.id = { in: body.ruleIds };
    }

    const rules = await prisma.mailRule.findMany({
      where: ruleWhere,
      orderBy: { priority: "asc" },
    });

    const labelRules = rules.filter((rule) => {
      const parsed = ruleActionContainerSchema.safeParse(rule.actionJson);
      if (!parsed.success) return false;
      return parsed.data.actions.some((a) => a.type === "add_label");
    });

    if (labelRules.length === 0) {
      return ok({ processed: 0, matched: 0, labelsAdded: 0 });
    }

    const parsedRules = labelRules
      .map((rule) => {
        const cond = ruleConditionSchema.safeParse(rule.conditionJson);
        const act = ruleActionContainerSchema.safeParse(rule.actionJson);
        if (!cond.success || !act.success) return null;
        return { id: rule.id, condition: cond.data, actions: act.data };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    let processed = 0;
    let matched = 0;
    let labelsAdded = 0;
    let cursor: string | undefined;

    while (true) {
      const emails = await prisma.emailIndex.findMany({
        where: {
          account: { userId: session.userId },
          ...(cursor ? { id: { gt: cursor } } : {}),
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
        orderBy: { id: "asc" },
        take: BATCH_SIZE,
      });

      if (emails.length === 0) break;

      for (const email of emails) {
        processed++;
        const emailForRules: RuleEmail = {
          ...email,
          attachmentFilenames: email.attachments
            .map((a) => a.filename)
            .filter((f): f is string => !!f),
        };

        let emailMatched = false;
        let currentLabels = [...email.labels];

        for (const rule of parsedRules) {
          if (!evaluateRuleCondition(rule.condition, emailForRules)) continue;

          emailMatched = true;
          for (const action of rule.actions.actions) {
            if (action.type !== "add_label") continue;
            if (currentLabels.includes(action.value)) continue;
            currentLabels = [...currentLabels, action.value];
            labelsAdded++;
          }

          if (rule.actions.stopAfterMatch) break;
        }

        if (emailMatched) {
          matched++;
          if (currentLabels.length > email.labels.length) {
            await prisma.emailIndex.update({
              where: { id: email.id },
              data: { labels: currentLabels },
            });
          }
        }
      }

      cursor = emails[emails.length - 1]!.id;
      if (emails.length < BATCH_SIZE) break;
    }

    await writeAuditLog({
      userId: session.userId,
      accountId: "system",
      emailId: "bulk",
      action: "rule.retroactive_scan",
      actor: "user",
      beforeJson: { ruleIds: labelRules.map((r) => r.id) },
      afterJson: { processed, matched, labelsAdded },
    });

    return ok({ processed, matched, labelsAdded });
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Retroactive scan failed",
      400,
    );
  }
}
