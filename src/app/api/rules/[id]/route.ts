import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import { ruleActionContainerSchema, ruleConditionSchema } from "@/server/rules/schemas";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  active: z.boolean().optional(),
  priority: z.number().int().optional(),
  conditionJson: z.unknown().optional(),
  actionJson: z.unknown().optional(),
});

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function resolveId(params: Promise<{ id: string }> | { id: string }) {
  return (await Promise.resolve(params)).id;
}

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);
  try {
    const id = await resolveId(context.params);
    const payload = updateSchema.parse(await req.json());
    const existing = await prisma.mailRule.findFirst({ where: { id, userId: session.userId } });
    if (!existing) return fail("Rule not found", 404);
    const updateData: Prisma.MailRuleUpdateInput = {};
    if (payload.name !== undefined) updateData.name = payload.name;
    if (payload.active !== undefined) updateData.active = payload.active;
    if (payload.priority !== undefined) updateData.priority = payload.priority;
    if (payload.conditionJson !== undefined) {
      updateData.conditionJson = toInputJson(ruleConditionSchema.parse(payload.conditionJson));
    }
    if (payload.actionJson !== undefined) {
      updateData.actionJson = toInputJson(ruleActionContainerSchema.parse(payload.actionJson));
    }

    const rule = await prisma.mailRule.update({
      where: { id },
      data: updateData,
    });
    return ok({ rule });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Update rule failed", 400);
  }
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);
  const id = await resolveId(context.params);
  const existing = await prisma.mailRule.findFirst({ where: { id, userId: session.userId } });
  if (!existing) return fail("Rule not found", 404);
  await prisma.mailRule.delete({ where: { id } });
  return ok({ ok: true });
}
