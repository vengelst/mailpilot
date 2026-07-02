import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db/prisma";
import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z.string().max(20).nullable().optional(),
  icon: z.string().max(10).nullable().optional(),
});

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  const { id } = await context.params;

  const label = await prisma.emailLabel.findFirst({
    where: { id, userId: session.userId },
  });
  if (!label) return fail("Label nicht gefunden", 404);

  try {
    const body = updateSchema.parse(await req.json());

    const oldName = label.name;
    const newName = body.name ?? oldName;

    if (newName !== oldName) {
      const dup = await prisma.emailLabel.findUnique({
        where: { userId_name: { userId: session.userId, name: newName } },
      });
      if (dup) return fail("Label-Name existiert bereits", 409);
    }

    const updated = await prisma.emailLabel.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.color !== undefined ? { color: body.color } : {}),
        ...(body.icon !== undefined ? { icon: body.icon } : {}),
      },
    });

    if (newName !== oldName) {
      const accounts = await prisma.mailAccount.findMany({
        where: { userId: session.userId },
        select: { id: true },
      });
      const accountIds = accounts.map((a) => a.id);

      const emailsWithLabel = await prisma.emailIndex.findMany({
        where: {
          accountId: { in: accountIds },
          labels: { has: oldName },
        },
        select: { id: true, labels: true },
      });

      for (const email of emailsWithLabel) {
        const newLabels = email.labels.map((l) => (l === oldName ? newName : l));
        await prisma.emailIndex.update({
          where: { id: email.id },
          data: { labels: newLabels },
        });
      }
    }

    return ok({ label: updated });
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Label konnte nicht aktualisiert werden",
      400,
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  const { id } = await context.params;

  const label = await prisma.emailLabel.findFirst({
    where: { id, userId: session.userId },
  });
  if (!label) return fail("Label nicht gefunden", 404);

  const accounts = await prisma.mailAccount.findMany({
    where: { userId: session.userId },
    select: { id: true },
  });
  const accountIds = accounts.map((a) => a.id);

  const emailsWithLabel = await prisma.emailIndex.findMany({
    where: {
      accountId: { in: accountIds },
      labels: { has: label.name },
    },
    select: { id: true, labels: true },
  });

  for (const email of emailsWithLabel) {
    const newLabels = email.labels.filter((l) => l !== label.name);
    await prisma.emailIndex.update({
      where: { id: email.id },
      data: { labels: newLabels },
    });
  }

  await prisma.emailLabel.delete({ where: { id } });

  return ok({ ok: true });
}
