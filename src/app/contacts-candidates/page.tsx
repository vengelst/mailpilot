"use client";

import { useEffect, useState } from "react";

type Candidate = {
  id: string;
  companyName: string | null;
  personName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  confidence: number | null;
  status: "pending" | "exported" | "ignored" | "duplicate";
  googleContactId: string | null;
  emailId: string;
  emailIndex: {
    id: string;
    subject: string | null;
    fromEmail: string | null;
    date: string | null;
  };
};

const STATUS_FILTERS = [
  { id: "all", label: "alle" },
  { id: "pending", label: "pending" },
  { id: "exported", label: "exported" },
  { id: "ignored", label: "ignored" },
  { id: "duplicate", label: "duplicate" },
] as const;

export default function ContactCandidatesPage() {
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]["id"]>("pending");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadCandidates(nextStatus = status) {
    setLoading(true);
    setError("");
    const query = nextStatus === "all" ? "" : `?status=${nextStatus}`;
    const res = await fetch(`/api/contact-candidates${query}`);
    if (!res.ok) {
      setError("Kontaktkandidaten konnten nicht geladen werden.");
      setCandidates([]);
      setLoading(false);
      return;
    }
    const data = await res.json();
    setCandidates(data.candidates ?? []);
    setLoading(false);
  }

  async function runAction(id: string, action: "export-google" | "ignore" | "mark-duplicate") {
    const res = await fetch(`/api/contact-candidates/${id}/${action}`, {
      method: "POST",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Aktion fehlgeschlagen");
      return;
    }
    await loadCandidates();
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadCandidates();
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="min-h-screen p-6">
      <h1 className="text-xl font-semibold">Kontaktkandidaten</h1>
      <p className="mt-2 text-sm text-gray-600">
        Export nach Google Contacts nur nach expliziter Benutzeraktion.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {STATUS_FILTERS.map((filter) => (
          <button
            key={filter.id}
            onClick={() => {
              setStatus(filter.id);
              void loadCandidates(filter.id);
            }}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              status === filter.id ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300"
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      {loading ? <p className="mt-3 text-sm text-gray-600">Lade Kandidaten...</p> : null}

      <ul className="mt-4 space-y-3">
        {candidates.map((candidate) => (
          <li key={candidate.id} className="rounded-lg border border-gray-200 bg-white p-3 text-sm">
            <p className="font-medium">{candidate.personName || candidate.email || "Unbekannter Kontakt"}</p>
            <p className="text-xs text-gray-600">
              Status: {candidate.status}
              {candidate.googleContactId ? ` | Google ID: ${candidate.googleContactId}` : ""}
            </p>
            <div className="mt-2 grid grid-cols-1 gap-1 text-xs text-gray-700 md:grid-cols-2">
              <p>Firma: {candidate.companyName || "-"}</p>
              <p>E-Mail: {candidate.email || "-"}</p>
              <p>Telefon: {candidate.phone || "-"}</p>
              <p>Adresse: {candidate.address || "-"}</p>
              <p>Confidence: {candidate.confidence ?? "-"}</p>
              <p>Quelle: {candidate.emailIndex.subject || "(Ohne Betreff)"}</p>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={() => void runAction(candidate.id, "export-google")}
                disabled={candidate.status === "exported"}
                className="rounded-md border border-gray-300 px-2 py-1 text-xs disabled:opacity-50"
              >
                Nach Google Contacts exportieren
              </button>
              <button
                onClick={() => void runAction(candidate.id, "ignore")}
                className="rounded-md border border-gray-300 px-2 py-1 text-xs"
              >
                Ignorieren
              </button>
              <button
                onClick={() => void runAction(candidate.id, "mark-duplicate")}
                className="rounded-md border border-gray-300 px-2 py-1 text-xs"
              >
                Als Dublette markieren
              </button>
            </div>
          </li>
        ))}
      </ul>

      {!loading && candidates.length === 0 ? (
        <p className="text-sm text-gray-500">Keine Kontaktkandidaten für den gewählten Filter.</p>
      ) : null}
    </main>
  );
}
