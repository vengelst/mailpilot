import { NextRequest } from "next/server";
import { z } from "zod";
import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import { prisma } from "@/server/db/prisma";

const querySchema = z.object({
  status: z.enum(["pending", "exported", "ignored", "duplicate"]).optional(),
});

export async function GET(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  const parsed = querySchema.safeParse({
    status: req.nextUrl.searchParams.get("status") ?? undefined,
  });
  if (!parsed.success) return fail("Invalid status filter", 400);

  const candidates = await prisma.contactCandidate.findMany({
    where: {
      emailIndex: {
        account: {
          userId: session.userId,
        },
      },
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
    },
    include: {
      emailIndex: {
        select: {
          id: true,
          subject: true,
          fromEmail: true,
          date: true,
          accountId: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return ok({ candidates });
}
