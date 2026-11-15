# SGS Pro – Server für den Abgleich (PocketBase)

Die App funktioniert weiter komplett offline. Ist auf einem Gerät ein Konto angemeldet
(Einstellungen → **Konto & Abgleich**), gleicht sie sich mit diesem Server ab:
Handy ↔ Tablet ↔ weitere Personen.

Getestet mit **PocketBase v0.40.6**.

## 1. Collections einspielen (einmalig)

1. PocketBase-Admin öffnen: `https://heimserver.tail8f2780.ts.net/_/`
2. **Settings → Import collections**
3. Inhalt von [`pocketbase-collections.json`](pocketbase-collections.json) einfügen → **Review** → **Confirm**
   - Haken bei „Delete missing collections“ **NICHT** setzen (sonst wären z. B. `users` weg).

Damit entstehen:

| Collection | Inhalt | Wer darf was |
|---|---|---|
| `sgs_vehicles` | ein Datensatz je Fahrzeug (`owner`, `shared_with`, `data`) | Besitzer: alles · geteilte Personen: sehen & Einträge machen, aber nicht löschen und die Freigabe nicht ändern |
| `sgs_customer_vehicles` | Kundenfahrzeuge | nur Besitzer |
| `sgs_user_settings` | Tank-Deal & Rechnungsdaten je Konto | nur Besitzer |
| `sgs_images` | alle Fotos als Dateien | angemeldete Nutzer; Abruf nur mit Login-Token |

Jede Änderung trägt eine Revision (`rev`/`base_rev`): Ändern zwei Geräte gleichzeitig, lehnt der
Server die ältere Änderung ab, die App holt den neuen Stand, führt beides zusammen und speichert erneut.

## 2. Collection `users` anpassen (von Hand, 1 Minute)

In **Collections → users**:

1. **Neues Feld** hinzufügen: Typ **Bool**, Name **`gast`**
2. **API Rules**:
   - *List/Search rule* und *View rule*: `@request.auth.id != ""`
     (damit die App beim Teilen die Namen der anderen Konten anzeigen kann)
   - *Create rule*: leer lassen und **sperren** (Schloss-Symbol = nur Admins) – keine Selbstregistrierung!
3. Speichern.

## 3. Konten anlegen

In **users → New record** je Person: E-Mail, Passwort, **Name** (wird in der App angezeigt).

- Du selbst: `gast` aus.
- Deine Freundin / weitere Personen: `gast` **an** → sie sehen nur die Garage mit den Fahrzeugen,
  die du ihnen freigibst (kein Kundenbereich, kein „Neues Fahrzeug“, kein Löschen/Archivieren).

Freigeben: in der App beim Fahrzeug → Reiter **Stammdaten** → Abschnitt **Freigabe** → Häkchen setzen.

## 4. Erreichbarkeit ohne Tailscale-App

Empfohlener Aufbau: eigene PocketBase-Instanz „privat“ (getrennt von anderen Apps), öffentlich nur über
Tailscale Funnel **hinter einem Filter**, der ausschließlich App-Anfragen durchlässt; Admin nur im Tailnet.
→ Schritt-für-Schritt: [`privat/ANLEITUNG.md`](privat/ANLEITUNG.md) (Dockerfile, docker-compose.yml, Caddyfile liegen daneben).

Ohne Funnel funktioniert alles genauso – dann braucht jedes Gerät die Tailscale-App.

## Hinweise

- Ohne Verbindung zum Server arbeitet die App normal weiter; Änderungen werden beim nächsten Kontakt abgeglichen.
- Die Backup-Datei (Einstellungen → Daten-Sicherung) enthält **keine** Zugangsdaten.
- „Alle Daten löschen“ setzt nur das Gerät zurück und meldet es ab – die Daten im Konto bleiben auf dem Server.
