import nodemailer from "nodemailer";
import { prisma } from "@/server/db/prisma";
import { decryptSecret } from "@/server/security/crypto";

export type ComposePayload = {
  accountId: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  html: string;
  text: string;
};

function joinRecipients(values: string[]) {
  return values.filter(Boolean).join(", ");
}

export async function sendMailViaSmtp(userId: string, payload: ComposePayload) {
  const account = await prisma.mailAccount.findFirst({
    where: { id: payload.accountId, userId },
  });
  if (!account) throw new Error("Konto nicht gefunden.");
  if (!account.smtpHost || !account.smtpPort || !account.smtpUsername || !account.encryptedSmtpPassword) {
    throw new Error("SMTP ist für dieses Konto nicht vollständig konfiguriert.");
  }

  const transporter = nodemailer.createTransport({
    host: account.smtpHost,
    port: account.smtpPort,
    secure: account.smtpSecure,
    auth: {
      user: account.smtpUsername,
      pass: decryptSecret(account.encryptedSmtpPassword),
    },
  });

  await transporter.sendMail({
    from: account.smtpFromName
      ? `"${account.smtpFromName}" <${account.smtpUsername}>`
      : account.smtpUsername,
    to: joinRecipients(payload.to),
    cc: joinRecipients(payload.cc),
    bcc: joinRecipients(payload.bcc),
    subject: payload.subject || "(Ohne Betreff)",
    html: payload.html,
    text: payload.text,
  });
}
