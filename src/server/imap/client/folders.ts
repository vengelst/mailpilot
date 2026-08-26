import type { ImapAccountConfig, ImapFolderInfo } from "../types";
import { buildClient } from "./buildClient";
import { detectSpecialUse } from "./helpers";

/**
 * Verify that the IMAP credentials are valid by connecting and opening INBOX.
 *
 * @param config - IMAP account credentials
 * @returns `{ ok: true }` on success; throws on authentication/connection failure
 */
export async function testImapConnection(config: ImapAccountConfig) {
  const client = buildClient(config);
  try {
    await client.connect();
    await client.mailboxOpen("INBOX");
    return { ok: true };
  } finally {
    if (client.usable) {
      await client.logout();
    }
  }
}

/**
 * List all folders (mailboxes) on the IMAP server with their flags and
 * detected special-use role.
 *
 * @param config - IMAP account credentials
 * @returns Array of folder info objects
 */
export async function listImapFolders(config: ImapAccountConfig): Promise<ImapFolderInfo[]> {
  const client = buildClient(config);
  try {
    await client.connect();
    const list = await client.list();
    return list.map((folder) => {
      const flags = Array.from(folder.flags || []);
      return {
        path: folder.path,
        displayName: folder.name || folder.path,
        delimiter: folder.delimiter,
        flags,
        specialUse: detectSpecialUse(folder.path, flags),
      };
    });
  } finally {
    if (client.usable) {
      await client.logout();
    }
  }
}

/**
 * Create a new folder (mailbox) on the IMAP server.
 *
 * @param config - IMAP account credentials
 * @param folderPath - Full path of the folder to create (e.g. "INBOX/Projects")
 */
export async function createImapFolder(
  config: ImapAccountConfig,
  folderPath: string,
): Promise<void> {
  const client = buildClient(config);
  try {
    await client.connect();
    await client.mailboxCreate(folderPath);
  } finally {
    if (client.usable) {
      await client.logout();
    }
  }
}

/**
 * Permanently delete a folder (mailbox) from the IMAP server.
 *
 * @param config - IMAP account credentials
 * @param folderPath - Full path of the folder to delete
 */
export async function deleteImapFolder(
  config: ImapAccountConfig,
  folderPath: string,
): Promise<void> {
  const client = buildClient(config);
  try {
    await client.connect();
    await client.mailboxDelete(folderPath);
  } finally {
    if (client.usable) {
      await client.logout();
    }
  }
}

/**
 * Rename (move) a folder on the IMAP server.
 *
 * @param config - IMAP account credentials
 * @param fromPath - Current folder path
 * @param toPath - Desired new folder path
 */
export async function renameImapFolder(
  config: ImapAccountConfig,
  fromPath: string,
  toPath: string,
): Promise<void> {
  const client = buildClient(config);
  try {
    await client.connect();
    await client.mailboxRename(fromPath, toPath);
  } finally {
    if (client.usable) {
      await client.logout();
    }
  }
}

/**
 * Copy all messages from one folder to another (server-side COPY).
 *
 * @param config - IMAP account credentials
 * @param sourcePath - Folder to copy messages from
 * @param targetPath - Folder to copy messages into
 */
export async function copyImapFolderMessages(
  config: ImapAccountConfig,
  sourcePath: string,
  targetPath: string,
): Promise<void> {
  const client = buildClient(config);
  try {
    await client.connect();
    const mailbox = await client.mailboxOpen(sourcePath);
    const exists = mailbox.exists ?? 0;
    if (exists > 0) {
      await client.messageCopy("1:*", targetPath, { uid: false });
    }
  } finally {
    if (client.usable) {
      await client.logout();
    }
  }
}

