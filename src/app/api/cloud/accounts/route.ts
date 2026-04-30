import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import { prisma } from "@/server/db/prisma";

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  const prismaAny = prisma as unknown as {
    cloudAccount: {
      findMany: (args: unknown) => Promise<unknown[]>;
    };
  };

  const accounts = await prismaAny.cloudAccount.findMany({
    where: { userId: session.userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      provider: true,
      displayName: true,
      tokenExpiresAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return ok({ accounts });
}
