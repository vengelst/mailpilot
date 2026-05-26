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
  const [bodyMode, setBodyMode] = useState<"text" | "html">("html");
  const [folders, setFolders] = useState<Folder[]>([]);
  const [moveTarget, setMoveTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [bodyLoading, setBodyLoading] = useState(false);
  const [error, setError] = useState("");
  const [showExternalImages, setShowExternalImages] = useState(false);
  const [pendingLinkUrl, setPendingLinkUrl] = useState<string | null>(null);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.data?.type === "mailpilot-link-click" && typeof e.data.href === "string") {
        const href: string = e.data.href;
        if (/^mailto:/i.test(href)) {
          window.location.href = href;
          return;
        }
        if (/^https?:\/\//i.test(href)) {
          setPendingLinkUrl(href);
        }
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

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
        setBodyMode(html ? "html" : text ? "text" : "text");
      }
      setBodyLoading(false);
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [emailId]);

  const safeMailDocument = useMemo(
    () => (body?.html ? buildSafeMailDocument(body.html, { allowExternalImages: showExternalImages }) : ""),
    [body, showExternalImages],
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
      className="glass-overlay fixed inset-0 z-50 flex"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="E-Mail-Detail"
        className="glass-modal m-auto flex h-full w-full flex-col md:h-[90vh] md:w-[92vw] md:max-w-6xl md:rounded-2xl"
      >
        <header className="flex flex-wrap items-start gap-3 border-b glass-divider px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold glass-text-primary md:text-lg">
              {email?.subject || (loading ? "Lade…" : "(Ohne Betreff)")}
            </h2>
            {email ? (
              <p className="mt-1 truncate text-xs glass-text-tertiary">
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
              className="glass-btn rounded-lg px-3 py-1 text-sm"
            >
              Drucken
            </button>
            <button
              onClick={onClose}
              aria-label="Schließen"
              className="glass-btn rounded-lg px-3 py-1 text-sm"
            >
              ✕
            </button>
          </div>
        </header>

        {email ? (
          <div className="flex flex-wrap items-center gap-2 border-b glass-divider px-4 py-2 text-xs">
            <button
              disabled={busy}
              onClick={reply}
              className="glass-btn-dark rounded-lg px-3 py-1 disabled:opacity-50"
            >
              Antworten
            </button>
            <button
              disabled={busy}
              onClick={forward}
              className="glass-btn rounded-lg px-3 py-1 disabled:opacity-50"
            >
              Weiterleiten
            </button>
            <button
              disabled={busy}
              onClick={() => void markRead()}
              className="glass-btn rounded-lg px-3 py-1 disabled:opacity-50"
            >
              Gelesen
            </button>
            <button
              disabled={busy}
              onClick={() => void markUnread()}
              className="glass-btn rounded-lg px-3 py-1 disabled:opacity-50"
            >
              Ungelesen
            </button>
            <button
              disabled={busy}
              onClick={() => void moveSpecial("trash")}
              className="glass-btn rounded-lg px-3 py-1 disabled:opacity-50"
            >
              Papierkorb
            </button>
            <button
              disabled={busy}
              onClick={() => void moveSpecial("spam")}
              className="glass-btn rounded-lg px-3 py-1 disabled:opacity-50"
            >
              Spam
            </button>
            <select
              value={moveTarget}
              onChange={(e) => setMoveTarget(e.target.value)}
              className="glass-select rounded-lg px-2 py-1"
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
              className="glass-btn rounded-lg px-3 py-1 disabled:opacity-50"
            >
              Verschieben
            </button>
            <button
              disabled={busy}
              onClick={() => void analyzeAi()}
              className="glass-btn ml-auto rounded-lg px-3 py-1 disabled:opacity-50"
            >
              KI analysieren
            </button>
          </div>
        ) : null}

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {loading ? (
            <p className="text-sm glass-text-secondary">Lade E-Mail…</p>
          ) : error ? (
            <p className="glass-error rounded-xl px-3 py-2 text-sm text-red-600">
              {error}
            </p>
          ) : email ? (
            <>
              {email.aiSummaryShort ? (
                <div className="glass-info mb-3 rounded-xl p-3 text-sm">
                  <p className="font-semibold">KI-Zusammenfassung</p>
                  <p>{email.aiSummaryShort}</p>
                  {email.aiSummaryLong ? (
                    <p className="mt-1 text-xs">{email.aiSummaryLong}</p>
                  ) : null}
                </div>
              ) : null}

              {(email.attachments?.length ?? 0) > 0 ? (
                <div className="mb-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide glass-text-muted">
                    Anhänge
                  </h3>
                  <ul className="mt-1 space-y-1 text-sm">
                    {email.attachments.map((a) => {
                      const previewUrl = `/api/emails/${emailId}/attachments/${a.id}/preview`;
                      return (
                        <li
                          key={a.id}
                          className="glass flex flex-wrap items-center gap-2 rounded-xl px-3 py-2"
                        >
                          <a
                            href={previewUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="min-w-0 flex-1 truncate font-medium hover:underline"
                            style={{ color: "var(--glass-accent-text)" }}
                          >
                            📎 {a.filename || "Datei"}
                          </a>
                          <span className="text-xs glass-text-tertiary">
                            {a.mimeType || "unbekannt"} · {a.size ?? 0} Bytes
                          </span>
                          <a
                            href={`${previewUrl}?download=1`}
                            className="glass-btn rounded-lg px-2 py-1 text-xs"
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
                    className={`rounded-lg px-2 py-0.5 ${
                      bodyMode === "text"
                        ? "glass-btn-dark"
                        : "glass-btn"
                    }`}
                  >
                    Text
                  </button>
                  <button
                    onClick={() => setBodyMode("html")}
                    className={`rounded-lg px-2 py-0.5 ${
                      bodyMode === "html"
                        ? "glass-btn-dark"
                        : "glass-btn"
                    }`}
                  >
                    HTML
                  </button>
                </div>
              ) : null}

              {bodyLoading ? (
                <p className="glass rounded-xl p-3 text-sm glass-text-secondary animate-pulse">
                  Lade Mailinhalt…
                </p>
              ) : body && bodyMode === "html" && body.html ? (
                <div className="w-full">
                  {!showExternalImages ? (
                    <div className="glass-info rounded-xl px-3 py-2 text-xs mb-2 flex items-center justify-between">
                      <span className="glass-text-secondary">Externe Bilder blockiert.</span>
                      <button
                        onClick={() => setShowExternalImages(true)}
                        className="glass-btn rounded-lg px-3 py-1 text-xs shrink-0 ml-2"
                      >
                        Bilder laden
                      </button>
                    </div>
                  ) : null}
                  <iframe
                    title="Mailinhalt"
                    sandbox="allow-scripts"
                    srcDoc={safeMailDocument}
                    referrerPolicy="no-referrer"
                    className="glass h-[60vh] w-full rounded-xl"
                    style={{ border: "none", maxWidth: "100%", overflow: "hidden" }}
                  />
                </div>
              ) : (
                <div className="glass whitespace-pre-wrap rounded-xl p-4 text-sm leading-relaxed glass-text-secondary">
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

      {pendingLinkUrl ? (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40"
          onClick={() => setPendingLinkUrl(null)}
        >
          <div
            className="glass-card mx-4 w-full max-w-lg rounded-2xl p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 text-lg font-semibold glass-text-primary">
              Externen Link öffnen?
            </h3>
            <p className="mb-2 text-sm glass-text-secondary">
              Möchtest du diesen Link in einem neuen Tab öffnen?
            </p>
            <div className="mb-5 rounded-lg bg-black/5 p-3 break-all text-xs font-mono glass-text-primary">
              {pendingLinkUrl}
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setPendingLinkUrl(null)}
                className="glass-btn rounded-lg px-4 py-2 text-sm"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={() => {
                  window.open(pendingLinkUrl, "_blank", "noopener,noreferrer");
                  setPendingLinkUrl(null);
                }}
                className="glass-btn-primary rounded-lg px-4 py-2 text-sm"
              >
                Link öffnen
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
