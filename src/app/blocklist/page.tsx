"use client";

import { useEffect, useState } from "react";

type BlockAction = "move_trash" | "move_spam" | "mark_newsletter" | "ignore" | "allow_inbox";

type BlockEntry = {
  id: string;
  email: string | null;
  domain: string | null;
  action: BlockAction;
  note: string | null;
  active: boolean;
  createdAt: string;
};

const ACTION_LABELS: Record<BlockAction, string> = {
  allow_inbox: "Erlaubt (Posteingang)",
  move_spam: "In Spam verschieben",
  move_trash: "In Papierkorb verschieben",
  mark_newsletter: "Als Newsletter markieren",
  ignore: "Ignorieren",
};

const ACTION_COLORS: Record<BlockAction, string> = {
  allow_inbox: "text-green-400",
  move_spam: "text-red-400",
  move_trash: "text-orange-400",
  mark_newsletter: "text-blue-400",
  ignore: "text-gray-400",
};

const emptyForm = { email: "", domain: "", action: "allow_inbox" as BlockAction, note: "" };

export default function BlocklistPage() {
  const [entries, setEntries] = useState<BlockEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const [feedback, setFeedback] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const [tab, setTab] = useState<"all" | "allowed" | "blocked">("all");

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

  async function addEntry(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    if (!form.email.trim() && !form.domain.trim()) {
      setFeedback({ kind: "error", text: "E-Mail oder Domain muss angegeben werden." });
      return;
    }
    const res = await fetch("/api/blocklist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(form.email.trim() ? { email: form.email.trim() } : {}),
        ...(form.domain.trim() ? { domain: form.domain.trim() } : {}),
        action: form.action,
        note: form.note.trim() || undefined,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setFeedback({ kind: "error", text: (data as { error?: string }).error ?? "Speichern fehlgeschlagen" });
      return;
    }
    setForm(emptyForm);
    setFeedback({ kind: "info", text: "Eintrag gespeichert." });
    await loadEntries();
  }

  async function updateEntry(id: string) {
    setFeedback(null);
    if (!editForm.email.trim() && !editForm.domain.trim()) {
      setFeedback({ kind: "error", text: "E-Mail oder Domain muss angegeben werden." });
      return;
    }
    const res = await fetch(`/api/blocklist/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: editForm.email.trim() || undefined,
        domain: editForm.domain.trim() || undefined,
        action: editForm.action,
        note: editForm.note.trim() || undefined,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setFeedback({ kind: "error", text: (data as { error?: string }).error ?? "Speichern fehlgeschlagen" });
      return;
    }
    setEditingId(null);
    setFeedback({ kind: "info", text: "Eintrag aktualisiert." });
    await loadEntries();
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
    if (!window.confirm("Eintrag wirklich löschen?")) return;
    await fetch(`/api/blocklist/${id}`, { method: "DELETE" });
    await loadEntries();
  }

  function startEditing(entry: BlockEntry) {
    setEditingId(entry.id);
    setEditForm({
      email: entry.email ?? "",
      domain: entry.domain ?? "",
      action: entry.action,
      note: entry.note ?? "",
    });
  }

  useEffect(() => {
    const timer = setTimeout(() => { void loadEntries(); }, 0);
    return () => clearTimeout(timer);
  }, []);

  const filtered = entries.filter((e) => {
    if (tab === "allowed") return e.action === "allow_inbox";
    if (tab === "blocked") return e.action !== "allow_inbox";
    return true;
  });

  return (
    <main className="min-h-screen p-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex items-center gap-2">
          <a href="/mail" className="text-sm glass-text-secondary hover:underline">
            ← Zurück zur Mail
          </a>
        </div>
        <h1 className="text-2xl font-semibold glass-text-primary">Absender-Regeln</h1>
        <p className="mt-1 text-sm glass-text-secondary">
          Verwalte erlaubte und blockierte Absender. Erlaubte Absender werden nicht als Spam eingestuft.
        </p>

        {feedback ? (
          <p className={`mt-3 rounded-xl px-3 py-2 text-sm ${feedback.kind === "error" ? "glass-error" : "glass-success-box"}`}>
            {feedback.text}
          </p>
        ) : null}

        {/* New entry form */}
        <form onSubmit={addEntry} className="glass-card mt-4 rounded-xl p-4">
          <h2 className="text-sm font-semibold glass-text-primary">Neuer Eintrag</h2>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs glass-text-secondary">E-Mail-Adresse</label>
              <input
                placeholder="absender@beispiel.de"
                value={form.email}
                onChange={(e) => setForm((v) => ({ ...v, email: e.target.value }))}
                className="glass-input w-full rounded-xl px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs glass-text-secondary">oder Domain</label>
              <input
                placeholder="beispiel.de"
                value={form.domain}
                onChange={(e) => setForm((v) => ({ ...v, domain: e.target.value }))}
                className="glass-input w-full rounded-xl px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs glass-text-secondary">Aktion</label>
              <select
                value={form.action}
                onChange={(e) => setForm((v) => ({ ...v, action: e.target.value as BlockAction }))}
                className="glass-select w-full rounded-xl px-3 py-2 text-sm"
              >
                {Object.entries(ACTION_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs glass-text-secondary">Notiz (optional)</label>
              <input
                placeholder="z.B. Geschäftspartner"
                value={form.note}
                onChange={(e) => setForm((v) => ({ ...v, note: e.target.value }))}
                className="glass-input w-full rounded-xl px-3 py-2 text-sm"
              />
            </div>
          </div>
          <button type="submit" className="glass-btn-dark mt-3 w-full rounded-lg px-3 py-2 text-sm sm:w-auto">
            Eintrag hinzufügen
          </button>
        </form>

        {/* Tabs */}
        <div className="mt-6 flex gap-2">
          {(["all", "allowed", "blocked"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-lg px-3 py-1.5 text-sm transition-all ${
                tab === t ? "glass-solid font-semibold glass-text-primary" : "glass-btn glass-text-secondary"
              }`}
            >
              {t === "all" ? `Alle (${entries.length})` : t === "allowed" ? `Erlaubt (${entries.filter((e) => e.action === "allow_inbox").length})` : `Blockiert (${entries.filter((e) => e.action !== "allow_inbox").length})`}
            </button>
          ))}
        </div>

        {/* List */}
        {loading ? <p className="mt-4 text-sm glass-text-secondary">Lade Liste...</p> : null}

        <ul className="mt-3 space-y-2">
          {filtered.map((entry) => (
            <li key={entry.id} className={`glass-card rounded-xl p-3 ${!entry.active ? "opacity-50" : ""}`}>
              {editingId === entry.id ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <input
                      placeholder="E-Mail"
                      value={editForm.email}
                      onChange={(e) => setEditForm((v) => ({ ...v, email: e.target.value }))}
                      className="glass-input w-full rounded-xl px-3 py-2 text-sm"
                    />
                    <input
                      placeholder="Domain"
                      value={editForm.domain}
                      onChange={(e) => setEditForm((v) => ({ ...v, domain: e.target.value }))}
                      className="glass-input w-full rounded-xl px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <select
                      value={editForm.action}
                      onChange={(e) => setEditForm((v) => ({ ...v, action: e.target.value as BlockAction }))}
                      className="glass-select w-full rounded-xl px-3 py-2 text-sm"
                    >
                      {Object.entries(ACTION_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>{label}</option>
                      ))}
                    </select>
                    <input
                      placeholder="Notiz"
                      value={editForm.note}
                      onChange={(e) => setEditForm((v) => ({ ...v, note: e.target.value }))}
                      className="glass-input w-full rounded-xl px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => void updateEntry(entry.id)}
                      className="glass-btn-dark rounded-lg px-3 py-1.5 text-xs"
                    >
                      Speichern
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="glass-btn rounded-lg px-3 py-1.5 text-xs"
                    >
                      Abbrechen
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium glass-text-primary">
                        {entry.email ?? entry.domain}
                      </p>
                      {entry.email && entry.domain ? (
                        <p className="text-xs glass-text-secondary">Domain: {entry.domain}</p>
                      ) : null}
                    </div>
                    <span className={`rounded-lg px-2 py-0.5 text-xs font-medium ${ACTION_COLORS[entry.action]}`}>
                      {ACTION_LABELS[entry.action]}
                    </span>
                  </div>
                  {entry.note ? <p className="mt-1 text-xs glass-text-tertiary">{entry.note}</p> : null}
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => startEditing(entry)}
                      className="glass-btn rounded-lg px-2 py-1 text-xs"
                    >
                      Bearbeiten
                    </button>
                    <button
                      onClick={() => void toggleActive(entry)}
                      className="glass-btn rounded-lg px-2 py-1 text-xs"
                    >
                      {entry.active ? "Deaktivieren" : "Aktivieren"}
                    </button>
                    <button
                      onClick={() => void removeEntry(entry.id)}
                      className="glass-btn rounded-lg px-2 py-1 text-xs text-red-400"
                    >
                      Löschen
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>

        {!loading && filtered.length === 0 ? (
          <p className="mt-4 text-sm glass-text-secondary">
            {tab === "allowed" ? "Keine erlaubten Absender vorhanden." : tab === "blocked" ? "Keine blockierten Absender vorhanden." : "Keine Einträge vorhanden."}
          </p>
        ) : null}
      </div>
    </main>
  );
}
