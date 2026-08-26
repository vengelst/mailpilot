/**
 * Attachment and print actions.
 */
import { readErrorMessage } from "../mail-types";
import type { MailStateReturn } from "../use-mail-state";
import type { MailSyncReturn } from "../use-mail-sync";

export function useMailAttachmentActions(s: MailStateReturn, sync: MailSyncReturn) {
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

  return {
    getAttachmentTarget,
    updateAttachmentTarget,
    saveAttachmentToCloud,
    saveAttachmentToCloudForEmail,
    openAttachment,
    printAttachment,
    printSelectedEmail,
  };
}
