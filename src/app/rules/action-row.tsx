"use client";

import type { CategoryInfo, FolderInfo, RuleActionItem } from "./rules-types";
import { ACTION_OPTIONS, PRIORITY_VALUES } from "./rules-constants";

export function ActionRow({
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

      {actionDef?.needsValue && action.type === "add_label" && (
        <input
          type="text"
          className="glass rounded-lg px-3 py-2 text-sm glass-text-primary flex-1 min-w-[120px]"
          placeholder="Label-Name"
          value={action.value ?? ""}
          onChange={(e) => onChange(index, { ...action, value: e.target.value })}
        />
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

