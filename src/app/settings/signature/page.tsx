"use client";

import { useEffect, useRef, useState, useCallback } from "react";

type Signature = {
  id: string;
  name: string;
  htmlContent: string;
  accountIds: string[];
  includeOnNewMail: boolean;
  includeOnReply: boolean;
  includeOnForward: boolean;
  isDefault: boolean;
};

type MailAccount = {
  id: string;
  name: string;
  imapUsername: string;
};

export default function SignatureSettingsPage() {
  const [signatures, setSignatures] = useState<Signature[]>([]);
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Signature | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const editorRef = useRef<HTMLDivElement>(null);
  const editorInitializedRef = useRef(false);

  const loadSignatures = useCallback(async () => {
    const res = await fetch("/api/signatures");
    if (!res.ok) {
      setError("Signaturen konnten nicht geladen werden.");
      return;
    }
    const data = (await res.json()) as { signatures?: Signature[] };
    setSignatures(data.signatures ?? []);
  }, []);

  const loadAccounts = useCallback(async () => {
    const res = await fetch("/api/accounts");
    if (!res.ok) return;
    const data = (await res.json()) as { accounts?: MailAccount[] };
    setAccounts(data.accounts ?? []);
  }, []);

  useEffect(() => {
    const init = async () => {
      await Promise.all([loadSignatures(), loadAccounts()]);
      setLoading(false);
    };
    void init();
  }, [loadSignatures, loadAccounts]);

  useEffect(() => {
    if (editForm && editorRef.current && !editorInitializedRef.current) {
      editorRef.current.innerHTML = editForm.htmlContent;
      editorInitializedRef.current = true;
    }
  }, [editForm]);

  function selectSignature(sig: Signature) {
    setSelectedId(sig.id);
    setEditForm({ ...sig });
    editorInitializedRef.current = false;
    setError("");
    setInfo("");
  }

  function createNew() {
    const newSig: Signature = {
      id: "__new__",
      name: "Neue Signatur",
      htmlContent: "",
      accountIds: [],
      includeOnNewMail: true,
      includeOnReply: true,
      includeOnForward: true,
      isDefault: false,
    };
    setSelectedId("__new__");
    setEditForm(newSig);
    editorInitializedRef.current = false;
    setError("");
    setInfo("");
  }

  async function saveSignature() {
    if (!editForm) return;
    setSaving(true);
    setError("");
    setInfo("");

    const htmlContent = editorRef.current?.innerHTML ?? "";
    const payload = {
      name: editForm.name,
      htmlContent,
      accountIds: editForm.accountIds,
      includeOnNewMail: editForm.includeOnNewMail,
      includeOnReply: editForm.includeOnReply,
      includeOnForward: editForm.includeOnForward,
      isDefault: editForm.isDefault,
    };

    try {
      let res: Response;
      if (editForm.id === "__new__") {
        res = await fetch("/api/signatures", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch(`/api/signatures/${editForm.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({} as { error?: string }));
        setError((data as { error?: string }).error ?? "Speichern fehlgeschlagen");
        setSaving(false);
        return;
      }

      const data = (await res.json()) as { signature: Signature };
      await loadSignatures();
      setSelectedId(data.signature.id);
      setEditForm(data.signature);
      editorInitializedRef.current = false;
      setInfo("Signatur gespeichert.");
    } catch {
      setError("Speichern fehlgeschlagen");
    }
    setSaving(false);
  }

  async function deleteSignature() {
    if (!editForm || editForm.id === "__new__") return;
    if (!confirm("Signatur wirklich löschen?")) return;

    const res = await fetch(`/api/signatures/${editForm.id}`, { method: "DELETE" });
    if (!res.ok) {
      setError("Löschen fehlgeschlagen");
      return;
    }

    await loadSignatures();
    setSelectedId(null);
    setEditForm(null);
    setInfo("Signatur gelöscht.");
  }

  function execCommand(command: string, value?: string) {
    document.execCommand(command, false, value);
    editorRef.current?.focus();
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/signatures/upload-image", {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({} as { error?: string }));
      setError((data as { error?: string }).error ?? "Bild-Upload fehlgeschlagen");
      return;
    }

    const data = (await res.json()) as { url: string };
    execCommand("insertHTML", `<img src="${data.url}" style="max-width:100%;height:auto" />`);
    e.target.value = "";
  }

  function handleLinkInsert() {
    const url = prompt("URL eingeben:");
    if (url) {
      execCommand("createLink", url);
    }
  }

  function toggleAccountId(accountId: string) {
    if (!editForm) return;
    const ids = editForm.accountIds.includes(accountId)
      ? editForm.accountIds.filter((id) => id !== accountId)
      : [...editForm.accountIds, accountId];
    setEditForm({ ...editForm, accountIds: ids });
  }

  return (
    <main className="min-h-screen p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-3">
          <a href="/settings" className="text-sm glass-text-secondary hover:underline">
            ← Zurück zu Einstellungen
          </a>
        </div>
        <h1 className="text-2xl font-semibold glass-text-primary">Signaturen</h1>
        <p className="mt-1 text-sm glass-text-secondary">
          Verwalte mehrere Signaturen und ordne sie deinen Mail-Accounts zu.
        </p>

        {error && <p className="mt-3 text-sm glass-error rounded-lg px-3 py-1.5">{error}</p>}
        {info && <p className="mt-3 text-sm glass-info rounded-lg px-3 py-1.5">{info}</p>}

        {loading ? (
          <p className="mt-6 text-sm glass-text-secondary">Lade...</p>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
            {/* Linke Spalte: Liste */}
            <div className="glass-card rounded-xl p-4">
              <h2 className="mb-3 text-sm font-medium glass-text-primary">Meine Signaturen</h2>
              <div className="space-y-1">
                {signatures.map((sig) => (
                  <button
                    key={sig.id}
                    onClick={() => selectSignature(sig)}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                      selectedId === sig.id
                        ? "glass-btn-dark"
                        : "glass-btn hover:opacity-80"
                    }`}
                  >
                    <div className="font-medium">{sig.name}</div>
                    {sig.isDefault && (
                      <div className="text-xs opacity-70">Standard</div>
                    )}
                  </button>
                ))}
              </div>
              <button
                onClick={createNew}
                className="glass-btn mt-3 w-full rounded-lg px-3 py-2 text-sm"
              >
                + Neue Signatur
              </button>
            </div>

            {/* Rechte Spalte: Editor */}
            {editForm ? (
              <div className="glass-card rounded-xl p-4">
                {/* Name */}
                <label className="block">
                  <span className="mb-1 block text-sm font-medium glass-text-primary">Name</span>
                  <input
                    type="text"
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    className="glass-input w-full rounded-lg px-3 py-2 text-sm"
                    placeholder="z.B. Geschäftlich"
                  />
                </label>

                {/* Account-Zuordnung */}
                {accounts.length > 0 && (
                  <div className="mt-4">
                    <span className="mb-1 block text-sm font-medium glass-text-primary">
                      Account-Zuordnung
                    </span>
                    <p className="mb-2 text-xs glass-text-secondary">
                      Leer = wird für alle Accounts verwendet
                    </p>
                    <div className="space-y-1">
                      {accounts.map((acc) => (
                        <label key={acc.id} className="flex items-center gap-2 text-sm glass-text-primary">
                          <input
                            type="checkbox"
                            checked={editForm.accountIds.includes(acc.id)}
                            onChange={() => toggleAccountId(acc.id)}
                          />
                          {acc.name || acc.imapUsername}
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {/* Rich-Text Editor Toolbar */}
                <div className="mt-4">
                  <span className="mb-1 block text-sm font-medium glass-text-primary">Inhalt</span>
                  <div className="flex flex-wrap items-center gap-1 rounded-t-lg border border-b-0 glass-card px-2 py-1.5">
                    <select
                      className="glass-input rounded px-1 py-0.5 text-xs"
                      onChange={(e) => { if (e.target.value) execCommand("fontName", e.target.value); }}
                      defaultValue=""
                    >
                      <option value="" disabled>Schriftart</option>
                      <option value="Arial">Arial</option>
                      <option value="Helvetica">Helvetica</option>
                      <option value="Times New Roman">Times New Roman</option>
                      <option value="Courier New">Courier New</option>
                      <option value="Georgia">Georgia</option>
                      <option value="Verdana">Verdana</option>
                    </select>
                    <select
                      className="glass-input rounded px-1 py-0.5 text-xs"
                      onChange={(e) => {
                        if (e.target.value) {
                          execCommand("fontSize", e.target.value);
                        }
                      }}
                      defaultValue=""
                    >
                      <option value="" disabled>Größe</option>
                      <option value="1">10px</option>
                      <option value="2">12px</option>
                      <option value="3">14px</option>
                      <option value="4">16px</option>
                      <option value="5">18px</option>
                      <option value="6">24px</option>
                    </select>
                    <button className="glass-btn rounded px-2 py-0.5 text-xs font-bold" onClick={() => execCommand("bold")} title="Fett">F</button>
                    <button className="glass-btn rounded px-2 py-0.5 text-xs italic" onClick={() => execCommand("italic")} title="Kursiv">K</button>
                    <button className="glass-btn rounded px-2 py-0.5 text-xs underline" onClick={() => execCommand("underline")} title="Unterstrichen">U</button>
                    <input
                      type="color"
                      className="h-6 w-7 cursor-pointer rounded border-0"
                      onChange={(e) => execCommand("foreColor", e.target.value)}
                      title="Textfarbe"
                    />
                    <button className="glass-btn rounded px-2 py-0.5 text-xs" onClick={handleLinkInsert} title="Link einfügen">🔗</button>
                    <label className="glass-btn cursor-pointer rounded px-2 py-0.5 text-xs" title="Bild einfügen">
                      🖼️
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/gif"
                        className="hidden"
                        onChange={handleImageUpload}
                      />
                    </label>
                    <button className="glass-btn rounded px-2 py-0.5 text-xs" onClick={() => execCommand("insertHorizontalRule")} title="Horizontale Linie">─</button>
                  </div>

                  {/* Editable Area */}
                  <div
                    ref={editorRef}
                    contentEditable
                    dir="ltr"
                    className="glass-input min-h-[200px] w-full rounded-b-lg border px-3 py-2 text-sm focus:outline-none"
                    style={{ direction: "ltr", textAlign: "left" }}
                    suppressContentEditableWarning
                  />
                </div>

                {/* Optionen */}
                <div className="mt-4 space-y-2 text-sm">
                  <label className="flex items-center gap-2 glass-text-primary">
                    <input
                      type="checkbox"
                      checked={editForm.includeOnNewMail}
                      onChange={(e) => setEditForm({ ...editForm, includeOnNewMail: e.target.checked })}
                    />
                    Bei neuer Mail einfügen
                  </label>
                  <label className="flex items-center gap-2 glass-text-primary">
                    <input
                      type="checkbox"
                      checked={editForm.includeOnReply}
                      onChange={(e) => setEditForm({ ...editForm, includeOnReply: e.target.checked })}
                    />
                    Bei Antworten einfügen
                  </label>
                  <label className="flex items-center gap-2 glass-text-primary">
                    <input
                      type="checkbox"
                      checked={editForm.includeOnForward}
                      onChange={(e) => setEditForm({ ...editForm, includeOnForward: e.target.checked })}
                    />
                    Bei Weiterleiten einfügen
                  </label>
                  <label className="flex items-center gap-2 glass-text-primary">
                    <input
                      type="checkbox"
                      checked={editForm.isDefault}
                      onChange={(e) => setEditForm({ ...editForm, isDefault: e.target.checked })}
                    />
                    Als Standard-Signatur verwenden
                  </label>
                </div>

                {/* Buttons */}
                <div className="mt-4 flex gap-2">
                  <button
                    disabled={saving}
                    onClick={() => void saveSignature()}
                    className="glass-btn-dark rounded-lg px-4 py-2 text-sm disabled:opacity-60"
                  >
                    {saving ? "Speichere..." : "Speichern"}
                  </button>
                  {editForm.id !== "__new__" && (
                    <button
                      onClick={() => void deleteSignature()}
                      className="glass-btn rounded-lg px-4 py-2 text-sm text-red-500 hover:text-red-400"
                    >
                      Löschen
                    </button>
                  )}
                </div>

                {/* Vorschau */}
                <div className="mt-6">
                  <span className="mb-1 block text-sm font-medium glass-text-primary">Vorschau</span>
                  <div
                    className="glass-card min-h-[80px] rounded-lg p-3 text-sm"
                    dangerouslySetInnerHTML={{ __html: editorRef.current?.innerHTML ?? editForm.htmlContent }}
                  />
                </div>
              </div>
            ) : (
              <div className="glass-card flex items-center justify-center rounded-xl p-8">
                <p className="text-sm glass-text-secondary">
                  Wähle eine Signatur aus oder erstelle eine neue.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
