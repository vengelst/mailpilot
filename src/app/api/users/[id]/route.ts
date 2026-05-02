import { z } from "zod";
import { prisma } from "@/server/db/prisma";
import { requireAdminUser } from "@/server/auth/service";
import { hashPassword } from "@/server/auth/password";
import { fail, ok } from "@/lib/http";

async function resolveId(params: Promise<{ id: string }> | { id: string }) {
  return (await Promise.resolve(params)).id;
}

const updateSchema = z.object({
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  role: z.enum(["administrator", "user"]).optional(),
});

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

async function isLastAdmin(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (user?.role !== "administrator") return false;
  const adminCount = await prisma.user.count({ where: { role: "administrator" } });
  return adminCount <= 1;
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const admin = await requireAdminUser();
  if (!admin) return fail("Forbidden", 403);

  const id = await resolveId(context.params);
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) return fail("Benutzer nicht gefunden.", 404);

  try {
    const payload = updateSchema.parse(await req.json());
    const data: Record<string, unknown> = {};
    if (payload.email !== undefined) data.email = payload.email.trim().toLowerCase();
    if (payload.password !== undefined) data.passwordHash = await hashPassword(payload.password);
    if (payload.role !== undefined) {
      if (payload.role !== "administrator" && (await isLastAdmin(existing.id))) {
        return fail("Der letzte Administrator kann nicht herabgestuft werden.", 400);
      }
      data.role = payload.role;
    }

    if (Object.keys(data).length === 0) {
      return fail("Keine Änderungen übergeben.", 400);
    }

    const updated = await prisma.user.update({
      where: { id: existing.id },
      data,
      select: userSelect,
    });

    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: "user.updated",
        actor: "user",
        beforeJson: { targetUserId: existing.id, email: existing.email, role: existing.role },
        afterJson: {
          targetUserId: updated.id,
          email: updated.email,
          role: updated.role,
          passwordChanged: payload.password !== undefined,
        },
      },
    });

    return ok({ user: updated });
  } catch (error) {
    const message =
      error instanceof Error && error.message.includes("Unique constraint")
        ? "Diese E-Mail-Adresse wird bereits verwendet."
        : error instanceof Error
          ? error.message
          : "Benutzer konnte nicht aktualisiert werden.";
    return fail(message, 400);
  }
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const admin = await requireAdminUser();
  if (!admin) return fail("Forbidden", 403);

  const id = await resolveId(context.params);
  if (id === admin.id) return fail("Der eigene Benutzer kann nicht gelöscht werden.", 400);

  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) return fail("Benutzer nicht gefunden.", 404);
  if (await isLastAdmin(existing.id)) {
    return fail("Der letzte Administrator kann nicht gelöscht werden.", 400);
  }

  await prisma.$transaction(async (tx) => {
    await tx.auditLog.create({
      data: {
        userId: admin.id,
        action: "user.deleted",
        actor: "user",
        beforeJson: { targetUserId: existing.id, email: existing.email, role: existing.role },
      },
    });
    await tx.user.delete({ where: { id: existing.id } });
  });

  return ok({ ok: true });
}
