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

  function clearSenderPromptForm() {
    s.setSenderPromptVisible(false);
    s.setSenderPromptMode("create");
    s.setSenderPromptProfileId(null);
    s.setSenderPromptData(null);
    s.setSenderPromptAutoLabels([]);
    s.setSenderPromptNewLabel("");
    s.setSenderPromptUseNewFolder(false);
    s.setSenderPromptNewFolder("");
  }

  function armOptimisticAutoMove(email: Email, targetFolder: string, category: string | undefined) {
    if (
      email.folderPath !== "INBOX" ||
      !targetFolder ||
      targetFolder === "INBOX" ||
      category === "ignore"
    ) {
      return;
    }
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

  async function checkSenderOnOpen(email: Email) {
    if (!email.fromEmail) {
      s.setMatchedSenderRule(null);
      clearSenderPromptForm();
      return;
    }
    try {
      const res = await fetch(
        `/api/sender-profiles/check-sender?email=${encodeURIComponent(email.fromEmail)}`,
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data.matched && data.profile?.id) {
        const profile = data.profile as {
          id: string;
          profileName: string;
          category: string;
          targetFolder: string;
          autoLabels?: string[];
        };
        s.setMatchedSenderRule({
          profileId: profile.id,
          profileName: profile.profileName,
          category: profile.category,
          targetFolder: profile.targetFolder || "",
          autoLabels: profile.autoLabels ?? [],
          fromEmail: email.fromEmail,
        });
        // Keep edit form closed until user clicks "Regel ändern"
        if (s.senderPromptMode !== "edit" || s.senderPromptProfileId !== profile.id) {
          s.setSenderPromptVisible(false);
        }
        armOptimisticAutoMove(email, profile.targetFolder, profile.category);
        return;
      }

      s.setMatchedSenderRule(null);
      // Unknown sender: only prompt once per session
      if (s.checkedSenders.has(email.fromEmail)) {
        clearSenderPromptForm();
        return;
      }
      s.checkedSenders.add(email.fromEmail);
      const domain = email.fromEmail.split("@")[1] ?? "";
      s.setSenderPromptMode("create");
      s.setSenderPromptProfileId(null);
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

  function openMatchedSenderRuleEditor() {
    const rule = s.matchedSenderRule;
    if (!rule) return;
    const domain = rule.fromEmail.split("@")[1] ?? "";
    s.setSenderPromptMode("edit");
    s.setSenderPromptProfileId(rule.profileId);
    s.setSenderPromptData({
      email: rule.fromEmail,
      domain,
      fromName: rule.profileName || "",
    });
    s.setSenderPromptCategory(rule.category || "Sonstiges");
    s.setSenderPromptFolder(rule.targetFolder || "");
    s.setSenderPromptUseNewFolder(false);
    s.setSenderPromptNewFolder("");
    s.setSenderPromptAutoLabels([...(rule.autoLabels ?? [])]);
    s.setSenderPromptNewLabel("");
    s.setSenderPromptVisible(true);
  }

  async function handleSenderPromptSave() {
    if (!s.senderPromptData) return;
    s.setSenderPromptSaving(true);
    s.setUiError("");
    let saved = false;
    try {
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

      for (const labelName of autoLabels) {
        if (!s.labelList.some((l) => l.name === labelName)) {
          await fetch("/api/labels", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: labelName }),
          }).catch(() => {});
        }
      }

      if (s.senderPromptMode === "edit" && s.senderPromptProfileId) {
        const res = await fetch(`/api/sender-profiles/${s.senderPromptProfileId}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            category: s.senderPromptCategory,
            targetFolder,
            autoLabels,
          }),
        });
        if (!res.ok) {
          s.setUiError(await readErrorMessage(res, "Regel konnte nicht aktualisiert werden."));
          return;
        }
        s.setMatchedSenderRule({
          profileId: s.senderPromptProfileId,
          profileName: s.senderPromptData.fromName || s.matchedSenderRule?.profileName || s.senderPromptData.email,
          category: s.senderPromptCategory,
          targetFolder,
          autoLabels,
          fromEmail: s.senderPromptData.email,
        });
        s.setUiInfo(`Regel aktualisiert → ${targetFolder || "kein Ordner"}.`);
        saved = true;

        const currentEmail = s.selectedEmail;
        if (
          currentEmail &&
          currentEmail.folderPath === "INBOX" &&
          targetFolder &&
          targetFolder !== "INBOX" &&
          s.senderPromptCategory !== "ignore"
        ) {
          s.pendingAutoMoveRef.current = { emailId: currentEmail.id, folder: targetFolder };
        } else if (currentEmail && s.pendingAutoMoveRef.current?.emailId === currentEmail.id) {
          s.pendingAutoMoveRef.current = null;
        }
      } else {
        const suggestRes = await fetch("/api/sender-profiles/suggest", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: s.senderPromptData.email, fromName: s.senderPromptData.fromName }),
        });
        const suggestion = suggestRes.ok ? await suggestRes.json() : null;

        const createRes = await fetch("/api/sender-profiles", {
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
        if (!createRes.ok) {
          s.setUiError(await readErrorMessage(createRes, "Absender-Profil konnte nicht erstellt werden."));
          return;
        }
        const created = await createRes.json().catch(() => ({}));
        const profileId = (created as { profile?: { id?: string } }).profile?.id;
        if (profileId) {
          s.setMatchedSenderRule({
            profileId,
            profileName: suggestion?.profileName ?? (s.senderPromptData.fromName || s.senderPromptData.email),
            category: s.senderPromptCategory,
            targetFolder,
            autoLabels,
            fromEmail: s.senderPromptData.email,
          });
        }
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
      }
    } catch {
      s.setUiError(
        s.senderPromptMode === "edit"
          ? "Regel konnte nicht aktualisiert werden."
          : "Absender-Profil konnte nicht erstellt werden.",
      );
    } finally {
      s.setSenderPromptSaving(false);
      if (saved) {
        clearSenderPromptForm();
      }
    }
  }

  function handleSenderPromptSkip() {
    clearSenderPromptForm();
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
    s.setMatchedSenderRule(null);
    clearSenderPromptForm();
  }

  return {
    checkSenderProfileAfterMove,
    handleRememberSenderProfile,
    checkSenderOnOpen,
    openMatchedSenderRuleEditor,
    handleSenderPromptSave,
    handleSenderPromptSkip,
    handleSenderPromptIgnore,
  };
}
