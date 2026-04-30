import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db/prisma";
import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import { writeAuditLog } from "@/server/audit/auditLog";

const schema = z.object({
  email: z.string().email().optional(),
  domain: z.string().optional(),
  action: z.enum(["move_trash", "move_spam", "mark_newsletter", "ignore"]),
  note: z.string().max(500).optional(),
  active: z.boolean().optional(),
});

function normalizeDomain(domain?: string) {
  return domain?.trim().toLowerCase().replace(/^\.+/, "").replace(/\.+$/, "");
}

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);
  const entries = await prisma.blockedSender.findMany({
    where: { userId: session.userId },
    orderBy: { createdAt: "desc" },
  });
  return ok({ entries });
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);
  try {
    const payload = schema.parse(await req.json());
    if (!payload.email && !payload.domain) {
      return fail("Either email or domain is required", 400);
    }

    const entry = await prisma.blockedSender.create({
      data: {
        userId: session.userId,
        email: payload.email?.toLowerCase(),
        domain: normalizeDomain(payload.domain),
        action: payload.action,
        note: payload.note,
        active: payload.active ?? true,
      },
    });
    await writeAuditLog({
      userId: session.userId,
      action: "blocked_sender.created",
      actor: "user",
      afterJson: {
        blockedSenderId: entry.id,
        email: entry.email,
        domain: entry.domain,
        action: entry.action,
        active: entry.active,
      },
    });
    return ok({ entry }, 201);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Create blocklist entry failed", 400);
  }
}
