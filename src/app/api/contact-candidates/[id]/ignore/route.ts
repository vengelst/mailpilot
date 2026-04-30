import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import { updateContactCandidateStatus } from "@/server/contacts/service";

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
    const candidate = await updateContactCandidateStatus({
      id,
      userId: session.userId,
      status: "ignored",
    });
    return ok({ candidate });
  } catch {
    return fail("Contact candidate not found", 404);
  }
}
