import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db/prisma";
import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import { writeAuditLog } from "@/server/audit/auditLog";

const updateSchema = z.object({
  email: z.string().email().optional(),
  domain: z.string().optional(),
  action: z.enum(["move_trash", "move_spam", "mark_newsletter", "ignore"]).optional(),
  note: z.string().max(500).optional(),
  active: z.boolean().optional(),
});

function normalizeDomain(domain?: string) {
  return domain?.trim().toLowerCase().replace(/^\.+/, "").replace(/\.+$/, "");
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
  const id = await resolveId(context.params);

  const existing = await prisma.blockedSender.findFirst({
    where: { id, userId: session.userId },
  });
  if (!existing) return fail("Entry not found", 404);

  try {
    const payload = updateSchema.parse(await req.json());
    const nextEmail = payload.email !== undefined ? payload.email.toLowerCase() : existing.email;
    const nextDomain =
      payload.domain !== undefined ? normalizeDomain(payload.domain) : existing.domain;

    if (!nextEmail && !nextDomain) {
      return fail("Either email or domain is required", 400);
    }

    const updated = await prisma.blockedSender.update({
      where: { id },
      data: {
        ...(payload.email !== undefined ? { email: nextEmail } : {}),
        ...(payload.domain !== undefined ? { domain: nextDomain } : {}),
        ...(payload.action !== undefined ? { action: payload.action } : {}),
        ...(payload.note !== undefined ? { note: payload.note } : {}),
        ...(payload.active !== undefined ? { active: payload.active } : {}),
      },
    });

    await writeAuditLog({
      userId: session.userId,
      action: "blocked_sender.updated",
      actor: "user",
      beforeJson: {
        blockedSenderId: existing.id,
        email: existing.email,
        domain: existing.domain,
        action: existing.action,
        active: existing.active,
      },
      afterJson: {
        blockedSenderId: updated.id,
        email: updated.email,
        domain: updated.domain,
        action: updated.action,
        active: updated.active,
      },
    });

    return ok({ entry: updated });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Update blocklist entry failed", 400);
  }
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);
  const id = await resolveId(context.params);

  const existing = await prisma.blockedSender.findFirst({
    where: { id, userId: session.userId },
  });
  if (!existing) return fail("Entry not found", 404);

  await prisma.blockedSender.delete({ where: { id } });
  await writeAuditLog({
    userId: session.userId,
    action: "blocked_sender.deleted",
    actor: "user",
    beforeJson: {
      blockedSenderId: existing.id,
      email: existing.email,
      domain: existing.domain,
      action: existing.action,
      active: existing.active,
    },
  });
  return ok({ ok: true });
}
