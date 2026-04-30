"use client";

import { useEffect, useMemo, useState } from "react";
import { EmailDetailModal } from "@/components/mail/email-detail-modal";

type EmailRow = {
  id: string;
  accountId: string;
  subject: string | null;
  fromName: string | null;
  fromEmail: string | null;
  date: string | null;
  createdAt: string | null;
  folderPath: string;
  aiCategory: string | null;
  aiPriority: string | null;
  actionRequired: boolean;
  hasAttachments: boolean;
  isRead: boolean;
  snippet: string | null;
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

type FolderGroup = {
  folderPath: string;
  count: number;
  unreadCount: number;
  attachmentsCount: number;
  actionRequiredCount: number;
};

type SearchStats = {
  total: number;
  unreadTotal: number;
  attachmentsTotal: number;
  actionRequiredTotal: number;
};

type SearchResponse = {
  emails?: EmailRow[];
  pageInfo?: {
    nextCursor: string | null;
    hasMore: boolean;
    limit: number;
    limitApplied: boolean;
  };
  stats?: SearchStats;
  folderGroups?: FolderGroup[];
  error?: string;
};

const LIMIT_OPTIONS = [50, 100, 200, 300, 500] as const;
type LimitOption = (typeof LIMIT_OPTIONS)[number];

async function safeJson<T = unknown>(res: Response): Promise<T | null> {
  try {
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export default function SearchPage() {
  const [rows, setRows] = useState<EmailRow[]>([]);
  const [stats, setStats] = useState<SearchStats | null>(null);
  const [folderGroups, setFolderGroups] = useState<FolderGroup[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [query, setQuery] = useState("");
  const [accountId, setAccountId] = useState("");
  const [folder, setFolder] = useState("");
  const [category, setCategory] = useState("");
  const [priority, setPriority] = useState("");
  const [actionRequired, setActionRequired] = useState<"" | "true" | "false">("");
  const [hasAttachments, setHasAttachments] = useState<"" | "true" | "false">("");
  const [isRead, setIsRead] = useState<"" | "true" | "false">("");
  const [sort, setSort] = useState<
    "date_desc" | "date_asc" | "from_asc" | "subject_asc"
  >("date_desc");
  const [limit, setLimit] = useState<LimitOption>(100);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [moveTarget, setMoveTarget] = useState("");
  const [openEmailId, setOpenEmailId] = useState<string | null>(null);

  function toggleEmailSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleFolderGroupSelected(folderPath: string, groupRows: EmailRow[]) {
    const allInGroupSelected =
      groupRows.length > 0 && groupRows.every((r) => selectedIds.has(r.id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allInGroupSelected) {
        for (const r of groupRows) next.delete(r.id);
      } else {
        for (const r of groupRows) next.add(r.id);
      }
      return next;
    });
  }
  function toggleSelectAllLoaded() {
    const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id));
    setSelectedIds(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  }
  function clearSelection() {
    setSelectedIds(new Set());
  }

  async function runBulk(
    action: "mark_read" | "mark_unread" | "move_trash" | "move_spam" | "move_folder",
    targetFolder?: string,
  ) {
    if (selectedIds.size === 0) return;
    // Confirm for destructive moves when more than one mail is selected.
    if (
      (action === "move_trash" || action === "move_spam") &&
      selectedIds.size > 1 &&
      !window.confirm(
        `${selectedIds.size} E-Mails in den ${
          action === "move_trash" ? "Papierkorb" : "Spam"
        }-Ordner verschieben?`,
      )
    ) {
      return;
    }
    setBulkBusy(true);
    try {
      const res = await fetch("/api/emails/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          emailIds: Array.from(selectedIds),
          targetFolder,
        }),
      });
      const data = await safeJson<{
        error?: string;
        summary?: { executed: number; failed: number; rejected: number };
      }>(res);
      if (!res.ok) {
        setError(data?.error ?? `Bulk-Aktion fehlgeschlagen (HTTP ${res.status}).`);
        return;
      }
      clearSelection();
      await runSearch();
    } finally {
      setBulkBusy(false);
    }
  }

  /**
   * Forward only works for one mail at a time — bulk-forwarding multiple
   * unrelated mails through a single mailto would clobber recipients and
   * confuse the recipient. We open mailto for the one selected mail, otherwise
   * show a hint.
   */
  function bulkForward() {
    if (selectedIds.size !== 1) return;
    const id = Array.from(selectedIds)[0];
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    const subject = `Fwd: ${row.subject ?? ""}`;
    const lines = [
      "--- Weitergeleitete Nachricht ---",
      `Von: ${row.fromName || row.fromEmail || "Unbekannt"}${
        row.fromEmail ? ` <${row.fromEmail}>` : ""
      }`,
      `Datum: ${row.date ? new Date(row.date).toLocaleString("de-DE") : "-"}`,
      `Betreff: ${row.subject ?? ""}`,
    ];
    const body =
      "\n\n" +
      lines.join("\n") +
      (row.snippet ? `\n\n${row.snippet}` : "");
    window.location.href = `mailto:?subject=${encodeURIComponent(
      subject,
    )}&body=${encodeURIComponent(body)}`;
  }

  function openEmail(row: EmailRow) {
    setOpenEmailId(row.id);
  }

  async function runSearch() {
    setLoading(true);
    setError("");
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (accountId) params.set("accountId", accountId);
    if (folder) params.set("folder", folder);
    if (category) params.set("category", category);
    if (priority) params.set("priority", priority);
    if (actionRequired) params.set("actionRequired", actionRequired);
    if (hasAttachments) params.set("hasAttachments", hasAttachments);
    if (isRead) params.set("isRead", isRead);
    params.set("sort", sort);
    params.set("limit", String(limit));

    const res = await fetch(`/api/search?${params.toString()}`);
    const data = await safeJson<SearchResponse>(res);
    if (!res.ok) {
      setError(
        data?.error ?? `Suche konnte nicht ausgeführt werden (HTTP ${res.status}).`,
      );
      setRows([]);
      setFolderGroups([]);
      setStats(null);
      setLoading(false);
      return;
    }
    if (!data) {
      setError("Suche konnte nicht ausgeführt werden — leere Server-Antwort.");
      setLoading(false);
      return;
    }
    setRows(data.emails ?? []);
    setStats(data.stats ?? null);
    setFolderGroups(data.folderGroups ?? []);
    setLoading(false);
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      void runSearch();
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groupedEmails = useMemo(() => {
    const map = new Map<string, EmailRow[]>();
    for (const row of rows) {
      const list = map.get(row.folderPath) ?? [];
      list.push(row);
      map.set(row.folderPath, list);
    }
    return map;
  }, [rows]);

  function toggleFolder(path: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function expandAll() {
    setCollapsed(new Set());
  }

  function collapseAll() {
    setCollapsed(new Set(folderGroups.map((g) => g.folderPath)));
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-2 flex items-center gap-2">
          <a href="/mail" className="text-sm text-gray-600 hover:underline">
            ← Zurück zur Mail
          </a>
        </div>
        <h1 className="text-2xl font-semibold text-gray-900">Erweiterte Suche</h1>

        <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-3 lg:grid-cols-4">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Suchbegriff (z.B. datev)"
            className="rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500"
          />
          <input
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            placeholder="Account ID (optional)"
            className="rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500"
          />
          <input
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder="Ordner (optional)"
            className="rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500"
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className="rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500"
          >
            <option value="date_desc">Neueste zuerst</option>
            <option value="date_asc">Älteste zuerst</option>
            <option value="from_asc">Absender A-Z</option>
            <option value="subject_asc">Betreff A-Z</option>
          </select>
        </div>

        <div className="mt-2 flex flex-wrap gap-2">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
          >
            <option value="">Kategorie: alle</option>
            <option value="invoice">invoice</option>
            <option value="offer">offer</option>
            <option value="customer">customer</option>
            <option value="support">support</option>
            <option value="contract">contract</option>
            <option value="private">private</option>
            <option value="newsletter">newsletter</option>
            <option value="spam">spam</option>
            <option value="unknown">unknown</option>
          </select>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
          >
            <option value="">Priorität: alle</option>
            <option value="low">low</option>
            <option value="normal">normal</option>
            <option value="high">high</option>
            <option value="urgent">urgent</option>
          </select>
          <select
            value={isRead}
            onChange={(e) => setIsRead(e.target.value as "" | "true" | "false")}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
          >
            <option value="">Lesestatus: alle</option>
            <option value="false">ungelesen</option>
            <option value="true">gelesen</option>
          </select>
          <select
            value={hasAttachments}
            onChange={(e) =>
              setHasAttachments(e.target.value as "" | "true" | "false")
            }
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
          >
            <option value="">Anhänge: alle</option>
            <option value="true">mit Anhängen</option>
            <option value="false">ohne Anhänge</option>
          </select>
          <select
            value={actionRequired}
            onChange={(e) =>
              setActionRequired(e.target.value as "" | "true" | "false")
            }
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
          >
            <option value="">Aktion: alle</option>
            <option value="true">actionRequired</option>
            <option value="false">keine Aktion</option>
          </select>
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value) as LimitOption)}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
            title="Wie viele Mails maximal in der Trefferliste laden"
          >
            {LIMIT_OPTIONS.map((v) => (
              <option key={v} value={v}>
                Anzeigen: {v}
              </option>
            ))}
          </select>
          <button
            onClick={() => void runSearch()}
            className="rounded bg-gray-900 px-3 py-1 text-xs text-white"
          >
            Suchen
          </button>
        </div>

        {error ? (
          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        {stats ? (
          <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
            <div className="rounded border border-gray-200 bg-white p-3 text-sm">
              <p className="text-gray-500">Gesamt</p>
              <p className="text-lg font-semibold tabular-nums">
                {stats.total.toLocaleString("de-DE")}
              </p>
            </div>
            <div className="rounded border border-gray-200 bg-white p-3 text-sm">
              <p className="text-gray-500">Ungelesen</p>
              <p className="text-lg font-semibold tabular-nums">
                {stats.unreadTotal.toLocaleString("de-DE")}
              </p>
            </div>
            <div className="rounded border border-gray-200 bg-white p-3 text-sm">
              <p className="text-gray-500">Anhänge</p>
              <p className="text-lg font-semibold tabular-nums">
                {stats.attachmentsTotal.toLocaleString("de-DE")}
              </p>
            </div>
            <div className="rounded border border-gray-200 bg-white p-3 text-sm">
              <p className="text-gray-500">Aktion erforderlich</p>
              <p className="text-lg font-semibold tabular-nums">
                {stats.actionRequiredTotal.toLocaleString("de-DE")}
              </p>
            </div>
          </div>
        ) : null}

        {loading ? (
          <p className="mt-4 text-sm text-gray-600">Suche läuft...</p>
        ) : null}

        <div className="mt-6 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-900">
            Treffer nach Ordnern
          </h2>
          {folderGroups.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              <label className="flex items-center gap-1 text-xs text-gray-700">
                <input
                  type="checkbox"
                  checked={
                    rows.length > 0 && rows.every((r) => selectedIds.has(r.id))
                  }
                  ref={(el) => {
                    if (el) {
                      const some = rows.some((r) => selectedIds.has(r.id));
                      const all = rows.length > 0 && rows.every((r) => selectedIds.has(r.id));
                      el.indeterminate = some && !all;
                    }
                  }}
                  onChange={toggleSelectAllLoaded}
                />
                Alle geladenen
              </label>
              <button
                onClick={expandAll}
                className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
              >
                Alle aufklappen
              </button>
              <button
                onClick={collapseAll}
                className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
              >
                Alle zuklappen
              </button>
            </div>
          ) : null}
        </div>

        {selectedIds.size > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs">
            <span className="font-medium text-blue-900">
              {selectedIds.size} ausgewählt (von {rows.length} geladenen Treffern)
            </span>
            <button
              disabled={bulkBusy}
              onClick={() => void runBulk("mark_read")}
              className="rounded-md border border-gray-300 bg-white px-2 py-1 disabled:opacity-50"
            >
              Gelesen
            </button>
            <button
              disabled={bulkBusy}
              onClick={() => void runBulk("mark_unread")}
              className="rounded-md border border-gray-300 bg-white px-2 py-1 disabled:opacity-50"
            >
              Ungelesen
            </button>
            <button
              disabled={bulkBusy}
              onClick={() => void runBulk("move_trash")}
              className="rounded-md border border-gray-300 bg-white px-2 py-1 disabled:opacity-50"
            >
              Papierkorb
            </button>
            <button
              disabled={bulkBusy}
              onClick={() => void runBulk("move_spam")}
              className="rounded-md border border-gray-300 bg-white px-2 py-1 disabled:opacity-50"
            >
              Spam
            </button>
            <input
              value={moveTarget}
              onChange={(e) => setMoveTarget(e.target.value)}
              placeholder="Verschieben nach Pfad…"
              className="min-w-[160px] rounded-md border border-slate-300 bg-white px-2 py-1 text-slate-900 placeholder:text-slate-500"
            />
            <button
              disabled={bulkBusy || !moveTarget}
              onClick={() => void runBulk("move_folder", moveTarget)}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-slate-700 disabled:opacity-50"
            >
              Verschieben
            </button>
            <button
              disabled={bulkBusy || selectedIds.size !== 1}
              onClick={bulkForward}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-slate-700 disabled:opacity-50"
              title={
                selectedIds.size === 1
                  ? "Diese E-Mail weiterleiten"
                  : "Weiterleiten ist nur für eine einzelne E-Mail möglich"
              }
            >
              Weiterleiten
            </button>
            <button
              onClick={clearSelection}
              className="ml-auto rounded-md border border-slate-300 bg-white px-2 py-1 text-slate-700"
            >
              Auswahl aufheben
            </button>
          </div>
        ) : null}

        {!loading && folderGroups.length === 0 ? (
          <p className="mt-3 rounded-md border border-dashed border-gray-300 p-4 text-sm text-gray-500">
            Keine Treffer für die aktuellen Filter.
          </p>
        ) : null}

        <ul className="mt-3 space-y-2">
          {folderGroups.map((group) => {
            const isCollapsed = collapsed.has(group.folderPath);
            const folderEmails = groupedEmails.get(group.folderPath) ?? [];
            const loadedInFolder = folderEmails.length;
            const totalInFolder = group.count;
            const truncated = totalInFolder > loadedInFolder;
            return (
              <li
                key={group.folderPath}
                className="overflow-hidden rounded-lg border border-gray-200 bg-white"
              >
                <div className="flex w-full items-center gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2 text-sm">
                  <label
                    className="flex shrink-0 cursor-pointer items-center"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={
                        folderEmails.length > 0 &&
                        folderEmails.every((r) => selectedIds.has(r.id))
                      }
                      ref={(el) => {
                        if (el) {
                          const some = folderEmails.some((r) =>
                            selectedIds.has(r.id),
                          );
                          const all =
                            folderEmails.length > 0 &&
                            folderEmails.every((r) => selectedIds.has(r.id));
                          el.indeterminate = some && !all;
                        }
                      }}
                      onChange={() =>
                        toggleFolderGroupSelected(group.folderPath, folderEmails)
                      }
                      title="Alle geladenen Treffer in diesem Ordner auswählen"
                      aria-label="Ordnergruppe auswählen"
                    />
                  </label>
                  <button
                    onClick={() => toggleFolder(group.folderPath)}
                    className="flex flex-1 items-center gap-2 text-left hover:bg-gray-100"
                  >
                  <span className="w-4 text-gray-500">
                    {isCollapsed ? "▸" : "▾"}
                  </span>
                  <span className="flex-1 truncate font-medium text-gray-900">
                    {group.folderPath}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-gray-700">
                    {group.count.toLocaleString("de-DE")} Treffer
                  </span>
                  {group.unreadCount > 0 ? (
                    <span className="shrink-0 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-800">
                      {group.unreadCount} ungelesen
                    </span>
                  ) : null}
                  {group.attachmentsCount > 0 ? (
                    <span className="shrink-0 rounded bg-gray-200 px-1.5 py-0.5 text-[10px] text-gray-700">
                      {group.attachmentsCount} mit Anhang
                    </span>
                  ) : null}
                  {group.actionRequiredCount > 0 ? (
                    <span className="shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-[10px] text-red-800">
                      {group.actionRequiredCount} Aktion
                    </span>
                  ) : null}
                  </button>
                </div>
                {!isCollapsed ? (
                  <div className="px-3 py-2">
                    {truncated ? (
                      <p className="mb-2 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-900">
                        In dieser Ansicht geladen: {loadedInFolder} von{" "}
                        {totalInFolder.toLocaleString("de-DE")} Treffern in diesem
                        Ordner. Erhöhe die Trefferanzahl oder verfeinere die Suche.
                      </p>
                    ) : null}
                    {loadedInFolder === 0 ? (
                      <p className="text-xs text-gray-500">
                        Keine Beispieltreffer geladen — Trefferanzahl höher setzen
                        oder Filter ändern.
                      </p>
                    ) : (
                      <ul className="space-y-1 text-sm">
                        {folderEmails.map((row) => {
                          const checked = selectedIds.has(row.id);
                          return (
                          <li
                            key={row.id}
                            className={`flex items-start gap-2 rounded border px-2 py-2 ${
                              checked
                                ? "border-blue-200 bg-blue-50"
                                : "border-gray-100 bg-white"
                            }`}
                          >
                            <label
                              className="mt-1 shrink-0 cursor-pointer"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleEmailSelected(row.id)}
                                aria-label="Treffer auswählen"
                              />
                            </label>
                            <button
                              onClick={() => openEmail(row)}
                              className="flex-1 text-left"
                            >
                            <div className="flex items-baseline justify-between gap-2">
                              <p className="truncate font-medium text-gray-900">
                                {row.subject || "(Ohne Betreff)"}
                              </p>
                              <p className="shrink-0 text-right text-[11px] text-gray-500">
                                <span className="block">
                                  Eingang: {formatDateTime(row.createdAt)}
                                </span>
                                <span className="block">
                                  Gesendet: {formatDateTime(row.date)}
                                </span>
                              </p>
                            </div>
                            <p className="truncate text-xs text-gray-600">
                              {row.fromName || row.fromEmail || "Unbekannt"}
                            </p>
                            <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                              {!row.isRead ? (
                                <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700">
                                  ungelesen
                                </span>
                              ) : null}
                              {row.hasAttachments ? (
                                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-700">
                                  📎
                                </span>
                              ) : null}
                              {row.aiCategory ? (
                                <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700">
                                  {row.aiCategory}
                                </span>
                              ) : null}
                              {row.aiPriority && row.aiPriority !== "normal" ? (
                                <span className="rounded bg-orange-50 px-1.5 py-0.5 text-orange-700">
                                  {row.aiPriority}
                                </span>
                              ) : null}
                              {row.actionRequired ? (
                                <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-700">
                                  Aktion
                                </span>
                              ) : null}
                            </div>
                            {row.snippet ? (
                              <p className="mt-1 line-clamp-2 text-xs text-gray-500">
                                {row.snippet}
                              </p>
                            ) : null}
                            </button>
                          </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
      {openEmailId ? (
        <EmailDetailModal
          emailId={openEmailId}
          onClose={() => setOpenEmailId(null)}
          onAction={() => {
            void runSearch();
          }}
        />
      ) : null}
    </main>
  );
}
