"use client";

export function InvoiceSetupBanner({
  invoiceSetupDone,
  invoiceSetupLoading,
  onSetup,
}: {
  invoiceSetupDone: boolean;
  invoiceSetupLoading: boolean;
  onSetup: () => void;
}) {
  if (invoiceSetupDone) {
    return (
      <div className="glass rounded-xl p-4 mb-6">
        <p className="text-sm text-emerald-400">
          Rechnungs-Erkennung eingerichtet — Label &quot;Rechnungen&quot; und 3 Regeln wurden erstellt.
        </p>
      </div>
    );
  }

  return (
    <div className="glass rounded-xl p-4 mb-6">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1">
          <h2 className="text-sm font-semibold glass-text-primary">Rechnungs-Erkennung</h2>
          <p className="text-xs glass-text-secondary mt-1">
            Erstellt automatisch Label und Regeln zur Erkennung von Rechnungen im Betreff, Anhang oder per KI-Kategorie.
          </p>
        </div>
        <button
          onClick={onSetup}
          disabled={invoiceSetupLoading}
          className="glass-btn px-4 py-2 rounded-xl text-sm font-medium bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 whitespace-nowrap"
        >
          {invoiceSetupLoading ? "Wird eingerichtet…" : "Rechnungs-Erkennung einrichten"}
        </button>
      </div>
    </div>
  );
}
