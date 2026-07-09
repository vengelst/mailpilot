import { prisma } from "@/server/db/prisma";
import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";

async function resolveId(params: Promise<{ id: string }> | { id: string }) {
  return (await Promise.resolve(params)).id;
}

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  const id = await resolveId(context.params);
  const account = await prisma.mailAccount.findFirst({
    where: { id, userId: session.userId },
    select: { id: true },
  });
  if (!account) return fail("Account not found", 404);

  await prisma.$transaction([
    prisma.mailAccount.updateMany({
      where: { userId: session.userId },
      data: { isDefault: false },
    }),
    prisma.mailAccount.update({
      where: { id: account.id },
      data: { isDefault: true },
    }),
  ]);

  return ok({ ok: true, defaultAccountId: account.id });
}
