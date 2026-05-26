"use client";

import { useEffect, useState } from "react";

/**
 * Parse a Response as JSON without throwing.
 *
 * Returns `null` if the body is empty or not parseable JSON. The page renders
 * a friendly fallback message in that case instead of crashing on
 * `res.json()` (which throws "Unexpected end of JSON input" on empty bodies).
 */
async function safeJson<T = unknown>(res: Response): Promise<T | null> {
  try {
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

type Provider = "mock" | "openai" | "anthropic";

type Settings = {
  provider: Provider;
  openAiApiKeySet: boolean;
  anthropicApiKeySet: boolean;
  source: "database" | "env" | "default";
};

type Status = {
  provider: Provider;
  label: string;
  isRealProvider: boolean;
  hasApiKey: boolean;
  source: "database" | "env" | "default";
  warning: string | null;
};

type TestResponse = {
  provider: Provider;
  success: boolean;
  message: string;
};

const PROVIDER_OPTIONS: { value: Provider; label: string; hint: string }[] = [
  {
    value: "mock",
    label: "Mock / Testmodus",
    hint: "Keine echte KI — nur für Testen der Oberfläche.",
  },
  {
    value: "openai",
    label: "OpenAI",
    hint: "Nutzt OpenAI gpt-4o-mini. API-Key wird verschlüsselt gespeichert.",
  },
  {
    value: "anthropic",
    label: "Anthropic / Claude",
    hint: "Nutzt Claude 3.5 Sonnet. API-Key wird verschlüsselt gespeichert.",
  },
];

export default function AiSettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [provider, setProvider] = useState<Provider>("mock");
  const [openAiInput, setOpenAiInput] = useState("");
  const [anthropicInput, setAnthropicInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "info" | "error"; text: string } | null>(
    null,
  );
  const [testResult, setTestResult] = useState<TestResponse | null>(null);

  async function loadAll() {
    const [sRes, stRes] = await Promise.all([
      fetch("/api/ai/settings"),
      fetch("/api/ai/status"),
    ]);
    if (sRes.ok) {
      const data = await safeJson<Settings>(sRes);
      if (data) {
        setSettings(data);
        setProvider(data.provider);
      }
    }
    if (stRes.ok) {
      const data = await safeJson<Status>(stRes);
      if (data) setStatus(data);
    }
  }

  useEffect(() => {
    const t = setTimeout(() => {
      void loadAll();
    }, 0);
    return () => clearTimeout(t);
  }, []);

  async function save(extra?: { clearOpenAiApiKey?: boolean; clearAnthropicApiKey?: boolean }) {
    setBusy(true);
    setFeedback(null);
    setTestResult(null);
    try {
      const body: Record<string, unknown> = { provider };
      if (openAiInput.trim()) body.openAiApiKey = openAiInput.trim();
      if (anthropicInput.trim()) body.anthropicApiKey = anthropicInput.trim();
      if (extra?.clearOpenAiApiKey) body.clearOpenAiApiKey = true;
      if (extra?.clearAnthropicApiKey) body.clearAnthropicApiKey = true;
      const res = await fetch("/api/ai/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await safeJson<{ error?: string }>(res);
      if (!res.ok) {
        setFeedback({
          kind: "error",
          text:
            data?.error ??
            `Speichern fehlgeschlagen (HTTP ${res.status}). Bitte später erneut versuchen.`,
        });
        return;
      }
      setFeedback({ kind: "info", text: "Einstellungen gespeichert." });
      // Always clear the key inputs after a save — never leave keys in the DOM.
      setOpenAiInput("");
      setAnthropicInput("");
      await loadAll();
    } finally {
      setBusy(false);
    }
  }

  async function runTest() {
    setBusy(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/ai/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const data = await safeJson<TestResponse & { error?: string }>(res);
      if (!res.ok) {
        setTestResult({
          provider,
          success: false,
          message:
            data?.error ?? `Test fehlgeschlagen (HTTP ${res.status}).`,
        });
        return;
      }
      if (!data) {
        setTestResult({
          provider,
          success: false,
          message: "Test fehlgeschlagen — leere Server-Antwort.",
        });
        return;
      }
      setTestResult(data);
    } finally {
      setBusy(false);
    }
  }

  const statusBoxClass = !status
    ? "glass-info"
    : status.provider === "mock"
      ? "border-amber-300 bg-amber-50 text-amber-900"
      : status.hasApiKey
        ? "glass-success-box"
        : "glass-error";

  return (
    <main className="min-h-screen p-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-2 flex items-center gap-2">
          <a href="/settings" className="text-sm glass-text-secondary hover:underline">
            ← Einstellungen
          </a>
        </div>
        <h1 className="text-2xl font-semibold glass-text-primary">KI-Einstellungen</h1>
        <p className="mt-1 max-w-2xl text-sm glass-text-secondary">
          Wähle, welche KI MailPilot für Analyse, Sortierung und Organisationsvorschläge
          verwenden soll. API-Keys werden verschlüsselt auf dem Server gespeichert und niemals
          im Browser angezeigt.
        </p>

        {status ? (
          <div className={`mt-4 rounded-xl px-3 py-2 text-sm ${statusBoxClass}`}>
            <p>
              <span className="font-semibold">Aktiv:</span> {status.label}{" "}
              <span className="opacity-75">
                ({status.source === "database"
                  ? "Datenbank"
                  : status.source === "env"
                    ? ".env"
                    : "Default"}
                )
              </span>
            </p>
            <p className="mt-1 text-xs">
              OpenAI-Key: {settings?.openAiApiKeySet ? "vorhanden" : "fehlt"} ·{" "}
              Anthropic-Key: {settings?.anthropicApiKeySet ? "vorhanden" : "fehlt"}
            </p>
            {status.warning ? <p className="mt-1 text-xs">{status.warning}</p> : null}
          </div>
        ) : null}

        <section className="glass-card mt-6 rounded-xl p-4">
          <h2 className="text-sm font-semibold glass-text-primary">Provider</h2>
          <div className="mt-3 space-y-2">
            {PROVIDER_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className="flex cursor-pointer items-start gap-2 rounded-lg glass p-2 hover:bg-white/30"
              >
                <input
                  type="radio"
                  name="ai-provider"
                  value={opt.value}
                  checked={provider === opt.value}
                  onChange={() => setProvider(opt.value)}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-medium glass-text-primary">{opt.label}</span>
                  <span className="block text-xs glass-text-secondary">{opt.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className="glass-card mt-6 rounded-xl p-4">
          <h2 className="text-sm font-semibold glass-text-primary">API-Keys</h2>
          <p className="mt-1 text-xs glass-text-secondary">
            Bestehende Keys werden niemals im Klartext angezeigt. Lass das Feld leer, um den
            gespeicherten Key zu behalten. Klick auf {"„Key löschen"}, um ihn zu entfernen.
          </p>

          <div className="mt-4 space-y-4">
            <div>
              <label className="block">
                <span className="block text-xs font-semibold glass-text-secondary">OpenAI API-Key</span>
                <input
                  type="password"
                  value={openAiInput}
                  onChange={(e) => setOpenAiInput(e.target.value)}
                  placeholder={
                    settings?.openAiApiKeySet
                      ? "API-Key ist gespeichert (Eingabe leer lassen zum Behalten)"
                      : "noch kein Key gespeichert"
                  }
                  autoComplete="off"
                  className="glass-input mt-1 w-full rounded-xl px-3 py-1.5 text-sm"
                />
              </label>
              {settings?.openAiApiKeySet ? (
                <button
                  onClick={() => void save({ clearOpenAiApiKey: true })}
                  disabled={busy}
                  className="mt-2 rounded-lg border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  OpenAI-Key löschen
                </button>
              ) : null}
            </div>

            <div>
              <label className="block">
                <span className="block text-xs font-semibold glass-text-secondary">
                  Anthropic API-Key
                </span>
                <input
                  type="password"
                  value={anthropicInput}
                  onChange={(e) => setAnthropicInput(e.target.value)}
                  placeholder={
                    settings?.anthropicApiKeySet
                      ? "API-Key ist gespeichert (Eingabe leer lassen zum Behalten)"
                      : "noch kein Key gespeichert"
                  }
                  autoComplete="off"
                  className="glass-input mt-1 w-full rounded-xl px-3 py-1.5 text-sm"
                />
              </label>
              {settings?.anthropicApiKeySet ? (
                <button
                  onClick={() => void save({ clearAnthropicApiKey: true })}
                  disabled={busy}
                  className="mt-2 rounded-lg border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  Anthropic-Key löschen
                </button>
              ) : null}
            </div>
          </div>
        </section>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={() => void save()}
            disabled={busy}
            className="glass-btn-dark rounded-lg px-3 py-2 text-sm disabled:opacity-60"
          >
            Speichern
          </button>
          <button
            onClick={() => void runTest()}
            disabled={busy}
            className="glass-btn rounded-lg px-3 py-2 text-sm disabled:opacity-50"
          >
            Verbindung testen
          </button>
          <a
            href="/ai-assistant"
            className="glass-btn rounded-lg px-3 py-2 text-sm hover:bg-white/30"
          >
            Zum KI-Assistenten
          </a>
        </div>

        {feedback ? (
          <p
            className={`mt-3 rounded-xl px-3 py-2 text-sm ${
              feedback.kind === "error"
                ? "glass-error"
                : "glass-success-box"
            }`}
          >
            {feedback.text}
          </p>
        ) : null}

        {testResult ? (
          <p
            className={`mt-3 rounded-xl px-3 py-2 text-sm ${
              testResult.success ? "glass-success-box" : "glass-error"
            }`}
          >
            <span className="font-semibold">[{testResult.provider}]</span> {testResult.message}
          </p>
        ) : null}

        <p className="mt-6 text-xs glass-text-tertiary">
          Mock-Modus verwendet keine echte KI und dient nur zum Testen der Oberfläche. Wenn ein
          Schlüssel sowohl in der Datenbank als auch in der .env hinterlegt ist, gewinnt die
          Datenbank-Konfiguration.
        </p>
      </div>
    </main>
  );
}
