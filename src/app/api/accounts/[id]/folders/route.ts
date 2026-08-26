import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import { syncFolders } from "@/server/imap/imapService";
import { prisma } from "@/server/db/prisma";

async function resolveId(params: Promise<{ id: string }>) {
  return (await params).id;
}

/**
 * Folder list for the mail UI.
 *
 * Default: serve from local `MailFolder` + index counts (no IMAP LIST).
 * `?sync=1`: refresh folder tree from IMAP first (explicit refresh / after mutations).
 */
export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  try {
    const accountId = await resolveId(context.params);
    const wantImapSync = new URL(req.url).searchParams.get("sync") === "1";

    const account = await prisma.mailAccount.findFirst({
      where: { id: accountId, userId: session.userId },
      select: { id: true },
    });
    if (!account) return fail("Account not found", 404);

    let folders: Array<{
      path: string;
      displayName: string;
      delimiter?: string | null;
      flags?: string[];
    }>;

    if (wantImapSync) {
      folders = await syncFolders(accountId, session.userId);
    } else {
      const rows = await prisma.mailFolder.findMany({
        where: { accountId },
        orderBy: { path: "asc" },
        select: {
          path: true,
          displayName: true,
          delimiter: true,
          flags: true,
        },
      });
      if (rows.length === 0) {
        folders = await syncFolders(accountId, session.userId);
      } else {
        folders = rows.map((row) => ({
          path: row.path,
          displayName: row.displayName,
          delimiter: row.delimiter,
          flags: Array.isArray(row.flags)
            ? row.flags.filter((f): f is string => typeof f === "string")
            : [],
        }));
      }
    }

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
