/**
 * Compose / reply / forward actions.
 */
import {
  type ComposeMode,
  type Email,
  buildMailtoQuote,
  parseRecipientList,
  plainToHtml,
  stripHtml,
} from "../mail-types";
import type { MailStateReturn } from "../use-mail-state";

export function useMailComposeActions(s: MailStateReturn) {
  function getSignatureFor(mode: "new" | "reply" | "forward", accountId?: string) {
    const matchByAccount = accountId
      ? s.signatures.find((sig) => sig.accountIds.includes(accountId))
      : undefined;
    const sig = matchByAccount ?? s.signatures.find((sig) => sig.isDefault) ?? null;
    if (!sig) return "";
    if (mode === "new" && !sig.includeOnNewMail) return "";
    if (mode === "reply" && !sig.includeOnReply) return "";
    if (mode === "forward" && !sig.includeOnForward) return "";
    return sig.htmlContent;
  }

  function insertSignatureHtml(mode: ComposeMode, accountId?: string) {
    const html = getSignatureFor(mode, accountId);
    if (!html) return "";
    return `<p><br/></p><div>${html}</div>`;
  }

  function openCompose(mode: ComposeMode, source?: Email) {
    const defaultAccountId = (s.isAllAccounts ? "" : s.selectedAccountId) || s.accounts[0]?.id || "";
    const quoteText =
      source && mode !== "new"
        ? buildMailtoQuote(
            source,
            mode === "reply" ? "--- Ursprüngliche Nachricht ---" : "--- Weitergeleitete Nachricht ---",
          )
        : "";
    const quoteHtml = quoteText ? `<p>${plainToHtml(quoteText)}</p>` : "";
    const signatureHtml = insertSignatureHtml(mode, source?.accountId || defaultAccountId);
    s.setComposeMode(mode);
    s.setComposeForm({
      draftId: null,
      accountId: source?.accountId || defaultAccountId,
      to: mode === "reply" ? source?.fromEmail ?? "" : "",
      cc: "",
      bcc: "",
      subject:
        mode === "reply"
          ? `Re: ${source?.subject ?? ""}`
          : mode === "forward"
            ? `Fwd: ${source?.subject ?? ""}`
            : "",
      bodyHtml: `<div dir="ltr" style="direction:ltr;text-align:left"><br></div>${signatureHtml}${quoteHtml}`.trim(),
      sendAtLocal: "",
    });
    s.setComposeOpen(true);
  }

  function composeNewMail() {
    openCompose("new");
  }

  function replyToSelected() {
    if (!s.selectedEmail) return;
    openCompose("reply", s.selectedEmail);
  }

  function forwardSelected() {
    if (!s.selectedEmail) return;
    openCompose("forward", s.selectedEmail);
  }

  function replyAllSelected() {
    if (!s.selectedEmail) return;
    const own = s.selectedAccount?.imapUsername?.toLowerCase().trim() ?? "";
    const sender = s.selectedEmail.fromEmail?.toLowerCase().trim() ?? "";
    const additionalCc = [...(s.selectedEmail.toEmails ?? []), ...(s.selectedEmail.ccEmails ?? [])]
      .map((mail) => mail.trim())
      .filter((mail) => {
        const lower = mail.toLowerCase();
        if (!lower) return false;
        if (own && lower === own) return false;
        if (sender && lower === sender) return false;
        return true;
      });
    openCompose("reply", s.selectedEmail);
    s.setComposeForm((prev) => ({
      ...prev,
      cc: Array.from(new Set(additionalCc)).join(", "),
    }));
  }

  function applyComposeCommand(command: string, value?: string) {
    if (!s.composeEditorRef.current) return;
    s.composeEditorRef.current.focus();
    document.execCommand(command, false, value);
    s.setComposeForm((prev) => ({
      ...prev,
      bodyHtml: s.composeEditorRef.current?.innerHTML || "",
    }));
  }

  async function submitCompose(action: "send_now" | "send_later" | "save_draft") {
    const bodyHtml = s.composeEditorRef.current?.innerHTML || s.composeForm.bodyHtml || "";
    const payload = {
      action,
      draftId: s.composeForm.draftId ?? undefined,
      accountId: s.composeForm.accountId,
      to: parseRecipientList(s.composeForm.to),
      cc: parseRecipientList(s.composeForm.cc),
      bcc: parseRecipientList(s.composeForm.bcc),
      subject: s.composeForm.subject,
      html: bodyHtml,
      text: stripHtml(bodyHtml),
      sendAt: action === "send_later" ? new Date(s.composeForm.sendAtLocal).toISOString() : undefined,
    };
    if (!payload.accountId) {
      s.setUiError("Bitte ein Konto für den Versand auswählen.");
      return;
    }
    if ((action === "send_now" || action === "send_later") && payload.to.length === 0) {
      s.setUiError("Bitte mindestens einen Empfänger in 'An' eintragen.");
      return;
    }
    if (action === "send_later" && !s.composeForm.sendAtLocal) {
      s.setUiError("Bitte einen Zeitpunkt für 'später senden' angeben.");
      return;
    }
    s.setComposeSaving(true);
    const res = await fetch("/api/compose", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => ({}))) as {
      info?: string;
      error?: string;
      draft?: { id?: string };
    };
    if (!res.ok) {
      s.setUiError(data.error ?? "Mail-Aktion fehlgeschlagen.");
      s.setComposeSaving(false);
      return;
    }
    if (data.draft?.id) {
      s.setComposeForm((prev) => ({ ...prev, draftId: data.draft?.id || prev.draftId }));
    }
    s.setUiInfo(data.info ?? "Aktion erfolgreich.");
    if (action !== "save_draft") s.setComposeOpen(false);
    s.setComposeSaving(false);
  }

  return {
    openCompose,
    composeNewMail,
    replyToSelected,
    forwardSelected,
    replyAllSelected,
    applyComposeCommand,
    submitCompose,
    insertSignatureHtml,
  };
}
