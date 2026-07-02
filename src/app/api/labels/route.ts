import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db/prisma";
import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";

const createSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().max(20).optional(),
  icon: z.string().max(10).optional(),
});

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  const labels = await prisma.emailLabel.findMany({
    where: { userId: session.userId },
    orderBy: { name: "asc" },
  });

  const accounts = await prisma.mailAccount.findMany({
    where: { userId: session.userId },
    select: { id: true },
  });
  const accountIds = accounts.map((a) => a.id);

  const counts = await Promise.all(
    labels.map(async (label) => {
      const count = await prisma.emailIndex.count({
        where: {
          accountId: { in: accountIds },
          labels: { has: label.name },
        },
      });
      return { ...label, emailCount: count };
    }),
  );

  return ok({ labels: counts });
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  try {
    const body = createSchema.parse(await req.json());

    const existing = await prisma.emailLabel.findUnique({
      where: { userId_name: { userId: session.userId, name: body.name } },
    });
    if (existing) return fail("Label existiert bereits", 409);

    const label = await prisma.emailLabel.create({
      data: {
        userId: session.userId,
        name: body.name,
        color: body.color ?? null,
        icon: body.icon ?? null,
      },
    });

    return ok({ label }, 201);
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Label konnte nicht erstellt werden",
      400,
    );
  }
}
