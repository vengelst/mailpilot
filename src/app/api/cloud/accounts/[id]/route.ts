import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import { prisma } from "@/server/db/prisma";
import { writeAuditLog } from "@/server/audit/auditLog";

async function resolveId(params: Promise<{ id: string }> | { id: string }) {
  return (await Promise.resolve(params)).id;
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);
  const id = await resolveId(context.params);

  const prismaAny = prisma as unknown as {
    cloudAccount: {
      findFirst: (args: unknown) => Promise<{ id: string; provider: string } | null>;
      delete: (args: unknown) => Promise<unknown>;
    };
  };

  const existing = await prismaAny.cloudAccount.findFirst({
    where: { id, userId: session.userId },
  });
  if (!existing) return fail("Cloud account not found", 404);

  await prismaAny.cloudAccount.delete({ where: { id } });
  await writeAuditLog({
    userId: session.userId,
    action: "cloud.account.disconnected",
    actor: "user",
    beforeJson: { cloudAccountId: existing.id, provider: existing.provider },
  });

  return ok({ ok: true });
}
