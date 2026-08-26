/**
 * Action hook for the mail workspace. Provides functions for email actions
 * (bulk, single, spam), attachment handling, compose, label management,
 * sender profiles, folder management, and automation dashboard operations.
 *
 * Implementation is split under `./actions/`; this file composes the same
 * `MailActionsReturn` shape as before.
 */

import type { MailStateReturn } from "./use-mail-state";
import type { MailSyncReturn } from "./use-mail-sync";
import { useMailCoreActions } from "./actions/use-mail-core-actions";
import { useMailSpamActions } from "./actions/use-mail-spam-actions";
import { useMailFolderActions } from "./actions/use-mail-folder-actions";
import { useMailAttachmentActions } from "./actions/use-mail-attachment-actions";
import { useMailLabelActions } from "./actions/use-mail-label-actions";
import { useMailSenderActions } from "./actions/use-mail-sender-actions";
import { useMailComposeActions } from "./actions/use-mail-compose-actions";
import { useMailMiscActions } from "./actions/use-mail-misc-actions";

export function useMailActions(s: MailStateReturn, sync: MailSyncReturn) {
  const core = useMailCoreActions(s, sync);
  const spam = useMailSpamActions(s, core);
  const folder = useMailFolderActions(s, sync);
  const attachment = useMailAttachmentActions(s, sync);
  const labels = useMailLabelActions(s, sync);
  const sender = useMailSenderActions(s, sync, core, labels);
  const compose = useMailComposeActions(s);
  const misc = useMailMiscActions(s, sync, core);

  return {
    runActionForEmail: core.runActionForEmail,
    runAction: core.runAction,
    runBulk: core.runBulk,
    emptyCurrentFolder: core.emptyCurrentFolder,
    markAsSpamAndLearn: spam.markAsSpamAndLearn,
    markAsNotSpam: spam.markAsNotSpam,
    blockSender: spam.blockSender,
    blockDomain: spam.blockDomain,
    setLocalFlag: core.setLocalFlag,
    moveToSelectedFolder: core.moveToSelectedFolder,
    manageFolder: folder.manageFolder,
    createFolderPrompt: folder.createFolderPrompt,
    renameFolderPrompt: folder.renameFolderPrompt,
    copyFolderPrompt: folder.copyFolderPrompt,
    deleteFolderPrompt: folder.deleteFolderPrompt,
    handleFolderMoveByDrag: folder.handleFolderMoveByDrag,
    createMobileMoveFolder: folder.createMobileMoveFolder,
    getAttachmentTarget: attachment.getAttachmentTarget,
    updateAttachmentTarget: attachment.updateAttachmentTarget,
    saveAttachmentToCloud: attachment.saveAttachmentToCloud,
    saveAttachmentToCloudForEmail: attachment.saveAttachmentToCloudForEmail,
    openAttachment: attachment.openAttachment,
    printAttachment: attachment.printAttachment,
    printSelectedEmail: attachment.printSelectedEmail,
    addLabelToEmail: labels.addLabelToEmail,
    removeLabelFromEmail: labels.removeLabelFromEmail,
    createAndAddLabel: labels.createAndAddLabel,
    checkSenderProfileAfterMove: sender.checkSenderProfileAfterMove,
    handleRememberSenderProfile: sender.handleRememberSenderProfile,
    checkSenderOnOpen: sender.checkSenderOnOpen,
    openMatchedSenderRuleEditor: sender.openMatchedSenderRuleEditor,
    handleSenderPromptSave: sender.handleSenderPromptSave,
    handleSenderPromptSkip: sender.handleSenderPromptSkip,
    handleSenderPromptIgnore: sender.handleSenderPromptIgnore,
    openCompose: compose.openCompose,
    composeNewMail: compose.composeNewMail,
    replyToSelected: compose.replyToSelected,
    forwardSelected: compose.forwardSelected,
    replyAllSelected: compose.replyAllSelected,
    applyComposeCommand: compose.applyComposeCommand,
    submitCompose: compose.submitCompose,
    insertSignatureHtml: compose.insertSignatureHtml,
    createContactSuggestion: misc.createContactSuggestion,
    copyEmailsToClipboard: misc.copyEmailsToClipboard,
    logout: misc.logout,
    saveAutomationDashboardSettings: misc.saveAutomationDashboardSettings,
    runAutomationNow: misc.runAutomationNow,
  };
}

export type MailActionsReturn = ReturnType<typeof useMailActions>;
