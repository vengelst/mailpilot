import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import { syncFolders } from "@/server/imap/imapService";
import { prisma } from "@/server/db/prisma";

async function resolveId(params: Promise<{ id: string }>) {
  return (await params).id;
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  try {
    const accountId = await resolveId(context.params);
    const folders = await syncFolders(accountId, session.userId);

    const baseWhere = {
      accountId,
      account: { userId: session.userId },
    };
    const [totalsByFolder, unreadByFolder] = await Promise.all([
      prisma.emailIndex.groupBy({
        by: ["folderPath"],
        where: baseWhere,
        _count: { _all: true },
      }),
      prisma.emailIndex.groupBy({
        by: ["folderPath"],
        where: { ...baseWhere, NOT: { flags: { has: "\\Seen" } } },
        _count: { _all: true },
      }),
    ]);

    const totals = new Map(
      totalsByFolder.map((entry) => [entry.folderPath, entry._count._all]),
    );
    const unread = new Map(
      unreadByFolder.map((entry) => [entry.folderPath, entry._count._all]),
    );

    const enriched = folders.map((folder) => ({
      ...folder,
      totalCount: totals.get(folder.path) ?? 0,
      unreadCount: unread.get(folder.path) ?? 0,
    }));

    return ok({ folders: enriched });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed loading folders", 400);
  }
}
