"use client";

import { useEffect, useMemo, useState } from "react";
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

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === selectedId) ?? null,
    [accounts, selectedId],
  );

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
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-4 flex items-center gap-2">
          <a href="/settings" className="text-sm text-gray-600 hover:underline">
            ← Einstellungen
          </a>
        </div>
        <h1 className="text-2xl font-semibold text-gray-900">IMAP-Konten</h1>
        <p className="mt-1 text-sm text-gray-600">
          Verbindungsdaten werden serverseitig verschlüsselt gespeichert.
        </p>

        {feedback ? (
          <p
            className={`mt-3 rounded-md px-3 py-2 text-sm ${
              feedback.kind === "error"
                ? "bg-red-50 text-red-700"
                : "bg-green-50 text-green-700"
            }`}
          >
            {feedback.text}
          </p>
        ) : null}

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-sm font-semibold">Vorhandene Konten</h2>
            {loading ? (
              <p className="mt-3 text-sm text-gray-600">Lade Konten...</p>
            ) : null}
            {!loading && accounts.length === 0 ? (
              <p className="mt-3 text-sm text-gray-500">Noch kein Konto angelegt.</p>
            ) : null}
            <ul className="mt-3 space-y-2">
              {accounts.map((account) => (
                <li key={account.id}>
                  <button
                    onClick={() => setSelectedId(account.id)}
                    className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                      selectedId === account.id
                        ? "border-gray-900 bg-gray-50"
                        : "border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    <p className="font-medium">{account.name}</p>
                    <p className="text-xs text-gray-600">{account.imapUsername}</p>
                  </button>
                </li>
              ))}
            </ul>

            {selectedAccount ? (
              <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
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
                <p className="mt-2 border-t border-gray-200 pt-2">
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
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-xs"
                  >
                    Verbindung testen
                  </button>
                  <button
                    onClick={deleteSelected}
                    className="rounded-md border border-red-300 px-3 py-1.5 text-xs text-red-700"
                  >
                    Konto löschen
                  </button>
                </div>
              </div>
            ) : null}

            {selectedAccount ? (
              <form
                onSubmit={updateSelected}
                className="mt-4 space-y-2 rounded-lg border border-gray-200 bg-white p-3 text-sm"
              >
                <p className="font-semibold text-gray-900">Ausgewähltes Konto bearbeiten</p>
                <input
                  placeholder="Name"
                  value={editForm.name}
                  onChange={(e) => setEditForm((v) => ({ ...v, name: e.target.value }))}
                  className="w-full rounded border border-gray-300 px-3 py-2"
                  required
                />
                <input
                  placeholder="IMAP Host"
                  value={editForm.imapHost}
                  onChange={(e) => setEditForm((v) => ({ ...v, imapHost: e.target.value }))}
                  className="w-full rounded border border-gray-300 px-3 py-2"
                  required
                />
                <input
                  placeholder="IMAP Port"
                  type="number"
                  value={editForm.imapPort}
                  onChange={(e) => setEditForm((v) => ({ ...v, imapPort: Number(e.target.value) }))}
                  className="w-full rounded border border-gray-300 px-3 py-2"
                  required
                />
                <input
                  placeholder="IMAP Benutzer"
                  value={editForm.imapUsername}
                  onChange={(e) => setEditForm((v) => ({ ...v, imapUsername: e.target.value }))}
                  className="w-full rounded border border-gray-300 px-3 py-2"
                  required
                />
                <input
                  placeholder="IMAP Passwort (leer lassen = unverändert)"
                  type="password"
                  value={editForm.imapPassword}
                  onChange={(e) => setEditForm((v) => ({ ...v, imapPassword: e.target.value }))}
                  className="w-full rounded border border-gray-300 px-3 py-2"
                />
                <label className="flex items-center gap-2 text-xs text-gray-700">
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

                <div className="mt-2 border-t border-gray-200 pt-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  SMTP
                </div>
                <input
                  placeholder="SMTP Host"
                  value={editForm.smtpHost}
                  onChange={(e) => setEditForm((v) => ({ ...v, smtpHost: e.target.value }))}
                  className="w-full rounded border border-gray-300 px-3 py-2"
                  required
                />
                <input
                  placeholder="SMTP Port"
                  type="number"
                  value={editForm.smtpPort}
                  onChange={(e) => setEditForm((v) => ({ ...v, smtpPort: Number(e.target.value) }))}
                  className="w-full rounded border border-gray-300 px-3 py-2"
                  required
                />
                <label className="flex items-center gap-2 text-xs text-gray-700">
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
                      className="w-full rounded border border-gray-300 px-3 py-2"
                      required
                    />
                    <input
                      placeholder="SMTP Passwort (leer lassen = unverändert)"
                      type="password"
                      value={editForm.smtpPassword}
                      onChange={(e) => setEditForm((v) => ({ ...v, smtpPassword: e.target.value }))}
                      className="w-full rounded border border-gray-300 px-3 py-2"
                    />
                  </>
                ) : null}
                <input
                  placeholder="SMTP Absendername (optional)"
                  value={editForm.smtpFromName}
                  onChange={(e) => setEditForm((v) => ({ ...v, smtpFromName: e.target.value }))}
                  className="w-full rounded border border-gray-300 px-3 py-2"
                />
                <label className="flex items-center gap-2 text-xs text-gray-700">
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
                  className="w-full rounded-md bg-gray-900 px-3 py-2 text-sm text-white"
                >
                  Änderungen speichern
                </button>
              </form>
            ) : null}
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-sm font-semibold">Neues Konto (IMAP + SMTP)</h2>
            <form onSubmit={addAccount} className="mt-3 space-y-2 text-sm">
              <input
                placeholder="Name"
                value={form.name}
                onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))}
                className="w-full rounded border border-gray-300 px-3 py-2"
                required
              />
              <input
                placeholder="Host"
                value={form.imapHost}
                onChange={(e) => setForm((v) => ({ ...v, imapHost: e.target.value }))}
                className="w-full rounded border border-gray-300 px-3 py-2"
                required
              />
              <input
                placeholder="Port"
                type="number"
                value={form.imapPort}
                onChange={(e) => setForm((v) => ({ ...v, imapPort: Number(e.target.value) }))}
                className="w-full rounded border border-gray-300 px-3 py-2"
                required
              />
              <input
                placeholder="Benutzername"
                value={form.imapUsername}
                onChange={(e) => setForm((v) => ({ ...v, imapUsername: e.target.value }))}
                className="w-full rounded border border-gray-300 px-3 py-2"
                required
              />
              <input
                placeholder="Passwort"
                type="password"
                value={form.imapPassword}
                onChange={(e) => setForm((v) => ({ ...v, imapPassword: e.target.value }))}
                className="w-full rounded border border-gray-300 px-3 py-2"
                required
              />
              <label className="flex items-center gap-2 text-xs text-gray-700">
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

              <div className="mt-3 border-t border-gray-200 pt-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                SMTP (Versand)
              </div>
              <input
                placeholder="SMTP Host"
                value={form.smtpHost}
                onChange={(e) => setForm((v) => ({ ...v, smtpHost: e.target.value }))}
                className="w-full rounded border border-gray-300 px-3 py-2"
                required
              />
              <input
                placeholder="SMTP Port"
                type="number"
                value={form.smtpPort}
                onChange={(e) => setForm((v) => ({ ...v, smtpPort: Number(e.target.value) }))}
                className="w-full rounded border border-gray-300 px-3 py-2"
                required
              />
              <label className="flex items-center gap-2 text-xs text-gray-700">
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
                    className="w-full rounded border border-gray-300 px-3 py-2"
                    required
                  />
                  <input
                    placeholder="SMTP Passwort"
                    type="password"
                    value={form.smtpPassword}
                    onChange={(e) => setForm((v) => ({ ...v, smtpPassword: e.target.value }))}
                    className="w-full rounded border border-gray-300 px-3 py-2"
                    required
                  />
                </>
              ) : null}
              <input
                placeholder="SMTP Absendername (optional)"
                value={form.smtpFromName}
                onChange={(e) => setForm((v) => ({ ...v, smtpFromName: e.target.value }))}
                className="w-full rounded border border-gray-300 px-3 py-2"
              />
              <label className="flex items-center gap-2 text-xs text-gray-700">
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
                className="w-full rounded-md bg-gray-900 px-3 py-2 text-sm text-white"
              >
                Konto speichern
              </button>
            </form>
          </section>
        </div>
      </div>
    </main>
  );
}
