import { NextRequest } from "next/server";
import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import { loadMessageBody } from "@/server/imap/imapService";

async function resolveId(params: Promise<{ id: string }>) {
  return (await params).id;
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  try {
    const id = await resolveId(context.params);
    const force = req.nextUrl.searchParams.get("refresh") === "1";
    const body = await loadMessageBody(id, session.userId, { force });
    return ok({ body });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Body load failed";
    if (message.toLowerCase().includes("not found")) return fail("Email not found", 404);
    return fail(message, 400);
  }
}
