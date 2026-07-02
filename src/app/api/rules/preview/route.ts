import { NextRequest } from "next/server";
import { prisma } from "@/server/db/prisma";
import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import { ruleConditionSchema } from "@/server/rules/schemas";
import { evaluateRuleCondition } from "@/server/rules/rulesEngine";

export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  try {
    const body = await req.json();
    const condition = ruleConditionSchema.parse(body.conditionJson);

    const emails = await prisma.emailIndex.findMany({
      where: { account: { userId: session.userId } },
      select: {
        id: true,
        subject: true,
        fromName: true,
        fromEmail: true,
        date: true,
        folderPath: true,
        hasAttachments: true,
        aiCategory: true,
        aiPriority: true,
        aiKeywords: true,
      },
      orderBy: { date: "desc" },
      take: 5000,
    });

    const matched: typeof emails = [];
    for (const email of emails) {
      if (evaluateRuleCondition(condition, email)) {
        matched.push(email);
      }
    }

    return ok({
      count: matched.length,
      sample: matched.slice(0, 10),
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Preview failed", 400);
  }
}
