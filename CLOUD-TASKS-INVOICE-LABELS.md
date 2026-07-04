# Cloud-Auftrag: Rechnungserkennung via Rules + Labels

---

## Ziel

E-Mails, die Rechnungen enthalten (im Body oder als Anhang), sollen beim Öffnen automatisch erkannt und mit dem Label "Rechnungen" verknüpft werden. Die E-Mails bleiben im Original-Ordner, sind aber über das Label zentral auffindbar. Die Erkennung ist regelbasiert und vom User konfigurierbar.

## Trigger

**Beim Öffnen/Klicken einer neuen (ungelesenen) E-Mail** — nicht automatisch nach Sync. Wenn der User eine E-Mail öffnet, die noch nicht gegen Invoice-Regeln geprüft wurde, werden die Regeln ausgewertet und das Label ggf. gesetzt.

## Voraussetzungen

- Label-System existiert (`EmailLabel` + `EmailIndex.labels[]`)
- Regel-System existiert (`MailRule` mit `conditionJson`/`actionJson`)
- **Regeln können aktuell keine Labels setzen** → muss ergänzt werden
- **Anhangs-Dateinamen sind keine Regel-Bedingung** → muss ergänzt werden
- Das bestehende Regelsystem wird **erweitert, nicht verändert** — alle bestehenden Regeln und Aktionen funktionieren unverändert weiter

---

## Teil 1: Rules-Engine um `add_label`-Aktion erweitern

### 1.1 Schema (`src/server/rules/schemas.ts`)

Neue Aktion `add_label` in `ruleActionSchema` einfügen (zusätzlich zu den bestehenden Aktionen):

```typescript
z.object({ type: z.literal("add_label"), value: z.string().min(1) }).strict(),
```

Bestehende Aktionen bleiben unangetastet.

### 1.2 Engine (`src/server/rules/rulesEngine.ts`)

In `applyRuleAction()` neuen Handler **am Anfang** einfügen (vor den bestehenden Handlern):

```typescript
if (action.type === "add_label") {
  const email = await prisma.emailIndex.findUnique({
    where: { id: emailId },
    select: { labels: true },
  });
  if (email && !email.labels.includes(action.value)) {
    await prisma.emailIndex.update({
      where: { id: emailId },
      data: { labels: [...email.labels, action.value] },
    });
  }
  return { type: action.type, label: action.value };
}
```

### 1.3 UI (`src/app/rules/page.tsx`)

In `ACTION_OPTIONS` Array einfügen:

```typescript
{ value: "add_label", label: "Label zuweisen", needsValue: true },
```

Der Value-Input (Freitext) reicht zunächst. Optional: Dropdown mit bestehenden Labels aus `/api/labels`.

---

## Teil 2: Anhangs-Dateiname als Regel-Bedingung

### 2.1 Schema (`src/server/rules/schemas.ts`)

**Feld `attachmentFilename` in `ruleFieldSchema` einfügen:**

```typescript
const ruleFieldSchema = z.enum([
  "fromEmail",
  "fromDomain",
  "subject",
  "hasAttachments",
  "attachmentFilename",   // NEU
  "aiCategory",
  "aiPriority",
  "keywords",
]);
```

**Neue Bedingung:**

```typescript
const attachmentFilenameConditionSchema = z
  .object({
    field: z.literal("attachmentFilename"),
    operator: z.enum(["contains", "endsWith"]),
    value: z.string().min(1),
  })
  .strict();
```

In `ruleLeafConditionSchema` union einfügen. Die `stringBasedConditionSchema`-Exclude-Liste um `"attachmentFilename"` erweitern, damit kein Overlap entsteht.

### 2.2 Engine (`src/server/rules/rulesEngine.ts`)

**Email-Query erweitern** — Anhänge mitladen in `applyRulesForEmail()`:

```typescript
select: {
  // ... bestehende Felder bleiben ...
  attachments: {
    select: { filename: true },
  },
},
```

**Email-Typ für evaluateLeaf/evaluateNode/evaluateRuleCondition erweitern:**

Ein neues optionales Feld `attachmentFilenames?: string[]` zum Email-Typ hinzufügen. Vor dem Aufruf von `evaluateRuleCondition` die Filenames extrahieren:

```typescript
const emailForRules = {
  ...email,
  attachmentFilenames: email.attachments
    .map((a) => a.filename)
    .filter((f): f is string => !!f),
};
```

**evaluateLeaf erweitern:**

```typescript
case "attachmentFilename":
  return (email.attachmentFilenames ?? []).some((filename) =>
    stringOp(filename, condition.operator, condition.value)
  );
```

### 2.3 UI (`src/app/rules/page.tsx`)

In `FIELD_OPTIONS` einfügen:

```typescript
{ value: "attachmentFilename", label: "Anhang-Dateiname" },
```

In `OPERATOR_OPTIONS` einfügen:

```typescript
attachmentFilename: [
  { value: "contains", label: "enthält" },
  { value: "endsWith", label: "endet mit" },
],
```

---

## Teil 3: Invoice-Check beim Öffnen einer E-Mail

### 3.1 Neuer API-Endpunkt `POST /api/emails/[id]/check-rules`

Dieser Endpunkt wird beim Öffnen einer E-Mail aufgerufen. Er prüft, ob die E-Mail gegen Regeln mit `add_label`-Aktionen matcht, und wendet sie an.

```typescript
// src/app/api/emails/[id]/check-rules/route.ts

// POST — prüft und wendet Label-Regeln auf eine einzelne E-Mail an
// 1. Session prüfen
// 2. E-Mail laden (mit Attachments für attachmentFilename-Bedingungen)
// 3. Alle aktiven MailRules des Users laden (sortiert nach priority asc)
// 4. Nur Regeln auswerten, die mindestens eine add_label-Aktion haben
// 5. Bei Match: add_label-Aktionen ausführen (andere Aktions-Typen NICHT)
// 6. AuditLog schreiben
// 7. Response: { checked: number, labelsAdded: string[] }
```

**Wichtig:** Dieser Endpunkt führt NUR `add_label`-Aktionen aus, keine `move_*` oder andere Aktionen. So ist sichergestellt, dass beim bloßen Öffnen keine E-Mails verschoben werden.

**Optional:** Ein Flag `invoiceChecked: boolean` oder `labelsChecked: boolean` auf `EmailIndex`, damit eine E-Mail nicht bei jedem Öffnen erneut geprüft wird. Alternativ: prüfen ob das Label schon gesetzt ist.

### 3.2 Frontend-Integration (`src/components/mail/mail-workspace.tsx`)

Wenn der User eine **ungelesene** E-Mail öffnet (im bestehenden `openEmail`/`selectEmail`-Handler):

```typescript
// Nach dem Laden der E-Mail-Details:
// 1. Prüfen ob E-Mail ungelesen war (vor dem mark-read)
// 2. Falls ja: POST /api/emails/{id}/check-rules aufrufen
// 3. Falls labelsAdded.length > 0: Label-State aktualisieren
//    (kurze Toast-Notification: "Label 'Rechnungen' zugewiesen")
```

Der Aufruf erfolgt **fire-and-forget** im Hintergrund — die E-Mail wird sofort angezeigt, die Label-Zuweisung läuft parallel.

---

## Teil 4: Vorlagen für Rechnungs-Regeln

### 4.1 Vorlagen-Button in der Rules-UI

In `src/app/rules/page.tsx` einen Bereich **"Vorlagen"** einbauen (z.B. unterhalb der KI-Vorschläge):

**Button: "Rechnungs-Erkennung einrichten"**

Beim Klick:
1. Label "Rechnungen" anlegen (POST `/api/labels`, Farbe `#059669`, falls nicht vorhanden)
2. Folgende Regeln als Vorlagen anlegen:

**Regel 1: "Rechnung im Betreff"**
```json
{
  "name": "Rechnung im Betreff",
  "conditionJson": {
    "any": [
      { "field": "subject", "operator": "contains", "value": "Rechnung" },
      { "field": "subject", "operator": "contains", "value": "Invoice" },
      { "field": "subject", "operator": "contains", "value": "Zahlungsaufforderung" }
    ]
  },
  "actionJson": {
    "actions": [{ "type": "add_label", "value": "Rechnungen" }],
    "stopAfterMatch": false
  }
}
```

**Regel 2: "Rechnung als Anhang"**
```json
{
  "name": "Rechnung als Anhang",
  "conditionJson": {
    "all": [
      { "field": "hasAttachments", "operator": "equals", "value": true },
      {
        "any": [
          { "field": "attachmentFilename", "operator": "contains", "value": "rechnung" },
          { "field": "attachmentFilename", "operator": "contains", "value": "invoice" }
        ]
      }
    ]
  },
  "actionJson": {
    "actions": [{ "type": "add_label", "value": "Rechnungen" }],
    "stopAfterMatch": false
  }
}
```

**Regel 3: "KI erkennt Rechnung"** (optional, falls KI aktiv)
```json
{
  "name": "KI: Rechnung erkannt",
  "conditionJson": {
    "any": [
      { "field": "aiCategory", "operator": "equals", "value": "invoice" },
      { "field": "aiCategory", "operator": "equals", "value": "rechnung" }
    ]
  },
  "actionJson": {
    "actions": [{ "type": "add_label", "value": "Rechnungen" }],
    "stopAfterMatch": false
  }
}
```

`stopAfterMatch: false` ist wichtig — eine E-Mail kann Rechnung UND andere Regeln gleichzeitig matchen.

3. Vorschau anzeigen: "X bestehende E-Mails würden erkannt"

---

## Teil 5: Bestehende E-Mails nachträglich scannen

### 5.1 API-Endpunkt `POST /api/rules/apply-retroactive`

```typescript
// Body: { ruleIds?: string[] }
// Wenn ruleIds leer/undefined → alle aktiven Regeln mit add_label-Aktionen
// Nur add_label-Aktionen ausführen (keine move_*, set_*, etc.)
// Paginiert über alle EmailIndex des Users (500er Batches)
// Response: { processed: number, matched: number, labelsAdded: number }
```

### 5.2 UI

In der Rules-Seite pro Regel mit `add_label`-Aktion einen Button **"Auf bestehende E-Mails anwenden"**:
- Vorschau über `/api/rules/preview` (existiert bereits)
- Nach Bestätigung: `POST /api/rules/apply-retroactive` mit Rule-ID
- Ergebnis-Anzeige: "X E-Mails gelabelt"

---

## Zusammenfassung der zu ändernden Dateien

| Datei | Änderung | Typ |
|-------|----------|-----|
| `src/server/rules/schemas.ts` | `add_label`-Aktion + `attachmentFilename`-Bedingung | Erweiterung |
| `src/server/rules/rulesEngine.ts` | Label-Merge-Handler + Attachment-Join + evaluateLeaf-Case | Erweiterung |
| `src/app/rules/page.tsx` | FIELD/OPERATOR/ACTION_OPTIONS + Vorlagen-UI + Retroaktiv-Button | Erweiterung |
| `src/app/api/emails/[id]/check-rules/route.ts` | **NEU** — Label-Regelprüfung beim Öffnen | Neu |
| `src/app/api/rules/apply-retroactive/route.ts` | **NEU** — retroaktive Regelanwendung | Neu |
| `src/components/mail/mail-workspace.tsx` | Aufruf von check-rules beim Öffnen ungelesener E-Mails | Erweiterung |

**Keine DB-Migration nötig** — `EmailIndex.labels` und `EmailAttachment.filename` existieren bereits.

---

## Akzeptanzkriterien

1. Eine Regel mit `add_label`-Aktion kann erstellt, gespeichert und über die UI konfiguriert werden
2. Eine Regel mit `attachmentFilename`-Bedingung erkennt E-Mails anhand des Anhangsnamens
3. Beim Öffnen einer ungelesenen E-Mail werden Label-Regeln geprüft und Labels automatisch gesetzt
4. Die Vorlagen-Funktion erstellt Label + Regeln in einem Klick
5. Bestehende E-Mails können nachträglich gescannt werden (nur Label-Aktionen)
6. Alle bestehenden Regeln und Aktionen funktionieren weiterhin unverändert
7. Beim Öffnen werden NUR Label-Aktionen ausgeführt, keine Verschiebe-/Lösch-Aktionen

---

## Nicht im Scope

- Kopieren von E-Mails in andere Ordner (`copy_to_folder`-Aktion)
- KI-basierte Rechnungs-Inhaltsanalyse (Anhang-PDF lesen)
- Rechnungsdaten extrahieren (Betrag, Datum, Rechnungsnummer)
- Eigenes Rechnungs-Modul/Dashboard
- `SenderProfile.autoLabels` (separate Aufgabe)
- Automatische Regelauswertung nach Sync (kann später ergänzt werden)
