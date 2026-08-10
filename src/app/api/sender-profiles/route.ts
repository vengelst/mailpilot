import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db/prisma";
import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";

const createSchema = z.object({
  profileName: z.string().min(1),
  patterns: z.array(z.string().min(1)).min(1),
  category: z.string().min(1),
  targetFolder: z.string().min(1),
  accountId: z.string().optional(),
  autoLabels: z.array(z.string().min(1)).optional(),
});

export async function GET(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  const search = req.nextUrl.searchParams.get("q")?.toLowerCase() ?? "";

  const profiles = await prisma.senderProfile.findMany({
    where: { userId: session.userId, isActive: true },
    orderBy: { createdAt: "desc" },
  });

  const filtered = search
    ? profiles.filter(
        (p) =>
          p.profileName.toLowerCase().includes(search) ||
          p.patterns.some((pat) => pat.toLowerCase().includes(search)) ||
          p.category.toLowerCase().includes(search),
      )
    : profiles;

  return ok({ profiles: filtered });
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  try {
    const body = createSchema.parse(await req.json());

    if (body.accountId) {
      const account = await prisma.mailAccount.findFirst({
        where: { id: body.accountId, userId: session.userId },
      });
      if (!account) return fail("Konto nicht gefunden", 404);
    }

    const autoLabels = [
      ...new Set((body.autoLabels ?? []).map((l) => l.trim()).filter(Boolean)),
    ];

    const profile = await prisma.senderProfile.create({
      data: {
        userId: session.userId,
        profileName: body.profileName,
        patterns: body.patterns.map((p) => p.toLowerCase()),
        category: body.category,
        targetFolder: body.targetFolder,
        accountId: body.accountId ?? null,
        autoLabels,
      },
    });

    return ok({ profile }, 201);
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Profil konnte nicht erstellt werden",
      400,
    );
  }
}
