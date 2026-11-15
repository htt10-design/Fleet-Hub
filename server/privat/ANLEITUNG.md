# Private PocketBase-Instanz „privat“ – Schritt für Schritt

Ziel: **SGS Pro und künftige private Apps** laufen auf einer **eigenen PocketBase**, getrennt von den Job-Apps.
Deine Freundin kommt **ohne Tailscale-App** dran, trotzdem ist so wenig wie möglich öffentlich.

```
Internet ──► Tailscale Funnel :8443 ──► Caddy-Filter ──► PocketBase „privat“
                                         (nur App-Anfragen,
                                          alles andere = 403)

Tailnet  ──► tailscale serve :10000 ──────────────────► PocketBase „privat“ (Admin /_/)

Tailnet  ──► :443 (wie bisher) ───────────────────────► PocketBase „Job“ (bleibt unverändert)
```

Was das bringt:

- **Keine Portfreigabe im Router**, deine Heim-IP bleibt verborgen (der Verkehr läuft über Tailscale).
- Öffentlich erreichbar ist **nur** das, was die App braucht: Anmelden, eigene Fahrzeuge/Fotos lesen und schreiben.
  Admin-Oberfläche, Admin-Login, Einstellungen, Backups, Logs, Registrierung → **gesperrt (403)**.
- Die Admin-Oberfläche erreichst nur du, und nur aus dem Tailnet.
- Die Job-Instanz wird nicht angefasst und bleibt nur im Tailnet.

**Annahmen:** PocketBase läuft per Docker (Compose), Tailscale ist **direkt auf dem Heimserver** installiert
(nicht als Container). Läuft Tailscale bei dir in einem Container, sag Bescheid – dann ändern sich nur die
`tailscale`-Befehle in Schritt 3.

> Hinweis: Die Filterregeln wurden gegen alle Anfragen geprüft, die die App tatsächlich stellt (19 erlaubt,
> 22 gesperrt, 0 Fehler). Caddy selbst konnte ich hier nicht starten – deshalb ist Schritt 7 (Test) wichtig.

---

## Schritt 1 – Dateien auf den Server holen

Auf dem Heimserver (SSH):

```bash
mkdir -p ~/pb-privat && cd ~/pb-privat
for f in Dockerfile docker-compose.yml Caddyfile; do
  wget -q "https://raw.githubusercontent.com/htt10-design/Fleet-Hub/main/server/privat/$f" -O "$f"
done
wget -q "https://raw.githubusercontent.com/htt10-design/Fleet-Hub/main/server/pocketbase-collections.json"
ls
```

(Falls das Repo privat ist: die vier Dateien aus GitHub kopieren und per Editor anlegen.)

## Schritt 2 – Container starten

```bash
cd ~/pb-privat
docker compose up -d --build
docker compose ps          # beide: "running"
curl -s http://127.0.0.1:8095/api/health      # direkt  -> {"message":"API is healthy.",...}
curl -s http://127.0.0.1:8096/api/health      # Filter  -> dasselbe
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8096/_/   # Filter -> 403
```

Admin-Konto (Superuser) anlegen – **eigene E-Mail + langes Passwort** (nicht dasselbe wie bei der Job-Instanz):

```bash
docker compose exec pb-privat /pb/pocketbase superuser upsert DEINE@MAIL.DE 'LangesPasswort' --dir=/pb/pb_data
```

Die Daten liegen im Docker-Volume `pb_privat_data` – getrennt von allem anderen.

## Schritt 3 – Tailscale: Admin nur im Tailnet, App öffentlich

```bash
sudo tailscale serve  --bg --https=10000 http://127.0.0.1:8095   # Admin, NUR Tailnet
sudo tailscale funnel --bg --https=8443  http://127.0.0.1:8096   # App, öffentlich (gefiltert)
tailscale serve status
```

`tailscale serve status` sollte so etwas zeigen:

```
https://heimserver.tail8f2780.ts.net (tailnet only)        ← Job-Instanz, wie bisher
https://heimserver.tail8f2780.ts.net:8443 (Funnel on)      ← privat, über Filter
https://heimserver.tail8f2780.ts.net:10000 (tailnet only)  ← privat, Admin
```

Wichtig:

- **Nur 8443 darf „Funnel on“ haben.** Steht bei `:443` oder `:10000` „Funnel on“ → `sudo tailscale funnel --https=443 off` bzw. `--https=10000 off`.
- Meldet der Funnel-Befehl, dass Funnel nicht erlaubt ist, zeigt er einen Link. Den öffnen und Funnel für
  **diesen einen Rechner** freigeben (Tailscale-Admin → Access controls; der Link erledigt das meist automatisch).

## Schritt 4 – PocketBase einrichten (im Tailnet)

Admin öffnen: **`https://heimserver.tail8f2780.ts.net:10000/_/`** → mit dem Superuser aus Schritt 2 anmelden.

1. **Settings → Import collections** → Inhalt von `pocketbase-collections.json` einfügen → *Review* →
   Haken **„Merge with the existing collections“ setzen** → *Confirm*.
   (Ohne den Haken würde `users` gelöscht.)
2. **Collections → users** → Zahnrad:
   - **Fields:** `name` (Text) ist schon da. Neues Feld **Bool** mit Name **`gast`** hinzufügen.
   - **API Rules:**
     - *List/Search* und *View*: `@request.auth.id != ""`
     - *Create*, *Update*, *Delete*: jeweils **„Set superusers only“** drücken
       (Regel ist danach leer mit Schloss = nur Admin; keine Selbstregistrierung)
   - Speichern.
3. **Settings → Application → Rate limiting** → einschalten (Standardwerte passen) → Speichern.
4. **Settings → Superusers / Auth options:** **OTP/MFA** für Superuser einschalten, wenn du magst
   (dann kommt beim Admin-Login zusätzlich ein Code per Mail – braucht SMTP unter Settings → Mail).
5. **Settings → Backups:** automatisches Backup einschalten, z. B. täglich, 7 behalten.

## Schritt 5 – Konten anlegen

**Collections → users → New record**, je Person:

| | E-Mail | Passwort | name | gast |
|---|---|---|---|---|
| Du | deine Mail | lang, neu | dein Name | aus |
| Freundin | ihre Mail | lang (min. 12 Zeichen) | ihr Name | **an** |

*Verified* kannst du anhaken; Mails werden keine verschickt.

## Schritt 6 – App umziehen

**Handy (zuerst):** Einstellungen → **Konto & Abgleich** → **Abmelden**
(„Die Daten bleiben auf diesem Gerät erhalten“ → OK).
Dann anmelden mit:

- Server: **`https://heimserver.tail8f2780.ts.net:8443`**
- dein neues Konto

Frage „… beides zusammenführen?“ → **OK**. Das Handy lädt alles (Fahrzeuge, Kunden, Fotos, Tank-Deal) hoch –
das kann bei vielen Fotos einen Moment dauern; das Wolken-Symbol oben zeigt den Stand.

**Tablet:** ebenfalls Abmelden → mit derselben Adresse und demselben Konto anmelden.
Bei der Frage **OK** (zusammenführen) – doppelte Einträge entstehen nicht, gleiche Fahrzeuge werden zusammengeführt.

**Freigabe neu setzen:** Fahrzeug öffnen → **Stammdaten → Freigabe** → Häkchen bei ihrem Namen.

**Freundin (iPhone):** App in Safari öffnen (ggf. „Zum Home-Bildschirm“) → Einstellungen → Konto & Abgleich →
Server `https://heimserver.tail8f2780.ts.net:8443`, ihre Mail + Passwort. **Tailscale-App kann sie löschen.**

## Schritt 7 – Testen (wichtig!)

Am Handy **Tailscale ausschalten, WLAN aus (mobile Daten)**, dann im Browser:

| Adresse | Erwartet |
|---|---|
| `https://heimserver.tail8f2780.ts.net:8443/api/health` | `{"message":"API is healthy." …}` |
| `https://heimserver.tail8f2780.ts.net:8443/_/` | leere Seite / 403 |
| `https://heimserver.tail8f2780.ts.net:8443/api/collections/_superusers/auth-with-password` | 403 |
| `https://heimserver.tail8f2780.ts.net:10000/_/` | lädt nicht |
| `https://heimserver.tail8f2780.ts.net/_/` (Job) | lädt nicht |
| App: Wolke antippen | „Abgeglichen“ |

Danach Tailscale wieder an. Klappt etwas nicht: `docker compose logs caddy pb-privat` und `tailscale serve status`
anschauen bzw. mir die Ausgabe schicken.

## Schritt 8 – Alte Instanz aufräumen

Erst wenn Schritt 7 passt und auf allen Geräten alles da ist:

Im Admin der **alten (Job-)Instanz** `https://heimserver.tail8f2780.ts.net/_/`:

- Collections `sgs_vehicles`, `sgs_customer_vehicles`, `sgs_user_settings`, `sgs_images` löschen
  (Collection → Zahnrad → *Delete*).
- Das Konto deiner Freundin löschen, ebenso dein SGS-Konto, falls es nur für SGS da war.
- Alles für die Job-Apps bleibt unangetastet (die Trennung dort machen wir im anderen Chat).

---

## Neue private App dazu

1. Collections mit eigenem Präfix anlegen, z. B. `haus_…` (Regeln immer mit `owner = @request.auth.id` o. ä.).
2. In `Caddyfile` an **beiden** Stellen `(sgs)` → `(sgs|haus)`.
3. `docker compose restart caddy`

Dieselben Konten gelten dann für alle privaten Apps.

## Updates

PocketBase-Version: in `Dockerfile` `PB_VERSION` ändern → `docker compose up -d --build`
(vorher Backup im Admin unter Settings → Backups).

## Warum ist das sicher genug?

- Wer die Adresse kennt, sieht nur `/api/health`; ohne Login liefern alle Daten-Abfragen nichts
  (die Regeln verlangen ein Konto, Fotos nur mit Login-Token).
- Konten anlegen/ändern ist von außen doppelt gesperrt (Filter **und** Regeln).
- Passwort-Raten bremst das Rate-Limit (Anmeldungen ~2 pro 3 Sekunden) – mit langen Passwörtern aussichtslos.
- Admin und Job-Instanz sind aus dem Internet gar nicht erreichbar.
- Funnel abschalten geht jederzeit: `sudo tailscale funnel --https=8443 off`.
