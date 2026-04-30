import { prisma } from "@/server/db/prisma";
import { decryptSecret } from "@/server/security/crypto";

export type AiProviderName = "mock" | "openai" | "anthropic";

export type ResolvedAiConfig = {
  provider: AiProviderName;
  label: string;
  isRealProvider: boolean;
  hasApiKey: boolean;
  source: "database" | "env" | "default";
  warning: string | null;
};

export type AiRuntimeConfig = {
  provider: AiProviderName;
  openAiApiKey?: string;
  anthropicApiKey?: string;
  source: "database" | "env" | "default";
};

function normalizeProvider(raw: string | null | undefined): AiProviderName {
  const lower = (raw ?? "").trim().toLowerCase();
  if (lower === "openai") return "openai";
  if (lower === "anthropic") return "anthropic";
  return "mock";
}

function labelFor(provider: AiProviderName) {
  if (provider === "openai") return "OpenAI";
  if (provider === "anthropic") return "Anthropic / Claude";
  return "Mock";
}

function buildWarning(provider: AiProviderName, hasApiKey: boolean): string | null {
  if (provider === "mock") {
    return "Mock-Modus aktiv: Es wird keine echte KI verwendet. Ergebnisse dienen nur zum Testen.";
  }
  if (!hasApiKey) {
    return `${labelFor(provider)} ist konfiguriert, aber API-Key fehlt. KI-Aufrufe werden fehlschlagen.`;
  }
  return null;
}

/**
 * Resolve the AI config for a user — DB-first, .env-fallback, mock as last resort.
 *
 * Priority order:
 *   1. AiSettings row in DB (per-user override)
 *   2. process.env.AI_PROVIDER + matching API key
 *   3. mock (default)
 *
 * NEVER returns API keys. Use `resolveAiRuntimeConfig` if the actual key is needed
 * for a server-side provider call.
 */
export async function resolveAiConfig(userId: string): Promise<ResolvedAiConfig> {
  const settings = await prisma.aiSettings.findUnique({
    where: { userId },
    select: {
      provider: true,
      openAiApiKeySet: true,
      anthropicApiKeySet: true,
    },
  });

  if (settings) {
    const provider = normalizeProvider(settings.provider);
    const hasApiKey =
      provider === "openai"
        ? settings.openAiApiKeySet
        : provider === "anthropic"
          ? settings.anthropicApiKeySet
          : false;
    return {
      provider,
      label: labelFor(provider),
      isRealProvider: provider !== "mock",
      hasApiKey,
      source: "database",
      warning: buildWarning(provider, hasApiKey),
    };
  }

  const envValue = process.env.AI_PROVIDER?.trim();
  const provider = normalizeProvider(envValue ?? "mock");
  const hasApiKey =
    provider === "openai"
      ? !!process.env.OPENAI_API_KEY?.trim()
      : provider === "anthropic"
        ? !!process.env.ANTHROPIC_API_KEY?.trim()
        : false;
  return {
    provider,
    label: labelFor(provider),
    isRealProvider: provider !== "mock",
    hasApiKey,
    source: envValue ? "env" : "default",
    warning: buildWarning(provider, hasApiKey),
  };
}

/**
 * Server-only — returns the actual API keys needed to call a provider.
 *
 * MUST NOT be exposed via any HTTP response. Always called from inside an API
 * route on the server, the result decrypted in-memory and passed to the
 * provider class.
 */
export async function resolveAiRuntimeConfig(
  userId: string,
): Promise<AiRuntimeConfig> {
  const settings = await prisma.aiSettings.findUnique({
    where: { userId },
    select: {
      provider: true,
      encryptedOpenAiApiKey: true,
      encryptedAnthropicApiKey: true,
    },
  });

  if (settings) {
    return {
      provider: normalizeProvider(settings.provider),
      openAiApiKey: settings.encryptedOpenAiApiKey
        ? decryptSecret(settings.encryptedOpenAiApiKey)
        : undefined,
      anthropicApiKey: settings.encryptedAnthropicApiKey
        ? decryptSecret(settings.encryptedAnthropicApiKey)
        : undefined,
      source: "database",
    };
  }

  const envValue = process.env.AI_PROVIDER?.trim();
  return {
    provider: normalizeProvider(envValue ?? "mock"),
    openAiApiKey: process.env.OPENAI_API_KEY?.trim() || undefined,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY?.trim() || undefined,
    source: envValue ? "env" : "default",
  };
}
