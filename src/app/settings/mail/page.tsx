"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_MAIL_SCROLL_BATCH,
  MAIL_SCROLL_BATCH_OPTIONS,
  type MailScrollBatchOption,
  snapMailScrollBatchSize,
} from "@/lib/mailScrollBatch";

export default function MailViewSettingsPage() {
  const [batchSize, setBatchSize] = useState<MailScrollBatchOption>(DEFAULT_MAIL_SCROLL_BATCH);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  async function load() {
    const res = await fetch("/api/automation/settings");
    if (!res.ok) {
      setError("Einstellungen konnten nicht geladen werden.");
      return;
    }
    const data = (await res.json()) as { settings?: { mailScrollBatchSize?: number } };
    const raw = data.settings?.mailScrollBatchSize;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      setBatchSize(snapMailScrollBatchSize(raw));
    }
  }

  async function save(next: MailScrollBatchOption) {
    setSaving(true);
    setError("");
    setInfo("");
    const res = await fetch("/api/automation/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mailScrollBatchSize: next }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Speichern fehlgeschlagen.");
      setSaving(false);
      return;
    }
    setBatchSize(next);
    setInfo(
      "Gespeichert. Beim nächsten Öffnen der Mail-Ansicht oder nach Wechsel von Ordner/Konto wird mit der neuen Stückelung geladen.",
    );
    setSaving(false);
  }

  useEffect(() => {
    const t = setTimeout(() => {
      void load().finally(() => setLoading(false));
    }, 0);
    return () => clearTimeout(t);
  }, []);

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-3">
          <a href="/settings" className="text-sm text-gray-600 hover:underline">
            ← Zurück zu Einstellungen
          </a>
        </div>
        <h1 className="text-2xl font-semibold text-gray-900">Mail-Ansicht</h1>
        <p className="mt-1 text-sm text-gray-600">
          In der Posteingangsliste werden E-Mails seitenweise geladen. Wenn du nach unten scrollst,
          wird jeweils die hier gewählte Anzahl nachgeladen (bis alle Mails des aktuellen Filters
          geladen sind).
        </p>

        <div className="mt-6 rounded-xl border border-gray-200 bg-white p-4">
          {loading ? <p className="text-sm text-gray-600">Lade Einstellungen...</p> : null}
          {error ? <p className="mb-2 text-sm text-red-600">{error}</p> : null}
          {info ? <p className="mb-2 text-sm text-blue-800">{info}</p> : null}

          {!loading ? (
            <label className="block text-sm">
              <span className="font-medium text-gray-900">Mails pro Nachladen beim Scrollen</span>
              <select
                className="mt-2 w-full max-w-xs rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                disabled={saving}
                value={batchSize}
                onChange={(e) => {
                  const v = snapMailScrollBatchSize(Number(e.target.value));
                  setBatchSize(v);
                  void save(v);
                }}
              >
                {MAIL_SCROLL_BATCH_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n} Mails
                  </option>
                ))}
              </select>
              <span className="mt-2 block text-xs text-gray-500">
                Kleinere Werte: weniger Daten pro Anfrage. Größere Werte: seltener nachladen, dafür
                etwas mehr auf einmal.
              </span>
            </label>
          ) : null}
        </div>
      </div>
    </main>
  );
}
