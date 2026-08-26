import { prisma } from "@/server/db/prisma";
import {
  type ImapAccountConfig,
  downloadAttachmentPart,
  fetchMessageBody,
  moveMessageDirect,
  moveMessageToSpecialFolder,
  resolveUidByMessageId,
  searchUidBySubjectDate,
  setMessageSeen,
} from "@/server/imap/imapClient";
import { getAccountConfig } from "./account";

/**
 * Sets or removes the \Seen flag on an email via IMAP.
 *
 * @param emailId - The local EmailIndex row ID.
 * @param userId - The owning user's ID (access control).
 * @param seen - `true` to mark as read, `false` to mark as unread.
 * @throws If the email does not exist or does not belong to the user.
 */
export async function markEmailSeen(emailId: string, userId: string, seen: boolean) {
  const email = await prisma.emailIndex.findFirst({
    where: {
      id: emailId,
      account: { userId },
    },
    include: { account: true },
  });
  if (!email) throw new Error("Email not found");

  const { config } = await getAccountConfig(email.accountId, userId);
  await setMessageSeen(config, email.folderPath, email.imapUid, seen);
}

/**
 * Moves an email to a specific target folder using IMAP MOVE.
 *
 * @param emailId - The local EmailIndex row ID.
 * @param userId - The owning user's ID.
 * @param targetFolder - The IMAP folder path to move the message into.
 * @returns The new UID assigned by the destination folder, or null if unknown.
 * @throws If the email does not exist or does not belong to the user.
 */
export async function moveIndexedEmail(emailId: string, userId: string, targetFolder: string): Promise<bigint | null> {
  const email = await prisma.emailIndex.findFirst({
    where: { id: emailId, account: { userId } },
  });
  if (!email) throw new Error("Email not found");
  const { config } = await getAccountConfig(email.accountId, userId);
  const newUid = await moveMessageDirect(config, email.folderPath, email.imapUid, targetFolder);
  return newUid;
}

/**
 * Moves an email to a special-use folder (Trash or Spam) using IMAP.
 *
 * The target folder is resolved via the server's special-use attributes,
 * so it works regardless of the provider's naming convention.
 *
 * @param emailId - The local EmailIndex row ID.
 * @param userId - The owning user's ID.
 * @param target - Either "trash" or "spam".
 * @returns The resolved folder path and the new UID (if the server reports it).
 * @throws If the email does not exist or does not belong to the user.
 */
export async function moveIndexedEmailToSpecial(
  emailId: string,
  userId: string,
  target: "trash" | "spam" | "inbox",
): Promise<{ path: string; newUid: bigint | null }> {
  const email = await prisma.emailIndex.findFirst({
    where: { id: emailId, account: { userId } },
  });
  if (!email) throw new Error("Email not found");
  const { config } = await getAccountConfig(email.accountId, userId);
  return moveMessageToSpecialFolder(config, email.folderPath, email.imapUid, target);
}

/**
 * Body loader with EmailIndex-side cache.
 *
 *  - If `EmailIndex.bodyFetchedAt` is set and `force !== true`, return the
 *    cached `{ text, html, textFromHtml }` without touching IMAP.
 *  - Otherwise fetch from IMAP (`fetchMessageBody`), persist text/html/plain
 *    on the index row, and return the same shape.
 *
 * IMAP stays the source of truth; the cache is opportunistic. Pass
 * `{ force: true }` to bypass the cache (e.g. when the user explicitly
 * requests a refresh). NEVER touch IMAP messages — read-only fetch only.
 */
/**
 * Attempts to resolve the correct IMAP UID for a message whose stored UID
 * may have become stale (e.g. after server-side compaction or UIDVALIDITY
 * change that was missed).
 *
 * Strategy:
 *   1. Try matching by RFC-822 Message-ID header (most reliable).
 *   2. Fall back to SEARCH by subject + date (heuristic).
 *   3. Return null if neither method yields a result.
 *
 * @param config - Decrypted IMAP connection config.
 * @param email - The locally stored email metadata with potential UID.
 * @returns The resolved UID, or null if the message cannot be located.
 */
async function resolveCorrectUid(
  config: ImapAccountConfig,
  email: { messageId: string | null; folderPath: string; imapUid: bigint; subject?: string | null; date?: Date | null },
): Promise<bigint | null> {
  if (email.messageId) {
    const uid = await resolveUidByMessageId(config, email.folderPath, email.messageId);
    if (uid) return uid;
  }

  if (email.subject && email.date) {
    const uid = await searchUidBySubjectDate(config, email.folderPath, email.subject, email.date);
    if (uid) return uid;
  }

  return null;
}

/**
 * Loads the full message body (text, HTML, plain) for a given email.
 *
 * Implements a local cache: if the body was previously fetched and stored in
 * `EmailIndex.bodyFetchedAt`, the cached version is returned without IMAP access.
 * Pass `options.force` to bypass the cache and re-fetch from IMAP.
 *
 * If the initial fetch returns empty content (possibly due to a stale UID),
 * a UID re-resolution is attempted before giving up.
 *
 * @param emailId - The local EmailIndex row ID.
 * @param userId - The owning user's ID.
 * @param options.force - If true, always fetch from IMAP regardless of cache state.
 * @returns The body content (text, html, textFromHtml) and whether it was served from cache.
 * @throws If the email does not exist or does not belong to the user.
 */
export async function loadMessageBody(
  emailId: string,
  userId: string,
  options?: { force?: boolean },
) {
  const email = await prisma.emailIndex.findFirst({
    where: { id: emailId, account: { userId } },
    select: {
      id: true,
      accountId: true,
      folderPath: true,
      imapUid: true,
      messageId: true,
      subject: true,
      date: true,
      bodyText: true,
      bodyHtml: true,
      bodyPlain: true,
      bodyFetchedAt: true,
    },
  });
  if (!email) throw new Error("Email not found");

  // Cache hit: return stored body without IMAP round-trip
  const cachedEmpty = email.bodyFetchedAt && !email.bodyHtml && !email.bodyText;
  if (!options?.force && email.bodyFetchedAt && !cachedEmpty) {
    return {
      text: email.bodyText ?? "",
      html: email.bodyHtml ?? "",
      textFromHtml: email.bodyPlain ?? email.bodyText ?? "",
      cached: true,
    };
  }

  const { config } = await getAccountConfig(email.accountId, userId);

  let body = await fetchMessageBody(config, email.folderPath, email.imapUid);

  // Fallback: if body is empty, the stored UID may be stale — try to re-resolve
  if (!body.text && !body.html) {
    const resolvedUid = await resolveCorrectUid(config, email);
    if (resolvedUid && resolvedUid !== email.imapUid) {
      console.log(`[loadMessageBody] UID resolved: ${email.imapUid} → ${resolvedUid}`);
      try {
        await prisma.emailIndex.update({
          where: { id: email.id },
          data: { imapUid: resolvedUid },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        if (msg.includes("Unique constraint")) {
          await prisma.emailIndex.delete({ where: { id: email.id } });
          console.log(`[loadMessageBody] Deleted stale duplicate entry ${email.id}`);
        } else {
          throw e;
        }
      }
      body = await fetchMessageBody(config, email.folderPath, resolvedUid);
    }
  }

  await prisma.emailIndex.update({
    where: { id: email.id },
    data: {
      bodyText: body.text || null,
      bodyHtml: body.html || null,
      bodyPlain: body.textFromHtml || null,
      bodyFetchedAt: new Date(),
    },
  });
  return { ...body, cached: false };
}

/**
 * Downloads a specific attachment's binary content from IMAP.
 *
 * @param userId - The owning user's ID.
 * @param emailId - The local EmailIndex row ID.
 * @param attachmentId - The local EmailAttachment row ID.
 * @returns The email record, attachment metadata, and raw binary content.
 * @throws If the email, attachment, or IMAP part ID is not found.
 */
export async function loadAttachmentContent(
  userId: string,
  emailId: string,
  attachmentId: string,
) {
  const email = await prisma.emailIndex.findFirst({
    where: { id: emailId, account: { userId } },
    include: {
      attachments: true,
    },
  });
  if (!email) throw new Error("Email not found");

  const attachment = email.attachments.find((item) => item.id === attachmentId);
  if (!attachment) throw new Error("Attachment not found");
  if (!attachment.imapPartId) throw new Error("Attachment part not available on IMAP");

  const { config } = await getAccountConfig(email.accountId, userId);
  const content = await downloadAttachmentPart(config, email.folderPath, email.imapUid, attachment.imapPartId);

  return { email, attachment, content };
}

