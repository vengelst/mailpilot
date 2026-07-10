import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import { prisma } from "@/server/db/prisma";

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  const sig = await prisma.signature.findFirst({
    where: { userId: session.userId, isDefault: true },
  });

  const settings = sig
    ? {
        signatureText: sig.htmlContent,
        includeOnNewMail: sig.includeOnNewMail,
        includeOnReply: sig.includeOnReply,
        includeOnForward: sig.includeOnForward,
      }
    : {
        signatureText: "",
        includeOnNewMail: true,
        includeOnReply: true,
        includeOnForward: true,
      };

  return ok({ settings });
}

export async function POST(req: Request) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  try {
    const body = (await req.json()) as {
      signatureText?: string;
      includeOnNewMail?: boolean;
      includeOnReply?: boolean;
      includeOnForward?: boolean;
    };

    const existing = await prisma.signature.findFirst({
      where: { userId: session.userId, isDefault: true },
    });

    if (existing) {
      await prisma.signature.update({
        where: { id: existing.id },
        data: {
          htmlContent: body.signatureText ?? existing.htmlContent,
          includeOnNewMail: body.includeOnNewMail ?? existing.includeOnNewMail,
          includeOnReply: body.includeOnReply ?? existing.includeOnReply,
          includeOnForward: body.includeOnForward ?? existing.includeOnForward,
        },
      });
    } else {
      await prisma.signature.create({
        data: {
          userId: session.userId,
          name: "Standard",
          htmlContent: body.signatureText ?? "",
          includeOnNewMail: body.includeOnNewMail ?? true,
          includeOnReply: body.includeOnReply ?? true,
          includeOnForward: body.includeOnForward ?? true,
          isDefault: true,
        },
      });
    }

    return ok({ settings: body });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Fehler beim Speichern", 400);
  }
}
