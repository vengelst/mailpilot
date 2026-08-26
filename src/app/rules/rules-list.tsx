"use client";

import type { RuleActionItem, RuleRow } from "./rules-types";
import { RuleDescription } from "./rule-description";

export function RulesList({
  loading,
  rules,
  retroactiveResult,
  retroactiveLoading,
  onApplyRetroactive,
  onToggleActive,
  onEdit,
  onDelete,
}: {
  loading: boolean;
  rules: RuleRow[];
  retroactiveResult: {
    ruleId: string;
    processed: number;
    matched: number;
    labelsAdded: number;
  } | null;
  retroactiveLoading: string | null;
  onApplyRetroactive: (ruleId: string) => void;
  onToggleActive: (rule: RuleRow) => void;
  onEdit: (rule: RuleRow) => void;
  onDelete: (ruleId: string) => void;
}) {
  function hasAddLabelAction(rule: RuleRow): boolean {
    const act = rule.actionJson as { actions?: RuleActionItem[] } | null;
    return (act?.actions ?? []).some((a) => a.type === "add_label");
  }

  if (loading) {
    return (
      <div className="glass rounded-xl p-6 text-center">
        <p className="text-sm glass-text-secondary">Lade Regeln…</p>
      </div>
    );
  }

  if (rules.length === 0) {
    return (
      <div className="glass rounded-xl p-6 text-center">
        <p className="text-sm glass-text-secondary">
          Noch keine Regeln vorhanden. Erstelle deine erste Regel oder nutze die KI-Vorschläge.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {retroactiveResult && (
        <div className="glass rounded-xl p-3 mb-2">
          <p className="text-sm text-emerald-400">
            Retroaktiver Scan abgeschlossen: {retroactiveResult.processed} E-Mails geprüft, {retroactiveResult.matched} Treffer, {retroactiveResult.labelsAdded} Labels zugewiesen.
          </p>
        </div>
      )}
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
            <div className="flex items-center gap-1 shrink-0 flex-wrap">
              {hasAddLabelAction(rule) && (
                <button
                  onClick={() => onApplyRetroactive(rule.id)}
                  disabled={retroactiveLoading === rule.id}
                  className="glass-btn px-2 py-1 rounded-lg text-xs text-emerald-400 hover:text-emerald-300"
                  title="Label-Regel auf bestehende E-Mails anwenden"
                >
                  {retroactiveLoading === rule.id ? "Scanne…" : "Auf bestehende anwenden"}
                </button>
              )}
              <button
                onClick={() => onToggleActive(rule)}
                className="glass-btn px-2 py-1 rounded-lg text-xs"
                title={rule.active ? "Deaktivieren" : "Aktivieren"}
              >
                {rule.active ? "Aktiv" : "Inaktiv"}
              </button>
              <button
                onClick={() => onEdit(rule)}
                className="glass-btn px-2 py-1 rounded-lg text-xs"
              >
                Bearbeiten
              </button>
              <button
                onClick={() => onDelete(rule.id)}
                className="glass-btn px-2 py-1 rounded-lg text-xs text-red-400 hover:text-red-300"
              >
                Löschen
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
