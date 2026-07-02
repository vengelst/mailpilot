import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db/prisma";
import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";

const labelSchema = z.object({
  label: z.string().min(1),
});

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  const { id } = await context.params;

  const email = await prisma.emailIndex.findFirst({
    where: { id, account: { userId: session.userId } },
    select: { id: true, labels: true },
  });
  if (!email) return fail("E-Mail nicht gefunden", 404);

  try {
    const { label } = labelSchema.parse(await req.json());

    if (email.labels.includes(label)) {
      return ok({ labels: email.labels });
    }

    const updated = await prisma.emailIndex.update({
      where: { id },
      data: { labels: [...email.labels, label] },
      select: { labels: true },
    });

    return ok({ labels: updated.labels });
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Label konnte nicht hinzugefügt werden",
      400,
    );
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  const { id } = await context.params;

  const email = await prisma.emailIndex.findFirst({
    where: { id, account: { userId: session.userId } },
    select: { id: true, labels: true },
  });
  if (!email) return fail("E-Mail nicht gefunden", 404);

  try {
    const { label } = labelSchema.parse(await req.json());

    const updated = await prisma.emailIndex.update({
      where: { id },
      data: { labels: email.labels.filter((l) => l !== label) },
      select: { labels: true },
    });

    return ok({ labels: updated.labels });
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Label konnte nicht entfernt werden",
      400,
    );
  }
}
