import { NextRequest } from "next/server";
import { z } from "zod";
import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import { resolveAiRuntimeConfig } from "@/server/ai/aiConfig";
import { writeAuditLog } from "@/server/audit/auditLog";

/**
 * Validates that the active provider is reachable.
 *
 * For openai/anthropic this performs a tiny live request (1 token) so the
 * user gets immediate feedback whether the API key works. For mock it just
 * confirms mock mode.
 *
 * NEVER returns the API key. Errors are sanitized — only HTTP status / generic
 * "auth failed" / "network failed" surface to the client.
 */

const schema = z
  .object({
    provider: z.enum(["mock", "openai", "anthropic"]).optional(),
  })
  .strict();

async function pingOpenAi(apiKey: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      method: "GET",
      headers: { authorization: `Bearer ${apiKey}` },
    });
    if (res.status === 401) return { ok: false, reason: "API-Key abgelehnt (401)." };
    if (!res.ok) return { ok: false, reason: `OpenAI antwortete mit Status ${res.status}.` };
    return { ok: true };
  } catch {
    return { ok: false, reason: "Netzwerkfehler beim Aufruf von OpenAI." };
  }
}

async function pingAnthropic(apiKey: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    // Minimal valid messages call — Anthropic has no GET /models endpoint.
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-latest",
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      }),
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: "API-Key abgelehnt." };
    }
    if (!res.ok) {
      return { ok: false, reason: `Anthropic antwortete mit Status ${res.status}.` };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "Netzwerkfehler beim Aufruf von Anthropic." };
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromCookies();
    if (!session) return fail("Unauthorized", 401);

    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return fail("Invalid payload", 400);

    const runtime = await resolveAiRuntimeConfig(session.userId);
    const target = parsed.data.provider ?? runtime.provider;

  let result: { provider: typeof target; success: boolean; message: string };

  if (target === "mock") {
    result = {
      provider: "mock",
      success: true,
      message: "Mock-Modus aktiv. Es wird keine echte KI-Anfrage gemacht.",
    };
  } else if (target === "openai") {
    const key = runtime.openAiApiKey;
    if (!key) {
      result = {
        provider: "openai",
        success: false,
        message: "OPENAI_API_KEY ist nicht gesetzt — bitte unter /settings/ai hinterlegen.",
      };
    } else {
      const ping = await pingOpenAi(key);
      result = ping.ok
        ? { provider: "openai", success: true, message: "OpenAI-Verbindung erfolgreich." }
        : { provider: "openai", success: false, message: ping.reason };
    }
  } else {
    const key = runtime.anthropicApiKey;
    if (!key) {
      result = {
        provider: "anthropic",
        success: false,
        message: "ANTHROPIC_API_KEY ist nicht gesetzt — bitte unter /settings/ai hinterlegen.",
      };
    } else {
      const ping = await pingAnthropic(key);
      result = ping.ok
        ? { provider: "anthropic", success: true, message: "Anthropic-Verbindung erfolgreich." }
        : { provider: "anthropic", success: false, message: ping.reason };
    }
  }

    await writeAuditLog({
      userId: session.userId,
      action: "ai.settings.tested",
      actor: "user",
      afterJson: { provider: result.provider, success: result.success },
    });

    return ok(result);
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Test fehlgeschlagen.",
      500,
    );
  }
}
