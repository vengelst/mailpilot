import { NextRequest } from "next/server";
import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import { prisma } from "@/server/db/prisma";
import { syncFolders } from "@/server/imap/imapService";
import { z } from "zod";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  const { id } = await ctx.params;
  const account = await prisma.mailAccount.findFirst({
    where: { id, userId: session.userId },
    select: { id: true, excludedFolders: true },
  });
  if (!account) return fail("Account not found", 404);

  const folders = await syncFolders(id, session.userId);
  const folderList = folders.map((f) => ({
    path: f.path,
    name: f.displayName ?? f.path,
  }));
  folderList.sort((a, b) => a.path.localeCompare(b.path));

  return ok({
    excludedFolders: account.excludedFolders,
    availableFolders: folderList,
  });
}

const updateSchema = z.object({
  excludedFolders: z.array(z.string()),
});

export async function PUT(req: NextRequest, ctx: RouteContext) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  const { id } = await ctx.params;
  const account = await prisma.mailAccount.findFirst({
    where: { id, userId: session.userId },
    select: { id: true },
  });
  if (!account) return fail("Account not found", 404);

  try {
    const payload = updateSchema.parse(await req.json());
    await prisma.mailAccount.update({
      where: { id },
      data: { excludedFolders: payload.excludedFolders },
    });

    if (payload.excludedFolders.length > 0) {
      const excluded = payload.excludedFolders.map((f) => f.toLowerCase());
      await prisma.emailIndex.deleteMany({
        where: {
          accountId: id,
          folderPath: { in: excluded, mode: "insensitive" },
        },
      });
    }

    return ok({ excludedFolders: payload.excludedFolders });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Update failed", 400);
  }
}
