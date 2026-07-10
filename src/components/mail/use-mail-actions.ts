/**
 * Action hook for the mail workspace. Provides functions for email actions
 * (bulk, single, spam), attachment handling, compose, label management,
 * sender profiles, folder management, and automation dashboard operations.
 */

import { useRouter } from "next/navigation";
import {
  type ComposeMode,
  type Email,
  type Folder,
  buildMailtoQuote,
  parseRecipientList,
  plainToHtml,
  readErrorMessage,
  senderDisplayName,
  stripHtml,
} from "./mail-types";
import type { MailStateReturn } from "./use-mail-state";
import type { MailSyncReturn } from "./use-mail-sync";

export function useMailActions(s: MailStateReturn, sync: MailSyncReturn) {
  const router = useRouter();

  // ---------------------------------------------------------------------------
  // Core email actions
  // ---------------------------------------------------------------------------

  async function runActionForEmail(emailId: string, path: string, payload?: object) {
    const prevEmails = s.emails;
    const wasSelected = s.selectedEmail?.id === emailId;
    s.setEmails((prev) => prev.filter((e) => e.id !== emailId));
    if (wasSelected) {
      s.setSelectedEmail(null);
      s.setMobilePane("middle");
      s.setEmailDetailMenuOpen(false);
    }
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    if (!res.ok) {
      s.setEmails(prevEmails);
      s.setUiError(await readErrorMessage(res, "Aktion fehlgeschlagen."));
      return;
    }
    void sync.loadEmails();
    void sync.reloadFolders();
  }

  async function runAction(path: string, payload?: object) {
    if (!s.selectedEmail) return;
    await runActionForEmail(s.selectedEmail.id, path, payload);
  }

  async function runBulk(
    action: "mark_read" | "mark_unread" | "move_trash" | "move_spam" | "move_folder",
    options?: { targetFolder?: string },
    explicitIds?: string[],
  ) {
    const ids = explicitIds?.length ? explicitIds : Array.from(s.selectedIds);
    if (ids.length === 0) return;
    if (action === "move_folder" && !options?.targetFolder) return;

    const isMove = action === "move_trash" || action === "move_spam" || action === "move_folder";
    const prevEmails = s.emails;
    const idsSet = new Set(ids);

    if (isMove) {
      s.setEmails((prev) => prev.filter((e) => !idsSet.has(e.id)));
      if (s.selectedEmail && idsSet.has(s.selectedEmail.id)) {
        s.setSelectedEmail(null);
        s.setMobilePane("middle");
        s.setEmailDetailMenuOpen(false);
      }
    }

    s.setSelectedIds(new Set());
    s.setBulkBusy(true);
    s.setUiInfo("");
    s.setUiError("");
    try {
      const res = await fetch("/api/emails/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          emailIds: ids,
          targetFolder: options?.targetFolder,
        }),
      });
      const data = await res.json().catch(() => ({}) as Record<string, unknown>);
      if (!res.ok) {
        if (isMove) s.setEmails(prevEmails);
        s.setUiError(
          (data as { error?: string }).error ??
            `Bulk-Aktion fehlgeschlagen (HTTP ${res.status}).`,
        );
        return;
      }
      const summary = (data as {
        summary?: { requested: number; executed: number; failed: number; rejected: number };
      }).summary;
      if (summary) {
        const parts = [
          `${summary.executed} verarbeitet`,
          summary.failed > 0 ? `${summary.failed} fehlgeschlagen` : "",
          summary.rejected > 0 ? `${summary.rejected} abgelehnt` : "",
        ].filter(Boolean);
        s.setUiInfo(`Bulk-Aktion: ${parts.join(", ")}.`);
      }
      if (!isMove) {
        await sync.loadEmails();
      }
      void sync.reloadFolders();
    } finally {
      s.setBulkBusy(false);
    }
  }

  async function emptyCurrentFolder() {
    if (!s.selectedAccountId || s.isAllAccounts || !s.selectedFolderPath || !s.folderEmptyKind) return;
    if (s.emptyConfirmText !== "LEEREN") return;
    s.setBulkBusy(true);
    s.setUiInfo("");
    s.setUiError("");
    try {
      const res = await fetch("/api/folders/empty", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountId: s.selectedAccountId,
          folderPath: s.selectedFolderPath,
          confirm: true,
        }),
      });
      const data = await res.json().catch(() => ({}) as Record<string, unknown>);
      if (!res.ok) {
        s.setUiError(
          (data as { error?: string }).error ??
            `Leeren fehlgeschlagen (HTTP ${res.status}).`,
        );
        return;
      }
      const deleted = (data as { deleted?: number }).deleted ?? 0;
      s.setUiInfo(
        `${s.folderEmptyKind === "trash" ? "Papierkorb" : "Spam"} geleert: ${deleted} E-Mails endgültig entfernt.`,
      );
      s.setEmptyFolderModalOpen(false);
      s.setEmptyConfirmText("");
      s.setSelectedIds(new Set());
      await sync.loadEmails();
      await sync.reloadFolders();
    } finally {
      s.setBulkBusy(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Spam & block
  // ---------------------------------------------------------------------------

  function buildSpamContentFingerprint(email: Email) {
    const source = (email.subject ?? email.textPreview ?? email.snippet ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (!source) return "";
    const withoutPrefixes = source.replace(/^((re|aw|fwd|wg)\s*:\s*)+/i, "").trim();
    const normalized = withoutPrefixes
      .replace(/[^a-zA-Z0-9@._\-\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (normalized.length < 8) return "";
    return normalized.slice(0, 80);
  }

  async function markAsSpamAndLearn(email: Email) {
    s.setUiError("");
    const sender = email.fromEmail?.toLowerCase().trim() ?? "";
    const fingerprint = buildSpamContentFingerprint(email);

    await runActionForEmail(email.id, `/api/emails/${email.id}/move`, {
      targetSpecial: "spam",
    });

    const actionsDone: string[] = ["Mail in Spam verschoben"];
    if (sender) {
      const blockRes = await fetch("/api/blocklist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: sender,
          action: "move_spam",
          note: "Per Kontextmenue als Spam-Absender gelernt",
        }),
      });
      if (blockRes.ok) {
        actionsDone.push("Absender fuer kuenftige Mails blockiert");
      } else {
        s.setUiError(await readErrorMessage(blockRes, "Absender-Regel konnte nicht gespeichert werden."));
      }
    }

    if (fingerprint) {
      const ruleRes = await fetch("/api/rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: `Auto-Spam: ${fingerprint.slice(0, 40)}`,
          active: true,
          priority: 10,
          conditionJson: {
            any: [
              ...(sender
                ? [{ field: "fromEmail", operator: "equals", value: sender }]
                : []),
              { field: "subject", operator: "contains", value: fingerprint },
            ],
          },
          actionJson: {
            actions: [{ type: "move_spam" }],
            stopAfterMatch: true,
          },
        }),
      });
      if (ruleRes.ok) {
        actionsDone.push("Inhaltsregel fuer aehnliche Mails aktiviert");
      } else {
        s.setUiError(await readErrorMessage(ruleRes, "Inhalts-Regel konnte nicht gespeichert werden."));
      }
    }

    if (actionsDone.length > 0) {
      s.setUiInfo(`${actionsDone.join(" · ")}.`);
    }
  }

  async function markAsNotSpam(email: Email) {
    s.setUiError("");
    const sender = email.fromEmail?.toLowerCase().trim() ?? "";

    await runActionForEmail(email.id, `/api/emails/${email.id}/move`, {
      targetSpecial: "inbox",
    });

    const actionsDone: string[] = ["Mail in Posteingang verschoben"];
    if (sender) {
      const allowRes = await fetch("/api/blocklist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: sender,
          action: "allow_inbox",
          note: "Per Kontextmenü als sicherer Absender markiert",
        }),
      });
      if (allowRes.ok) {
        actionsDone.push("Absender für künftige Mails als sicher markiert");
      } else {
        s.setUiError(await readErrorMessage(allowRes, "Absender-Regel konnte nicht gespeichert werden."));
      }
    }

    if (actionsDone.length > 0) {
      s.setUiInfo(`${actionsDone.join(" · ")}.`);
    }
  }

  async function blockSender() {
    if (!s.selectedEmail?.fromEmail) return;
    const res = await fetch("/api/blocklist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: s.selectedEmail.fromEmail, action: "move_spam" }),
    });
    if (!res.ok) {
      s.setUiError(await readErrorMessage(res, "Absender konnte nicht blockiert werden."));
    }
  }

  async function blockDomain() {
    const sender = s.selectedEmail?.fromEmail;
    if (!sender || !sender.includes("@")) return;
    const domain = sender.split("@")[1]?.toLowerCase();
    if (!domain) return;
    if (!window.confirm(`Wirklich alle Mails von ${domain} blockieren?`)) return;
    const res = await fetch("/api/blocklist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain, action: "move_spam" }),
    });
    if (!res.ok) {
      s.setUiError(await readErrorMessage(res, "Domain konnte nicht blockiert werden."));
    }
  }

  // ---------------------------------------------------------------------------
  // Local flag
  // ---------------------------------------------------------------------------

  async function setLocalFlag(emailId: string, flag: "red" | "yellow" | "green" | null) {
    s.setUiError("");
    const res = await fetch(`/api/emails/${emailId}/local-flag`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ flag }),
    });
    if (!res.ok) {
      s.setUiError(await readErrorMessage(res, "Lokaler Flag konnte nicht gespeichert werden."));
      return;
    }
    s.setEmails((prev) => prev.map((email) => (email.id === emailId ? { ...email, localFlag: flag } : email)));
    s.setSelectedEmail((prev) => (prev?.id === emailId ? { ...prev, localFlag: flag } : prev));
  }

  // ---------------------------------------------------------------------------
  // Move / folder management
  // ---------------------------------------------------------------------------

  async function moveToSelectedFolder() {
    if (!s.selectedEmail || !s.moveTargetFolder) return;
    await runAction(`/api/emails/${s.selectedEmail.id}/move`, { targetFolder: s.moveTargetFolder });
    s.setMobileMovePanelOpen(false);
  }

  async function manageFolder(
    action: "create" | "delete" | "rename" | "copy",
    payload: { path: string } | { fromPath: string; toPath: string },
  ) {
    if (!s.selectedAccountId || s.isAllAccounts) {
      s.setUiError("Bitte zuerst ein spezifisches Konto wählen.");
      return;
    }
    s.setIsManagingFolder(true);
    s.setUiError("");
    s.setUiInfo("");
    try {
      const res = await fetch(`/api/accounts/${s.selectedAccountId}/folders/manage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      if (!res.ok) {
        s.setUiError(await readErrorMessage(res, "Ordner-Aktion fehlgeschlagen."));
        return;
      }
      const data = (await res.json()) as { folders?: Folder[] };
      const nextFolders = data.folders ?? [];
      s.setFolders(nextFolders);
      if (action === "delete" && "path" in payload && s.selectedFolderPath === payload.path) {
        s.setSelectedFolderPath(nextFolders[0]?.path ?? "");
        s.setSelectedEmail(null);
        s.setBodyContent(null);
        s.setMobilePane("middle");
      } else if ((action === "rename" || action === "copy") && "toPath" in payload) {
        s.setSelectedFolderPath(payload.toPath);
      } else if (action === "create" && "path" in payload) {
        s.setSelectedFolderPath(payload.path);
      }
      await sync.loadEmails();
      const labels: Record<typeof action, string> = {
        create: "Ordner angelegt",
        delete: "Ordner gelöscht",
        rename: "Ordner umbenannt",
        copy: "Ordner kopiert",
      };
      s.setUiInfo(labels[action]);
    } finally {
      s.setIsManagingFolder(false);
    }
  }

  function createFolderPrompt() {
    const prefix = s.selectedFolderPath ? `${s.selectedFolderPath}/` : "";
    const hint = s.selectedFolderPath
      ? `Unterordner von "${s.selectedFolderPath.split("/").pop()}" erstellen.\nOrdnername:`
      : "Neuen Ordnernamen eingeben (z. B. Kunden/Neukunden):";
    const input = window.prompt(hint);
    const name = input?.trim();
    if (!name) return;
    void manageFolder("create", { path: prefix + name });
  }

  function renameFolderPrompt() {
    if (!s.selectedFolderPath) return;
    const next = window.prompt(
      `Neuen Namen/Pfad für "${s.selectedFolderPath}" eingeben:`,
      s.selectedFolderPath,
    );
    const toPath = next?.trim();
    if (!toPath || toPath === s.selectedFolderPath) return;
    void manageFolder("rename", { fromPath: s.selectedFolderPath, toPath });
  }

  function copyFolderPrompt() {
    if (!s.selectedFolderPath) return;
    const defaultTarget = `${s.selectedFolderPath}_copy`;
    const next = window.prompt(
      `Zielordner für Kopie von "${s.selectedFolderPath}" eingeben:`,
      defaultTarget,
    );
    const toPath = next?.trim();
    if (!toPath || toPath === s.selectedFolderPath) return;
    void manageFolder("copy", { fromPath: s.selectedFolderPath, toPath });
  }

  function deleteFolderPrompt() {
    if (!s.selectedFolderPath) return;
    const isGmail = s.selectedAccount?.imapHost?.includes("gmail.com") || s.selectedAccount?.imapHost?.includes("google.com");
    const warning = isGmail
      ? `Ordner "${s.selectedFolderPath}" löschen?\n\n⚠️ Gmail: Das Label wird entfernt, aber die E-Mails bleiben erhalten (unter "Alle Nachrichten" auffindbar).`
      : `Ordner "${s.selectedFolderPath}" wirklich löschen?\n\n⚠️ ACHTUNG: Bei diesem Provider (${s.selectedAccount?.imapHost ?? "IMAP"}) werden die E-Mails im Ordner möglicherweise unwiderruflich gelöscht!`;
    if (!window.confirm(warning)) return;
    void manageFolder("delete", { path: s.selectedFolderPath });
  }

  function handleFolderMoveByDrag(sourcePath: string, targetPath: string) {
    const folderName = sourcePath.split("/").pop() || sourcePath;
    const newPath = `${targetPath}/${folderName}`;
    if (!window.confirm(`Ordner "${folderName}" nach "${targetPath}" verschieben?\n\nNeuer Pfad: ${newPath}`)) return;
    void manageFolder("rename", { fromPath: sourcePath, toPath: newPath });
  }

  async function createMobileMoveFolder() {
    if (!s.selectedAccountId || s.isAllAccounts) {
      s.setUiError("Bitte zuerst ein spezifisches Konto wählen.");
      return;
    }
    const name = s.mobileNewFolderName.trim();
    if (!name) {
      s.setUiError("Bitte einen Ordnernamen eingeben.");
      return;
    }
    const parent = s.mobileNewFolderParentPath.trim();
    const nextPath = parent ? `${parent}/${name}` : name;
    await manageFolder("create", { path: nextPath });
    s.setMoveTargetFolder(nextPath);
    s.setMobileNewFolderName("");
    s.setMobileMovePanelOpen(true);
  }

  // ---------------------------------------------------------------------------
  // Attachments
  // ---------------------------------------------------------------------------

  function getAttachmentTarget(attachmentId: string) {
    return (
      s.attachmentTargets[attachmentId] ?? {
        provider: "mock" as const,
        targetPath: "/Rechnungen/{{year}}/{{month}}/{{senderDomain}}/",
      }
    );
  }

  function updateAttachmentTarget(
    attachmentId: string,
    patch: Partial<{ provider: "google_drive" | "onedrive" | "mock"; targetPath: string }>,
  ) {
    s.setAttachmentTargets((prev) => ({
      ...prev,
      [attachmentId]: { ...getAttachmentTarget(attachmentId), ...patch },
    }));
  }

  async function saveAttachmentToCloud(attachmentId: string) {
    if (!s.selectedEmail) return;
    const target = getAttachmentTarget(attachmentId);
    const res = await fetch(
      `/api/emails/${s.selectedEmail.id}/attachments/${attachmentId}/save`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(target),
      },
    );
    if (!res.ok) {
      s.setUiError(await readErrorMessage(res, "Anhang konnte nicht gespeichert werden."));
    }
    await sync.loadEmail(s.selectedEmail.id);
  }

  async function saveAttachmentToCloudForEmail(emailId: string, attachmentId: string) {
    const target = getAttachmentTarget(attachmentId);
    const res = await fetch(`/api/emails/${emailId}/attachments/${attachmentId}/save`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(target),
    });
    if (!res.ok) {
      s.setUiError(await readErrorMessage(res, "Anhang konnte nicht gespeichert werden."));
      return;
    }
    if (s.selectedEmail?.id === emailId) {
      await sync.loadEmail(emailId);
    }
  }

  function openAttachment(emailId: string, attachmentId: string) {
    window.open(`/api/emails/${emailId}/attachments/${attachmentId}/preview`, "_blank", "noopener,noreferrer");
  }

  function printAttachment(emailId: string, attachmentId: string) {
    const previewUrl = `/api/emails/${emailId}/attachments/${attachmentId}/preview`;
    const w = window.open(previewUrl, "_blank");
    if (!w) return;
    const onLoad = () => {
      try { w.print(); } catch { /* ignore */ }
      w.removeEventListener("load", onLoad);
    };
    w.addEventListener("load", onLoad);
  }

  function printSelectedEmail(mode: "html" | "text" = s.printMode) {
    if (!s.selectedEmail) return;
    window.open(`/api/emails/${s.selectedEmail.id}/print?mode=${mode}`, "_blank");
  }

  // ---------------------------------------------------------------------------
  // Labels
  // ---------------------------------------------------------------------------

  async function addLabelToEmail(emailId: string, label: string) {
    try {
      const res = await fetch(`/api/emails/${emailId}/labels`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const newLabels: string[] = data.labels ?? [];
      s.setSelectedEmail((prev) => (prev?.id === emailId ? { ...prev, labels: newLabels } : prev));
      s.setEmails((prev) => prev.map((e) => (e.id === emailId ? { ...e, labels: newLabels } : e)));
      void sync.loadLabels();
    } catch { /* ignore */ }
  }

  async function removeLabelFromEmail(emailId: string, label: string) {
    try {
      const res = await fetch(`/api/emails/${emailId}/labels`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const newLabels: string[] = data.labels ?? [];
      s.setSelectedEmail((prev) => (prev?.id === emailId ? { ...prev, labels: newLabels } : prev));
      s.setEmails((prev) => prev.map((e) => (e.id === emailId ? { ...e, labels: newLabels } : e)));
      void sync.loadLabels();
    } catch { /* ignore */ }
  }

  async function createAndAddLabel(emailId: string, labelName: string) {
    try {
      const res = await fetch("/api/labels", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: labelName, color: "#3b82f6" }),
      });
      if (!res.ok) return;
      await addLabelToEmail(emailId, labelName);
    } catch { /* ignore */ }
  }

  // ---------------------------------------------------------------------------
  // Sender profile & auto-prompt
  // ---------------------------------------------------------------------------

  async function checkSenderProfileAfterMove(
    fromEmail: string,
    fromName: string,
    targetFolder: string,
    emailId: string,
  ) {
    try {
      const res = await fetch("/api/sender-profiles/match", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: fromEmail }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.profile) return;
      if (s.senderProfileToastTimerRef.current) clearTimeout(s.senderProfileToastTimerRef.current);
      s.setSenderProfileToast({ fromEmail, fromName, targetFolder, emailId });
      s.senderProfileToastTimerRef.current = setTimeout(() => {
        s.setSenderProfileToast(null);
        s.senderProfileToastTimerRef.current = null;
      }, 8000);
    } catch { /* ignore */ }
  }

  async function handleRememberSenderProfile() {
    if (!s.senderProfileToast) return;
    const { fromEmail, fromName, targetFolder } = s.senderProfileToast;
    try {
      const suggestRes = await fetch("/api/sender-profiles/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: fromEmail, fromName }),
      });
      const suggestion = suggestRes.ok ? await suggestRes.json() : null;

      const folderLower = targetFolder.toLowerCase();
      let cat = "Sonstiges";
      const catMap: Record<string, string> = {
        kunde: "Kunde", kunden: "Kunde", lieferant: "Lieferant", lieferanten: "Lieferant",
        subunternehmer: "Subunternehmer", sub: "Subunternehmer", privat: "Privat",
        werbung: "Werbung", newsletter: "Werbung",
      };
      for (const [kw, c] of Object.entries(catMap)) {
        if (folderLower.includes(kw)) { cat = c; break; }
      }

      await fetch("/api/sender-profiles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          profileName: suggestion?.profileName ?? (fromName || fromEmail.split("@")[0]),
          patterns: suggestion?.patterns ?? [fromEmail.split("@")[1] ?? fromEmail],
          category: cat,
          targetFolder,
        }),
      });
      s.setUiInfo(`Absender-Profil für ${suggestion?.profileName ?? fromEmail} erstellt.`);
    } catch {
      s.setUiError("Absender-Profil konnte nicht erstellt werden.");
    }
    if (s.senderProfileToastTimerRef.current) {
      clearTimeout(s.senderProfileToastTimerRef.current);
      s.senderProfileToastTimerRef.current = null;
    }
    s.setSenderProfileToast(null);
  }

  async function checkSenderOnOpen(email: Email) {
    if (!email.fromEmail) return;
    if (s.checkedSenders.has(email.fromEmail)) return;
    s.checkedSenders.add(email.fromEmail);
    try {
      const res = await fetch(
        `/api/sender-profiles/check-sender?email=${encodeURIComponent(email.fromEmail)}`,
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data.matched) return;
      const domain = email.fromEmail.split("@")[1] ?? "";
      s.setSenderPromptData({ email: email.fromEmail, domain, fromName: email.fromName ?? "" });
      s.setSenderPromptCategory("Sonstiges");
      s.setSenderPromptFolder("");
      s.setSenderPromptVisible(true);
    } catch { /* ignore */ }
  }

  async function handleSenderPromptSave() {
    if (!s.senderPromptData) return;
    s.setSenderPromptSaving(true);
    try {
      const suggestRes = await fetch("/api/sender-profiles/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: s.senderPromptData.email, fromName: s.senderPromptData.fromName }),
      });
      const suggestion = suggestRes.ok ? await suggestRes.json() : null;

      const targetFolder = s.senderPromptFolder || "INBOX";
      await fetch("/api/sender-profiles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          profileName: suggestion?.profileName ?? (s.senderPromptData.fromName || s.senderPromptData.email.split("@")[0]),
          patterns: suggestion?.patterns ?? [s.senderPromptData.domain || s.senderPromptData.email],
          category: s.senderPromptCategory,
          targetFolder,
        }),
      });
      s.setUiInfo(`Absender-Profil für ${s.senderPromptData.domain || s.senderPromptData.email} erstellt.`);

      if (targetFolder && targetFolder !== "INBOX" && s.selectedEmail) {
        const domain = s.senderPromptData.domain;
        const emailMatch = s.selectedEmail.fromEmail &&
          (s.selectedEmail.fromEmail === s.senderPromptData.email ||
            (domain && s.selectedEmail.fromEmail.endsWith(`@${domain}`))) &&
          s.selectedEmail.folderPath === "INBOX";
        if (emailMatch) {
          const id = s.selectedEmail.id;
          s.setEmails((prev) => prev.filter((e) => e.id !== id));
          s.setSelectedEmail(null);
          void runActionForEmail(id, `/api/emails/${id}/move`, { targetFolder });
        }
      }
    } catch {
      s.setUiError("Absender-Profil konnte nicht erstellt werden.");
    } finally {
      s.setSenderPromptSaving(false);
      s.setSenderPromptVisible(false);
      s.setSenderPromptData(null);
    }
  }

  function handleSenderPromptSkip() {
    s.setSenderPromptVisible(false);
    s.setSenderPromptData(null);
  }

  async function handleSenderPromptIgnore() {
    if (!s.senderPromptData) return;
    s.setSenderPromptSaving(true);
    try {
      await fetch("/api/sender-profiles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          profileName: s.senderPromptData.domain || s.senderPromptData.email,
          patterns: [s.senderPromptData.domain || s.senderPromptData.email],
          category: "ignore",
          targetFolder: "",
        }),
      });
    } catch { /* ignore */ }
    s.setSenderPromptSaving(false);
    s.setSenderPromptVisible(false);
    s.setSenderPromptData(null);
  }

  // ---------------------------------------------------------------------------
  // Compose
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Misc actions
  // ---------------------------------------------------------------------------

  async function createContactSuggestion() {
    if (!s.selectedEmail) return;
    await runAction(`/api/emails/${s.selectedEmail.id}/analyze`);
    await sync.loadContactCandidates();
  }

  async function copyEmailsToClipboard(ids: string[]) {
    const byId = new Map(s.emails.map((email) => [email.id, email]));
    const payload = ids
      .map((id) => byId.get(id))
      .filter((email): email is Email => !!email)
      .map((email) => {
        const from = senderDisplayName(email);
        const subject = email.subject || "(Ohne Betreff)";
        const snippet = email.snippet || "";
        return `Von: ${from}\nBetreff: ${subject}\nVorschau: ${snippet}`;
      })
      .join("\n\n");
    if (!payload) return;
    try {
      await navigator.clipboard.writeText(payload);
      s.setUiInfo(`${ids.length > 1 ? `${ids.length} Mails` : "Mail"} in Zwischenablage kopiert.`);
    } catch {
      s.setUiError("Kopieren in die Zwischenablage ist fehlgeschlagen.");
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  // ---------------------------------------------------------------------------
  // Automation dashboard
  // ---------------------------------------------------------------------------

  async function saveAutomationDashboardSettings(patch: {
    runOnAppStart?: boolean;
    runIntervalMinutes?: number;
  }) {
    s.setAutomationSaving(true);
    try {
      const res = await fetch("/api/automation/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        s.setUiError(await readErrorMessage(res, "Auto-Update-Einstellungen konnten nicht gespeichert werden."));
        return false;
      }
      const data = (await res.json()) as {
        settings?: { runOnAppStart?: boolean; runIntervalMinutes?: number };
      };
      if (typeof data.settings?.runOnAppStart === "boolean") {
        s.setRunOnAppStart(data.settings.runOnAppStart);
      }
      if (typeof data.settings?.runIntervalMinutes === "number" && Number.isFinite(data.settings.runIntervalMinutes)) {
        s.setNewMailCheckIntervalMinutes(Math.max(5, Math.round(data.settings.runIntervalMinutes)));
      }
      s.setUiInfo("Auto-Update-Einstellungen gespeichert.");
      return true;
    } finally {
      s.setAutomationSaving(false);
    }
  }

  async function runAutomationNow() {
    if (!s.selectedAccountId || s.isAllAccounts) return;
    s.setAutomationRunningNow(true);
    try {
      const res = await fetch("/api/automation/run-now", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "full", accountId: s.selectedAccountId }),
      });
      if (!res.ok) {
        s.setUiError(await readErrorMessage(res, "Auto-Update konnte nicht gestartet werden."));
        return;
      }
      s.setUiInfo("Auto-Update wurde gestartet.");
      await Promise.all([sync.loadAutomationRuns(), sync.loadEmails(), sync.reloadFolders()]);
    } finally {
      s.setAutomationRunningNow(false);
    }
  }

  return {
    runActionForEmail,
    runAction,
    runBulk,
    emptyCurrentFolder,
    markAsSpamAndLearn,
    markAsNotSpam,
    blockSender,
    blockDomain,
    setLocalFlag,
    moveToSelectedFolder,
    manageFolder,
    createFolderPrompt,
    renameFolderPrompt,
    copyFolderPrompt,
    deleteFolderPrompt,
    handleFolderMoveByDrag,
    createMobileMoveFolder,
    getAttachmentTarget,
    updateAttachmentTarget,
    saveAttachmentToCloud,
    saveAttachmentToCloudForEmail,
    openAttachment,
    printAttachment,
    printSelectedEmail,
    addLabelToEmail,
    removeLabelFromEmail,
    createAndAddLabel,
    checkSenderProfileAfterMove,
    handleRememberSenderProfile,
    checkSenderOnOpen,
    handleSenderPromptSave,
    handleSenderPromptSkip,
    handleSenderPromptIgnore,
    openCompose,
    composeNewMail,
    replyToSelected,
    forwardSelected,
    replyAllSelected,
    applyComposeCommand,
    submitCompose,
    insertSignatureHtml,
    createContactSuggestion,
    copyEmailsToClipboard,
    logout,
    saveAutomationDashboardSettings,
    runAutomationNow,
  };
}

export type MailActionsReturn = ReturnType<typeof useMailActions>;
