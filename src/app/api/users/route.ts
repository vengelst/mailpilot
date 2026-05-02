import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db/prisma";
import { requireAdminUser } from "@/server/auth/service";
import { hashPassword } from "@/server/auth/password";
import { writeAuditLog } from "@/server/audit/auditLog";
import { fail, ok } from "@/lib/http";

const userSelect = {
  id: true,
  email: true,
  role: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      mailAccounts: true,
      drafts: true,
    },
  },
};

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(["administrator", "user"]).default("user"),
});

export async function GET() {
  const admin = await requireAdminUser();
  if (!admin) return fail("Forbidden", 403);

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: userSelect,
  });

  return ok({ users });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdminUser();
  if (!admin) return fail("Forbidden", 403);

  try {
    const payload = createSchema.parse(await req.json());
    const email = payload.email.trim().toLowerCase();
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword(payload.password),
        role: payload.role,
      },
      select: userSelect,
    });

    await writeAuditLog({
      userId: admin.id,
      action: "user.created",
      actor: "user",
      afterJson: { targetUserId: user.id, email: user.email, role: user.role },
    });

    return ok({ user }, 201);
  } catch (error) {
    const message =
      error instanceof Error && error.message.includes("Unique constraint")
        ? "Diese E-Mail-Adresse wird bereits verwendet."
        : error instanceof Error
          ? error.message
          : "Benutzer konnte nicht angelegt werden.";
    return fail(message, 400);
  }
}
