"use client";

import { useEffect, useState } from "react";

type AutomationRun = {
  id: string;
  type: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  resultJson: {
    synced?: number;
    analyzed?: number;
    appliedRules?: number;
    blockedMoved?: number;
  } | null;
  error: string | null;
};

type AutomationSettings = {
  runOnAppStart: boolean;
  runIntervalMinutes: number;
  autoAnalyzeNewEmails: boolean;
  autoApplyUserRules: boolean;
  autoApplyAiSuggestions: boolean;
  aiMinConfidenceForMove: number;
  aiMinConfidenceForTrash: number;
  aiMinConfidenceForSpam: number;
  autoSaveAttachments: boolean;
  mailScrollBatchSize: number;
};

const defaultSettings: AutomationSettings = {
  runOnAppStart: false,
  runIntervalMinutes: 30,
  autoAnalyzeNewEmails: true,
  autoApplyUserRules: true,
  autoApplyAiSuggestions: false,
  aiMinConfidenceForMove: 0.9,
  aiMinConfidenceForTrash: 0.98,
  aiMinConfidenceForSpam: 0.98,
  autoSaveAttachments: false,
  mailScrollBatchSize: 100,
};

export default function AutomationPage() {
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [settings, setSettings] = useState<AutomationSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [runningNow, setRunningNow] = useState(false);
  const [error, setError] = useState("");

  async function loadRuns() {
    const res = await fetch("/api/automation/runs");
    if (!res.ok) return;
    const data = await res.json();
    setRuns(data.runs ?? []);
  }

  async function loadSettings() {
    const res = await fetch("/api/automation/settings");
    if (!res.ok) return;
    const data = await res.json();
    if (data.settings) setSettings(data.settings);
  }

  async function runNow() {
    try {
      setRunningNow(true);
      setError("");
      const res = await fetch("/api/automation/run-now", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "full" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Automation konnte nicht gestartet werden.");
      }
      await loadRuns();
    } finally {
      setRunningNow(false);
    }
  }

  async function saveSettings(next: Partial<AutomationSettings>) {
    const updated = { ...settings, ...next };
    setSettings(updated);
    const res = await fetch("/api/automation/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(updated),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Automation-Einstellungen konnten nicht gespeichert werden.");
    }
  }

  useEffect(() => {
    const timer = setTimeout(async () => {
      await Promise.all([loadRuns(), loadSettings()]);
      setLoading(false);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!settings.runOnAppStart) return;
    const key = `mailpilot_automation_run_${new Date().toDateString()}`;
    if (typeof window !== "undefined" && !window.sessionStorage.getItem(key)) {
      window.sessionStorage.setItem(key, "1");
      void runNow();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.runOnAppStart]);

  return (
    <main className="min-h-screen p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Automatisierung</h1>
        <button
          onClick={() => void runNow()}
          disabled={runningNow}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm disabled:opacity-60"
        >
          {runningNow ? "Läuft..." : "Jetzt ausführen"}
        </button>
      </div>

      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-gray-200 p-3">
          <h2 className="mb-2 text-sm font-semibold">Einstellungen</h2>
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.runOnAppStart}
                onChange={(e) => void saveSettings({ runOnAppStart: e.target.checked })}
              />
              Beim App-Start ausführen
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.autoAnalyzeNewEmails}
                onChange={(e) => void saveSettings({ autoAnalyzeNewEmails: e.target.checked })}
              />
              KI-Analyse neuer Mails
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.autoApplyUserRules}
                onChange={(e) => void saveSettings({ autoApplyUserRules: e.target.checked })}
              />
              Benutzerregeln automatisch anwenden
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.autoApplyAiSuggestions}
                onChange={(e) => void saveSettings({ autoApplyAiSuggestions: e.target.checked })}
              />
              KI-Vorschläge automatisch anwenden
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.autoSaveAttachments}
                onChange={(e) => void saveSettings({ autoSaveAttachments: e.target.checked })}
              />
              Anhänge automatisch vormerken/speichern
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label>
                <span className="block text-xs text-gray-600">
                  Neue Mails pruefen alle (Min.)
                </span>
                <input
                  type="number"
                  min={5}
                  value={settings.runIntervalMinutes}
                  onChange={(e) =>
                    void saveSettings({ runIntervalMinutes: Number(e.target.value) || 30 })
                  }
                  className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                />
              </label>
              <label>
                <span className="block text-xs text-gray-600">Min. KI-Confidence Move</span>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  max={1}
                  value={settings.aiMinConfidenceForMove}
                  onChange={(e) =>
                    void saveSettings({ aiMinConfidenceForMove: Number(e.target.value) || 0.9 })
                  }
                  className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                />
              </label>
              <label>
                <span className="block text-xs text-gray-600">Min. KI-Confidence Trash</span>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  max={1}
                  value={settings.aiMinConfidenceForTrash}
                  onChange={(e) =>
                    void saveSettings({ aiMinConfidenceForTrash: Number(e.target.value) || 0.98 })
                  }
                  className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                />
              </label>
              <label>
                <span className="block text-xs text-gray-600">Min. KI-Confidence Spam</span>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  max={1}
                  value={settings.aiMinConfidenceForSpam}
                  onChange={(e) =>
                    void saveSettings({ aiMinConfidenceForSpam: Number(e.target.value) || 0.98 })
                  }
                  className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                />
              </label>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 p-3">
          <h2 className="mb-2 text-sm font-semibold">Letzter Lauf</h2>
          {runs[0] ? (
            <div className="text-sm">
              <p>
                Status: <strong>{runs[0].status}</strong>
              </p>
              <p>Typ: {runs[0].type}</p>
              <p>Start: {new Date(runs[0].startedAt).toLocaleString("de-DE")}</p>
              <p>
                Ende:{" "}
                {runs[0].finishedAt ? new Date(runs[0].finishedAt).toLocaleString("de-DE") : "-"}
              </p>
              <p>Synchronisierte Mails: {runs[0].resultJson?.synced ?? 0}</p>
              <p>Analysierte Mails: {runs[0].resultJson?.analyzed ?? 0}</p>
              <p>Angewendete Regeln: {runs[0].resultJson?.appliedRules ?? 0}</p>
              <p>Verschobene Mails: {runs[0].resultJson?.blockedMoved ?? 0}</p>
              {runs[0].error ? <p className="text-red-600">Fehler: {runs[0].error}</p> : null}
              <a href="/audit" className="mt-2 inline-block text-sm underline">
                Zum AuditLog
              </a>
            </div>
          ) : (
            <p className="text-sm text-gray-600">Noch kein Lauf vorhanden.</p>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-gray-200 p-3">
        <h2 className="mb-2 text-sm font-semibold">Laufhistorie</h2>
        {loading ? <p className="text-sm text-gray-600">Lade Läufe...</p> : null}
        <ul className="space-y-2 text-sm">
          {runs.map((run) => (
            <li key={run.id} className="rounded border border-gray-100 p-2">
              {run.type} - {run.status} - {new Date(run.startedAt).toLocaleString("de-DE")}
              {run.error ? <span className="text-red-600"> - {run.error}</span> : null}
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
