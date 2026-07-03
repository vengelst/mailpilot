"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Account = {
  id: string;
  name: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  imapUsername: string;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean;
  smtpUsername: string | null;
  smtpFromName: string | null;
};

const emptyForm = {
  name: "",
  imapHost: "",
  imapPort: 993,
  imapSecure: true,
  imapUsername: "",
  imapPassword: "",
  smtpHost: "",
  smtpPort: 465,
  smtpSecure: true,
  smtpUsername: "",
  smtpPassword: "",
  smtpFromName: "",
};

export default function AccountsSettingsPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [smtpSameAsImap, setSmtpSameAsImap] = useState(true);
  const [editForm, setEditForm] = useState(emptyForm);
  const [editSmtpSameAsImap, setEditSmtpSameAsImap] = useState(true);
  const [feedback, setFeedback] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const [syncSettingsOpen, setSyncSettingsOpen] = useState(false);
  const [availableFolders, setAvailableFolders] = useState<{ path: string; name: string }[]>([]);
  const [excludedFolders, setExcludedFolders] = useState<string[]>([]);
  const [syncSettingsLoading, setSyncSettingsLoading] = useState(false);
  const [syncSettingsSaving, setSyncSettingsSaving] = useState(false);

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === selectedId) ?? null,
    [accounts, selectedId],
  );

  const loadSyncSettings = useCallback(async (accountId: string) => {
    setSyncSettingsLoading(true);
    try {
      const res = await fetch(`/api/accounts/${accountId}/sync-settings`);
      if (res.ok) {
        const data = await res.json();
        setAvailableFolders(data.availableFolders ?? []);
        setExcludedFolders(data.excludedFolders ?? []);
      }
    } catch { /* ignore */ }
    setSyncSettingsLoading(false);
  }, []);

  async function saveSyncSettings() {
    if (!selectedId) return;
    setSyncSettingsSaving(true);
    try {
      const res = await fetch(`/api/accounts/${selectedId}/sync-settings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ excludedFolders }),
      });
      if (res.ok) {
        setFeedback({ kind: "info", text: "Sync-Einstellungen gespeichert. Ausgeschlossene Ordner werden beim nächsten Sync ignoriert." });
      } else {
        const data = await res.json().catch(() => ({}));
        setFeedback({ kind: "error", text: (data as { error?: string }).error ?? "Speichern fehlgeschlagen" });
      }
    } catch {
      setFeedback({ kind: "error", text: "Speichern fehlgeschlagen" });
    }
    setSyncSettingsSaving(false);
  }

  function toggleFolderExclusion(folderPath: string) {
    setExcludedFolders((prev) =>
      prev.includes(folderPath)
        ? prev.filter((f) => f !== folderPath)
        : [...prev, folderPath],
    );
  }

  async function readError(res: Response, fallback: string) {
    try {
      const data = (await res.json()) as { error?: string };
      if (typeof data.error === "string" && data.error.trim()) return data.error;
    } catch {
      // ignore
    }
    return fallback;
  }

  async function loadAccounts() {
    setLoading(true);
    const res = await fetch("/api/accounts");
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (!res.ok) {
      setFeedback({ kind: "error", text: await readError(res, "Konten konnten nicht geladen werden.") });
      setLoading(false);
      return;
    }
    const data = await res.json();
    const next: Account[] = data.accounts ?? [];
    setAccounts(next);
    if (next.length && !next.some((a) => a.id === selectedId)) {
      setSelectedId(next[0].id);
    }
    if (!next.length) setSelectedId("");
    setLoading(false);
  }

  async function addAccount(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    const res = await fetch("/api/accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...form,
        name: form.name.trim(),
        imapHost: form.imapHost.trim(),
        imapUsername: form.imapUsername.trim(),
        smtpHost: form.smtpHost.trim(),
        smtpUsername: (smtpSameAsImap ? form.imapUsername : form.smtpUsername).trim(),
        smtpPassword: smtpSameAsImap ? form.imapPassword : form.smtpPassword,
        smtpFromName: form.smtpFromName.trim(),
      }),
    });
    if (!res.ok) {
      setFeedback({ kind: "error", text: await readError(res, "Konto konnte nicht gespeichert werden.") });
      return;
    }
    setForm(emptyForm);
    setFeedback({ kind: "info", text: "Konto gespeichert." });
    await loadAccounts();
  }

  async function testConnection() {
    if (!selectedId) {
      setFeedback({ kind: "error", text: "Bitte zuerst ein Konto auswählen." });
      return;
    }
    setFeedback(null);
    const res = await fetch(`/api/accounts/${selectedId}/test`, { method: "POST" });
    if (!res.ok) {
      setFeedback({ kind: "error", text: await readError(res, "Verbindungstest fehlgeschlagen.") });
      return;
    }
    setFeedback({ kind: "info", text: "Verbindung erfolgreich hergestellt." });
  }

  async function deleteSelected() {
    if (!selectedId) return;
    if (!window.confirm("Ausgewähltes Konto wirklich löschen?")) return;
    setFeedback(null);
    const res = await fetch(`/api/accounts/${selectedId}`, { method: "DELETE" });
    if (!res.ok) {
      setFeedback({ kind: "error", text: await readError(res, "Konto konnte nicht gelöscht werden.") });
      return;
    }
    await loadAccounts();
  }

  async function updateSelected(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId) return;
    setFeedback(null);
    const payload: Record<string, unknown> = {
      name: editForm.name.trim(),
      imapHost: editForm.imapHost.trim(),
      imapPort: editForm.imapPort,
      imapSecure: editForm.imapSecure,
      imapUsername: editForm.imapUsername.trim(),
      smtpHost: editForm.smtpHost.trim(),
      smtpPort: editForm.smtpPort,
      smtpSecure: editForm.smtpSecure,
      smtpUsername: (editSmtpSameAsImap ? editForm.imapUsername : editForm.smtpUsername).trim(),
      smtpFromName: editForm.smtpFromName.trim(),
    };
    if (editForm.imapPassword.trim()) {
      payload.imapPassword = editForm.imapPassword;
    }
    if (editSmtpSameAsImap) {
      if (editForm.imapPassword.trim()) payload.smtpPassword = editForm.imapPassword;
    } else if (editForm.smtpPassword.trim()) {
      payload.smtpPassword = editForm.smtpPassword;
    }

    const res = await fetch(`/api/accounts/${selectedId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      setFeedback({ kind: "error", text: await readError(res, "Konto konnte nicht gespeichert werden.") });
      return;
    }
    setFeedback({ kind: "info", text: "Konto aktualisiert." });
    await loadAccounts();
  }

  useEffect(() => {
    if (!selectedAccount) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditForm({
      name: selectedAccount.name,
      imapHost: selectedAccount.imapHost,
      imapPort: selectedAccount.imapPort,
      imapSecure: selectedAccount.imapSecure,
      imapUsername: selectedAccount.imapUsername,
      imapPassword: "",
      smtpHost: selectedAccount.smtpHost || "",
      smtpPort: selectedAccount.smtpPort || 465,
      smtpSecure: selectedAccount.smtpSecure,
      smtpUsername: selectedAccount.smtpUsername || "",
      smtpPassword: "",
      smtpFromName: selectedAccount.smtpFromName || "",
    });
    setEditSmtpSameAsImap(
      !!selectedAccount.smtpUsername &&
        selectedAccount.smtpUsername.toLowerCase() === selectedAccount.imapUsername.toLowerCase(),
    );
  }, [selectedAccount]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadAccounts();
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="min-h-screen p-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-4 flex items-center gap-2">
          <a href="/settings" className="text-sm glass-text-secondary hover:underline">
            ← Einstellungen
          </a>
        </div>
        <h1 className="text-2xl font-semibold glass-text-primary">IMAP-Konten</h1>
        <p className="mt-1 text-sm glass-text-secondary">
          Verbindungsdaten werden serverseitig verschlüsselt gespeichert.
        </p>

        {feedback ? (
          <p
            className={`mt-3 rounded-xl px-3 py-2 text-sm ${
              feedback.kind === "error"
                ? "glass-error"
                : "glass-success-box"
            }`}
          >
            {feedback.text}
          </p>
        ) : null}

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="glass-card p-4">
            <h2 className="text-sm font-semibold glass-text-primary">Vorhandene Konten</h2>
            {loading ? (
              <p className="mt-3 text-sm glass-text-secondary">Lade Konten...</p>
            ) : null}
            {!loading && accounts.length === 0 ? (
              <p className="mt-3 text-sm glass-text-tertiary">Noch kein Konto angelegt.</p>
            ) : null}
            <ul className="mt-3 space-y-2">
              {accounts.map((account) => (
                <li key={account.id}>
                  <button
                    onClick={() => setSelectedId(account.id)}
                    className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-all ${
                      selectedId === account.id
                        ? "border-white/40 glass-solid"
                        : "border-white/10 hover:glass"
                    }`}
                  >
                    <p className="font-medium glass-text-primary">{account.name}</p>
                    <p className="text-xs glass-text-secondary">{account.imapUsername}</p>
                  </button>
                </li>
              ))}
            </ul>

            {selectedAccount ? (
              <div className="glass mt-4 rounded-lg p-3 text-sm glass-text-secondary">
                <p>
                  <span className="font-semibold">Host:</span> {selectedAccount.imapHost}
                </p>
                <p>
                  <span className="font-semibold">Port:</span> {selectedAccount.imapPort} (
                  {selectedAccount.imapSecure ? "SSL/TLS" : "STARTTLS/Plain"})
                </p>
                <p>
                  <span className="font-semibold">Benutzer:</span> {selectedAccount.imapUsername}
                </p>
                <p className="mt-2 border-t glass-divider pt-2">
                  <span className="font-semibold">SMTP Host:</span> {selectedAccount.smtpHost || "-"}
                </p>
                <p>
                  <span className="font-semibold">SMTP Port:</span> {selectedAccount.smtpPort ?? "-"} (
                  {selectedAccount.smtpSecure ? "SSL/TLS" : "STARTTLS/Plain"})
                </p>
                <p>
                  <span className="font-semibold">SMTP Benutzer:</span>{" "}
                  {selectedAccount.smtpUsername || "-"}
                </p>
                <p>
                  <span className="font-semibold">Absendername:</span>{" "}
                  {selectedAccount.smtpFromName || "-"}
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={testConnection}
                    className="glass-btn rounded-lg px-3 py-1.5 text-xs"
                  >
                    Verbindung testen
                  </button>
                  <button
                    onClick={deleteSelected}
                    className="glass-btn rounded-lg px-3 py-1.5 text-xs text-red-400"
                  >
                    Konto löschen
                  </button>
                </div>
              </div>
            ) : null}

            {selectedAccount ? (
              <form
                onSubmit={updateSelected}
                className="glass mt-4 space-y-2 rounded-lg p-3 text-sm"
              >
                <p className="font-semibold glass-text-primary">Ausgewähltes Konto bearbeiten</p>
                <input
                  placeholder="Name"
                  value={editForm.name}
                  onChange={(e) => setEditForm((v) => ({ ...v, name: e.target.value }))}
                  className="glass-input w-full rounded-xl px-3 py-2"
                  required
                />
                <input
                  placeholder="IMAP Host"
                  value={editForm.imapHost}
                  onChange={(e) => setEditForm((v) => ({ ...v, imapHost: e.target.value }))}
                  className="glass-input w-full rounded-xl px-3 py-2"
                  required
                />
                <input
                  placeholder="IMAP Port"
                  type="number"
                  value={editForm.imapPort}
                  onChange={(e) => setEditForm((v) => ({ ...v, imapPort: Number(e.target.value) }))}
                  className="glass-input w-full rounded-xl px-3 py-2"
                  required
                />
                <input
                  placeholder="IMAP Benutzer"
                  value={editForm.imapUsername}
                  onChange={(e) => setEditForm((v) => ({ ...v, imapUsername: e.target.value }))}
                  className="glass-input w-full rounded-xl px-3 py-2"
                  required
                />
                <input
                  placeholder="IMAP Passwort (leer lassen = unverändert)"
                  type="password"
                  value={editForm.imapPassword}
                  onChange={(e) => setEditForm((v) => ({ ...v, imapPassword: e.target.value }))}
                  className="glass-input w-full rounded-xl px-3 py-2"
                />
                <label className="flex items-center gap-2 text-xs glass-text-secondary">
                  <input
                    type="checkbox"
                    checked={editForm.imapSecure}
                    onChange={(e) =>
                      setEditForm((v) => ({
                        ...v,
                        imapSecure: e.target.checked,
                        imapPort: e.target.checked ? 993 : 143,
                      }))
                    }
                  />
                  IMAP SSL/TLS
                </label>

                <div className="mt-2 border-t glass-divider pt-2 text-xs font-semibold uppercase tracking-wide glass-text-tertiary">
                  SMTP
                </div>
                <input
                  placeholder="SMTP Host"
                  value={editForm.smtpHost}
                  onChange={(e) => setEditForm((v) => ({ ...v, smtpHost: e.target.value }))}
                  className="glass-input w-full rounded-xl px-3 py-2"
                  required
                />
                <input
                  placeholder="SMTP Port"
                  type="number"
                  value={editForm.smtpPort}
                  onChange={(e) => setEditForm((v) => ({ ...v, smtpPort: Number(e.target.value) }))}
                  className="glass-input w-full rounded-xl px-3 py-2"
                  required
                />
                <label className="flex items-center gap-2 text-xs glass-text-secondary">
                  <input
                    type="checkbox"
                    checked={editSmtpSameAsImap}
                    onChange={(e) => setEditSmtpSameAsImap(e.target.checked)}
                  />
                  SMTP-Zugangsdaten wie IMAP verwenden
                </label>
                {!editSmtpSameAsImap ? (
                  <>
                    <input
                      placeholder="SMTP Benutzer"
                      value={editForm.smtpUsername}
                      onChange={(e) => setEditForm((v) => ({ ...v, smtpUsername: e.target.value }))}
                      className="glass-input w-full rounded-xl px-3 py-2"
                      required
                    />
                    <input
                      placeholder="SMTP Passwort (leer lassen = unverändert)"
                      type="password"
                      value={editForm.smtpPassword}
                      onChange={(e) => setEditForm((v) => ({ ...v, smtpPassword: e.target.value }))}
                      className="glass-input w-full rounded-xl px-3 py-2"
                    />
                  </>
                ) : null}
                <input
                  placeholder="SMTP Absendername (optional)"
                  value={editForm.smtpFromName}
                  onChange={(e) => setEditForm((v) => ({ ...v, smtpFromName: e.target.value }))}
                  className="glass-input w-full rounded-xl px-3 py-2"
                />
                <label className="flex items-center gap-2 text-xs glass-text-secondary">
                  <input
                    type="checkbox"
                    checked={editForm.smtpSecure}
                    onChange={(e) =>
                      setEditForm((v) => ({
                        ...v,
                        smtpSecure: e.target.checked,
                        smtpPort: e.target.checked ? 465 : 587,
                      }))
                    }
                  />
                  SMTP SSL/TLS
                </label>
                <button
                  type="submit"
                  className="glass-btn-dark w-full rounded-lg px-3 py-2 text-sm"
                >
                  Änderungen speichern
                </button>
              </form>
            ) : null}
          </section>

          <section className="glass-card p-4">
            <h2 className="text-sm font-semibold glass-text-primary">Neues Konto (IMAP + SMTP)</h2>
            <form onSubmit={addAccount} className="mt-3 space-y-2 text-sm">
              <input
                placeholder="Name"
                value={form.name}
                onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))}
                className="glass-input w-full rounded-xl px-3 py-2"
                required
              />
              <input
                placeholder="Host"
                value={form.imapHost}
                onChange={(e) => setForm((v) => ({ ...v, imapHost: e.target.value }))}
                className="glass-input w-full rounded-xl px-3 py-2"
                required
              />
              <input
                placeholder="Port"
                type="number"
                value={form.imapPort}
                onChange={(e) => setForm((v) => ({ ...v, imapPort: Number(e.target.value) }))}
                className="glass-input w-full rounded-xl px-3 py-2"
                required
              />
              <input
                placeholder="Benutzername"
                value={form.imapUsername}
                onChange={(e) => setForm((v) => ({ ...v, imapUsername: e.target.value }))}
                className="glass-input w-full rounded-xl px-3 py-2"
                required
              />
              <input
                placeholder="Passwort"
                type="password"
                value={form.imapPassword}
                onChange={(e) => setForm((v) => ({ ...v, imapPassword: e.target.value }))}
                className="glass-input w-full rounded-xl px-3 py-2"
                required
              />
              <label className="flex items-center gap-2 text-xs glass-text-secondary">
                <input
                  type="checkbox"
                  checked={form.imapSecure}
                  onChange={(e) =>
                    setForm((v) => ({
                      ...v,
                      imapSecure: e.target.checked,
                      imapPort: e.target.checked ? 993 : 143,
                    }))
                  }
                />
                SSL/TLS verwenden (aus: Port 143, an: Port 993)
              </label>

              <div className="mt-3 border-t glass-divider pt-3 text-xs font-semibold uppercase tracking-wide glass-text-tertiary">
                SMTP (Versand)
              </div>
              <input
                placeholder="SMTP Host"
                value={form.smtpHost}
                onChange={(e) => setForm((v) => ({ ...v, smtpHost: e.target.value }))}
                className="glass-input w-full rounded-xl px-3 py-2"
                required
              />
              <input
                placeholder="SMTP Port"
                type="number"
                value={form.smtpPort}
                onChange={(e) => setForm((v) => ({ ...v, smtpPort: Number(e.target.value) }))}
                className="glass-input w-full rounded-xl px-3 py-2"
                required
              />
              <label className="flex items-center gap-2 text-xs glass-text-secondary">
                <input
                  type="checkbox"
                  checked={smtpSameAsImap}
                  onChange={(e) => setSmtpSameAsImap(e.target.checked)}
                />
                SMTP-Zugangsdaten wie IMAP verwenden
              </label>
              {!smtpSameAsImap ? (
                <>
                  <input
                    placeholder="SMTP Benutzername"
                    value={form.smtpUsername}
                    onChange={(e) => setForm((v) => ({ ...v, smtpUsername: e.target.value }))}
                    className="glass-input w-full rounded-xl px-3 py-2"
                    required
                  />
                  <input
                    placeholder="SMTP Passwort"
                    type="password"
                    value={form.smtpPassword}
                    onChange={(e) => setForm((v) => ({ ...v, smtpPassword: e.target.value }))}
                    className="glass-input w-full rounded-xl px-3 py-2"
                    required
                  />
                </>
              ) : null}
              <input
                placeholder="SMTP Absendername (optional)"
                value={form.smtpFromName}
                onChange={(e) => setForm((v) => ({ ...v, smtpFromName: e.target.value }))}
                className="glass-input w-full rounded-xl px-3 py-2"
              />
              <label className="flex items-center gap-2 text-xs glass-text-secondary">
                <input
                  type="checkbox"
                  checked={form.smtpSecure}
                  onChange={(e) =>
                    setForm((v) => ({
                      ...v,
                      smtpSecure: e.target.checked,
                      smtpPort: e.target.checked ? 465 : 587,
                    }))
                  }
                />
                SSL/TLS verwenden (aus: Port 587, an: Port 465)
              </label>
              <button
                type="submit"
                className="glass-btn-dark w-full rounded-lg px-3 py-2 text-sm"
              >
                Konto speichern
              </button>
            </form>
          </section>

          {/* Sync-Einstellungen: Ordner-Filter */}
          {selectedId && (
            <section className="mt-6">
              <button
                type="button"
                onClick={() => {
                  if (!syncSettingsOpen) void loadSyncSettings(selectedId);
                  setSyncSettingsOpen((v) => !v);
                }}
                className="glass-btn-dark w-full rounded-lg px-3 py-2 text-sm text-left"
              >
                {syncSettingsOpen ? "▼" : "▶"} Sync-Einstellungen (Ordner auswählen)
              </button>
              {syncSettingsOpen && (
                <div className="glass mt-2 rounded-lg p-3 text-sm space-y-3">
                  <p className="text-xs glass-text-secondary">
                    Wähle aus, welche Ordner/Labels synchronisiert werden sollen.
                    Nicht angehakte Ordner werden beim Sync übersprungen.
                  </p>
                  {syncSettingsLoading ? (
                    <p className="text-xs glass-text-muted">Lade Ordner vom Server…</p>
                  ) : (
                    <div className="max-h-72 overflow-y-auto space-y-1">
                      {availableFolders.map((folder) => {
                        const isExcluded = excludedFolders.includes(folder.path);
                        return (
                          <label
                            key={folder.path}
                            className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-white/10 ${
                              isExcluded ? "opacity-50" : ""
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={!isExcluded}
                              onChange={() => toggleFolderExclusion(folder.path)}
                              className="accent-blue-500"
                            />
                            <span className={`text-xs ${isExcluded ? "line-through glass-text-muted" : "glass-text-primary"}`}>
                              {folder.path}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                  {excludedFolders.length > 0 && (
                    <p className="text-[11px] text-yellow-400">
                      {excludedFolders.length} Ordner ausgeschlossen – diese werden nicht synchronisiert
                      und bestehende Einträge werden entfernt.
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => void saveSyncSettings()}
                    disabled={syncSettingsSaving}
                    className="glass-btn-dark w-full rounded-lg px-3 py-2 text-sm disabled:opacity-50"
                  >
                    {syncSettingsSaving ? "Speichere…" : "Sync-Einstellungen speichern"}
                  </button>
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
