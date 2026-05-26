import { redirect } from "next/navigation";
import { getSessionFromCookies } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";

export default async function AuditPage() {
  const session = await getSessionFromCookies();
  if (!session) redirect("/login");

  const logs = await prisma.auditLog.findMany({
    where: { userId: session.userId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <main className="min-h-screen p-6">
      <h1 className="text-xl font-semibold glass-text-primary">Audit-Log</h1>
      <ul className="mt-4 space-y-2">
        {logs.map((log) => (
          <li key={log.id} className="glass-card rounded-xl p-3 text-sm">
            {new Date(log.createdAt).toLocaleString("de-DE")} - {log.actor} - {log.action}
          </li>
        ))}
        {logs.length === 0 ? <li className="text-sm glass-text-tertiary">Noch keine Logs vorhanden.</li> : null}
      </ul>
    </main>
  );
}
