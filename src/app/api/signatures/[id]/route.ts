import { z } from "zod";
import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import { prisma } from "@/server/db/prisma";

const patchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  htmlContent: z.string().max(100000).optional(),
  accountIds: z.array(z.string()).optional(),
  includeOnNewMail: z.boolean().optional(),
  includeOnReply: z.boolean().optional(),
  includeOnForward: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  const { id } = await params;

  const existing = await prisma.signature.findFirst({
    where: { id, userId: session.userId },
  });
  if (!existing) return fail("Signatur nicht gefunden", 404);

  try {
    const payload = patchSchema.parse(await req.json());

    if (payload.isDefault) {
      await prisma.signature.updateMany({
        where: { userId: session.userId, isDefault: true },
        data: { isDefault: false },
      });
    }

    const signature = await prisma.signature.update({
      where: { id },
      data: payload,
    });

    return ok({ signature });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail("Ungültige Daten", 400, error.issues);
    }
    return fail(error instanceof Error ? error.message : "Signatur konnte nicht aktualisiert werden", 500);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  const { id } = await params;

  const existing = await prisma.signature.findFirst({
    where: { id, userId: session.userId },
  });
  if (!existing) return fail("Signatur nicht gefunden", 404);

  await prisma.signature.delete({ where: { id } });

  return ok({ deleted: true });
}
