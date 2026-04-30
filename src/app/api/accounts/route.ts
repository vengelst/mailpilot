import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db/prisma";
import { getSessionFromCookies } from "@/server/auth/session";
import { encryptSecret } from "@/server/security/crypto";
import { fail, ok } from "@/lib/http";
import { writeAuditLog } from "@/server/audit/auditLog";

const createSchema = z.object({
  name: z.string().min(1),
  imapHost: z.string().min(1),
  imapPort: z.number().int().positive(),
  imapSecure: z.boolean().default(true),
  imapUsername: z.string().min(1),
  imapPassword: z.string().min(1),
  smtpHost: z.string().min(1),
  smtpPort: z.number().int().positive(),
  smtpSecure: z.boolean().default(true),
  smtpUsername: z.string().min(1),
  smtpPassword: z.string().min(1),
  smtpFromName: z.string().optional(),
});

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  const accounts = await prisma.mailAccount.findMany({
    where: { userId: session.userId },
    orderBy: { createdAt: "desc" },
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
      createdAt: true,
    },
  });
  return ok({ accounts });
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  try {
    const payload = createSchema.parse(await req.json());
    const account = await prisma.mailAccount.create({
      data: {
        userId: session.userId,
        name: payload.name,
        imapHost: payload.imapHost,
        imapPort: payload.imapPort,
        imapSecure: payload.imapSecure,
        imapUsername: payload.imapUsername,
        encryptedImapPassword: encryptSecret(payload.imapPassword),
        smtpHost: payload.smtpHost,
        smtpPort: payload.smtpPort,
        smtpSecure: payload.smtpSecure,
        smtpUsername: payload.smtpUsername,
        encryptedSmtpPassword: encryptSecret(payload.smtpPassword),
        smtpFromName: payload.smtpFromName?.trim() || null,
      },
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
        createdAt: true,
      },
    });

    await writeAuditLog({
      userId: session.userId,
      accountId: account.id,
      action: "account.created",
      actor: "user",
      afterJson: {
        name: account.name,
        host: account.imapHost,
        username: account.imapUsername,
      },
    });

    return ok({ account }, 201);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not create account", 400);
  }
}
