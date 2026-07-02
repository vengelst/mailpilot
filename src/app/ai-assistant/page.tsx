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

type ActionEmailDetail = {
  id: string;
  subject: string | null;
  fromName: string | null;
  fromEmail: string | null;
  date: string | null;
  folderPath: string;
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
  sampleEmails?: Array<ActionEmailDetail>;
  actionEmails?: Array<ActionEmailDetail>;
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
    actionEmails?: PlanResponse["actionEmails"];
  } | null>(null);
  const [excludedActions, setExcludedActions] = useState<Set<number>>(new Set());
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
    setExcludedActions(new Set());
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
        actionEmails: data.actionEmails,
      });
    } finally {
      setBusy(false);
    }
  }

  async function executePlan() {
    if (!plan || !accountId) return;
    const filteredPlan: AiMailPlan = {
      ...plan,
      actions: plan.actions.filter((_, i) => !excludedActions.has(i)),
    };
    if (filteredPlan.actions.length === 0) {
      setError("Keine Aktionen ausgewählt.");
      return;
    }
    if (
      !window.confirm(
        `Plan jetzt ausführen?\n\n${filteredPlan.actions.length} Aktion(en):\n` +
          filteredPlan.actions
            .slice(0, 8)
            .map((a) => `- ${a.type}` + ("targetFolder" in a ? ` → ${a.targetFolder}` : ""))
            .join("\n") +
          (filteredPlan.actions.length > 8
            ? `\n…und ${filteredPlan.actions.length - 8} weitere`
            : ""),
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
        body: JSON.stringify({ accountId, plan: filteredPlan }),
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

  const emailDetailsById = useMemo(() => {
    const map = new Map<string, ActionEmailDetail>();
    if (planMeta?.actionEmails) {
      for (const e of planMeta.actionEmails) map.set(e.id, e);
    }
    return map;
  }, [planMeta]);

  const actionPreview = useMemo(() => {
    if (!plan) return [];
    return plan.actions.map((a, i) => {
      let targetLabel = "";
      if (a.type === "categorize") targetLabel = `Kategorie: ${a.category}`;
      if (a.type === "move") targetLabel = a.targetFolder;
      if (a.type === "move_trash") targetLabel = "Papierkorb";
      if (a.type === "move_spam") targetLabel = "Spam";
      if (a.type === "mark_read") targetLabel = "als gelesen markieren";
      if (a.type === "create_contact_candidate") targetLabel = "Kontakt extrahieren";
      const email = emailDetailsById.get(a.emailId);
      return {
        index: i,
        type: a.type,
        emailId: a.emailId,
        confidence: a.confidence,
        targetLabel,
        subject: email?.subject || "(Ohne Betreff)",
        fromName: email?.fromName || email?.fromEmail || "Unbekannt",
        fromFolder: email?.folderPath || "",
        date: email?.date ? new Date(email.date).toLocaleDateString("de-DE") : null,
      };
    });
  }, [plan, emailDetailsById]);

  const actionGroups = useMemo(() => {
    if (!plan || plan.actions.length === 0) return [];
    const groups = new Map<string, number>();
    for (let i = 0; i < plan.actions.length; i++) {
      if (excludedActions.has(i)) continue;
      const a = plan.actions[i];
      let key: string;
      if (a.type === "move") key = `→ Ordner „${a.targetFolder}"`;
      else if (a.type === "move_trash") key = "→ Papierkorb";
      else if (a.type === "move_spam") key = "→ Spam";
      else if (a.type === "categorize") key = `→ Kategorie „${a.category}"`;
      else if (a.type === "mark_read") key = "Als gelesen markieren";
      else if (a.type === "create_contact_candidate") key = "Kontakt extrahieren";
      else key = String((a as AiMailAction).type);
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
    return Array.from(groups.entries()).map(([label, count]) => ({ label, count }));
  }, [plan, excludedActions]);

  const selectedCount = plan
    ? plan.actions.length - excludedActions.size
    : 0;

  return (
    <main className="min-h-screen p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-2 flex items-center gap-2">
          <a href="/mail" className="text-sm glass-text-secondary hover:underline">
            ← Zurück zur Mail
          </a>
        </div>
        <h1 className="text-2xl font-semibold glass-text-primary">KI-Assistent</h1>
        <p className="mt-1 max-w-3xl text-sm glass-text-secondary">
          Beschreibe in natürlicher Sprache, was die KI mit deinen E-Mails tun soll. Die KI erzeugt
          zuerst einen Plan — du bekommst eine Vorschau und entscheidest, ob er ausgeführt wird.
          Endgültige Löschungen sind nicht möglich — Papierkorb bedeutet nur ein Verschieben in den
          Trash-Ordner.
        </p>

        {providerStatus ? (
          <div
            className={`mt-4 rounded-lg glass px-3 py-2 text-sm ${
              providerStatus.provider === "mock"
                ? "border-amber-300/40 text-amber-900 dark:text-amber-200"
                : providerStatus.hasApiKey
                  ? "border-green-300/40 text-green-900 dark:text-green-200"
                  : "border-red-300/40 text-red-900 dark:text-red-200"
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

        <section className="mt-6 rounded-xl glass-solid p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <label className="md:col-span-1">
              <span className="block text-xs font-semibold glass-text-secondary">Konto</span>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="mt-1 w-full glass-select rounded-lg px-2 py-1.5 text-sm"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="md:col-span-1">
              <span className="block text-xs font-semibold glass-text-secondary">Scope</span>
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
                className="mt-1 w-full glass-select rounded-lg px-2 py-1.5 text-sm"
              >
                <option value="current_folder">Aktueller Ordner</option>
                <option value="all_folders">Alle Ordner</option>
                <option value="unread">Nur ungelesene</option>
                <option value="unanalyzed">Nur noch nicht analysierte</option>
              </select>
            </label>
            <label className={`md:col-span-1 ${scope === "current_folder" ? "" : "opacity-50"}`}>
              <span className="block text-xs font-semibold glass-text-secondary">Ordner</span>
              <select
                value={folderPath}
                onChange={(e) => setFolderPath(e.target.value)}
                disabled={scope !== "current_folder"}
                className="mt-1 w-full glass-select rounded-lg px-2 py-1.5 text-sm disabled:opacity-50"
              >
                {folders.map((f) => (
                  <option key={f.path} value={f.path}>
                    {f.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="md:col-span-1">
              <span className="block text-xs font-semibold glass-text-secondary">Zeitraum (Tage)</span>
              <input
                type="number"
                min={1}
                max={365}
                value={daysBack}
                placeholder="alle"
                onChange={(e) =>
                  setDaysBack(e.target.value === "" ? "" : Number(e.target.value))
                }
                className="mt-1 w-full glass-input rounded-lg px-2 py-1.5 text-sm"
              />
            </label>
            <label className="md:col-span-1">
              <span className="block text-xs font-semibold glass-text-secondary">
                Max. KI-Kandidaten
              </span>
              <input
                type="number"
                min={1}
                max={2000}
                value={maxCandidates}
                onChange={(e) => setMaxCandidates(Number(e.target.value) || 50)}
                className="mt-1 w-full glass-input rounded-lg px-2 py-1.5 text-sm"
              />
              <span className="mt-1 block text-[10px] leading-tight glass-text-tertiary">
                Bei Aktionsaufträgen (sortieren, verschieben…) max. 200. Beim Zählen oder
                Suchen ohne Limit — alle passenden Mails werden gezählt, höchstens 50
                Beispiele angezeigt.
              </span>
            </label>
          </div>

          <label className="mt-4 block">
            <span className="block text-xs font-semibold glass-text-secondary">Auftrag an die KI</span>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder="z.B.: Sortiere alle Rechnungen in den Ordner Rechnungen."
              className="mt-1 w-full resize-y glass-input rounded-lg px-3 py-2 text-sm"
            />
          </label>

          <div className="mt-2 flex flex-wrap gap-1">
            {EXAMPLE_PROMPTS.map((p) => (
              <button
                key={p}
                onClick={() => setPrompt(p)}
                className="rounded-full glass-btn px-2 py-0.5 text-xs"
              >
                {p}
              </button>
            ))}
          </div>

          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={() => void generatePlan()}
              disabled={busy || !prompt.trim()}
              className="glass-btn-dark rounded-lg px-3 py-2 text-sm disabled:opacity-60"
            >
              {busy && !plan ? "Erzeuge Plan..." : "Vorschau erzeugen"}
            </button>
            {plan && planMeta?.kind === "plan" ? (
              <button
                onClick={() => void executePlan()}
                disabled={busy || selectedCount === 0}
                className="glass-btn-primary rounded-lg px-3 py-2 text-sm disabled:opacity-60"
              >
                {busy && plan
                  ? "Führe aus..."
                  : `Ausführen (${selectedCount} Aktion${selectedCount !== 1 ? "en" : ""})`}
              </button>
            ) : null}
          </div>

          {error ? <p className="mt-3 text-sm glass-error rounded-lg px-3 py-2">{error}</p> : null}
        </section>

        {plan && planMeta && (planMeta.kind === "count" || planMeta.kind === "search") ? (
          <section className="mt-6 rounded-xl glass-solid p-4">
            <h2 className="text-sm font-semibold glass-text-primary">
              {planMeta.kind === "count" ? "Zähl-Ergebnis" : "Such-Ergebnis"}
            </h2>
            <p className="mt-1 text-sm glass-text-secondary">{plan.summary}</p>
            <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
              <span className="glass-badge">
                Quelle: deterministische DB-Suche (kein KI-Aufruf)
              </span>
              {planMeta.promptFilter && planMeta.promptFilter.terms.length > 0 ? (
                <span className="glass-badge">
                  Suchbegriffe: {planMeta.promptFilter.terms.join(", ")}
                </span>
              ) : null}
              {planMeta.promptFilter?.daysBack ? (
                <span className="glass-badge">
                  Zeitraum: {planMeta.promptFilter.daysBack} Tage
                </span>
              ) : null}
            </div>

            {planMeta.byFolder && planMeta.byFolder.length > 0 ? (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide glass-text-tertiary">
                  Nach Ordnern
                </p>
                <ul className="mt-1 divide-y divide-white/10 text-sm">
                  {planMeta.byFolder.map((b) => (
                    <li
                      key={b.folderPath}
                      className="flex items-center justify-between py-1"
                    >
                      <span className="truncate glass-text-primary">{b.folderPath}</span>
                      <span className="tabular-nums glass-text-secondary">{b.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {planMeta.bySender && planMeta.bySender.length > 0 ? (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide glass-text-tertiary">
                  Top-Absender
                </p>
                <ul className="mt-1 divide-y divide-white/10 text-sm">
                  {planMeta.bySender.map((s, i) => (
                    <li key={i} className="flex items-center justify-between py-1">
                      <span className="truncate glass-text-primary">
                        {s.fromName || s.fromEmail || "Unbekannt"}
                        {s.fromName && s.fromEmail ? (
                          <span className="ml-1 text-xs glass-text-tertiary">
                            &lt;{s.fromEmail}&gt;
                          </span>
                        ) : null}
                      </span>
                      <span className="tabular-nums glass-text-secondary">{s.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {planMeta.sampleEmails && planMeta.sampleEmails.length > 0 ? (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide glass-text-tertiary">
                  Beispiel-Treffer (max. 20)
                </p>
                <ul className="mt-1 space-y-1 text-xs glass-text-secondary">
                  {planMeta.sampleEmails.map((m) => (
                    <li
                      key={m.id}
                      className="rounded-lg glass px-2 py-1"
                    >
                      <p className="truncate">
                        <span className="font-medium">
                          {m.subject || "(Ohne Betreff)"}
                        </span>
                      </p>
                      <p className="truncate text-[11px] glass-text-tertiary">
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
          <section className="mt-6 rounded-xl glass-solid p-4">
            <h2 className="text-sm font-semibold glass-text-primary">Plan-Vorschau</h2>
            <p className="mt-1 text-sm glass-text-secondary">{plan.summary}</p>
            <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
              <span
                className={`glass-badge ${
                  planMeta.provider === "mock"
                    ? "border-amber-300/40 text-amber-900 dark:text-amber-200"
                    : "border-green-300/40 text-green-900 dark:text-green-200"
                }`}
              >
                Provider: {planMeta.provider}
              </span>
              {planMeta.promptFilter && planMeta.promptFilter.terms.length > 0 ? (
                <span className="glass-badge">
                  Suchbegriffe: {planMeta.promptFilter.terms.join(", ")}
                </span>
              ) : null}
              {planMeta.promptFilter?.daysBack ? (
                <span className="glass-badge">
                  Zeitraum: {planMeta.promptFilter.daysBack} Tage
                </span>
              ) : null}
            </div>
            {candidateCount !== null ? (
              <p className="mt-2 text-xs glass-text-tertiary">
                Auf Basis von {candidateCount} E-Mail-Kandidat(en).
              </p>
            ) : null}
            {plan.actions.length === 0 ? (
              <p className="mt-3 rounded-lg glass p-3 text-sm glass-text-secondary">
                Keine Aktionen vorgeschlagen.
              </p>
            ) : (
              <>
                {actionGroups.length > 0 ? (
                  <div className="mt-3 rounded-lg glass px-3 py-2">
                    <p className="text-xs font-semibold uppercase tracking-wide glass-text-tertiary">
                      Geplante Aktionen ({selectedCount} von {plan.actions.length} ausgewählt)
                    </p>
                    <ul className="mt-1 space-y-0.5 text-sm glass-text-primary">
                      {actionGroups.map((g) => (
                        <li key={g.label}>
                          • {g.count} Mail{g.count !== 1 ? "s" : ""} {g.label}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="mt-2 flex items-center gap-2 text-xs glass-text-tertiary">
                  <button
                    className="underline hover:no-underline"
                    onClick={() => setExcludedActions(new Set())}
                  >
                    Alle auswählen
                  </button>
                  <span>·</span>
                  <button
                    className="underline hover:no-underline"
                    onClick={() =>
                      setExcludedActions(
                        new Set(plan.actions.map((_, i) => i)),
                      )
                    }
                  >
                    Keine auswählen
                  </button>
                </div>

                <ul className="mt-2 space-y-1.5 text-sm">
                  {actionPreview.map((a) => {
                    const excluded = excludedActions.has(a.index);
                    return (
                      <li
                        key={a.index}
                        className={`flex items-start gap-2 rounded-lg glass px-3 py-2 transition-opacity ${
                          excluded ? "opacity-40" : ""
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={!excluded}
                          onChange={() => {
                            setExcludedActions((prev) => {
                              const next = new Set(prev);
                              if (next.has(a.index)) next.delete(a.index);
                              else next.add(a.index);
                              return next;
                            });
                          }}
                          className="mt-1 h-4 w-4 shrink-0 rounded accent-blue-500"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium glass-text-primary">
                            {a.subject}
                            <span className="ml-1 font-normal text-xs glass-text-tertiary">
                              von {a.fromName}
                            </span>
                          </p>
                          <p className="text-xs glass-text-secondary">
                            {a.fromFolder} → {a.targetLabel}
                            <span className="ml-2 glass-text-tertiary">
                              (Konfidenz: {(a.confidence * 100).toFixed(0)}%)
                            </span>
                            {a.date ? (
                              <span className="ml-2 glass-text-tertiary">{a.date}</span>
                            ) : null}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </section>
        ) : null}

        {executionSummary ? (
          <section className="mt-6 rounded-xl glass-solid p-4">
            <h2 className="text-sm font-semibold glass-text-primary">Ergebnis der Ausführung</h2>
            <p className="mt-1 text-sm glass-text-secondary">
              {executionSummary.executed} ausgeführt, {executionSummary.failed} fehlgeschlagen,{" "}
              {executionSummary.rejected} abgelehnt (von insgesamt {executionSummary.total}
              ).
            </p>
            {outcomes && outcomes.length > 0 ? (
              <ul className="mt-3 space-y-1 text-xs glass-text-secondary">
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
