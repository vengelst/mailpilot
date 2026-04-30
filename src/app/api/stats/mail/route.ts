import { z } from "zod";
import { prisma } from "@/server/db/prisma";
import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";

const schema = z.object({
  accountId: z.string().optional(),
});

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function startOfWeek() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function startOfMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function toDomain(email?: string | null) {
  if (!email || !email.includes("@")) return null;
  return email.split("@")[1]?.toLowerCase() ?? null;
}

export async function GET(req: Request) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  const { searchParams } = new URL(req.url);
  const parsed = schema.safeParse({
    accountId: searchParams.get("accountId") ?? undefined,
  });
  if (!parsed.success) return fail("Invalid query", 400);

  if (parsed.data.accountId) {
    const scoped = await prisma.mailAccount.findFirst({
      where: {
        id: parsed.data.accountId,
        userId: session.userId,
      },
      select: { id: true },
    });
    if (!scoped) return fail("Account not found", 404);
  }

  const baseWhere = {
    account: { userId: session.userId },
    ...(parsed.data.accountId ? { accountId: parsed.data.accountId } : {}),
  };

  const [
    totalCount,
    unreadCount,
    attachmentsCount,
    actionRequiredCount,
    folderBuckets,
    categoryBuckets,
    priorityBuckets,
    topSenderBuckets,
    todayCount,
    weekCount,
    monthCount,
  ] = await Promise.all([
    prisma.emailIndex.count({ where: baseWhere }),
    prisma.emailIndex.count({ where: { ...baseWhere, NOT: { flags: { has: "\\Seen" } } } }),
    prisma.emailIndex.count({ where: { ...baseWhere, hasAttachments: true } }),
    prisma.emailIndex.count({ where: { ...baseWhere, actionRequired: true } }),
    prisma.emailIndex.groupBy({
      by: ["folderPath"],
      where: baseWhere,
      _count: { _all: true },
      orderBy: { _count: { folderPath: "desc" } },
      take: 50,
    }),
    prisma.emailIndex.groupBy({
      by: ["aiCategory"],
      where: baseWhere,
      _count: { _all: true },
      orderBy: { _count: { aiCategory: "desc" } },
      take: 20,
    }),
    prisma.emailIndex.groupBy({
      by: ["aiPriority"],
      where: baseWhere,
      _count: { _all: true },
      orderBy: { _count: { aiPriority: "desc" } },
      take: 10,
    }),
    prisma.emailIndex.groupBy({
      by: ["fromEmail"],
      where: baseWhere,
      _count: { _all: true },
      orderBy: { _count: { fromEmail: "desc" } },
      take: 100,
    }),
    prisma.emailIndex.count({
      where: {
        ...baseWhere,
        createdAt: { gte: startOfToday() },
      },
    }),
    prisma.emailIndex.count({
      where: {
        ...baseWhere,
        createdAt: { gte: startOfWeek() },
      },
    }),
    prisma.emailIndex.count({
      where: {
        ...baseWhere,
        createdAt: { gte: startOfMonth() },
      },
    }),
  ]);

  const topSenders = topSenderBuckets
    .filter((bucket) => !!bucket.fromEmail)
    .slice(0, 10)
    .map((bucket) => ({
      fromEmail: bucket.fromEmail,
      count: bucket._count._all,
    }));

  const domainMap = new Map<string, number>();
  for (const bucket of topSenderBuckets) {
    const domain = toDomain(bucket.fromEmail);
    if (!domain) continue;
    domainMap.set(domain, (domainMap.get(domain) ?? 0) + bucket._count._all);
  }
  const topDomains = Array.from(domainMap.entries())
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return ok({
    totals: {
      total: totalCount,
      unread: unreadCount,
      withAttachments: attachmentsCount,
      actionRequired: actionRequiredCount,
    },
    countsByFolder: folderBuckets.map((bucket) => ({
      folder: bucket.folderPath,
      count: bucket._count._all,
    })),
    countsByCategory: categoryBuckets.map((bucket) => ({
      category: bucket.aiCategory ?? "unknown",
      count: bucket._count._all,
    })),
    countsByPriority: priorityBuckets.map((bucket) => ({
      priority: bucket.aiPriority ?? "normal",
      count: bucket._count._all,
    })),
    topSenders,
    topDomains,
    newMails: {
      today: todayCount,
      week: weekCount,
      month: monthCount,
    },
  });
}
