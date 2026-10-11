# SGS Fahrzeug-Management Pro (Fleet-Hub)

Offline-fähige Single-Page-PWA zur Verwaltung von Autos, Anhängern und Booten
für private Schrauber (plus optionaler Bereich "Kundenfahrzeuge" mit Rechnungen).
Kein Server, kein Build-Schritt, keine Abhängigkeiten außer Chart.js (lokal in `vendor/`).
UI-Sprache und Code-Kommentare: Deutsch.

## Aufbau

```
index.html            gesamtes Markup (alle Bereiche, Tabs, Modals)
style.css             gesamtes Styling (Themes, Cockpit-Optik, Mobile-Card-Tabellen ab ~768px)
js/NN-*.js            App-Logik, klassische <script>-Dateien (KEINE ES-Module)
vendor/chart.umd.min.js  Chart.js 4.5.1, fest versioniert (offline verfügbar)
sw.js                 Service Worker (App-Shell-Cache, network-first)
manifest.json, icons/ PWA-Manifest, App-Icons, SGS-Logos (logo-dark/-light.png)
w124-front.webp       Foto für die Garagentor-Animation
tools/smoke-test.js   Browser-Smoke-Test (Playwright)
```

### js/-Dateien (Ladereihenfolge = Nummer)

| Datei | Inhalt |
|---|---|
| 01-core | `appData`-State, IndexedDB-Persistenz (`saveData`), `initApp`, Theme/Akzent, Bereichsauswahl, Motor-Helfer |
| 02-helpers | `escapeHtml`, KM-Formatierung, TÜV-Plakette, Wartungs-Erinnerungen, Fahrzeugkategorien |
| 03-garage | Fahrzeugkacheln, Long-Press-Kontextmenü, Archiv, Tab-Navigation (`showTab`), Stammdaten-Felder je Kategorie |
| 04-boats | Bootstyp, Motorenverwaltung, Zubehör-Boote |
| 05-tires | Reifen & Felgen |
| 06-tuev | TÜV/HU-Wizard |
| 07-vehicle | `loadActiveVehicle`, Neues-Fahrzeug-Modal, Fahrzeugfoto, Stammdaten speichern |
| 08-images | Bildzuschnitt & Zoom-Ansicht |
| 09-fuel | Tankungen (Formular, Tabelle, Verbrauch Voll-zu-Voll) |
| 10-service | Wartung & Service |
| 11-fahrzeugschein | Fahrzeugschein (Foto + digitale Felder) |
| 12-stand-entry | KM-/Stunden-Stand ohne Tankung erfassen |
| 13-dashboard | Dashboard, Charts, Chronik |
| 14-customers | Kundenfahrzeuge, Werkstattaufträge, Rechnungsdruck |
| 15-settings | Backup Export/Import, Einstellungen, Bildkomprimierung |
| 16-sale-report | Verkaufsbericht (Druck) |
| 17-acar-import | Import aus aCar (.abp) |
| 18-fuel-deal | Optionaler Tank-Deal (z.B. Shell Smart Deal): Literkontingent Monat/Jahr, Ersparnis |
| 19-cost-details | Popup „Kosten im Detail“ hinter der Gesamtkosten-Kachel (Zeitraum, Kategorien, Kraftstoffsorten, Verlauf, Top-Posten) |

## Konventionen

- Alle Dateien teilen sich den globalen Scope. Funktionen, die aus `onclick=""` im
  HTML aufgerufen werden, sind globale Funktionsdeklarationen (oft zusätzlich `window.x = x`).
- Top-Level-Code darf nur Konstanten/Variablen mit Literalen anlegen. Logik läuft erst
  ab `DOMContentLoaded` → `initApp()`, so ist die Datei-Reihenfolge unkritisch.
  Kein Name darf in zwei Dateien deklariert werden.
- Neue Datei in `js/`? → in `index.html` als `<script>` UND in `sw.js` `APP_SHELL_FILES` eintragen.
- Daten ändern: `appData` mutieren, dann `saveData()`; danach die passenden `render*()` aufrufen.
- Benutzertext, der per `innerHTML`/Template-String ausgegeben wird, mit `escapeHtml()` escapen.
- Datenmodell abwärtskompatibel halten (fehlende Felder tolerieren) – es gibt keine Migrationen,
  und Backups (JSON-Export) älterer Versionen müssen importierbar bleiben.
- **Bei jeder Änderung an index.html / js / style.css `CACHE_VERSION` in `sw.js` hochzählen.**

## Prüfen

```
node --check js/*.js            # Syntax (pro Datei einzeln aufrufen)
node tools/smoke-test.js        # lädt die App mobil + desktop, klickt Tabs durch, meldet JS-Fehler
```
Screenshots landen in `.smoke/` (ignoriert).
