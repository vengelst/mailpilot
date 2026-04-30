import { prisma } from "@/server/db/prisma";
import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);
  const runs = await prisma.automationRun.findMany({
    where: { userId: session.userId },
    orderBy: { startedAt: "desc" },
    take: 100,
  });
  return ok({ runs });
}
