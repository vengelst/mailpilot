/**
 * IMAP Service Layer
 *
 * High-level orchestration between the IMAP protocol client (`imapClient`)
 * and the Prisma database layer. This module owns:
 *   - Account credential resolution and decryption
 *   - Folder CRUD (create, rename, copy, delete) with local DB bookkeeping
 *   - Incremental and full email synchronisation (envelope + flags; bodies on demand)
 *   - Message operations: mark read/unread, move, bulk actions
 *   - Attachment download
 *   - Permanent purge of Trash/Spam folders (the only destructive IMAP path)
 *
 * All IMAP interactions go through `imapClient` helpers; this module never
 * opens raw TCP sockets itself.
 *
 * Implementation is split under `./service/`; this file re-exports the public API.
 */

export { SyncBusyError } from "./service/syncLock";
export { getAccountConfig, testAccountConnection } from "./service/account";
export {
  syncFolders,
  createFolderForAccount,
  deleteFolderForAccount,
  renameFolderForAccount,
  copyFolderForAccount,
} from "./service/folders";
export type { FolderSyncResult } from "./service/syncEmails";
export {
  syncFolderEmailsFull,
  syncFolderEmailsIncremental,
  syncFolderEmails,
} from "./service/syncEmails";
export {
  markEmailSeen,
  moveIndexedEmail,
  moveIndexedEmailToSpecial,
  loadMessageBody,
  loadAttachmentContent,
} from "./service/messages";
export type { BulkAction, BulkOutcome } from "./service/bulk";
export { runBulkEmailAction } from "./service/bulk";
export { emptyTrashOrSpamFolder } from "./service/purge";
