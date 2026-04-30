# MailPilot Status

Stand: 2026-04-29

## Aktueller Gesamtstatus

- App laeuft lokal auf Port `5600`.
- Postgres laeuft via Docker Compose.
- Domain ist final auf `mailpilot.vivahome.de` gesetzt.
- Nginx-Config liegt im Repo unter `deploy/nginx/mailpilot.vivahome.de.conf`.
- Zielpfad auf Server bleibt `/etc/nginx/sites-available` (mit Symlink nach `sites-enabled`).

## Wichtige umgesetzte Fixes

- Sicherheits-Hardening:
  - Tenant-Scoping fuer `mark-read` / `mark-unread` korrigiert.
  - OAuth `state` signiert + TTL geprueft.
  - OAuth-Stub via `CLOUD_OAUTH_ALLOW_STUB` abgesichert.
- Kontenverwaltung:
  - Verbindungstest + Kontodatenanzeige in der UI.
  - Konto-Loeschen repariert (nur lokal in MailPilot, nicht auf IMAP-Server).
- Mail laden:
  - Search-API Limitfehler behoben (`limit` bis 200), dadurch INBOX-Ansicht wieder funktionsfaehig.
- UI/Theme:
  - Hell/Dunkel-Switch global verfuegbar.
  - Auf `/mail` sitzt der Switch links neben Logout.
  - Dark-Mode Lesbarkeit verbessert (helle Schrift inkl. Inputs/Placeholder).
  - Markierte Mail hat jetzt dicken roten Rand statt blauer Invertierung.

## Deployment-relevante Dateien

- `deploy/nginx/mailpilot.vivahome.de.conf`
- `DEPLOYMENT.md`
- `deploy/server-deploy.sh`
- `abgleich/mail.ps1`
- `.env.production.example`

## Offene Hinweise

- Nach Uebernahme der Nginx-Datei auf dem Server:
  1. Symlink in `sites-enabled` setzen
  2. `sudo nginx -t`
  3. `sudo systemctl reload nginx`
  4. TLS via `sudo certbot --nginx -d mailpilot.vivahome.de`

