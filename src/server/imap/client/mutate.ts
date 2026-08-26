import type { ImapAccountConfig, BulkMoveResult } from "../types";
import { buildClient } from "./buildClient";
import { listImapFolders } from "./folders";

/**
 * Add or remove the \Seen flag on a single message.
 *
 * @param config - IMAP account credentials
 * @param folderPath - Folder containing the message
 * @param uid - Message UID
 * @param seen - true to mark as read, false to mark as unread
 */
export async function setMessageSeen(
  config: ImapAccountConfig,
  folderPath: string,
  uid: bigint,
  seen: boolean,
) {
  const client = buildClient(config);
  const range = uid.toString();
  try {
    await client.connect();
    await client.mailboxOpen(folderPath);
    if (seen) {
      await client.messageFlagsAdd(range, ["\\Seen"], { uid: true });
    } else {
      await client.messageFlagsRemove(range, ["\\Seen"], { uid: true });
    }
  } finally {
    if (client.usable) {
      await client.logout();
    }
  }
}

/**
 * Move a single message to a target folder with folder-existence validation.
 * Returns the new UID assigned in the target folder (if the server reports it).
 *
 * @param config - IMAP account credentials
 * @param fromFolder - Source folder path
 * @param uid - Message UID in the source folder
 * @param targetFolder - Destination folder path
 * @returns New UID in the target folder, or null if the server didn't report it
 */
export async function moveMessage(
  config: ImapAccountConfig,
  fromFolder: string,
  uid: bigint,
  targetFolder: string,
): Promise<bigint | null> {
  const client = buildClient(config);
  try {
    await client.connect();
    const folders = await client.list();
    // Validate that the target folder actually exists before attempting the move
    const exists = folders.some((f) => f.path.toLowerCase() === targetFolder.toLowerCase());
    if (!exists) {
      throw new Error(`Target folder '${targetFolder}' does not exist on IMAP server`);
    }
    await client.mailboxOpen(fromFolder);
    const result = await client.messageMove(uid.toString(), targetFolder, { uid: true });
    // uidMap maps old UID → new UID in the destination folder (RFC 4315 UIDPLUS)
    if (result && result.uidMap) {
      const newUid = result.uidMap.get(Number(uid));
      if (newUid) return BigInt(newUid);
    }
    return null;
  } finally {
    if (client.usable) {
      await client.logout();
    }
  }
}

/**
 * Move a single message without redundant folder validation.
 * The caller is responsible for ensuring targetFolder exists (e.g. via
 * listImapFolders / resolveSpecialFolderPath).
 */
export async function moveMessageDirect(
  config: ImapAccountConfig,
  fromFolder: string,
  uid: bigint,
  targetFolder: string,
): Promise<bigint | null> {
  const client = buildClient(config);
  try {
    await client.connect();
    await client.mailboxOpen(fromFolder);
    const result = await client.messageMove(uid.toString(), targetFolder, { uid: true });
    if (result && result.uidMap) {
      const newUid = result.uidMap.get(Number(uid));
      if (newUid) return BigInt(newUid);
    }
    return null;
  } finally {
    if (client.usable) {
      await client.logout();
    }
  }
}

/**
 * Move a message to a special-use folder (trash or spam) by auto-detecting
 * the target folder path from the server's folder list.
 *
 * @param config - IMAP account credentials
 * @param fromFolder - Source folder path
 * @param uid - Message UID
 * @param type - Target special-use role ("trash" or "spam")
 * @returns The resolved target path and the new UID (if reported)
 */
export async function moveMessageToSpecialFolder(
  config: ImapAccountConfig,
  fromFolder: string,
  uid: bigint,
  type: "trash" | "spam" | "inbox",
): Promise<{ path: string; newUid: bigint | null }> {
  const folders = await listImapFolders(config);
  const target = type === "inbox"
    ? folders.find((folder) => folder.specialUse === "inbox") ?? folders.find((folder) => /^inbox$/i.test(folder.path))
    : folders.find((folder) => folder.specialUse === type);
  if (!target) {
    throw new Error(`No ${type} folder found on IMAP server`);
  }
  const newUid = await moveMessageDirect(config, fromFolder, uid, target.path);
  return { path: target.path, newUid };
}

/**
 * Resolve the path of a special-use folder (trash/spam).
 * Uses a single IMAP connection via listImapFolders.
 */
export async function resolveSpecialFolderPath(
  config: ImapAccountConfig,
  type: "trash" | "spam",
): Promise<string> {
  const folders = await listImapFolders(config);
  const target = folders.find((folder) => folder.specialUse === type);
  if (!target) throw new Error(`No ${type} folder found on IMAP server`);
  return target.path;
}

/**
 * Move multiple messages to a target folder using a SINGLE IMAP connection.
 * Groups messages by source folder and executes one MOVE command per group.
 */
export async function bulkMoveMessages(
  config: ImapAccountConfig,
  messages: Array<{ uid: bigint; fromFolder: string }>,
  targetFolder: string,
): Promise<BulkMoveResult> {
  const result: BulkMoveResult = { moved: [], failed: [] };
  if (messages.length === 0) return result;

  const client = buildClient(config);
  try {
    await client.connect();

    // Group messages by source folder to minimize mailbox-open calls
    const byFolder = new Map<string, bigint[]>();
    for (const msg of messages) {
      const list = byFolder.get(msg.fromFolder) ?? [];
      list.push(msg.uid);
      byFolder.set(msg.fromFolder, list);
    }

    for (const [fromFolder, uids] of byFolder) {
      try {
        await client.mailboxOpen(fromFolder);
        const uidList = uids.map((u) => u.toString()).join(",");
        await client.messageMove(uidList, targetFolder, { uid: true });
        result.moved.push(...uids);
      } catch (err) {
        const reason = err instanceof Error ? err.message : "IMAP move failed";
        for (const uid of uids) {
          result.failed.push({ uid, fromFolder, error: reason });
        }
      }
    }
  } finally {
    if (client.usable) await client.logout();
  }
  return result;
}

