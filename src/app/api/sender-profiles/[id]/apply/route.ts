import { NextRequest } from "next/server";
import { prisma } from "@/server/db/prisma";
import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import { matchesSenderProfile } from "@/server/rules/senderMatcher";
import { moveIndexedEmail } from "@/server/imap/imapService";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: RouteContext) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  const { id } = await ctx.params;
  const profile = await prisma.senderProfile.findFirst({
    where: { id, userId: session.userId },
  });
  if (!profile) return fail("Profil nicht gefunden", 404);

  const accountFilter = profile.accountId
    ? { accountId: profile.accountId }
    : { account: { userId: session.userId } };

  const emails = await prisma.emailIndex.findMany({
    where: {
      ...accountFilter,
      fromEmail: { not: null },
      folderPath: { not: profile.targetFolder },
    },
    select: { id: true, fromEmail: true, folderPath: true },
  });

  const matching = emails.filter(
    (e) => e.fromEmail && matchesSenderProfile(e.fromEmail, profile.patterns),
  );

  let moved = 0;
  let errors = 0;

  for (const email of matching) {
    try {
      await moveIndexedEmail(email.id, session.userId, profile.targetFolder);
      await prisma.emailIndex.update({
        where: { id: email.id },
        data: { folderPath: profile.targetFolder },
      });
      moved++;
    } catch {
      errors++;
    }
  }

  await prisma.senderProfile.update({
    where: { id },
    data: { emailCount: { increment: moved } },
  });

  return ok({ moved, errors, total: matching.length });
}
