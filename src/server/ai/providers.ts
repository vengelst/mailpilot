/**
 * AI provider implementations for email analysis.
 *
 * This module supplies a set of `AiProvider` adapters — Mock, OpenAI, and
 * Anthropic — that accept raw email data, send it to the respective LLM API,
 * and return a validated, schema-conforming `AiResult`.
 *
 * Every provider shares the same prompt template (`createPrompt`) and the same
 * response-normalisation pipeline (`extractJsonFromText` → `normalizeAndValidate`)
 * so that downstream consumers always receive a consistent result shape
 * regardless of which backend is active.
 */

import { aiResultSchema, AiAnalyzeInput, AiProvider, AiResult } from "@/server/ai/types";

/** Model identifiers and API version strings used by each provider. */
const OPENAI_MODEL = "gpt-4o-mini";
const ANTHROPIC_MODEL = "claude-sonnet-4-20250514";
const ANTHROPIC_VERSION = "2023-06-01";

/** Fallback result returned by the mock provider when no real AI backend is active. */
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

/**
 * Build the system prompt sent to the LLM.
 *
 * The prompt instructs the model to analyse the given email and respond with
 * a single JSON object that matches the expected `AiResult` schema.
 *
 * @param input - Email metadata (subject, sender, body) to embed in the prompt.
 * @returns A single string containing the full prompt text.
 */
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

/**
 * Extract the first complete JSON object from an LLM response string.
 *
 * Models sometimes wrap their JSON in markdown code fences (`\`\`\`json … \`\`\``).
 * This function strips those fences and then locates the outermost `{ … }`
 * block so `JSON.parse` receives clean input.
 *
 * @param raw - The raw text response from the AI provider.
 * @returns The extracted JSON substring (not yet parsed).
 * @throws If no valid `{ … }` block is found in the response.
 */
function extractJsonFromText(raw: string) {
  const trimmed = raw.trim();

  // Strip optional markdown code fences the model may have added
  const withoutFence = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  // Locate the outermost JSON object boundaries
  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace < 0 || lastBrace <= firstBrace) {
    throw new Error("AI provider returned no JSON object");
  }
  return withoutFence.slice(firstBrace, lastBrace + 1);
}

/**
 * Clamp a confidence value to the `[0, 1]` range.
 *
 * Some models return confidence as a percentage (e.g. 85) or as a negative
 * number. This helper coerces the value to a valid probability and falls
 * back to `fallback` when the input is non-numeric or non-finite.
 *
 * @param input   - Raw confidence value (may be number, string, or undefined).
 * @param fallback - Value returned when `input` cannot be interpreted as a
 *                   finite number. Defaults to `0.5`.
 * @returns A number in `[0, 1]`.
 */
function toBoundedConfidence(input: unknown, fallback = 0.5) {
  const num = typeof input === "number" ? input : Number(input);
  if (!Number.isFinite(num)) return fallback;
  if (num < 0) return 0;
  if (num > 1) return 1;
  return num;
}

/**
 * Normalize a raw AI response object and validate it against `aiResultSchema`.
 *
 * Performs several defensive fixes before passing the data to Zod:
 * - Removes explicit `null` values that the schema does not accept
 *   (e.g. `recommendedFolder: null`).
 * - Clamps top-level and per-contact `confidence` to `[0, 1]`.
 * - Strips `null` fields from each `detectedContacts` entry so optional
 *   properties are simply omitted rather than set to `null`.
 *
 * @param raw - Untyped object (typically the parsed JSON from an LLM response).
 * @returns A fully validated `AiResult`.
 * @throws {ZodError} If the normalized object still fails schema validation.
 */
function normalizeAndValidate(raw: unknown): AiResult {
  // Fall back to an empty object when the input is not a plain object
  const candidate =
    raw && typeof raw === "object"
      ? (raw as Record<string, unknown>)
      : ({} as Record<string, unknown>);

  // Zod expects the optional field to be absent rather than explicitly `null`
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
      // Strip null-valued optional fields from each contact entry
      const cleaned: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(contact)) {
        if (value === null) continue;
        cleaned[key] = value;
      }
      return {
        ...cleaned,
        confidence: toBoundedConfidence(cleaned.confidence, 0.5),
      };
    });
  }

  return aiResultSchema.parse(candidate);
}

/**
 * Mock provider for local development and testing.
 *
 * Returns a deterministic, pre-defined result without calling any external API.
 * The summary is derived from the email subject and sender so that the output
 * still reflects the input to some degree.
 */
export class MockAiProvider implements AiProvider {
  /**
   * Analyse an email using a static mock result.
   *
   * @param input - Email metadata to incorporate into the mock summary.
   * @returns A normalised `AiResult` based on `defaultMockResult`.
   */
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

/**
 * Provider that delegates email analysis to the OpenAI Chat Completions API.
 *
 * Uses the model specified by `OPENAI_MODEL` and a low temperature to keep
 * results deterministic.
 */
export class OpenAiProvider implements AiProvider {
  /** @param explicitApiKey - Optional API key; falls back to `OPENAI_API_KEY` env var. */
  constructor(private readonly explicitApiKey?: string) {}

  /**
   * Send the email to OpenAI for analysis and return the validated result.
   *
   * @param input - Email metadata (subject, sender, body).
   * @returns A validated `AiResult` parsed from the model's JSON response.
   * @throws If the API key is missing, the request fails, or the response
   *         does not contain valid JSON.
   */
  async analyzeEmail(input: AiAnalyzeInput): Promise<AiResult> {
    // Prefer an explicitly provided key; fall back to the environment variable
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

/**
 * Provider that delegates email analysis to the Anthropic Messages API.
 *
 * Uses the model specified by `ANTHROPIC_MODEL` with a capped `max_tokens`
 * and low temperature for concise, deterministic JSON output.
 */
export class AnthropicProvider implements AiProvider {
  /** @param explicitApiKey - Optional API key; falls back to `ANTHROPIC_API_KEY` env var. */
  constructor(private readonly explicitApiKey?: string) {}

  /**
   * Send the email to Anthropic for analysis and return the validated result.
   *
   * @param input - Email metadata (subject, sender, body).
   * @returns A validated `AiResult` parsed from the model's JSON response.
   * @throws If the API key is missing, the request fails, or the response
   *         does not contain valid JSON.
   */
  async analyzeEmail(input: AiAnalyzeInput): Promise<AiResult> {
    // Prefer an explicitly provided key; fall back to the environment variable
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
    // Anthropic responses contain an array of content blocks; pick the first text block
    const content = data.content?.find((block) => block.type === "text")?.text;
    if (!content) {
      throw new Error("Anthropic response did not contain text content");
    }

    const parsed = JSON.parse(extractJsonFromText(content));
    return normalizeAndValidate(parsed);
  }
}

/**
 * Public entry point for normalising and validating an arbitrary value as an `AiResult`.
 *
 * Useful outside of providers — e.g. when re-validating cached or stored
 * results against the current schema.
 *
 * @param raw - Untyped value to validate.
 * @returns A fully validated `AiResult`.
 * @throws {ZodError} If the value cannot be coerced into a valid result.
 */
export function validateAiResult(raw: unknown): AiResult {
  return normalizeAndValidate(raw);
}
