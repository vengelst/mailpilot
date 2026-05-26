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
    <main className="min-h-screen p-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-3">
          <a href="/settings" className="text-sm glass-text-secondary hover:underline">
            ← Zurück zu Einstellungen
          </a>
        </div>
        <h1 className="text-2xl font-semibold glass-text-primary">Signatur</h1>
        <p className="mt-1 text-sm glass-text-secondary">
          Definiere eine Standardsignatur und wann sie automatisch in Mail-Aktionen eingefügt wird.
        </p>

        <div className="glass-card mt-6 rounded-xl p-4">
          {loading ? <p className="text-sm glass-text-secondary">Lade Einstellungen...</p> : null}
          {error ? <p className="mb-2 text-sm glass-error rounded-lg px-3 py-1.5">{error}</p> : null}
          {info ? <p className="mb-2 text-sm glass-info rounded-lg px-3 py-1.5">{info}</p> : null}

          <label className="block">
            <span className="mb-1 block text-sm font-medium glass-text-primary">Standardsignatur</span>
            <textarea
              value={settings.signatureText}
              onChange={(e) => setSettings((prev) => ({ ...prev, signatureText: e.target.value }))}
              rows={8}
              placeholder={"Viele Grüße\nMax Mustermann\nFirma"}
              className="glass-input w-full rounded-xl px-3 py-2 text-sm"
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
              className="glass-btn-dark rounded-lg px-4 py-2 text-sm disabled:opacity-60"
            >
              {saving ? "Speichere..." : "Speichern"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
