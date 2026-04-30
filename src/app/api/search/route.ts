import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db/prisma";
import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";

/**
 * Allowed values for `limit`. UI shows these exactly. Any other numeric value
 * is clamped to the nearest entry; non-numeric/garbage falls back to default.
 */
const ALLOWED_LIMITS = [50, 100, 200, 300, 500] as const;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

const querySchema = z.object({
  q: z.string().optional(),
  folder: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  hasAttachments: z.enum(["true", "false"]).optional(),
  category: z.string().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  actionRequired: z.enum(["true", "false"]).optional(),
  isRead: z.enum(["true", "false"]).optional(),
  accountId: z.string().optional(),
  // Generous range so /search never crashes the UI on stale URLs.
  // We snap to ALLOWED_LIMITS at runtime.
  limit: z.coerce.number().int().min(1).max(2000).optional(),
  cursor: z.string().optional(),
  sort: z.enum(["date_desc", "date_asc", "from_asc", "subject_asc"]).optional(),
});

function toDate(value?: string) {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return undefined;
  return parsed;
}

function hasSeenFlag(flags: string[]) {
  return flags.includes("\\Seen");
}

function snapLimit(raw: number | undefined): number {
  if (raw === undefined) return DEFAULT_LIMIT;
  if (raw > MAX_LIMIT) return MAX_LIMIT;
  // Snap to nearest allowed value (down) so URLs like ?limit=75 still work.
  let chosen: number = ALLOWED_LIMITS[0];
  for (const v of ALLOWED_LIMITS) {
    if (raw >= v) chosen = v;
  }
  return chosen;
}

export async function GET(req: Request) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  const { searchParams } = new URL(req.url);
  const parsed = querySchema.safeParse({
    q: searchParams.get("q") ?? undefined,
    folder: searchParams.get("folder") ?? undefined,
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
    dateFrom: searchParams.get("dateFrom") ?? undefined,
    dateTo: searchParams.get("dateTo") ?? undefined,
    hasAttachments: searchParams.get("hasAttachments") ?? undefined,
    category: searchParams.get("category") ?? undefined,
    priority: searchParams.get("priority") ?? undefined,
    actionRequired: searchParams.get("actionRequired") ?? undefined,
    isRead: searchParams.get("isRead") ?? undefined,
    accountId: searchParams.get("accountId") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
    cursor: searchParams.get("cursor") ?? undefined,
    sort: searchParams.get("sort") ?? undefined,
  });
  if (!parsed.success) {
    return fail("Suche konnte nicht ausgeführt werden — ungültige Parameter.", 400);
  }

  const input = parsed.data;
  const limit = snapLimit(input.limit);
  const limitApplied = limit !== (input.limit ?? DEFAULT_LIMIT);

  const dateFrom = toDate(input.dateFrom);
  const dateTo = toDate(input.dateTo);

  if (input.accountId) {
    const scopedAccount = await prisma.mailAccount.findFirst({
      where: { id: input.accountId, userId: session.userId },
      select: { id: true },
    });
    if (!scopedAccount) return fail("Account not found", 404);
  }

  const where: Prisma.EmailIndexWhereInput = {
    account: { userId: session.userId },
    ...(input.accountId ? { accountId: input.accountId } : {}),
    ...(input.folder ? { folderPath: input.folder } : {}),
    ...(input.from
      ? { fromEmail: { contains: input.from, mode: "insensitive" as const } }
      : {}),
    ...(input.to ? { toEmails: { hasSome: [input.to] } } : {}),
    ...(input.category
      ? { aiCategory: { equals: input.category, mode: "insensitive" as const } }
      : {}),
    ...(input.priority ? { aiPriority: input.priority } : {}),
    ...(input.actionRequired ? { actionRequired: input.actionRequired === "true" } : {}),
    ...(input.isRead === "true" ? { flags: { has: "\\Seen" } } : {}),
    ...(input.isRead === "false" ? { NOT: { flags: { has: "\\Seen" } } } : {}),
    ...(input.hasAttachments
      ? { hasAttachments: input.hasAttachments === "true" }
      : {}),
    ...(dateFrom || dateTo
      ? {
          date: {
            ...(dateFrom ? { gte: dateFrom } : {}),
            ...(dateTo ? { lte: dateTo } : {}),
          },
        }
      : {}),
    ...(input.q
      ? {
          OR: [
            { subject: { contains: input.q, mode: "insensitive" as const } },
            { fromEmail: { contains: input.q, mode: "insensitive" as const } },
            { toEmails: { hasSome: [input.q] } },
            { textPreview: { contains: input.q, mode: "insensitive" as const } },
            { aiSummaryShort: { contains: input.q, mode: "insensitive" as const } },
            { aiSummaryLong: { contains: input.q, mode: "insensitive" as const } },
            { aiKeywords: { hasSome: [input.q] } },
          ],
        }
      : {}),
  };

  const orderBy =
    input.sort === "date_asc"
      ? [{ date: "asc" as const }, { id: "asc" as const }]
      : input.sort === "from_asc"
        ? [{ fromEmail: "asc" as const }, { id: "asc" as const }]
        : input.sort === "subject_asc"
          ? [{ subject: "asc" as const }, { id: "asc" as const }]
          : [{ date: "desc" as const }, { id: "desc" as const }];

  // Run the heavy queries in parallel.
  // - rows: actual page (limited to MAX_LIMIT email headers, NO body fields)
  // - total/unread/attachments/actionRequired: count() over the full WHERE
  // - folderGroups: groupBy folderPath with metric breakdowns
  const [
    rows,
    total,
    unreadTotal,
    attachmentsTotal,
    actionRequiredTotal,
    folderTotals,
    folderUnread,
    folderAttachments,
    folderActionRequired,
  ] = await Promise.all([
    prisma.emailIndex.findMany({
      where,
      select: {
        id: true,
        accountId: true,
        folderPath: true,
        imapUid: true, // bigint — `ok()` serializes to string
        subject: true,
        fromName: true,
        fromEmail: true,
        date: true,
        createdAt: true,
        snippet: true,
        textPreview: true,
        hasAttachments: true,
        attachmentCount: true,
        flags: true,
        aiCategory: true,
        aiPriority: true,
        aiSummaryShort: true,
        actionRequired: true,
      },
      orderBy,
      take: limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    }),
    prisma.emailIndex.count({ where }),
    prisma.emailIndex.count({
      where: { ...where, NOT: { flags: { has: "\\Seen" } } },
    }),
    prisma.emailIndex.count({ where: { ...where, hasAttachments: true } }),
    prisma.emailIndex.count({ where: { ...where, actionRequired: true } }),
    prisma.emailIndex.groupBy({
      by: ["folderPath"],
      where,
      _count: { _all: true },
      orderBy: { _count: { folderPath: "desc" } },
      take: 100,
    }),
    prisma.emailIndex.groupBy({
      by: ["folderPath"],
      where: { ...where, NOT: { flags: { has: "\\Seen" } } },
      _count: { _all: true },
    }),
    prisma.emailIndex.groupBy({
      by: ["folderPath"],
      where: { ...where, hasAttachments: true },
      _count: { _all: true },
    }),
    prisma.emailIndex.groupBy({
      by: ["folderPath"],
      where: { ...where, actionRequired: true },
      _count: { _all: true },
    }),
  ]);

  const unreadByFolder = new Map(
    folderUnread.map((entry) => [entry.folderPath, entry._count._all]),
  );
  const attachmentsByFolder = new Map(
    folderAttachments.map((entry) => [entry.folderPath, entry._count._all]),
  );
  const actionByFolder = new Map(
    folderActionRequired.map((entry) => [entry.folderPath, entry._count._all]),
  );

  const folderGroups = folderTotals.map((entry) => ({
    folderPath: entry.folderPath,
    count: entry._count._all,
    unreadCount: unreadByFolder.get(entry.folderPath) ?? 0,
    attachmentsCount: attachmentsByFolder.get(entry.folderPath) ?? 0,
    actionRequiredCount: actionByFolder.get(entry.folderPath) ?? 0,
  }));

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? page[page.length - 1]?.id ?? null : null;

  const emails = page.map((row) => ({
    ...row,
    isRead: hasSeenFlag(row.flags ?? []),
  }));

  return ok({
    emails,
    pageInfo: { nextCursor, hasMore, limit, limitApplied },
    stats: {
      total,
      unreadTotal,
      attachmentsTotal,
      actionRequiredTotal,
    },
    folderGroups,
  });
}
