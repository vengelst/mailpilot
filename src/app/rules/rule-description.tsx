"use client";

import type { LeafCondition, RuleActionItem } from "./rules-types";
import { ACTION_OPTIONS, FIELD_OPTIONS } from "./rules-constants";

export function RuleDescription({ conditionJson, actionJson }: { conditionJson: unknown; actionJson: unknown }) {
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
