# Cloud-Aufträge: Features 1–4

---

## Auftrag 1: Unified Inbox – "Alle Konten" Ansicht

### Ziel
Im Mail-Client soll ein "Alle Konten"-Modus verfügbar sein, der E-Mails aus allen IMAP-Konten des Users in einer kombinierten Ansicht zeigt (wie "Alle Postfächer" in Outlook Classic).

### Aktuelle Architektur
- `src/components/mail/mail-workspace.tsx`: State `selectedAccountId` (string, Pflicht) bestimmt, welches Konto angezeigt wird.
- `mailListSearchParams()` (Zeile ~1410) setzt immer `accountId` als Pflicht-Parameter.
- `/api/search/route.ts`: Der Parameter `accountId` ist bereits **optional** – ohne ihn wird über alle Konten gesucht. Das Backend ist also schon vorbereitet!
- Ordner (`folders` State) werden aktuell per `/api/accounts/${accountId}/folders` geladen – nur für ein Konto.

### Umsetzung

**Frontend (`mail-workspace.tsx`):**
1. `selectedAccountId` erlaubt jetzt den Wert `"__all__"` (oder leerer String) als "Alle Konten"-Modus.
2. Im Account-Dropdown (wo Konten gewählt werden) ganz oben einen Eintrag **"Alle Konten"** mit Value `"__all__"` einfügen.
3. `mailListSearchParams()` anpassen: Wenn `selectedAccountId === "__all__"`, dann `accountId` NICHT in die URL-Parameter aufnehmen.
4. Wenn `selectedAccountId === "__all__"`:
   - Ordner NICHT pro Account laden, sondern entweder:
     - (a) Nur virtuelle Ordner anzeigen: "INBOX", "Gesendet", "Papierkorb", "Spam" (als Spezialordner-Aggregation), ODER
     - (b) Ordner aller Konten laden und gruppiert anzeigen (mit Konto-Label)
   - Empfehlung: Variante (a) ist einfacher – suche einfach nach `folder=INBOX` ohne `accountId`.
5. `selectedFolderPath` im "Alle Konten"-Modus auf `"INBOX"` (Standard) setzen. Nur Spezialordner anbieten.
6. Sync-Buttons im "Alle Konten"-Modus deaktivieren oder alle Konten nacheinander syncen.

**Backend:** Keine Änderung nötig – `/api/search` unterstützt kontoübergreifende Suche bereits.

### Akzeptanzkriterien
- [ ] "Alle Konten" als erste Option im Dropdown sichtbar
- [ ] Bei Auswahl werden Mails aller Konten nach Datum sortiert angezeigt
- [ ] Man sieht, von welchem Konto eine Mail stammt (→ siehe Auftrag 3)
- [ ] Wechsel zwischen "Alle Konten" und Einzel-Konto funktioniert ohne Fehler
- [ ] Papierkorb-Button und Drag&Drop funktionieren weiterhin (Mail kennt ihr `accountId`)

---

## Auftrag 2: Duplikaterkennung

### Ziel
Doppelte E-Mails erkennen und dem User anzeigen, damit er sie löschen kann. Besonders relevant nach Migration zwischen Konten.

### Erkennung-Logik
Priorität der Duplikat-Erkennung:
1. **Gleiche `messageId`** (RFC 2822 Message-ID Header) – eindeutigster Indikator
2. **Fallback:** Gleicher Absender + gleicher Betreff + gleiches Datum (±1 Minute) + gleiche Größe

### Umsetzung

**Neuer API-Endpunkt: `src/app/api/emails/duplicates/route.ts`**
```typescript
// GET /api/emails/duplicates?accountId=optional&limit=100
// Findet Duplikate über alle Konten des Users
// Rückgabe: Gruppen von Duplikaten [{group: [email1, email2, ...], matchType: "messageId"|"heuristic"}]
```

Implementierung:
1. Alle EmailIndex-Einträge des Users laden (nur Header: id, accountId, messageId, subject, fromEmail, date, folderPath)
2. Gruppierung:
   - Primär: GROUP BY `messageId` WHERE count > 1 (SQL-seitig effizient)
   - Sekundär: In-Memory-Matching für Mails ohne messageId (subject+from+date±60s)
3. Pro Gruppe: Alle Duplikate zurückgeben mit Info welche "behalten" werden sollte (neueste, oder die im Hauptkonto)

**Frontend: Neue Seite oder Modal**
- Erreichbar über Settings oder als Button in der Mail-Ansicht
- Zeigt Duplikat-Gruppen als Liste
- Pro Gruppe: "Original behalten" (Checkbox) + "Duplikate löschen" Button
- Bulk-Aktion: "Alle Duplikate löschen" (mit Bestätigung)

### Akzeptanzkriterien
- [ ] API findet Duplikate zuverlässig per messageId
- [ ] Heuristik-Fallback funktioniert für Mails ohne messageId
- [ ] UI zeigt Duplikat-Gruppen übersichtlich an
- [ ] User kann einzeln oder in Bulk löschen
- [ ] Löschung nutzt existierende move-to-trash Logik (optimistisch)

---

## Auftrag 3: Konto-Indikator in der Mail-Liste

### Ziel
In der E-Mail-Liste (besonders in der Unified Inbox) soll sofort erkennbar sein, zu welchem Konto eine E-Mail gehört.

### Umsetzung

**Frontend (`mail-workspace.tsx`):**
1. Jede E-Mail hat bereits `accountId` im Response.
2. Den Account-Namen / die E-Mail-Adresse in der Mail-Liste anzeigen:
   - Als kleines farbiges Label/Badge neben dem Absender
   - Farbe: Jedes Konto bekommt eine feste Farbe (basierend auf Index oder Hash des Account-Namens)
   - Format: Kürzel (z.B. "IONOS", "Gmail") oder die E-Mail-Adresse gekürzt
3. Im Einzelkonto-Modus optional ausblenden (nur bei "Alle Konten" anzeigen) oder immer anzeigen (User-Entscheidung).

**Datenquelle:**
- `accounts` Array ist bereits im State – enthält `id`, `email`, `name`/`label`
- Mapping: `accountId` → Account-Label aus dem Array

### Akzeptanzkriterien
- [ ] Farbiger Konto-Indikator in jeder Mail-Zeile sichtbar
- [ ] Farben sind konsistent (gleiches Konto = gleiche Farbe)
- [ ] In Unified Inbox immer sichtbar
- [ ] In Einzelkonto-Ansicht ausgeblendet (da redundant)
- [ ] Responsive: auf Mobile nicht zu viel Platz verbrauchen

---

## Auftrag 4: KI-Sortierung und erweiterte Regel-Automation

### Ziel
Automatische Sortierung/Strukturierung von E-Mails basierend auf KI-Klassifizierung. Der User definiert Regeln wie "Alle Rechnungen → Ordner Rechnungen" oder "Newsletter → Archiv".

### Aktuelle Architektur (bereits vorhanden!)
- **Regel-Schema** (`src/server/rules/schemas.ts`): Unterstützt bereits Bedingungen auf `aiCategory`, `aiPriority`, `keywords` + Aktionen `move_folder`, `set_category`, `set_priority`, `move_trash`, `move_spam`
- **Regel-Engine** (`src/server/rules/rulesEngine.ts`): Existiert
- **Automation** (`src/app/api/automation/`): Zeitgesteuerte Läufe existieren
- **KI-Klassifizierung**: Kategorien und Prioritäten werden pro Mail gesetzt

### Was fehlt
1. **UI für KI-basierte Regeln** im Rules-Editor: Der User muss intuitiv Regeln erstellen können wie:
   - "Wenn KI-Kategorie = 'Rechnung' → verschiebe nach 'Rechnungen'"
   - "Wenn KI-Kategorie = 'Newsletter' UND Priorität = 'low' → verschiebe nach 'Newsletter'"
2. **Vorschläge:** Die KI soll basierend auf bestehenden Mails Regel-Vorschläge machen
3. **Auto-Anwendung bei Sync:** Nach jedem Sync neue Mails automatisch durch die Regel-Engine laufen lassen

### Umsetzung

**Frontend: Rules-Seite verbessern (`src/app/rules/page.tsx`)**
1. Regel-Wizard oder Formular mit:
   - Bedingung-Builder (Dropdown: Feld → Operator → Wert)
   - Speziell für KI-Felder: Dropdown mit existierenden Kategorien aus der DB
   - Aktions-Builder (was soll passieren)
   - Vorschau: "Diese Regel würde auf X Mails zutreffen"
2. KI-Vorschläge-Button: "Regeln vorschlagen" → KI analysiert Muster und schlägt Regeln vor

**Backend:**
1. Neuer Endpunkt `GET /api/rules/suggestions`: 
   - Analysiert die häufigsten aiCategory-Werte
   - Prüft, ob Mails mit dieser Kategorie verstreut in verschiedenen Ordnern liegen
   - Schlägt Regel vor: "58 Mails mit Kategorie 'Rechnung' → in Ordner 'Rechnungen' verschieben?"
2. Automation-Hook erweitern: Nach jedem Sync-Durchlauf automatisch Regel-Engine auf neue (unverarbeitete) Mails anwenden
3. Neuer Endpunkt `GET /api/rules/preview?ruleId=...`: Zeigt, welche existierenden Mails von einer Regel betroffen wären

### Akzeptanzkriterien
- [ ] User kann KI-basierte Regeln über UI erstellen (ohne JSON manuell schreiben)
- [ ] KI schlägt Regeln basierend auf Mailbestand vor
- [ ] Regel-Vorschau zeigt betroffene Mails
- [ ] Neue Mails werden nach Sync automatisch durch Regel-Engine verarbeitet
- [ ] Bestehende Regeln und Schemas bleiben kompatibel (keine Breaking Changes)

---

## Reihenfolge & Abhängigkeiten

```
Auftrag 3 (Konto-Indikator) → Auftrag 1 (Unified Inbox) → Auftrag 2 (Duplikate) → Auftrag 4 (KI-Regeln)
```

- **Auftrag 3** zuerst: klein, schnell, wird von Auftrag 1 benötigt
- **Auftrag 1** danach: baut auf Indikator auf, mittlerer Aufwand
- **Auftrag 2** unabhängig, aber logisch nach Unified Inbox
- **Auftrag 4** am umfangreichsten, zum Schluss

---

## Technische Hinweise für alle Aufträge

- **Framework:** Next.js 16 (App Router), React 19, Tailwind CSS 4
- **DB:** Prisma 7, PostgreSQL – Schema in `prisma/schema.prisma`
- **Hauptkomponente:** `src/components/mail/mail-workspace.tsx` (~5200 Zeilen)
- **Search-API:** `src/app/api/search/route.ts` – bereits kontoübergreifend fähig
- **Regel-Engine:** `src/server/rules/schemas.ts` + `rulesEngine.ts`
- **Lint:** `npm run lint` und `npm run typecheck` müssen fehlerfrei durchlaufen
- **Nach jeder Änderung:** `docker compose -f docker-compose.dev.yml up --build -d`
