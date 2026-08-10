/**
 * Email detail view (right pane): email header info, labels, sender profile
 * prompt, AI summary, email body (HTML/text), attachment section (grouped by
 * type with badges), mobile action bar, and the maximised-body modal.
 */

import { useMemo } from "react";
import { buildSafeMailDocument } from "@/lib/sanitizeMailHtml";
import { linkifyMailPlainText } from "@/lib/linkifyMailPlainText";
import {
  formatDateTimeShort,
  formatDetailDate,
  getAttachmentDisplayName,
  getAttachmentPreviewType,
  getAttachmentTypeLabel,
  getAvatarColor,
  getInitials,
  senderDisplayName,
  type Attachment,
} from "./mail-types";
import type { MailStateReturn } from "./use-mail-state";
import type { MailActionsReturn } from "./use-mail-actions";
import type { MailSyncReturn } from "./use-mail-sync";

type Props = {
  s: MailStateReturn;
  actions: MailActionsReturn;
  sync: MailSyncReturn;
  openMobilePane: (pane: "left" | "middle" | "right") => void;
};

function currentUiTheme(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function MailDetail({ s, actions, sync, openMobilePane }: Props) {
  const uiTheme = currentUiTheme();
  const safeMailDocument = useMemo(
    () =>
      s.bodyContent?.html
        ? buildSafeMailDocument(s.bodyContent.html, {
            allowExternalImages: s.showExternalImages,
            theme: uiTheme,
          })
        : "",
    [s.bodyContent, s.showExternalImages, uiTheme],
  );

  if (!s.selectedEmail) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm glass-text-muted">
        Keine E-Mail ausgewählt.
      </div>
    );
  }

  const email = s.selectedEmail;

  return (
    <>
      {/* Mobile breadcrumb */}
      <div className="flex items-center gap-2 border-b glass-divider px-3 py-2 lg:hidden">
        <button type="button" onClick={() => openMobilePane("left")} className="glass-btn rounded-lg px-2.5 py-1 text-xs" aria-label="Zu Konto und Ordnern" title="Konto und Ordner">← Ordner</button>
        <button type="button" onClick={() => openMobilePane("middle")} className="glass-btn rounded-lg px-2.5 py-1 text-xs" aria-label="Zur Mail-Liste" title="Mail-Liste">Liste</button>
      </div>

      {/* Header bar */}
      <div className="flex items-center gap-2 border-b glass-divider px-3 py-2 md:px-4">
        <span className={`hidden h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white sm:flex ${getAvatarColor(email.fromEmail || email.fromName || email.id)}`} aria-hidden>{getInitials(email.fromName, email.fromEmail)}</span>
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold glass-text-primary md:text-lg">{email.subject || "(Ohne Betreff)"}</h2>
        <div className="shrink-0 text-right">
          <p className="text-[10px] font-medium glass-text-tertiary">Eingang</p>
          <p className="text-sm tabular-nums font-medium glass-text-primary">{formatDateTimeShort(email.date ?? email.createdAt)}</p>
        </div>

        {/* Desktop dropdown menu */}
        <div className="relative hidden shrink-0 lg:block" data-email-detail-menu-root>
          <button type="button" onClick={(e) => { e.stopPropagation(); s.setEmailDetailMenuOpen((v) => !v); }} aria-label="Mail-Details und Befehle" aria-expanded={s.emailDetailMenuOpen} aria-haspopup="menu" className="glass-btn flex h-10 w-10 items-center justify-center rounded-lg">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5" aria-hidden><circle cx="12" cy="5" r="1.75" /><circle cx="12" cy="12" r="1.75" /><circle cx="12" cy="19" r="1.75" /></svg>
          </button>
          {s.emailDetailMenuOpen ? (
            <div role="menu" className="glass-solid absolute right-0 z-30 mt-1 max-h-[min(85vh,560px)] w-[min(calc(100vw-2rem),18rem)] overflow-y-auto rounded-xl py-2 text-sm">
              <div className="border-b glass-divider px-3 pb-2">
                <p className="text-xs font-semibold uppercase tracking-wide glass-text-muted">Details</p>
                <p className="mt-1 break-words text-sm font-medium glass-text-primary">{email.subject || "(Ohne Betreff)"}</p>
                <p className="mt-2 text-xs glass-text-secondary">{senderDisplayName(email)}{email.fromEmail ? <span className="block break-all glass-text-tertiary">&lt;{email.fromEmail}&gt;</span> : null}</p>
                <p className="mt-1 break-words text-xs glass-text-tertiary">An: {(email.toEmails ?? []).join(", ") || "—"}</p>
                <p className="mt-1 text-xs glass-text-muted">Eingang: {formatDetailDate(email.date ?? email.createdAt)}</p>
                <p className="text-xs glass-text-muted">Gesendet: {formatDetailDate(email.date)}</p>
              </div>
              {s.bodyContent && s.bodyContent.html && s.bodyContent.text ? (
                <div className="border-b glass-divider px-3 py-2">
                  <p className="text-xs font-semibold glass-text-muted">Ansicht</p>
                  <div className="mt-1 flex gap-1">
                    <button type="button" onClick={() => s.setBodyMode("text")} className={`flex-1 rounded-lg px-2 py-1 text-xs ${s.bodyMode === "text" ? "glass-btn-dark" : "glass-btn"}`}>Text</button>
                    <button type="button" onClick={() => s.setBodyMode("html")} className={`flex-1 rounded-lg px-2 py-1 text-xs ${s.bodyMode === "html" ? "glass-btn-dark" : "glass-btn"}`}>HTML</button>
                  </div>
                </div>
              ) : null}
              <div className="border-b glass-divider px-3 py-2">
                <p className="text-xs font-semibold glass-text-muted">Druck</p>
                <select value={s.printMode} onChange={(e) => s.setPrintMode(e.target.value as "html" | "text")} className="glass-select mt-1 w-full rounded-lg px-2 py-1.5 text-xs" title="Druckmodus"><option value="html">Druck: HTML</option><option value="text">Druck: Text</option></select>
                {s.bodyContent && (s.bodyContent.html || s.bodyContent.text) ? <button type="button" onClick={() => { s.setEmailDetailMenuOpen(false); s.setIsBodyMaximized(true); }} className="glass-btn mt-2 w-full rounded-lg px-2 py-1.5 text-xs">Inhalt vergrößern</button> : null}
                <button type="button" onClick={() => { s.setEmailDetailMenuOpen(false); void sync.loadBody(email.id, true); }} className="glass-btn mt-1 w-full rounded-lg px-2 py-1.5 text-xs">Inhalt neu laden</button>
              </div>
              <button type="button" onClick={() => { s.setEmailDetailMenuOpen(false); actions.replyToSelected(); }} className="block w-full px-3 py-2 text-left font-medium hover:bg-white/30 rounded-lg">Antworten</button>
              <button type="button" onClick={() => { s.setEmailDetailMenuOpen(false); actions.forwardSelected(); }} className="block w-full px-3 py-2 text-left hover:bg-white/30 rounded-lg">Weiterleiten</button>
              <button type="button" onClick={() => { s.setEmailDetailMenuOpen(false); void actions.runAction(`/api/emails/${email.id}/mark-read`); }} className="block w-full px-3 py-2 text-left hover:bg-white/30 rounded-lg">Gelesen</button>
              <button type="button" onClick={() => { s.setEmailDetailMenuOpen(false); void actions.runAction(`/api/emails/${email.id}/mark-unread`); }} className="block w-full px-3 py-2 text-left hover:bg-white/30 rounded-lg">Ungelesen</button>
              <button type="button" onClick={() => { s.setEmailDetailMenuOpen(false); void actions.runAction(`/api/emails/${email.id}/move`, { targetSpecial: "trash" }); }} className="block w-full px-3 py-2 text-left hover:bg-white/30 rounded-lg">Papierkorb</button>
              <button type="button" onClick={() => { s.setEmailDetailMenuOpen(false); void actions.runAction(`/api/emails/${email.id}/move`, { targetSpecial: "spam" }); }} className="block w-full px-3 py-2 text-left hover:bg-white/30 rounded-lg">Spam</button>
              <button type="button" onClick={() => { s.setEmailDetailMenuOpen(false); actions.printSelectedEmail(); }} className="block w-full px-3 py-2 text-left hover:bg-white/30 rounded-lg">Drucken</button>
              <div className="my-1 border-t border-gray-100" />
              <button type="button" onClick={() => { s.setEmailDetailMenuOpen(false); void actions.runAction(`/api/emails/${email.id}/analyze`); }} className="block w-full px-3 py-2 text-left hover:bg-gray-50">KI analysieren</button>
              <div className="px-3 py-2">
                <select value={s.moveTargetFolder} onChange={(e) => s.setMoveTargetFolder(e.target.value)} className="glass-select w-full rounded-lg px-2 py-1.5 text-xs"><option value="">Ordner wählen…</option>{s.folders.map((f) => <option key={f.path} value={f.path}>{f.displayName}</option>)}</select>
                <button type="button" onClick={() => { s.setEmailDetailMenuOpen(false); void actions.moveToSelectedFolder(); }} className="glass-btn mt-2 w-full rounded-lg px-2 py-1.5 text-xs">Verschieben</button>
              </div>
              <button type="button" onClick={() => { s.setEmailDetailMenuOpen(false); void actions.blockSender(); }} className="block w-full px-3 py-2 text-left hover:bg-gray-50">Absender blockieren</button>
              <button type="button" onClick={() => { s.setEmailDetailMenuOpen(false); void actions.blockDomain(); }} className="block w-full px-3 py-2 text-left hover:bg-gray-50">Domain blockieren</button>
              <button type="button" onClick={() => { s.setEmailDetailMenuOpen(false); void actions.createContactSuggestion(); }} className="block w-full px-3 py-2 text-left hover:bg-gray-50">Kontaktvorschlag erzeugen</button>
            </div>
          ) : null}
        </div>
      </div>

      {/* Mobile sender info */}
      <div className="border-b glass-divider px-4 py-3 lg:hidden">
        <p className="text-sm font-medium glass-text-primary">{senderDisplayName(email)}</p>
        {email.fromEmail ? <p className="text-xs break-all glass-text-secondary">&lt;{email.fromEmail}&gt;</p> : null}
        <p className="mt-1 text-xs glass-text-muted">An: {(email.toEmails ?? []).join(", ") || "—"}</p>
        <p className="text-xs glass-text-muted">Eingang: {formatDetailDate(email.date ?? email.createdAt)}</p>
        <p className="text-xs glass-text-muted">Gesendet: {formatDetailDate(email.date)}</p>
        {email.attachments.length > 0 ? <p className="mt-1 text-xs glass-text-secondary">Anhänge: {email.attachments.length}</p> : null}
      </div>

      {/* Label chips */}
      <div className="flex flex-wrap items-center gap-1.5 border-b glass-divider px-4 py-2">
        {(email.labels ?? []).map((label) => {
          const def = s.labelList.find((l) => l.name === label);
          return (
            <span key={label} className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium text-white" style={{ backgroundColor: def?.color ?? "#6b7280" }}>
              {label}
              <button type="button" onClick={() => void actions.removeLabelFromEmail(email.id, label)} className="ml-0.5 hover:opacity-70" aria-label={`Label ${label} entfernen`}>✕</button>
            </span>
          );
        })}
        <div className="relative">
          <button type="button" onClick={() => s.setLabelDropdownOpen((v) => !v)} className="glass-btn rounded-full px-2 py-0.5 text-xs">+ Label</button>
          {s.labelDropdownOpen ? (
            <div className="glass-solid absolute left-0 z-30 mt-1 w-48 rounded-xl py-1 text-sm shadow-lg">
              {s.labelList.map((label) => (
                <button key={label.id} type="button" onClick={() => { void actions.addLabelToEmail(email.id, label.name); s.setLabelDropdownOpen(false); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-white/30 rounded-lg">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: label.color ?? "#6b7280" }} />
                  <span className="truncate">{label.name}</span>
                </button>
              ))}
              <div className="border-t glass-divider mt-1 pt-1 px-2">
                <div className="flex gap-1">
                  <input value={s.newLabelInline} onChange={(e) => s.setNewLabelInline(e.target.value)} placeholder="Neues Label..." className="glass-input flex-1 rounded-lg px-2 py-1 text-xs" onKeyDown={(e) => { if (e.key === "Enter" && s.newLabelInline.trim()) { void actions.createAndAddLabel(email.id, s.newLabelInline.trim()); s.setNewLabelInline(""); s.setLabelDropdownOpen(false); } }} />
                  <button type="button" onClick={() => { if (s.newLabelInline.trim()) { void actions.createAndAddLabel(email.id, s.newLabelInline.trim()); s.setNewLabelInline(""); s.setLabelDropdownOpen(false); } }} className="glass-btn rounded-lg px-2 py-1 text-xs">+</button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Sender prompt */}
      {s.senderPromptVisible && s.senderPromptData ? (
        <div className="border-b glass-divider px-4 py-3 glass-info">
          <p className="text-sm font-medium glass-text-primary">Absender &quot;{s.senderPromptData.email}&quot; noch nicht klassifiziert</p>
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs glass-text-muted mb-0.5">Kategorie</label>
              <select value={s.senderPromptCategory} onChange={(e) => s.setSenderPromptCategory(e.target.value)} className="glass-select rounded-lg px-2 py-1 text-sm">
                <option value="Kunde">Kunde</option><option value="Lieferant">Lieferant</option><option value="Subunternehmer">Subunternehmer</option><option value="Privat">Privat</option><option value="Werbung">Werbung</option><option value="Sonstiges">Sonstiges</option>
              </select>
            </div>
            <div>
              <label className="block text-xs glass-text-muted mb-0.5">Zielordner</label>
              {!s.senderPromptUseNewFolder ? (
                <div className="flex flex-wrap gap-1 items-center">
                  <select value={s.senderPromptFolder} onChange={(e) => s.setSenderPromptFolder(e.target.value)} className="glass-select rounded-lg px-2 py-1 text-sm min-w-[12rem]">
                    <option value="">— Ordner wählen —</option>
                    {s.folders.map((f) => <option key={f.path} value={f.path}>{f.path}</option>)}
                  </select>
                  <button
                    type="button"
                    className="glass-btn rounded-lg px-2 py-1 text-xs whitespace-nowrap"
                    onClick={() => {
                      s.setSenderPromptUseNewFolder(true);
                      const parent =
                        s.senderPromptFolder ||
                        (s.folders.some((f) => f.path === "INBOX/Kunden") ? "INBOX/Kunden" : "INBOX");
                      s.setSenderPromptFolder(parent);
                      const suggestion = s.senderPromptData?.domain
                        ? (s.senderPromptData.domain.split(".")[0] ?? s.senderPromptData.domain)
                        : "";
                      s.setSenderPromptNewFolder(suggestion);
                    }}
                  >
                    Neu…
                  </button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="flex flex-wrap gap-1 items-end">
                    <div>
                      <label className="block text-[10px] glass-text-muted mb-0.5">Übergeordneter Ordner</label>
                      <select
                        value={s.senderPromptFolder}
                        onChange={(e) => s.setSenderPromptFolder(e.target.value)}
                        className="glass-select rounded-lg px-2 py-1 text-sm min-w-[12rem]"
                      >
                        {s.folders.length === 0 ? (
                          <option value="INBOX">INBOX</option>
                        ) : (
                          s.folders.map((f) => (
                            <option key={f.path} value={f.path}>{f.path}</option>
                          ))
                        )}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] glass-text-muted mb-0.5">Neuer Ordnername</label>
                      <input
                        type="text"
                        value={s.senderPromptNewFolder}
                        onChange={(e) => s.setSenderPromptNewFolder(e.target.value)}
                        placeholder="z.B. DeutschePost"
                        className="glass-input rounded-lg px-2 py-1 text-sm min-w-[10rem]"
                      />
                    </div>
                    <button
                      type="button"
                      className="glass-btn rounded-lg px-2 py-1 text-xs whitespace-nowrap"
                      onClick={() => {
                        s.setSenderPromptUseNewFolder(false);
                        s.setSenderPromptNewFolder("");
                      }}
                    >
                      Bestehenden wählen
                    </button>
                  </div>
                  <p className="text-[11px] glass-text-secondary">
                    Wird erstellt als:{" "}
                    <span className="font-medium glass-text-primary">
                      {[
                        s.senderPromptFolder || "INBOX",
                        s.senderPromptNewFolder.trim().replace(/^\/+|\/+$/g, ""),
                      ]
                        .filter(Boolean)
                        .join("/")}
                    </span>
                  </p>
                </div>
              )}
            </div>
            <div className="flex gap-1">
              <button type="button" onClick={() => void actions.handleSenderPromptSave()} disabled={s.senderPromptSaving} className="glass-btn-primary rounded-lg px-3 py-1 text-xs font-medium disabled:opacity-50">{s.senderPromptSaving ? "..." : "Profil speichern"}</button>
              <button type="button" onClick={actions.handleSenderPromptSkip} className="glass-btn rounded-lg px-3 py-1 text-xs">Überspringen</button>
              <button type="button" onClick={() => void actions.handleSenderPromptIgnore()} disabled={s.senderPromptSaving} className="glass-btn rounded-lg px-3 py-1 text-xs glass-text-muted disabled:opacity-50">Nie wieder fragen</button>
            </div>
          </div>
          <div className="mt-2">
            <label className="block text-xs glass-text-muted mb-1">Auto-Labels (optional)</label>
            <div className="flex flex-wrap gap-2">
              {s.labelList.map((label) => {
                const checked = s.senderPromptAutoLabels.includes(label.name);
                return (
                  <label key={label.id} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs glass-text-secondary cursor-pointer hover:bg-white/20">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        s.setSenderPromptAutoLabels((prev) =>
                          checked ? prev.filter((n) => n !== label.name) : [...prev, label.name],
                        );
                      }}
                      className="rounded"
                    />
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: label.color || "#6b7280" }}
                    />
                    {label.name}
                  </label>
                );
              })}
              {s.labelList.length === 0 ? (
                <span className="text-xs glass-text-muted">Keine Labels vorhanden – unter Labels anlegen oder unten eingeben.</span>
              ) : null}
            </div>
            <div className="mt-1.5 flex gap-2 max-w-sm">
              <input
                type="text"
                value={s.senderPromptNewLabel}
                onChange={(e) => s.setSenderPromptNewLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  const name = s.senderPromptNewLabel.trim();
                  if (!name) return;
                  s.setSenderPromptAutoLabels((prev) =>
                    prev.includes(name) ? prev : [...prev, name],
                  );
                  s.setSenderPromptNewLabel("");
                }}
                placeholder="Neues Label…"
                className="glass-input flex-1 rounded-lg px-2 py-1 text-xs"
              />
              <button
                type="button"
                className="glass-btn rounded-lg px-2 py-1 text-xs"
                onClick={() => {
                  const name = s.senderPromptNewLabel.trim();
                  if (!name) return;
                  s.setSenderPromptAutoLabels((prev) =>
                    prev.includes(name) ? prev : [...prev, name],
                  );
                  s.setSenderPromptNewLabel("");
                }}
              >
                Hinzufügen
              </button>
            </div>
            {s.senderPromptAutoLabels.some((n) => !s.labelList.some((l) => l.name === n)) ? (
              <div className="mt-1 flex flex-wrap gap-1">
                {s.senderPromptAutoLabels
                  .filter((n) => !s.labelList.some((l) => l.name === n))
                  .map((name) => (
                    <span key={name} className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[11px] glass-text-secondary">
                      {name}
                      <button
                        type="button"
                        className="hover:text-red-400"
                        onClick={() =>
                          s.setSenderPromptAutoLabels((prev) => prev.filter((n) => n !== name))
                        }
                      >
                        ✕
                      </button>
                    </span>
                  ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {s.isLoadingDetail ? <p className="px-4 py-2 text-sm glass-text-secondary">Lade Detail...</p> : null}

      {/* Body + attachments scroll area */}
      <div className="px-3 py-2 pb-24 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:px-4 lg:py-4 lg:pb-4 flex flex-col">
        {email.aiSummaryShort ? (
          <div className="glass-info mb-4 rounded-xl p-3 text-sm">
            <p className="font-semibold">KI-Zusammenfassung</p>
            <p>{email.aiSummaryShort}</p>
            {email.aiSummaryLong ? <p className="mt-1 text-xs opacity-80">{email.aiSummaryLong}</p> : null}
            <p className="mt-1 text-xs opacity-80">Kategorie: {email.aiCategory ?? "unknown"} | Priorität: {email.aiPriority ?? "normal"}</p>
          </div>
        ) : null}

        {/* Attachment type badges (jump links) */}
        {(email.attachments?.length ?? 0) > 0 ? (() => {
          const typeMap: Record<string, number> = {};
          for (const att of email.attachments) {
            const label = getAttachmentTypeLabel(att);
            typeMap[label] = (typeMap[label] || 0) + 1;
          }
          const typeEntries = Object.entries(typeMap).sort((a, b) => b[1] - a[1]);
          return (
            <div className="mb-3 inline-flex flex-wrap items-center gap-1.5 rounded-lg glass px-3 py-1.5 text-xs font-medium glass-text-primary">
              <span className="glass-text-muted mr-1">📎</span>
              {typeEntries.map(([label, count], i) => (
                <button key={label} type="button" onClick={() => document.getElementById(`attachments-group-${label}`)?.scrollIntoView({ behavior: "smooth" })} className="hover:underline hover:opacity-80 transition-opacity">{count} {label}{i < typeEntries.length - 1 ? "," : ""}</button>
              ))}
              <button type="button" onClick={() => document.getElementById("attachments-section")?.scrollIntoView({ behavior: "smooth" })} className="glass-text-muted ml-1 hover:opacity-80">↓</button>
            </div>
          );
        })() : null}

        {/* Mail body */}
        {s.isLoadingBody ? (
          <div className="glass rounded-xl p-4 text-sm glass-text-secondary animate-pulse">
            <div className="flex items-center gap-2">
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
              Lade Mailinhalt vom IMAP-Server…
            </div>
          </div>
        ) : s.bodyError ? (
          <div className="glass-error rounded-xl p-4 text-sm">
            {s.bodyError}
            <button onClick={() => void sync.loadBody(email.id, true)} className="ml-2 underline font-medium">Erneut versuchen</button>
          </div>
        ) : s.bodyContent && s.bodyMode === "html" && s.bodyContent.html ? (
          <div className="flex w-full flex-1 flex-col">
            {!s.showExternalImages ? (
              <div className="glass-info rounded-xl px-3 py-2 text-xs mb-2 flex items-center justify-between shrink-0">
                <span className="glass-text-secondary">Externe Bilder wurden aus Sicherheitsgründen blockiert.</span>
                <button onClick={() => s.setShowExternalImages(true)} className="glass-btn rounded-lg px-3 py-1 text-xs shrink-0 ml-2">Bilder laden</button>
              </div>
            ) : null}
            <iframe
              ref={s.mailBodyIframeRef}
              title="Mailinhalt"
              sandbox="allow-scripts"
              srcDoc={safeMailDocument}
              referrerPolicy="no-referrer"
              className="block w-full rounded-xl bg-white lg:flex-1"
              style={{ border: "none", maxWidth: "100%", minHeight: "80dvh", overflowX: "hidden" }}
            />
          </div>
        ) : (
          <div>
            {!s.bodyContent ? (
              <div className="glass-info rounded-xl p-4 text-sm mb-3 flex items-center gap-3">
                <svg className="h-5 w-5 shrink-0 glass-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" /></svg>
                <div className="flex-1">
                  <p className="font-medium glass-text-primary text-sm">Mailinhalt wird geladen…</p>
                  <p className="glass-text-muted text-xs mt-0.5">Der vollständige Inhalt wird vom IMAP-Server abgerufen.</p>
                </div>
                <button onClick={() => void sync.loadBody(email.id, true)} className="glass-btn rounded-lg px-3 py-1.5 text-xs shrink-0">Neu laden</button>
              </div>
            ) : s.bodyContent.text && !s.bodyContent.html ? (
              <div className="glass-info rounded-xl px-3 py-2 text-xs mb-2 flex items-center gap-2">
                <span className="glass-text-secondary">Nur Text-Version verfügbar.</span>
                <button onClick={() => void sync.loadBody(email.id, true)} className="glass-btn rounded-lg px-3 py-1 text-xs">HTML-Version laden</button>
              </div>
            ) : null}
            <div className="flex-1 max-w-full whitespace-pre-wrap break-words rounded-xl bg-white p-4 text-sm leading-relaxed text-slate-800" style={{ minHeight: "400px" }}>
              {(() => {
                const plain = s.bodyContent?.text || email.textPreview || email.snippet || "";
                return plain ? linkifyMailPlainText(plain) : "(Kein Mailinhalt verfügbar.)";
              })()}
            </div>
          </div>
        )}

        {/* Attachments section */}
        {(email.attachments?.length ?? 0) > 0 ? (() => {
          const grouped: Record<string, Attachment[]> = {};
          for (const att of email.attachments) {
            const label = getAttachmentTypeLabel(att);
            (grouped[label] ??= []).push(att);
          }
          const sortedGroups = Object.entries(grouped).sort((a, b) => b[1].length - a[1].length);

          return (
            <div id="attachments-section" className="mt-6 pt-4 border-t glass-divider">
              <h3 className="text-sm font-semibold glass-text-primary mb-3">📎 {email.attachments.length} Anhäng{email.attachments.length === 1 ? "" : "e"}</h3>
              {sortedGroups.map(([typeLabel, atts]) => (
                <div key={typeLabel} id={`attachments-group-${typeLabel}`} className="mb-4">
                  <h4 className="text-xs font-semibold glass-text-secondary uppercase tracking-wide mb-2">{typeLabel} ({atts.length})</h4>
                  <ul className="space-y-2">
                    {atts.map((attachment) => {
                      const previewUrl = `/api/emails/${email.id}/attachments/${attachment.id}/preview`;
                      const downloadUrl = `${previewUrl}?download=1`;
                      return (
                        <li key={attachment.id} className="glass relative rounded-xl p-3 text-sm">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <span className="break-all font-medium glass-text-primary">📎 {getAttachmentDisplayName(attachment)}</span>
                              <p className="text-xs glass-text-tertiary">{attachment.mimeType || "unbekannt"} · {attachment.size ?? 0} Bytes</p>
                              <p className="text-xs glass-text-tertiary">Status: {attachment.saveStatus === "saved" ? "in Cloud gespeichert" : attachment.saveStatus === "error" ? "Cloud-Fehler" : "nicht in Cloud gespeichert"}{attachment.cloudPath ? ` · Ziel: ${attachment.cloudPath}` : ""}</p>
                              {attachment.saveError ? <p className="text-xs text-red-600">{attachment.saveError}</p> : null}
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {getAttachmentPreviewType(attachment) && (
                                <button onClick={() => s.setAttachmentPreviewOpen((prev) => { const next = new Set(prev); if (next.has(attachment.id)) next.delete(attachment.id); else next.add(attachment.id); return next; })} className="glass-btn rounded-lg px-2 py-1 text-xs">{s.attachmentPreviewOpen.has(attachment.id) ? "Vorschau schließen" : "Vorschau"}</button>
                              )}
                              <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="glass-btn rounded-lg px-2 py-1 text-xs">Öffnen</a>
                              <a href={downloadUrl} className="glass-btn rounded-lg px-2 py-1 text-xs">Herunterladen</a>
                              <button onClick={() => { const w = window.open(previewUrl, "_blank"); if (w) { w.addEventListener("load", () => { try { w.print(); } catch { /* ignore */ } }); } }} className="glass-btn rounded-lg px-2 py-1 text-xs">Drucken</button>
                            </div>
                          </div>
                          {s.attachmentPreviewOpen.has(attachment.id) && getAttachmentPreviewType(attachment) && (
                            <div className="mt-2 overflow-hidden rounded-lg border glass-divider">
                              {getAttachmentPreviewType(attachment) === "image" ? (
                                <img src={previewUrl} alt={getAttachmentDisplayName(attachment)} className="max-h-[400px] w-full object-contain bg-gray-50" />
                              ) : (
                                <iframe src={previewUrl} title={getAttachmentDisplayName(attachment)} className="h-[500px] w-full" />
                              )}
                            </div>
                          )}
                          <div className="mt-2 flex flex-wrap gap-2 border-t border-gray-100 pt-2">
                            <select value={actions.getAttachmentTarget(attachment.id).provider} onChange={(e) => actions.updateAttachmentTarget(attachment.id, { provider: e.target.value as "google_drive" | "onedrive" | "mock" })} className="glass-btn rounded-lg px-2 py-1 text-xs"><option value="google_drive">Google Drive</option><option value="onedrive">OneDrive</option></select>
                            <input value={actions.getAttachmentTarget(attachment.id).targetPath} onChange={(e) => actions.updateAttachmentTarget(attachment.id, { targetPath: e.target.value })} className="glass-select min-w-[180px] flex-1 rounded-lg px-2 py-1 text-xs" />
                            <button onClick={() => actions.saveAttachmentToCloud(attachment.id)} className="glass-btn rounded-lg px-2 py-1 text-xs">In Cloud speichern</button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          );
        })() : null}

        {/* Contact candidates */}
        {s.selectedEmailCandidates.length > 0 ? (
          <div className="glass mt-4 rounded-xl p-3 text-sm">
            <p className="font-semibold glass-text-primary">Kontaktvorschläge</p>
            <ul className="mt-1 space-y-1 text-xs glass-text-secondary">
              {s.selectedEmailCandidates.map((c) => <li key={c.id}>{c.personName || c.email || "Unbekannt"} ({c.status})</li>)}
            </ul>
          </div>
        ) : null}
      </div>

      {/* Mobile bottom bar */}
      <div className="glass-solid fixed inset-x-0 bottom-0 z-20 border-t glass-divider px-3 py-2 lg:hidden">
        {s.mobileMovePanelOpen ? (
          <div className="mb-2 rounded-xl border border-white/25 bg-white/55 p-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold glass-text-primary">Verschieben</p>
              <button type="button" onClick={() => s.setMobileMovePanelOpen(false)} className="glass-btn rounded-lg px-2 py-1 text-xs">Schließen</button>
            </div>
            <select value={s.moveTargetFolder} onChange={(e) => s.setMoveTargetFolder(e.target.value)} className="glass-select mt-2 w-full rounded-lg px-2 py-1.5 text-xs"><option value="">Vorhandenen Ordner wählen…</option>{s.folders.map((f) => <option key={f.path} value={f.path}>{f.displayName}</option>)}</select>
            <button type="button" onClick={() => void actions.moveToSelectedFolder()} disabled={!s.moveTargetFolder} className="glass-btn mt-2 w-full rounded-lg px-2 py-1.5 text-xs disabled:opacity-50">In ausgewählten Ordner verschieben</button>
            <div className="mt-2 rounded-lg border border-white/30 p-2">
              <p className="text-[11px] font-medium glass-text-secondary">Neuen Ordner erstellen</p>
              <input value={s.mobileNewFolderName} onChange={(e) => s.setMobileNewFolderName(e.target.value)} placeholder="Neuer Ordnername" className="glass-input mt-1 w-full rounded-lg px-2 py-1.5 text-xs" />
              <select value={s.mobileNewFolderParentPath} onChange={(e) => s.setMobileNewFolderParentPath(e.target.value)} className="glass-select mt-1 w-full rounded-lg px-2 py-1.5 text-xs"><option value="">Kein Parent (Root)</option>{s.mobileNewFolderParentOptions.map((p) => <option key={p} value={p}>{p}</option>)}</select>
              <button type="button" onClick={() => void actions.createMobileMoveFolder()} disabled={!s.mobileNewFolderName.trim() || s.isManagingFolder} className="glass-btn mt-2 w-full rounded-lg px-2 py-1.5 text-xs disabled:opacity-50">Ordner anlegen</button>
            </div>
          </div>
        ) : null}
        <div className="grid grid-cols-5 gap-2">
          <button type="button" onClick={() => s.setMobileMovePanelOpen((v) => !v)} className="glass-btn rounded-lg p-2" aria-label="Verschieben" title="Verschieben">↕</button>
          <button type="button" onClick={() => void actions.runAction(`/api/emails/${email.id}/move`, { targetSpecial: "trash" })} className="glass-btn rounded-lg p-2" aria-label="Papierkorb" title="Papierkorb">🗑</button>
          <button type="button" onClick={actions.replyToSelected} className="glass-btn rounded-lg p-2" aria-label="Antworten" title="Antworten">↩</button>
          <button type="button" onClick={actions.replyAllSelected} className="glass-btn rounded-lg p-2" aria-label="Allen antworten" title="Allen antworten">⇄</button>
          <button type="button" onClick={actions.forwardSelected} className="glass-btn rounded-lg p-2" aria-label="Weiterleiten" title="Weiterleiten">↪</button>
        </div>
      </div>
    </>
  );
}
