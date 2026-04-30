import { NextRequest } from "next/server";
import { z } from "zod";
import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import { moveIndexedEmail, moveIndexedEmailToSpecial } from "@/server/imap/imapService";
import { prisma } from "@/server/db/prisma";
import { writeAuditLog } from "@/server/audit/auditLog";

const schema = z.object({
  targetFolder: z.string().optional(),
  targetSpecial: z.enum(["trash", "spam"]).optional(),
});

async function resolveId(params: Promise<{ id: string }> | { id: string }) {
  return (await Promise.resolve(params)).id;
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  try {
    const id = await resolveId(context.params);
    const payload = schema.parse(await req.json());
    if (!payload.targetFolder && !payload.targetSpecial) {
      return fail("targetFolder or targetSpecial required");
    }

    const before = await prisma.emailIndex.findFirst({
      where: { id, account: { userId: session.userId } },
    });
    if (!before) return fail("Email not found", 404);

    let targetFolder = payload.targetFolder ?? null;

    if (payload.targetSpecial) {
      targetFolder = await moveIndexedEmailToSpecial(id, session.userId, payload.targetSpecial);
    } else if (payload.targetFolder) {
      await moveIndexedEmail(id, session.userId, payload.targetFolder);
      targetFolder = payload.targetFolder;
    }

    if (!targetFolder) return fail("No target folder resolved", 400);
    await prisma.emailIndex.update({
      where: { id },
      data: { folderPath: targetFolder },
    });

    await writeAuditLog({
      userId: session.userId,
      accountId: before.accountId,
      emailId: id,
      action: payload.targetSpecial ? `email.moved_${payload.targetSpecial}` : "email.moved",
      actor: "user",
      beforeJson: { folderPath: before.folderPath },
      afterJson: { folderPath: targetFolder },
    });

    return ok({ ok: true, folderPath: targetFolder });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Move failed", 400);
  }
}
