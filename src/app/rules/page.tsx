import { redirect } from "next/navigation";
import { getSessionFromCookies } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";

export default async function RulesPage() {
  const session = await getSessionFromCookies();
  if (!session) redirect("/login");

  const rules = await prisma.mailRule.findMany({
    where: { userId: session.userId },
    orderBy: { priority: "asc" },
  });

  return (
    <main className="min-h-screen p-6">
      <h1 className="text-xl font-semibold glass-text-primary">Regeln</h1>
      <p className="mt-2 text-sm glass-text-secondary">
        Regeln sind für Phase 1 als strukturierte Basis und Audit vorbereitet.
      </p>
      <ul className="mt-4 space-y-2">
        {rules.map((rule) => (
          <li key={rule.id} className="glass-card rounded-xl p-3 text-sm">
            {rule.name} (Priorität {rule.priority}, {rule.active ? "aktiv" : "inaktiv"})
          </li>
        ))}
        {rules.length === 0 ? <li className="text-sm glass-text-tertiary">Noch keine Regeln vorhanden.</li> : null}
      </ul>
    </main>
  );
}
