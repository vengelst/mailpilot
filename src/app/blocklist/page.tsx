"use client";

import { useEffect, useState } from "react";

type BlockEntry = {
  id: string;
  email: string | null;
  domain: string | null;
  action: "move_trash" | "move_spam" | "mark_newsletter" | "ignore";
  note: string | null;
  active: boolean;
  createdAt: string;
};

export default function BlocklistPage() {
  const [entries, setEntries] = useState<BlockEntry[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadEntries() {
    setLoading(true);
    const res = await fetch("/api/blocklist");
    if (!res.ok) {
      setEntries([]);
      setLoading(false);
      return;
    }
    const data = await res.json();
    setEntries(data.entries ?? []);
    setLoading(false);
  }

  async function toggleActive(entry: BlockEntry) {
    await fetch(`/api/blocklist/${entry.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: !entry.active }),
    });
    await loadEntries();
  }

  async function removeEntry(id: string) {
    await fetch(`/api/blocklist/${id}`, { method: "DELETE" });
    await loadEntries();
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadEntries();
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  return (
    <main className="min-h-screen p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Blockliste</h1>
        <button
          onClick={() => void loadEntries()}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        >
          Aktualisieren
        </button>
      </div>

      {loading ? <p className="text-sm text-gray-600">Lade Blockliste...</p> : null}

      <ul className="space-y-2">
        {entries.map((entry) => (
          <li key={entry.id} className="rounded-lg border border-gray-200 bg-white p-3">
            <p className="text-sm font-medium">
              {entry.email ? `E-Mail: ${entry.email}` : `Domain: ${entry.domain}`}
            </p>
            <p className="text-xs text-gray-600">
              Aktion: {entry.action} | Status: {entry.active ? "aktiv" : "inaktiv"}
            </p>
            {entry.note ? <p className="mt-1 text-xs text-gray-600">Notiz: {entry.note}</p> : null}
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => void toggleActive(entry)}
                className="rounded-md border border-gray-300 px-2 py-1 text-xs"
              >
                {entry.active ? "Deaktivieren" : "Aktivieren"}
              </button>
              <button
                onClick={() => void removeEntry(entry.id)}
                className="rounded-md border border-gray-300 px-2 py-1 text-xs"
              >
                Löschen
              </button>
            </div>
          </li>
        ))}
      </ul>

      {!loading && entries.length === 0 ? (
        <p className="text-sm text-gray-600">Keine blockierten Absender oder Domains vorhanden.</p>
      ) : null}
    </main>
  );
}
