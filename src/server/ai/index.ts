import {
  AnthropicProvider,
  MockAiProvider,
  OpenAiProvider,
  validateAiResult,
} from "@/server/ai/providers";
import { AiProvider } from "@/server/ai/types";
import { resolveAiRuntimeConfig, AiRuntimeConfig } from "@/server/ai/aiConfig";

function buildProvider(runtime: AiRuntimeConfig): AiProvider {
  if (runtime.provider === "openai") return new OpenAiProvider(runtime.openAiApiKey);
  if (runtime.provider === "anthropic") return new AnthropicProvider(runtime.anthropicApiKey);
  return new MockAiProvider();
}

/**
 * Run the email-classification provider for a specific user.
 *
 * Uses `resolveAiRuntimeConfig` so the per-user DB setting takes precedence
 * over `.env`. The returned API keys are kept in-memory only and never
 * propagated outside this call.
 */
export async function analyzeEmailForUser(
  userId: string,
  input: {
    subject?: string | null;
    from?: string | null;
    body?: string | null;
  },
) {
  const runtime = await resolveAiRuntimeConfig(userId);
  const result = await buildProvider(runtime).analyzeEmail(input);
  return validateAiResult(result);
}
