import { NextRequest } from "next/server";
import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import { parseOauthState, upsertCloudAccountFromCallback } from "@/server/cloud/oauth";
import { writeAuditLog } from "@/server/audit/auditLog";

export async function GET(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  const state = req.nextUrl.searchParams.get("state");
  const code = req.nextUrl.searchParams.get("code");
  if (!state || !code) return fail("Missing oauth callback parameters", 400);

  const parsed = parseOauthState(state);
  if (!parsed || parsed.userId !== session.userId) {
    return fail("Invalid oauth state", 400);
  }

  const account = await upsertCloudAccountFromCallback({
    provider: parsed.provider,
    userId: session.userId,
    code,
  });

  await writeAuditLog({
    userId: session.userId,
    action: "cloud.account.connected",
    actor: "user",
    afterJson: { cloudAccountId: account.id, provider: account.provider },
  });

  return ok({ ok: true, provider: account.provider, cloudAccountId: account.id });
}
