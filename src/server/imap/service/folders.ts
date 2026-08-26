import { prisma } from "@/server/db/prisma";
import {
  copyImapFolderMessages,
  createImapFolder,
  deleteImapFolder,
  listImapFolders,
  renameImapFolder,
} from "@/server/imap/imapClient";
import { getAccountConfig } from "./account";

/**
 * Synchronises the list of IMAP mailbox folders into the local database.
 *
 * Fetches the full folder tree from the IMAP server and upserts each entry
 * into `MailFolder`. This ensures local state reflects renames, new folders,
 * and flag changes without touching message data.
 *
 * @param accountId - The database ID of the mail account.
 * @param userId - The owning user's ID.
 * @returns The raw list of IMAP folders returned by the server.
 */
export async function syncFolders(accountId: string, userId: string) {
  const { config } = await getAccountConfig(accountId, userId);
  const folders = await listImapFolders(config);

  await Promise.all(
    folders.map((folder) =>
      prisma.mailFolder.upsert({
        where: {
          accountId_path: {
            accountId,
            path: folder.path,
          },
        },
        update: {
          displayName: folder.displayName,
          delimiter: folder.delimiter,
          flags: folder.flags,
        },
        create: {
          accountId,
          path: folder.path,
          displayName: folder.displayName,
          delimiter: folder.delimiter,
          flags: folder.flags,
        },
      }),
    ),
  );

  return folders;
}

/** Strips leading/trailing slashes and whitespace from a folder path. */
function normalizeFolderPath(value: string) {
  return value.trim().replace(/^\/+|\/+$/g, "");
}

/** Guards against destructive operations on system-protected folders (e.g. INBOX). */
async function assertFolderNotProtected(
  folderPath: string,
  kind: "delete" | "rename" | "copy",
) {
  const lower = folderPath.toLowerCase();
  const protectedPaths = new Set(["inbox"]);
  if (protectedPaths.has(lower)) {
    throw new Error(`Ordner "${folderPath}" ist geschützt und kann nicht per ${kind} geändert werden.`);
  }
}

/**
 * Creates a new IMAP folder on the server and syncs the folder list.
 *
 * @param input.accountId - The mail account ID.
 * @param input.userId - The owning user's ID.
 * @param input.folderPath - The desired folder path/name.
 * @returns The updated folder list after creation.
 * @throws If the folder name is empty.
 */
export async function createFolderForAccount(input: {
  accountId: string;
  userId: string;
  folderPath: string;
}) {
  const path = normalizeFolderPath(input.folderPath);
  if (!path) throw new Error("Ordnername darf nicht leer sein.");
  const { config } = await getAccountConfig(input.accountId, input.userId);
  await createImapFolder(config, path);
  return syncFolders(input.accountId, input.userId);
}

/**
 * Deletes an IMAP folder and removes all associated local index data.
 *
 * Protected folders (e.g. INBOX) cannot be deleted. After the IMAP deletion,
 * both the EmailIndex entries and the MailFolder row for this path are purged.
 *
 * @param input.accountId - The mail account ID.
 * @param input.userId - The owning user's ID.
 * @param input.folderPath - The folder to delete.
 * @returns The updated folder list after deletion.
 * @throws If the folder is protected or does not exist.
 */
export async function deleteFolderForAccount(input: {
  accountId: string;
  userId: string;
  folderPath: string;
}) {
  const path = normalizeFolderPath(input.folderPath);
  if (!path) throw new Error("Ordnername darf nicht leer sein.");
  await assertFolderNotProtected(path, "delete");
  const { config } = await getAccountConfig(input.accountId, input.userId);
  await deleteImapFolder(config, path);
  await prisma.emailIndex.deleteMany({ where: { accountId: input.accountId, folderPath: path } });
  await prisma.mailFolder.deleteMany({ where: { accountId: input.accountId, path } });
  return syncFolders(input.accountId, input.userId);
}

/**
 * Renames an IMAP folder and updates all local references (index + folder row).
 *
 * @param input.accountId - The mail account ID.
 * @param input.userId - The owning user's ID.
 * @param input.fromPath - The current folder path.
 * @param input.toPath - The desired new folder path.
 * @returns The updated folder list after renaming.
 * @throws If either path is empty or the source folder is protected.
 */
export async function renameFolderForAccount(input: {
  accountId: string;
  userId: string;
  fromPath: string;
  toPath: string;
}) {
  const fromPath = normalizeFolderPath(input.fromPath);
  const toPath = normalizeFolderPath(input.toPath);
  if (!fromPath || !toPath) throw new Error("Quell- und Zielordner sind erforderlich.");
  await assertFolderNotProtected(fromPath, "rename");
  const { config } = await getAccountConfig(input.accountId, input.userId);
  await renameImapFolder(config, fromPath, toPath);
  await prisma.emailIndex.updateMany({
    where: { accountId: input.accountId, folderPath: fromPath },
    data: { folderPath: toPath },
  });
  await prisma.mailFolder.updateMany({
    where: { accountId: input.accountId, path: fromPath },
    data: { path: toPath, displayName: toPath },
  });
  return syncFolders(input.accountId, input.userId);
}

/**
 * Copies all messages from one IMAP folder into a new target folder.
 *
 * Creates the target folder first, then performs a server-side COPY of all
 * messages. Finally syncs the folder list so the new folder appears locally.
 *
 * @param input.accountId - The mail account ID.
 * @param input.userId - The owning user's ID.
 * @param input.fromPath - The source folder to copy from.
 * @param input.toPath - The target folder to create and copy into.
 * @returns The updated folder list.
 * @throws If either path is empty or the source folder is protected.
 */
export async function copyFolderForAccount(input: {
  accountId: string;
  userId: string;
  fromPath: string;
  toPath: string;
}) {
  const fromPath = normalizeFolderPath(input.fromPath);
  const toPath = normalizeFolderPath(input.toPath);
  if (!fromPath || !toPath) throw new Error("Quell- und Zielordner sind erforderlich.");
  await assertFolderNotProtected(fromPath, "copy");
  const { config } = await getAccountConfig(input.accountId, input.userId);
  await createImapFolder(config, toPath);
  await copyImapFolderMessages(config, fromPath, toPath);
  return syncFolders(input.accountId, input.userId);
}

