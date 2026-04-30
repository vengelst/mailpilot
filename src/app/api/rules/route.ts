import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import { ruleActionContainerSchema, ruleConditionSchema } from "@/server/rules/schemas";

const createSchema = z.object({
  name: z.string().min(1),
  active: z.boolean().default(true),
  priority: z.number().int().default(100),
  conditionJson: z.unknown(),
  actionJson: z.unknown(),
});

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);
  const rules = await prisma.mailRule.findMany({
    where: { userId: session.userId },
    orderBy: { priority: "asc" },
  });
  return ok({ rules });
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);
  try {
    const payload = createSchema.parse(await req.json());
    const validCondition = ruleConditionSchema.parse(payload.conditionJson);
    const validAction = ruleActionContainerSchema.parse(payload.actionJson);
    const rule = await prisma.mailRule.create({
      data: {
        ...payload,
        userId: session.userId,
        conditionJson: toInputJson(validCondition),
        actionJson: toInputJson(validAction),
      },
    });
    return ok({ rule }, 201);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Create rule failed", 400);
  }
}
