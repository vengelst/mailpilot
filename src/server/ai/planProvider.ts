import {
  AiMailCandidate,
  AiMailPlan,
  aiMailPlanSchema,
  buildPlanPrompt,
} from "@/server/ai/mailPlan";

const OPENAI_MODEL = "gpt-4o-mini";
const ANTHROPIC_MODEL = "claude-3-5-sonnet-latest";
const ANTHROPIC_VERSION = "2023-06-01";

function extractJson(raw: string) {
  const trimmed = raw.trim();
  const withoutFence = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace < 0 || lastBrace <= firstBrace) {
    throw new Error("Plan provider returned no JSON object");
  }
  return withoutFence.slice(firstBrace, lastBrace + 1);
}

function parseAndValidate(raw: unknown): AiMailPlan {
  const candidate =
    raw && typeof raw === "object"
      ? (raw as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  return aiMailPlanSchema.parse(candidate);
}

function mockPlan(input: {
  prompt: string;
  candidates: AiMailCandidate[];
}): AiMailPlan {
  // Mock-Modus = KEINE echte KI. Wir geben absichtlich KEINE Kategorisierungs-
  // Vorschläge aus, damit das UI nicht so wirkt, als hätte ein echter Provider
  // den Prompt verstanden. Stattdessen liefern wir einen klaren Hinweis, dass
  // kein Provider verbunden ist.
  void input.prompt;
  return {
    summary:
      `Mock-Modus aktiv — keine echte KI-Auswertung. ${input.candidates.length} ` +
      `Kandidaten wurden anhand der deterministischen Vorfilter (Suchbegriffe / Zeitraum) ` +
      `gefunden, aber ohne echten Provider werden keine Aktionen vorgeschlagen. ` +
      `Setze AI_PROVIDER=openai oder AI_PROVIDER=anthropic plus passenden API-Key in der ` +
      `.env, damit hier ein echter Plan entsteht.`,
    actions: [],
  };
}

async function generateWithOpenAi(prompt: string, apiKey?: string): Promise<AiMailPlan> {
  const effectiveKey = apiKey ?? process.env.OPENAI_API_KEY;
  if (!effectiveKey) throw new Error("OPENAI_API_KEY is not configured");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${effectiveKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content:
            "You are an email assistant. Return only valid JSON matching the requested schema. No markdown.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`OpenAI plan request failed with status ${response.status}`);
  }
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI plan response had no content");
  return parseAndValidate(JSON.parse(extractJson(content)));
}

async function generateWithAnthropic(prompt: string, apiKey?: string): Promise<AiMailPlan> {
  const effectiveKey = apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!effectiveKey) throw new Error("ANTHROPIC_API_KEY is not configured");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": effectiveKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 2000,
      temperature: 0.1,
      system: "Return only valid JSON matching the requested schema. No markdown.",
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) {
    throw new Error(`Anthropic plan request failed with status ${response.status}`);
  }
  const data = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const content = data.content?.find((block) => block.type === "text")?.text;
  if (!content) throw new Error("Anthropic plan response had no content");
  return parseAndValidate(JSON.parse(extractJson(content)));
}

export async function generateMailPlan(input: {
  prompt: string;
  candidates: AiMailCandidate[];
  availableFolders: string[];
  /**
   * Server-resolved runtime config. When omitted, falls back to env-only.
   * Pass result of `resolveAiRuntimeConfig(userId)` to honour per-user DB
   * settings.
   */
  runtimeConfig?: {
    provider: "mock" | "openai" | "anthropic";
    openAiApiKey?: string;
    anthropicApiKey?: string;
  };
}): Promise<AiMailPlan> {
  const provider =
    input.runtimeConfig?.provider ??
    ((process.env.AI_PROVIDER ?? "mock").toLowerCase() as "mock" | "openai" | "anthropic");
  const fullPrompt = buildPlanPrompt(input);

  if (provider === "openai") {
    return generateWithOpenAi(fullPrompt, input.runtimeConfig?.openAiApiKey);
  }
  if (provider === "anthropic") {
    return generateWithAnthropic(fullPrompt, input.runtimeConfig?.anthropicApiKey);
  }
  return mockPlan(input);
}
