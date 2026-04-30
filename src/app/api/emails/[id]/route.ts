import { prisma } from "@/server/db/prisma";
import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";

async function resolveId(params: Promise<{ id: string }>) {
  return (await params).id;
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);
  const id = await resolveId(context.params);

  const email = await prisma.emailIndex.findFirst({
    where: { id, account: { userId: session.userId } },
    include: { attachments: true },
  });
  if (!email) return fail("Email not found", 404);
  return ok({ email });
}
