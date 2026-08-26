/**
 * Label management actions.
 */
import type { MailStateReturn } from "../use-mail-state";
import type { MailSyncReturn } from "../use-mail-sync";

export function useMailLabelActions(s: MailStateReturn, sync: MailSyncReturn) {
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

  return {
    addLabelToEmail,
    removeLabelFromEmail,
    createAndAddLabel,
  };
}
