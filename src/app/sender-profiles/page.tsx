"use client";

import { useEffect, useState, useCallback } from "react";

type SenderProfile = {
  id: string;
  profileName: string;
  patterns: string[];
  category: string;
  targetFolder: string;
  accountId: string | null;
  isActive: boolean;
  emailCount: number;
  autoLabels: string[];
  createdAt: string;
};

type FolderInfo = { path: string; count: number };
type ImapFolder = { path: string; name: string; totalCount?: number };
type AccountInfo = { id: string; name: string };
type LabelInfo = { id: string; name: string; color: string | null };

const CATEGORIES = [
  "Kunde",
  "Lieferant",
  "Subunternehmer",
  "Privat",
  "Werbung",
  "Sonstiges",
];

export default function SenderProfilesPage() {
  const [profiles, setProfiles] = useState<SenderProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [imapFolders, setImapFolders] = useState<ImapFolder[]>([]);
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [availableLabels, setAvailableLabels] = useState<LabelInfo[]>([]);
  const [search, setSearch] = useState("");

  const [showEditor, setShowEditor] = useState(false);
  const [editingProfile, setEditingProfile] = useState<SenderProfile | null>(null);
  const [profileName, setProfileName] = useState("");
  const [patterns, setPatterns] = useState<string[]>([]);
  const [patternInput, setPatternInput] = useState("");
  const [category, setCategory] = useState("Sonstiges");
  const [targetFolder, setTargetFolder] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [useNewFolder, setUseNewFolder] = useState(false);
  const [accountId, setAccountId] = useState<string>("");
  const [autoLabels, setAutoLabels] = useState<string[]>([]);
  const [autoLabelInput, setAutoLabelInput] = useState("");
  const [applyExisting, setApplyExisting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [applyProgress, setApplyProgress] = useState<string>("");
  const [applyResult, setApplyResult] = useState<{
    id: string;
    moved: number;
    errors: number;
    errorDetails?: { emailId: string; from: string | null; subject: string | null; folder: string | null; message: string }[];
  } | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  const loadProfiles = useCallback(async () => {
    setLoading(true);
    try {
      const q = search ? `?q=${encodeURIComponent(search)}` : "";
      const res = await fetch(`/api/sender-profiles${q}`);
      const data = await res.json();
      setProfiles(data.profiles ?? []);
    } catch {
      setError("Profile konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [search]);

  const loadMeta = useCallback(async () => {
    try {
      const [foldersRes, accountsRes, labelsRes] = await Promise.all([
        fetch("/api/rules/categories"),
        fetch("/api/accounts"),
        fetch("/api/labels"),
      ]);
      const foldersData = await foldersRes.json();
      setFolders(foldersData.folders ?? []);
      if (accountsRes.ok) {
        const accountsData = await accountsRes.json();
        setAccounts(
          (accountsData.accounts ?? []).map((a: { id: string; name: string }) => ({
            id: a.id,
            name: a.name,
          })),
        );
      }
      if (labelsRes.ok) {
        const labelsData = await labelsRes.json();
        setAvailableLabels(
          (labelsData.labels ?? []).map((l: LabelInfo) => ({
            id: l.id,
            name: l.name,
            color: l.color ?? null,
          })),
        );
      }
    } catch {
      /* ignore */
    }
  }, []);

  const loadImapFolders = useCallback(async (accId: string) => {
    if (!accId) {
      setImapFolders([]);
      return;
    }
    try {
      const res = await fetch(`/api/accounts/${accId}/folders`);
      if (res.ok) {
        const data = await res.json();
        const list: ImapFolder[] = (data.folders ?? []).map((f: { path: string; name: string; totalCount?: number }) => ({
          path: f.path,
          name: f.name ?? f.path,
          totalCount: f.totalCount ?? 0,
        }));
        list.sort((a, b) => a.path.localeCompare(b.path));
        setImapFolders(list);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadProfiles();
      void loadMeta();
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void loadProfiles(), 300);
    return () => clearTimeout(timer);
  }, [search, loadProfiles]);

  function resetEditor() {
    setEditingProfile(null);
    setProfileName("");
    setPatterns([]);
    setPatternInput("");
    setCategory("Sonstiges");
    setTargetFolder("");
    setNewFolderName("");
    setUseNewFolder(false);
    setAccountId("");
    setAutoLabels([]);
    setAutoLabelInput("");
    setApplyExisting(false);
    setError("");
  }

  function openEditor(profile?: SenderProfile) {
    resetEditor();
    if (profile) {
      setEditingProfile(profile);
      setProfileName(profile.profileName);
      setPatterns([...profile.patterns]);
      setCategory(profile.category);
      setTargetFolder(profile.targetFolder);
      setAccountId(profile.accountId ?? "");
      setAutoLabels([...(profile.autoLabels ?? [])]);
      if (profile.accountId) {
        void loadImapFolders(profile.accountId);
      }
    }
    setShowEditor(true);
  }

  function addPattern() {
    const val = patternInput.trim().toLowerCase();
    if (!val || patterns.includes(val)) return;
    setPatterns((prev) => [...prev, val]);
    setPatternInput("");
  }

  function removePattern(index: number) {
    setPatterns((prev) => prev.filter((_, i) => i !== index));
  }

  function toggleAutoLabel(name: string) {
    setAutoLabels((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  }

  function addAutoLabelFromInput() {
    const val = autoLabelInput.trim();
    if (!val || autoLabels.includes(val)) return;
    setAutoLabels((prev) => [...prev, val]);
    setAutoLabelInput("");
  }

  async function handleSave() {
    if (!profileName.trim()) {
      setError("Bitte einen Firmennamen eingeben.");
      return;
    }
    if (patterns.length === 0) {
      setError("Mindestens ein Absender-Muster hinzufügen.");
      return;
    }
    const folder = useNewFolder ? newFolderName.trim() : targetFolder;
    if (!folder) {
      setError("Bitte einen Zielordner wählen oder erstellen.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const cleanedAutoLabels = [...new Set(autoLabels.map((l) => l.trim()).filter(Boolean))];

      for (const labelName of cleanedAutoLabels) {
        if (!availableLabels.some((l) => l.name === labelName)) {
          await fetch("/api/labels", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: labelName }),
          }).catch(() => {});
        }
      }

      const payload = {
        profileName: profileName.trim(),
        patterns,
        category,
        targetFolder: folder,
        autoLabels: cleanedAutoLabels,
        ...(accountId ? { accountId } : {}),
      };

      const url = editingProfile
        ? `/api/sender-profiles/${editingProfile.id}`
        : "/api/sender-profiles";
      const method = editingProfile ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Speichern fehlgeschlagen");
        return;
      }

      if (!editingProfile && applyExisting) {
        const profileId = data.profile?.id;
        if (profileId) {
          await fetch(`/api/sender-profiles/${profileId}/apply`, {
            method: "POST",
          });
        }
      }

      setShowEditor(false);
      resetEditor();
      await loadProfiles();
      await loadMeta();
    } catch {
      setError("Speichern fehlgeschlagen");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Absender-Profil wirklich löschen?")) return;
    await fetch(`/api/sender-profiles/${id}`, { method: "DELETE" });
    await loadProfiles();
  }

  async function handleApply(id: string) {
    if (!window.confirm("Alle passenden E-Mails rückwirkend in den Zielordner verschieben?"))
      return;
    setApplyingId(id);
    setApplyResult(null);
    setApplyProgress("Suche passende E-Mails…");
    try {
      const res = await fetch(`/api/sender-profiles/${id}/apply`, {
        method: "POST",
      });
      setApplyProgress("Verschiebe E-Mails…");
      const data = await res.json();
      if (res.ok) {
        setApplyResult({ id, moved: data.moved ?? 0, errors: data.errors ?? 0, errorDetails: data.errorDetails ?? [] });
        setShowErrors(false);
        await loadProfiles();
      } else {
        setError(data.error ?? "Anwenden fehlgeschlagen");
      }
    } catch {
      setError("Anwenden fehlgeschlagen");
    } finally {
      setApplyingId(null);
      setApplyProgress("");
    }
  }

  return (
    <main className="min-h-screen p-4 md:p-6 max-w-5xl mx-auto">
      <div className="mb-2 flex items-center gap-2">
        <a href="/mail" className="text-sm glass-text-secondary hover:underline">
          ← Zurück zur Mail
        </a>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-semibold glass-text-primary">
            Absender-Profile
          </h1>
          <p className="text-sm glass-text-secondary mt-1">
            Absender klassifizieren und automatisch in Ordner sortieren
          </p>
        </div>
        <button
          onClick={() => openEditor()}
          className="glass-btn px-4 py-2 rounded-xl text-sm font-medium bg-blue-600/20 hover:bg-blue-600/30 text-blue-300"
        >
          + Neues Profil
        </button>
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Suchen nach Name, Domain, Kategorie..."
          className="glass-input w-full rounded-lg px-3 py-2 text-sm"
        />
      </div>

      {/* Editor */}
      {showEditor && (
        <div className="glass rounded-xl p-4 md:p-6 mb-6">
          <h2 className="text-sm font-semibold glass-text-primary mb-4">
            {editingProfile ? "Profil bearbeiten" : "Neues Absender-Profil"}
          </h2>

          {error && (
            <div className="text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2 mb-4">
              {error}
            </div>
          )}

          <div className="space-y-4">
            {/* Profile Name */}
            <div>
              <label className="block text-xs glass-text-secondary mb-1">
                Firmenname / Anzeigename
              </label>
              <input
                type="text"
                className="glass rounded-lg px-3 py-2 text-sm glass-text-primary w-full"
                placeholder="z.B. Spidersys, Amazon, Max Müller"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
              />
            </div>

            {/* Patterns (Tags/Chips) */}
            <div>
              <label className="block text-xs glass-text-secondary mb-1">
                Absender-Muster
              </label>
              <div className="flex flex-wrap gap-2 mb-2">
                {patterns.map((p, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 rounded-full bg-blue-600/20 px-3 py-1 text-xs text-gray-900 dark:text-gray-100"
                  >
                    {p}
                    <button
                      type="button"
                      onClick={() => removePattern(i)}
                      className="text-blue-400 hover:text-red-400 ml-1"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="glass rounded-lg px-3 py-2 text-sm glass-text-primary flex-1"
                  placeholder="z.B. spidersys.de, *@amazon.*, user@example.com"
                  value={patternInput}
                  onChange={(e) => setPatternInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addPattern();
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={addPattern}
                  className="glass-btn px-3 py-2 rounded-lg text-sm"
                >
                  Hinzufügen
                </button>
              </div>
              <p className="text-[11px] glass-text-tertiary mt-1">
                Domain (spidersys.de), exakte E-Mail (user@example.com) oder
                Wildcard (*@spidersys.*)
              </p>
            </div>

            {/* Category */}
            <div>
              <label className="block text-xs glass-text-secondary mb-1">
                Kategorie
              </label>
              <select
                className="glass rounded-lg px-3 py-2 text-sm glass-text-primary w-full"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {/* Account – zuerst wählen, damit die IMAP-Ordner geladen werden */}
            {accounts.length > 0 && (
              <div>
                <label className="block text-xs glass-text-secondary mb-1">
                  Konto
                </label>
                <select
                  className="glass rounded-lg px-3 py-2 text-sm glass-text-primary w-full"
                  value={accountId}
                  onChange={(e) => {
                    setAccountId(e.target.value);
                    setTargetFolder("");
                    void loadImapFolders(e.target.value);
                  }}
                >
                  <option value="">Alle Konten</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Target Folder */}
            <div>
              <label className="block text-xs glass-text-secondary mb-1">
                Zielordner
                {!accountId && accounts.length > 0 && (
                  <span className="text-gray-700 dark:text-gray-300 ml-2">(Erst Konto wählen für Server-Ordner)</span>
                )}
              </label>
              {!useNewFolder ? (
                <div className="flex gap-2">
                  <select
                    className="glass rounded-lg px-3 py-2 text-sm glass-text-primary flex-1"
                    value={targetFolder}
                    onChange={(e) => setTargetFolder(e.target.value)}
                  >
                    <option value="">Ordner wählen…</option>
                    {imapFolders.length > 0
                      ? imapFolders.map((f) => (
                          <option key={f.path} value={f.path}>
                            {f.path}{f.totalCount ? ` (${f.totalCount})` : ""}
                          </option>
                        ))
                      : folders.map((f) => (
                          <option key={f.path} value={f.path}>
                            {f.path} ({f.count})
                          </option>
                        ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setUseNewFolder(true)}
                    className="glass-btn px-3 py-2 rounded-lg text-xs whitespace-nowrap"
                  >
                    Neuer Ordner
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="glass rounded-lg px-3 py-2 text-sm glass-text-primary flex-1"
                    placeholder="z.B. INBOX/Subunternehmer/Spidersys"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setUseNewFolder(false);
                      setNewFolderName("");
                    }}
                    className="glass-btn px-3 py-2 rounded-lg text-xs whitespace-nowrap"
                  >
                    Bestehender
                  </button>
                </div>
              )}
            </div>

            {/* Auto-Labels */}
            <div>
              <label className="block text-xs glass-text-secondary mb-1">
                Auto-Labels
              </label>
              <p className="text-[11px] glass-text-tertiary mb-2">
                Werden beim Verschieben nach dem Lesen automatisch gesetzt.
              </p>
              <div className="flex flex-wrap gap-2 mb-2">
                {availableLabels.map((label) => {
                  const checked = autoLabels.includes(label.name);
                  return (
                    <label
                      key={label.id}
                      className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs glass-text-secondary cursor-pointer hover:bg-white/10"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleAutoLabel(label.name)}
                        className="rounded"
                      />
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: label.color || "#6b7280" }}
                      />
                      {label.name}
                    </label>
                  );
                })}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="glass rounded-lg px-3 py-2 text-sm glass-text-primary flex-1"
                  placeholder="Neues Label…"
                  value={autoLabelInput}
                  onChange={(e) => setAutoLabelInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addAutoLabelFromInput();
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={addAutoLabelFromInput}
                  className="glass-btn px-3 py-2 rounded-lg text-sm"
                >
                  Hinzufügen
                </button>
              </div>
              {autoLabels.some((n) => !availableLabels.some((l) => l.name === n)) ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {autoLabels
                    .filter((n) => !availableLabels.some((l) => l.name === n))
                    .map((name) => (
                      <span
                        key={name}
                        className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[11px] glass-text-secondary"
                      >
                        {name}
                        <button
                          type="button"
                          onClick={() => toggleAutoLabel(name)}
                          className="hover:text-red-400"
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                </div>
              ) : null}
            </div>

            {/* Apply to existing */}
            {!editingProfile && (
              <label className="flex items-center gap-2 text-xs glass-text-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={applyExisting}
                  onChange={(e) => setApplyExisting(e.target.checked)}
                  className="rounded"
                />
                Auf bestehende E-Mails anwenden
              </label>
            )}

            <div className="glass-divider" />

            {/* Save / Cancel */}
            <div className="flex gap-3">
              <button
                onClick={handleSave}
                disabled={saving}
                className="glass-btn px-4 py-2 rounded-xl text-sm font-medium bg-blue-600/20 hover:bg-blue-600/30 text-blue-300"
              >
                {saving
                  ? "Speichere…"
                  : editingProfile
                    ? "Aktualisieren"
                    : "Profil erstellen"}
              </button>
              <button
                onClick={() => {
                  setShowEditor(false);
                  resetEditor();
                }}
                className="glass-btn px-4 py-2 rounded-xl text-sm"
              >
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Profiles List */}
      {loading ? (
        <div className="glass rounded-xl p-6 text-center">
          <p className="text-sm glass-text-secondary">Lade Profile…</p>
        </div>
      ) : profiles.length === 0 ? (
        <div className="glass rounded-xl p-6 text-center">
          <p className="text-sm glass-text-secondary">
            {search
              ? "Keine Profile gefunden."
              : "Noch keine Absender-Profile vorhanden. Erstelle dein erstes Profil oder verschiebe eine E-Mail per Drag&Drop – danach kannst du die Regel merken."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {profiles.map((profile) => (
            <div key={profile.id} className="glass rounded-xl p-4">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium glass-text-primary">
                      {profile.profileName}
                    </span>
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-600/20 text-gray-900 dark:text-gray-100">
                      {profile.category}
                    </span>
                    <span className="text-[11px] glass-text-tertiary">
                      {profile.emailCount} E-Mails
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {profile.patterns.map((p, i) => (
                      <span
                        key={i}
                        className="text-[11px] px-1.5 py-0.5 rounded bg-white/10 glass-text-secondary"
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                  <p className="text-[11px] glass-text-tertiary mt-1 truncate">
                    → {profile.targetFolder}
                  </p>
                  {(profile.autoLabels ?? []).length > 0 ? (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(profile.autoLabels ?? []).map((label) => (
                        <span
                          key={label}
                          className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-600/20 text-emerald-200"
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center gap-1 shrink-0 flex-wrap">
                  <button
                    onClick={() => openEditor(profile)}
                    className="glass-btn px-2 py-1 rounded-lg text-xs"
                  >
                    Bearbeiten
                  </button>
                  <button
                    onClick={() => handleApply(profile.id)}
                    disabled={applyingId === profile.id}
                    className="glass-btn px-2 py-1 rounded-lg text-xs bg-green-600/20 hover:bg-green-600/30 text-green-300 disabled:opacity-50"
                  >
                    {applyingId === profile.id ? (
                      <span className="inline-flex items-center gap-1">
                        <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Verschiebe…
                      </span>
                    ) : "Rückwirkend"}
                  </button>
                  <button
                    onClick={() => handleDelete(profile.id)}
                    className="glass-btn px-2 py-1 rounded-lg text-xs text-red-400 hover:text-red-300"
                  >
                    Löschen
                  </button>
                </div>
              </div>
              {applyingId === profile.id && applyProgress && (
                <div className="mt-2 text-xs glass-text-secondary bg-blue-600/10 rounded-lg px-3 py-2 flex items-center gap-2">
                  <svg className="animate-spin h-3 w-3 text-blue-400" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  {applyProgress}
                </div>
              )}
              {applyResult?.id === profile.id && !applyingId && (
                <div className="mt-2 text-xs glass-text-secondary bg-green-600/10 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span>
                      ✓ {applyResult.moved} E-Mail{applyResult.moved !== 1 ? "s" : ""}{" "}
                      verschoben
                    </span>
                    {applyResult.errors > 0 && (
                      <button
                        onClick={() => setShowErrors((v) => !v)}
                        className="text-red-400 hover:text-red-300 underline cursor-pointer"
                      >
                        {applyResult.errors} Fehler {showErrors ? "▲" : "▼"}
                      </button>
                    )}
                  </div>
                  {showErrors && applyResult.errorDetails && applyResult.errorDetails.length > 0 && (
                    <div className="mt-2 space-y-1 max-h-48 overflow-y-auto border-t border-red-400/20 pt-2">
                      {applyResult.errorDetails.map((err, i) => (
                        <div key={i} className="bg-red-600/10 rounded px-2 py-1 text-[11px] text-red-300">
                          <div className="font-medium truncate">
                            {err.subject ?? "(Ohne Betreff)"} — <span className="text-red-400/80">{err.from ?? "unbekannt"}</span>
                          </div>
                          <div className="text-red-400/70 truncate">
                            Ordner: {err.folder ?? "?"} → Fehler: {err.message}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
