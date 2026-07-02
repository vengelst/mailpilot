import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db/prisma";
import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import { matchesSenderProfile } from "@/server/rules/senderMatcher";

const schema = z.object({
  email: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  try {
    const { email } = schema.parse(await req.json());

    const profiles = await prisma.senderProfile.findMany({
      where: { userId: session.userId, isActive: true },
    });

    const match = profiles.find((p) => matchesSenderProfile(email, p.patterns));
    return ok({ profile: match ?? null });
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Match fehlgeschlagen",
      400,
    );
  }
}
