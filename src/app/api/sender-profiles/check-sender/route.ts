import { NextRequest } from "next/server";
import { prisma } from "@/server/db/prisma";
import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import { matchesSenderProfile } from "@/server/rules/senderMatcher";

export async function GET(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  const email = req.nextUrl.searchParams.get("email");
  if (!email) return fail("Query-Parameter 'email' fehlt", 400);

  const profiles = await prisma.senderProfile.findMany({
    where: { userId: session.userId, isActive: true },
  });

  const matched = profiles.find((p) => matchesSenderProfile(email, p.patterns));

  if (matched) {
    return ok({
      matched: true,
      profile: {
        profileName: matched.profileName,
        category: matched.category,
        targetFolder: matched.targetFolder,
      },
    });
  }

  return ok({ matched: false });
}
