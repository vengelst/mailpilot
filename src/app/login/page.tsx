"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [hydrated, setHydrated] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setHydrated(true);
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "Login fehlgeschlagen");
      return;
    }
    router.push("/mail");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="glass-card w-full max-w-md p-8">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold glass-text-primary">MailPilot</h1>
          <p className="mt-2 text-sm glass-text-secondary">
            Beim ersten Login wird automatisch der erste lokale Benutzer angelegt.
          </p>
        </div>

        {!hydrated ? (
          <div className="space-y-5" aria-busy="true" aria-live="polite">
            <div className="glass-input h-11 w-full rounded-xl" />
            <div className="glass-input h-11 w-full rounded-xl" />
            <div className="glass-btn-primary h-11 w-full rounded-xl opacity-70" />
          </div>
        ) : (
        <form onSubmit={onSubmit} className="space-y-5">
          <div>
            <label className="mb-1.5 block text-sm font-medium glass-text-secondary">E-Mail</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
              className="glass-input w-full rounded-xl px-4 py-2.5 text-sm"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium glass-text-secondary">Passwort</label>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              minLength={6}
              required
              className="glass-input w-full rounded-xl px-4 py-2.5 text-sm"
            />
          </div>
          {error ? (
            <div className="glass-error rounded-xl px-4 py-2.5 text-sm text-red-600">
              {error}
            </div>
          ) : null}
          <button
            type="submit"
            disabled={loading}
            className="glass-btn-primary w-full rounded-xl px-4 py-2.5 text-sm font-medium"
          >
            {loading ? "Anmeldung..." : "Anmelden"}
          </button>
        </form>
        )}
      </div>
    </main>
  );
}
