import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import { exportContactCandidateToGoogle } from "@/server/contacts/service";

async function resolveId(params: Promise<{ id: string }> | { id: string }) {
  return (await Promise.resolve(params)).id;
}

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  try {
    const id = await resolveId(context.params);
    const candidate = await exportContactCandidateToGoogle({
      id,
      userId: session.userId,
    });
    return ok({ candidate });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Export failed";
    if (message.toLowerCase().includes("not found")) return fail("Contact candidate not found", 404);
    return fail(message, 400);
  }
}
