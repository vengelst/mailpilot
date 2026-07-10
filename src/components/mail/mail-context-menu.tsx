/**
 * Right-click context menu for email list items. Supports single and bulk
 * actions: read/unread, trash, spam, move to folder, attachment quick-actions,
 * copy, print, reply, and forward.
 */

import {
  getAttachmentDisplayName,
  senderDisplayName,
} from "./mail-types";
import type { MailStateReturn } from "./use-mail-state";
import type { MailActionsReturn } from "./use-mail-actions";
import type { MailSyncReturn } from "./use-mail-sync";

type Props = {
  s: MailStateReturn;
  actions: MailActionsReturn;
  sync: MailSyncReturn;
};

export function MailContextMenu({ s, actions, sync }: Props) {
  if (!s.mailContextMenu || !s.contextMenuEmail) return null;

  const email = s.contextMenuEmail;
  const targetIds = s.contextMenuTargetIds;
  const isBulk = s.contextMenuIsBulk;
  const attachments = s.contextMenuAttachments;
  const selectedAtt = s.selectedContextAttachment;

  function close() {
    s.setMailContextMenu(null);
  }

  return (
    <div className="fixed inset-0 z-40" onClick={close}>
      <div
        role="menu"
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
        className="glass-solid fixed z-50 w-[320px] rounded-xl p-2"
        style={{
          left: Math.max(8, Math.min(s.mailContextMenu.x, window.innerWidth - 328)),
          top: Math.max(8, Math.min(s.mailContextMenu.y, window.innerHeight - 420)),
        }}
      >
        <p className="border-b glass-divider px-2 pb-1 text-xs glass-text-muted">
          {isBulk
            ? `${targetIds.length} Mails ausgewählt`
            : senderDisplayName(email)}
        </p>
        {!isBulk ? (
          <>
            <button
              className="mt-1 block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-gray-50"
              onClick={() => { actions.openCompose("reply", email); close(); }}
            >
              Antworten
            </button>
            <button
              className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-gray-50"
              onClick={() => { actions.openCompose("forward", email); close(); }}
            >
              Weiterleiten
            </button>
            <button
              className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-gray-50"
              onClick={() => {
                window.open(`/api/emails/${email.id}/print`, "_blank");
                close();
              }}
            >
              Mail drucken
            </button>
          </>
        ) : null}

        <div className="my-1 border-t border-gray-100" />

        <button
          className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-gray-50"
          onClick={() => {
            if (isBulk) {
              void actions.runBulk("mark_read", undefined, targetIds);
            } else {
              void actions.runActionForEmail(email.id, `/api/emails/${email.id}/mark-read`);
            }
            close();
          }}
        >
          Als gelesen markieren
        </button>
        <button
          className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-gray-50"
          onClick={() => {
            if (isBulk) {
              void actions.runBulk("mark_unread", undefined, targetIds);
            } else {
              void actions.runActionForEmail(email.id, `/api/emails/${email.id}/mark-unread`);
            }
            close();
          }}
        >
          Als ungelesen markieren
        </button>

        <div className="my-1 border-t border-gray-100" />

        <button
          className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-gray-50"
          onClick={() => {
            if (isBulk) {
              void actions.runBulk("move_trash", undefined, targetIds);
            } else {
              void actions.runActionForEmail(email.id, `/api/emails/${email.id}/move`, {
                targetSpecial: "trash",
              });
            }
            close();
          }}
        >
          In den Papierkorb
        </button>
        {!isBulk ? (
          <button
            className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-gray-50"
            onClick={() => {
              void actions.markAsSpamAndLearn(email);
              close();
            }}
          >
            Als Spam lernen (Absender + Inhalt)
          </button>
        ) : (
          <button
            className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-gray-50"
            onClick={() => {
              void actions.runBulk("move_spam", undefined, targetIds);
              close();
            }}
          >
            In Spam verschieben
          </button>
        )}

        <button
          className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-gray-50"
          onClick={() => {
            void actions.copyEmailsToClipboard(targetIds);
            close();
          }}
        >
          Kopieren
        </button>

        <div className="my-1 border-t border-gray-100 pt-1">
          <p className="px-2 text-xs glass-text-muted">Verschieben in Ordner</p>
          <div className="mt-1 flex gap-1 px-1">
            <select
              value={s.contextMoveTargetFolder}
              onChange={(e) => s.setContextMoveTargetFolder(e.target.value)}
              className="glass-select w-full rounded-lg px-2 py-1 text-xs"
            >
              <option value="">Ordner wählen…</option>
              {s.folders.map((folder) => (
                <option key={folder.path} value={folder.path}>
                  {folder.displayName}
                </option>
              ))}
            </select>
            <button
              disabled={!s.contextMoveTargetFolder}
              className="glass-btn rounded-lg px-2 py-1 text-xs disabled:opacity-50"
              onClick={() => {
                if (!s.contextMoveTargetFolder) return;
                if (isBulk) {
                  void actions.runBulk(
                    "move_folder",
                    { targetFolder: s.contextMoveTargetFolder },
                    targetIds,
                  );
                } else {
                  void actions.runActionForEmail(email.id, `/api/emails/${email.id}/move`, {
                    targetFolder: s.contextMoveTargetFolder,
                  });
                }
                close();
              }}
            >
              Verschieben
            </button>
          </div>
        </div>

        {!isBulk && attachments.length > 0 ? (
          <div className="my-1 border-t border-gray-100 pt-1">
            <p className="px-2 text-xs glass-text-muted">Anhänge</p>
            <div className="mt-1 px-1">
              <select
                value={selectedAtt?.id ?? ""}
                onChange={(e) => s.setContextAttachmentId(e.target.value)}
                className="glass-select w-full rounded-lg px-2 py-1 text-xs"
              >
                {attachments.map((att) => (
                  <option key={att.id} value={att.id}>
                    {getAttachmentDisplayName(att)}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-1 grid grid-cols-3 gap-1 px-1">
              <button
                disabled={!selectedAtt}
                className="glass-btn rounded-lg px-2 py-1 text-xs disabled:opacity-50"
                onClick={() => { if (selectedAtt) { actions.openAttachment(email.id, selectedAtt.id); close(); } }}
              >
                Öffnen
              </button>
              <button
                disabled={!selectedAtt}
                className="glass-btn rounded-lg px-2 py-1 text-xs disabled:opacity-50"
                onClick={() => { if (selectedAtt) { actions.printAttachment(email.id, selectedAtt.id); close(); } }}
              >
                Drucken
              </button>
              <button
                disabled={!selectedAtt}
                className="glass-btn rounded-lg px-2 py-1 text-xs disabled:opacity-50"
                onClick={() => { if (selectedAtt) { void actions.saveAttachmentToCloudForEmail(email.id, selectedAtt.id); close(); } }}
              >
                Speichern
              </button>
            </div>
            <div className="mt-1 grid grid-cols-3 gap-1 px-1">
              <button
                className="glass-btn rounded-lg px-2 py-1 text-xs"
                onClick={() => { attachments.forEach((a) => actions.openAttachment(email.id, a.id)); close(); }}
              >
                Alle öffnen
              </button>
              <button
                className="glass-btn rounded-lg px-2 py-1 text-xs"
                onClick={() => { attachments.forEach((a) => actions.printAttachment(email.id, a.id)); close(); }}
              >
                Alle drucken
              </button>
              <button
                className="glass-btn rounded-lg px-2 py-1 text-xs"
                onClick={() => {
                  void (async () => {
                    for (const a of attachments) {
                      await actions.saveAttachmentToCloudForEmail(email.id, a.id);
                    }
                  })();
                  close();
                }}
              >
                Alle speichern
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
