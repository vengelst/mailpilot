"use client";

import type { Suggestion } from "./rules-types";

export function SuggestionsPanel({
  suggestions,
  suggestionsLoading,
  onClose,
  onApply,
}: {
  suggestions: Suggestion[];
  suggestionsLoading: boolean;
  onClose: () => void;
  onApply: (suggestion: Suggestion) => void;
}) {
  if (suggestions.length > 0) {
    return (
      <div className="glass rounded-xl p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold glass-text-primary">KI-Vorschläge</h2>
          <button
            onClick={onClose}
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
                onClick={() => onApply(s)}
                className="glass-btn px-3 py-1.5 rounded-lg text-xs bg-green-600/20 hover:bg-green-600/30 text-green-300 whitespace-nowrap"
              >
                Übernehmen
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!suggestionsLoading) {
    return (
      <div className="glass rounded-xl p-4 mb-6">
        <p className="text-sm glass-text-secondary text-center">
          Keine Vorschläge verfügbar. Die KI benötigt mindestens 5 E-Mails einer Kategorie in verschiedenen Ordnern.
        </p>
        <div className="text-center mt-2">
          <button
            onClick={onClose}
            className="glass-btn px-3 py-1 rounded-lg text-xs"
          >
            Schließen
          </button>
        </div>
      </div>
    );
  }

  return null;
}
