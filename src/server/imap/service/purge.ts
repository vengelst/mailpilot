import { prisma } from "@/server/db/prisma";
import {
  listImapFolders,
  purgeFolderMessages,
} from "@/server/imap/imapClient";
import { getAccountConfig } from "./account";

const TRASH_PATH_PATTERNS = [
  /trash/i,
  /papierkorb/i,
  /deleted/i,
  /gel(ö|oe)scht/i,
  /\bbin\b/i,
];
const SPAM_PATH_PATTERNS = [/spam/i, /junk/i, /unerw(ü|ue)nscht/i, /werbung/i];
const TRASH_FLAGS = new Set(["\\Trash"]);
const SPAM_FLAGS = new Set(["\\Junk"]);

/**
 * Classifies a folder as "trash", "spam", or neither based on IMAP flags,
 * special-use attributes, and well-known path naming conventions (multilingual).
 */
function classifyFolderForPurge(
  folder: { path: string; flags?: string[] | null; specialUse?: string },
): "trash" | "spam" | null {
  const flags = folder.flags ?? [];
  const special = folder.specialUse ?? "";
  if (special === "trash" || flags.some((f) => TRASH_FLAGS.has(f))) return "trash";
  if (special === "spam" || flags.some((f) => SPAM_FLAGS.has(f))) return "spam";
  if (TRASH_PATH_PATTERNS.some((re) => re.test(folder.path))) return "trash";
  if (SPAM_PATH_PATTERNS.some((re) => re.test(folder.path))) return "spam";
  return null;
}

/**
 * Permanently delete every message in the given folder — but ONLY if the
 * folder unambiguously is the user's Trash or Spam mailbox. Used by the
 * dedicated `/api/folders/empty` endpoint after explicit user confirm.
 *
 * Throws if:
 *   - the account does not belong to the user
 *   - the folder does not exist on the IMAP server for this account
 *   - the folder is NOT classified as trash/spam — never EXPUNGE INBOX
 *
 * The actual `\Deleted` + EXPUNGE happens in `purgeFolderMessages` which
 * is the single place in the codebase allowed to do that.
 */
export async function emptyTrashOrSpamFolder(input: {
  accountId: string;
  userId: string;
  folderPath: string;
}): Promise<{ kind: "trash" | "spam"; deleted: number }> {
  const { config } = await getAccountConfig(input.accountId, input.userId);
  const folders = await listImapFolders(config);
  const folder = folders.find((f) => f.path === input.folderPath);
  if (!folder) {
    throw new Error("Ordner existiert nicht für diesen Account.");
  }
  const kind = classifyFolderForPurge({
    path: folder.path,
    flags: folder.flags,
    specialUse: folder.specialUse,
  });
  if (!kind) {
    throw new Error(
      "Endgültiges Leeren ist nur für Papierkorb- oder Spam-Ordner erlaubt.",
    );
  }

  const { deleted } = await purgeFolderMessages(config, folder.path);

  // Drop the local index for this folder — the rows now refer to mails that
  // no longer exist on the server.
  await prisma.emailIndex.deleteMany({
    where: { accountId: input.accountId, folderPath: folder.path },
  });
  // Reset the folder-level UID tracking so a follow-up sync starts clean.
  await prisma.mailFolder.updateMany({
    where: { accountId: input.accountId, path: folder.path },
    data: {
      lastSeenUid: BigInt(0),
      lastSyncedAt: new Date(),
      existsCount: 0,
    },
  });

  return { kind, deleted };
}
