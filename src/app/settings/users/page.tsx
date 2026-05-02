"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type UserRole = "administrator" | "user";

type AppUser = {
  id: string;
  email: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
  _count: {
    mailAccounts: number;
    drafts: number;
  };
};

const emptyCreateForm = {
  email: "",
  password: "",
  role: "user" as UserRole,
};

const emptyEditForm = {
  email: "",
  password: "",
  role: "user" as UserRole,
};

function roleLabel(role: UserRole) {
  return role === "administrator" ? "Administrator" : "Benutzer";
}

export default function UsersSettingsPage() {
  const router = useRouter();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [editForm, setEditForm] = useState(emptyEditForm);
  const [feedback, setFeedback] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const selectedUser = useMemo(
    () => users.find((user) => user.id === selectedId) ?? null,
    [selectedId, users],
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

  async function loadCurrentUser() {
    const res = await fetch("/api/auth/me");
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (!res.ok) return;
    const data = (await res.json()) as { user?: { id: string } };
    setCurrentUserId(data.user?.id ?? "");
  }

  async function loadUsers() {
    setLoading(true);
    const res = await fetch("/api/users");
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (res.status === 403) {
      setFeedback({ kind: "error", text: "Nur Administratoren dürfen Benutzer verwalten." });
      setLoading(false);
      return;
    }
    if (!res.ok) {
      setFeedback({ kind: "error", text: await readError(res, "Benutzer konnten nicht geladen werden.") });
      setLoading(false);
      return;
    }

    const data = (await res.json()) as { users?: AppUser[] };
    const next = data.users ?? [];
    setUsers(next);
    if (next.length && !next.some((user) => user.id === selectedId)) {
      setSelectedId(next[0].id);
      setEditForm({
        email: next[0].email,
        password: "",
        role: next[0].role,
      });
    }
    if (!next.length) {
      setSelectedId("");
      setEditForm(emptyEditForm);
    }
    setLoading(false);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadCurrentUser();
      void loadUsers();
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: createForm.email.trim(),
        password: createForm.password,
        role: createForm.role,
      }),
    });
    if (!res.ok) {
      setFeedback({ kind: "error", text: await readError(res, "Benutzer konnte nicht angelegt werden.") });
      return;
    }
    setCreateForm(emptyCreateForm);
    setFeedback({ kind: "info", text: "Benutzer angelegt." });
    await loadUsers();
  }

  async function updateSelected(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedUser) return;
    setFeedback(null);

    const payload: Record<string, unknown> = {
      email: editForm.email.trim(),
      role: editForm.role,
    };
    if (editForm.password.trim()) payload.password = editForm.password;

    const res = await fetch(`/api/users/${selectedUser.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      setFeedback({ kind: "error", text: await readError(res, "Benutzer konnte nicht gespeichert werden.") });
      return;
    }
    setFeedback({ kind: "info", text: "Benutzer gespeichert." });
    await loadUsers();
  }

  async function deleteSelected() {
    if (!selectedUser) return;
    if (selectedUser.id === currentUserId) {
      setFeedback({ kind: "error", text: "Der eigene Benutzer kann nicht gelöscht werden." });
      return;
    }
    if (!window.confirm(`Benutzer ${selectedUser.email} wirklich löschen? Zugehörige lokale App-Daten werden entfernt.`)) {
      return;
    }

    setFeedback(null);
    const res = await fetch(`/api/users/${selectedUser.id}`, { method: "DELETE" });
    if (!res.ok) {
      setFeedback({ kind: "error", text: await readError(res, "Benutzer konnte nicht gelöscht werden.") });
      return;
    }
    setFeedback({ kind: "info", text: "Benutzer gelöscht." });
    await loadUsers();
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-2 flex items-center gap-2">
          <a href="/settings" className="text-sm text-gray-600 hover:underline">
            ← Zurück zu Einstellungen
          </a>
        </div>
        <h1 className="text-2xl font-semibold text-gray-900">Benutzerverwaltung</h1>
        <p className="mt-1 text-sm text-gray-600">
          App-Benutzer anlegen, Rollen vergeben, Passwörter zurücksetzen oder Benutzer löschen.
        </p>

        {feedback && (
          <div
            className={`mt-4 rounded-lg border p-3 text-sm ${
              feedback.kind === "error"
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-green-200 bg-green-50 text-green-700"
            }`}
          >
            {feedback.text}
          </div>
        )}

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_420px]">
          <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-gray-900">Benutzer</h2>
              <button
                type="button"
                onClick={loadUsers}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
              >
                Aktualisieren
              </button>
            </div>

            {loading ? (
              <p className="text-sm text-gray-600">Lade Benutzer...</p>
            ) : users.length === 0 ? (
              <p className="text-sm text-gray-600">Keine Benutzer vorhanden.</p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-gray-200">
                {users.map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(user.id);
                      setEditForm({
                        email: user.email,
                        password: "",
                        role: user.role,
                      });
                    }}
                    className={`block w-full border-b border-gray-200 p-4 text-left last:border-b-0 ${
                      user.id === selectedId ? "bg-blue-50" : "bg-white hover:bg-gray-50"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium text-gray-900">{user.email}</p>
                        <p className="mt-1 text-xs text-gray-500">
                          Erstellt am {new Date(user.createdAt).toLocaleString("de-DE")}
                        </p>
                      </div>
                      <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                        {roleLabel(user.role)}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-gray-500">
                      {user._count.mailAccounts} Mailkonto/-konten, {user._count.drafts} Entwurf/Entwürfe
                      {user.id === currentUserId ? " · aktuell angemeldet" : ""}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </section>

          <div className="space-y-6">
            <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900">Neuen Benutzer anlegen</h2>
              <form onSubmit={createUser} className="mt-4 space-y-3">
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">E-Mail</span>
                  <input
                    value={createForm.email}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, email: e.target.value }))}
                    type="email"
                    required
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Startpasswort</span>
                  <input
                    value={createForm.password}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, password: e.target.value }))}
                    type="password"
                    minLength={6}
                    required
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Rolle</span>
                  <select
                    value={createForm.role}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, role: e.target.value as UserRole }))}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  >
                    <option value="user">Benutzer</option>
                    <option value="administrator">Administrator</option>
                  </select>
                </label>
                <button
                  type="submit"
                  className="w-full rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
                >
                  Benutzer anlegen
                </button>
              </form>
            </section>

            <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900">Ausgewählten Benutzer bearbeiten</h2>
              {selectedUser ? (
                <form onSubmit={updateSelected} className="mt-4 space-y-3">
                  <label className="block">
                    <span className="text-sm font-medium text-gray-700">E-Mail</span>
                    <input
                      value={editForm.email}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, email: e.target.value }))}
                      type="email"
                      required
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium text-gray-700">Neues Passwort</span>
                    <input
                      value={editForm.password}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, password: e.target.value }))}
                      type="password"
                      minLength={6}
                      placeholder="Leer lassen, um es nicht zu ändern"
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium text-gray-700">Rolle</span>
                    <select
                      value={editForm.role}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, role: e.target.value as UserRole }))}
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    >
                      <option value="user">Benutzer</option>
                      <option value="administrator">Administrator</option>
                    </select>
                  </label>
                  <div className="flex flex-wrap gap-2 pt-2">
                    <button
                      type="submit"
                      className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
                    >
                      Speichern
                    </button>
                    <button
                      type="button"
                      onClick={deleteSelected}
                      className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
                    >
                      Löschen
                    </button>
                  </div>
                </form>
              ) : (
                <p className="mt-4 text-sm text-gray-600">Bitte einen Benutzer auswählen.</p>
              )}
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
