/**
 * Sender profile and auto-prompt actions.
 */
import { type Email, readErrorMessage } from "../mail-types";
import type { MailStateReturn } from "../use-mail-state";
import type { MailSyncReturn } from "../use-mail-sync";

type CoreDeps = {
  runActionForEmail: (emailId: string, path: string, payload?: object) => Promise<void>;
};

type LabelDeps = {
  addLabelToEmail: (emailId: string, label: string) => Promise<void>;
};

export function useMailSenderActions(
  s: MailStateReturn,
  sync: MailSyncReturn,
  core: CoreDeps,
  labels: LabelDeps,
) {
  const { runActionForEmail } = core;
  const { addLabelToEmail } = labels;

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
    if (!email.fromEmail) {
      s.setSenderPromptVisible(false);
      s.setSenderPromptData(null);
      return;
    }
    if (s.checkedSenders.has(email.fromEmail)) return;
    s.checkedSenders.add(email.fromEmail);
    try {
      const res = await fetch(
        `/api/sender-profiles/check-sender?email=${encodeURIComponent(email.fromEmail)}`,
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data.matched) {
        s.setSenderPromptVisible(false);
        s.setSenderPromptData(null);
        const targetFolder = data.profile?.targetFolder as string | undefined;
        const category = data.profile?.category as string | undefined;
        // Optimistic: hide from inbox as soon as the user leaves this mail —
        // don't wait for the slow IMAP move in mark-read.
        if (
          email.folderPath === "INBOX" &&
          targetFolder &&
          targetFolder !== "INBOX" &&
          category !== "ignore"
        ) {
          if (s.selectedEmailIdRef.current !== email.id) {
            s.pendingAutoMoveRef.current = null;
            s.setEmails((prev) => prev.filter((e) => e.id !== email.id));
            if (s.autoMoveToastTimerRef.current) clearTimeout(s.autoMoveToastTimerRef.current);
            s.setAutoMoveToast({ emailId: email.id, folder: targetFolder });
            s.autoMoveToastTimerRef.current = setTimeout(() => {
              s.setAutoMoveToast(null);
              s.autoMoveToastTimerRef.current = null;
            }, 5000);
          } else {
            s.pendingAutoMoveRef.current = { emailId: email.id, folder: targetFolder };
          }
        }
        return;
      }
      const domain = email.fromEmail.split("@")[1] ?? "";
      s.setSenderPromptData({ email: email.fromEmail, domain, fromName: email.fromName ?? "" });
      s.setSenderPromptCategory("Sonstiges");
      s.setSenderPromptFolder("");
      s.setSenderPromptUseNewFolder(false);
      s.setSenderPromptNewFolder("");
      s.setSenderPromptAutoLabels([]);
      s.setSenderPromptNewLabel("");
      s.setSenderPromptVisible(true);
    } catch { /* ignore */ }
  }

  async function handleSenderPromptSave() {
    if (!s.senderPromptData) return;
    s.setSenderPromptSaving(true);
    s.setUiError("");
    let saved = false;
    try {
      const suggestRes = await fetch("/api/sender-profiles/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: s.senderPromptData.email, fromName: s.senderPromptData.fromName }),
      });
      const suggestion = suggestRes.ok ? await suggestRes.json() : null;

      const newFolderName = s.senderPromptNewFolder.trim().replace(/^\/+|\/+$/g, "");
      const targetFolder = (
        s.senderPromptUseNewFolder
          ? [s.senderPromptFolder || "INBOX", newFolderName].filter(Boolean).join("/")
          : s.senderPromptFolder
      ).trim() || "INBOX";
      const autoLabels = [...new Set(s.senderPromptAutoLabels.map((l) => l.trim()).filter(Boolean))];

      if (s.senderPromptUseNewFolder && !newFolderName) {
        s.setUiError("Bitte einen Namen für den neuen Ordner eingeben.");
        return;
      }

      // Create new IMAP folder if the user typed a path that does not exist yet
      if (
        s.senderPromptUseNewFolder &&
        targetFolder &&
        targetFolder !== "INBOX" &&
        !s.folders.some((f) => f.path === targetFolder)
      ) {
        if (!s.selectedAccountId || s.isAllAccounts) {
          s.setUiError("Für einen neuen Ordner bitte ein einzelnes Konto wählen.");
          return;
        }
        const createRes = await fetch(`/api/accounts/${s.selectedAccountId}/folders/manage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "create", path: targetFolder }),
        });
        if (!createRes.ok) {
          s.setUiError(await readErrorMessage(createRes, "Zielordner konnte nicht erstellt werden."));
          return;
        }
        await sync.reloadFolders();
      }

      // Ensure EmailLabel definitions exist for selected auto-labels
      for (const labelName of autoLabels) {
        if (!s.labelList.some((l) => l.name === labelName)) {
          await fetch("/api/labels", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: labelName }),
          }).catch(() => {});
        }
      }

      await fetch("/api/sender-profiles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          profileName: suggestion?.profileName ?? (s.senderPromptData.fromName || s.senderPromptData.email.split("@")[0]),
          patterns: suggestion?.patterns ?? [s.senderPromptData.domain || s.senderPromptData.email],
          category: s.senderPromptCategory,
          targetFolder,
          autoLabels,
        }),
      });
      s.setUiInfo(`Absender-Profil für ${s.senderPromptData.domain || s.senderPromptData.email} erstellt.`);
      saved = true;

      const currentEmail = s.selectedEmail;
      if (currentEmail) {
        const domain = s.senderPromptData.domain;
        const emailMatch = currentEmail.fromEmail &&
          (currentEmail.fromEmail === s.senderPromptData.email ||
            (domain && currentEmail.fromEmail.endsWith(`@${domain}`)));

        if (emailMatch && autoLabels.length > 0) {
          for (const label of autoLabels) {
            if (!(currentEmail.labels ?? []).includes(label)) {
              await addLabelToEmail(currentEmail.id, label);
            }
          }
        }

        if (emailMatch && targetFolder && targetFolder !== "INBOX" && currentEmail.folderPath === "INBOX") {
          const id = currentEmail.id;
          s.setEmails((prev) => prev.filter((e) => e.id !== id));
          s.setSelectedEmail(null);
          void runActionForEmail(id, `/api/emails/${id}/move`, { targetFolder });
        }
      }
    } catch {
      s.setUiError("Absender-Profil konnte nicht erstellt werden.");
    } finally {
      s.setSenderPromptSaving(false);
      if (saved) {
        s.setSenderPromptVisible(false);
        s.setSenderPromptData(null);
        s.setSenderPromptAutoLabels([]);
        s.setSenderPromptNewLabel("");
        s.setSenderPromptUseNewFolder(false);
        s.setSenderPromptNewFolder("");
      }
    }
  }

  function handleSenderPromptSkip() {
    s.setSenderPromptVisible(false);
    s.setSenderPromptData(null);
    s.setSenderPromptAutoLabels([]);
    s.setSenderPromptNewLabel("");
    s.setSenderPromptUseNewFolder(false);
    s.setSenderPromptNewFolder("");
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
    s.setSenderPromptAutoLabels([]);
    s.setSenderPromptNewLabel("");
    s.setSenderPromptUseNewFolder(false);
    s.setSenderPromptNewFolder("");
  }

  return {
    checkSenderProfileAfterMove,
    handleRememberSenderProfile,
    checkSenderOnOpen,
    handleSenderPromptSave,
    handleSenderPromptSkip,
    handleSenderPromptIgnore,
  };
}
