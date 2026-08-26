"use client";

import type { Dispatch, SetStateAction } from "react";
import type {
  CategoryInfo,
  FolderInfo,
  LeafCondition,
  PreviewResult,
  RuleActionItem,
  RuleRow,
} from "./rules-types";
import { formatDate } from "./rules-constants";
import { ConditionRow } from "./condition-row";
import { ActionRow } from "./action-row";

export function RuleEditor({
  editingRule,
  error,
  ruleName,
  setRuleName,
  rulePriority,
  setRulePriority,
  conditionMode,
  setConditionMode,
  conditions,
  setConditions,
  actions,
  setActions,
  categories,
  folders,
  stopAfterMatch,
  setStopAfterMatch,
  preview,
  previewLoading,
  saving,
  onPreview,
  onSave,
  onCancel,
}: {
  editingRule: RuleRow | null;
  error: string;
  ruleName: string;
  setRuleName: (v: string) => void;
  rulePriority: number;
  setRulePriority: (v: number) => void;
  conditionMode: "all" | "any";
  setConditionMode: (v: "all" | "any") => void;
  conditions: LeafCondition[];
  setConditions: Dispatch<SetStateAction<LeafCondition[]>>;
  actions: RuleActionItem[];
  setActions: Dispatch<SetStateAction<RuleActionItem[]>>;
  categories: CategoryInfo[];
  folders: FolderInfo[];
  stopAfterMatch: boolean;
  setStopAfterMatch: (v: boolean) => void;
  preview: PreviewResult | null;
  previewLoading: boolean;
  saving: boolean;
  onPreview: () => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
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
            onClick={onPreview}
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
            onClick={onSave}
            disabled={saving}
            className="glass-btn px-4 py-2 rounded-xl text-sm font-medium bg-blue-600/20 hover:bg-blue-600/30 text-blue-300"
          >
            {saving ? "Speichere…" : editingRule ? "Aktualisieren" : "Regel erstellen"}
          </button>
          <button
            onClick={onCancel}
            className="glass-btn px-4 py-2 rounded-xl text-sm"
          >
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  );
}
