import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import { markEmailSeen } from "@/server/imap/imapService";
import { prisma } from "@/server/db/prisma";
import { writeAuditLog } from "@/server/audit/auditLog";

async function resolveId(params: Promise<{ id: string }> | { id: string }) {
  return (await Promise.resolve(params)).id;
}

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  try {
    const id = await resolveId(context.params);
    const email = await prisma.emailIndex.findFirst({
      where: {
        id,
        account: { userId: session.userId },
      },
    });
    if (!email) return fail("Email not found", 404);

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

    return ok({ ok: true });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed marking read", 400);
  }
}
