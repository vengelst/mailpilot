import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import { prisma } from "@/server/db/prisma";

type DuplicateEmail = {
  id: string;
  accountId: string;
  subject: string | null;
  fromEmail: string | null;
  fromName: string | null;
  date: string | null;
  folderPath: string;
  accountName?: string;
};

type DuplicateGroup = {
  matchType: "messageId" | "heuristic";
  emails: DuplicateEmail[];
};

export async function GET(req: Request) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? 200), 500);

  const accounts = await prisma.mailAccount.findMany({
    where: { userId: session.userId },
    select: { id: true, name: true },
  });
  const accountMap = new Map(accounts.map((a) => [a.id, a.name]));

  const groups: DuplicateGroup[] = [];

  // --- 1. MessageId-based duplicates ---
  const duplicateMessageIds = await prisma.emailIndex.groupBy({
    by: ["messageId"],
    where: {
      account: { userId: session.userId },
      messageId: { not: null },
    },
    having: {
      messageId: { _count: { gt: 1 } },
    },
    _count: { _all: true },
    orderBy: { _count: { messageId: "desc" } },
    take: limit,
  });

  if (duplicateMessageIds.length > 0) {
    const msgIds = duplicateMessageIds
      .map((d) => d.messageId)
      .filter((id): id is string => id !== null);

    const emails = await prisma.emailIndex.findMany({
      where: {
        account: { userId: session.userId },
        messageId: { in: msgIds },
      },
      select: {
        id: true,
        accountId: true,
        subject: true,
        fromEmail: true,
        fromName: true,
        date: true,
        folderPath: true,
        messageId: true,
      },
      orderBy: { date: "desc" },
    });

    const byMsgId = new Map<string, typeof emails>();
    for (const email of emails) {
      if (!email.messageId) continue;
      const list = byMsgId.get(email.messageId) ?? [];
      list.push(email);
      byMsgId.set(email.messageId, list);
    }

    for (const [, emailList] of byMsgId) {
      if (emailList.length < 2) continue;
      groups.push({
        matchType: "messageId",
        emails: emailList.map((e) => ({
          id: e.id,
          accountId: e.accountId,
          subject: e.subject,
          fromEmail: e.fromEmail,
          fromName: e.fromName,
          date: e.date?.toISOString() ?? null,
          folderPath: e.folderPath,
          accountName: accountMap.get(e.accountId) ?? undefined,
        })),
      });
    }
  }

  // --- 2. Heuristic duplicates (same from+subject+date±60s, no messageId) ---
  const remainingSlots = limit - groups.length;
  if (remainingSlots > 0) {
    const noMsgIdEmails = await prisma.emailIndex.findMany({
      where: {
        account: { userId: session.userId },
        OR: [{ messageId: null }, { messageId: "" }],
        date: { not: null },
      },
      select: {
        id: true,
        accountId: true,
        subject: true,
        fromEmail: true,
        fromName: true,
        date: true,
        folderPath: true,
      },
      orderBy: { date: "desc" },
      take: 5000,
    });

    const heuristicMap = new Map<string, typeof noMsgIdEmails>();
    for (const email of noMsgIdEmails) {
      if (!email.date || !email.fromEmail) continue;
      const key = `${email.fromEmail.toLowerCase()}|${(email.subject ?? "").toLowerCase().trim()}`;
      const list = heuristicMap.get(key) ?? [];
      list.push(email);
      heuristicMap.set(key, list);
    }

    for (const [, candidates] of heuristicMap) {
      if (candidates.length < 2) continue;
      if (groups.length >= limit) break;

      candidates.sort(
        (a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0),
      );

      const cluster: (typeof candidates)[number][] = [candidates[0]];
      for (let i = 1; i < candidates.length; i++) {
        const prev = candidates[i - 1];
        const curr = candidates[i];
        const diff = Math.abs(
          (curr.date?.getTime() ?? 0) - (prev.date?.getTime() ?? 0),
        );
        if (diff <= 60_000) {
          cluster.push(curr);
        } else {
          if (cluster.length >= 2) {
            groups.push({
              matchType: "heuristic",
              emails: cluster.map((e) => ({
                id: e.id,
                accountId: e.accountId,
                subject: e.subject,
                fromEmail: e.fromEmail,
                fromName: e.fromName,
                date: e.date?.toISOString() ?? null,
                folderPath: e.folderPath,
                accountName: accountMap.get(e.accountId) ?? undefined,
              })),
            });
          }
          cluster.length = 0;
          cluster.push(curr);
        }
      }
      if (cluster.length >= 2) {
        groups.push({
          matchType: "heuristic",
          emails: cluster.map((e) => ({
            id: e.id,
            accountId: e.accountId,
            subject: e.subject,
            fromEmail: e.fromEmail,
            fromName: e.fromName,
            date: e.date?.toISOString() ?? null,
            folderPath: e.folderPath,
            accountName: accountMap.get(e.accountId) ?? undefined,
          })),
        });
      }
    }
  }

  groups.sort((a, b) => b.emails.length - a.emails.length);
  const finalGroups = groups.slice(0, limit);

  return ok({ groups: finalGroups, totalGroups: finalGroups.length });
}
