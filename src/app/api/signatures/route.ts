import { z } from "zod";
import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import { prisma } from "@/server/db/prisma";

const createSchema = z.object({
  name: z.string().min(1).max(100),
  htmlContent: z.string().max(100000).optional(),
  accountIds: z.array(z.string()).optional(),
  includeOnNewMail: z.boolean().optional(),
  includeOnReply: z.boolean().optional(),
  includeOnForward: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  const signatures = await prisma.signature.findMany({
    where: { userId: session.userId },
    orderBy: { createdAt: "asc" },
  });

  return ok({ signatures });
}

export async function POST(req: Request) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  try {
    const payload = createSchema.parse(await req.json());

    if (payload.isDefault) {
      await prisma.signature.updateMany({
        where: { userId: session.userId, isDefault: true },
        data: { isDefault: false },
      });
    }

    const signature = await prisma.signature.create({
      data: {
        userId: session.userId,
        name: payload.name,
        htmlContent: payload.htmlContent ?? "",
        accountIds: payload.accountIds ?? [],
        includeOnNewMail: payload.includeOnNewMail ?? true,
        includeOnReply: payload.includeOnReply ?? true,
        includeOnForward: payload.includeOnForward ?? true,
        isDefault: payload.isDefault ?? false,
      },
    });

    return ok({ signature }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail("Ungültige Daten", 400, error.issues);
    }
    return fail(error instanceof Error ? error.message : "Signatur konnte nicht erstellt werden", 500);
  }
}
