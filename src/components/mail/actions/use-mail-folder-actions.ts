/**
 * Folder management actions.
 */
import { type Folder, readErrorMessage } from "../mail-types";
import type { MailStateReturn } from "../use-mail-state";
import type { MailSyncReturn } from "../use-mail-sync";

export function useMailFolderActions(s: MailStateReturn, sync: MailSyncReturn) {
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

  return {
    manageFolder,
    createFolderPrompt,
    renameFolderPrompt,
    copyFolderPrompt,
    deleteFolderPrompt,
    handleFolderMoveByDrag,
    createMobileMoveFolder,
  };
}
