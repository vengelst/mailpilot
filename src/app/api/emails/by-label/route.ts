import { NextRequest } from "next/server";
import { prisma } from "@/server/db/prisma";
import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";

export async function GET(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  const label = req.nextUrl.searchParams.get("label");
  if (!label) return fail("Query-Parameter 'label' fehlt", 400);

  const cursor = req.nextUrl.searchParams.get("cursor");
  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = Math.min(200, Math.max(1, Number(limitParam) || 50));

  const accounts = await prisma.mailAccount.findMany({
    where: { userId: session.userId },
    select: { id: true },
  });
  const accountIds = accounts.map((a) => a.id);

  const where = {
    accountId: { in: accountIds },
    labels: { has: label },
    ...(cursor ? { id: { lt: cursor } } : {}),
  };

  const emails = await prisma.emailIndex.findMany({
    where,
    orderBy: { date: "desc" },
    take: limit + 1,
    select: {
      id: true,
      accountId: true,
      folderPath: true,
      messageId: true,
      subject: true,
      fromName: true,
      fromEmail: true,
      toEmails: true,
      ccEmails: true,
      date: true,
      snippet: true,
      hasAttachments: true,
      attachmentCount: true,
      flags: true,
      localFlag: true,
      labels: true,
      aiCategory: true,
      aiPriority: true,
      aiSummaryShort: true,
      actionRequired: true,
      createdAt: true,
    },
  });

  const hasMore = emails.length > limit;
  const page = hasMore ? emails.slice(0, limit) : emails;
  const nextCursor = hasMore && page.length > 0 ? page[page.length - 1].id : null;

  return ok({
    emails: page,
    pageInfo: { hasMore, nextCursor },
  });
}
