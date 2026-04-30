import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import { runAiClassificationForEmail } from "@/server/automation/aiClassificationJob";
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
      where: { id, account: { userId: session.userId } },
    });
    if (!email) return fail("Email not found", 404);

    const aiResult = await runAiClassificationForEmail(id, session.userId);
    await writeAuditLog({
      userId: session.userId,
      accountId: email.accountId,
      emailId: id,
      action: "email.analyze",
      actor: "ai",
      afterJson: aiResult,
    });
    return ok({ aiResult });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "AI analyze failed", 400);
  }
}
