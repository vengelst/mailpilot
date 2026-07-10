/**
 * @module syncJob
 *
 * IMAP synchronization job that fetches new or updated emails from a
 * specific folder (or the default INBOX). Supports incremental and full
 * sync modes. Resolves the target folder automatically when none is
 * specified by querying the account's folder list first.
 */

import { FolderSyncResult, syncFolderEmails, syncFolders } from "@/server/imap/imapService";

/** Whether to perform a delta sync or re-fetch all messages from scratch. */
type SyncMode = "incremental" | "full";

type RunSyncJobOptions = {
  mode?: SyncMode;
  /** Callback invoked once the actual folder to sync has been determined. */
  onTargetResolved?: (folderPath: string) => Promise<void> | void;
};

/** Trims whitespace and converts empty/null paths to null. */
function normalizeFolderPath(folderPath?: string | null) {
  const normalized = folderPath?.trim();
  return normalized ? normalized : null;
}

/** Picks INBOX if available; otherwise falls back to the first listed folder. */
function preferredFolderPath(paths: string[]) {
  const inbox = paths.find((path) => path.toLowerCase() === "inbox");
  return inbox ?? paths[0] ?? "INBOX";
}

/**
 * Synchronizes emails from a single IMAP folder for the given account.
 * When no folder is specified, resolves the default folder (prefers INBOX).
 *
 * @param userId - Owner of the mail account
 * @param accountId - Specific email account to sync
 * @param folderPath - Target folder path (null = auto-detect INBOX)
 * @param options - Sync mode and optional progress callback
 * @returns Sync result including new/updated message counts
 */
export async function runSyncJob(
  userId: string,
  accountId: string,
  folderPath?: string | null,
  options?: RunSyncJobOptions,
): Promise<FolderSyncResult> {
  const mode = options?.mode ?? "incremental";
  const requestedFolder = normalizeFolderPath(folderPath);

  // Resolve target: use explicit folder or discover INBOX from the account's folder list
  let targetFolder = requestedFolder;
  if (!targetFolder) {
    const folders = await syncFolders(accountId, userId);
    targetFolder = preferredFolderPath(folders.map((folder) => folder.path));
  }

  await options?.onTargetResolved?.(targetFolder);
  return syncFolderEmails(accountId, userId, targetFolder, 100, { mode });
}
