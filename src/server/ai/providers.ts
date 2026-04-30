import { aiResultSchema, AiAnalyzeInput, AiProvider, AiResult } from "@/server/ai/types";

const OPENAI_MODEL = "gpt-4o-mini";
const ANTHROPIC_MODEL = "claude-3-5-sonnet-latest";
const ANTHROPIC_VERSION = "2023-06-01";

const defaultMockResult: AiResult = {
  summaryShort: "Keine aktive KI verbunden, Mock-Zusammenfassung erzeugt.",
  summaryLong: "Diese Analyse stammt vom Mock-Provider und dient der MVP-Integration.",
  category: "unknown",
  priority: "normal",
  actionRequired: false,
  recommendedAction: "none",
  confidence: 0.35,
  keywords: [],
  detectedContacts: [],
  tasks: [],
};

function createPrompt(input: AiAnalyzeInput) {
  return [
    "Analysiere folgende E-Mail und antworte ausschließlich mit einem gültigen JSON-Objekt.",
    "Kein Markdown, keine Erklärtexte, nur JSON.",
    "",
    "Erwartetes JSON-Schema (alle Pflichtfelder ausfüllen):",
    JSON.stringify(
      {
        summaryShort: "string",
        summaryLong: "string",
        category:
          "invoice | offer | customer | support | contract | private | newsletter | spam | unknown",
        priority: "low | normal | high | urgent",
        actionRequired: true,
        recommendedFolder: "optional string",
        recommendedAction:
          "none | move | mark_spam | move_trash | create_contact_candidate | save_attachment",
        confidence: 0.0,
        keywords: ["string"],
        detectedContacts: [
          {
            companyName: "optional string",
            personName: "optional string",
            email: "optional string",
            phone: "optional string",
            address: "optional string",
            confidence: 0.0,
          },
        ],
        tasks: [
          {
            title: "string",
            dueDate: "optional string",
            priority: "optional low | normal | high | urgent",
          },
        ],
      },
      null,
      2,
    ),
    "",
    "E-Mail-Daten:",
    JSON.stringify(
      {
        subject: input.subject ?? "",
        from: input.from ?? "",
        body: input.body ?? "",
      },
      null,
      2,
    ),
  ].join("\n");
}

function extractJsonFromText(raw: string) {
  const trimmed = raw.trim();
  const withoutFence = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace < 0 || lastBrace <= firstBrace) {
    throw new Error("AI provider returned no JSON object");
  }
  return withoutFence.slice(firstBrace, lastBrace + 1);
}

function toBoundedConfidence(input: unknown, fallback = 0.5) {
  const num = typeof input === "number" ? input : Number(input);
  if (!Number.isFinite(num)) return fallback;
  if (num < 0) return 0;
  if (num > 1) return 1;
  return num;
}

function normalizeAndValidate(raw: unknown): AiResult {
  const candidate =
    raw && typeof raw === "object"
      ? (raw as Record<string, unknown>)
      : ({} as Record<string, unknown>);

  if (candidate.recommendedFolder === null) {
    delete candidate.recommendedFolder;
  }

  // Defensive normalization: some model outputs return confidence as e.g. 85
  // (percent) or >1. Clamp to [0..1] so zod validation does not fail the whole run.
  candidate.confidence = toBoundedConfidence(candidate.confidence, 0.35);
  if (Array.isArray(candidate.detectedContacts)) {
    candidate.detectedContacts = candidate.detectedContacts.map((item) => {
      if (!item || typeof item !== "object") return item;
      const contact = item as Record<string, unknown>;
      return {
        ...contact,
        confidence: toBoundedConfidence(contact.confidence, 0.5),
      };
    });
  }

  return aiResultSchema.parse(candidate);
}

export class MockAiProvider implements AiProvider {
  async analyzeEmail(input: AiAnalyzeInput): Promise<AiResult> {
    const summary = `${input.subject ?? "Ohne Betreff"} von ${input.from ?? "Unbekannt"}`;
    return normalizeAndValidate({
      ...defaultMockResult,
      summaryShort: summary.slice(0, 120),
      summaryLong: `${summary}. ${(input.body ?? "").slice(0, 280)}`.trim(),
      keywords: [input.subject, input.from].filter(Boolean),
    });
  }
}

export class OpenAiProvider implements AiProvider {
  constructor(private readonly explicitApiKey?: string) {}

  async analyzeEmail(input: AiAnalyzeInput): Promise<AiResult> {
    const apiKey = this.explicitApiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not configured");
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "You are an email analysis engine. Return only valid JSON with no markdown wrapper.",
          },
          {
            role: "user",
            content: createPrompt(input),
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI request failed with status ${response.status}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("OpenAI response did not contain message content");
    }

    const parsed = JSON.parse(extractJsonFromText(content));
    return normalizeAndValidate(parsed);
  }
}

export class AnthropicProvider implements AiProvider {
  constructor(private readonly explicitApiKey?: string) {}

  async analyzeEmail(input: AiAnalyzeInput): Promise<AiResult> {
    const apiKey = this.explicitApiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not configured");
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 800,
        temperature: 0.2,
        system: "Return only valid JSON. No markdown or explanations.",
        messages: [
          {
            role: "user",
            content: createPrompt(input),
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic request failed with status ${response.status}`);
    }

    const data = (await response.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const content = data.content?.find((block) => block.type === "text")?.text;
    if (!content) {
      throw new Error("Anthropic response did not contain text content");
    }

    const parsed = JSON.parse(extractJsonFromText(content));
    return normalizeAndValidate(parsed);
  }
}

export function validateAiResult(raw: unknown): AiResult {
  return normalizeAndValidate(raw);
}
