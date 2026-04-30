import { z } from "zod";
import { prisma } from "@/server/db/prisma";
import { fail, ok } from "@/lib/http";
import { getSessionFromCookies } from "@/server/auth/session";
import { sendMailViaSmtp } from "@/server/mail/smtp";

const payloadSchema = z.object({
  action: z.enum(["send_now", "send_later", "save_draft"]),
  draftId: z.string().optional(),
  accountId: z.string().min(1),
  to: z.array(z.string().email()).default([]),
  cc: z.array(z.string().email()).default([]),
  bcc: z.array(z.string().email()).default([]),
  subject: z.string().default(""),
  html: z.string().default(""),
  text: z.string().default(""),
  sendAt: z.string().optional(),
});

export async function POST(req: Request) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);
  const userId = session.userId;

  try {
    const payload = payloadSchema.parse(await req.json());
    const commonData = {
      userId,
      accountId: payload.accountId,
      toEmails: payload.to,
      ccEmails: payload.cc,
      bccEmails: payload.bcc,
      subject: payload.subject,
      bodyHtml: payload.html,
      bodyText: payload.text,
    };

    async function assertDraftOwner() {
      if (!payload.draftId) return;
      const existing = await prisma.mailDraft.findFirst({
        where: { id: payload.draftId, userId },
        select: { id: true },
      });
      if (!existing) throw new Error("Entwurf nicht gefunden.");
    }

    if (payload.action === "save_draft") {
      await assertDraftOwner();
      const draft = payload.draftId
        ? await prisma.mailDraft.update({
            where: { id: payload.draftId },
            data: {
              ...commonData,
              status: "draft",
              sendAt: null,
              error: null,
            },
          })
        : await prisma.mailDraft.create({
            data: {
              ...commonData,
              status: "draft",
            },
          });
      return ok({ draft, info: "Entwurf gespeichert." });
    }

    if (payload.action === "send_later") {
      await assertDraftOwner();
      if (!payload.sendAt) return fail("Zeitpunkt für späteres Senden fehlt.", 400);
      const sendAt = new Date(payload.sendAt);
      if (Number.isNaN(sendAt.valueOf())) return fail("Ungültiger Zeitpunkt.", 400);
      const draft = payload.draftId
        ? await prisma.mailDraft.update({
            where: { id: payload.draftId },
            data: {
              ...commonData,
              status: "scheduled",
              sendAt,
              error: null,
            },
          })
        : await prisma.mailDraft.create({
            data: {
              ...commonData,
              status: "scheduled",
              sendAt,
            },
          });
      return ok({ draft, info: "Mail für später eingeplant." });
    }

    await assertDraftOwner();
    await sendMailViaSmtp(userId, {
      accountId: payload.accountId,
      to: payload.to,
      cc: payload.cc,
      bcc: payload.bcc,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
    });

    const draft = payload.draftId
      ? await prisma.mailDraft.update({
          where: { id: payload.draftId },
          data: {
            ...commonData,
            status: "sent",
            sentAt: new Date(),
            sendAt: null,
            error: null,
          },
        })
      : await prisma.mailDraft.create({
          data: {
            ...commonData,
            status: "sent",
            sentAt: new Date(),
          },
        });

    return ok({ draft, info: "Mail wurde versendet." });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Mail-Aktion fehlgeschlagen.", 400);
  }
}
