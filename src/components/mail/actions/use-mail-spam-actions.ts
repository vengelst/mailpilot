/**
 * Spam and blocklist actions.
 */
import { type Email, readErrorMessage } from "../mail-types";
import type { MailStateReturn } from "../use-mail-state";

type CoreDeps = {
  runActionForEmail: (emailId: string, path: string, payload?: object) => Promise<void>;
};

export function useMailSpamActions(s: MailStateReturn, core: CoreDeps) {
  const { runActionForEmail } = core;

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

  return {
    markAsSpamAndLearn,
    markAsNotSpam,
    blockSender,
    blockDomain,
  };
}
