import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db/prisma";
import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";

const updateSchema = z.object({
  profileName: z.string().min(1).optional(),
  patterns: z.array(z.string().min(1)).min(1).optional(),
  category: z.string().min(1).optional(),
  targetFolder: z.string().min(1).optional(),
  accountId: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  autoLabels: z.array(z.string().min(1)).optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  const { id } = await ctx.params;
  const profile = await prisma.senderProfile.findFirst({
    where: { id, userId: session.userId },
  });
  if (!profile) return fail("Profil nicht gefunden", 404);
  return ok({ profile });
}

export async function PUT(req: NextRequest, ctx: RouteContext) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  const { id } = await ctx.params;
  const existing = await prisma.senderProfile.findFirst({
    where: { id, userId: session.userId },
  });
  if (!existing) return fail("Profil nicht gefunden", 404);

  try {
    const body = updateSchema.parse(await req.json());

    const autoLabels =
      body.autoLabels !== undefined
        ? [...new Set(body.autoLabels.map((l) => l.trim()).filter(Boolean))]
        : undefined;

    const profile = await prisma.senderProfile.update({
      where: { id },
      data: {
        ...(body.profileName !== undefined && { profileName: body.profileName }),
        ...(body.patterns !== undefined && {
          patterns: body.patterns.map((p) => p.toLowerCase()),
        }),
        ...(body.category !== undefined && { category: body.category }),
        ...(body.targetFolder !== undefined && { targetFolder: body.targetFolder }),
        ...(body.accountId !== undefined && { accountId: body.accountId }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
        ...(autoLabels !== undefined && { autoLabels }),
      },
    });

    return ok({ profile });
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Profil konnte nicht aktualisiert werden",
      400,
    );
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  const { id } = await ctx.params;
  const existing = await prisma.senderProfile.findFirst({
    where: { id, userId: session.userId },
  });
  if (!existing) return fail("Profil nicht gefunden", 404);

  await prisma.senderProfile.delete({ where: { id } });
  return ok({ deleted: true });
}
