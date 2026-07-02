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
    href: "/sender-profiles",
    title: "Absender-Profile",
    description: "Absender klassifizieren und automatisch in Ordner sortieren.",
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
    <main className="min-h-screen p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-2 flex items-center gap-2">
          <a href="/mail" className="text-sm glass-text-secondary hover:underline">
            ← Zurück zur Mail
          </a>
        </div>
        <h1 className="text-2xl font-semibold glass-text-primary">Einstellungen</h1>
        <p className="mt-1 text-sm glass-text-secondary">
          Verwaltung von Konten, Regeln, Automation und weiteren Bereichen.
        </p>

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sections.map((section) => (
            <a
              key={section.href}
              href={section.href}
              className="glass-card p-5 no-underline"
            >
              <p className="text-sm font-semibold glass-text-primary">{section.title}</p>
              <p className="mt-1.5 text-xs glass-text-secondary">{section.description}</p>
            </a>
          ))}
        </div>
      </div>
    </main>
  );
}
