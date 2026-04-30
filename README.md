# MailPilot (Phase 1 MVP)

Schlanke, responsive IMAP-Web-App mit Next.js, TypeScript, Tailwind, Prisma und PostgreSQL.

## Status Phase 1

Implementiert:

- Lokale Auth (E-Mail/Passwort, httpOnly Session-Cookie)
- IMAP-Konten anlegen, Verbindung testen, Ordner laden, Ordner synchronisieren
- E-Mail-Index in PostgreSQL (keine vollständige Spiegelung als harte Vorgabe)
- E-Mail-Liste + Detailansicht + Anhänge-Metadaten
- Suche über Index
- Aktionen: markieren, verschieben (inkl. Trash/Spam), Drucken
- Audit-Logging für zentrale Aktionen
- KI-Schicht mit Provider-Abstraktion und Mock-Provider
- Regeln/Automatisierung als vorbereitete, auditierbare Struktur

Nicht automatisiert (bewusst):

- Keine endgültige Löschung
- Kein automatisches Leeren des Papierkorbs
- Kein automatisches `EXPUNGE`

## Tech-Stack

- Next.js (App Router) + TypeScript
- Tailwind CSS
- PostgreSQL + Prisma
- ImapFlow
- Zod

## Projektstruktur (Auszug)

- `src/app/*` Seiten + API-Routen
- `src/server/auth/*` Auth/Session
- `src/server/imap/*` IMAP-Client und Sync-Service
- `src/server/security/crypto.ts` AES-256-GCM für IMAP-Passwörter
- `src/server/ai/*` Provider-Abstraktion + Ergebnisvalidierung
- `src/server/rules/*` Rules Engine Basis
- `src/server/automation/*` Jobs + Runner
- `src/server/audit/*` Audit-Logging
- `prisma/schema.prisma` Datenmodell
- `docker-compose.yml` PostgreSQL lokal
- `.env.example` sichere Platzhalter

## Setup

1) Abhängigkeiten installieren

```bash
npm install
```

2) Umgebungsvariablen setzen

```bash
cp .env.example .env
```

3) PostgreSQL starten

```bash
docker compose up -d
```

4) Prisma Client generieren

```bash
npx prisma generate
```

5) Migration ausführen

```bash
npx prisma migrate dev --name init
```

6) App starten

```bash
npm run dev
```

Aufruf lokal: [http://localhost:5600](http://localhost:5600)

## Prüfkommandos

```bash
npm run typecheck
npm run lint
```

## API-Endpunkte (Phase 1)

- Auth: `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`
- Accounts: `/api/accounts`, `/api/accounts/:id`, `/api/accounts/:id/test`, `/api/accounts/:id/folders`, `/api/accounts/:id/sync`
- Emails: `/api/emails`, `/api/emails/:id`, `/api/emails/:id/move`, `/api/emails/:id/mark-read`, `/api/emails/:id/mark-unread`, `/api/emails/:id/analyze`, `/api/emails/:id/print`
- Search: `/api/search`
- Rules: `/api/rules`, `/api/rules/:id`
- Blocklist: `/api/blocklist`, `/api/blocklist/:id`
- Automation: `/api/automation/run-now`, `/api/automation/runs`
- Audit: `/api/audit`

## Sicherheit

- IMAP-Zugangsdaten werden serverseitig mit AES-256-GCM verschlüsselt (`APP_ENCRYPTION_KEY`)
- Session über `httpOnly` Cookie (`SESSION_SECRET`)
- Keine Secrets im Frontend speichern
- Keine echten Secrets in `.env.example`

## Hinweis zu Ports

Falls der konfigurierte PostgreSQL-Port lokal belegt ist, passe `docker-compose.yml` und `DATABASE_URL` konsistent an.
