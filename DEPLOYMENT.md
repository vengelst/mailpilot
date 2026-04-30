# MailPilot — Deployment

Dieses Dokument beschreibt den vollständigen Weg

```
Development-PC  →  GitHub (Mail)  →  Server /opt/mail  →  Docker Production
```

mit klarer Aufgabenteilung:

| Wer | Macht |
|---|---|
| **Development-PC** | Codeänderungen, Tests, `git commit`, `git push`, Deploy auslösen via `abgleich/mail.ps1` |
| **GitHub** | Übergabestelle. Einzige Quelle, aus der der Server zieht. |
| **Server** | `git pull`, Docker Build, `prisma migrate deploy`, Container-Start. **Kein** `git push`, **keine** Codeänderungen. |

---

## Domain & Pfade

- Domain: `mailpilot.vivahome.de`
- Server-App-Pfad: `/opt/mail`
- GitHub-Repo: `git@github.com:vengelst/Mail.git`
- Branch: `main`

---

## Einmalig — lokal

Repo lokal verbinden und initial pushen:

```bash
git remote add origin git@github.com:vengelst/Mail.git
git branch -M main
git push -u origin main
```

GitHub-Repo `Mail` muss vorher unter dem Account `vengelst` existieren.
SSH-Key muss in den GitHub-Account hochgeladen sein.

---

## Einmalig — Server

```bash
sudo mkdir -p /opt/mail
sudo chown -R $USER:$USER /opt/mail
git clone git@github.com:vengelst/Mail.git /opt/mail
cd /opt/mail

cp .env.production.example .env.production
nano .env.production            # echte Secrets eintragen
chmod 600 .env.production

chmod +x deploy/server-deploy.sh
./deploy/server-deploy.sh \
    --repo-url git@github.com:vengelst/Mail.git \
    --branch main \
    --path /opt/mail
```

`.env.production` muss ausgefüllt sein **bevor** das Skript läuft, sonst bricht es ab.

### Pflichtfelder in `.env.production`

| Variable | Hinweis |
|---|---|
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | DB-Credentials |
| `DATABASE_URL` | Muss zur DB-Service-Konfiguration passen, Host = `db` |
| `APP_ENCRYPTION_KEY` | 64 Hex-Zeichen (32 Bytes). z. B. `openssl rand -hex 32` |
| `SESSION_SECRET` | Lang, zufällig. z. B. `openssl rand -hex 48` |
| `NEXT_PUBLIC_APP_URL` | `https://mailpilot.vivahome.de` |
| `AI_PROVIDER` | `mock` / `openai` / `anthropic` |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | nur bei aktiver KI |

### Nginx + TLS

```bash
sudo cp /opt/mail/deploy/nginx/mailpilot.vivahome.de.conf \
        /etc/nginx/sites-available/mailpilot.vivahome.de.conf
sudo ln -s /etc/nginx/sites-available/mailpilot.vivahome.de.conf \
           /etc/nginx/sites-enabled/mailpilot.vivahome.de.conf
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d mailpilot.vivahome.de
```

Nginx proxiert auf `127.0.0.1:5600`. Der App-Container bindet seinen Port nur auf das Loopback-Interface — er ist von außen nicht direkt erreichbar.

---

## Laufender Deploy von lokal

Vom Development-PC aus (PowerShell):

```powershell
.\abgleich\mail.ps1 `
    -ServerHost "mailpilot.vivahome.de" `
    -ServerUser "root" `
    -RepoUrl "git@github.com:vengelst/Mail.git" `
    -Branch "main" `
    -CommitMessage "Update MailPilot" `
    -Push `
    -Deploy
```

Was passiert:

1. **Lokal**: `npm run typecheck`, `npm run lint`, `npm run build`. Bricht bei Fehlern ab.
2. **Lokal**: `git add -A`, `git commit -m "…"` (nur wenn Änderungen vorhanden).
3. **Lokal**: `git push origin main`.
4. **Server**: SSH-Befehl startet `/opt/mail/deploy/server-deploy.sh`.
5. **Server**: `git fetch` + `git reset --hard origin/main` (nur mit `-ForceServerReset`, sonst Abbruch bei lokalen Änderungen).
6. **Server**: `docker compose -f docker-compose.prod.yml --env-file .env.production build`.
7. **Server**: DB-Service hochfahren, auf `(healthy)` warten.
8. **Server**: `npx prisma migrate deploy` im App-Container.
9. **Server**: App-Container neu starten.
10. **Server**: `docker compose ps` + letzte 40 Logzeilen.

### Nützliche Schalter

| Schalter | Wirkung |
|---|---|
| `-WhatIf` | Plant alles, führt nichts aus |
| `-SkipChecks` | Überspringt typecheck/lint/build (nicht empfohlen) |
| `-Push` ohne `-Deploy` | Nur committen + pushen |
| `-Deploy` ohne `-Push` | Nur Server deployt aktuellen GitHub-Stand |
| `-ForceServerReset` | Verwirft serverseitige lokale Änderungen via `git reset --hard` |

---

## Server — direkter Zugriff

Falls man manuell auf dem Server etwas inspizieren muss:

```bash
cd /opt/mail
docker compose -f docker-compose.prod.yml --env-file .env.production ps
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f app
docker compose -f docker-compose.prod.yml --env-file .env.production logs --tail=200 db
```

Migrationen manuell:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production \
    run --rm --no-deps app npx prisma migrate deploy
```

DB-Shell:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production \
    exec db psql -U mailpilot -d mailpilot
```

### Was auf dem Server **nie** passieren darf

- `git push` aus `/opt/mail` heraus
- Codeänderungen direkt auf dem Server
- `docker compose down -v`  ⟶ würde das Postgres-Volume löschen
- `npm run dev` oder `prisma migrate dev`
- Echte Secrets in eine getrackte Datei einchecken

Wenn auf dem Server doch lokal Code geändert wurde:

1. Änderungen prüfen (`git diff` / `git status`)
2. Auf den Dev-PC zurückportieren
3. Vom Dev-PC committen und pushen
4. Auf dem Server `./deploy/server-deploy.sh … --force-reset` aufrufen

---

## Sicherheitsregeln (Kurzfassung)

- `.env`, `.env.production`, `.env.local` sind in `.gitignore` ausgeschlossen
- `.env.production.example` ist die einzige Env-Datei im Repo
- App-Container exponiert seinen Port **nur** auf `127.0.0.1:5600` — Nginx ist die einzige öffentliche Schnittstelle
- Postgres-Container exponiert keinen Port nach außen — nur das interne Compose-Netz
- `docker compose down -v` ist im Server-Skript nirgends enthalten
- `prisma migrate deploy` (additiv, sicher) statt `migrate dev` (kann DB resetten)

---

## Troubleshooting

| Symptom | Ursache | Fix |
|---|---|---|
| `Cannot deploy without .env.production` | Datei fehlt auf dem Server | `cp .env.production.example .env.production` + Secrets eintragen |
| Sync-Server bleibt auf `(unhealthy)` | DB nicht erreichbar | `docker compose logs db` — meist falsche Credentials in `.env.production` |
| `git status --porcelain` zeigt Änderungen | Jemand hat auf dem Server editiert | `--force-reset` oder Änderungen rückportieren |
| `prisma migrate deploy` schlägt fehl | DB-Schema vor letzter App-Version | Zurück auf vorherigen Git-Stand, Logs prüfen, dann gezielt fixen |
