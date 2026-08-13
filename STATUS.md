# MailPilot Status

Stand: 2026-08-13

## Aktueller Gesamtstatus

- **Live:** https://mailpilot.vivahome.de (`v1.0.0` + Folge-Commits auf `main`)
- Server-Pfad: `/opt/mailpilot` (Docker Compose Prod)
- Lokal: Port `5600`, Working Tree i.d.R. synchron mit `origin/main`
- Postgres via Docker; Nginx unter `deploy/nginx/mailpilot.vivahome.de.conf`

## Session 2026-08-10 – umgesetzte Aenderungen

### Absender-Profile / Auto-Labels
- `SenderProfile.autoLabels` verdrahtet: API speichert Labels; beim Auto-Move nach Lesen werden Labels gesetzt
- Klassifizierungs-Banner: Auto-Labels waehlbar (Checkboxen + neues Label)
- Absender-Profile-Seite: Auto-Labels im Editor und in der Liste

### Absender-Banner (Klassifizierung)
- `checkSenderOnOpen` wieder angebunden (war nach Workspace-Split verloren)
- Verhalten:
  - Profil vorhanden → nach Lesen Auto-Move in Zielordner
  - Kein Profil → Banner mit Kategorie / Ordner / Labels
- Neuer Ordner aus dem Banner:
  1. **Neu…** → uebergeordneten Ordner aus Liste waehlen
  2. Nur den **neuen Ordnernamen** eingeben
  3. Vorschau-Pfad → beim Speichern wird der Ordner angelegt

### Dark Mode / Lesbarkeit
- App-Hintergrund und Glass-Panels dunkler; Sekundaertexte heller
- Mail-Inhalt im Dark Mode auf weissem „Papier“-Hintergrund (HTML/Text lesbar)

### Auth
- Login: `ve@vivahome.de` (Passwort bei Bedarf auf Server neu setzen; bcrypt-Hash ohne Shell-`$`-Expansion schreiben)

## Wichtige aeltere Fixes (Auszug)

- Sicherheits-Hardening (Tenant-Scoping, OAuth state/TTL, OAuth-Stub)
- Kontenverwaltung, Search-Limit, Hell/Dunkel-Switch
- Unified Inbox, Duplikate, Labels, Rechnungserkennung via Rules
- Blocklist CRUD / Whitelist, Navigation, Auto-Update-Intervall

## Offenes Backlog

| Thema | Status |
|-------|--------|
| Cross-Account Copy/Move (Drag&Drop zwischen Konten) | Idee in `IDEAS.md`, nicht priorisiert |
| `autoLabels` beim rueckwirkenden `/apply` | bewusst nicht im Scope |
| Template-Switcher Glass ↔ 3D/Neumorphism | abgelehnt / auf Eis |

## Deployment

Nach Code-Aenderungen Standard:

```bash
git push
ssh root@vivahome.de
cd /opt/mailpilot
git pull && docker compose -f docker-compose.prod.yml down && docker compose -f docker-compose.prod.yml up --build -d
```

Relevante Dateien: `DEPLOYMENT.md`, `deploy/server-deploy.sh`, `docker-compose.prod.yml`
