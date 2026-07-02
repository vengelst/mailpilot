"use client";

import { useEffect, useState } from "react";

type DuplicateEmail = {
  id: string;
  accountId: string;
  subject: string | null;
  fromEmail: string | null;
  fromName: string | null;
  date: string | null;
  folderPath: string;
  accountName?: string;
};

type DuplicateGroup = {
  matchType: "messageId" | "heuristic";
  emails: DuplicateEmail[];
};

type DuplicatesResponse = {
  groups: DuplicateGroup[];
  totalGroups: number;
  error?: string;
};

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.valueOf())) return "-";
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function DuplicatesPage() {
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [deletedGroups, setDeletedGroups] = useState<Set<number>>(new Set());

  async function loadDuplicates() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/emails/duplicates?limit=200");
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(
          (data as { error?: string })?.error ??
            `Fehler beim Laden (HTTP ${res.status})`,
        );
        return;
      }
      const data = (await res.json()) as DuplicatesResponse;
      setGroups(data.groups);
      setDeletedGroups(new Set());
    } catch {
      setError("Netzwerkfehler beim Laden der Duplikate.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/emails/duplicates?limit=200");
        if (cancelled) return;
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          if (!cancelled)
            setError(
              (data as { error?: string })?.error ??
                `Fehler beim Laden (HTTP ${res.status})`,
            );
          return;
        }
        const data = (await res.json()) as DuplicatesResponse;
        if (!cancelled) {
          setGroups(data.groups);
          setDeletedGroups(new Set());
        }
      } catch {
        if (!cancelled) setError("Netzwerkfehler beim Laden der Duplikate.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function pickOriginal(emails: DuplicateEmail[]): string {
    const sorted = [...emails].sort((a, b) => {
      const dateA = a.date ? new Date(a.date).getTime() : 0;
      const dateB = b.date ? new Date(b.date).getTime() : 0;
      return dateB - dateA;
    });
    return sorted[0].id;
  }

  async function trashEmail(emailId: string) {
    setDeletingIds((prev) => new Set(prev).add(emailId));
    try {
      const res = await fetch(`/api/emails/${emailId}/move`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetSpecial: "trash" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(
          (data as { error?: string })?.error ?? "Fehler beim Löschen.",
        );
        return;
      }
      setGroups((prev) =>
        prev.map((g) => ({
          ...g,
          emails: g.emails.filter((e) => e.id !== emailId),
        })),
      );
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(emailId);
        return next;
      });
    }
  }

  async function trashGroupDuplicates(groupIndex: number) {
    const group = groups[groupIndex];
    if (!group) return;
    const originalId = pickOriginal(group.emails);
    const toDelete = group.emails.filter((e) => e.id !== originalId);

    const ids = new Set(toDelete.map((e) => e.id));
    setDeletingIds((prev) => new Set([...prev, ...ids]));

    try {
      await Promise.all(
        toDelete.map((e) =>
          fetch(`/api/emails/${e.id}/move`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ targetSpecial: "trash" }),
          }),
        ),
      );
      setDeletedGroups((prev) => new Set(prev).add(groupIndex));
      setGroups((prev) =>
        prev.map((g, i) =>
          i === groupIndex
            ? { ...g, emails: g.emails.filter((e) => e.id === originalId) }
            : g,
        ),
      );
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
    }
  }

  async function trashAllDuplicates() {
    if (
      !window.confirm(
        `Alle Duplikate in den Papierkorb verschieben? Es wird jeweils das neueste Original behalten.`,
      )
    )
      return;

    setBulkDeleting(true);
    setError("");

    try {
      for (let i = 0; i < groups.length; i++) {
        if (deletedGroups.has(i)) continue;
        if (groups[i].emails.length < 2) continue;
        await trashGroupDuplicates(i);
      }
    } finally {
      setBulkDeleting(false);
    }
  }

  const activeGroups = groups.filter(
    (g, i) => !deletedGroups.has(i) && g.emails.length >= 2,
  );
  const totalDuplicates = activeGroups.reduce(
    (sum, g) => sum + g.emails.length - 1,
    0,
  );

  return (
    <main className="min-h-screen p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-2 flex items-center gap-2">
          <a href="/mail" className="text-sm glass-text-secondary hover:underline">
            ← Zurück zur Mail
          </a>
        </div>
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold glass-text-primary">
            Duplikate erkennen
          </h1>
          <button
            onClick={() => void loadDuplicates()}
            disabled={loading}
            className="glass-btn rounded-lg px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Neu laden
          </button>
        </div>

        {error && (
          <p className="glass-error mt-3 px-3 py-2 text-sm">{error}</p>
        )}

        {loading && (
          <p className="mt-4 text-sm glass-text-secondary">
            Duplikate werden gesucht...
          </p>
        )}

        {!loading && activeGroups.length === 0 && (
          <div className="glass mt-6 rounded-lg border border-dashed border-white/20 p-6 text-center">
            <p className="text-sm glass-text-muted">
              Keine Duplikate gefunden. Alle E-Mails sind einzigartig.
            </p>
          </div>
        )}

        {!loading && activeGroups.length > 0 && (
          <>
            <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3">
              <div className="glass-card p-3 text-sm">
                <p className="glass-text-muted">Duplikat-Gruppen</p>
                <p className="text-lg font-semibold tabular-nums glass-text-primary">
                  {activeGroups.length}
                </p>
              </div>
              <div className="glass-card p-3 text-sm">
                <p className="glass-text-muted">Duplikate gesamt</p>
                <p className="text-lg font-semibold tabular-nums glass-text-primary">
                  {totalDuplicates}
                </p>
              </div>
              <div className="glass-card col-span-2 flex items-center justify-center p-3 md:col-span-1">
                <button
                  onClick={() => void trashAllDuplicates()}
                  disabled={bulkDeleting || totalDuplicates === 0}
                  className="glass-btn-primary rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
                >
                  {bulkDeleting
                    ? "Lösche..."
                    : `Alle ${totalDuplicates} Duplikate löschen`}
                </button>
              </div>
            </div>

            <ul className="mt-6 space-y-3">
              {groups.map((group, groupIndex) => {
                if (deletedGroups.has(groupIndex) || group.emails.length < 2)
                  return null;
                const originalId = pickOriginal(group.emails);
                return (
                  <li
                    key={groupIndex}
                    className="glass overflow-hidden rounded-lg"
                  >
                    <div className="flex items-center justify-between border-b border-white/10 bg-white/5 px-3 py-2">
                      <div className="flex items-center gap-2 text-sm">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            group.matchType === "messageId"
                              ? "bg-green-500/20 text-green-300"
                              : "bg-amber-500/20 text-amber-300"
                          }`}
                        >
                          {group.matchType === "messageId"
                            ? "Message-ID"
                            : "Heuristik"}
                        </span>
                        <span className="font-medium glass-text-primary">
                          {group.emails.length} E-Mails
                        </span>
                      </div>
                      <button
                        onClick={() => void trashGroupDuplicates(groupIndex)}
                        disabled={
                          bulkDeleting ||
                          group.emails.every((e) => deletingIds.has(e.id))
                        }
                        className="glass-btn rounded-lg px-2 py-1 text-xs disabled:opacity-50"
                      >
                        Duplikate löschen
                      </button>
                    </div>
                    <ul className="divide-y divide-white/5 px-3 py-1">
                      {group.emails.map((email) => {
                        const isOriginal = email.id === originalId;
                        const isDeleting = deletingIds.has(email.id);
                        return (
                          <li
                            key={email.id}
                            className={`flex items-center gap-3 py-2 ${
                              isDeleting ? "opacity-40" : ""
                            }`}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-baseline gap-2">
                                <p className="truncate text-sm font-medium glass-text-primary">
                                  {email.subject || "(Ohne Betreff)"}
                                </p>
                                {isOriginal && (
                                  <span className="shrink-0 rounded-full bg-blue-500/20 px-1.5 py-0.5 text-[10px] text-blue-300">
                                    Original
                                  </span>
                                )}
                              </div>
                              <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs glass-text-secondary">
                                <span>
                                  {email.fromName || email.fromEmail || "Unbekannt"}
                                </span>
                                <span>{formatDateTime(email.date)}</span>
                                <span className="glass-text-muted">
                                  {email.folderPath}
                                </span>
                                {email.accountName && (
                                  <span className="glass-text-muted">
                                    ({email.accountName})
                                  </span>
                                )}
                              </div>
                            </div>
                            {!isOriginal && (
                              <button
                                onClick={() => void trashEmail(email.id)}
                                disabled={isDeleting || bulkDeleting}
                                className="glass-btn shrink-0 rounded-lg px-2 py-1 text-[11px] disabled:opacity-50"
                                title="In den Papierkorb verschieben"
                              >
                                Löschen
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </main>
  );
}
