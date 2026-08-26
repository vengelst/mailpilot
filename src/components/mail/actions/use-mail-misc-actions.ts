/**
 * Misc actions: contacts, clipboard, logout, automation dashboard.
 */
import { useRouter } from "next/navigation";
import { type Email, readErrorMessage, senderDisplayName } from "../mail-types";
import type { MailStateReturn } from "../use-mail-state";
import type { MailSyncReturn } from "../use-mail-sync";

type CoreDeps = {
  runAction: (path: string, payload?: object) => Promise<void>;
};

export function useMailMiscActions(s: MailStateReturn, sync: MailSyncReturn, core: CoreDeps) {
  const router = useRouter();
  const { runAction } = core;

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
        s.setNewMailCheckIntervalMinutes(Math.max(1, Math.round(data.settings.runIntervalMinutes)));
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
    createContactSuggestion,
    copyEmailsToClipboard,
    logout,
    saveAutomationDashboardSettings,
    runAutomationNow,
  };
}
