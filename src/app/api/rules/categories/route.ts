import { prisma } from "@/server/db/prisma";
import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  const rows = await prisma.emailIndex.groupBy({
    by: ["aiCategory"],
    where: {
      account: { userId: session.userId },
      aiCategory: { not: null },
    },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
  });

  const categories = rows
    .filter((r) => r.aiCategory !== null)
    .map((r) => ({ name: r.aiCategory!, count: r._count.id }));

  const folderRows = await prisma.emailIndex.groupBy({
    by: ["folderPath"],
    where: { account: { userId: session.userId } },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
  });

  const folders = folderRows.map((r) => ({ path: r.folderPath, count: r._count.id }));

  return ok({ categories, folders });
}
