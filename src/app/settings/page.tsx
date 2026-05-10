import { redirect } from "next/navigation";
import { getSessionFromCookies } from "@/server/auth/session";

const sections = [
  {
    href: "/ai-assistant",
    title: "KI-Assistent",
    description: "Aufträge in natürlicher Sprache an die KI geben — mit Vorschau und Bestätigung.",
  },
  {
    href: "/settings/ai",
    title: "KI-Einstellungen",
    description: "Anbieter, API-Key und Verbindungstest für die KI.",
  },
  {
    href: "/settings/accounts",
    title: "IMAP-Konten",
    description: "Mailkonten verbinden, testen, löschen.",
  },
  {
    href: "/settings/cloud",
    title: "Cloud-Konten",
    description: "Google Drive und OneDrive verbinden.",
  },
  {
    href: "/settings/signature",
    title: "Signatur",
    description: "Standardsignatur pflegen und Einfüge-Regeln setzen.",
  },
  {
    href: "/settings/mail",
    title: "Mail-Ansicht",
    description: "Wie viele E-Mails beim Scrollen in der Liste nachgeladen werden.",
  },
  {
    href: "/settings/users",
    title: "Benutzer",
    description: "Anmeldungen, Rollen und Passwörter verwalten.",
  },
  {
    href: "/rules",
    title: "Regeln",
    description: "Eigene Regeln für automatische Sortierung.",
  },
  {
    href: "/blocklist",
    title: "Blockliste",
    description: "Absender und Domains blockieren.",
  },
  {
    href: "/automation",
    title: "Automatisierung",
    description: "Synchronisierung, KI und Regeln planen.",
  },
  {
    href: "/contacts-candidates",
    title: "Kontaktvorschläge",
    description: "Erkannte Kontakte prüfen und nach Google Contacts exportieren.",
  },
  {
    href: "/audit",
    title: "Audit-Log",
    description: "Alle relevanten Aktionen nachvollziehen.",
  },
  {
    href: "/search",
    title: "Erweiterte Suche",
    description: "Mailindex über mehrere Filter durchsuchen.",
  },
];

export default async function SettingsPage() {
  const session = await getSessionFromCookies();
  if (!session) redirect("/login");

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-2 flex items-center gap-2">
          <a href="/mail" className="text-sm text-gray-600 hover:underline">
            ← Zurück zur Mail
          </a>
        </div>
        <h1 className="text-2xl font-semibold text-gray-900">Einstellungen</h1>
        <p className="mt-1 text-sm text-gray-600">
          Verwaltung von Konten, Regeln, Automation und weiteren Bereichen.
        </p>

        <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {sections.map((section) => (
            <a
              key={section.href}
              href={section.href}
              className="rounded-xl border border-gray-200 bg-white p-4 transition hover:border-gray-400 hover:shadow-sm"
            >
              <p className="text-sm font-semibold text-gray-900">{section.title}</p>
              <p className="mt-1 text-xs text-gray-600">{section.description}</p>
            </a>
          ))}
        </div>
      </div>
    </main>
  );
}
