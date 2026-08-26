"use client";

import type { CategoryInfo, LeafCondition } from "./rules-types";
import { FIELD_OPTIONS, OPERATOR_OPTIONS, PRIORITY_VALUES } from "./rules-constants";

export function ConditionRow({
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

