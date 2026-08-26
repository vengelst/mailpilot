/**
 * Core mail actions: single/bulk operations and empty folder.
 */
import {
  readErrorMessage,
} from "../mail-types";
import type { MailStateReturn } from "../use-mail-state";
import type { MailSyncReturn } from "../use-mail-sync";

export function useMailCoreActions(s: MailStateReturn, sync: MailSyncReturn) {
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

  return {
    runActionForEmail,
    runAction,
    runBulk,
    emptyCurrentFolder,
    setLocalFlag,
    moveToSelectedFolder,
  };
}
