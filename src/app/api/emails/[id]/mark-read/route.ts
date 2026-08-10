import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import { markEmailSeen } from "@/server/imap/imapService";
import { moveIndexedEmail } from "@/server/imap/imapService";
import { prisma } from "@/server/db/prisma";
import { writeAuditLog } from "@/server/audit/auditLog";
import { matchesSenderProfile } from "@/server/rules/senderMatcher";

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  try {
    const { id } = await context.params;
    const email = await prisma.emailIndex.findFirst({
      where: {
        id,
        account: { userId: session.userId },
      },
    });
    if (!email) return fail("Email not found", 404);

    const alreadySeen = (email.flags || []).includes("\\Seen");
    if (!alreadySeen) {
      await markEmailSeen(id, session.userId, true);
      const flags = Array.from(new Set([...(email.flags || []), "\\Seen"]));
      await prisma.emailIndex.update({ where: { id }, data: { flags } });

      await writeAuditLog({
        userId: session.userId,
        accountId: email.accountId,
        emailId: id,
        action: "email.mark_read",
        actor: "user",
        beforeJson: { flags: email.flags },
        afterJson: { flags },
      });
    }

    if (email.folderPath === "INBOX" && !email.autoMoveBlocked) {
      const profiles = await prisma.senderProfile.findMany({
        where: {
          userId: session.userId,
          isActive: true,
          category: { not: "ignore" },
        },
      });

      const matchedProfile = profiles.find(
        (p) =>
          email.fromEmail &&
          matchesSenderProfile(email.fromEmail, p.patterns) &&
          p.targetFolder &&
          p.targetFolder !== "INBOX",
      );

      if (matchedProfile && matchedProfile.targetFolder) {
        try {
          const newUid = await moveIndexedEmail(id, session.userId, matchedProfile.targetFolder);
          const labelsAdded = (matchedProfile.autoLabels ?? []).filter(
            (label) => !(email.labels ?? []).includes(label),
          );
          const mergedLabels =
            labelsAdded.length > 0
              ? [...new Set([...(email.labels ?? []), ...matchedProfile.autoLabels])]
              : email.labels ?? [];

          await prisma.emailIndex.update({
            where: { id },
            data: {
              folderPath: matchedProfile.targetFolder,
              ...(newUid ? { imapUid: newUid } : {}),
              ...(labelsAdded.length > 0 ? { labels: mergedLabels } : {}),
            },
          });
          return ok({
            ok: true,
            movedTo: matchedProfile.targetFolder,
            ...(labelsAdded.length > 0 ? { labelsAdded, labels: mergedLabels } : {}),
          });
        } catch {
          return ok({ ok: true });
        }
      }
    }

    return ok({ ok: true });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed marking read", 400);
  }
}
