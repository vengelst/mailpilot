import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import { prisma } from "@/server/db/prisma";
import { encryptSecret } from "@/server/security/crypto";
import { writeAuditLog } from "@/server/audit/auditLog";

/**
 * Per-user AI provider settings.
 *
 * GET  → status only (no API keys, only booleans + provider name)
 * PUT  → set provider and/or rotate/clear API keys (encrypted at rest)
 *
 * Hard rules:
 *   - API keys never leave the server
 *   - PUT response NEVER echoes back the submitted key
 *   - Audit payload contains only provider + key-presence booleans
 */

const putSchema = z
  .object({
    provider: z.enum(["mock", "openai", "anthropic"]).optional(),
    openAiApiKey: z.string().optional(),
    anthropicApiKey: z.string().optional(),
    clearOpenAiApiKey: z.boolean().optional(),
    clearAnthropicApiKey: z.boolean().optional(),
  })
  .strict();

function userFacingError(message: string) {
  // Sanitize technical errors so the UI never sees Prisma stack traces or
  // crypto-key hints. Detailed cause stays in the server log.
  if (/^Invalid `prisma\.|PrismaClient/.test(message)) {
    return "Speichern fehlgeschlagen — Datenbankfehler. Bitte später erneut versuchen.";
  }
  if (/APP_ENCRYPTION_KEY/.test(message)) {
    return "Speichern fehlgeschlagen — Verschlüsselungs-Key fehlt auf dem Server.";
  }
  return message;
}

export async function GET() {
  try {
    const session = await getSessionFromCookies();
    if (!session) return fail("Unauthorized", 401);

    const settings = await prisma.aiSettings.findUnique({
      where: { userId: session.userId },
      select: {
        provider: true,
        openAiApiKeySet: true,
        anthropicApiKeySet: true,
      },
    });

    if (settings) {
      return ok({
        provider: settings.provider,
        openAiApiKeySet: settings.openAiApiKeySet,
        anthropicApiKeySet: settings.anthropicApiKeySet,
        source: "database",
      });
    }

    // No DB row yet — show what .env would deliver, so the UI can still
    // display "OpenAI configured via .env" without needing a DB write.
    const envProvider = (process.env.AI_PROVIDER ?? "mock").toLowerCase();
    const provider =
      envProvider === "openai" ? "openai" : envProvider === "anthropic" ? "anthropic" : "mock";
    return ok({
      provider,
      openAiApiKeySet: !!process.env.OPENAI_API_KEY?.trim(),
      anthropicApiKeySet: !!process.env.ANTHROPIC_API_KEY?.trim(),
      source: process.env.AI_PROVIDER ? "env" : "default",
    });
  } catch (error) {
    return fail(
      userFacingError(error instanceof Error ? error.message : "Failed to load AI settings"),
      500,
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getSessionFromCookies();
    if (!session) return fail("Unauthorized", 401);

    let body: z.infer<typeof putSchema>;
    try {
      body = putSchema.parse(await req.json().catch(() => ({})));
    } catch (error) {
      return fail(error instanceof Error ? error.message : "Invalid payload", 400);
    }

    // Build update fields. Empty string is treated as "no new key" — clearing
    // requires explicit `clearXxxApiKey: true`.
    const updateData: Prisma.AiSettingsUncheckedUpdateInput = {};
    const createData: Prisma.AiSettingsUncheckedCreateInput = { userId: session.userId };

    if (body.provider !== undefined) {
      updateData.provider = body.provider;
      createData.provider = body.provider;
    }

    if (body.clearOpenAiApiKey) {
      updateData.encryptedOpenAiApiKey = null;
      updateData.openAiApiKeySet = false;
    } else if (body.openAiApiKey && body.openAiApiKey.trim()) {
      updateData.encryptedOpenAiApiKey = encryptSecret(body.openAiApiKey.trim());
      updateData.openAiApiKeySet = true;
    }

    if (body.clearAnthropicApiKey) {
      updateData.encryptedAnthropicApiKey = null;
      updateData.anthropicApiKeySet = false;
    } else if (body.anthropicApiKey && body.anthropicApiKey.trim()) {
      updateData.encryptedAnthropicApiKey = encryptSecret(body.anthropicApiKey.trim());
      updateData.anthropicApiKeySet = true;
    }

    const saved = await prisma.aiSettings.upsert({
      where: { userId: session.userId },
      update: updateData,
      create: createData,
      select: {
        provider: true,
        openAiApiKeySet: true,
        anthropicApiKeySet: true,
      },
    });

    await writeAuditLog({
      userId: session.userId,
      action: "ai.settings.updated",
      actor: "user",
      afterJson: {
        provider: saved.provider,
        openAiApiKeySet: saved.openAiApiKeySet,
        anthropicApiKeySet: saved.anthropicApiKeySet,
      },
    });

    return ok({
      provider: saved.provider,
      openAiApiKeySet: saved.openAiApiKeySet,
      anthropicApiKeySet: saved.anthropicApiKeySet,
      source: "database",
    });
  } catch (error) {
    return fail(
      userFacingError(error instanceof Error ? error.message : "Failed to save AI settings"),
      500,
    );
  }
}
