/**
 * IMAP Client Module
 *
 * Provides a low-level abstraction over the ImapFlow library for all IMAP
 * operations used by MailPilot: connecting to accounts, listing/managing
 * folders, fetching message metadata and bodies, moving/deleting messages,
 * downloading attachments, and performing UID-based searches.
 *
 * Each exported function manages its own connection lifecycle (connect → operate → logout).
 * For multi-step operations that should share a single TLS connection, use `withImapSession`.
 *
 * Implementation is split under `./client/` and `./types`; this file re-exports
 * the public API for stable `@/server/imap/imapClient` imports.
 */

export type {
  ImapAccountConfig,
  ImapFolderInfo,
  ImapAttachmentMeta,
  ImapMessageMeta,
  ImapSession,
  ImapMailboxStatus,
  BulkMoveResult,
  ImapMessageBody,
} from "./types";

export { withImapSession } from "./client/session";

export {
  testImapConnection,
  listImapFolders,
  createImapFolder,
  deleteImapFolder,
  renameImapFolder,
  copyImapFolderMessages,
} from "./client/folders";

export {
  getMailboxStatus,
  fetchFlagsByUidRange,
  fetchFolderMessages,
  fetchMessagesByUidRange,
  purgeFolderMessages,
  fetchFolderMessagesPaged,
} from "./client/fetch";

export {
  setMessageSeen,
  moveMessage,
  moveMessageDirect,
  moveMessageToSpecialFolder,
  resolveSpecialFolderPath,
  bulkMoveMessages,
} from "./client/mutate";

export {
  fetchMessageBody,
  resolveUidByMessageId,
  searchUidBySubjectDate,
  downloadAttachmentPart,
} from "./client/body";
