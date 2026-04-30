"use client";

import { useEffect, useState } from "react";

type SignatureSettings = {
  signatureText: string;
  includeOnNewMail: boolean;
  includeOnReply: boolean;
  includeOnForward: boolean;
};

const defaults: SignatureSettings = {
  signatureText: "",
  includeOnNewMail: true,
  includeOnReply: true,
  includeOnForward: true,
};

export default function SignatureSettingsPage() {
  const [settings, setSettings] = useState<SignatureSettings>(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  async function loadSettings() {
    const res = await fetch("/api/signature/settings");
    if (!res.ok) {
      setError("Signatur-Einstellungen konnten nicht geladen werden.");
      return;
    }
    const data = (await res.json()) as { settings?: SignatureSettings };
    if (data.settings) {
      setSettings(data.settings);
    }
  }

  async function saveSettings(next: SignatureSettings) {
    setSaving(true);
    setError("");
    setInfo("");
    const res = await fetch("/api/signature/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({} as { error?: string }));
      setError(data.error ?? "Signatur konnte nicht gespeichert werden.");
      setSaving(false);
      return;
    }
    setInfo("Signatur gespeichert.");
    setSaving(false);
  }

  useEffect(() => {
    const timer = setTimeout(async () => {
      await loadSettings();
      setLoading(false);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-3">
          <a href="/settings" className="text-sm text-gray-600 hover:underline">
            ← Zurück zu Einstellungen
          </a>
        </div>
        <h1 className="text-2xl font-semibold text-gray-900">Signatur</h1>
        <p className="mt-1 text-sm text-gray-600">
          Definiere eine Standardsignatur und wann sie automatisch in Mail-Aktionen eingefügt wird.
        </p>

        <div className="mt-6 rounded-xl border border-gray-200 bg-white p-4">
          {loading ? <p className="text-sm text-gray-600">Lade Einstellungen...</p> : null}
          {error ? <p className="mb-2 text-sm text-red-600">{error}</p> : null}
          {info ? <p className="mb-2 text-sm text-blue-700">{info}</p> : null}

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-800">Standardsignatur</span>
            <textarea
              value={settings.signatureText}
              onChange={(e) => setSettings((prev) => ({ ...prev, signatureText: e.target.value }))}
              rows={8}
              placeholder={"Viele Grüße\nMax Mustermann\nFirma"}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </label>

          <div className="mt-4 space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.includeOnNewMail}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, includeOnNewMail: e.target.checked }))
                }
              />
              Bei neuer Mail einfügen
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.includeOnReply}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, includeOnReply: e.target.checked }))
                }
              />
              Bei Antworten einfügen
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.includeOnForward}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, includeOnForward: e.target.checked }))
                }
              />
              Bei Weiterleiten einfügen
            </label>
          </div>

          <div className="mt-4">
            <button
              disabled={saving}
              onClick={() => void saveSettings(settings)}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-60"
            >
              {saving ? "Speichere..." : "Speichern"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
