import { prisma } from "@/server/db/prisma";
import { fail, ok } from "@/lib/http";
import { getSessionFromCookies } from "@/server/auth/session";
import { sendMailViaSmtp } from "@/server/mail/smtp";

export async function POST() {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  const due = await prisma.mailDraft.findMany({
    where: {
      userId: session.userId,
      status: "scheduled",
      sendAt: { lte: new Date() },
    },
    orderBy: { sendAt: "asc" },
    take: 20,
  });

  let sent = 0;
  let failed = 0;

  for (const draft of due) {
    try {
      await sendMailViaSmtp(session.userId, {
        accountId: draft.accountId,
        to: draft.toEmails,
        cc: draft.ccEmails,
        bcc: draft.bccEmails,
        subject: draft.subject ?? "",
        html: draft.bodyHtml ?? "",
        text: draft.bodyText ?? "",
      });
      await prisma.mailDraft.update({
        where: { id: draft.id },
        data: { status: "sent", sentAt: new Date(), error: null },
      });
      sent += 1;
    } catch (error) {
      await prisma.mailDraft.update({
        where: { id: draft.id },
        data: { error: error instanceof Error ? error.message.slice(0, 400) : "Versandfehler" },
      });
      failed += 1;
    }
  }

  return ok({ sent, failed, checked: due.length });
}
