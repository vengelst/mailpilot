import { NextResponse } from "next/server";
import { clearSessionCookie, getSessionFromCookies } from "@/server/auth/session";
import { writeAuditLog } from "@/server/audit/auditLog";

export async function POST() {
  const session = await getSessionFromCookies();
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res);

  if (session?.userId) {
    await writeAuditLog({
      userId: session.userId,
      action: "auth.logout",
      actor: "user",
    });
  }

  return res;
}
