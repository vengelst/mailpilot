"use client";

import { useEffect, useMemo, useState } from "react";
import { buildSafeMailDocument } from "@/lib/sanitizeMailHtml";

/**
 * Self-contained modal that shows a single email — used by `/search` so the
 * user can inspect a hit without leaving the search results.
 *
 * Reuses the same backend endpoints as the main mail workspace:
 *   - GET  /api/emails/:id          → headers + attachments
 *   - GET  /api/emails/:id/body     → text + html (lazy)
 *   - POST /api/emails/:id/mark-read | mark-unread | move | analyze
 *   - GET  /api/emails/:id/print    → standalone print view
 *
 * HTML bodies go through `buildSafeMailDocument` (DOMPurify + CSP + sandbox)
 * before they touch the iframe — same hardening as the main detail view.
 */

type Attachment = {
  id: string;
  filename: string | null;
  mimeType: string | null;
  size: number | null;
};

type Email = {
  id: string;
  accountId: string;
  folderPath: string;
  subject: string | null;
  fromName?: string | null;
  fromEmail: string | null;
  toEmails?: string[];
  ccEmails?: string[];
  date: string | null;
  createdAt?: string | null;
  textPreview: string | null;
  snippet: string | null;
  flags: string[];
  attachments: Attachment[];
  aiSummaryShort?: string | null;
  aiSummaryLong?: string | null;
  aiCategory?: string | null;
  aiPriority?: string | null;
};

type Folder = { path: string; displayName: string };

async function safeJson<T = unknown>(res: Response): Promise<T | null> {
  try {
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function formatDateLong(value: string | null) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.valueOf())) return "-";
  return d.toLocaleString("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function senderDisplayName(email: Pick<Email, "fromName" | "fromEmail">) {
  return (email.fromName && email.fromName.trim()) || email.fromEmail || "Unbekannt";
}

function buildMailtoQuote(email: Email, intro: string) {
  const preview = (email.textPreview ?? email.snippet ?? "").slice(0, 1200);
  const lines = [
    intro,
    `Von: ${senderDisplayName(email)}${email.fromEmail ? ` <${email.fromEmail}>` : ""}`,
    `Datum: ${formatDateLong(email.date)}`,
    `Betreff: ${email.subject ?? ""}`,
  ];
  return preview ? `\n\n${lines.join("\n")}\n\n${preview}` : `\n\n${lines.join("\n")}`;
}

export type EmailDetailModalProps = {
  emailId: string;
  onClose: () => void;
  /** Called whenever a state-changing action ran successfully (move/mark/etc.) */
  onAction?: () => void;
};

export function EmailDetailModal({ emailId, onClose, onAction }: EmailDetailModalProps) {
  const [email, setEmail] = useState<Email | null>(null);
  const [body, setBody] = useState<{ text: string; html: string } | null>(null);
  const [bodyMode, setBodyMode] = useState<"text" | "html">("text");
  const [folders, setFolders] = useState<Folder[]>([]);
  const [moveTarget, setMoveTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [bodyLoading, setBodyLoading] = useState(false);
  const [error, setError] = useState("");

  // Lock background scroll while the modal is open + ESC closes.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Load headers + body together when emailId changes.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError("");
      setEmail(null);
      setBody(null);
      const headerRes = await fetch(`/api/emails/${emailId}`);
      const headerData = await safeJson<{ email?: Email; error?: string }>(headerRes);
      if (cancelled) return;
      if (!headerRes.ok || !headerData?.email) {
        setError(headerData?.error ?? "E-Mail konnte nicht geladen werden.");
        setLoading(false);
        return;
      }
      setEmail(headerData.email);
      setLoading(false);

      // Load folders for the move dropdown — best-effort, ignored on failure.
      const fRes = await fetch(`/api/accounts/${headerData.email.accountId}/folders`);
      const fData = await safeJson<{ folders?: Folder[] }>(fRes);
      if (!cancelled && fData?.folders) setFolders(fData.folders);

      // Lazy body fetch (cached server-side after first load).
      setBodyLoading(true);
      const bRes = await fetch(`/api/emails/${emailId}/body`);
      const bData = await safeJson<{
        body?: { text?: string; html?: string; textFromHtml?: string };
      }>(bRes);
      if (cancelled) return;
      if (bRes.ok && bData?.body) {
        const text = bData.body.text || bData.body.textFromHtml || "";
        const html = bData.body.html || "";
        setBody({ text, html });
        setBodyMode(text ? "text" : html ? "html" : "text");
      }
      setBodyLoading(false);
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [emailId]);

  const safeMailDocument = useMemo(
    () => (body?.html ? buildSafeMailDocument(body.html) : ""),
    [body],
  );

  async function callJson(path: string, payload?: object) {
    setBusy(true);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload ? JSON.stringify(payload) : undefined,
      });
      const data = await safeJson<{ error?: string }>(res);
      if (!res.ok) {
        setError(data?.error ?? `Aktion fehlgeschlagen (HTTP ${res.status}).`);
        return false;
      }
      onAction?.();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function markRead() {
    await callJson(`/api/emails/${emailId}/mark-read`);
  }
  async function markUnread() {
    await callJson(`/api/emails/${emailId}/mark-unread`);
  }
  async function moveTo(target: string) {
    if (!target) return;
    await callJson(`/api/emails/${emailId}/move`, { targetFolder: target });
  }
  async function moveSpecial(kind: "trash" | "spam") {
    await callJson(`/api/emails/${emailId}/move`, { targetSpecial: kind });
  }
  async function analyzeAi() {
    await callJson(`/api/emails/${emailId}/analyze`);
  }

  function reply() {
    if (!email) return;
    const to = email.fromEmail ?? "";
    const subject = `Re: ${email.subject ?? ""}`;
    const body = buildMailtoQuote(email, "--- Ursprüngliche Nachricht ---");
    window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(
      subject,
    )}&body=${encodeURIComponent(body)}`;
  }

  function forward() {
    if (!email) return;
    const subject = `Fwd: ${email.subject ?? ""}`;
    const body = buildMailtoQuote(email, "--- Weitergeleitete Nachricht ---");
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(
      body,
    )}`;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex bg-black/60"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="E-Mail-Detail"
        className="m-auto flex h-full w-full flex-col bg-white text-slate-900 shadow-2xl md:h-[90vh] md:w-[92vw] md:max-w-6xl md:rounded-xl"
      >
        <header className="flex flex-wrap items-start gap-3 border-b border-gray-200 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold text-slate-900 md:text-lg">
              {email?.subject || (loading ? "Lade…" : "(Ohne Betreff)")}
            </h2>
            {email ? (
              <p className="mt-1 truncate text-xs text-slate-600">
                Von: {senderDisplayName(email)}
                {email.fromEmail && email.fromEmail !== senderDisplayName(email)
                  ? ` <${email.fromEmail}>`
                  : ""}{" "}
                · An: {(email.toEmails ?? []).join(", ") || "-"} ·{" "}
                Eingang: {formatDateLong(email.createdAt ?? email.date)} · Gesendet:{" "}
                {formatDateLong(email.date)} · Ordner: {email.folderPath}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={() => window.open(`/api/emails/${emailId}/print`, "_blank")}
              className="rounded-md border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700 hover:bg-slate-50"
            >
              Drucken
            </button>
            <button
              onClick={onClose}
              aria-label="Schließen"
              className="rounded-md border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700 hover:bg-slate-50"
            >
              ✕
            </button>
          </div>
        </header>

        {email ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-2 text-xs">
            <button
              disabled={busy}
              onClick={reply}
              className="rounded-md bg-slate-900 px-3 py-1 text-white disabled:opacity-50"
            >
              Antworten
            </button>
            <button
              disabled={busy}
              onClick={forward}
              className="rounded-md border border-slate-300 bg-white px-3 py-1 text-slate-700 disabled:opacity-50"
            >
              Weiterleiten
            </button>
            <button
              disabled={busy}
              onClick={() => void markRead()}
              className="rounded-md border border-slate-300 bg-white px-3 py-1 text-slate-700 disabled:opacity-50"
            >
              Gelesen
            </button>
            <button
              disabled={busy}
              onClick={() => void markUnread()}
              className="rounded-md border border-slate-300 bg-white px-3 py-1 text-slate-700 disabled:opacity-50"
            >
              Ungelesen
            </button>
            <button
              disabled={busy}
              onClick={() => void moveSpecial("trash")}
              className="rounded-md border border-slate-300 bg-white px-3 py-1 text-slate-700 disabled:opacity-50"
            >
              Papierkorb
            </button>
            <button
              disabled={busy}
              onClick={() => void moveSpecial("spam")}
              className="rounded-md border border-slate-300 bg-white px-3 py-1 text-slate-700 disabled:opacity-50"
            >
              Spam
            </button>
            <select
              value={moveTarget}
              onChange={(e) => setMoveTarget(e.target.value)}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-slate-900"
            >
              <option value="">Verschieben nach…</option>
              {folders.map((f) => (
                <option key={f.path} value={f.path}>
                  {f.displayName}
                </option>
              ))}
            </select>
            <button
              disabled={busy || !moveTarget}
              onClick={() => void moveTo(moveTarget)}
              className="rounded-md border border-slate-300 bg-white px-3 py-1 text-slate-700 disabled:opacity-50"
            >
              Verschieben
            </button>
            <button
              disabled={busy}
              onClick={() => void analyzeAi()}
              className="ml-auto rounded-md border border-slate-300 bg-white px-3 py-1 text-slate-700 disabled:opacity-50"
            >
              KI analysieren
            </button>
          </div>
        ) : null}

        <div className="flex-1 overflow-y-auto bg-gray-50 px-4 py-3">
          {loading ? (
            <p className="text-sm text-slate-700">Lade E-Mail…</p>
          ) : error ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : email ? (
            <>
              {email.aiSummaryShort ? (
                <div className="mb-3 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                  <p className="font-semibold">KI-Zusammenfassung</p>
                  <p>{email.aiSummaryShort}</p>
                  {email.aiSummaryLong ? (
                    <p className="mt-1 text-xs">{email.aiSummaryLong}</p>
                  ) : null}
                </div>
              ) : null}

              {(email.attachments?.length ?? 0) > 0 ? (
                <div className="mb-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Anhänge
                  </h3>
                  <ul className="mt-1 space-y-1 text-sm">
                    {email.attachments.map((a) => {
                      const previewUrl = `/api/emails/${emailId}/attachments/${a.id}/preview`;
                      return (
                        <li
                          key={a.id}
                          className="flex flex-wrap items-center gap-2 rounded border border-gray-200 bg-white px-3 py-2"
                        >
                          <a
                            href={previewUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="min-w-0 flex-1 truncate font-medium text-blue-700 hover:underline"
                          >
                            📎 {a.filename || "Datei"}
                          </a>
                          <span className="text-xs text-slate-600">
                            {a.mimeType || "unbekannt"} · {a.size ?? 0} Bytes
                          </span>
                          <a
                            href={`${previewUrl}?download=1`}
                            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                          >
                            Herunterladen
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}

              {body && body.html && body.text ? (
                <div className="mb-2 flex gap-2 text-xs">
                  <button
                    onClick={() => setBodyMode("text")}
                    className={`rounded border px-2 py-0.5 ${
                      bodyMode === "text"
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-300 bg-white text-slate-700"
                    }`}
                  >
                    Text
                  </button>
                  <button
                    onClick={() => setBodyMode("html")}
                    className={`rounded border px-2 py-0.5 ${
                      bodyMode === "html"
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-300 bg-white text-slate-700"
                    }`}
                  >
                    HTML
                  </button>
                </div>
              ) : null}

              {bodyLoading ? (
                <p className="rounded-md border border-gray-200 bg-white p-3 text-sm text-slate-700">
                  Lade Mailinhalt…
                </p>
              ) : body && bodyMode === "html" && body.html ? (
                <iframe
                  title="Mailinhalt"
                  sandbox=""
                  srcDoc={safeMailDocument}
                  referrerPolicy="no-referrer"
                  className="h-[60vh] w-full rounded-md border border-gray-200 bg-white"
                />
              ) : (
                <div className="whitespace-pre-wrap rounded-md border border-gray-200 bg-white p-4 text-sm leading-relaxed text-slate-800">
                  {body?.text ||
                    email.textPreview ||
                    email.snippet ||
                    "(Kein Mailinhalt verfügbar.)"}
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
