import { prisma } from "@/server/db/prisma";
import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import { encryptSecret } from "@/server/security/crypto";
import { z } from "zod";

async function resolveId(params: Promise<{ id: string }> | { id: string }) {
  return (await Promise.resolve(params)).id;
}

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  imapHost: z.string().min(1).optional(),
  imapPort: z.number().int().positive().optional(),
  imapSecure: z.boolean().optional(),
  imapUsername: z.string().min(1).optional(),
  imapPassword: z.string().min(1).optional(),
  smtpHost: z.string().min(1).optional(),
  smtpPort: z.number().int().positive().optional(),
  smtpSecure: z.boolean().optional(),
  smtpUsername: z.string().min(1).optional(),
  smtpPassword: z.string().min(1).optional(),
  smtpFromName: z.string().optional(),
});

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  const id = await resolveId(context.params);
  const account = await prisma.mailAccount.findFirst({
    where: { id, userId: session.userId },
  });
  if (!account) return fail("Account not found", 404);

  try {
    const payload = updateSchema.parse(await req.json());
    const data: Record<string, unknown> = {};
    if (payload.name !== undefined) data.name = payload.name;
    if (payload.imapHost !== undefined) data.imapHost = payload.imapHost;
    if (payload.imapPort !== undefined) data.imapPort = payload.imapPort;
    if (payload.imapSecure !== undefined) data.imapSecure = payload.imapSecure;
    if (payload.imapUsername !== undefined) data.imapUsername = payload.imapUsername;
    if (payload.imapPassword !== undefined) {
      data.encryptedImapPassword = encryptSecret(payload.imapPassword);
    }
    if (payload.smtpHost !== undefined) data.smtpHost = payload.smtpHost;
    if (payload.smtpPort !== undefined) data.smtpPort = payload.smtpPort;
    if (payload.smtpSecure !== undefined) data.smtpSecure = payload.smtpSecure;
    if (payload.smtpUsername !== undefined) data.smtpUsername = payload.smtpUsername;
    if (payload.smtpPassword !== undefined) {
      data.encryptedSmtpPassword = encryptSecret(payload.smtpPassword);
    }
    if (payload.smtpFromName !== undefined) {
      data.smtpFromName = payload.smtpFromName.trim() || null;
    }
    if (Object.keys(data).length === 0) {
      return fail("Keine Änderungen übergeben.", 400);
    }

    const updated = await prisma.mailAccount.update({
      where: { id: account.id },
      data,
      select: {
        id: true,
        name: true,
        imapHost: true,
        imapPort: true,
        imapSecure: true,
        imapUsername: true,
        smtpHost: true,
        smtpPort: true,
        smtpSecure: true,
        smtpUsername: true,
        smtpFromName: true,
      },
    });
    return ok({ account: updated });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Account could not be updated", 400);
  }
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  const id = await resolveId(context.params);
  const account = await prisma.mailAccount.findFirst({
    where: { id, userId: session.userId },
  });
  if (!account) return fail("Account not found", 404);

  try {
    await prisma.$transaction(async (tx) => {
      // Local removal only: delete indexed data in app DB; IMAP server remains untouched.
      await tx.mailAccount.delete({ where: { id: account.id } });
      await tx.auditLog.create({
        data: {
          userId: session.userId,
          action: "account.deleted",
          actor: "user",
          beforeJson: {
            deletedAccountId: account.id,
            name: account.name,
            imapHost: account.imapHost,
            imapUsername: account.imapUsername,
          },
        },
      });
    });
    return ok({ ok: true });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Account could not be deleted", 400);
  }
}
