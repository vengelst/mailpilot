import { prisma } from "@/server/db/prisma";
import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);
  const logs = await prisma.auditLog.findMany({
    where: { userId: session.userId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return ok({ logs });
}
