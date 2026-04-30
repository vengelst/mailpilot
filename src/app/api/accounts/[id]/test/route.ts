import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import { testAccountConnection } from "@/server/imap/imapService";
import { writeAuditLog } from "@/server/audit/auditLog";

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
    const accountId = await resolveId(context.params);
    const result = await testAccountConnection(accountId, session.userId);
    await writeAuditLog({
      userId: session.userId,
      accountId,
      action: "imap.connection_tested",
      actor: "user",
      afterJson: result,
    });
    return ok(result);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Connection test failed", 400);
  }
}
