"use client";

import { useEffect, useState } from "react";

type CloudAccount = {
  id: string;
  provider: "google_drive" | "onedrive";
  displayName: string | null;
  tokenExpiresAt: string | null;
  createdAt: string;
};

export default function CloudSettingsPage() {
  const [accounts, setAccounts] = useState<CloudAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadAccounts() {
    setLoading(true);
    setError("");
    const res = await fetch("/api/cloud/accounts");
    if (!res.ok) {
      setError("Cloud-Konten konnten nicht geladen werden.");
      setLoading(false);
      return;
    }
    const data = await res.json();
    setAccounts(data.accounts ?? []);
    setLoading(false);
  }

  async function startConnect(provider: "google_drive" | "onedrive") {
    const res = await fetch(`/api/cloud/oauth/start?provider=${provider}`);
    const data = await res.json();
    if (!res.ok || !data.authUrl) {
      setError(data.error ?? "OAuth-Start fehlgeschlagen");
      return;
    }
    window.open(data.authUrl, "_blank", "noopener,noreferrer");
  }

  async function disconnect(id: string) {
    await fetch(`/api/cloud/accounts/${id}`, { method: "DELETE" });
    await loadAccounts();
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadAccounts();
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  return (
    <main className="min-h-screen p-6">
      <div className="mb-4 flex items-center gap-2">
        <a href="/settings" className="text-sm glass-text-secondary hover:underline">
          ← Einstellungen
        </a>
      </div>
      <h1 className="text-xl font-semibold glass-text-primary">Cloud-Konten</h1>
      <p className="mt-2 text-sm glass-text-secondary">
        OAuth-Tokens werden ausschließlich serverseitig verschlüsselt gespeichert.
      </p>

      <div className="mt-4 flex gap-2">
        <button
          onClick={() => void startConnect("google_drive")}
          className="glass-btn rounded-lg px-3 py-2 text-sm"
        >
          Google Drive verbinden
        </button>
        <button
          onClick={() => void startConnect("onedrive")}
          className="glass-btn rounded-lg px-3 py-2 text-sm"
        >
          OneDrive verbinden
        </button>
      </div>

      {error ? <p className="mt-3 text-sm glass-error rounded-xl px-3 py-2">{error}</p> : null}
      {loading ? <p className="mt-3 text-sm glass-text-secondary">Lade Cloud-Konten...</p> : null}

      <ul className="mt-4 space-y-2">
        {accounts.map((account) => (
          <li key={account.id} className="glass-card rounded-xl p-3">
            <p className="text-sm font-medium glass-text-primary">
              {account.displayName ?? account.provider} ({account.provider})
            </p>
            <p className="text-xs glass-text-secondary">
              Token gültig bis:{" "}
              {account.tokenExpiresAt ? new Date(account.tokenExpiresAt).toLocaleString("de-DE") : "unbekannt"}
            </p>
            <button
              onClick={() => void disconnect(account.id)}
              className="glass-btn mt-2 rounded-lg px-2 py-1 text-xs"
            >
              Verbindung trennen
            </button>
          </li>
        ))}
      </ul>

      {!loading && accounts.length === 0 ? (
        <p className="mt-3 text-sm glass-text-secondary">Noch keine Cloud-Konten verbunden.</p>
      ) : null}
    </main>
  );
}
