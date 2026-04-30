import { FolderSyncResult, syncFolderEmails, syncFolders } from "@/server/imap/imapService";

type SyncMode = "incremental" | "full";

type RunSyncJobOptions = {
  mode?: SyncMode;
  onTargetResolved?: (folderPath: string) => Promise<void> | void;
};

function normalizeFolderPath(folderPath?: string | null) {
  const normalized = folderPath?.trim();
  return normalized ? normalized : null;
}

function preferredFolderPath(paths: string[]) {
  const inbox = paths.find((path) => path.toLowerCase() === "inbox");
  return inbox ?? paths[0] ?? "INBOX";
}

export async function runSyncJob(
  userId: string,
  accountId: string,
  folderPath?: string | null,
  options?: RunSyncJobOptions,
): Promise<FolderSyncResult> {
  const mode = options?.mode ?? "incremental";
  const requestedFolder = normalizeFolderPath(folderPath);

  let targetFolder = requestedFolder;
  if (!targetFolder) {
    const folders = await syncFolders(accountId, userId);
    targetFolder = preferredFolderPath(folders.map((folder) => folder.path));
  }

  await options?.onTargetResolved?.(targetFolder);
  return syncFolderEmails(accountId, userId, targetFolder, 100, { mode });
}
