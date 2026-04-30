import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import { resolveAiConfig } from "@/server/ai/aiConfig";

/**
 * Reports the active AI provider for the UI banner.
 *
 * Resolves DB-first (per-user `AiSettings`), falls back to `.env`, then mock.
 * NEVER returns API keys. The client only learns whether a key is configured.
 */
export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  const config = await resolveAiConfig(session.userId);
  return ok(config);
}
