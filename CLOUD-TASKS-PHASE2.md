# Cloud-Auftrag: Sender-Profile Phase 2 + Label-System

---

## Überblick

Drei zusammenhängende Features für die intelligente E-Mail-Organisation:

1. **Auto-Prompt bei unbekanntem Absender** – Klassifizierungs-Dialog beim Öffnen
2. **Regel-basierte Verschiebung erst nach "gelesen"** – Kein automatisches Verschieben ungelesener Mails
3. **Label-System mit virtuellen Ordnern** – E-Mails können Labels tragen und in virtuellen Ansichten gruppiert werden

---

## Feature 1: Auto-Prompt bei unbekanntem Absender

### Ziel
Wenn der User eine E-Mail öffnet, deren Absender keinem bestehenden `SenderProfile` zugeordnet ist, erscheint ein dezenter Hinweis/Dialog: "Absender unbekannt – klassifizieren?"

### Aktuelle Architektur
- `SenderProfile` Model existiert in `prisma/schema.prisma` (Felder: `patterns`, `category`, `targetFolder`)
- `matchesSenderProfile()` in `src/server/rules/senderMatcher.ts` prüft ob ein Absender zu einem Profil passt
- `src/app/api/sender-profiles/match/route.ts` – API zum Prüfen ob ein Match existiert
- `src/app/api/sender-profiles/suggest/route.ts` – API für Profil-Vorschläge basierend auf E-Mail
- `src/components/mail/mail-workspace.tsx` – E-Mail-Detailansicht rechts

### Umsetzung

**Backend: Neuer Endpunkt `GET /api/sender-profiles/check-sender?email=...`**
```typescript
// Prüft ob der Absender einem aktiven SenderProfile zugeordnet ist
// Response: { matched: boolean, profile?: { profileName, category, targetFolder } }
// Einfacher und schneller als /match (kein Body nötig, nur Query-Parameter)
```

**Frontend (`mail-workspace.tsx`):**

1. Wenn eine E-Mail geöffnet wird (Detailansicht rechts), nach dem Laden des Body:
   - API-Call: `GET /api/sender-profiles/check-sender?email=${encodeURIComponent(email.fromEmail)}`
   - Wenn `matched: false` → Banner/Toast anzeigen

2. **Banner-UI** (oberhalb des E-Mail-Body, nicht modal):
   ```
   ┌─────────────────────────────────────────────────────────┐
   │ 📋 Absender "firma@example.com" noch nicht klassifiziert │
   │                                                          │
   │ Kategorie: [Dropdown: Kunde/Lieferant/Sub/Privat/...]   │
   │ Zielordner: [Dropdown aus vorhandenen Ordnern]           │
   │                                                          │
   │ [Profil speichern]  [Überspringen]  [Nie wieder fragen]  │
   └─────────────────────────────────────────────────────────┘
   ```

3. **"Profil speichern"** → `POST /api/sender-profiles` mit:
   - `profileName`: Domain oder Firmenname (aus suggest-API oder manuell)
   - `patterns`: [`domain.de`] (automatisch aus fromEmail extrahiert)
   - `category`: Gewählte Kategorie
   - `targetFolder`: Gewählter Ordner
   - Optional: Checkbox "Rückwirkend anwenden?" → nach Erstellen zusätzlich `/apply` aufrufen

4. **"Überspringen"** → Banner schließen, beim nächsten Öffnen desselben Absenders erneut fragen

5. **"Nie wieder fragen"** → Spezielles "ignore"-Profil erstellen:
   - SenderProfile mit `category: "ignore"` und `targetFolder: ""` (oder ein neues Feld `ignored: true`)
   - Alternativ: Ein neues Feld `dismissedSenders` in `AutomationSettings` (String-Array) für Absender die nicht mehr gefragt werden sollen

6. **Caching/Performance:**
   - Im Frontend: Set `checkedSenders` (Session-State) → Absender nur 1x pro Session prüfen
   - Wenn bereits geprüft und bekannt → kein erneuter API-Call

### Akzeptanzkriterien
- [ ] Beim Öffnen einer Mail von unbekanntem Absender erscheint Klassifizierungs-Banner
- [ ] Kategorie und Zielordner sind wählbar (Dropdowns)
- [ ] "Profil speichern" erstellt ein SenderProfile
- [ ] "Überspringen" schließt nur den Banner
- [ ] "Nie wieder fragen" unterdrückt künftige Prompts für diesen Absender
- [ ] Bekannte Absender (mit Profil) lösen keinen Banner aus
- [ ] Performance: Kein spürbarer Delay beim Öffnen (gecacht nach 1. Check)

---

## Feature 2: Verschiebung nur nach "gelesen"

### Ziel
Neue E-Mails, die beim Sync ankommen und deren Absender einem SenderProfile zugeordnet ist, werden NICHT sofort verschoben. Sie bleiben im INBOX und werden erst verschoben, nachdem der User sie gelesen hat (markiert als "gelesen" / Flags enthalten `\Seen`).

### Grund
Der User will alle ungelesenen E-Mails im Posteingang finden können, ohne verschiedene Ordner durchsuchen zu müssen.

### Aktuelle Architektur
- E-Mails haben `flags` (String-Array) in `EmailIndex` – enthält z.B. `["\\Seen"]` wenn gelesen
- `mark-read` API: `src/app/api/emails/[id]/mark-read/route.ts` setzt das `\Seen`-Flag
- In `mail-workspace.tsx`: Beim Öffnen einer E-Mail wird automatisch `mark-read` aufgerufen

### Umsetzung

**Ansatz: Nach dem Markieren als "gelesen" → Profil-basiert verschieben**

1. **API erweitern: `src/app/api/emails/[id]/mark-read/route.ts`**
   
   Nach dem erfolgreichen Setzen des `\Seen`-Flags:
   ```typescript
   // 1. Prüfe ob die Mail im INBOX liegt (nur INBOX-Mails auto-verschieben)
   // 2. Lade alle aktiven SenderProfiles des Users
   // 3. Prüfe ob fromEmail zu einem Profil matcht
   // 4. Wenn ja UND folderPath === "INBOX" (oder startsWith("INBOX")):
   //    → moveIndexedEmail(emailId, userId, profile.targetFolder)
   //    → emailIndex.update({ folderPath: profile.targetFolder })
   //    → Response enthält { movedTo: "Kunden/Tatramont" } als Hinweis
   ```

2. **Frontend-Feedback:**
   - Wenn die `mark-read`-Response `movedTo` enthält:
     - Kurzer Toast: "E-Mail verschoben nach Kunden/Tatramont"
     - Mail aus der aktuellen Liste entfernen (optimistisch)
     - Ggf. nächste Mail in der Liste auswählen

3. **Ausnahmen – NICHT verschieben wenn:**
   - Mail ist nicht im INBOX (schon in einem Unterordner)
   - User hat "autoApplyUserRules" in AutomationSettings deaktiviert
   - SenderProfile hat `isActive: false`
   - Mail hat Label/Flag das Verschiebung verhindert (z.B. manuell in INBOX behalten)

4. **Neues Feld in EmailIndex (optional):**
   ```prisma
   autoMoveBlocked  Boolean  @default(false)  // User will diese Mail manuell im INBOX behalten
   ```
   
   Oder einfacher: Wenn der User eine Mail per Drag&Drop zurück in den INBOX zieht, wird sie nicht erneut verschoben (prüfe ob `suggestedFolder === folderPath` bereits).

### Akzeptanzkriterien
- [ ] Neue E-Mails bleiben im INBOX bis sie gelesen werden
- [ ] Nach dem Öffnen/Lesen wird die Mail automatisch in den Profil-Zielordner verschoben
- [ ] Ein Toast informiert über die Verschiebung
- [ ] Die Mail verschwindet aus der INBOX-Liste
- [ ] Mails die NICHT im INBOX liegen werden nicht verschoben
- [ ] Das Feature respektiert `isActive` des SenderProfiles
- [ ] Kein automatisches Verschieben wenn kein passendes Profil existiert

---

## Feature 3: Label-System mit virtuellen Ordnern

### Ziel
E-Mails können Labels/Tags erhalten (z.B. "Rechnung", "Angebot", "Vertrag", "Mahnung"). Diese Labels existieren nur in der MailPilot-Datenbank (nicht auf dem IMAP-Server). Über virtuelle Ordner kann der User alle E-Mails eines Labels zusammen sehen.

### Konzept
- E-Mail liegt physisch in `Kunden/Tatramont` (IMAP-Ordner)
- Zusätzlich hat sie das Label `Rechnung`
- Unter "Labels" in der Sidebar erscheint ein virtueller Ordner "Rechnungen"
- Dort sieht man ALLE E-Mails mit Label "Rechnung" – ordnerübergreifend

### Umsetzung

**1. Prisma Schema erweitern:**

```prisma
// In model EmailIndex – neues Feld:
labels          String[]         @default([])

// Neues Model für Label-Definitionen:
model EmailLabel {
  id          String   @id @default(cuid())
  userId      String
  name        String           // "Rechnung", "Angebot", "Vertrag"
  color       String?          // Hex-Farbe für die UI, z.B. "#f59e0b"
  icon        String?          // Optional: Emoji oder Icon-Name
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  @@unique([userId, name])
  @@index([userId])
}
```

**Neuer Index auf EmailIndex:**
```prisma
@@index([accountId, labels])   // Für schnelle Label-Filterung (Postgres GIN)
```

**2. Migration erstellen:**
```bash
npx prisma migrate dev --name add-labels-system
```

**3. Backend-Endpunkte:**

**`src/app/api/labels/route.ts`** (GET, POST):
```typescript
// GET: Alle Labels des Users mit Anzahl der zugeordneten Mails
// Response: [{ id, name, color, icon, emailCount }]
// POST: Neues Label erstellen { name, color?, icon? }
```

**`src/app/api/labels/[id]/route.ts`** (PUT, DELETE):
```typescript
// PUT: Label umbenennen/Farbe ändern
// DELETE: Label löschen (Labels von Mails entfernen)
```

**`src/app/api/emails/[id]/labels/route.ts`** (POST, DELETE):
```typescript
// POST: Label zu einer E-Mail hinzufügen { label: "Rechnung" }
// DELETE: Label von einer E-Mail entfernen { label: "Rechnung" }
```

**`src/app/api/emails/by-label/route.ts`** (GET):
```typescript
// GET /api/emails/by-label?label=Rechnung&cursor=...&limit=50
// Gibt alle E-Mails mit diesem Label zurück (paginiert, nach Datum sortiert)
// Über alle Ordner und Konten des Users hinweg
```

**4. Frontend: Label-Vergabe in der Mail-Detailansicht**

In `mail-workspace.tsx`, im E-Mail-Detail (rechte Seite):
- Unterhalb der Betreffzeile: Bereich für Labels (farbige Chips)
- Button "+ Label" → Dropdown mit existierenden Labels + "Neues Label erstellen"
- Klick auf ein Label-Chip → Label entfernen (mit Bestätigung oder X-Icon)

```
┌─────────────────────────────────────────────────────┐
│ Von: Tatramont GmbH                    02.07.2026   │
│ Betreff: Rechnung 16. KW                           │
│ Labels: [🟡 Rechnung ✕] [🟢 Subunternehmer ✕] [+] │
├─────────────────────────────────────────────────────┤
│ (E-Mail-Body...)                                    │
└─────────────────────────────────────────────────────┘
```

**5. Frontend: Virtuelle Ordner in der Sidebar**

In der Ordner-Sidebar (links), unterhalb der IMAP-Ordner:
```
▼ 📂 Labels
    🟡 Rechnungen (47)
    🟢 Angebote (12)
    🔵 Verträge (8)
    🟣 Mahnungen (3)
```

- Klick auf ein Label → lädt E-Mails via `/api/emails/by-label?label=Rechnung`
- Darstellung wie eine normale Ordneransicht (gleiche Mail-Liste)
- Neuer State: `selectedLabel` (string | null) – wenn gesetzt, zeigt Label-Ansicht statt Ordner

**6. Integration mit SenderProfile (automatische Labels):**

SenderProfile Model erweitern:
```prisma
// In model SenderProfile – neues optionales Feld:
autoLabels    String[]    @default([])   // Labels die automatisch gesetzt werden
```

Wenn eine Mail per Profil-Regel verschoben wird (Feature 2), werden automatisch die `autoLabels` gesetzt:
```typescript
// In mark-read/route.ts nach dem Verschieben:
if (profile.autoLabels.length > 0) {
  const currentLabels = email.labels ?? [];
  const mergedLabels = [...new Set([...currentLabels, ...profile.autoLabels])];
  await prisma.emailIndex.update({
    where: { id: email.id },
    data: { labels: mergedLabels },
  });
}
```

**7. Label-Verwaltungsseite: `src/app/labels/page.tsx`**

- Alle Labels auflisten mit Farbe, Anzahl Mails
- Erstellen / Bearbeiten / Löschen
- Farbe per Color-Picker wählen
- Link in Navigation/Settings

### Akzeptanzkriterien
- [ ] `labels` Feld existiert auf EmailIndex (String-Array)
- [ ] `EmailLabel` Model existiert für Label-Definitionen (Name, Farbe)
- [ ] User kann Labels erstellen, bearbeiten, löschen (Verwaltungsseite)
- [ ] User kann Labels an E-Mails vergeben und entfernen (Detailansicht)
- [ ] Labels werden als farbige Chips in der Mail-Detailansicht angezeigt
- [ ] Virtuelle Ordner in der Sidebar unter "Labels" mit Mailanzahl
- [ ] Klick auf virtuellen Ordner zeigt alle Mails mit diesem Label
- [ ] SenderProfile kann automatisch Labels setzen (`autoLabels`)
- [ ] Automatische Label-Vergabe funktioniert beim Verschieben (Feature 2)
- [ ] Performance: Label-Filterung ist effizient (DB-Index)
- [ ] Navigation: Labels-Seite ist über Settings/Sidebar erreichbar

---

## Technische Hinweise

- **Framework:** Next.js 16 (App Router), React 19, Tailwind CSS 4
- **DB:** Prisma 7, PostgreSQL – Schema in `prisma/schema.prisma`
- **Hauptkomponente:** `src/components/mail/mail-workspace.tsx` (~5500 Zeilen)
- **Sender-Matcher:** `src/server/rules/senderMatcher.ts`
- **Sender-Profile APIs:** `src/app/api/sender-profiles/`
- **Mark-Read API:** `src/app/api/emails/[id]/mark-read/route.ts`
- **Lint:** `npm run lint` und `npm run typecheck` müssen fehlerfrei durchlaufen
- **Prisma:** Nach Schema-Änderung `npx prisma migrate dev` lokal, `npx prisma migrate deploy` auf Server
- **Nach jeder Änderung:** `docker compose -f docker-compose.prod.yml --env-file .env.production build && docker compose -f docker-compose.prod.yml --env-file .env.production up -d`

---

## Reihenfolge & Abhängigkeiten

```
Feature 3 (Labels) → Feature 1 (Auto-Prompt) → Feature 2 (Verschiebung nach Lesen)
```

- **Feature 3 zuerst:** Schema-Änderung (Migration) + Label-CRUD als Basis
- **Feature 1 danach:** Nutzt vorhandene SenderProfile-Infrastruktur + kann Labels im Prompt anbieten
- **Feature 2 zuletzt:** Nutzt SenderProfile + Labels zusammen, baut auf beiden auf

---

## Zusammenfassung der Schema-Änderungen

```prisma
// EmailIndex – neue Felder:
labels           String[]    @default([])
autoMoveBlocked  Boolean     @default(false)

// SenderProfile – neues Feld:
autoLabels       String[]    @default([])

// Neues Model:
model EmailLabel {
  id        String   @id @default(cuid())
  userId    String
  name      String
  color     String?
  icon      String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  @@unique([userId, name])
  @@index([userId])
}
```
