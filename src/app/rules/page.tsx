"use client";

import { useEffect, useState, useCallback } from "react";

type RuleRow = {
  id: string;
  name: string;
  active: boolean;
  priority: number;
  conditionJson: unknown;
  actionJson: unknown;
};

type CategoryInfo = { name: string; count: number };
type FolderInfo = { path: string; count: number };

type LeafCondition = {
  field: string;
  operator: string;
  value: string | boolean;
};

type RuleActionItem = {
  type: string;
  value?: string;
};

type Suggestion = {
  description: string;
  condition: unknown;
  action: unknown;
  affectedCount: number;
  folderCount: number;
  category: string;
};

type PreviewResult = {
  count: number;
  sample: Array<{
    id: string;
    subject: string | null;
    fromEmail: string | null;
    fromName: string | null;
    folderPath: string;
    date: string | null;
  }>;
};

const FIELD_OPTIONS: { value: string; label: string }[] = [
  { value: "fromEmail", label: "Absender-E-Mail" },
  { value: "fromDomain", label: "Absender-Domain" },
  { value: "subject", label: "Betreff" },
  { value: "aiCategory", label: "KI-Kategorie" },
  { value: "aiPriority", label: "KI-Priorität" },
  { value: "keywords", label: "Schlüsselwörter" },
  { value: "hasAttachments", label: "Hat Anhänge" },
];

const OPERATOR_OPTIONS: Record<string, { value: string; label: string }[]> = {
  fromEmail: [
    { value: "equals", label: "ist gleich" },
    { value: "contains", label: "enthält" },
    { value: "endsWith", label: "endet mit" },
  ],
  fromDomain: [{ value: "equals", label: "ist gleich" }],
  subject: [{ value: "contains", label: "enthält" }],
  aiCategory: [
    { value: "equals", label: "ist gleich" },
    { value: "contains", label: "enthält" },
  ],
  aiPriority: [
    { value: "equals", label: "ist gleich" },
  ],
  keywords: [
    { value: "equals", label: "ist gleich" },
    { value: "contains", label: "enthält" },
  ],
  hasAttachments: [{ value: "equals", label: "ist gleich" }],
};

const ACTION_OPTIONS: { value: string; label: string; needsValue: boolean }[] = [
  { value: "move_folder", label: "In Ordner verschieben", needsValue: true },
  { value: "set_category", label: "Kategorie setzen", needsValue: true },
  { value: "set_priority", label: "Priorität setzen", needsValue: true },
  { value: "move_trash", label: "In Papierkorb", needsValue: false },
  { value: "move_spam", label: "Als Spam markieren", needsValue: false },
  { value: "mark_newsletter", label: "Als Newsletter markieren", needsValue: false },
  { value: "queue_ai_analysis", label: "KI-Analyse anstoßen", needsValue: false },
];

const PRIORITY_VALUES = [
  { value: "low", label: "Niedrig" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "Hoch" },
  { value: "urgent", label: "Dringend" },
];

function formatDate(value: string | null) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.valueOf())) return "-";
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ConditionRow({
  condition,
  index,
  categories,
  onChange,
  onRemove,
}: {
  condition: LeafCondition;
  index: number;
  categories: CategoryInfo[];
  onChange: (index: number, c: LeafCondition) => void;
  onRemove: (index: number) => void;
}) {
  const operators = OPERATOR_OPTIONS[condition.field] ?? [];

  function handleFieldChange(field: string) {
    const newOps = OPERATOR_OPTIONS[field] ?? [];
    const op = newOps[0]?.value ?? "equals";
    const val = field === "hasAttachments" ? true : "";
    onChange(index, { field, operator: op, value: val });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className="glass rounded-lg px-3 py-2 text-sm glass-text-primary min-w-[140px]"
        value={condition.field}
        onChange={(e) => handleFieldChange(e.target.value)}
      >
        {FIELD_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {condition.field !== "hasAttachments" && (
        <select
          className="glass rounded-lg px-3 py-2 text-sm glass-text-primary"
          value={condition.operator}
          onChange={(e) => onChange(index, { ...condition, operator: e.target.value })}
        >
          {operators.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      )}

      {condition.field === "hasAttachments" ? (
        <select
          className="glass rounded-lg px-3 py-2 text-sm glass-text-primary"
          value={String(condition.value)}
          onChange={(e) => onChange(index, { ...condition, value: e.target.value === "true" })}
        >
          <option value="true">Ja</option>
          <option value="false">Nein</option>
        </select>
      ) : condition.field === "aiCategory" && categories.length > 0 ? (
        <select
          className="glass rounded-lg px-3 py-2 text-sm glass-text-primary flex-1 min-w-[120px]"
          value={String(condition.value)}
          onChange={(e) => onChange(index, { ...condition, value: e.target.value })}
        >
          <option value="">Kategorie wählen…</option>
          {categories.map((cat) => (
            <option key={cat.name} value={cat.name}>
              {cat.name} ({cat.count})
            </option>
          ))}
        </select>
      ) : condition.field === "aiPriority" ? (
        <select
          className="glass rounded-lg px-3 py-2 text-sm glass-text-primary"
          value={String(condition.value)}
          onChange={(e) => onChange(index, { ...condition, value: e.target.value })}
        >
          <option value="">Priorität wählen…</option>
          {PRIORITY_VALUES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          className="glass rounded-lg px-3 py-2 text-sm glass-text-primary flex-1 min-w-[120px]"
          placeholder="Wert"
          value={String(condition.value)}
          onChange={(e) => onChange(index, { ...condition, value: e.target.value })}
        />
      )}

      <button
        type="button"
        onClick={() => onRemove(index)}
        className="glass-btn px-2 py-1 rounded-lg text-red-400 hover:text-red-300 text-sm"
        title="Bedingung entfernen"
      >
        ✕
      </button>
    </div>
  );
}

function ActionRow({
  action,
  index,
  categories,
  folders,
  onChange,
  onRemove,
}: {
  action: RuleActionItem;
  index: number;
  categories: CategoryInfo[];
  folders: FolderInfo[];
  onChange: (index: number, a: RuleActionItem) => void;
  onRemove: (index: number) => void;
}) {
  const actionDef = ACTION_OPTIONS.find((a) => a.value === action.type);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className="glass rounded-lg px-3 py-2 text-sm glass-text-primary min-w-[180px]"
        value={action.type}
        onChange={(e) => {
          const newType = e.target.value;
          const def = ACTION_OPTIONS.find((a) => a.value === newType);
          onChange(index, { type: newType, value: def?.needsValue ? "" : undefined });
        }}
      >
        {ACTION_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {actionDef?.needsValue && action.type === "set_priority" && (
        <select
          className="glass rounded-lg px-3 py-2 text-sm glass-text-primary"
          value={action.value ?? ""}
          onChange={(e) => onChange(index, { ...action, value: e.target.value })}
        >
          <option value="">Priorität wählen…</option>
          {PRIORITY_VALUES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      )}

      {actionDef?.needsValue && action.type === "set_category" && (
        <input
          type="text"
          className="glass rounded-lg px-3 py-2 text-sm glass-text-primary flex-1 min-w-[120px]"
          placeholder="Kategorie-Name"
          value={action.value ?? ""}
          onChange={(e) => onChange(index, { ...action, value: e.target.value })}
          list="category-suggestions"
        />
      )}

      {actionDef?.needsValue && action.type === "move_folder" && (
        <>
          <input
            type="text"
            className="glass rounded-lg px-3 py-2 text-sm glass-text-primary flex-1 min-w-[120px]"
            placeholder="Ordnername"
            value={action.value ?? ""}
            onChange={(e) => onChange(index, { ...action, value: e.target.value })}
            list="folder-suggestions"
          />
          <datalist id="folder-suggestions">
            {folders.map((f) => (
              <option key={f.path} value={f.path} />
            ))}
          </datalist>
        </>
      )}

      <datalist id="category-suggestions">
        {categories.map((cat) => (
          <option key={cat.name} value={cat.name} />
        ))}
      </datalist>

      <button
        type="button"
        onClick={() => onRemove(index)}
        className="glass-btn px-2 py-1 rounded-lg text-red-400 hover:text-red-300 text-sm"
        title="Aktion entfernen"
      >
        ✕
      </button>
    </div>
  );
}

export default function RulesPage() {
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<CategoryInfo[]>([]);
  const [folders, setFolders] = useState<FolderInfo[]>([]);

  // Editor state
  const [showEditor, setShowEditor] = useState(false);
  const [editingRule, setEditingRule] = useState<RuleRow | null>(null);
  const [ruleName, setRuleName] = useState("");
  const [rulePriority, setRulePriority] = useState(100);
  const [conditionMode, setConditionMode] = useState<"all" | "any">("all");
  const [conditions, setConditions] = useState<LeafCondition[]>([
    { field: "fromEmail", operator: "contains", value: "" },
  ]);
  const [actions, setActions] = useState<RuleActionItem[]>([
    { type: "move_folder", value: "" },
  ]);
  const [stopAfterMatch, setStopAfterMatch] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Preview
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Suggestions
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const loadRules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/rules");
      const data = await res.json();
      setRules(data.rules ?? []);
    } catch {
      setError("Regeln konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCategories = useCallback(async () => {
    try {
      const res = await fetch("/api/rules/categories");
      const data = await res.json();
      setCategories(data.categories ?? []);
      setFolders(data.folders ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadRules();
      void loadCategories();
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetEditor() {
    setEditingRule(null);
    setRuleName("");
    setRulePriority(100);
    setConditionMode("all");
    setConditions([{ field: "fromEmail", operator: "contains", value: "" }]);
    setActions([{ type: "move_folder", value: "" }]);
    setStopAfterMatch(false);
    setPreview(null);
    setError("");
  }

  function openEditor(rule?: RuleRow) {
    resetEditor();
    if (rule) {
      setEditingRule(rule);
      setRuleName(rule.name);
      setRulePriority(rule.priority);

      const cond = rule.conditionJson as { all?: LeafCondition[]; any?: LeafCondition[] } | null;
      if (cond?.all && cond.all.length > 0) {
        setConditionMode("all");
        setConditions(cond.all as LeafCondition[]);
      } else if (cond?.any && cond.any.length > 0) {
        setConditionMode("any");
        setConditions(cond.any as LeafCondition[]);
      }

      const act = rule.actionJson as { actions?: RuleActionItem[]; stopAfterMatch?: boolean } | null;
      if (act?.actions) setActions(act.actions);
      if (act?.stopAfterMatch) setStopAfterMatch(true);
    }
    setShowEditor(true);
  }

  function buildConditionJson() {
    const leafs = conditions.filter((c) =>
      c.field === "hasAttachments" ? true : String(c.value).trim() !== "",
    );
    if (leafs.length === 0) return null;
    return { [conditionMode]: leafs };
  }

  function buildActionJson() {
    const validActions = actions.filter((a) => {
      const def = ACTION_OPTIONS.find((o) => o.value === a.type);
      if (!def) return false;
      if (def.needsValue && !a.value?.trim()) return false;
      return true;
    });
    if (validActions.length === 0) return null;
    return { actions: validActions, stopAfterMatch };
  }

  async function handlePreview() {
    const condJson = buildConditionJson();
    if (!condJson) {
      setError("Mindestens eine Bedingung mit Wert eingeben.");
      return;
    }
    setPreviewLoading(true);
    setError("");
    try {
      const res = await fetch("/api/rules/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conditionJson: condJson }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Vorschau fehlgeschlagen");
        return;
      }
      setPreview(data);
    } catch {
      setError("Vorschau fehlgeschlagen");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleSave() {
    const condJson = buildConditionJson();
    const actJson = buildActionJson();
    if (!ruleName.trim()) {
      setError("Bitte einen Regel-Namen eingeben.");
      return;
    }
    if (!condJson) {
      setError("Mindestens eine Bedingung mit Wert eingeben.");
      return;
    }
    if (!actJson) {
      setError("Mindestens eine gültige Aktion eingeben.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload = {
        name: ruleName.trim(),
        priority: rulePriority,
        active: true,
        conditionJson: condJson,
        actionJson: actJson,
      };
      const url = editingRule ? `/api/rules/${editingRule.id}` : "/api/rules";
      const method = editingRule ? "PUT" : "POST";
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
      setShowEditor(false);
      resetEditor();
      await loadRules();
    } catch {
      setError("Speichern fehlgeschlagen");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(ruleId: string) {
    if (!window.confirm("Regel wirklich löschen?")) return;
    await fetch(`/api/rules/${ruleId}`, { method: "DELETE" });
    await loadRules();
  }

  async function handleToggleActive(rule: RuleRow) {
    await fetch(`/api/rules/${rule.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !rule.active }),
    });
    await loadRules();
  }

  async function loadSuggestions() {
    setSuggestionsLoading(true);
    try {
      const res = await fetch("/api/rules/suggestions");
      const data = await res.json();
      setSuggestions(data.suggestions ?? []);
      setShowSuggestions(true);
    } catch {
      setError("Vorschläge konnten nicht geladen werden.");
    } finally {
      setSuggestionsLoading(false);
    }
  }

  async function applySuggestion(suggestion: Suggestion) {
    const payload = {
      name: `KI: ${suggestion.category}`,
      priority: 100,
      active: true,
      conditionJson: suggestion.condition,
      actionJson: suggestion.action,
    };
    const res = await fetch("/api/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      setSuggestions((prev) => prev.filter((s) => s.category !== suggestion.category));
      await loadRules();
    }
  }

  return (
    <main className="min-h-screen p-4 md:p-6 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-semibold glass-text-primary">Regeln</h1>
          <p className="text-sm glass-text-secondary mt-1">
            Automatische Sortierung und Aktionen für eingehende E-Mails
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={loadSuggestions}
            disabled={suggestionsLoading}
            className="glass-btn px-4 py-2 rounded-xl text-sm font-medium"
          >
            {suggestionsLoading ? "Lade…" : "KI-Vorschläge"}
          </button>
          <button
            onClick={() => openEditor()}
            className="glass-btn px-4 py-2 rounded-xl text-sm font-medium bg-blue-600/20 hover:bg-blue-600/30 text-blue-300"
          >
            + Neue Regel
          </button>
        </div>
      </div>

      {/* Suggestions Panel */}
      {showSuggestions && suggestions.length > 0 && (
        <div className="glass rounded-xl p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold glass-text-primary">KI-Vorschläge</h2>
            <button
              onClick={() => setShowSuggestions(false)}
              className="glass-btn px-2 py-1 rounded-lg text-xs"
            >
              Schließen
            </button>
          </div>
          <div className="space-y-3">
            {suggestions.map((s) => (
              <div key={s.category} className="glass rounded-lg p-3 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1">
                  <p className="text-sm glass-text-primary">{s.description}</p>
                  <p className="text-xs glass-text-tertiary mt-1">
                    {s.affectedCount} E-Mails in {s.folderCount} Ordnern
                  </p>
                </div>
                <button
                  onClick={() => applySuggestion(s)}
                  className="glass-btn px-3 py-1.5 rounded-lg text-xs bg-green-600/20 hover:bg-green-600/30 text-green-300 whitespace-nowrap"
                >
                  Übernehmen
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {showSuggestions && suggestions.length === 0 && !suggestionsLoading && (
        <div className="glass rounded-xl p-4 mb-6">
          <p className="text-sm glass-text-secondary text-center">
            Keine Vorschläge verfügbar. Die KI benötigt mindestens 5 E-Mails einer Kategorie in verschiedenen Ordnern.
          </p>
          <div className="text-center mt-2">
            <button
              onClick={() => setShowSuggestions(false)}
              className="glass-btn px-3 py-1 rounded-lg text-xs"
            >
              Schließen
            </button>
          </div>
        </div>
      )}

      {/* Editor */}
      {showEditor && (
        <div className="glass rounded-xl p-4 md:p-6 mb-6">
          <h2 className="text-sm font-semibold glass-text-primary mb-4">
            {editingRule ? "Regel bearbeiten" : "Neue Regel erstellen"}
          </h2>

          {error && (
            <div className="text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2 mb-4">
              {error}
            </div>
          )}

          <div className="space-y-4">
            {/* Name + Priority */}
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px] gap-3">
              <div>
                <label className="block text-xs glass-text-secondary mb-1">Regel-Name</label>
                <input
                  type="text"
                  className="glass rounded-lg px-3 py-2 text-sm glass-text-primary w-full"
                  placeholder="z.B. Rechnungen sortieren"
                  value={ruleName}
                  onChange={(e) => setRuleName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs glass-text-secondary mb-1">Priorität</label>
                <input
                  type="number"
                  className="glass rounded-lg px-3 py-2 text-sm glass-text-primary w-full"
                  value={rulePriority}
                  onChange={(e) => setRulePriority(Number(e.target.value))}
                />
              </div>
            </div>

            {/* Conditions */}
            <div>
              <div className="flex items-center gap-3 mb-2">
                <label className="block text-xs glass-text-secondary">Bedingungen</label>
                <div className="flex items-center gap-1 text-xs">
                  <button
                    type="button"
                    onClick={() => setConditionMode("all")}
                    className={`px-2 py-0.5 rounded ${conditionMode === "all" ? "bg-blue-600/30 text-blue-300" : "glass-text-tertiary"}`}
                  >
                    UND
                  </button>
                  <button
                    type="button"
                    onClick={() => setConditionMode("any")}
                    className={`px-2 py-0.5 rounded ${conditionMode === "any" ? "bg-blue-600/30 text-blue-300" : "glass-text-tertiary"}`}
                  >
                    ODER
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                {conditions.map((c, i) => (
                  <ConditionRow
                    key={i}
                    condition={c}
                    index={i}
                    categories={categories}
                    onChange={(idx, updated) => {
                      setConditions((prev) => prev.map((p, j) => (j === idx ? updated : p)));
                    }}
                    onRemove={(idx) => {
                      setConditions((prev) => prev.filter((_, j) => j !== idx));
                    }}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={() =>
                  setConditions((prev) => [...prev, { field: "fromEmail", operator: "contains", value: "" }])
                }
                className="glass-btn px-3 py-1.5 rounded-lg text-xs mt-2"
              >
                + Bedingung hinzufügen
              </button>
            </div>

            <div className="glass-divider" />

            {/* Actions */}
            <div>
              <label className="block text-xs glass-text-secondary mb-2">Aktionen</label>
              <div className="space-y-2">
                {actions.map((a, i) => (
                  <ActionRow
                    key={i}
                    action={a}
                    index={i}
                    categories={categories}
                    folders={folders}
                    onChange={(idx, updated) => {
                      setActions((prev) => prev.map((p, j) => (j === idx ? updated : p)));
                    }}
                    onRemove={(idx) => {
                      setActions((prev) => prev.filter((_, j) => j !== idx));
                    }}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={() => setActions((prev) => [...prev, { type: "move_folder", value: "" }])}
                className="glass-btn px-3 py-1.5 rounded-lg text-xs mt-2"
              >
                + Aktion hinzufügen
              </button>
            </div>

            {/* Stop after match */}
            <label className="flex items-center gap-2 text-xs glass-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={stopAfterMatch}
                onChange={(e) => setStopAfterMatch(e.target.checked)}
                className="rounded"
              />
              Nach Treffer keine weiteren Regeln anwenden
            </label>

            <div className="glass-divider" />

            {/* Preview */}
            <div>
              <button
                type="button"
                onClick={handlePreview}
                disabled={previewLoading}
                className="glass-btn px-4 py-2 rounded-xl text-sm"
              >
                {previewLoading ? "Prüfe…" : "Vorschau"}
              </button>
              {preview && (
                <div className="mt-3 glass rounded-lg p-3">
                  <p className="text-sm glass-text-primary font-medium">
                    {preview.count} E-Mail{preview.count !== 1 ? "s" : ""} betroffen
                  </p>
                  {preview.sample.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {preview.sample.map((email) => (
                        <div key={email.id} className="text-xs glass-text-secondary flex gap-2">
                          <span className="truncate max-w-[200px]">{email.fromEmail ?? "-"}</span>
                          <span className="truncate flex-1">{email.subject ?? "(kein Betreff)"}</span>
                          <span className="whitespace-nowrap">{formatDate(email.date)}</span>
                        </div>
                      ))}
                      {preview.count > 10 && (
                        <p className="text-xs glass-text-tertiary">
                          … und {preview.count - 10} weitere
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="glass-divider" />

            {/* Save / Cancel */}
            <div className="flex gap-3">
              <button
                onClick={handleSave}
                disabled={saving}
                className="glass-btn px-4 py-2 rounded-xl text-sm font-medium bg-blue-600/20 hover:bg-blue-600/30 text-blue-300"
              >
                {saving ? "Speichere…" : editingRule ? "Aktualisieren" : "Regel erstellen"}
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

      {/* Rules List */}
      {loading ? (
        <div className="glass rounded-xl p-6 text-center">
          <p className="text-sm glass-text-secondary">Lade Regeln…</p>
        </div>
      ) : rules.length === 0 ? (
        <div className="glass rounded-xl p-6 text-center">
          <p className="text-sm glass-text-secondary">
            Noch keine Regeln vorhanden. Erstelle deine erste Regel oder nutze die KI-Vorschläge.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => (
            <div key={rule.id} className="glass rounded-xl p-4">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-block w-2 h-2 rounded-full ${rule.active ? "bg-green-400" : "bg-gray-500"}`}
                    />
                    <span className="text-sm font-medium glass-text-primary truncate">
                      {rule.name}
                    </span>
                    <span className="text-xs glass-text-tertiary">Prio {rule.priority}</span>
                  </div>
                  <RuleDescription conditionJson={rule.conditionJson} actionJson={rule.actionJson} />
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleToggleActive(rule)}
                    className="glass-btn px-2 py-1 rounded-lg text-xs"
                    title={rule.active ? "Deaktivieren" : "Aktivieren"}
                  >
                    {rule.active ? "Aktiv" : "Inaktiv"}
                  </button>
                  <button
                    onClick={() => openEditor(rule)}
                    className="glass-btn px-2 py-1 rounded-lg text-xs"
                  >
                    Bearbeiten
                  </button>
                  <button
                    onClick={() => handleDelete(rule.id)}
                    className="glass-btn px-2 py-1 rounded-lg text-xs text-red-400 hover:text-red-300"
                  >
                    Löschen
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

function RuleDescription({ conditionJson, actionJson }: { conditionJson: unknown; actionJson: unknown }) {
  const cond = conditionJson as { all?: LeafCondition[]; any?: LeafCondition[] } | null;
  const act = actionJson as { actions?: RuleActionItem[] } | null;

  const condParts: string[] = [];
  const leafs = cond?.all ?? cond?.any ?? [];
  const joiner = cond?.all ? " UND " : " ODER ";

  for (const leaf of leafs) {
    const fieldDef = FIELD_OPTIONS.find((f) => f.value === leaf.field);
    const fieldLabel = fieldDef?.label ?? leaf.field;
    if (leaf.field === "hasAttachments") {
      condParts.push(`${fieldLabel} = ${leaf.value ? "Ja" : "Nein"}`);
    } else {
      const opLabel = leaf.operator === "equals" ? "=" : leaf.operator === "contains" ? "enthält" : "endet mit";
      condParts.push(`${fieldLabel} ${opLabel} "${leaf.value}"`);
    }
  }

  const actParts: string[] = [];
  for (const a of act?.actions ?? []) {
    const def = ACTION_OPTIONS.find((o) => o.value === a.type);
    if (def) {
      actParts.push(a.value ? `${def.label}: ${a.value}` : def.label);
    }
  }

  if (condParts.length === 0 && actParts.length === 0) return null;

  return (
    <p className="text-xs glass-text-tertiary mt-1 truncate">
      {condParts.length > 0 && <span>Wenn {condParts.join(joiner)}</span>}
      {actParts.length > 0 && <span> → {actParts.join(", ")}</span>}
    </p>
  );
}
