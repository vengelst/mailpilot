"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

/** Parse a Response as JSON without throwing on empty/HTML bodies. */
async function safeJson<T = unknown>(res: Response): Promise<T | null> {
  try {
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

type Account = {
  id: string;
  name: string;
};

type Folder = {
  path: string;
  displayName: string;
};

type AiMailAction =
  | {
      type: "categorize";
      emailId: string;
      category: string;
      reason?: string;
      confidence: number;
    }
  | {
      type: "move";
      emailId: string;
      targetFolder: string;
      reason?: string;
      confidence: number;
    }
  | {
      type: "move_trash";
      emailId: string;
      reason: string;
      confidence: number;
    }
  | {
      type: "move_spam";
      emailId: string;
      reason: string;
      confidence: number;
    }
  | {
      type: "mark_read";
      emailId: string;
      reason?: string;
      confidence: number;
    }
  | {
      type: "create_contact_candidate";
      emailId: string;
      reason?: string;
      confidence: number;
    };

type AiMailPlan = {
  summary: string;
  actions: AiMailAction[];
};

type ProviderStatus = {
  provider: "mock" | "openai" | "anthropic";
  label: string;
  isRealProvider: boolean;
  hasApiKey: boolean;
  warning: string | null;
};

type PlanResponse = {
  kind: "count" | "search" | "plan";
  intent?: string;
  provider: "mock" | "openai" | "anthropic";
  isRealProvider: boolean;
  hasApiKey: boolean;
  plan: AiMailPlan;
  candidateCount: number;
  total?: number;
  byFolder?: Array<{ folderPath: string; count: number }>;
  bySender?: Array<{ fromEmail: string | null; fromName: string | null; count: number }>;
  sampleEmails?: Array<{
    id: string;
    subject: string | null;
    fromName: string | null;
    fromEmail: string | null;
    date: string | null;
    folderPath: string;
  }>;
  promptFilter?: { terms: string[]; daysBack: number | null };
};

type ExecutionOutcome = {
  index: number;
  type: AiMailAction["type"];
  emailId: string;
  status: "executed" | "skipped" | "rejected" | "failed";
  reason?: string;
};

const EXAMPLE_PROMPTS = [
  "Sortiere alle Rechnungen in den Ordner Rechnungen.",
  "Finde alle Kundenanfragen der letzten 30 Tage.",
  "Markiere alle Newsletter als gelesen.",
  "Verschiebe offensichtliche Werbung in den Spam-Ordner.",
  "Extrahiere Kontakte aus dem Ordner Kunden.",
];

export default function AiAssistantPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState("");
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderPath, setFolderPath] = useState("");
  const [prompt, setPrompt] = useState("");
  const [scope, setScope] = useState<"current_folder" | "all_folders" | "unread" | "unanalyzed">(
    "current_folder",
  );
  const [daysBack, setDaysBack] = useState<number | "">("");
  const [maxCandidates, setMaxCandidates] = useState(50);
  const [plan, setPlan] = useState<AiMailPlan | null>(null);
  const [candidateCount, setCandidateCount] = useState<number | null>(null);
  const [planMeta, setPlanMeta] = useState<{
    kind: "count" | "search" | "plan";
    intent?: string;
    provider: "mock" | "openai" | "anthropic";
    isRealProvider: boolean;
    hasApiKey: boolean;
    promptFilter?: { terms: string[]; daysBack: number | null };
    total?: number;
    byFolder?: Array<{ folderPath: string; count: number }>;
    bySender?: Array<{ fromEmail: string | null; fromName: string | null; count: number }>;
    sampleEmails?: PlanResponse["sampleEmails"];
  } | null>(null);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);
  const [outcomes, setOutcomes] = useState<ExecutionOutcome[] | null>(null);
  const [executionSummary, setExecutionSummary] = useState<{
    executed: number;
    failed: number;
    rejected: number;
    total: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function loadProviderStatus() {
    const res = await fetch("/api/ai/status");
    if (!res.ok) return;
    const data = (await res.json()) as ProviderStatus;
    setProviderStatus(data);
  }

  async function loadAccounts() {
    const res = await fetch("/api/accounts");
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (!res.ok) {
      setError("Konten konnten nicht geladen werden.");
      return;
    }
    const data = await res.json();
    const next: Account[] = data.accounts ?? [];
    setAccounts(next);
    if (next.length && !accountId) setAccountId(next[0].id);
  }

  async function loadFolders(id: string) {
    const res = await fetch(`/api/accounts/${id}/folders`);
    if (!res.ok) return;
    const data = await res.json();
    const next: Folder[] = data.folders ?? [];
    setFolders(next);
    if (next.length && !next.some((f) => f.path === folderPath)) {
      setFolderPath(next[0].path);
    }
  }

  useEffect(() => {
    const t = setTimeout(() => {
      void loadAccounts();
      void loadProviderStatus();
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!accountId) return;
    const t = setTimeout(() => {
      void loadFolders(accountId);
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  async function generatePlan() {
    if (!accountId || !prompt.trim()) {
      setError("Auftrag und Konto sind erforderlich.");
      return;
    }
    setBusy(true);
    setError("");
    setPlan(null);
    setPlanMeta(null);
    setOutcomes(null);
    setExecutionSummary(null);
    try {
      const res = await fetch("/api/ai-mail/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountId,
          prompt: prompt.trim(),
          scope,
          folderPath: scope === "current_folder" ? folderPath : undefined,
          daysBack: daysBack === "" ? undefined : Number(daysBack),
          maxCandidates,
        }),
      });
      const data = await safeJson<PlanResponse & { error?: string }>(res);
      if (!res.ok) {
        setError(
          data?.error ?? `Plan konnte nicht erzeugt werden (HTTP ${res.status}).`,
        );
        return;
      }
      if (!data) {
        setError("Plan konnte nicht erzeugt werden — leere Server-Antwort.");
        return;
      }
      setPlan(data.plan ?? null);
      setCandidateCount(data.candidateCount ?? 0);
      setPlanMeta({
        kind: data.kind ?? "plan",
        intent: data.intent,
        provider: data.provider,
        isRealProvider: data.isRealProvider,
        hasApiKey: data.hasApiKey,
        promptFilter: data.promptFilter,
        total: data.total,
        byFolder: data.byFolder,
        bySender: data.bySender,
        sampleEmails: data.sampleEmails,
      });
    } finally {
      setBusy(false);
    }
  }

  async function executePlan() {
    if (!plan || !accountId) return;
    if (
      !window.confirm(
        `Plan jetzt ausführen?\n\n${plan.actions.length} Aktion(en):\n` +
          plan.actions
            .slice(0, 8)
            .map((a) => `- ${a.type}` + ("targetFolder" in a ? ` → ${a.targetFolder}` : ""))
            .join("\n") +
          (plan.actions.length > 8 ? `\n…und ${plan.actions.length - 8} weitere` : ""),
      )
    ) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/ai-mail/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId, plan }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Plan-Ausführung fehlgeschlagen.");
        return;
      }
      setOutcomes(data.outcomes ?? []);
      setExecutionSummary({
        executed: data.executed ?? 0,
        failed: data.failed ?? 0,
        rejected: data.rejected ?? 0,
        total: data.total ?? 0,
      });
    } finally {
      setBusy(false);
    }
  }

  const actionPreview = useMemo(() => {
    if (!plan) return [];
    return plan.actions.map((a, i) => {
      let detail = "";
      if (a.type === "categorize") detail = `Kategorie: ${a.category}`;
      if (a.type === "move") detail = `Ziel: ${a.targetFolder}`;
      if (a.type === "move_trash") detail = "→ Papierkorb";
      if (a.type === "move_spam") detail = "→ Spam";
      if (a.type === "mark_read") detail = "als gelesen markieren";
      if (a.type === "create_contact_candidate") detail = "Kontakt extrahieren";
      const reason = "reason" in a && a.reason ? ` · ${a.reason}` : "";
      return {
        index: i,
        type: a.type,
        emailId: a.emailId,
        confidence: a.confidence,
        text: `${detail}${reason}`,
      };
    });
  }, [plan]);

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-2 flex items-center gap-2">
          <a href="/mail" className="text-sm text-gray-600 hover:underline">
            ← Zurück zur Mail
          </a>
        </div>
        <h1 className="text-2xl font-semibold text-gray-900">KI-Assistent</h1>
        <p className="mt-1 max-w-3xl text-sm text-gray-600">
          Beschreibe in natürlicher Sprache, was die KI mit deinen E-Mails tun soll. Die KI erzeugt
          zuerst einen Plan — du bekommst eine Vorschau und entscheidest, ob er ausgeführt wird.
          Endgültige Löschungen sind nicht möglich — Papierkorb bedeutet nur ein Verschieben in den
          Trash-Ordner.
        </p>

        {providerStatus ? (
          <div
            className={`mt-4 rounded-md border px-3 py-2 text-sm ${
              providerStatus.provider === "mock"
                ? "border-amber-300 bg-amber-50 text-amber-900"
                : providerStatus.hasApiKey
                  ? "border-green-300 bg-green-50 text-green-900"
                  : "border-red-300 bg-red-50 text-red-900"
            }`}
          >
            <p>
              <span className="font-semibold">Aktiver KI-Anbieter:</span>{" "}
              {providerStatus.label}
              {providerStatus.isRealProvider
                ? providerStatus.hasApiKey
                  ? " · API-Key konfiguriert"
                  : " · API-Key fehlt"
                : ""}
            </p>
            {providerStatus.warning ? (
              <p className="mt-1 text-xs">{providerStatus.warning}</p>
            ) : null}
            <p className="mt-1 text-xs opacity-80">
              Provider-Auswahl über <code>AI_PROVIDER</code> (mock | openai | anthropic) in der
              .env. API-Keys liegen nur serverseitig — sie werden nie an den Browser ausgeliefert.
            </p>
          </div>
        ) : null}

        <section className="mt-6 rounded-xl border border-gray-200 bg-white p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <label className="md:col-span-1">
              <span className="block text-xs font-semibold text-gray-700">Konto</span>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="md:col-span-1">
              <span className="block text-xs font-semibold text-gray-700">Scope</span>
              <select
                value={scope}
                onChange={(e) =>
                  setScope(
                    e.target.value as
                      | "current_folder"
                      | "all_folders"
                      | "unread"
                      | "unanalyzed",
                  )
                }
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              >
                <option value="current_folder">Aktueller Ordner</option>
                <option value="all_folders">Alle Ordner</option>
                <option value="unread">Nur ungelesene</option>
                <option value="unanalyzed">Nur noch nicht analysierte</option>
              </select>
            </label>
            <label className={`md:col-span-1 ${scope === "current_folder" ? "" : "opacity-50"}`}>
              <span className="block text-xs font-semibold text-gray-700">Ordner</span>
              <select
                value={folderPath}
                onChange={(e) => setFolderPath(e.target.value)}
                disabled={scope !== "current_folder"}
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-50"
              >
                {folders.map((f) => (
                  <option key={f.path} value={f.path}>
                    {f.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="md:col-span-1">
              <span className="block text-xs font-semibold text-gray-700">Zeitraum (Tage)</span>
              <input
                type="number"
                min={1}
                max={365}
                value={daysBack}
                placeholder="alle"
                onChange={(e) =>
                  setDaysBack(e.target.value === "" ? "" : Number(e.target.value))
                }
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="md:col-span-1">
              <span className="block text-xs font-semibold text-gray-700">
                Max. KI-Kandidaten
              </span>
              <input
                type="number"
                min={1}
                max={2000}
                value={maxCandidates}
                onChange={(e) => setMaxCandidates(Number(e.target.value) || 50)}
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              />
              <span className="mt-1 block text-[10px] leading-tight text-gray-500">
                Bei Aktionsaufträgen (sortieren, verschieben…) max. 200. Beim Zählen oder
                Suchen ohne Limit — alle passenden Mails werden gezählt, höchstens 50
                Beispiele angezeigt.
              </span>
            </label>
          </div>

          <label className="mt-4 block">
            <span className="block text-xs font-semibold text-gray-700">Auftrag an die KI</span>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder="z.B.: Sortiere alle Rechnungen in den Ordner Rechnungen."
              className="mt-1 w-full resize-y rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </label>

          <div className="mt-2 flex flex-wrap gap-1">
            {EXAMPLE_PROMPTS.map((p) => (
              <button
                key={p}
                onClick={() => setPrompt(p)}
                className="rounded-full border border-gray-300 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-50"
              >
                {p}
              </button>
            ))}
          </div>

          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={() => void generatePlan()}
              disabled={busy || !prompt.trim()}
              className="rounded-md bg-gray-900 px-3 py-2 text-sm text-white disabled:opacity-60"
            >
              {busy && !plan ? "Erzeuge Plan..." : "Vorschau erzeugen"}
            </button>
            {plan && planMeta?.kind === "plan" ? (
              <button
                onClick={() => void executePlan()}
                disabled={busy || plan.actions.length === 0}
                className="rounded-md border border-green-500 bg-green-500 px-3 py-2 text-sm text-white disabled:opacity-60"
              >
                {busy && plan ? "Führe aus..." : "Ausführen"}
              </button>
            ) : null}
          </div>

          {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
        </section>

        {plan && planMeta && (planMeta.kind === "count" || planMeta.kind === "search") ? (
          <section className="mt-6 rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-gray-900">
              {planMeta.kind === "count" ? "Zähl-Ergebnis" : "Such-Ergebnis"}
            </h2>
            <p className="mt-1 text-sm text-gray-700">{plan.summary}</p>
            <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
              <span className="rounded-full border border-gray-300 bg-white px-2 py-0.5 text-gray-700">
                Quelle: deterministische DB-Suche (kein KI-Aufruf)
              </span>
              {planMeta.promptFilter && planMeta.promptFilter.terms.length > 0 ? (
                <span className="rounded-full border border-gray-300 bg-white px-2 py-0.5 text-gray-700">
                  Suchbegriffe: {planMeta.promptFilter.terms.join(", ")}
                </span>
              ) : null}
              {planMeta.promptFilter?.daysBack ? (
                <span className="rounded-full border border-gray-300 bg-white px-2 py-0.5 text-gray-700">
                  Zeitraum: {planMeta.promptFilter.daysBack} Tage
                </span>
              ) : null}
            </div>

            {planMeta.byFolder && planMeta.byFolder.length > 0 ? (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Nach Ordnern
                </p>
                <ul className="mt-1 divide-y divide-gray-100 text-sm">
                  {planMeta.byFolder.map((b) => (
                    <li
                      key={b.folderPath}
                      className="flex items-center justify-between py-1"
                    >
                      <span className="truncate text-gray-800">{b.folderPath}</span>
                      <span className="tabular-nums text-gray-600">{b.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {planMeta.bySender && planMeta.bySender.length > 0 ? (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Top-Absender
                </p>
                <ul className="mt-1 divide-y divide-gray-100 text-sm">
                  {planMeta.bySender.map((s, i) => (
                    <li key={i} className="flex items-center justify-between py-1">
                      <span className="truncate text-gray-800">
                        {s.fromName || s.fromEmail || "Unbekannt"}
                        {s.fromName && s.fromEmail ? (
                          <span className="ml-1 text-xs text-gray-500">
                            &lt;{s.fromEmail}&gt;
                          </span>
                        ) : null}
                      </span>
                      <span className="tabular-nums text-gray-600">{s.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {planMeta.sampleEmails && planMeta.sampleEmails.length > 0 ? (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Beispiel-Treffer (max. 20)
                </p>
                <ul className="mt-1 space-y-1 text-xs text-gray-700">
                  {planMeta.sampleEmails.map((m) => (
                    <li
                      key={m.id}
                      className="rounded-md border border-gray-100 bg-gray-50 px-2 py-1"
                    >
                      <p className="truncate">
                        <span className="font-medium">
                          {m.subject || "(Ohne Betreff)"}
                        </span>
                      </p>
                      <p className="truncate text-[11px] text-gray-500">
                        {m.fromName || m.fromEmail || "Unbekannt"}
                        {" · "}
                        {m.folderPath}
                        {m.date
                          ? " · " + new Date(m.date).toLocaleDateString("de-DE")
                          : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : null}

        {plan && planMeta?.kind === "plan" ? (
          <section className="mt-6 rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-gray-900">Plan-Vorschau</h2>
            <p className="mt-1 text-sm text-gray-700">{plan.summary}</p>
            <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
              <span
                className={`rounded-full border px-2 py-0.5 ${
                  planMeta.provider === "mock"
                    ? "border-amber-300 bg-amber-50 text-amber-900"
                    : "border-green-300 bg-green-50 text-green-900"
                }`}
              >
                Provider: {planMeta.provider}
              </span>
              {planMeta.promptFilter && planMeta.promptFilter.terms.length > 0 ? (
                <span className="rounded-full border border-gray-300 bg-white px-2 py-0.5 text-gray-700">
                  Suchbegriffe: {planMeta.promptFilter.terms.join(", ")}
                </span>
              ) : null}
              {planMeta.promptFilter?.daysBack ? (
                <span className="rounded-full border border-gray-300 bg-white px-2 py-0.5 text-gray-700">
                  Zeitraum: {planMeta.promptFilter.daysBack} Tage
                </span>
              ) : null}
            </div>
            {candidateCount !== null ? (
              <p className="mt-2 text-xs text-gray-500">
                Auf Basis von {candidateCount} E-Mail-Kandidat(en).
              </p>
            ) : null}
            {plan.actions.length === 0 ? (
              <p className="mt-3 rounded-md bg-gray-50 p-3 text-sm text-gray-600">
                Keine Aktionen vorgeschlagen.
              </p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm">
                {actionPreview.map((a) => (
                  <li
                    key={a.index}
                    className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2"
                  >
                    <p>
                      <span className="font-semibold">{a.type}</span> · {a.text}
                    </p>
                    <p className="text-xs text-gray-600">
                      mailId: {a.emailId} · confidence:{" "}
                      {(a.confidence * 100).toFixed(0)}%
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {executionSummary ? (
          <section className="mt-6 rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-gray-900">Ergebnis der Ausführung</h2>
            <p className="mt-1 text-sm text-gray-700">
              {executionSummary.executed} ausgeführt, {executionSummary.failed} fehlgeschlagen,{" "}
              {executionSummary.rejected} abgelehnt (von insgesamt {executionSummary.total}
              ).
            </p>
            {outcomes && outcomes.length > 0 ? (
              <ul className="mt-3 space-y-1 text-xs text-gray-700">
                {outcomes.map((o) => (
                  <li key={o.index}>
                    [{o.status}] {o.type} — {o.emailId}
                    {o.reason ? ` (${o.reason})` : ""}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}
      </div>
    </main>
  );
}
