"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

type EmailLabel = {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  emailCount: number;
  createdAt: string;
};

const PRESET_COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#eab308",
  "#84cc16", "#22c55e", "#14b8a6", "#06b6d4",
  "#3b82f6", "#6366f1", "#8b5cf6", "#a855f7",
  "#d946ef", "#ec4899", "#f43f5e", "#78716c",
];

export default function LabelsPage() {
  const [labels, setLabels] = useState<EmailLabel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [showEditor, setShowEditor] = useState(false);
  const [editingLabel, setEditingLabel] = useState<EmailLabel | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#3b82f6");
  const [saving, setSaving] = useState(false);

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const loadLabels = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/labels");
      const data = await res.json();
      setLabels(data.labels ?? []);
    } catch {
      setError("Labels konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadLabels();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadLabels]);

  function openCreate() {
    setEditingLabel(null);
    setName("");
    setColor("#3b82f6");
    setShowEditor(true);
    setError("");
  }

  function openEdit(label: EmailLabel) {
    setEditingLabel(label);
    setName(label.name);
    setColor(label.color ?? "#3b82f6");
    setShowEditor(true);
    setError("");
  }

  async function handleSave() {
    if (!name.trim()) {
      setError("Name darf nicht leer sein.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (editingLabel) {
        const res = await fetch(`/api/labels/${editingLabel.id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: name.trim(), color }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError((data as { error?: string }).error ?? "Fehler beim Speichern.");
          return;
        }
        setSuccess("Label aktualisiert.");
      } else {
        const res = await fetch("/api/labels", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: name.trim(), color }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError((data as { error?: string }).error ?? "Fehler beim Erstellen.");
          return;
        }
        setSuccess("Label erstellt.");
      }
      setShowEditor(false);
      await loadLabels();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setError("");
    try {
      const res = await fetch(`/api/labels/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? "Fehler beim Löschen.");
        return;
      }
      setDeleteConfirmId(null);
      setSuccess("Label gelöscht.");
      await loadLabels();
    } catch {
      setError("Label konnte nicht gelöscht werden.");
    }
  }

  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(""), 3000);
    return () => clearTimeout(t);
  }, [success]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold glass-text-primary">Labels</h1>
          <p className="mt-1 text-sm glass-text-secondary">
            Labels erstellen und verwalten, um E-Mails zu organisieren.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/settings"
            className="glass-btn rounded-lg px-3 py-2 text-sm"
          >
            ← Einstellungen
          </Link>
          <button
            onClick={openCreate}
            className="glass-btn-primary rounded-lg px-4 py-2 text-sm font-medium"
          >
            Neues Label
          </button>
        </div>
      </div>

      {error ? (
        <p className="mb-4 rounded-lg glass-error px-4 py-2 text-sm text-red-600">{error}</p>
      ) : null}
      {success ? (
        <p className="mb-4 rounded-lg glass-info px-4 py-2 text-sm text-green-600">{success}</p>
      ) : null}

      {showEditor ? (
        <div className="mb-6 glass-solid rounded-xl p-4">
          <h2 className="mb-3 text-lg font-semibold glass-text-primary">
            {editingLabel ? "Label bearbeiten" : "Neues Label"}
          </h2>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium glass-text-secondary">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="glass-input w-full rounded-lg px-3 py-2 text-sm"
                placeholder="z.B. Rechnung, Angebot, Vertrag..."
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium glass-text-secondary">Farbe</label>
              <div className="flex flex-wrap gap-2">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={`h-8 w-8 rounded-full border-2 transition-transform ${
                      color === c ? "scale-110 border-white ring-2 ring-blue-400" : "border-transparent"
                    }`}
                    style={{ backgroundColor: c }}
                    title={c}
                  />
                ))}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-8 w-8 cursor-pointer rounded border-0"
                />
                <span className="text-xs glass-text-muted">{color}</span>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => void handleSave()}
                disabled={saving}
                className="glass-btn-primary rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {saving ? "Speichern..." : "Speichern"}
              </button>
              <button
                onClick={() => setShowEditor(false)}
                className="glass-btn rounded-lg px-4 py-2 text-sm"
              >
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm glass-text-muted">Laden...</p>
      ) : labels.length === 0 ? (
        <div className="glass-solid rounded-xl p-8 text-center">
          <p className="text-sm glass-text-secondary">Noch keine Labels vorhanden.</p>
          <button
            onClick={openCreate}
            className="mt-3 glass-btn-primary rounded-lg px-4 py-2 text-sm"
          >
            Erstes Label erstellen
          </button>
        </div>
      ) : (
        <ul className="space-y-2">
          {labels.map((label) => (
            <li
              key={label.id}
              className="glass-solid flex items-center gap-3 rounded-xl px-4 py-3"
            >
              <span
                className="h-4 w-4 shrink-0 rounded-full"
                style={{ backgroundColor: label.color ?? "#6b7280" }}
              />
              <span className="min-w-0 flex-1">
                <span className="block font-medium glass-text-primary">{label.name}</span>
                <span className="block text-xs glass-text-muted">
                  {label.emailCount} {label.emailCount === 1 ? "E-Mail" : "E-Mails"}
                </span>
              </span>
              <div className="flex shrink-0 gap-1">
                <button
                  onClick={() => openEdit(label)}
                  className="glass-btn rounded-lg px-2.5 py-1 text-xs"
                >
                  Bearbeiten
                </button>
                {deleteConfirmId === label.id ? (
                  <div className="flex gap-1">
                    <button
                      onClick={() => void handleDelete(label.id)}
                      className="rounded-lg bg-red-600 px-2.5 py-1 text-xs text-white hover:bg-red-700"
                    >
                      Löschen
                    </button>
                    <button
                      onClick={() => setDeleteConfirmId(null)}
                      className="glass-btn rounded-lg px-2.5 py-1 text-xs"
                    >
                      Abbrechen
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setDeleteConfirmId(label.id)}
                    className="glass-btn rounded-lg px-2.5 py-1 text-xs text-red-500 hover:text-red-400"
                  >
                    Löschen
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
