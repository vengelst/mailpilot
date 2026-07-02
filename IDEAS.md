# MailPilot – Ideen & Feature-Backlog

## Cross-Account Copy/Move (Drag & Drop zwischen Konten)

**Beschreibung:** E-Mails per Drag & Drop von einem IMAP-Konto in ein anderes kopieren/verschieben – wie in Outlook Classic.

**Technischer Ansatz:**
- Raw-Source per IMAP FETCH laden (existiert bereits im Code)
- Per ImapFlow `client.append()` auf das Ziel-Konto hochladen
- Flags und Datum beibehalten
- Frontend: Beim Drag Ordner aller Konten im Sidebar anzeigen

**Aufwand:** ~6-8 Stunden

**Risiken:**
- Große Anhänge → langsam bei schlechter Verbindung
- Bulk-Operationen (Hunderte Mails) = viele einzelne IMAP-Roundtrips
- Kein echter "Move" zwischen Konten möglich (nur Copy + Delete)
- Für Massenmigrationen besser: Google Workspace Migration Tool

**Status:** Idee – nicht priorisiert
