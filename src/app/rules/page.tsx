"use client";

import { useEffect, useState, useCallback } from "react";
import type {
  CategoryInfo,
  FolderInfo,
  LeafCondition,
  PreviewResult,
  RuleActionItem,
  RuleRow,
  Suggestion,
} from "./rules-types";
import { ACTION_OPTIONS } from "./rules-constants";
import { SuggestionsPanel } from "./suggestions-panel";
import { InvoiceSetupBanner } from "./invoice-setup-banner";
import { RuleEditor } from "./rule-editor";
import { RulesList } from "./rules-list";

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

  // Invoice templates
  const [invoiceSetupLoading, setInvoiceSetupLoading] = useState(false);
  const [invoiceSetupDone, setInvoiceSetupDone] = useState(false);

  // Retroactive scan
  const [retroactiveLoading, setRetroactiveLoading] = useState<string | null>(null);
  const [retroactiveResult, setRetroactiveResult] = useState<{ ruleId: string; processed: number; matched: number; labelsAdded: number } | null>(null);

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

  async function setupInvoiceTemplates() {
    setInvoiceSetupLoading(true);
    setError("");
    try {
      const labelRes = await fetch("/api/labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Rechnungen", color: "#059669" }),
      });
      if (!labelRes.ok && labelRes.status !== 409) {
        const data = await labelRes.json();
        setError(data.error ?? "Label konnte nicht erstellt werden");
        return;
      }

      const templates = [
        {
          name: "Rechnung im Betreff",
          priority: 50,
          active: true,
          conditionJson: {
            any: [
              { field: "subject", operator: "contains", value: "Rechnung" },
              { field: "subject", operator: "contains", value: "Invoice" },
              { field: "subject", operator: "contains", value: "Zahlungsaufforderung" },
            ],
          },
          actionJson: {
            actions: [{ type: "add_label", value: "Rechnungen" }],
            stopAfterMatch: false,
          },
        },
        {
          name: "Rechnung als Anhang",
          priority: 51,
          active: true,
          conditionJson: {
            all: [
              { field: "hasAttachments", operator: "equals", value: true },
              {
                any: [
                  { field: "attachmentFilename", operator: "contains", value: "rechnung" },
                  { field: "attachmentFilename", operator: "contains", value: "invoice" },
                ],
              },
            ],
          },
          actionJson: {
            actions: [{ type: "add_label", value: "Rechnungen" }],
            stopAfterMatch: false,
          },
        },
        {
          name: "KI: Rechnung erkannt",
          priority: 52,
          active: true,
          conditionJson: {
            any: [
              { field: "aiCategory", operator: "equals", value: "invoice" },
              { field: "aiCategory", operator: "equals", value: "rechnung" },
            ],
          },
          actionJson: {
            actions: [{ type: "add_label", value: "Rechnungen" }],
            stopAfterMatch: false,
          },
        },
      ];

      for (const tpl of templates) {
        await fetch("/api/rules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(tpl),
        });
      }

      setInvoiceSetupDone(true);
      await loadRules();
    } catch {
      setError("Rechnungs-Vorlagen konnten nicht erstellt werden.");
    } finally {
      setInvoiceSetupLoading(false);
    }
  }

  async function applyRetroactive(ruleId: string) {
    setRetroactiveLoading(ruleId);
    setRetroactiveResult(null);
    try {
      const res = await fetch("/api/rules/apply-retroactive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ruleIds: [ruleId] }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Retroaktiver Scan fehlgeschlagen");
        return;
      }
      const data = await res.json();
      setRetroactiveResult({ ruleId, ...data });
    } catch {
      setError("Retroaktiver Scan fehlgeschlagen");
    } finally {
      setRetroactiveLoading(null);
    }
  }

  return (
    <main className="min-h-screen p-4 md:p-6 max-w-5xl mx-auto">
      <div className="mb-4 flex items-center gap-2">
        <a href="/settings" className="text-sm glass-text-secondary hover:underline">
          ← Einstellungen
        </a>
      </div>
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

      {showSuggestions && (
        <SuggestionsPanel
          suggestions={suggestions}
          suggestionsLoading={suggestionsLoading}
          onClose={() => setShowSuggestions(false)}
          onApply={applySuggestion}
        />
      )}

      <InvoiceSetupBanner
        invoiceSetupDone={invoiceSetupDone}
        invoiceSetupLoading={invoiceSetupLoading}
        onSetup={setupInvoiceTemplates}
      />

      {showEditor && (
        <RuleEditor
          editingRule={editingRule}
          error={error}
          ruleName={ruleName}
          setRuleName={setRuleName}
          rulePriority={rulePriority}
          setRulePriority={setRulePriority}
          conditionMode={conditionMode}
          setConditionMode={setConditionMode}
          conditions={conditions}
          setConditions={setConditions}
          actions={actions}
          setActions={setActions}
          categories={categories}
          folders={folders}
          stopAfterMatch={stopAfterMatch}
          setStopAfterMatch={setStopAfterMatch}
          preview={preview}
          previewLoading={previewLoading}
          saving={saving}
          onPreview={handlePreview}
          onSave={handleSave}
          onCancel={() => {
            setShowEditor(false);
            resetEditor();
          }}
        />
      )}

      <RulesList
        loading={loading}
        rules={rules}
        retroactiveResult={retroactiveResult}
        retroactiveLoading={retroactiveLoading}
        onApplyRetroactive={applyRetroactive}
        onToggleActive={handleToggleActive}
        onEdit={openEditor}
        onDelete={handleDelete}
      />
    </main>
  );
}
