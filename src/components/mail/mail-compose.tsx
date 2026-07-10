/**
 * Compose modal component: new mail, reply, and forward. Contains the
 * contentEditable editor, to/cc/bcc/subject fields, signature insertion,
 * send/draft logic, and the formatting toolbar.
 */

import type { MailStateReturn } from "./use-mail-state";
import type { MailActionsReturn } from "./use-mail-actions";

type Props = {
  s: MailStateReturn;
  actions: MailActionsReturn;
};

export function MailCompose({ s, actions }: Props) {
  if (!s.composeOpen) return null;

  return (
    <div className="glass-overlay fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="glass-modal flex h-[90vh] w-full max-w-5xl flex-col rounded-2xl">
        <div className="flex items-center justify-between border-b glass-divider px-4 py-3">
          <h3 className="text-base font-semibold glass-text-primary">
            {s.composeMode === "new"
              ? "Neue Mail"
              : s.composeMode === "reply"
                ? "Antwort verfassen"
                : "Weiterleiten"}
          </h3>
          <button
            className="glass-btn rounded-lg px-3 py-1 text-sm"
            onClick={() => s.setComposeOpen(false)}
          >
            Abbrechen
          </button>
        </div>

        <div className="space-y-2 border-b glass-divider px-4 py-3 text-sm">
          <div className="grid grid-cols-[110px_1fr] items-center gap-2">
            <label className="glass-text-secondary">Konto</label>
            <select
              value={s.composeForm.accountId}
              onChange={(e) =>
                s.setComposeForm((prev) => ({ ...prev, accountId: e.target.value }))
              }
              className="glass-select rounded-lg px-2 py-1.5"
            >
              <option value="">Konto wählen...</option>
              {s.accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} ({account.imapUsername})
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-[110px_1fr] items-center gap-2">
            <label className="glass-text-secondary">An</label>
            <input
              value={s.composeForm.to}
              onChange={(e) => s.setComposeForm((prev) => ({ ...prev, to: e.target.value }))}
              placeholder="max@firma.de; team@firma.de"
              className="glass-input rounded-lg px-2 py-1.5"
              dir="ltr"
            />
          </div>
          <div className="grid grid-cols-[110px_1fr] items-center gap-2">
            <label className="glass-text-secondary">CC</label>
            <input
              value={s.composeForm.cc}
              onChange={(e) => s.setComposeForm((prev) => ({ ...prev, cc: e.target.value }))}
              className="glass-input rounded-lg px-2 py-1.5"
              dir="ltr"
            />
          </div>
          <div className="grid grid-cols-[110px_1fr] items-center gap-2">
            <label className="glass-text-secondary">BCC</label>
            <input
              value={s.composeForm.bcc}
              onChange={(e) => s.setComposeForm((prev) => ({ ...prev, bcc: e.target.value }))}
              className="glass-input rounded-lg px-2 py-1.5"
              dir="ltr"
            />
          </div>
          <div className="grid grid-cols-[110px_1fr] items-center gap-2">
            <label className="glass-text-secondary">Betreff</label>
            <input
              value={s.composeForm.subject}
              onChange={(e) => s.setComposeForm((prev) => ({ ...prev, subject: e.target.value }))}
              className="glass-input rounded-lg px-2 py-1.5"
              dir="ltr"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-1 border-b glass-divider px-4 py-2 text-xs">
          <button className="glass-btn rounded-lg px-2 py-1" onClick={() => actions.applyComposeCommand("bold")}>Fett</button>
          <button className="glass-btn rounded-lg px-2 py-1" onClick={() => actions.applyComposeCommand("italic")}>Kursiv</button>
          <button className="glass-btn rounded-lg px-2 py-1" onClick={() => actions.applyComposeCommand("underline")}>Unterstr.</button>
          <button className="glass-btn rounded-lg px-2 py-1" onClick={() => actions.applyComposeCommand("insertUnorderedList")}>Liste</button>
          <button className="glass-btn rounded-lg px-2 py-1" onClick={() => actions.applyComposeCommand("insertOrderedList")}>1.</button>
          <button className="glass-btn rounded-lg px-2 py-1" onClick={() => actions.applyComposeCommand("formatBlock", "blockquote")}>Zitat</button>
          <button className="glass-btn rounded-lg px-2 py-1" onClick={() => actions.applyComposeCommand("insertHorizontalRule")}>Linie</button>
          <button className="glass-btn rounded-lg px-2 py-1" onClick={() => actions.applyComposeCommand("insertText", "✎")}>Zeichen ✎</button>
          <button className="glass-btn rounded-lg px-2 py-1" onClick={() => actions.applyComposeCommand("insertText", "✓")}>Zeichen ✓</button>
          <input
            type="color"
            className="glass-input h-7 w-10 rounded-lg"
            onChange={(e) => actions.applyComposeCommand("foreColor", e.target.value)}
            title="Textfarbe"
          />
          <button
            className="glass-btn ml-auto rounded-lg px-2 py-1"
            onClick={() => {
              const signature = actions.insertSignatureHtml(s.composeMode, s.composeForm.accountId);
              if (!signature) return;
              actions.applyComposeCommand("insertHTML", signature);
            }}
          >
            Signatur einfügen
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div
            ref={s.composeEditorRef}
            contentEditable
            suppressContentEditableWarning
            dir="ltr"
            onInput={() =>
              s.setComposeForm((prev) => ({
                ...prev,
                bodyHtml: s.composeEditorRef.current?.innerHTML || "",
              }))
            }
            className="glass-input min-h-[260px] rounded-xl p-3 text-sm"
            style={{ direction: "ltr", textAlign: "left" }}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t glass-divider px-4 py-3 text-sm">
          <input
            type="datetime-local"
            value={s.composeForm.sendAtLocal}
            onChange={(e) => s.setComposeForm((prev) => ({ ...prev, sendAtLocal: e.target.value }))}
            className="glass-input rounded-lg px-2 py-1.5"
            title="Später senden"
          />
          <button
            disabled={s.composeSaving}
            onClick={() => void actions.submitCompose("send_later")}
            className="glass-btn rounded-lg px-3 py-1.5 disabled:opacity-60"
          >
            Später senden
          </button>
          <button
            disabled={s.composeSaving}
            onClick={() => void actions.submitCompose("save_draft")}
            className="glass-btn rounded-lg px-3 py-1.5 disabled:opacity-60"
          >
            Als Entwurf speichern
          </button>
          <button
            disabled={s.composeSaving}
            onClick={() => void actions.submitCompose("send_now")}
            className="glass-btn-primary ml-auto rounded-lg px-3 py-1.5 disabled:opacity-60"
          >
            Jetzt senden
          </button>
        </div>
      </div>
    </div>
  );
}
