/* --- STATE MANAGEMENT --- */
let appData = {
  activeVehicleId: null,
  activeCustomerVehicleId: null,
  theme: "dark",
  backgroundStyle: "concrete",
  accentColor: "amber",
  uiStyle: "standard",
  customerVehiclesEnabled: true,
  vehicles: [],
  customerVehicles: [],
  businessInfo: null,
  lastBackupDate: null
};

// Vorbelegung für die Rechnungsdaten (Fußzeile der Kundenrechnung), editierbar in den Einstellungen
function getDefaultBusinessInfo() {
  return {
    name: "SGS Fahrzeug-Service",
    subtitle: "Smart Garage Solutions & Werkstattdokumentation",
    iban: "DE00 0000 0000 0000 0000 00",
    bic: "XXXXXXXXXXX",
    bank: "Musterbank",
    paypalMe: "paypal.me/SGSFahrzeugservice",
    paypalEmail: "paypal@sgs-service.de"
  };
}

let consumptionChartInstance = null;
let costPieChartInstance = null;
let tempServiceImages = [];
let tempCustomerServiceImages = [];

/* --- PERSISTENZ: IndexedDB (ersetzt localStorage) ---
   localStorage ist pro Seite meist auf 5-10MB begrenzt - mit Fahrzeugfotos,
   Fahrzeugschein-Scans und Beleg-Fotos ist das schnell ausgereizt.
   IndexedDB bietet üblicherweise mehrere hundert MB und ist genauso lokal
   auf dem Gerät gespeichert, nur mit viel mehr Platz. */
const SGS_DB_NAME = 'sgs_pro_db';
const SGS_DB_STORE = 'kv';
let sgsDbPromise = null;

function sgsOpenDb() {
  if (sgsDbPromise) return sgsDbPromise;
  sgsDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(SGS_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SGS_DB_STORE)) {
        db.createObjectStore(SGS_DB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return sgsDbPromise;
}

function sgsIdbGet(key) {
  return sgsOpenDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(SGS_DB_STORE, 'readonly');
    const req = tx.objectStore(SGS_DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

function sgsIdbSet(key, value) {
  return sgsOpenDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(SGS_DB_STORE, 'readwrite');
    tx.objectStore(SGS_DB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

function sgsIdbDelete(key) {
  return sgsOpenDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(SGS_DB_STORE, 'readwrite');
    tx.objectStore(SGS_DB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

/* --- INITIALISIERUNG --- */
document.addEventListener('DOMContentLoaded', () => {
  initApp();

  // Splash-Screen (Logo) kurz zeigen, dann sanft ausblenden
  const splash = document.getElementById('splashScreen');
  if (splash) {
    setTimeout(() => {
      splash.classList.add('splash-hide');
    }, 1200);
  }

  // Service Worker registrieren (App-Shell-Caching, Offline-Fähigkeit) und
  // den Browser bitten, den Speicher der App als "wichtig" einzustufen,
  // damit er bei Speicherdruck nicht als Erstes weggeräumt wird
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.warn('Service Worker konnte nicht registriert werden:', err);
    });
  }
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }
});

async function initApp() {

  let appDataLoaded = false;

  try {
    const savedIdb = await sgsIdbGet('sgs_data');
    if (savedIdb) {
      appData = savedIdb;
      appDataLoaded = true;
    }
  } catch (e) {
    console.error('Fehler beim Laden aus IndexedDB:', e);
  }

  // Einmalige Migration von alten Speicherständen aus localStorage (falls
  // vorhanden und noch nichts in IndexedDB liegt)
  if (!appDataLoaded) {
    const savedLegacy = localStorage.getItem('sgs_data') || localStorage.getItem('fleethub_data');
    if (savedLegacy) {
      try {
        appData = JSON.parse(savedLegacy);
        appDataLoaded = true;
        await sgsIdbSet('sgs_data', appData);
        localStorage.removeItem('sgs_data');
        localStorage.removeItem('fleethub_data');
      } catch (e) {
        console.error("Fehler beim Laden des alten Speicherstands, Fallback auf Standardwerte", e);
      }
    }
  }

  if (!appDataLoaded) {
    loadDefaultData();
  }

  if (!appData.vehicles || appData.vehicles.length === 0) {
    loadDefaultData();
  }
  if (!appData.activeVehicleId || !appData.vehicles.some(v => v.id === appData.activeVehicleId)) {
    appData.activeVehicleId = appData.vehicles[0].id;
  }

  if (!appData.customerVehicles) {
    appData.customerVehicles = [];
  }

  // Migration: ältere Datenstände bekommen die neuen Einstellungsfelder nachgereicht
  if (!appData.businessInfo) {
    appData.businessInfo = getDefaultBusinessInfo();
  }
  if (appData.lastBackupDate === undefined) {
    appData.lastBackupDate = null;
  }
  if (!appData.backgroundStyle) {
    appData.backgroundStyle = 'concrete';
  }
  if (!appData.accentColor) {
    appData.accentColor = 'amber';
  }
  if (appData.customerVehiclesEnabled === undefined) {
    appData.customerVehiclesEnabled = true;
  }
  if (!appData.uiStyle) {
    appData.uiStyle = 'standard';
  }
  // Migration: bestehende Fahrzeuge bekommen den neuen Archiv-Status nachgereicht
  appData.vehicles.forEach(v => {
    if (v.archived === undefined) v.archived = false;
    if (!v.category) v.category = 'auto';
    // Migration: Boote bekommen die neuen Felder (Bootstyp, Motorenliste, Zubehör-Verknüpfung)
    if (v.category === 'boot') {
      if (!v.boatType) v.boatType = 'motorboot';
      if (!v.engines) {
        v.engines = v.engineNumber ? [{ id: 'eng_migrated_' + v.id, name: 'Motor 1', number: v.engineNumber }] : [];
      }
      if (v.belongsToId === undefined) v.belongsToId = null;
      // Boote laufen praktisch immer über Betriebsstunden - bestehende, versehentlich
      // auf "km" stehende Boote hier einmalig korrigieren
      if (v.type !== 'hours') v.type = 'hours';
    }
  });

  applyTheme(appData.theme || 'dark');
  applyBackgroundStyle(appData.backgroundStyle);
  applyAccentColor(appData.accentColor);
  applyUiStyle(appData.uiStyle);
  applyCustomerVehiclesVisibility();

  const fuelDateEl = document.getElementById('fuelDate');
  const serviceDateEl = document.getElementById('serviceDate');
  const custServiceDateEl = document.getElementById('custServiceDate');

  if (fuelDateEl) fuelDateEl.value = new Date().toISOString().split('T')[0];
  if (serviceDateEl) serviceDateEl.value = new Date().toISOString().split('T')[0];
  if (custServiceDateEl) custServiceDateEl.value = new Date().toISOString().split('T')[0];

  renderVehicleSelect();
  renderCustomerVehicleSelect();
  loadActiveVehicle();

  // ERGÄNZUNG: Initial auf das Dashboard wechseln
  const defaultNavBtn = document.querySelector('.nav-item[onclick*="dashboard"]');
  showTab('dashboard', defaultNavBtn);
}

function loadDefaultData() {
  appData = {
    activeVehicleId: "v1",
    activeCustomerVehicleId: null,
    theme: "dark",
    vehicles: [
      {
        id: "v1",
        name: "Mercedes E420 (W124)",
        plate: "KI-E 420",
        category: "auto",
        type: "km",
        fuelType: "Super Plus",
        vin: "WDB1240341B******",
        firstReg: "1994-05-12",
        hsn: "0708",
        tsn: "420",
        powerHp: 279,
        towingBraked: 1900,
        nextTuev: "2027-05",
        image: "",
        specs: "Motoröl: MB 229.5 5W-40 (8.0L)\nReifendruck: 2.3 bar / 2.5 bar\nZündkerzen: Bosch F8DC4",
        fuelEntries: [
          { id: "f1", date: "2026-08-10", fuelType: "Super Plus", mileage: 184200, liters: 72.5, totalPrice: 130.50, pricePerLiter: 1.80, full: true, hasAdditive: true, additiveName: "ERC Benzoinjection Reiniger", notes: "Aral Kiel" },
          { id: "f2", date: "2026-08-28", fuelType: "Super Plus", mileage: 184750, liters: 68.0, totalPrice: 122.40, pricePerLiter: 1.80, full: true, hasAdditive: false, additiveName: "", notes: "Shell" }
        ],
        serviceEntries: [
          { 
            id: "s1", 
            category: "Wartung", 
            title: "Ölwechsel + Ölfilter + Luftfilter", 
            date: "2026-05-15", 
            mileage: 182000, 
            cost: 95.00, 
            performer: "Eigenleistung", 
            notes: "8.0L Fuchs Titan GT1 5W-40 eingefüllt.\nÖlfilter Mann HU718/1k verbaut.\nAblassschraube mit 30 Nm angezogen.",
            images: [] 
          }
        ]
      }
    ],
    customerVehicles: [],
    businessInfo: getDefaultBusinessInfo(),
    lastBackupDate: null,
    backgroundStyle: "concrete",
    accentColor: "amber"
  };
  saveData();
}

function saveData() {
  // Absichtlich nicht "awaited" - der Aufrufer rendert direkt weiter aus dem
  // appData-Objekt im Speicher, das Schreiben auf die Platte läuft im
  // Hintergrund fertig
  sgsIdbSet('sgs_data', appData).catch(e => console.error('Fehler beim Speichern:', e));
}

function getActiveVehicle() {
  return appData.vehicles.find(v => v.id === appData.activeVehicleId);
}

function getActiveCustomerVehicle() {
  return appData.customerVehicles.find(c => c.id === appData.activeCustomerVehicleId);
}

/* --- THEME TOGGLE --- */
function toggleTheme() {
  const newTheme = appData.theme === 'light' ? 'dark' : 'light';
  setTheme(newTheme);
}

function setTheme(theme) {
  appData.theme = theme;
  saveData();
  applyTheme(theme);
}
window.setTheme = setTheme;

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const iconText = theme === 'light' ? '☀️' : '🌙';

  const icon = document.getElementById('themeToggleIcon');
  if (icon) icon.innerText = iconText;

  const iconSelection = document.getElementById('themeToggleIconSelection');
  if (iconSelection) iconSelection.innerText = iconText;

  const lightBtn = document.getElementById('themeSwitchLight');
  const darkBtn = document.getElementById('themeSwitchDark');
  if (lightBtn && darkBtn) {
    lightBtn.classList.toggle('active', theme === 'light');
    darkBtn.classList.toggle('active', theme !== 'light');
  }

  const v = getActiveVehicle();
  if (v) renderCharts(v);
}

// Wendet den gewählten App-Hintergrund an (siehe Einstellungen > Darstellung)
function applyBackgroundStyle(style) {
  document.body.setAttribute('data-bg-style', style || 'concrete');

  document.querySelectorAll('.bg-style-option').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-style') === (style || 'concrete'));
  });
}

function setBackgroundStyle(style) {
  appData.backgroundStyle = style;
  saveData();
  applyBackgroundStyle(style);
}
window.setBackgroundStyle = setBackgroundStyle;

// Wendet die gewählte Akzentfarbe an (siehe Einstellungen > Darstellung)
function applyAccentColor(color) {
  document.documentElement.setAttribute('data-accent', color || 'amber');

  document.querySelectorAll('.accent-color-option').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-accent') === (color || 'amber'));
  });
}

// Wendet den gewählten Design-Stil an (Standard oder Cockpit-Design)
function applyUiStyle(style) {
  document.documentElement.setAttribute('data-ui-style', style || 'standard');

  const standardBtn = document.getElementById('uiStyleStandard');
  const cockpitBtn = document.getElementById('uiStyleCockpit');
  if (standardBtn && cockpitBtn) {
    standardBtn.classList.toggle('active', (style || 'standard') === 'standard');
    cockpitBtn.classList.toggle('active', style === 'cockpit');
  }
}

function setUiStyle(style) {
  appData.uiStyle = style;
  saveData();
  applyUiStyle(style);
}
window.setUiStyle = setUiStyle;

function setAccentColor(color) {
  appData.accentColor = color;
  saveData();
  applyAccentColor(color);
}
window.setAccentColor = setAccentColor;

// Blendet die Kachel "Kundenfahrzeuge" auf dem Startbildschirm ein/aus,
// je nachdem ob die Funktion in den Einstellungen aktiviert ist
function applyCustomerVehiclesVisibility() {
  const enabled = appData.customerVehiclesEnabled !== false;

  const cardKunden = document.getElementById('card-kunden');
  const areaGrid = document.getElementById('area-selection-grid');
  if (cardKunden) cardKunden.style.display = enabled ? '' : 'none';
  if (areaGrid) areaGrid.classList.toggle('single-area', !enabled);

  const onBtn = document.getElementById('customerToggleOn');
  const offBtn = document.getElementById('customerToggleOff');
  if (onBtn) onBtn.classList.toggle('active', enabled);
  if (offBtn) offBtn.classList.toggle('active', !enabled);

  // Falls man gerade im Kundenmodus ist und die Funktion deaktiviert wird,
  // zurück zur Bereichsauswahl springen statt in einem ausgeblendeten Bereich hängen zu bleiben
  if (!enabled && currentMode === 'kunden') {
    backToSelection();
  }
}

function setCustomerVehiclesEnabled(enabled) {
  appData.customerVehiclesEnabled = enabled;
  saveData();
  applyCustomerVehiclesVisibility();
}
window.setCustomerVehiclesEnabled = setCustomerVehiclesEnabled;

// Variable zur Speicherung des aktuellen Modus
let currentMode = 'eigene';
// Hilfsfunktion zur Auslösung der verlangsamten Garagentor-Animation (Mercedes Edition)
function triggerGarageAnimation(callback) {
  const overlay = document.getElementById('garage-door-overlay');
  if (!overlay) {
    if (callback) callback();
    return;
  }

  overlay.classList.add('active');

  // Schaltet die Ansicht nach 1000ms um (genau bei der Hälfte der 2.0s)
  setTimeout(() => {
    if (callback) callback();
  }, 1000);

  // Blendet das Overlay nach Ablauf der 2.0s Gesamtzeit wieder ab
  setTimeout(() => {
    overlay.classList.remove('active');
  }, 2050);
}


// Bereichsauswahl steuern
function selectArea(area) {
  if (area === 'eigene') {
    // Tor-Animation auslösen
    triggerGarageAnimation(() => {
      // 1. Erst die Hauptkacheln ausblenden und die Fahrzeugauswahl einblenden
      const areaGrid = document.getElementById('area-selection-grid');
      const garageSelection = document.getElementById('garage-vehicle-selection');
      const title = document.getElementById('selection-title');

      if (areaGrid) areaGrid.style.display = 'none';
      if (garageSelection) garageSelection.style.display = 'block';
      if (title) title.innerText = 'Wähle dein Fahrzeug';

      // 2. Danach die gespeicherten Fahrzeuge als Kacheln laden
      try {
        renderGarageVehicleTiles();
      } catch (err) {
        console.error("Fehler beim Laden der Fahrzeug-Kacheln:", err);
      }
    });
  } else if (area === 'kunden') {
    // Kundenbereich bleibt wie gehabt: direkt in die App
    currentMode = 'kunden';

    document.getElementById('selection-screen').classList.add('hidden');
    document.getElementById('app-wrapper').classList.remove('hidden');
    document.body.classList.add('mode-kunden');
    document.body.classList.remove('mode-eigene');

    // 1. Korrekten ersten Tab öffnen und Sidebar-Button aktivieren
    const firstCustomerTabBtn = document.querySelector('.nav-kunden-only');
    if (typeof showTab === 'function') {
      showTab('tab-customer-records', firstCustomerTabBtn);
    }

    // 2. Kundenfahrzeuge laden und Ansicht sicher befüllen
    try {
      if (typeof renderCustomerVehicles === 'function') {
        renderCustomerVehicles();
      }

      // Automatisches Auswählen des ersten Fahrzeugs, damit Stammdaten & Arbeiten sofort da sind
      if (!appData.activeCustomerVehicleId && appData.customerVehicles.length > 0) {
        appData.activeCustomerVehicleId = appData.customerVehicles[0].id;
        saveData();
      }
      renderCustomerSection();
    } catch (err) {
      console.error("Fehler beim Laden der Kundendaten:", err);
    }
  }
}


// Ermittelt den aktuellen Kilometer-/Betriebsstundenstand aus Tank- & Wartungseinträgen
// Zentrale Stelle, ob ein Fahrzeug einen eigenen Antrieb hat (steuert Tanken-Tab,
// Verbrauchs-KPIs & -Grafiken). Anhänger nie, Boote je nach Bootstyp
// (ein Segelboot ohne Motor braucht z.B. kein Tanken).
function vehicleHasEngine(v) {
  if (!v) return false;
  if (v.category === 'anhaenger') return false;
  if (v.category === 'boot') return (v.boatType || 'motorboot') !== 'segel_ohne_motor';
  return true;
}

// Wiederverwendbare Bearbeiten-/Löschen-Icons (Vektor statt Emoji)
const ICON_EDIT_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const ICON_DELETE_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
const ICON_ARCHIVE_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8"/><line x1="10" y1="12" x2="14" y2="12"/></svg>';

// Liefert die Motorenliste eines Boots (leeres Array, falls keine vorhanden)
function getBoatEngines(v) {
  return (v && v.engines) || [];
}

// Aktuelle Betriebsstunden/KM-Stand EINES bestimmten Motors (nur Wartungseinträge,
// da Tankungen bei Booten motorunabhängig/gemeinsam erfasst werden)
function getEngineCurrentHours(v, engineId) {
  const serviceList = (v && v.serviceEntries) || [];
  const relevant = serviceList.filter(s => s.engineId === engineId).map(s => s.mileage || 0);
  return relevant.length > 0 ? Math.max(...relevant) : 0;
}

/* --- KM-/STUNDEN-EINGABEFELDER: AUTOMATISCHE TAUSENDERPUNKTE --- */
// Live-Formatierung während der Eingabe (z.B. "333200" -> "333.200").
// Erlaubt ein Komma für Nachkommastellen (z.B. Betriebsstunden "145,5").
function formatMileageInput(input) {
  let raw = input.value.replace(/[^\d,]/g, '');

  const commaIndex = raw.indexOf(',');
  let intPart = commaIndex === -1 ? raw : raw.slice(0, commaIndex);
  let decPart = commaIndex === -1 ? undefined : raw.slice(commaIndex + 1).replace(/,/g, '').slice(0, 2);

  intPart = intPart.replace(/^0+(?=\d)/, '');
  intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  input.value = decPart !== undefined ? `${intPart},${decPart}` : intPart;
}
window.formatMileageInput = formatMileageInput;

// Wandelt einen formatierten Wert ("333.200" oder "145,5") in eine echte Zahl um
function parseFormattedNumber(str) {
  if (!str) return 0;
  const normalized = str.toString().replace(/\./g, '').replace(',', '.');
  const num = parseFloat(normalized);
  return isNaN(num) ? 0 : num;
}
window.parseFormattedNumber = parseFormattedNumber;

// Wandelt eine echte Zahl in die formatierte Anzeige um ("333200" -> "333.200"),
// z.B. zum Vorbefüllen eines Feldes beim Bearbeiten eines Eintrags
function formatNumberForDisplay(num) {
  if (num === null || num === undefined || num === '' || isNaN(num)) return '';
  const parts = num.toString().split('.');
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return parts[1] ? `${intPart},${parts[1].slice(0, 2)}` : intPart;
}
window.formatNumberForDisplay = formatNumberForDisplay;

// Sortiert Einträge nach Datum (neueste zuerst); bei gleichem Datum kommt
// der Eintrag mit dem höheren KM-Stand/Betriebsstunden zuerst
function compareByDateThenMileageDesc(a, b) {
  const dateDiff = new Date(b.date) - new Date(a.date);
  if (dateDiff !== 0) return dateDiff;
  return (b.mileage || 0) - (a.mileage || 0);
}

function getVehicleCurrentMileage(v) {
  const fuelList = v.fuelEntries || [];
  const serviceList = v.serviceEntries || [];
  const allMileage = [
    ...fuelList.map(f => f.mileage || 0),
    ...serviceList.map(s => s.mileage || 0)
  ];
  return allMileage.length > 0 ? Math.max(...allMileage) : 0;
}

// Formatiert den TÜV-Termin (gespeichert als "YYYY-MM") als "MM/YYYY"
function formatTuevDate(value) {
  if (!value) return '-';
  const parts = value.split('-');
  if (parts.length === 2) return `${parts[1]}/${parts[0]}`;
  return value;
}

// Ermittelt Daten für die kleine TÜV-Plaketten-Grafik auf der Fahrzeugkachel:
// echte 6-Jahres-Farbrotation (Braun/Rosa/Grün/Orange/Blau/Gelb), Monat & Jahr
// zur Anzeige, sowie ob der Termin überfällig ist. Bei Booten gibt's keine
// Plakette (TÜV nicht relevant); ohne eingetragenes Datum eine leere Plakette.
function getTuevPlaketteData(v, compact) {
  if (v.category === 'boot') return null;

  if (!v.nextTuev) {
    return { empty: true, overdue: false, month: '', year: '', colorClass: '' };
  }

  const tuevColors = ['braun', 'rosa', 'gruen', 'orange', 'blau', 'gelb'];
  const parts = v.nextTuev.split('-');
  const year = parseInt(parts[0], 10);
  const month = parts[1];
  const colorClass = 'color-' + tuevColors[((year % 6) + 6) % 6];

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(v.nextTuev + '-01');
  const overdue = due < today;

  return {
    empty: false,
    overdue,
    month,
    year: (year % 100).toString().padStart(2, '0'),
    colorClass,
    monthRingHtml: buildTuevMonthRing(parseInt(month, 10), compact)
  };
}

// Baut das fertige HTML für eine TÜV-Plakette aus den Daten von getTuevPlaketteData()
// (wird sowohl auf der Fahrzeugkachel als auch im Dashboard verwendet)
function renderTuevPlaketteHtml(plakette) {
  if (!plakette) return '';
  if (plakette.empty) return `<div class="tuev-plakette tuev-plakette-empty"></div>`;
  return `
    <div class="tuev-plakette ${plakette.colorClass}">
      <div class="tuev-plakette-ring">${plakette.monthRingHtml}</div>
      <div class="tuev-plakette-center">
        <span class="tuev-plakette-year">${plakette.year}</span>
      </div>
      ${plakette.overdue ? '<span class="tuev-plakette-overdue-badge">!</span>' : ''}
    </div>
  `;
}

// Baut den Zahlenkranz mit allen 12 Monaten am Rand der Plakette (wie beim
// echten Vorbild): jede Zahl radial ausgerichtet (wie ein Uhrzeiger gedreht)
// und so positioniert, dass der fällige Monat oben (12-Uhr) steht
function buildTuevMonthRing(dueMonth, compact) {
  let html = '';
  const numRadius = compact ? 11 : 17; // Abstand der Zahlen vom Mittelpunkt (mittig zwischen innerem & äußerem Strich)
  const tickRadius = compact ? 16 : 24; // Abstand der äußeren Strichmarken (näher am Rand)
  const innerTickRadius = compact ? 8 : 12; // Abstand der kurzen inneren Striche (knapp außerhalb des Jahreskreises, bis zur Zahl)

  // Je Monat: kurzer Strich innen, Zahl in der Mitte, langer Strich außen -
  // alle drei auf derselben Linie/Winkel ausgerichtet.
  // Bei Monat 12 gibt's zusätzlich die spezielle, breitere Markierung wie beim Original.
  for (let m = 1; m <= 12; m++) {
    const angleDeg = (m - dueMonth) * 30; // 0° = oben, im Uhrzeigersinn
    const isTwoDigit = m >= 10;

    // Kurzer Strich von innen kommend (gleiche Stärke wie der äußere Strich)
    html += `<span class="tuev-plakette-tick tuev-plakette-tick-inner" style="transform: translate(-50%, -50%) rotate(${angleDeg}deg) translateY(-${innerTickRadius}px);"></span>`;

    if (m === 12) {
      // Spezialmarkierung: sitzt weiter außen und ragt NICHT in die Zahl hinein -
      // wirkt wie ein an dieser Stelle dickerer Rand
      html += `<span class="tuev-plakette-tick tuev-plakette-tick-special" style="transform: translate(-50%, -50%) rotate(${angleDeg}deg) translateY(-${tickRadius + 2}px);"></span>`;
    } else {
      html += `<span class="tuev-plakette-tick" style="transform: translate(-50%, -50%) rotate(${angleDeg}deg) translateY(-${tickRadius}px);"></span>`;
    }

    const numClass = isTwoDigit ? 'tuev-plakette-ring-num tuev-plakette-ring-num-narrow' : 'tuev-plakette-ring-num';
    html += `<span class="${numClass}" style="transform: translate(-50%, -50%) rotate(${angleDeg}deg) translateY(-${numRadius}px);">${m}</span>`;
  }

  return html;
}

// Ermittelt anstehende Routine-Wartungen anhand der hinterlegten KM-/Datums-Erinnerung.
// Pro Titel wird nur der jeweils neueste Wartungseintrag berücksichtigt (eine neue
// Wartung zum selben Thema ersetzt die alte Erinnerung).
function getUpcomingMaintenanceReminders(v) {
  const serviceList = v.serviceEntries || [];
  const currentMileage = getVehicleCurrentMileage(v);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const withReminder = serviceList.filter(s => s.category === 'Wartung' && (s.nextKm || s.nextDate));

  // Boote mit mehreren Motoren: Titel + Motor zusammen als Schlüssel, sonst würde
  // z.B. "Ölwechsel" von Motor 1 und Motor 2 fälschlich zusammengeworfen
  const boatEnginesForReminders = getBoatEngines(v);
  const multiEngine = v.category === 'boot' && boatEnginesForReminders.length > 1;

  const latestByTitle = {};
  withReminder.forEach(s => {
    const key = (s.title || 'Wartung').trim().toLowerCase() + '|' + (s.engineId || '');
    if (!latestByTitle[key] || new Date(s.date) > new Date(latestByTitle[key].date)) {
      latestByTitle[key] = s;
    }
  });

  const reminders = Object.values(latestByTitle).map(s => {
    const kmRemaining = s.nextKm ? Math.round(s.nextKm - currentMileage) : null;
    let daysRemaining = null;
    if (s.nextDate) {
      const due = new Date(s.nextDate);
      daysRemaining = Math.round((due - today) / (1000 * 60 * 60 * 24));
    }
    const overdue = (kmRemaining !== null && kmRemaining <= 0) || (daysRemaining !== null && daysRemaining <= 0);

    // Bei Booten mit mehreren Motoren den Motornamen an den Titel anhängen,
    // damit z.B. "Ölwechsel Motor 1" von "Ölwechsel Motor 2" unterscheidbar ist
    let displayTitle = s.title || 'Wartung';
    if (multiEngine) {
      const engineName = s.engineId
        ? (boatEnginesForReminders.find(e => e.id === s.engineId)?.name || 'Motor')
        : 'Allgemein/Rumpf';
      displayTitle = `${displayTitle} (${engineName})`;
    }

    return {
      title: displayTitle,
      nextKm: s.nextKm || null,
      nextDate: s.nextDate || null,
      kmRemaining,
      daysRemaining,
      overdue
    };
  });

  // Dringendste zuerst: überfällige ganz oben, danach nach verbleibender Zeit/Strecke sortiert
  reminders.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    const aMetric = a.daysRemaining !== null ? a.daysRemaining : (a.kmRemaining !== null ? a.kmRemaining / 30 : Infinity);
    const bMetric = b.daysRemaining !== null ? b.daysRemaining : (b.kmRemaining !== null ? b.kmRemaining / 30 : Infinity);
    return aMetric - bMetric;
  });

  return reminders;
}

// Formatiert die verbleibende Zeit/Strecke einer Erinnerung als kurzen Text (KM • Datum)
function formatReminderMeta(r, unitLabel) {
  const unit = unitLabel || 'km';
  const metaParts = [];
  if (r.nextKm) {
    metaParts.push(r.kmRemaining <= 0
      ? `${Math.abs(r.kmRemaining).toLocaleString('de-DE')} ${unit} überfällig`
      : `noch ${r.kmRemaining.toLocaleString('de-DE')} ${unit}`);
  }
  if (r.nextDate) {
    const dateText = r.isTuev ? formatTuevDate(r.nextDate) : new Date(r.nextDate).toLocaleDateString('de-DE');
    metaParts.push(r.daysRemaining <= 0
      ? `seit ${dateText} fällig`
      : `fällig am ${dateText}`);
  }
  return metaParts.join(' • ');
}

// Liefert das passende Icon-SVG (als kleiner Markup-Schnipsel) für eine Fahrzeugart
function getCategoryIconSvg(category) {
  switch (category) {
    case 'anhaenger':
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="14" height="8" rx="1"/><circle cx="7" cy="18" r="1.5"/><circle cx="13" cy="18" r="1.5"/><path d="M17 11h2.5a1.5 1.5 0 0 1 1.5 1.5V16h-4"/></svg>';
    case 'boot':
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17h18l-1.5 3a2 2 0 0 1-1.8 1H6.3a2 2 0 0 1-1.8-1L3 17Z"/><path d="M12 17V3"/><path d="M12 4l5 9H12Z"/></svg>';
    default:
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>';
  }
}

// Filter-Status für die Fahrzeugart-Auswahl (Alle/Autos/Anhänger/Boote) auf dem Kachel-Bildschirm
let vehicleCategoryFilter = 'all';

function setVehicleCategoryFilter(category) {
  vehicleCategoryFilter = category;
  document.querySelectorAll('.category-filter-chip').forEach(chip => {
    chip.classList.toggle('active', chip.getAttribute('data-category') === category);
  });
  renderGarageVehicleTiles();
  playCategoryDriveByAnimation(category);
}

// Kleine, dezente Spielerei: beim Wechsel des Fahrzeugart-Filters fährt/schwimmt
// das passende Icon einmal quer über den Bildschirm
function playCategoryDriveByAnimation(category) {
  if (category === 'all') return;

  const existing = document.querySelector('.category-drive-by-icon');
  if (existing) existing.remove();

  const icon = document.createElement('div');
  icon.className = 'category-drive-by-icon';
  icon.innerHTML = getCategoryIconSvg(category);
  document.body.appendChild(icon);

  setTimeout(() => icon.remove(), 2500);
}
window.setVehicleCategoryFilter = setVehicleCategoryFilter;

// Rendert alle gespeicherten eigenen Fahrzeuge als Auswahlkacheln hinter "Meine Garage"
// Sortiert eine Fahrzeugliste so um, dass ein Dingi direkt nach seinem
// zugehörigen Hauptboot einsortiert wird (statt irgendwo verstreut zu liegen)
function sortWithDinghiesGrouped(vehicles) {
  const consumed = new Set();
  const result = [];

  vehicles.forEach(v => {
    if (consumed.has(v.id)) return;
    // Dingis werden erst behandelt, wenn ihr Hauptboot an der Reihe ist
    if (v.belongsToId && vehicles.some(x => x.id === v.belongsToId)) return;

    result.push(v);
    consumed.add(v.id);

    vehicles.forEach(child => {
      if (child.belongsToId === v.id && !consumed.has(child.id)) {
        result.push(child);
        consumed.add(child.id);
      }
    });
  });

  // Übrig gebliebene Dingis (z.B. Hauptboot gerade rausgefiltert) am Ende anhängen
  vehicles.forEach(v => {
    if (!consumed.has(v.id)) {
      result.push(v);
      consumed.add(v.id);
    }
  });

  return result;
}

/* --- LANGES DRÜCKEN AUF EINE FAHRZEUGKACHEL: KONTEXTMENÜ --- */
let tileLongPressTimer = null;
let tileLongPressTriggered = false;

function attachTileLongPress(card, vehicleId) {
  let startX = 0;
  let startY = 0;

  const start = (e) => {
    tileLongPressTriggered = false;
    startX = e.clientX;
    startY = e.clientY;
    tileLongPressTimer = setTimeout(() => {
      tileLongPressTriggered = true;
      openTileContextMenu(vehicleId, card);
    }, 500);
  };
  const cancel = () => {
    clearTimeout(tileLongPressTimer);
  };
  // Kleine Bewegungstoleranz, damit natürliches leichtes Zittern beim
  // Gedrückthalten auf dem Handy den Timer nicht sofort abbricht
  const moveCheck = (e) => {
    const dx = Math.abs(e.clientX - startX);
    const dy = Math.abs(e.clientY - startY);
    if (dx > 10 || dy > 10) cancel();
  };

  card.addEventListener('pointerdown', start);
  card.addEventListener('pointerup', cancel);
  card.addEventListener('pointerleave', cancel);
  card.addEventListener('pointercancel', cancel);
  card.addEventListener('pointermove', moveCheck);
}

function openTileContextMenu(vehicleId, cardEl) {
  closeTileContextMenu();

  const menu = document.createElement('div');
  menu.className = 'tile-context-menu';
  menu.id = 'tileContextMenu';
  menu.innerHTML = `
    <button type="button" onclick="event.stopPropagation(); closeTileContextMenu(); chooseGarageVehicle('${vehicleId}', 'settings')">
      ${ICON_EDIT_SVG}<span>Bearbeiten</span>
    </button>
    <button type="button" onclick="event.stopPropagation(); closeTileContextMenu(); archiveVehicleById('${vehicleId}')">
      ${ICON_ARCHIVE_SVG}<span>Als verkauft archivieren</span>
    </button>
    <button type="button" class="tile-context-menu-danger" onclick="event.stopPropagation(); closeTileContextMenu(); deleteVehicleById('${vehicleId}')">
      ${ICON_DELETE_SVG}<span>Löschen</span>
    </button>
  `;
  document.body.appendChild(menu);

  // Position dicht an der Kachel, aber innerhalb des sichtbaren Bereichs
  const rect = cardEl.getBoundingClientRect();
  const menuWidth = 230;
  let left = rect.left + window.scrollX;
  if (left + menuWidth > window.innerWidth - 10) {
    left = window.innerWidth - menuWidth - 10;
  }
  menu.style.top = (rect.top + window.scrollY + 16) + 'px';
  menu.style.left = Math.max(10, left) + 'px';

  setTimeout(() => {
    document.addEventListener('click', closeTileContextMenuOnOutsideClick);
    document.addEventListener('scroll', closeTileContextMenu, true);
  }, 0);
}
window.openTileContextMenu = openTileContextMenu;

function closeTileContextMenuOnOutsideClick(e) {
  const menu = document.getElementById('tileContextMenu');
  if (menu && !menu.contains(e.target)) {
    closeTileContextMenu();
  }
}

function closeTileContextMenu() {
  const menu = document.getElementById('tileContextMenu');
  if (menu) menu.remove();
  document.removeEventListener('click', closeTileContextMenuOnOutsideClick);
  document.removeEventListener('scroll', closeTileContextMenu, true);
}
window.closeTileContextMenu = closeTileContextMenu;

// Archivieren/Löschen eines bestimmten Fahrzeugs (aus dem Kontextmenü heraus),
// unabhängig davon, welches Fahrzeug gerade "aktiv" ist
function archiveVehicleById(id) {
  appData.activeVehicleId = id;
  archiveCurrentVehicle();
  renderGarageVehicleTiles();
}
window.archiveVehicleById = archiveVehicleById;

function deleteVehicleById(id) {
  appData.activeVehicleId = id;
  deleteCurrentVehicle();
  renderGarageVehicleTiles();
}
window.deleteVehicleById = deleteVehicleById;

function renderGarageVehicleTiles() {
  const grid = document.getElementById('garageVehicleGrid');
  if (!grid) return;

  grid.innerHTML = '';

  // Beim Reiter "Alle" auf dem Smartphone: kompaktere 2-Spalten-Ansicht
  const isAllFilter = vehicleCategoryFilter === 'all';
  grid.classList.toggle('kachel-grid-compact', isAllFilter);

  const list = sortWithDinghiesGrouped(
    (appData.vehicles || [])
      .filter(v => !v.archived)
      .filter(v => vehicleCategoryFilter === 'all' || (v.category || 'auto') === vehicleCategoryFilter)
  );
  const archivedCount = (appData.vehicles || []).filter(v => v.archived).length;

  const toggleLink = document.getElementById('archiveToggleLink');
  if (toggleLink) {
    toggleLink.style.display = archivedCount > 0 ? '' : 'none';
    toggleLink.innerText = showArchivedVehicles
      ? `Archivierte Fahrzeuge ausblenden (${archivedCount})`
      : `Archivierte Fahrzeuge anzeigen (${archivedCount})`;
  }
  renderArchivedVehicleGrid();

  if (list.length === 0) {
    const categoryLabels = { auto: 'Autos', anhaenger: 'Anhänger', boot: 'Boote' };
    const emptyTitle = vehicleCategoryFilter === 'all'
      ? 'Noch kein Fahrzeug vorhanden'
      : `Keine ${categoryLabels[vehicleCategoryFilter] || 'Fahrzeuge'} vorhanden`;
    grid.innerHTML = `
      <div class="selection-card" onclick="openVehicleModal()" style="grid-column: 1 / -1; text-align: center;">
        <div class="kachel-icon">➕</div>
        <h3>${emptyTitle}</h3>
        <p>Klicke hier, um ein neues Fahrzeug anzulegen.</p>
      </div>
    `;
    return;
  }

  list.forEach(v => {
    const card = document.createElement('div');
    card.className = 'selection-card vehicle-tile' + (isAllFilter ? ' vehicle-tile-compact' : '');

    const imageHtml = v.image
      ? `<img src="${v.image}" class="vehicle-tile-image" alt="${v.name || 'Fahrzeug'}">`
      : `<div class="vehicle-tile-icon">🏎️</div>`;

    const mileage = getVehicleCurrentMileage(v);
    const mileageUnit = v.type === 'hours' ? 'Std' : 'km';
    const hsn = v.hsn || '-';
    const tsn = v.tsn || '-';

    // TÜV-Plakette (rechts auf der Kachel) statt Textzeile
    const tuevPlakette = getTuevPlaketteData(v, isAllFilter);
    let tuevBadgeHtml = '';
    if (tuevPlakette) {
      if (tuevPlakette.empty) {
        tuevBadgeHtml = `<div class="tuev-plakette tuev-plakette-empty"></div>`;
      } else {
        tuevBadgeHtml = `
          <div class="tuev-plakette ${tuevPlakette.colorClass}">
            <div class="tuev-plakette-ring">${tuevPlakette.monthRingHtml}</div>
            <div class="tuev-plakette-center">
              <span class="tuev-plakette-year">${tuevPlakette.year}</span>
            </div>
            ${tuevPlakette.overdue ? '<span class="tuev-plakette-overdue-badge">!</span>' : ''}
          </div>
        `;
      }
    }

    // Nächste anstehende Routine-Wartung (dringendste zuerst)
    const nextMaintenance = getUpcomingMaintenanceReminders(v)[0] || null;
    const maintenanceHtml = nextMaintenance
      ? `<span class="${nextMaintenance.overdue ? 'reminder-overdue-text' : ''}"><strong>${nextMaintenance.title}:</strong> ${formatReminderMeta(nextMaintenance, v.type === 'hours' ? 'Std' : 'km')}</span>`
      : `<span><strong>Nächste Wartung:</strong> keine eingetragen</span>`;

    const hsnTsnHtml = v.category !== 'boot'
      ? `<span><strong>HSN/TSN:</strong> ${hsn} / ${tsn}</span>`
      : '';

    const mileageLabel = v.type === 'hours' ? 'Betriebsstunden' : 'KM-Stand';
    const mileageHtml = v.category !== 'anhaenger'
      ? `<span><strong>${mileageLabel}:</strong> ${mileage.toLocaleString('de-DE')} ${mileageUnit}</span>`
      : '';

    // Dingi/Beiboot: Hinweis, zu welchem Hauptboot es gehört
    let belongsToHtml = '';
    if (v.category === 'boot' && v.belongsToId) {
      const parentBoat = appData.vehicles.find(x => x.id === v.belongsToId);
      if (parentBoat) {
        belongsToHtml = `<span><strong>Gehört zu:</strong> ${parentBoat.name || 'Unbenanntes Boot'}</span>`;
      }
    }

    card.innerHTML = `
      <div class="vehicle-tile-category-badge">${getCategoryIconSvg(v.category)}</div>
      ${tuevBadgeHtml}
      ${imageHtml}
      <h3>${v.name || 'Unbenanntes Fahrzeug'}</h3>
      <p>${v.plate || 'Kein Kennzeichen'} ${(v.fuelType && vehicleHasEngine(v)) ? '• ' + v.fuelType : ''}</p>
      <div class="vehicle-tile-info">
        ${mileageHtml}
        ${hsnTsnHtml}
        ${belongsToHtml}
        ${maintenanceHtml}
      </div>
    `;

    card.onclick = () => {
      if (tileLongPressTriggered) {
        tileLongPressTriggered = false;
        return;
      }
      chooseGarageVehicle(v.id);
    };
    attachTileLongPress(card, v.id);
    grid.appendChild(card);
  });
}

/* --- ARCHIV (verkaufte Fahrzeuge) --- */
let showArchivedVehicles = false;

function toggleArchivedVehicles() {
  showArchivedVehicles = !showArchivedVehicles;
  const archiveGrid = document.getElementById('archivedVehicleGrid');
  if (archiveGrid) archiveGrid.classList.toggle('hidden', !showArchivedVehicles);
  renderGarageVehicleTiles();
}
window.toggleArchivedVehicles = toggleArchivedVehicles;

function renderArchivedVehicleGrid() {
  const grid = document.getElementById('archivedVehicleGrid');
  if (!grid) return;
  grid.innerHTML = '';

  const archived = (appData.vehicles || []).filter(v => v.archived);

  archived.forEach(v => {
    const card = document.createElement('div');
    card.className = 'selection-card vehicle-tile vehicle-tile-archived';

    const imageHtml = v.image
      ? `<img src="${v.image}" class="vehicle-tile-image" alt="${v.name || 'Fahrzeug'}">`
      : `<div class="vehicle-tile-icon">🏎️</div>`;

    card.innerHTML = `
      <div class="vehicle-tile-archived-badge">Archiviert</div>
      ${imageHtml}
      <h3>${v.name || 'Unbenanntes Fahrzeug'}</h3>
      <p>${v.plate || 'Kein Kennzeichen'} ${(v.fuelType && vehicleHasEngine(v)) ? '• ' + v.fuelType : ''}</p>
      <div class="vehicle-tile-archived-actions">
        <button type="button" class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); restoreVehicleFromArchive('${v.id}')">Wiederherstellen</button>
        <button type="button" class="btn btn-danger btn-sm" onclick="event.stopPropagation(); permanentlyDeleteArchivedVehicle('${v.id}')">Endgültig löschen</button>
      </div>
    `;

    // Klick auf die Kachel selbst öffnet das Fahrzeug weiterhin ganz normal
    // (z.B. um die Historie anzusehen oder das Verkaufsdossier erneut zu drucken)
    card.onclick = () => chooseGarageVehicle(v.id);
    grid.appendChild(card);
  });
}

// Aktuelles Fahrzeug als verkauft archivieren: Daten bleiben erhalten,
// verschwindet aber aus der normalen Kachel-Auswahl
function archiveCurrentVehicle() {
  const v = getActiveVehicle();
  if (!v) return;

  if (confirm("Möchtest du vor dem Archivieren noch das Verkaufsdossier ausdrucken?")) {
    printSaleReport();
  }

  if (!confirm(`"${v.name}" wirklich als verkauft archivieren? Es verschwindet aus "Meine Garage", bleibt aber inkl. aller Daten erhalten und kann jederzeit wiederhergestellt werden.`)) {
    return;
  }

  v.archived = true;

  const remainingActive = appData.vehicles.filter(x => !x.archived);
  if (remainingActive.length > 0) {
    appData.activeVehicleId = remainingActive[0].id;
    saveData();
    renderVehicleSelect();
    loadActiveVehicle();
  } else {
    appData.activeVehicleId = null;
    saveData();
    backToSelection();
  }
}
window.archiveCurrentVehicle = archiveCurrentVehicle;

function restoreVehicleFromArchive(id) {
  const v = appData.vehicles.find(x => x.id === id);
  if (!v) return;
  if (!confirm(`"${v.name}" wieder aktivieren und zu "Meine Garage" hinzufügen?`)) return;

  v.archived = false;
  saveData();
  renderGarageVehicleTiles();
}
window.restoreVehicleFromArchive = restoreVehicleFromArchive;

function permanentlyDeleteArchivedVehicle(id) {
  const v = appData.vehicles.find(x => x.id === id);
  if (!v) return;
  if (!confirm(`"${v.name}" inklusive ALLER Daten endgültig löschen? Das kann nicht rückgängig gemacht werden.`)) return;

  appData.vehicles = appData.vehicles.filter(x => x.id !== id);
  saveData();
  renderGarageVehicleTiles();
}
window.permanentlyDeleteArchivedVehicle = permanentlyDeleteArchivedVehicle;

// Zurück zur Haupt-Bereichsauswahl ("Meine Garage" vs. "Kundenfahrzeuge")
function showAreaSelection() {
  document.getElementById('area-selection-grid').style.display = 'grid';
  document.getElementById('garage-vehicle-selection').style.display = 'none';
  
  const title = document.getElementById('selection-title');
  if (title) title.innerText = 'Bitte wähle deinen Bereich';
}

function backToSelection() {
  document.getElementById('app-wrapper').classList.add('hidden');
  document.getElementById('selection-screen').classList.remove('hidden');

  if (currentMode === 'eigene') {
    // Aus dem Tab-Modus der eigenen Fahrzeuge geht's zurück zu den Fahrzeug-Kacheln,
    // nicht bis ganz zum Start-Bildschirm
    const areaGrid = document.getElementById('area-selection-grid');
    const garageSelection = document.getElementById('garage-vehicle-selection');
    const title = document.getElementById('selection-title');

    if (areaGrid) areaGrid.style.display = 'none';
    if (garageSelection) garageSelection.style.display = 'block';
    if (title) title.innerText = 'Wähle dein Fahrzeug';

    renderGarageVehicleTiles();
  } else {
    // Kundenfahrzeuge: Verhalten bleibt wie gehabt
    showAreaSelection();
  }
}

function showTab(tabId, element) {
  // 1. Aktive Tabs und Nav-Buttons zurücksetzen
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  
  // 2. Ziel-Tab aktivieren
  const targetTab = document.getElementById(`tab-${tabId}`) || document.getElementById(tabId);
  if (targetTab) {
    targetTab.classList.add('active');
  } else {
    console.warn(`Tab-Inhalt mit ID "tab-${tabId}" oder "${tabId}" fehlt im HTML!`);
  }

  // 3. Wenn über Button geklickt, Button als 'active' markieren
  if (element) {
    element.classList.add('active');
  } else {
    // Falls via selectArea aufgerufen: Ersten sichtbaren Button aktivieren
    const activeSelector = currentMode === 'kunden' ? '.nav-kunden-only' : '.nav-eigene-only';
    document.querySelector(`.sidebar ${activeSelector}`)?.classList.add('active');
  }

  // 4. Nav-Sichtbarkeiten umschalten
  const isCustomerMode = (currentMode === 'kunden');

  document.querySelectorAll('.nav-eigene-only').forEach(item => {
    item.style.setProperty('display', isCustomerMode ? 'none' : 'flex', 'important');
  });

  document.querySelectorAll('.nav-kunden-only').forEach(item => {
    item.style.setProperty('display', isCustomerMode ? 'flex' : 'none', 'important');
  });

  // Die obige Zeile blendet pauschal ALLE "nav-eigene-only"-Punkte wieder ein
  // (auch den Tanken-Button) - hier direkt danach nochmal korrekt auf die
  // Fahrzeugart des aktiven Fahrzeugs anwenden, sonst würde z.B. bei einem
  // Anhänger der Tanken-Tab nach jedem Tab-Wechsel wieder auftauchen.
  if (!isCustomerMode) {
    const active = (typeof getActiveVehicle === 'function') ? getActiveVehicle() : null;
    if (active && typeof updateNavForCategory === 'function') {
      updateNavForCategory(active);
    }
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });

  // 5. Tab-Inhalte rendern
  try {
    if (tabId === 'dashboard' && typeof renderDashboard === 'function') renderDashboard();
    else if (tabId === 'service' && typeof renderCustomerServiceTable === 'function') renderCustomerServiceTable();
    else if (tabId === 'history' && typeof renderHistoryTable === 'function') renderHistoryTable();
    else if (tabId === 'customers' && typeof renderCustomerSection === 'function') renderCustomerSection();
    else if (tabId === 'settings' && typeof loadVehicleSettingsIntoForm === 'function') loadVehicleSettingsIntoForm();
  } catch (err) {
    console.error(`Fehler beim Laden von Tab ${tabId}:`, err);
  }
}

// Fahrzeug-Kachel wurde angeklickt -> aktives Fahrzeug setzen & in den Tab-Modus wechseln
function chooseGarageVehicle(vehicleId, startTab) {
  currentMode = 'eigene';
  appData.activeVehicleId = vehicleId;
  saveData();

  // Auswahlbildschirm verstecken & App anzeigen
  document.getElementById('selection-screen').classList.add('hidden');
  document.getElementById('app-wrapper').classList.remove('hidden');

  // Modus "Eigene Fahrzeuge" aktivieren
  document.body.classList.add('mode-eigene');
  document.body.classList.remove('mode-kunden');

  // Daten des gewählten Fahrzeugs laden (Tanken, Wartung, Historie, Dashboard...)
  renderVehicleSelect();
  loadActiveVehicle();

  const targetTab = startTab || 'dashboard';
  const targetNavBtn = document.querySelector(`.nav-item[onclick*="'${targetTab}'"]`);
  showTab(targetTab, targetNavBtn);
}


/* --- EIGENE FAHRZEUGE --- */
function renderVehicleSelect() {
  const select = document.getElementById('vehicleSelect');
  if (!select) return; // Falls das Element nicht mehr im Header existiert, abbrechen
  select.innerHTML = '';
  appData.vehicles.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = v.name;
    if (v.id === appData.activeVehicleId) opt.selected = true;
    select.appendChild(opt);
  });
}

function switchVehicle() {
  const select = document.getElementById('vehicleSelect');
  if (!select) return;
  appData.activeVehicleId = select.value;
  saveData();
  loadActiveVehicle();
}

function updateUnitLabels() {
  const typeEl = document.getElementById('vType');
  if (!typeEl) return;
  const isKm = typeEl.value === 'km';
  
  const fuelKmLabel = document.getElementById('fuelKmLabel');
  const serviceKmLabel = document.getElementById('serviceKmLabel');
  const kpiMileageUnit = document.getElementById('kpi-mileage-unit');
  const nextServiceKmLabel = document.getElementById('nextServiceKmLabel');
  const nextServiceKmInput = document.getElementById('nextServiceKm');

  if (fuelKmLabel) fuelKmLabel.innerText = isKm ? "KM-Stand" : "Betriebsstunden";
  if (serviceKmLabel) serviceKmLabel.innerText = isKm ? "KM-Stand" : "Betriebsstunden";
  if (kpiMileageUnit) kpiMileageUnit.innerText = isKm ? "Kilometerstand" : "Betriebsstunden";
  if (nextServiceKmLabel) nextServiceKmLabel.innerText = isKm ? "Bei KM-Stand" : "Bei Betriebsstunden";
  if (nextServiceKmInput) nextServiceKmInput.placeholder = isKm ? "z.B. 160.000" : "z.B. 250";
}

// Blendet den "Tanken"-Bereich (Nav-Punkt + Kraftstoffart-Feld) aus, wenn die
// aktuelle Fahrzeugart keinen eigenen Antrieb hat (z.B. Anhänger)
function updateNavForCategory(vehicleOrCategory) {
  // Kompatibel mit Aufrufen, die noch die reine Kategorie (String) übergeben
  const vehicle = (typeof vehicleOrCategory === 'object' && vehicleOrCategory) ? vehicleOrCategory : { category: vehicleOrCategory };
  const needsFuel = vehicleHasEngine(vehicle);

  const navFuelBtn = document.getElementById('navFuelBtn');
  if (navFuelBtn) navFuelBtn.style.display = needsFuel ? 'flex' : 'none';

  const fuelTypeFieldGroup = document.getElementById('fuelTypeFieldGroup');
  if (fuelTypeFieldGroup) fuelTypeFieldGroup.style.display = needsFuel ? '' : 'none';

  // Falls man gerade im Tanken-Tab ist und auf ein Fahrzeug ohne Antrieb wechselt,
  // zurück zum Dashboard springen, statt auf einem ausgeblendeten Tab hängen zu bleiben
  if (!needsFuel) {
    const fuelTab = document.getElementById('tab-fuel');
    if (fuelTab && fuelTab.classList.contains('active')) {
      showTab('dashboard');
    }
  }
}

// Blendet in den Stammdaten Felder ein/aus bzw. beschriftet sie um, je nachdem
// welche Fahrzeugart gewählt ist (Auto/Anhänger/Boot ergeben unterschiedliche
// Angaben sinnvoll)
function updateStammdatenFieldsForCategory(category) {
  const powerHpGroup = document.getElementById('powerHpFieldGroup');
  const towingBrakedGroup = document.getElementById('towingBrakedFieldGroup');
  const towingBrakedLabel = document.getElementById('towingBrakedLabel');
  const hsnTsnRow = document.getElementById('hsnTsnFieldRow');
  const nextTuevRow = document.getElementById('nextTuevFieldRow');
  const vinGroup = document.getElementById('vinFieldGroup');
  const boatIdRow = document.getElementById('boatIdFieldRow');
  const typeGroup = document.getElementById('vTypeFieldGroup');

  if (category === 'anhaenger') {
    if (powerHpGroup) powerHpGroup.style.display = 'none';
    if (towingBrakedGroup) towingBrakedGroup.style.display = '';
    if (towingBrakedLabel) towingBrakedLabel.innerText = 'Zulässiges Gesamtgewicht (kg)';
    if (hsnTsnRow) hsnTsnRow.style.display = '';
    if (nextTuevRow) nextTuevRow.style.display = '';
    if (vinGroup) vinGroup.style.display = '';
    if (boatIdRow) boatIdRow.style.display = 'none';
    if (typeGroup) typeGroup.style.display = 'none';
  } else if (category === 'boot') {
    if (powerHpGroup) powerHpGroup.style.display = 'none';
    if (towingBrakedGroup) towingBrakedGroup.style.display = 'none';
    if (hsnTsnRow) hsnTsnRow.style.display = 'none';
    if (nextTuevRow) nextTuevRow.style.display = 'none';
    if (vinGroup) vinGroup.style.display = 'none';
    if (boatIdRow) boatIdRow.style.display = '';
    if (typeGroup) typeGroup.style.display = '';
    populateBoatParentOptions();
    updateBoatTypeFields();
  } else {
    // Auto (Standard)
    if (powerHpGroup) powerHpGroup.style.display = '';
    if (towingBrakedGroup) towingBrakedGroup.style.display = '';
    if (towingBrakedLabel) towingBrakedLabel.innerText = 'Anhängelast gebremst (kg)';
    if (hsnTsnRow) hsnTsnRow.style.display = '';
    if (nextTuevRow) nextTuevRow.style.display = '';
    if (vinGroup) vinGroup.style.display = '';
    if (boatIdRow) boatIdRow.style.display = 'none';
    if (typeGroup) typeGroup.style.display = '';
  }
}
window.updateStammdatenFieldsForCategory = updateStammdatenFieldsForCategory;

/* --- BOOTE: Bootstyp, Motorenverwaltung & Zubehör-Boote ("Gehört zu") --- */

// Zwischenspeicher für die Motorenliste, während die Stammdaten bearbeitet werden
let tempBoatEngines = [];

// Blendet Motoren-Abschnitt & "Gehört zu"-Auswahl je nach gewähltem Bootstyp ein/aus
function updateBoatTypeFields() {
  const boatTypeEl = document.getElementById('vBoatType');
  const enginesSection = document.getElementById('boatEnginesSection');
  const parentGroup = document.getElementById('boatParentFieldGroup');
  if (!boatTypeEl) return;

  const boatType = boatTypeEl.value;
  if (enginesSection) enginesSection.style.display = boatType === 'segel_ohne_motor' ? 'none' : '';
  if (parentGroup) parentGroup.style.display = boatType === 'dingi' ? '' : 'none';
}
window.updateBoatTypeFields = updateBoatTypeFields;

// Füllt die "Gehört zu"-Auswahl mit allen anderen Booten (nicht sich selbst)
function populateBoatParentOptions() {
  const select = document.getElementById('vBelongsTo');
  if (!select) return;

  const currentVehicle = getActiveVehicle();
  const currentId = currentVehicle ? currentVehicle.id : null;
  const otherBoats = (appData.vehicles || []).filter(x => x.category === 'boot' && x.id !== currentId);

  select.innerHTML = '<option value="">- Kein -</option>' +
    otherBoats.map(b => `<option value="${b.id}">${b.name || 'Unbenanntes Boot'}</option>`).join('');

  if (currentVehicle) select.value = currentVehicle.belongsToId || '';
}

function renderBoatEnginesList() {
  const list = document.getElementById('boatEnginesList');
  if (!list) return;

  list.innerHTML = '';
  tempBoatEngines.forEach(engine => {
    const row = document.createElement('div');
    row.className = 'boat-engine-row';
    row.innerHTML = `
      <input type="text" placeholder="Bezeichnung, z.B. Motor 1 / Backbord" value="${engine.name || ''}" oninput="updateBoatEngineField('${engine.id}', 'name', this.value)">
      <input type="text" placeholder="Motornummer (optional)" value="${engine.number || ''}" oninput="updateBoatEngineField('${engine.id}', 'number', this.value)">
      <button type="button" class="btn btn-danger btn-sm" onclick="removeBoatEngineRow('${engine.id}')">✕</button>
    `;
    list.appendChild(row);
  });
}

function updateBoatEngineField(id, field, value) {
  const engine = tempBoatEngines.find(e => e.id === id);
  if (engine) engine[field] = value;
}
window.updateBoatEngineField = updateBoatEngineField;

function addBoatEngineRow() {
  tempBoatEngines.push({ id: 'eng_' + Date.now() + '_' + Math.floor(Math.random() * 1000), name: '', number: '' });
  renderBoatEnginesList();
}
window.addBoatEngineRow = addBoatEngineRow;

function removeBoatEngineRow(id) {
  tempBoatEngines = tempBoatEngines.filter(e => e.id !== id);
  renderBoatEnginesList();
}
window.removeBoatEngineRow = removeBoatEngineRow;

function loadActiveVehicle() {
  const vehicle = getActiveVehicle();
  if (!vehicle) return;

  const fields = {
    'vName': vehicle.name || '',
    'vPlate': vehicle.plate || '',
    'vCategory': vehicle.category || 'auto',
    'vType': vehicle.type || 'km',
    'vFuelType': vehicle.fuelType || '',
    'vVin': vehicle.vin || '',
    'vBoatType': vehicle.boatType || 'motorboot',
    'vHullNumber': vehicle.hullNumber || '',
    'vFirstReg': vehicle.firstReg || '',
    'vHsn': vehicle.hsn || '',
    'vTsn': vehicle.tsn || '',
    'vPowerHp': vehicle.powerHp || '',
    'vTowingBraked': vehicle.towingBraked || '',
    'vNextTuev': vehicle.nextTuev || '',
    'vSpecs': vehicle.specs || ''
  };

  for (let id in fields) {
    const el = document.getElementById(id);
    if (el) el.value = fields[id];
  }

  updateUnitLabels();
  updateNavForCategory(vehicle);
  updateStammdatenFieldsForCategory(vehicle.category || 'auto');

  // Motorenliste für Boote in den Zwischenspeicher laden & anzeigen
  tempBoatEngines = (vehicle.engines || []).map(e => ({ ...e }));
  renderBoatEnginesList();

  const settingsImgPreview = document.getElementById('vehicleImageSettingsPreview');
  if (settingsImgPreview) {
    settingsImgPreview.innerHTML = vehicle.image ? `<img src="${vehicle.image}">` : '';
  }

  renderFuelTable();
  renderServiceTable();
  renderDashboard();
}

function openVehicleModal() { 
  const el = document.getElementById('vehicleModal');
  if (el) el.classList.add('active'); 

  // Fahrzeugart im Formular passend zum aktuell gewählten Filter vorauswählen
  const categoryEl = document.getElementById('newVCategory');
  if (categoryEl) {
    categoryEl.value = (vehicleCategoryFilter === 'all') ? 'auto' : vehicleCategoryFilter;
  }
  updateNewVehicleFieldsForCategory();
}

// Blendet im "Neues Fahrzeug"-Formular Felder aus, die für die gewählte Fahrzeugart keinen Sinn ergeben
function updateNewVehicleFieldsForCategory() {
  const categoryEl = document.getElementById('newVCategory');
  const fuelGroup = document.getElementById('newVFuelTypeGroup');
  const mileageGroup = document.getElementById('newVMileageGroup');
  const typeGroup = document.getElementById('newVTypeGroup');
  const typeEl = document.getElementById('newVType');
  if (!categoryEl) return;

  const isTrailer = categoryEl.value === 'anhaenger';
  const isAuto = categoryEl.value === 'auto';
  if (fuelGroup) fuelGroup.style.display = isTrailer ? 'none' : '';
  if (mileageGroup) mileageGroup.style.display = isTrailer ? 'none' : '';
  if (typeGroup) typeGroup.style.display = isTrailer ? 'none' : '';

  // Zusätzliche Stammdaten-Felder beim Anlegen gibt's nur bei Autos
  const autoExtraFields = document.getElementById('newVAutoExtraFields');
  if (autoExtraFields) autoExtraFields.style.display = isAuto ? '' : 'none';

  // Bei Autos macht KM als Erfassungstyp praktisch immer Sinn - direkt vorauswählen
  if (categoryEl.value === 'auto' && typeEl) {
    typeEl.value = 'km';
  }
  // Boote laufen praktisch immer über Betriebsstunden statt Kilometer
  if (categoryEl.value === 'boot' && typeEl) {
    typeEl.value = 'hours';
  }
}
window.updateNewVehicleFieldsForCategory = updateNewVehicleFieldsForCategory;

function closeVehicleModal() { 
  const el = document.getElementById('vehicleModal');
  if (el) el.classList.remove('active'); 
}

function createNewVehicle(e) {
  e.preventDefault();
  const nameEl = document.getElementById('newVName');
  const categoryEl = document.getElementById('newVCategory');
  const typeEl = document.getElementById('newVType');
  const fuelTypeEl = document.getElementById('newVFuelType');
  const mileageEl = document.getElementById('newVMileage');

  const startMileage = mileageEl ? parseFormattedNumber(mileageEl.value) : 0;
  const category = categoryEl ? categoryEl.value : 'auto';

  const newV = {
    id: "v_" + Date.now(),
    name: nameEl ? nameEl.value : 'Neues Fahrzeug',
    category: category,
    type: typeEl ? typeEl.value : 'km',
    fuelType: fuelTypeEl ? fuelTypeEl.value : 'Super',
    image: "",
    archived: false,
    boatType: "motorboot",
    engines: [],
    belongsToId: null,
    fuelEntries: [],
    serviceEntries: []
  };

  // Zusätzliche Angaben beim Anlegen (nur Autos) - fließen sowohl in die
  // Stammdaten als auch direkt in den Fahrzeugschein mit ein
  if (category === 'auto') {
    const erstzulassungEl = document.getElementById('newVErstzulassung');
    const powerHpEl = document.getElementById('newVPowerHp');
    const hsnEl = document.getElementById('newVHsn');
    const tsnEl = document.getElementById('newVTsn');
    const vinEl = document.getElementById('newVVin');

    const erstzulassung = erstzulassungEl ? erstzulassungEl.value : '';
    const powerHp = powerHpEl ? powerHpEl.value : '';
    const hsn = hsnEl ? hsnEl.value : '';
    const tsn = tsnEl ? tsnEl.value : '';
    const vin = vinEl ? vinEl.value : '';

    if (erstzulassung) newV.firstReg = erstzulassung;
    if (powerHp) newV.powerHp = parseInt(powerHp, 10) || null;
    if (hsn) newV.hsn = hsn;
    if (tsn) newV.tsn = tsn;
    if (vin) newV.vin = vin;

    if (erstzulassung || powerHp || hsn || tsn || vin) {
      newV.fahrzeugschein = {};
      if (erstzulassung) newV.fahrzeugschein.erstzulassung = erstzulassung;
      if (hsn) newV.fahrzeugschein.hsn = hsn;
      if (tsn) newV.fahrzeugschein.tsn = tsn;
      if (vin) newV.fahrzeugschein.vin = vin;
      if (powerHp) newV.fahrzeugschein.leistungKw = Math.round(parseInt(powerHp, 10) / 1.35962).toString();
    }
  }

  if (startMileage > 0) {
    newV.serviceEntries.push({
      id: "s_" + Date.now(),
      category: "Sonstiges",
      title: "Start-Kilometerstand erfasst",
      date: new Date().toISOString().split('T')[0],
      mileage: startMileage,
      cost: 0.00,
      performer: "Eigenleistung",
      notes: "Initialer Kilometerstand beim Anlegen des Fahrzeugs.",
      images: []
    });
  }

  appData.vehicles.push(newV);
  appData.activeVehicleId = newV.id;
  saveData();
  closeVehicleModal();
  renderVehicleSelect();
  loadActiveVehicle();
  renderGarageVehicleTiles();
}

function deleteCurrentVehicle() {
  if (appData.vehicles.length <= 1) {
    alert("Das letzte eigene Fahrzeug kann nicht gelöscht werden.");
    return;
  }
  if (!confirm("Dieses Fahrzeug inklusive aller Daten wirklich löschen?")) return;

  appData.vehicles = appData.vehicles.filter(v => v.id !== appData.activeVehicleId);
  appData.activeVehicleId = appData.vehicles[0].id;
  saveData();
  renderVehicleSelect();
  loadActiveVehicle();
}

function handleVehicleImageUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  cropTarget = 'vehicle';
  const reader = new FileReader();
  reader.onload = function(e) {
    openImageCropModal(e.target.result);
  };
  reader.readAsDataURL(file);
}

/* --- BILDZUSCHNITT (wiederverwendet für Fahrzeugfoto & Fahrzeugschein-Foto) ---
   Das ganze Bild wird angezeigt, darüber liegt ein frei verschieb- und
   skalierbares Auswahlrechteck. Genau der Bereich innerhalb des Rechtecks
   wird beim Übernehmen ausgeschnitten. */
let cropTarget = 'vehicle';
let cropState = {
  naturalWidth: 0,
  naturalHeight: 0,
  displayWidth: 0,
  displayHeight: 0,
  sel: { x: 0, y: 0, w: 0, h: 0 },
  mode: null, // 'move' | 'nw' | 'ne' | 'sw' | 'se'
  startPointerX: 0,
  startPointerY: 0,
  startSel: { x: 0, y: 0, w: 0, h: 0 }
};
let cropHandlersAttached = false;
const CROP_MIN_SIZE = 32;
let cropOriginalDataUrl = null;
let cropRotation = 0; // 0, 90, 180, 270 (im Uhrzeigersinn)

function renderCropSelection() {
  const sel = document.getElementById('cropSelection');
  if (!sel) return;
  sel.style.left = cropState.sel.x + 'px';
  sel.style.top = cropState.sel.y + 'px';
  sel.style.width = cropState.sel.w + 'px';
  sel.style.height = cropState.sel.h + 'px';
}

function openImageCropModal(dataUrl) {
  const modal = document.getElementById('imageCropModal');

  cropOriginalDataUrl = dataUrl;
  cropRotation = 0;

  // Modal zuerst sichtbar machen, damit das Bild beim Laden schon seine
  // echte gerenderte Größe hat
  modal.classList.add('active');
  attachCropSelectionHandlers();

  loadCropImageSrc();
}

// Lädt das Ausgangsbild (ggf. gedreht) in den Zuschneide-Bereich und setzt
// die Auswahl danach wieder auf das komplette (gedrehte) Bild zurück
function loadCropImageSrc() {
  const img = document.getElementById('cropImage');

  img.onload = () => {
    cropState.naturalWidth = img.naturalWidth;
    cropState.naturalHeight = img.naturalHeight;
    // Nach dem Setzen von img.src braucht der Browser einen Layout-Tick,
    // bis clientWidth/-Height die tatsächlich gerenderte Größe zeigen
    requestAnimationFrame(() => {
      cropState.displayWidth = img.clientWidth;
      cropState.displayHeight = img.clientHeight;

      // Auswahl startet über das komplette Bild, damit standardmäßig
      // nichts abgeschnitten wird - der Nutzer zieht die Ecken bei Bedarf ein
      cropState.sel = { x: 0, y: 0, w: cropState.displayWidth, h: cropState.displayHeight };
      renderCropSelection();
    });
  };

  if (cropRotation === 0) {
    img.src = cropOriginalDataUrl;
    return;
  }

  // Für 90°/180°/270° wird das Originalbild einmalig über einen Canvas
  // gedreht - so bleibt die Drehung verlustfrei nachvollziehbar und die
  // Zuschnitt-Logik (natürliche/gerenderte Maße) funktioniert unverändert
  const rotSource = new Image();
  rotSource.onload = () => {
    const swap = cropRotation === 90 || cropRotation === 270;
    const canvas = document.createElement('canvas');
    canvas.width = swap ? rotSource.naturalHeight : rotSource.naturalWidth;
    canvas.height = swap ? rotSource.naturalWidth : rotSource.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(cropRotation * Math.PI / 180);
    ctx.drawImage(rotSource, -rotSource.naturalWidth / 2, -rotSource.naturalHeight / 2);
    img.src = canvas.toDataURL('image/jpeg', 0.92);
  };
  rotSource.src = cropOriginalDataUrl;
}

function rotateCropImage(deltaDeg) {
  cropRotation = (cropRotation + deltaDeg + 360) % 360;
  loadCropImageSrc();
}
window.rotateCropImage = rotateCropImage;

function attachCropSelectionHandlers() {
  if (cropHandlersAttached) return;
  cropHandlersAttached = true;

  const stage = document.getElementById('cropStage');
  const sel = document.getElementById('cropSelection');

  function clampSel() {
    const maxW = cropState.displayWidth;
    const maxH = cropState.displayHeight;
    cropState.sel.w = Math.max(CROP_MIN_SIZE, Math.min(cropState.sel.w, maxW));
    cropState.sel.h = Math.max(CROP_MIN_SIZE, Math.min(cropState.sel.h, maxH));
    cropState.sel.x = Math.min(Math.max(0, cropState.sel.x), maxW - cropState.sel.w);
    cropState.sel.y = Math.min(Math.max(0, cropState.sel.y), maxH - cropState.sel.h);
  }

  function startDrag(mode, e) {
    cropState.mode = mode;
    cropState.startPointerX = e.clientX;
    cropState.startPointerY = e.clientY;
    cropState.startSel = { ...cropState.sel };
    e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  }

  sel.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.crop-handle')) return; // Ecken haben eigenen Handler
    startDrag('move', e);
  });

  sel.querySelectorAll('.crop-handle').forEach(handle => {
    handle.addEventListener('pointerdown', (e) => {
      startDrag(handle.dataset.handle, e);
    });
  });

  window.addEventListener('pointermove', (e) => {
    if (!cropState.mode) return;
    const dx = e.clientX - cropState.startPointerX;
    const dy = e.clientY - cropState.startPointerY;
    const s = cropState.startSel;

    if (cropState.mode === 'move') {
      cropState.sel.x = s.x + dx;
      cropState.sel.y = s.y + dy;
    } else {
      let { x, y, w, h } = s;
      if (cropState.mode.includes('n')) { y = s.y + dy; h = s.h - dy; }
      if (cropState.mode.includes('s')) { h = s.h + dy; }
      if (cropState.mode.includes('w')) { x = s.x + dx; w = s.w - dx; }
      if (cropState.mode.includes('e')) { w = s.w + dx; }
      // Verhindert Umklappen des Rechtecks, wenn über den gegenüberliegenden Rand gezogen wird
      if (w < CROP_MIN_SIZE) { if (cropState.mode.includes('w')) x = s.x + s.w - CROP_MIN_SIZE; w = CROP_MIN_SIZE; }
      if (h < CROP_MIN_SIZE) { if (cropState.mode.includes('n')) y = s.y + s.h - CROP_MIN_SIZE; h = CROP_MIN_SIZE; }
      cropState.sel = { x, y, w, h };
    }
    clampSel();
    renderCropSelection();
  });

  const endDrag = () => { cropState.mode = null; };
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
}

function closeImageCropModal() {
  document.getElementById('imageCropModal').classList.remove('active');
  const input = document.getElementById('vehicleImageInput');
  if (input) input.value = '';
  const fzsInput = document.getElementById('fzscheinPhotoInput');
  if (fzsInput) fzsInput.value = '';
}
window.closeImageCropModal = closeImageCropModal;

function applyImageCrop() {
  const img = document.getElementById('cropImage');

  const ratioX = cropState.naturalWidth / cropState.displayWidth;
  const ratioY = cropState.naturalHeight / cropState.displayHeight;

  const sx = cropState.sel.x * ratioX;
  const sy = cropState.sel.y * ratioY;
  const sw = cropState.sel.w * ratioX;
  const sh = cropState.sel.h * ratioY;

  // Ausgabebreite an der Auswahl orientieren (max. 1000px), Seitenverhältnis
  // der Auswahl bleibt exakt erhalten - es wird nur beschnitten, nie verzerrt
  const outputWidth = Math.max(1, Math.min(1000, Math.round(sw)));
  const outputHeight = Math.max(1, Math.round(outputWidth * (sh / sw)));

  const canvas = document.createElement('canvas');
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const ctx = canvas.getContext('2d');

  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outputWidth, outputHeight);

  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

  if (cropTarget === 'fahrzeugschein') {
    tempFzscheinPhoto = dataUrl;
    renderFzscheinPhotoPreview();
    // Direkt sichern, damit das Foto auch dann erhalten bleibt, wenn das
    // Fahrzeugschein-Fenster zwischenzeitlich geschlossen wurde und das
    // Formular nicht mehr separat abgeschickt wird.
    const vFzs = getActiveVehicle();
    if (vFzs) {
      if (!vFzs.fahrzeugschein) vFzs.fahrzeugschein = {};
      vFzs.fahrzeugschein.photo = dataUrl;
      saveData();
    }
  } else {
    const v = getActiveVehicle();
    if (v) {
      v.image = dataUrl;
      saveData();
      loadActiveVehicle();
    }
  }

  closeImageCropModal();
}
window.applyImageCrop = applyImageCrop;

/* --- FOTO-ANSICHT MIT ZOOM (wiederverwendet für Fahrzeugfoto & Fahrzeugschein-Scan) ---
   Zeigt das Bild zunächst komplett (nichts abgeschnitten). Per Mausrad,
   Doppelklick/-tipp oder Zwei-Finger-Pinch kann hineingezoomt werden;
   im gezoomten Zustand lässt sich das Bild zum Ansehen von Details verschieben. */
let zoomViewState = {
  scale: 1, minScale: 1, maxScale: 5,
  x: 0, y: 0,
  dragging: false,
  startPX: 0, startPY: 0, startX: 0, startY: 0,
  pinchActive: false, pinchStartDist: 0, pinchStartScale: 1
};
let zoomViewHandlersAttached = false;

function openImageZoomView(src) {
  if (!src) return;
  const modal = document.getElementById('imageZoomViewModal');
  const img = document.getElementById('imageZoomImg');
  zoomViewState.scale = 1;
  zoomViewState.x = 0;
  zoomViewState.y = 0;
  img.src = src;
  img.style.transform = 'translate(0px, 0px) scale(1)';
  modal.classList.add('active');
  attachImageZoomHandlers();
}
window.openImageZoomView = openImageZoomView;

function closeImageZoomView() {
  document.getElementById('imageZoomViewModal').classList.remove('active');
}
window.closeImageZoomView = closeImageZoomView;

function applyZoomTransform() {
  const img = document.getElementById('imageZoomImg');
  img.style.transform = `translate(${zoomViewState.x}px, ${zoomViewState.y}px) scale(${zoomViewState.scale})`;
}

function clampZoomPan() {
  if (zoomViewState.scale <= zoomViewState.minScale) {
    zoomViewState.scale = zoomViewState.minScale;
    zoomViewState.x = 0;
    zoomViewState.y = 0;
  }
}

function getTouchDist(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function attachImageZoomHandlers() {
  if (zoomViewHandlersAttached) return;
  zoomViewHandlersAttached = true;

  const img = document.getElementById('imageZoomImg');
  const stage = document.getElementById('imageZoomStage');

  // Mausrad zum Zoomen (Desktop)
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = -e.deltaY * 0.0015;
    zoomViewState.scale = Math.min(zoomViewState.maxScale, Math.max(zoomViewState.minScale, zoomViewState.scale + delta));
    clampZoomPan();
    applyZoomTransform();
  }, { passive: false });

  // Doppelklick/Doppeltipp zum Rein-/Rauszoomen
  let lastTapTime = 0;
  img.addEventListener('pointerdown', (e) => {
    if (zoomViewState.pinchActive) return;
    const now = Date.now();
    if (now - lastTapTime < 300) {
      zoomViewState.scale = zoomViewState.scale > zoomViewState.minScale ? zoomViewState.minScale : 2.5;
      zoomViewState.x = 0;
      zoomViewState.y = 0;
      clampZoomPan();
      applyZoomTransform();
      lastTapTime = 0;
      return;
    }
    lastTapTime = now;

    if (zoomViewState.scale <= zoomViewState.minScale) return; // erst zoomen, dann verschieben
    zoomViewState.dragging = true;
    img.classList.add('dragging');
    zoomViewState.startPX = e.clientX;
    zoomViewState.startPY = e.clientY;
    zoomViewState.startX = zoomViewState.x;
    zoomViewState.startY = zoomViewState.y;
    img.setPointerCapture && img.setPointerCapture(e.pointerId);
  });

  img.addEventListener('pointermove', (e) => {
    if (!zoomViewState.dragging) return;
    zoomViewState.x = zoomViewState.startX + (e.clientX - zoomViewState.startPX);
    zoomViewState.y = zoomViewState.startY + (e.clientY - zoomViewState.startPY);
    applyZoomTransform();
  });

  const endDrag = () => { zoomViewState.dragging = false; img.classList.remove('dragging'); };
  img.addEventListener('pointerup', endDrag);
  img.addEventListener('pointercancel', endDrag);

  // Zwei-Finger-Pinch zum Zoomen (Touch)
  stage.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      zoomViewState.pinchActive = true;
      zoomViewState.dragging = false;
      zoomViewState.pinchStartDist = getTouchDist(e.touches);
      zoomViewState.pinchStartScale = zoomViewState.scale;
    }
  }, { passive: true });

  stage.addEventListener('touchmove', (e) => {
    if (zoomViewState.pinchActive && e.touches.length === 2) {
      e.preventDefault();
      const dist = getTouchDist(e.touches);
      const factor = dist / zoomViewState.pinchStartDist;
      zoomViewState.scale = Math.min(zoomViewState.maxScale, Math.max(zoomViewState.minScale, zoomViewState.pinchStartScale * factor));
      clampZoomPan();
      applyZoomTransform();
    }
  }, { passive: false });

  stage.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) zoomViewState.pinchActive = false;
  });
}

function removeVehicleImage() {
  const v = getActiveVehicle();
  if (v) {
    v.image = "";
    saveData();
    loadActiveVehicle();
  }
}

function saveVehicleDetails(e) {
  e.preventDefault();
  const v = getActiveVehicle();
  if (!v) return;

  v.name = document.getElementById('vName').value;
  v.plate = document.getElementById('vPlate').value;
  v.category = document.getElementById('vCategory').value;
  v.type = document.getElementById('vType').value;
  v.fuelType = document.getElementById('vFuelType').value;
  v.vin = document.getElementById('vVin').value;
  v.hullNumber = document.getElementById('vHullNumber').value;

  // Boot-spezifische Angaben (Bootstyp, Motorenliste, Zubehör-Boot-Verknüpfung)
  const boatTypeEl = document.getElementById('vBoatType');
  if (boatTypeEl) v.boatType = boatTypeEl.value;
  const belongsToEl = document.getElementById('vBelongsTo');
  if (belongsToEl) v.belongsToId = belongsToEl.value || null;
  v.engines = tempBoatEngines
    .map(e => ({ id: e.id, name: (e.name || '').trim(), number: (e.number || '').trim() }))
    .filter(e => e.name || e.number);
  v.firstReg = document.getElementById('vFirstReg').value;
  v.hsn = document.getElementById('vHsn').value;
  v.tsn = document.getElementById('vTsn').value;
  v.powerHp = parseInt(document.getElementById('vPowerHp').value) || null;
  v.towingBraked = parseInt(document.getElementById('vTowingBraked').value) || null;

  // Alle Stammdaten, die es auch im Fahrzeugschein gibt, automatisch dorthin
  // übernehmen, damit beide Stellen immer synchron bleiben (nur bei Autos,
  // da der Schein bei anderen Fahrzeugarten ohnehin nicht existiert)
  if (v.category === 'auto') {
    if (!v.fahrzeugschein) v.fahrzeugschein = {};
    if (v.firstReg) v.fahrzeugschein.erstzulassung = v.firstReg;
    if (v.hsn) v.fahrzeugschein.hsn = v.hsn;
    if (v.tsn) v.fahrzeugschein.tsn = v.tsn;
    if (v.vin) v.fahrzeugschein.vin = v.vin;
    if (v.fuelType) v.fahrzeugschein.kraftstoffart = v.fuelType;
    if (v.powerHp) v.fahrzeugschein.leistungKw = Math.round(v.powerHp / 1.35962).toString();
    if (v.towingBraked) v.fahrzeugschein.anhaengelastGebremst = v.towingBraked.toString();
  }
  v.nextTuev = document.getElementById('vNextTuev').value;
  v.specs = document.getElementById('vSpecs').value;

  saveData();
  renderVehicleSelect();
  loadActiveVehicle();
  alert("Stammdaten gespeichert!");
}

/* --- TANKEN --- */
function toggleCustomFuelInput() {
  const selectVal = document.getElementById('fuelCategorySelect').value;
  const customGroup = document.getElementById('customFuelGroup');
  if (customGroup) customGroup.style.display = selectVal === 'Sonstiges' ? 'block' : 'none';
}

function toggleAdditiveInput() {
  const hasAdd = document.getElementById('fuelHasAdditive').checked;
  const addGroup = document.getElementById('fuelAdditiveGroup');
  if (addGroup) addGroup.style.display = hasAdd ? 'block' : 'none';
  if (!hasAdd) {
    const nameInput = document.getElementById('fuelAdditiveName');
    if (nameInput) nameInput.value = '';
  }
}

function calcFuelFields(changedField) {
  const liters = parseFloat(document.getElementById('fuelLiters').value) || 0;
  const total = parseFloat(document.getElementById('fuelTotalPrice').value) || 0;
  const ppl = parseFloat(document.getElementById('fuelPricePerLiter').value) || 0;

  if (changedField === 'liters' && ppl > 0) document.getElementById('fuelTotalPrice').value = (liters * ppl).toFixed(2);
  else if (changedField === 'total' && liters > 0) document.getElementById('fuelPricePerLiter').value = (total / liters).toFixed(3);
  else if (changedField === 'ppl' && liters > 0) document.getElementById('fuelTotalPrice').value = (liters * ppl).toFixed(2);
}

function saveFuelEntry(e) {
  e.preventDefault();
  const v = getActiveVehicle();
  if (!v) return;

  const editId = document.getElementById('fuelEditId').value;
  const hasAdditive = document.getElementById('fuelHasAdditive').checked;

  const categorySelect = document.getElementById('fuelCategorySelect').value;
  const finalFuelType = categorySelect === 'Sonstiges' 
    ? (document.getElementById('fuelCustomType').value || 'Sonstiges')
    : categorySelect;

  const entry = {
    id: editId ? editId : "f_" + Date.now(),
    date: document.getElementById('fuelDate').value,
    fuelType: finalFuelType,
    mileage: parseFormattedNumber(document.getElementById('fuelMileage').value) || 0,
    liters: parseFloat(document.getElementById('fuelLiters').value) || 0,
    totalPrice: parseFloat(document.getElementById('fuelTotalPrice').value) || 0,
    pricePerLiter: parseFloat(document.getElementById('fuelPricePerLiter').value) || 0,
    full: document.getElementById('fuelFull').checked,
    hasAdditive: hasAdditive,
    additiveName: hasAdditive ? document.getElementById('fuelAdditiveName').value : '',
    notes: document.getElementById('fuelNotes').value
  };

  if (!v.fuelEntries) v.fuelEntries = [];

  if (editId) {
    const idx = v.fuelEntries.findIndex(f => f.id === editId);
    if (idx !== -1) v.fuelEntries[idx] = entry;
  } else {
    v.fuelEntries.push(entry);
  }

  v.fuelEntries.sort(compareByDateThenMileageDesc);

  saveData();
  closeFuelFormModal();
  renderFuelTable();
  renderDashboard();
}

function editFuelEntry(id) {
  const v = getActiveVehicle();
  if (!v || !v.fuelEntries) return;
  const entry = v.fuelEntries.find(f => f.id === id);
  if (!entry) return;

  document.getElementById('fuelEditId').value = entry.id;
  document.getElementById('fuelDate').value = entry.date;

  const standardTypes = ["Super", "Super Plus", "Diesel", "Premium Diesel"];
  if (standardTypes.includes(entry.fuelType)) {
    document.getElementById('fuelCategorySelect').value = entry.fuelType;
    document.getElementById('customFuelGroup').style.display = 'none';
  } else {
    document.getElementById('fuelCategorySelect').value = 'Sonstiges';
    document.getElementById('customFuelGroup').style.display = 'block';
    document.getElementById('fuelCustomType').value = entry.fuelType || '';
  }

  document.getElementById('fuelMileage').value = formatNumberForDisplay(entry.mileage);
  document.getElementById('fuelLiters').value = entry.liters;
  document.getElementById('fuelTotalPrice').value = entry.totalPrice;
  document.getElementById('fuelPricePerLiter').value = entry.pricePerLiter;
  document.getElementById('fuelFull').checked = entry.full;
  document.getElementById('fuelHasAdditive').checked = entry.hasAdditive || false;
  toggleAdditiveInput();
  document.getElementById('fuelAdditiveName').value = entry.additiveName || '';
  document.getElementById('fuelNotes').value = entry.notes || '';

  document.getElementById('fuelSubmitBtn').innerText = "Änderungen Speichern";
  document.getElementById('fuelCancelBtn').style.display = "inline-block";
  openFuelFormModal();
}

function deleteFuelEntry(id) {
  if (!confirm("Diesen Tankeintrag wirklich löschen?")) return;
  const v = getActiveVehicle();
  if (!v || !v.fuelEntries) return;
  v.fuelEntries = v.fuelEntries.filter(f => f.id !== id);
  saveData();
  renderFuelTable();
  renderDashboard();
}

function resetFuelForm() {
  document.getElementById('fuelEditId').value = '';
  document.getElementById('fuelForm').reset();
  document.getElementById('fuelDate').value = new Date().toISOString().split('T')[0];
  toggleCustomFuelInput();
  toggleAdditiveInput();
  document.getElementById('fuelSubmitBtn').innerText = "Tankung Speichern";
  document.getElementById('fuelCancelBtn').style.display = "none";
}

// Formular für neue/bearbeitete Tankungen als Modal öffnen/schließen (FAB-Button)
function openFuelFormModal() {
  document.getElementById('fuelFormModal').classList.add('active');
}
window.openFuelFormModal = openFuelFormModal;

function closeFuelFormModal() {
  document.getElementById('fuelFormModal').classList.remove('active');
  resetFuelForm();
}
window.closeFuelFormModal = closeFuelFormModal;

// Globalen Status ganz oben in der app.js halten (oder vor renderFuelTable)
let showAllFuelEntries = false;

function renderFuelTable() {
  if (typeof renderHistoryTable === 'function') renderHistoryTable();
  const v = getActiveVehicle();
  const tbody = document.getElementById('fuelTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!v || !v.fuelEntries || v.fuelEntries.length === 0) {
    const toggleContainer = document.getElementById('fuelToggleBtnContainer');
    if (toggleContainer) toggleContainer.style.display = 'none';
    return;
  }

  // 1. Sortierung für die Verbrauchsberechnung (aufsteigend nach Kilometerstand)
  // Verbrauch wird nach der "Voll-zu-Voll"-Methode berechnet: von einer Volltankung
  // bis zur nächsten, wobei die Literzahl ALLER Tankungen dazwischen (auch
  // Teilbetankungen) zusammengezählt wird - nur so stimmt die Strecke zur Menge.
  const sortedFuel = [...v.fuelEntries].sort((a, b) => a.mileage - b.mileage);
  const consumptionMap = {};
  const unitLabel = v.type === 'km' ? 'L/100km' : 'L/Std';
  let lastFullIndex = -1;

  for (let i = 0; i < sortedFuel.length; i++) {
    const current = sortedFuel[i];

    if (!current.full) {
      consumptionMap[current.id] = '-';
      continue;
    }

    if (lastFullIndex === -1) {
      consumptionMap[current.id] = '-';
    } else {
      const previousFull = sortedFuel[lastFullIndex];
      const dist = current.mileage - previousFull.mileage;

      let totalLiters = 0;
      for (let j = lastFullIndex + 1; j <= i; j++) {
        totalLiters += sortedFuel[j].liters || 0;
      }

      if (dist > 0) {
        const consumption = (totalLiters / dist) * 100;
        consumptionMap[current.id] = `${consumption.toFixed(2)} ${unitLabel}`;
      } else {
        consumptionMap[current.id] = '-';
      }
    }

    lastFullIndex = i;
  }

  // 2. Sortierung für die Anzeige in der Tabelle (neueste Einträge zuerst)
  const displaySorted = [...v.fuelEntries].sort(compareByDateThenMileageDesc);

  // 3. Auf max. 5 Einträge begrenzen (falls nicht ausgeklappt)
  const hasMoreThan10 = displaySorted.length > 5;
  const entriesToRender = (hasMoreThan10 && !showAllFuelEntries) 
    ? displaySorted.slice(0, 5) 
    : displaySorted;

  // 4. Tabelle befüllen
  entriesToRender.forEach(f => {
    const tr = document.createElement('tr');
    const additiveBadge = f.hasAdditive ? `<span class="badge-additive" title="${f.additiveName || ''}">🧪 ${f.additiveName || 'Zusatz'}</span>` : '-';
    const consumptionVal = f.full
      ? (consumptionMap[f.id] || '-')
      : '<span class="badge badge-partial" title="Teilbetankung – fließt erst in die nächste Volltankung mit ein">Teilbetankung</span>';
    const pricePerLiterVal = f.pricePerLiter ? `${f.pricePerLiter.toFixed(3)} €` : '-';

    tr.innerHTML = `
      <td data-label="Datum">${f.date}</td>
      <td data-label="Kraftstoff">${f.fuelType}</td>
      <td data-label="Stand">${f.mileage.toLocaleString()}</td>
      <td data-label="Liter">${f.liters.toFixed(2)} L</td>
      <td data-label="€/Liter">${pricePerLiterVal}</td>
      <td data-label="Verbrauch">${consumptionVal}</td>
      <td data-label="Zusatz">${additiveBadge}</td>
      <td data-label="Gesamt"><strong>${f.totalPrice.toFixed(2)} €</strong></td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="editFuelEntry('${f.id}')">${ICON_EDIT_SVG}</button>
        <button class="btn btn-danger btn-sm" onclick="deleteFuelEntry('${f.id}')">${ICON_DELETE_SVG}</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // 5. Button "Mehr anzeigen / Weniger anzeigen" steuern
  let toggleContainer = document.getElementById('fuelToggleBtnContainer');
  let toggleBtn = document.getElementById('fuelToggleBtn');

  if (hasMoreThan10 && toggleContainer && toggleBtn) {
    toggleContainer.style.display = 'block';
    const remainingCount = displaySorted.length - 5;
    toggleBtn.innerText = showAllFuelEntries 
      ? 'Weniger anzeigen' 
      : `Mehr anzeigen (${remainingCount} weitere Einträge)`;
  } else if (toggleContainer) {
    toggleContainer.style.display = 'none';
  }
}

// Umschalt-Funktion & Global-Bindung
function toggleFuelEntries() {
  showAllFuelEntries = !showAllFuelEntries;
  renderFuelTable();
}

window.toggleFuelEntries = toggleFuelEntries;

/* --- WARTUNG & SERVICE --- */

// Blendet die Wiederholungs-Erinnerung (KM/Datum) nur bei Kategorie "Wartung" ein
function toggleRoutineIntervalFields() {
  const category = document.getElementById('serviceCategory').value;
  const container = document.getElementById('routineIntervalContainer');
  if (!container) return;

  if (category === 'Wartung') {
    container.style.display = '';
    renderIntervalPresetButtons();
  } else {
    container.style.display = 'none';
    // Felder leeren, wenn sie nicht zu einer Routine-Wartung gehören
    const kmField = document.getElementById('nextServiceKm');
    const dateField = document.getElementById('nextServiceDate');
    if (kmField) kmField.value = '';
    if (dateField) dateField.value = '';
  }
}
window.toggleRoutineIntervalFields = toggleRoutineIntervalFields;

// Zeigt Schnellauswahl-Buttons für gängige Wartungsintervalle an (z.B. +10.000 km).
// Bei Betriebsstunden-Fahrzeugen (Boote) werden passende Stunden-Intervalle angezeigt.
function renderIntervalPresetButtons() {
  const container = document.getElementById('intervalPresetRow');
  if (!container) return;
  const v = getActiveVehicle();
  const isKm = !v || v.type === 'km';
  const presets = isKm ? [10000, 20000, 30000, 40000] : [50, 100, 150, 200];
  const unitSuffix = isKm ? '' : ' Std';
  const label = isKm ? 'Intervall ab aktuellem KM-Stand:' : 'Intervall ab aktuellen Betriebsstunden:';
  container.innerHTML =
    `<span class="interval-preset-label">${label}</span>` +
    presets.map(p => `<button type="button" class="interval-preset-btn" onclick="applyServiceInterval(${p})">+${p.toLocaleString('de-DE')}${unitSuffix}</button>`).join('');
}
window.renderIntervalPresetButtons = renderIntervalPresetButtons;

// Berechnet aus dem aktuell eingetragenen KM-Stand/Betriebsstunden + gewähltem Intervall
// den Ziel-Wert und trägt ihn automatisch ins "Bei KM-Stand"-Feld ein.
function applyServiceInterval(intervalAmount) {
  const mileageInput = document.getElementById('serviceMileage');
  const nextKmInput = document.getElementById('nextServiceKm');
  if (!mileageInput || !nextKmInput) return;

  const currentMileage = parseFormattedNumber(mileageInput.value);
  if (!currentMileage) {
    alert('Bitte zuerst oben den aktuellen KM-Stand bzw. die Betriebsstunden eintragen – die Schnellauswahl berechnet den Zielwert daraus.');
    return;
  }

  const target = currentMileage + intervalAmount;
  nextKmInput.value = formatNumberForDisplay(target);
}
window.applyServiceInterval = applyServiceInterval;

function handleServiceImageUpload(event) {
  const files = Array.from(event.target.files);
  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = async function(e) {
      const compressed = await compressImage(e.target.result);
      tempServiceImages.push(compressed);
      renderServiceImagePreviews();
    };
    reader.readAsDataURL(file);
  });
}
function renderServiceImagePreviews() {
  const container = document.getElementById('serviceImagePreviewContainer');
  if (!container) return;
  container.innerHTML = '';
  tempServiceImages.forEach((imgSrc, index) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'preview-thumb-wrapper';
    wrapper.innerHTML = `
      <img src="${imgSrc}" class="preview-thumb">
      <button type="button" class="btn-remove-thumb" onclick="removeTempServiceImage(${index})">✕</button>
    `;
    container.appendChild(wrapper);
  });
}

function removeTempServiceImage(index) {
  tempServiceImages.splice(index, 1);
  renderServiceImagePreviews();
}

function saveServiceEntry(e) {
  e.preventDefault();
  const v = getActiveVehicle();
  if (!v) return;

  const editId = document.getElementById('serviceEditId').value;
  const existingEntry = editId ? (v.serviceEntries || []).find(s => s.id === editId) : null;

  const entry = {
    id: editId ? editId : "s_" + Date.now(),
    isStandEntry: existingEntry ? !!existingEntry.isStandEntry : false,
    category: document.getElementById('serviceCategory').value,
    title: document.getElementById('serviceTitle').value,
    date: document.getElementById('serviceDate').value,
    mileage: parseFormattedNumber(document.getElementById('serviceMileage').value) || 0,
    cost: parseFloat(document.getElementById('serviceCost').value) || 0,
    performer: document.getElementById('servicePerformer').value,
    notes: document.getElementById('serviceNotes').value,
    images: [...tempServiceImages],
    // Wiederholungs-Erinnerung (nur bei Kategorie "Wartung" befüllt, sonst leer)
    nextKm: parseFormattedNumber(document.getElementById('nextServiceKm').value) || null,
    nextDate: document.getElementById('nextServiceDate').value || null,
    // Bei Booten mit mehreren Motoren: welcher Motor betroffen ist (leer = Allgemein/Rumpf)
    engineId: document.getElementById('serviceEngineSelect') ? (document.getElementById('serviceEngineSelect').value || null) : null
  };

  if (!v.serviceEntries) v.serviceEntries = [];

  if (editId) {
    const idx = v.serviceEntries.findIndex(s => s.id === editId);
    if (idx !== -1) v.serviceEntries[idx] = entry;
  } else {
    v.serviceEntries.push(entry);
  }

  v.serviceEntries.sort(compareByDateThenMileageDesc);

  saveData();
  closeServiceFormModal();
  renderServiceTable();
  renderDashboard();
}

function resetServiceForm() {
  document.getElementById('serviceEditId').value = '';
  document.getElementById('serviceForm').reset();
  document.getElementById('serviceDate').value = new Date().toISOString().split('T')[0];
  tempServiceImages = [];
  renderServiceImagePreviews();
  document.getElementById('serviceSubmitBtn').innerText = "Eintrag Speichern";
  document.getElementById('serviceCancelBtn').style.display = "none";
  toggleRoutineIntervalFields();
}

// Formular für neue/bearbeitete Wartungen als Modal öffnen/schließen (FAB-Button)
// Zeigt die "Betrifft"-Auswahl (Motor 1 / Motor 2 / Allgemein) nur bei Booten
// mit mehreren erfassten Motoren; sonst bleibt sie versteckt (Wert bleibt leer).
function updateServiceEngineFieldForActiveVehicle() {
  const group = document.getElementById('serviceEngineFieldGroup');
  const select = document.getElementById('serviceEngineSelect');
  if (!group || !select) return;

  const v = getActiveVehicle();
  const engines = (v && v.category === 'boot') ? getBoatEngines(v) : [];

  if (engines.length > 0) {
    select.innerHTML = '<option value="">Allgemein / Rumpf</option>' +
      engines.map(e => `<option value="${e.id}">${e.name || 'Motor'}</option>`).join('');
    group.style.display = '';
  } else {
    select.innerHTML = '<option value="">Allgemein / Rumpf</option>';
    group.style.display = 'none';
  }
}

/* --- FAHRZEUGSCHEIN: Foto/Scan des echten Dokuments hinterlegen --- */
let tempFzscheinPhoto = null;

function handleFahrzeugscheinPhotoUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  cropTarget = 'fahrzeugschein';
  const reader = new FileReader();
  reader.onload = function(e) {
    openImageCropModal(e.target.result);
  };
  reader.readAsDataURL(file);
}
window.handleFahrzeugscheinPhotoUpload = handleFahrzeugscheinPhotoUpload;

function renderFzscheinPhotoPreview() {
  const container = document.getElementById('fzscheinPhotoPreviewContainer');
  if (!container) return;
  if (!tempFzscheinPhoto) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = `
    <div class="fzschein-photo-thumb-wrapper">
      <img src="${tempFzscheinPhoto}" class="fzschein-photo-thumb" onclick="viewFzscheinPhoto()">
      <button type="button" class="fzschein-photo-remove" onclick="removeFzscheinPhoto()">✕</button>
    </div>
  `;
}

function removeFzscheinPhoto() {
  tempFzscheinPhoto = null;
  renderFzscheinPhotoPreview();
}
window.removeFzscheinPhoto = removeFzscheinPhoto;

function viewFzscheinPhoto() {
  if (!tempFzscheinPhoto) return;
  openImageZoomView(tempFzscheinPhoto);
}
window.viewFzscheinPhoto = viewFzscheinPhoto;

/* --- FAHRZEUGSCHEIN (digital nachgebaut, alle Felder optional) --- */
const FAHRZEUGSCHEIN_FIELDS = [
  'erstzulassung', 'hsn', 'tsn', 'vin', 'typ', 'hersteller', 'handelsbezeichnung',
  'fahrzeugart', 'schadstoffklasse', 'kraftstoffart', 'hubraum',
  'leistungKw', 'drehzahl', 'hoechstgeschwindigkeit', 'laenge', 'breite', 'hoehe',
  'leergewicht', 'gesamtgewicht', 'achslastVorne', 'achslastHinten',
  'anhaengelastGebremst', 'anhaengelastUngebremst', 'bereifungVorne', 'bereifungHinten'
];

function openFahrzeugscheinModal() {
  const v = getActiveVehicle();
  if (!v) return;
  const daten = v.fahrzeugschein || {};

  FAHRZEUGSCHEIN_FIELDS.forEach(key => {
    const el = document.getElementById('fzs' + key.charAt(0).toUpperCase() + key.slice(1));
    if (el) el.value = daten[key] || '';
  });

  // Immer auf Seite 1 starten
  const page1 = document.getElementById('fzsPage1');
  const page2 = document.getElementById('fzsPage2');
  if (page1) { page1.style.display = ''; page1.classList.add('active'); }
  if (page2) { page2.style.display = 'none'; page2.classList.remove('active'); }

  // Hinterlegtes Foto/Scan laden
  tempFzscheinPhoto = daten.photo || null;
  renderFzscheinPhotoPreview();

  document.getElementById('fahrzeugscheinModal').classList.add('active');
}
window.openFahrzeugscheinModal = openFahrzeugscheinModal;

// Blättert dezent zwischen den beiden Schein-Seiten um
function switchFzscheinPage(targetPageNum) {
  const currentPage = document.querySelector('.fzschein-page.active');
  const targetPage = document.getElementById('fzsPage' + targetPageNum);
  if (!currentPage || !targetPage || currentPage === targetPage) return;

  currentPage.classList.add('fzschein-page-turning-out');
  setTimeout(() => {
    currentPage.classList.remove('active', 'fzschein-page-turning-out');
    currentPage.style.display = 'none';

    targetPage.style.display = '';
    targetPage.classList.add('active', 'fzschein-page-turning-in');
    setTimeout(() => targetPage.classList.remove('fzschein-page-turning-in'), 560);
  }, 550);
}
window.switchFzscheinPage = switchFzscheinPage;

function closeFahrzeugscheinModal() {
  document.getElementById('fahrzeugscheinModal').classList.remove('active');
}
window.closeFahrzeugscheinModal = closeFahrzeugscheinModal;

function saveFahrzeugschein(e) {
  e.preventDefault();
  const v = getActiveVehicle();
  if (!v) return;

  const daten = {};
  FAHRZEUGSCHEIN_FIELDS.forEach(key => {
    const el = document.getElementById('fzs' + key.charAt(0).toUpperCase() + key.slice(1));
    if (el) daten[key] = el.value;
  });

  daten.photo = tempFzscheinPhoto || null;
  v.fahrzeugschein = daten;

  // Umgekehrte Richtung: überschneidende Angaben zurück in die Stammdaten
  // übernehmen, damit beide Stellen immer synchron bleiben
  if (daten.erstzulassung) v.firstReg = daten.erstzulassung;
  if (daten.hsn) v.hsn = daten.hsn;
  if (daten.tsn) v.tsn = daten.tsn;
  if (daten.vin) v.vin = daten.vin;
  if (daten.kraftstoffart) v.fuelType = daten.kraftstoffart;
  if (daten.leistungKw) {
    const ps = Math.round(parseFloat(daten.leistungKw.replace(',', '.')) * 1.35962);
    if (!isNaN(ps) && ps > 0) v.powerHp = ps;
  }
  if (daten.anhaengelastGebremst) {
    const kg = parseInt(daten.anhaengelastGebremst, 10);
    if (!isNaN(kg) && kg > 0) v.towingBraked = kg;
  }

  saveData();
  closeFahrzeugscheinModal();

  // Stammdaten-Formular neu befüllen, falls es gerade im Hintergrund offen ist
  loadActiveVehicle();
}
window.saveFahrzeugschein = saveFahrzeugschein;

/* --- STANDERFASSUNG (KM-Stand / Betriebsstunden ohne Tankung/Wartung eintragen) --- */
function openStandEntryModal() {
  const v = getActiveVehicle();
  if (!v) return;

  document.getElementById('standEntryDate').value = new Date().toISOString().split('T')[0];

  const unitLabel = v.type === 'hours' ? 'Betriebsstunden' : 'KM-Stand';
  const engines = getBoatEngines(v);
  const singleGroup = document.getElementById('standEntrySingleGroup');
  const enginesContainer = document.getElementById('standEntryEnginesContainer');
  const singleLabel = document.getElementById('standEntrySingleLabel');
  const singleValue = document.getElementById('standEntrySingleValue');

  if (v.category === 'boot' && engines.length > 1) {
    // Mehrere Motoren: pro Motor ein eigenes Eingabefeld
    singleGroup.style.display = 'none';
    singleValue.value = '';
    enginesContainer.innerHTML = engines.map(e => `
      <div class="form-group">
        <label>${e.name || 'Motor'} - Betriebsstunden</label>
        <input type="text" inputmode="decimal" class="stand-entry-engine-input" data-engine-id="${e.id}" placeholder="z.B. 320" oninput="formatMileageInput(this)">
      </div>
    `).join('');
  } else {
    singleGroup.style.display = '';
    singleLabel.innerText = unitLabel;
    singleValue.value = '';
    enginesContainer.innerHTML = '';
  }

  document.getElementById('standEntryModal').classList.add('active');
}
window.openStandEntryModal = openStandEntryModal;

function closeStandEntryModal() {
  document.getElementById('standEntryModal').classList.remove('active');
}
window.closeStandEntryModal = closeStandEntryModal;

function saveStandEntry(e) {
  e.preventDefault();
  const v = getActiveVehicle();
  if (!v) return;

  const date = document.getElementById('standEntryDate').value;
  if (!v.serviceEntries) v.serviceEntries = [];

  const engineInputs = document.querySelectorAll('.stand-entry-engine-input');

  if (engineInputs.length > 0) {
    // Standmeldung pro Motor (nur ausgefüllte Felder übernehmen)
    let savedAny = false;
    engineInputs.forEach(input => {
      if (!input.value || input.value.trim() === '') return;
      const val = parseFormattedNumber(input.value);
      const engineId = input.getAttribute('data-engine-id');
      const engine = getBoatEngines(v).find(x => x.id === engineId);
      v.serviceEntries.push({
        id: "s_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
        category: "Sonstiges",
        title: `Standmeldung (${engine ? engine.name : 'Motor'})`,
        date: date,
        mileage: val,
        cost: 0,
        performer: "Eigenleistung",
        notes: "Formlose Standmeldung.",
        images: [],
        engineId: engineId,
        isStandEntry: true
      });
      savedAny = true;
    });
    if (!savedAny) {
      alert("Bitte mindestens ein Feld ausfüllen.");
      return;
    }
  } else {
    const rawStandValue = document.getElementById('standEntrySingleValue').value;
    if (!rawStandValue || rawStandValue.trim() === '') {
      alert("Bitte einen Stand eingeben.");
      return;
    }
    const val = parseFormattedNumber(rawStandValue);
    v.serviceEntries.push({
      id: "s_" + Date.now(),
      category: "Sonstiges",
      title: "Standmeldung",
      date: date,
      mileage: val,
      cost: 0,
      performer: "Eigenleistung",
      notes: "Formlose Standmeldung.",
      images: [],
      engineId: null,
      isStandEntry: true
    });
  }

  v.serviceEntries.sort(compareByDateThenMileageDesc);
  saveData();
  closeStandEntryModal();
  renderServiceTable();
  renderDashboard();
}
window.saveStandEntry = saveStandEntry;

function openServiceFormModal() {
  updateServiceEngineFieldForActiveVehicle();
  updateServiceCategoryOptionsForActiveVehicle();
  toggleRoutineIntervalFields();
  document.getElementById('serviceFormModal').classList.add('active');
}
window.openServiceFormModal = openServiceFormModal;

// Bei Booten ergibt der TÜV/HU-Eintrag keinen Sinn - Option ausblenden
// (und ggf. eine bereits gewählte TÜV-Kategorie auf "Sonstiges" umstellen)
function updateServiceCategoryOptionsForActiveVehicle() {
  const tuevOption = document.getElementById('serviceTuevOption');
  const categorySelect = document.getElementById('serviceCategory');
  if (!tuevOption || !categorySelect) return;

  const v = getActiveVehicle();
  const isBoat = v && v.category === 'boot';

  tuevOption.style.display = isBoat ? 'none' : '';
  if (isBoat && categorySelect.value === 'TÜV') {
    categorySelect.value = 'Sonstiges';
  }
}

function closeServiceFormModal() {
  document.getElementById('serviceFormModal').classList.remove('active');
  resetServiceForm();
}
window.closeServiceFormModal = closeServiceFormModal;

// Globaler Status für die Wartungstabelle (ganz oben in app.js oder vor der Funktion)
let showAllServiceEntries = false;

function renderServiceTable() {
  if (typeof renderHistoryTable === 'function') renderHistoryTable();
  const v = getActiveVehicle();
  const tbody = document.getElementById('serviceTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const toggleContainer = document.getElementById('serviceToggleBtnContainer');
  const toggleBtn = document.getElementById('serviceToggleBtn');

  // Formlose Standmeldungen gehören nur in die Chronik, nicht in die Wartungsliste
  const relevantEntries = (v && v.serviceEntries) ? v.serviceEntries.filter(s => !s.isStandEntry) : [];

  if (!v || relevantEntries.length === 0) {
    if (toggleContainer) toggleContainer.style.display = 'none';
    return;
  }

  // 1. Nach Datum sortieren (neueste Einträge zuerst)
  const sortedServices = [...relevantEntries].sort(compareByDateThenMileageDesc);

  // 2. Auf max. 5 Einträge begrenzen (falls nicht ausgeklappt)
  const hasMoreThan5 = sortedServices.length > 5;
  const entriesToRender = (hasMoreThan5 && !showAllServiceEntries) 
    ? sortedServices.slice(0, 5) 
    : sortedServices;

  // 3. Tabelle befüllen
  entriesToRender.forEach(s => {
    const tr = document.createElement('tr');
    tr.className = 'clickable-row';
    tr.onclick = (e) => {
      if (e.target.tagName !== 'BUTTON') openServiceDetailModal(s.id);
    };

    const costVal = typeof s.cost === 'number' ? s.cost.toFixed(2) + ' €' : '-';

    // Bei Booten mit mehreren Motoren: zeigen, welcher Motor betroffen war
    let engineTagHtml = '';
    if (v.category === 'boot' && getBoatEngines(v).length > 0) {
      const engineName = s.engineId
        ? (getBoatEngines(v).find(e => e.id === s.engineId)?.name || 'Motor')
        : 'Allgemein / Rumpf';
      engineTagHtml = `<div style="font-size: 0.76rem; color: var(--text-muted); margin-top: 2px;">${engineName}</div>`;
    }

    tr.innerHTML = `
      <td data-label="Datum">${s.date || '-'}</td>
      <td data-label="Kategorie"><span class="badge">${s.category || 'Allgemein'}</span></td>
      <td data-label="Titel"><strong>${s.title || 'Wartung'}</strong>${engineTagHtml}</td>
      <td data-label="Kosten">${costVal}</td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="editServiceEntry('${s.id}')">${ICON_EDIT_SVG}</button>
        <button class="btn btn-danger btn-sm" onclick="deleteServiceEntry('${s.id}')">${ICON_DELETE_SVG}</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // 4. Button "Mehr anzeigen / Weniger anzeigen" steuern
  if (hasMoreThan5 && toggleContainer && toggleBtn) {
    toggleContainer.style.display = 'block';
    const remainingCount = sortedServices.length - 5;
    toggleBtn.innerText = showAllServiceEntries 
      ? 'Weniger anzeigen' 
      : `Mehr anzeigen (${remainingCount} weitere Einträge)`;
  } else if (toggleContainer) {
    toggleContainer.style.display = 'none';
  }
}

// Umschalt-Funktion & Global-Bindung für HTML
function toggleServiceEntries() {
  showAllServiceEntries = !showAllServiceEntries;
  renderServiceTable();
}

window.toggleServiceEntries = toggleServiceEntries;

function editServiceEntry(id) {
  const v = getActiveVehicle();
  if (!v || !v.serviceEntries) return;
  const entry = v.serviceEntries.find(s => s.id === id);
  if (!entry) return;

  document.getElementById('serviceEditId').value = entry.id;
  document.getElementById('serviceCategory').value = entry.category;
  document.getElementById('serviceTitle').value = entry.title;
  document.getElementById('serviceDate').value = entry.date;
  document.getElementById('serviceMileage').value = formatNumberForDisplay(entry.mileage);
  document.getElementById('serviceCost').value = entry.cost;
  document.getElementById('servicePerformer').value = entry.performer;
  document.getElementById('serviceNotes').value = entry.notes || '';
  document.getElementById('nextServiceKm').value = formatNumberForDisplay(entry.nextKm);
  document.getElementById('nextServiceDate').value = entry.nextDate || '';
  toggleRoutineIntervalFields();

  tempServiceImages = entry.images ? [...entry.images] : [];
  renderServiceImagePreviews();

  document.getElementById('serviceSubmitBtn').innerText = "Änderungen Speichern";
  document.getElementById('serviceCancelBtn').style.display = "inline-block";
  openServiceFormModal();

  const engineSelect = document.getElementById('serviceEngineSelect');
  if (engineSelect) engineSelect.value = entry.engineId || '';
}

function deleteServiceEntry(id) {
  if (!confirm("Diesen Wartungseintrag wirklich löschen?")) return;
  const v = getActiveVehicle();
  if (!v || !v.serviceEntries) return;
  v.serviceEntries = v.serviceEntries.filter(s => s.id !== id);
  saveData();
  renderServiceTable();
  renderDashboard();
}

function openServiceDetailModal(id) {
  const v = getActiveVehicle();
  if (!v || !v.serviceEntries) return;
  const s = v.serviceEntries.find(entry => entry.id === id);
  if (!s) return;

  document.getElementById('sdTitle').innerText = s.title;
  document.getElementById('sdCategory').innerText = s.category;
  document.getElementById('sdDate').innerText = s.date;
  document.getElementById('sdMileage').innerText = `${s.mileage.toLocaleString()} ${v.type === 'km' ? 'km' : 'Std'}`;
  document.getElementById('sdCost').innerText = `${s.cost.toFixed(2)} €`;
  document.getElementById('sdPerformer').innerText = s.performer;
  document.getElementById('sdNotes').innerText = s.notes || 'Keine Notizen vorhanden.';

  // Motor-Zuordnung (nur bei Booten mit mehreren erfassten Motoren relevant)
  const sdEngineRow = document.getElementById('sdEngineRow');
  const boatEnginesForDetail = getBoatEngines(v);
  if (v.category === 'boot' && boatEnginesForDetail.length > 0) {
    const engineName = s.engineId
      ? (boatEnginesForDetail.find(e => e.id === s.engineId)?.name || 'Motor')
      : 'Allgemein / Rumpf';
    document.getElementById('sdEngine').innerText = engineName;
    if (sdEngineRow) sdEngineRow.style.display = '';
  } else if (sdEngineRow) {
    sdEngineRow.style.display = 'none';
  }

  // Wiederholungs-Erinnerung (nur bei Routine-Wartungen mit gesetztem Intervall)
  const sdReminderRow = document.getElementById('sdReminderRow');
  const reminderParts = [];
  if (s.nextKm) reminderParts.push(`bei ${s.nextKm.toLocaleString('de-DE')} ${v.type === 'hours' ? 'Std' : 'km'}`);
  if (s.nextDate) reminderParts.push(`am ${new Date(s.nextDate).toLocaleDateString('de-DE')}`);
  if (reminderParts.length > 0) {
    document.getElementById('sdReminder').innerText = reminderParts.join(' / ');
    if (sdReminderRow) sdReminderRow.style.display = '';
  } else if (sdReminderRow) {
    sdReminderRow.style.display = 'none';
  }

  const container = document.getElementById('sdImagesContainer');
  if (container) {
    container.innerHTML = '';
    if (s.images && s.images.length > 0) {
      s.images.forEach(img => {
        const wrapper = document.createElement('div');
        wrapper.className = 'gallery-img-wrapper';
        wrapper.innerHTML = `<img src="${img}" onclick="window.open('${img}')">`;
        container.appendChild(wrapper);
      });
    } else {
      container.innerHTML = '<span class="text-muted">Keine Bilder vorhanden.</span>';
    }
  }

  document.getElementById('sdEditBtn').onclick = () => {
    closeServiceDetailModal();
    editServiceEntry(s.id);
  };

  document.getElementById('serviceDetailModal').classList.add('active');
}

function closeServiceDetailModal() {
  const el = document.getElementById('serviceDetailModal');
  if (el) el.classList.remove('active');
}

/* --- DASHBOARD & CHARTS --- */
function renderDashboard() {
  const v = getActiveVehicle();
  if (!v) return;

  document.getElementById('dashVehicleName').innerText = v.name || 'Unbenanntes Fahrzeug';
  document.getElementById('dashVehiclePlate').innerText = v.plate || 'OHNE-ID';
  document.getElementById('dashVehicleFuel').innerText = `Kraftstoff: ${v.fuelType || '-'}`;
  document.getElementById('dashVehicleType').innerText = `Typ: ${v.type === 'km' ? 'KM' : 'Betriebsstunden'}`;

  // Kraftstoff & Erfassungstyp sind bei einem Anhänger (kein Motor, kein Stand) nicht relevant
  const dashSpecsRow = document.getElementById('dashSpecsRow');
  if (dashSpecsRow) dashSpecsRow.style.display = v.category === 'anhaenger' ? 'none' : '';
  if (v.category === 'boot') {
    document.getElementById('dashVehicleVin').innerText = `Rumpfnummer (HIN): ${v.hullNumber || '-'}`;
  } else {
    document.getElementById('dashVehicleVin').innerText = `VIN: ${v.vin || '-'}`;
  }
  document.getElementById('dashVehicleSpecs').innerText = v.specs || 'Keine Spezifikationen eingetragen.';

  // TÜV-Plakette auf dem Fahrzeugfoto im Dashboard (wie auf der Kachel)
  const dashPlaketteContainer = document.getElementById('dashTuevPlakette');
  if (dashPlaketteContainer) {
    const dashTuevPlakette = getTuevPlaketteData(v, false);
    if (!dashTuevPlakette) {
      dashPlaketteContainer.innerHTML = '';
    } else if (dashTuevPlakette.empty) {
      dashPlaketteContainer.innerHTML = `<div class="tuev-plakette tuev-plakette-empty"></div>`;
    } else {
      dashPlaketteContainer.innerHTML = `
        <div class="tuev-plakette ${dashTuevPlakette.colorClass}">
          <div class="tuev-plakette-ring">${dashTuevPlakette.monthRingHtml}</div>
          <div class="tuev-plakette-center">
            <span class="tuev-plakette-year">${dashTuevPlakette.year}</span>
          </div>
          ${dashTuevPlakette.overdue ? '<span class="tuev-plakette-overdue-badge">!</span>' : ''}
        </div>
      `;
    }
  }

  const hsn = v.hsn || '-';
  const tsn = v.tsn || '-';
  document.getElementById('dashVehicleHsnTsn').innerText = `HSN/TSN: ${hsn} / ${tsn}`;


  const imgDash = document.getElementById('vehicleDashboardImage');
  const imgPlaceholder = document.getElementById('vehicleImagePlaceholder');

  if (v.image) {
    imgDash.src = v.image;
    imgDash.style.display = 'block';
    imgPlaceholder.style.display = 'none';
  } else {
    imgDash.style.display = 'none';
    imgPlaceholder.style.display = 'block';
  }

  const fuelList = v.fuelEntries || [];
  const serviceList = v.serviceEntries || [];

  const allMileage = [
    ...fuelList.map(f => f.mileage || 0),
    ...serviceList.map(s => s.mileage || 0)
  ];
  const maxMileage = allMileage.length > 0 ? Math.max(...allMileage) : 0;
  document.getElementById('kpi-mileage').innerText = `${maxMileage.toLocaleString()} ${v.type === 'km' ? 'km' : 'Std'}`;

  // Voll-zu-Voll-Methode: Strecke zwischen erster & letzter Volltankung, aber die
  // Literzahl ALLER Tankungen (auch Teilbetankungen) dazwischen zusammenzählen
  const sortedFuelForAvg = [...fuelList].sort((a, b) => a.mileage - b.mileage);
  const fullTankings = sortedFuelForAvg.filter(f => f.full);
  let totalLiters = 0;
  let totalDist = 0;

  if (fullTankings.length >= 2) {
    const firstFull = fullTankings[0];
    const lastFull = fullTankings[fullTankings.length - 1];
    totalDist = lastFull.mileage - firstFull.mileage;
    totalLiters = sortedFuelForAvg
      .filter(f => f.mileage > firstFull.mileage && f.mileage <= lastFull.mileage)
      .reduce((sum, f) => sum + (f.liters || 0), 0);
  }

  const avgConsumption = totalDist > 0 ? (totalLiters / totalDist) * 100 : 0;
  const unitLabel = v.type === 'km' ? 'L/100km' : 'L/Std';
  document.getElementById('kpi-consumption').innerHTML = `${avgConsumption.toFixed(2)} <small>${unitLabel}</small>`;

  const fuelCosts = fuelList.reduce((sum, f) => sum + (f.totalPrice || 0), 0);
  const serviceCosts = serviceList.reduce((sum, s) => sum + (s.cost || 0), 0);
  const totalCosts = fuelCosts + serviceCosts;
  document.getElementById('kpi-total-cost').innerText = `${totalCosts.toFixed(2)} €`;

  const costPerKm = totalDist > 0 ? (fuelCosts / totalDist) * 100 : 0;
  document.getElementById('kpi-cost-per-km').innerText = `${costPerKm.toFixed(2)} €`;

  // KPI-Kacheln je nach Fahrzeugart ein-/ausblenden:
  // - Anhänger hat keinen eigenen Antrieb und keinen sinnvollen KM-Stand
  // - "Kosten/100km" passt nur bei Autos (bei Booten läuft's ja in Betriebsstunden)
  const kpiMileageCard = document.getElementById('kpiMileageCard');
  const kpiConsumptionCard = document.getElementById('kpiConsumptionCard');
  const kpiCostPerKmCard = document.getElementById('kpiCostPerKmCard');
  const hasEngine = vehicleHasEngine(v);
  const boatEnginesForDash = getBoatEngines(v);
  const multiEngineBoat = v.category === 'boot' && boatEnginesForDash.length > 1;
  // Bei Autos mit KM-Erfassung ersetzt die Tacho-Walzen-Anzeige die normale KPI-Kachel
  const useOdometer = (v.category || 'auto') === 'auto' && v.type !== 'hours';
  const showMileage = v.category !== 'anhaenger' && !multiEngineBoat && !useOdometer;
  const showCostPerKm = (v.category || 'auto') === 'auto';
  if (kpiMileageCard) kpiMileageCard.style.display = showMileage ? '' : 'none';
  if (kpiConsumptionCard) kpiConsumptionCard.style.display = hasEngine ? '' : 'none';
  if (kpiCostPerKmCard) kpiCostPerKmCard.style.display = showCostPerKm ? '' : 'none';

  const odometerWrapper = document.getElementById('odometerWrapper');
  if (odometerWrapper) {
    if (useOdometer) {
      odometerWrapper.style.display = '';
      const odoDigits = document.getElementById('odometerDigits');
      const paddedKm = Math.max(0, Math.round(maxMileage)).toString().padStart(6, '0').slice(-6);
      odoDigits.innerHTML = paddedKm.split('').map(d => `<span class="odometer-digit">${d}</span>`).join('');
    } else {
      odometerWrapper.style.display = 'none';
    }
  }

  // "Stand erfassen"-Button: bei Anhängern (kein sinnvoller Stand) ausblenden,
  // sonst Beschriftung passend zu KM/Betriebsstunden setzen
  const standEntryBtnWrapper = document.getElementById('standEntryBtnWrapper');
  const standEntryBtn = document.getElementById('standEntryBtn');
  if (standEntryBtnWrapper) standEntryBtnWrapper.style.display = (v.category === 'anhaenger') ? 'none' : '';
  if (standEntryBtn) standEntryBtn.innerText = v.type === 'hours' ? 'Betriebsstunden erfassen' : 'KM-Stand erfassen';

  // Fahrzeugschein-Kachel: nur bei Autos & Anhängern (straßenzugelassene Fahrzeuge)
  const fzscheinOpenCard = document.getElementById('fzscheinOpenCard');
  if (fzscheinOpenCard) fzscheinOpenCard.style.display = (v.category === 'boot') ? 'none' : '';

  // Bei Booten mit mehreren Motoren: eine eigene Betriebsstunden-Kachel pro Motor
  // statt nur einem gemeinsamen "Aktueller Stand"
  const engineHoursGrid = document.getElementById('engineHoursGrid');
  if (engineHoursGrid) {
    if (multiEngineBoat) {
      engineHoursGrid.innerHTML = boatEnginesForDash.map(engine => {
        const hours = getEngineCurrentHours(v, engine.id);
        return `
          <div class="kpi-card">
            <span class="kpi-label">${engine.name || 'Motor'}</span>
            <div class="kpi-value">${hours.toLocaleString('de-DE')} Std</div>
            <span class="kpi-sub">Betriebsstunden</span>
          </div>
        `;
      }).join('');
      engineHoursGrid.style.display = 'grid';
    } else {
      engineHoursGrid.innerHTML = '';
      engineHoursGrid.style.display = 'none';
    }
  }

  const reminderList = document.getElementById('reminderList');
  if (reminderList) {
    reminderList.innerHTML = '';

    const maintenanceReminders = getUpcomingMaintenanceReminders(v);

    maintenanceReminders.forEach(r => {
      const li = document.createElement('li');
      li.className = 'reminder-item' + (r.overdue ? ' reminder-overdue' : '');
      li.innerHTML = `<span class="reminder-title">${r.title}</span><span class="reminder-meta">${formatReminderMeta(r, v.type === 'hours' ? 'Std' : 'km')}</span>`;
      reminderList.appendChild(li);
    });

    // TÜV/HU ist für Boote nicht relevant
    const tuevRelevant = v.category !== 'boot';

    if (tuevRelevant && v.nextTuev) {
      const li = document.createElement('li');
      li.className = 'reminder-item';
      li.innerHTML = `<span class="reminder-title">Nächster TÜV / Inspektion</span><span class="reminder-meta">${formatTuevDate(v.nextTuev)}</span>`;
      reminderList.appendChild(li);
    }

    if (maintenanceReminders.length === 0 && (!tuevRelevant || !v.nextTuev)) {
      reminderList.innerHTML = '<li>Keine anstehenden Termine eingetragen.</li>';
    }
  }

  renderCharts(v);
}

function renderCharts(v) {
  if (typeof Chart === 'undefined') return;

  // Verbrauchsverlauf ergibt bei einem Anhänger (kein Motor, keine Betankung) keinen Sinn
  const hasEngineForCharts = vehicleHasEngine(v);
  const consumptionChartCard = document.getElementById('consumptionChartCard');
  if (consumptionChartCard) consumptionChartCard.style.display = hasEngineForCharts ? '' : 'none';

  const fuelList = v.fuelEntries || [];
  const serviceList = v.serviceEntries || [];

  // Voll-zu-Voll-Methode wie in der Tankliste: Teilbetankungen fließen in die
  // jeweils nächste Volltankung mit ein, statt ignoriert zu werden
  const sortedFuelForChart = [...fuelList].sort((a, b) => a.mileage - b.mileage);
  const labels = [];
  const dataPoints = [];
  let lastFullIdxChart = -1;

  for (let i = 0; i < sortedFuelForChart.length; i++) {
    const current = sortedFuelForChart[i];
    if (!current.full) continue;

    if (lastFullIdxChart !== -1) {
      const previousFull = sortedFuelForChart[lastFullIdxChart];
      const dist = current.mileage - previousFull.mileage;
      if (dist > 0) {
        let totalLitersChart = 0;
        for (let j = lastFullIdxChart + 1; j <= i; j++) {
          totalLitersChart += sortedFuelForChart[j].liters || 0;
        }
        const cons = (totalLitersChart / dist) * 100;
        labels.push(current.date);
        dataPoints.push(cons.toFixed(2));
      }
    }

    lastFullIdxChart = i;
  }

  const consCanvas = document.getElementById('consumptionChart');
  if (consCanvas && hasEngineForCharts) {
    const ctx1 = consCanvas.getContext('2d');
    if (consumptionChartInstance) consumptionChartInstance.destroy();

    const isDark = appData.theme === 'dark';
    const textColor = isDark ? '#f8fafc' : '#0f172a';
    const gridColor = isDark ? '#334155' : '#cbd5e1';

    consumptionChartInstance = new Chart(ctx1, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: v.type === 'km' ? 'Verbrauch (L/100km)' : 'Verbrauch (L/Std)',
          data: dataPoints,
          borderColor: '#2563eb',
          backgroundColor: 'rgba(37, 99, 235, 0.2)',
          fill: true,
          tension: 0.3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { color: textColor }, grid: { color: gridColor } },
          y: { ticks: { color: textColor }, grid: { color: gridColor } }
        },
        plugins: { legend: { labels: { color: textColor } } }
      }
    });
  } else if (consumptionChartInstance) {
    consumptionChartInstance.destroy();
    consumptionChartInstance = null;
  }

  const fuelTotal = fuelList.reduce((sum, f) => sum + (f.totalPrice || 0), 0);
  const serviceTotal = serviceList.filter(s => s.category === 'Wartung').reduce((sum, s) => sum + (s.cost || 0), 0);
  const repairTotal = serviceList.filter(s => s.category === 'Reparatur').reduce((sum, s) => sum + (s.cost || 0), 0);
  const tuevTotal = serviceList.filter(s => s.category === 'TÜV').reduce((sum, s) => sum + (s.cost || 0), 0);

  const costCanvas = document.getElementById('costPieChart');
  if (costCanvas) {
    const ctx2 = costCanvas.getContext('2d');
    if (costPieChartInstance) costPieChartInstance.destroy();

    const isDark = appData.theme === 'dark';
    const textColor = isDark ? '#f8fafc' : '#0f172a';

    const pieLabels = ['Wartung', 'Reparatur', 'TÜV'];
    const pieData = [serviceTotal, repairTotal, tuevTotal];
    const pieColors = ['#10b981', '#ef4444', '#f59e0b'];

    if (hasEngineForCharts) {
      pieLabels.unshift('Kraftstoff');
      pieData.unshift(fuelTotal);
      pieColors.unshift('#2563eb');
    }

    costPieChartInstance = new Chart(ctx2, {
      type: 'doughnut',
      data: {
        labels: pieLabels,
        datasets: [{
          data: pieData,
          backgroundColor: pieColors
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { color: textColor } } }
      }
    });
  }
}

let showAllHistoryEntries = false;

function renderHistoryTable() {
  const v = getActiveVehicle();
  const tbody = document.getElementById('fullHistoryTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const toggleContainer = document.getElementById('historyToggleBtnContainer');
  const toggleBtn = document.getElementById('historyToggleBtn');

  if (!v) {
    if (toggleContainer) toggleContainer.style.display = 'none';
    return;
  }

  const searchVal = (document.getElementById('historySearch')?.value || '').toLowerCase().trim();

  const fuelList = v.fuelEntries || [];
  const serviceList = v.serviceEntries || [];

  // 1. Alle Einträge zusammenführen
  let combined = [
    ...fuelList.map(f => ({
      id: f.id,
      sourceType: 'fuel',
      type: '⛽ Tanken',
      date: f.date,
      mileage: f.mileage || 0,
      desc: `${f.fuelType} (${f.liters}L @ ${(f.pricePerLiter || 0).toFixed(3)}€) ${f.notes || ''}`,
      amount: f.totalPrice || 0
    })),
    ...serviceList.map(s => ({
      id: s.id,
      sourceType: 'service',
      type: s.isStandEntry
        ? '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px; margin-right:3px;"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg> Standmeldung'
        : `🔧 ${s.category}`,
      date: s.date,
      mileage: s.mileage || 0,
      desc: `${s.title} - ${s.notes || ''}`,
      amount: s.cost || 0
    }))
  ];

  // 2. Suche anwenden
  if (searchVal) {
    combined = combined.filter(item => 
      item.desc.toLowerCase().includes(searchVal) || 
      item.type.toLowerCase().includes(searchVal)
    );
  }

  if (combined.length === 0) {
    if (toggleContainer) toggleContainer.style.display = 'none';
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;">Keine Einträge gefunden.</td></tr>`;
    return;
  }

  // 3. Nach Datum sortieren (neueste zuerst)
  combined.sort(compareByDateThenMileageDesc);

  // 4. Auf max. 5 Einträge begrenzen (sofern nicht ausgeklappt und keine Suche aktiv ist)
  const hasMoreThan5 = combined.length > 5;
  const entriesToRender = (hasMoreThan5 && !showAllHistoryEntries && !searchVal) 
    ? combined.slice(0, 5) 
    : combined;

  // 5. Tabelle befüllen
  entriesToRender.forEach(item => {
    const tr = document.createElement('tr');
    const editFn = item.sourceType === 'fuel' ? 'editFuelEntry' : 'editServiceEntry';
    const deleteFn = item.sourceType === 'fuel' ? 'deleteFuelEntry' : 'deleteServiceEntry';
    tr.innerHTML = `
      <td data-label="Typ">${item.type}</td>
      <td data-label="Datum">${item.date || '-'}</td>
      <td data-label="Stand">${item.mileage.toLocaleString()}</td>
      <td data-label="Beschreibung">${item.desc}</td>
      <td data-label="Betrag"><strong>${item.amount.toFixed(2)} €</strong></td>
      <td style="text-align: right; white-space: nowrap;">
        <button class="btn btn-secondary btn-sm" onclick="${editFn}('${item.id}')">${ICON_EDIT_SVG}</button>
        <button class="btn btn-danger btn-sm" onclick="${deleteFn}('${item.id}')">${ICON_DELETE_SVG}</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // 6. Button "Mehr anzeigen / Weniger anzeigen" steuern
  if (hasMoreThan5 && !searchVal && toggleContainer && toggleBtn) {
    toggleContainer.style.display = 'block';
    const remainingCount = combined.length - 5;
    toggleBtn.innerText = showAllHistoryEntries 
      ? 'Weniger anzeigen' 
      : `Mehr anzeigen (${remainingCount} weitere Einträge)`;
  } else if (toggleContainer) {
    toggleContainer.style.display = 'none';
  }
}

// Umschalt-Funktion & Global-Bindung
function toggleHistoryEntries() {
  showAllHistoryEntries = !showAllHistoryEntries;
  renderHistoryTable();
}

window.toggleHistoryEntries = toggleHistoryEntries;

/* --- KUNDEN SEKTION (KUNDENFAHRZEUGE & WERKSTATT) --- */
function renderCustomerSection() {
  renderCustomerVehicleSelect();
  const custV = getActiveCustomerVehicle();
  const contentDiv = document.getElementById('customerVehicleContent');

  if (!custV) {
    if (contentDiv) contentDiv.style.display = 'none';
    return;
  }

  if (contentDiv) contentDiv.style.display = 'block';
  document.getElementById('custBannerName').innerText = `${custV.owner} - ${custV.model}`;
  document.getElementById('custBannerPlate').innerText = custV.plate || 'OHNE-ID';
  document.getElementById('custBannerOwner').innerText = custV.owner;
  document.getElementById('custBannerContact').innerText = custV.contact || '-';
  document.getElementById('custBannerVin').innerText = custV.vin || '-';
  
  const hsnTsnEl = document.getElementById('custBannerHsnTsn');
  if (hsnTsnEl) {
    hsnTsnEl.innerText = `${custV.hsn || '-'}` + (custV.tsn ? ` / ${custV.tsn}` : '');
  }
  
  document.getElementById('custBannerFirstReg').innerText = custV.firstReg || '-';

  renderCustomerServiceTable();
}

function renderCustomerVehicleSelect() {
  const toggleLabel = document.getElementById('customerSelectToggleLabel');
  if (!toggleLabel) return;

  const active = getActiveCustomerVehicle();
  toggleLabel.innerText = active
    ? `${active.owner} (${active.model} - ${active.plate || 'Kein KZ'})`
    : '-- Kundenfahrzeug wählen --';

  renderCustomerVehicleList();
}

function toggleCustomerSelectPanel() {
  const group = document.querySelector('.customer-select-group');
  const panel = document.getElementById('customerSelectPanel');
  if (!group || !panel) return;

  const isOpen = !panel.classList.contains('hidden');
  if (isOpen) {
    panel.classList.add('hidden');
    group.classList.remove('open');
  } else {
    panel.classList.remove('hidden');
    group.classList.add('open');
    document.getElementById('customerSearchInput').value = '';
    renderCustomerVehicleList();
    document.getElementById('customerSearchInput').focus();
  }
}
window.toggleCustomerSelectPanel = toggleCustomerSelectPanel;

function renderCustomerVehicleList() {
  const list = document.getElementById('customerSelectList');
  if (!list) return;

  const searchInput = document.getElementById('customerSearchInput');
  const query = (searchInput ? searchInput.value : '').trim().toLowerCase();

  const filtered = appData.customerVehicles.filter(c => {
    if (!query) return true;
    const haystack = `${c.owner} ${c.model} ${c.plate || ''}`.toLowerCase();
    return haystack.includes(query);
  });

  if (filtered.length === 0) {
    list.innerHTML = '<div class="customer-select-empty">Keine Kundenfahrzeuge gefunden.</div>';
    return;
  }

  list.innerHTML = '';
  filtered.forEach(c => {
    const item = document.createElement('div');
    item.className = 'customer-select-list-item' + (c.id === appData.activeCustomerVehicleId ? ' active' : '');
    item.innerHTML = `
      <div class="cs-owner">${c.owner}</div>
      <div class="cs-meta">${c.model} - ${c.plate || 'Kein Kennzeichen'}</div>
    `;
    item.onclick = () => selectCustomerVehicleFromList(c.id);
    list.appendChild(item);
  });
}
window.renderCustomerVehicleList = renderCustomerVehicleList;

function selectCustomerVehicleFromList(id) {
  appData.activeCustomerVehicleId = id;
  saveData();
  renderCustomerSection();
  toggleCustomerSelectPanel();
}
window.selectCustomerVehicleFromList = selectCustomerVehicleFromList;

function openCustomerVehicleModal(isEdit = false) {
  const modal = document.getElementById('customerVehicleModal');
  const title = document.getElementById('custModalTitle');

  if (isEdit) {
    const c = getActiveCustomerVehicle();
    if (!c) return;
    if (title) title.innerText = "Kundenfahrzeug bearbeiten";
    document.getElementById('custModalEditId').value = c.id;
    document.getElementById('custModalOwner').value = c.owner;
    document.getElementById('custModalContact').value = c.contact || '';
    document.getElementById('custModalModel').value = c.model;
    document.getElementById('custModalPlate').value = c.plate || '';
    document.getElementById('custModalVin').value = c.vin || '';
    document.getElementById('custModalFirstReg').value = c.firstReg || '';
    
    const hsnInput = document.getElementById('custModalHsn');
    const tsnInput = document.getElementById('custModalTsn');
    if (hsnInput) hsnInput.value = c.hsn || '';
    if (tsnInput) tsnInput.value = c.tsn || '';
  } else {
    if (title) title.innerText = "Kundenfahrzeug anlegen";
    document.getElementById('custModalEditId').value = '';
    const form = document.querySelector('#customerVehicleModal form');
    if (form) form.reset();
  }

  if (modal) modal.classList.add('active');
}

function closeCustomerVehicleModal() {
  const modal = document.getElementById('customerVehicleModal');
  if (modal) modal.classList.remove('active');
}

function saveCustomerVehicleModal(e) {
  e.preventDefault();
  const editId = document.getElementById('custModalEditId').value;

  const hsnInput = document.getElementById('custModalHsn');
  const tsnInput = document.getElementById('custModalTsn');

  const data = {
    id: editId ? editId : "c_" + Date.now(),
    owner: document.getElementById('custModalOwner').value,
    contact: document.getElementById('custModalContact').value,
    model: document.getElementById('custModalModel').value,
    plate: document.getElementById('custModalPlate').value,
    vin: document.getElementById('custModalVin').value,
    firstReg: document.getElementById('custModalFirstReg').value,
    hsn: hsnInput ? hsnInput.value : '',
    tsn: tsnInput ? tsnInput.value : '',
    services: editId ? (getActiveCustomerVehicle()?.services || []) : []
  };

  if (editId) {
    const idx = appData.customerVehicles.findIndex(c => c.id === editId);
    if (idx !== -1) appData.customerVehicles[idx] = data;
  } else {
    appData.customerVehicles.push(data);
    appData.activeCustomerVehicleId = data.id;
  }

  saveData();
  closeCustomerVehicleModal();
  renderCustomerSection();
}

function deleteCurrentCustomerVehicle() {
  const c = getActiveCustomerVehicle();
  if (!c) return;
  if (!confirm(`Möchtest du das Kundenfahrzeug von ${c.owner} wirklich löschen?`)) return;

  appData.customerVehicles = appData.customerVehicles.filter(item => item.id !== c.id);
  appData.activeCustomerVehicleId = appData.customerVehicles.length > 0 ? appData.customerVehicles[0].id : null;

  saveData();
  renderCustomerSection();
}

/* Positionen-Kalkulator */
function addInvoiceItemRow(description = '', price = '') {
  const container = document.getElementById('invoiceItemsContainer');
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'invoice-item-row';
  row.innerHTML = `
    <input type="text" placeholder="Beschreibung / Teilenummer" value="${description}" oninput="calcCustomerTotalCost()">
    <input type="number" step="0.01" placeholder="Preis (€)" value="${price}" oninput="calcCustomerTotalCost()">
    <button type="button" class="btn btn-danger btn-sm" onclick="this.parentElement.remove(); calcCustomerTotalCost();">✕</button>
  `;
  container.appendChild(row);
}

function calcCustomerTotalCost() {
  const rows = document.querySelectorAll('#invoiceItemsContainer .invoice-item-row');
  let total = 0;
  rows.forEach(r => {
    const inputs = r.querySelectorAll('input');
    const price = parseFloat(inputs[1].value) || 0;
    total += price;
  });
  if (total > 0) {
    document.getElementById('custServiceTotalCost').value = total.toFixed(2);
  }
}

function handleCustomerServiceImageUpload(event) {
  const files = Array.from(event.target.files);
  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = async function(e) {
      const compressed = await compressImage(e.target.result);
      tempCustomerServiceImages.push(compressed);
      renderCustomerServiceImagePreviews();
    };
    reader.readAsDataURL(file);
  });
}
function renderCustomerServiceImagePreviews() {
  const container = document.getElementById('custServiceImagePreviewContainer');
  if (!container) return;
  container.innerHTML = '';
  tempCustomerServiceImages.forEach((imgSrc, index) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'preview-thumb-wrapper';
    wrapper.innerHTML = `
      <img src="${imgSrc}" class="preview-thumb">
      <button type="button" class="btn-remove-thumb" onclick="removeTempCustomerServiceImage(${index})">✕</button>
    `;
    container.appendChild(wrapper);
  });
}

function removeTempCustomerServiceImage(index) {
  tempCustomerServiceImages.splice(index, 1);
  renderCustomerServiceImagePreviews();
}

function saveCustomerServiceEntry(e) {
  e.preventDefault();
  const c = getActiveCustomerVehicle();
  if (!c) return;

  const editId = document.getElementById('custServiceEditId').value;

  const items = [];
  document.querySelectorAll('#invoiceItemsContainer .invoice-item-row').forEach(row => {
    const inputs = row.querySelectorAll('input');
    const desc = inputs[0].value;
    const val = parseFloat(inputs[1].value) || 0;
    if (desc || val > 0) {
      items.push({ desc: desc, price: val });
    }
  });

  const entry = {
    id: editId ? editId : "cs_" + Date.now(),
    title: document.getElementById('custServiceTitle').value,
    date: document.getElementById('custServiceDate').value,
    mileage: parseFloat(document.getElementById('custServiceMileage').value) || 0,
    totalCost: parseFloat(document.getElementById('custServiceTotalCost').value) || 0,
    items: items,
    notes: document.getElementById('custServiceNotes').value,
    images: [...tempCustomerServiceImages]
  };

  if (!c.services) c.services = [];

  if (editId) {
    const idx = c.services.findIndex(cs => cs.id === editId);
    if (idx !== -1) c.services[idx] = entry;
  } else {
    c.services.push(entry);
  }

  c.services.sort(compareByDateThenMileageDesc);

  saveData();
  resetCustomerServiceForm();
  renderCustomerServiceTable();
}

function resetCustomerServiceForm() {
  document.getElementById('custServiceEditId').value = '';
  document.getElementById('custServiceForm').reset();
  document.getElementById('custServiceDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('invoiceItemsContainer').innerHTML = '';
  tempCustomerServiceImages = [];
  renderCustomerServiceImagePreviews();
  document.getElementById('custServiceSubmitBtn').innerText = "Auftrag Speichern";
  document.getElementById('custServiceCancelBtn').style.display = "none";
}

// Globaler Status für die Kunden-Service-Tabelle (ganz oben in app.js oder vor der Funktion)
let showAllCustomerServiceEntries = false;

function renderCustomerServiceTable() {
  const c = getActiveCustomerVehicle();
  const tbody = document.getElementById('custServiceTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const toggleContainer = document.getElementById('custServiceToggleBtnContainer');
  const toggleBtn = document.getElementById('custServiceToggleBtn');

  if (!c || !c.services || c.services.length === 0) {
    if (toggleContainer) toggleContainer.style.display = 'none';
    return;
  }

  // 1. Nach Datum sortieren (neueste Einträge zuerst)
  const sortedServices = [...c.services].sort(compareByDateThenMileageDesc);

  // 2. Auf max. 5 Einträge begrenzen (falls nicht ausgeklappt)
  const hasMoreThan5 = sortedServices.length > 5;
  const entriesToRender = (hasMoreThan5 && !showAllCustomerServiceEntries) 
    ? sortedServices.slice(0, 5) 
    : sortedServices;

  // 3. Tabelle befüllen
  entriesToRender.forEach(cs => {
    const tr = document.createElement('tr');
    tr.className = 'clickable-row';
    tr.onclick = (e) => {
      if (e.target.tagName !== 'BUTTON') openCustomerServiceDetailModal(cs.id);
    };

    const mileageVal = typeof cs.mileage === 'number' ? cs.mileage.toLocaleString() + ' km' : '-';
    const totalCostVal = typeof cs.totalCost === 'number' ? cs.totalCost.toFixed(2) + ' €' : '-';

    tr.innerHTML = `
      <td data-label="Datum">${cs.date || '-'}</td>
      <td data-label="Titel"><strong>${cs.title || 'Auftrag'}</strong></td>
      <td data-label="KM-Stand">${mileageVal}</td>
      <td data-label="Gesamt">${totalCostVal}</td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="editCustomerServiceEntry('${cs.id}')">${ICON_EDIT_SVG}</button>
        <button class="btn btn-primary btn-sm" onclick="printInvoice('${cs.id}')">🖨️ Drucken</button>
        <button class="btn btn-danger btn-sm" onclick="deleteCustomerServiceEntry('${cs.id}')">${ICON_DELETE_SVG}</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // 4. Button "Mehr anzeigen / Weniger anzeigen" steuern
  if (hasMoreThan5 && toggleContainer && toggleBtn) {
    toggleContainer.style.display = 'block';
    const remainingCount = sortedServices.length - 5;
    toggleBtn.innerText = showAllCustomerServiceEntries 
      ? 'Weniger anzeigen' 
      : `Mehr anzeigen (${remainingCount} weitere Einträge)`;
  } else if (toggleContainer) {
    toggleContainer.style.display = 'none';
  }
}

// Umschalt-Funktion & Global-Bindung für HTML
function toggleCustomerServiceEntries() {
  showAllCustomerServiceEntries = !showAllCustomerServiceEntries;
  renderCustomerServiceTable();
}

window.toggleCustomerServiceEntries = toggleCustomerServiceEntries;

function editCustomerServiceEntry(id) {
  const c = getActiveCustomerVehicle();
  if (!c || !c.services) return;

  const cs = c.services.find(item => item.id === id);
  if (!cs) return;

  document.getElementById('custServiceEditId').value = cs.id;
  document.getElementById('custServiceTitle').value = cs.title;
  document.getElementById('custServiceDate').value = cs.date;
  document.getElementById('custServiceMileage').value = cs.mileage;
  document.getElementById('custServiceTotalCost').value = cs.totalCost;
  document.getElementById('custServiceNotes').value = cs.notes || '';

  const container = document.getElementById('invoiceItemsContainer');
  if (container) {
    container.innerHTML = '';
    if (cs.items && cs.items.length > 0) {
      cs.items.forEach(it => addInvoiceItemRow(it.desc, it.price));
    }
  }

  tempCustomerServiceImages = cs.images ? [...cs.images] : [];
  renderCustomerServiceImagePreviews();

  document.getElementById('custServiceSubmitBtn').innerText = "Änderungen Speichern";
  document.getElementById('custServiceCancelBtn').style.display = "inline-block";
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function deleteCustomerServiceEntry(id) {
  if (!confirm("Diesen Auftrags-Eintrag wirklich löschen?")) return;
  const c = getActiveCustomerVehicle();
  if (!c || !c.services) return;

  c.services = c.services.filter(item => item.id !== id);
  saveData();
  renderCustomerServiceTable();
}

function openCustomerServiceDetailModal(id) {
  const c = getActiveCustomerVehicle();
  if (!c || !c.services) return;

  const cs = c.services.find(item => item.id === id);
  if (!cs) return;

  document.getElementById('csdTitle').innerText = cs.title;
  document.getElementById('csdDate').innerText = cs.date;
  document.getElementById('csdMileage').innerText = `${cs.mileage.toLocaleString()} km`;
  document.getElementById('csdTotalCost').innerText = `${cs.totalCost.toFixed(2)} €`;
  document.getElementById('csdNotes').innerText = cs.notes || 'Keine Notizen vorhanden.';

  const container = document.getElementById('csdImagesContainer');
  if (container) {
    container.innerHTML = '';
    if (cs.images && cs.images.length > 0) {
      cs.images.forEach(img => {
        const wrapper = document.createElement('div');
        wrapper.className = 'gallery-img-wrapper';
        wrapper.innerHTML = `<img src="${img}" onclick="window.open('${img}')">`;
        container.appendChild(wrapper);
      });
    } else {
      container.innerHTML = '<span class="text-muted">Keine Bilder vorhanden.</span>';
    }
  }

  document.getElementById('csdEditBtn').onclick = () => {
    closeCustomerServiceDetailModal();
    editCustomerServiceEntry(cs.id);
  };

  document.getElementById('customerServiceDetailModal').classList.add('active');
}

function closeCustomerServiceDetailModal() {
  const modal = document.getElementById('customerServiceDetailModal');
  if (modal) modal.classList.remove('active');
}

/* Druck / PDF Generierung (Startet direkt von oben, Rebranding SGS, OHNE Belegnummer) */
// Werkstatt-Logo (SGS) fuer den Ausdruck der Kundenrechnung (dunkle Linien, fuer weisses Papier)
const SGS_LOGO_BLACK_B64 = "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";

function printInvoice(serviceId) {
  const c = getActiveCustomerVehicle();
  if (!c || !c.services) return;
  const cs = c.services.find(item => item.id === serviceId);
  if (!cs) return;

  const printContainer = document.getElementById('printableInvoice');
  if (!printContainer) return;

  let itemsHtml = '';
  if (cs.items && cs.items.length > 0) {
    cs.items.forEach(it => {
      itemsHtml += `
        <tr>
          <td>${it.desc}</td>
          <td style="text-align: right;">${it.price ? parseFloat(it.price).toFixed(2) + ' €' : '-'}</td>
        </tr>
      `;
    });
  } else {
    itemsHtml = `<tr><td>Pauschale Durchführung / Arbeitswert</td><td style="text-align: right;">${cs.totalCost.toFixed(2)} €</td></tr>`;
  }

  let imagesHtml = '';
  if (cs.images && cs.images.length > 0) {
    imagesHtml = `
      <div class="invoice-images">
        <h4>Fotodokumentation:</h4>
        <div class="invoice-image-grid">
          ${cs.images.map(img => `<img src="${img}">`).join('')}
        </div>
      </div>
    `;
  }

  const biz = appData.businessInfo || getDefaultBusinessInfo();

      printContainer.innerHTML = `
    <!-- DRUCK-STYLES (MOBIL-OPTIMIERT, STRIKT 1 SEITE, FUSSZEILE UNTEN FIXIERT) -->
    <style>
      @media print {
        @page {
          size: A4 portrait;
          margin: 6mm 8mm; /* Sehr schmaler oberer/unterer Rand */
        }
        html, body {
          height: auto !important;
          margin: 0 !important;
          padding: 0 !important;
          background: #fff !important;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        /* Der äußere Druck-Container bekommt sonst 15mm Padding aus style.css
           (.print-only) - das würde unsere Höhenrechnung sprengen, daher hier
           für diesen Druck auf 0 gesetzt. */
        #printableInvoice.print-only {
          padding: 0 !important;
        }
        .invoice-box {
          position: relative !important;
          height: 283mm !important; /* Druckbare A4-Höhe (297mm - 2x6mm Seitenrand, mit Puffer) */
          min-height: 0 !important;
          max-height: none !important;
          display: block !important; /* Kein Flexbox im Druck, um Mobile-Bugs zu vermeiden */
          padding: 0 0 62px 0 !important; /* Platz für die fixierte Fußzeile freihalten */
          margin: 0 !important;
          box-sizing: border-box !important;
          page-break-inside: avoid !important;
          break-inside: avoid !important;
        }
        .invoice-footer {
          position: absolute !important;
          left: 0 !important;
          right: 0 !important;
          bottom: 0 !important;
          margin-top: 0 !important;
          page-break-inside: avoid !important;
          break-inside: avoid !important;
        }
      }
    </style>

    <div class="invoice-box" style="
      max-width: 800px;
      margin: 0 auto;
      padding: 4px 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #111827;
      background: #ffffff;
      line-height: 1.2;
      box-sizing: border-box;
    ">
      <!-- INHALT -->
      <div class="invoice-content">
        <!-- HEADER -->
        <div class="invoice-header" style="
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          border-bottom: 2px solid #111827;
          padding-bottom: 4px;
          margin-bottom: 8px;
        ">
          <div style="display: flex; align-items: center; gap: 8px;">
            <img src="data:image/png;base64,${SGS_LOGO_BLACK_B64}" style="width: 32px; height: 32px; flex-shrink: 0;">
            <div>
              <div class="invoice-title" style="
                font-size: 17px;
                font-weight: 700;
                color: #111827;
                letter-spacing: -0.3px;
                text-transform: uppercase;
              ">${biz.name}</div>
              <div class="invoice-subtitle" style="
                font-size: 9.5px;
                color: #4b5563;
                margin-top: 1px;
              ">${biz.subtitle}</div>
            </div>
          </div>
          <div style="text-align: right; font-size: 10.5px; color: #111827;">
            <strong>Datum:</strong> ${cs.date}
          </div>
        </div>

        <!-- KUNDEN & FAHRZEUG DETAILS -->
        <div class="invoice-details-grid" style="
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px;
          background-color: #f9fafb;
          border: 1px solid #d1d5db;
          border-radius: 4px;
          padding: 5px 8px;
          margin-bottom: 8px;
          font-size: 9.5px;
        ">
          <div>
            <div style="
              font-size: 7.5px;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              color: #4b5563;
              font-weight: 700;
              margin-bottom: 1px;
            ">Kunde / Halter</div>
            <strong style="font-size: 10.5px; color: #111827;">${c.owner}</strong><br>
            <span style="color: #374151;">${c.contact || ''}</span>
          </div>
          <div>
            <div style="
              font-size: 7.5px;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              color: #4b5563;
              font-weight: 700;
              margin-bottom: 1px;
            ">Fahrzeug-Daten</div>
            <table style="width: 100%; font-size: 9px; border-collapse: collapse;">
              <tr>
                <td style="color: #4b5563; padding: 0;">Modell:</td>
                <td style="text-align: right; font-weight: 600; color: #111827;">${c.model}</td>
              </tr>
              <tr>
                <td style="color: #4b5563; padding: 0;">Kennzeichen:</td>
                <td style="text-align: right; font-weight: 600; color: #111827;">${c.plate || '-'}</td>
              </tr>
              <tr>
                <td style="color: #4b5563; padding: 0;">FIN:</td>
                <td style="text-align: right; font-weight: 500; font-family: monospace; color: #111827;">${c.vin || '-'}</td>
              </tr>
              <tr>
                <td style="color: #4b5563; padding: 0;">HSN / TSN:</td>
                <td style="text-align: right; font-weight: 500; color: #111827;">${c.hsn || '-'}${c.tsn ? ' / ' + c.tsn : ''}</td>
              </tr>
              <tr>
                <td style="color: #4b5563; padding: 0;">KM-Stand:</td>
                <td style="text-align: right; font-weight: 600; color: #111827;">${cs.mileage.toLocaleString('de-DE')} km</td>
              </tr>
            </table>
          </div>
        </div>

        <!-- TITEL / AUFTRAG -->
        <h3 style="
          font-size: 11.5px;
          font-weight: 700;
          color: #111827;
          margin: 0 0 5px 0;
          padding-bottom: 2px;
          border-bottom: 1px solid #e5e7eb;
          text-transform: uppercase;
          letter-spacing: 0.3px;
        ">${cs.title}</h3>

        <!-- LEISTUNGSTABELLE -->
        <table class="invoice-table" style="
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 6px;
          font-size: 10px;
        ">
          <thead>
            <tr style="background-color: #f3f4f6; color: #111827; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #d1d5db;">
              <th style="padding: 3px 5px; text-align: left;">Position / Beschreibung</th>
              <th style="padding: 3px 5px; text-align: right;">Betrag</th>
            </tr>
          </thead>
          <tbody style="color: #1f2937;">
            ${itemsHtml}
          </tbody>
        </table>

        <!-- GESAMTSUMME -->
        <div class="invoice-total" style="
          display: flex;
          justify-content: flex-end;
          align-items: center;
          background-color: #111827;
          color: #ffffff;
          padding: 4px 6px;
          border-radius: 3px;
          font-size: 12px;
          font-weight: 700;
          margin-top: 5px;
          margin-bottom: 6px;
        ">
          <span style="margin-right: 6px; font-weight: 400; font-size: 9.5px; opacity: 0.9;">Gesamtsumme:</span>
          <span>${cs.totalCost.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</span>
        </div>

        <!-- ARBEITSBERICHT & ANMERKUNGEN -->
        ${cs.notes ? `
          <div class="invoice-notes" style="
            background-color: #f9fafb;
            border: 1px solid #d1d5db;
            border-left: 3px solid #111827;
            border-radius: 3px;
            padding: 4px 6px;
            margin-bottom: 6px;
            font-size: 9.5px;
            color: #1f2937;
          ">
            <strong style="display: block; margin-bottom: 1px; color: #111827; font-size: 8.5px; text-transform: uppercase;">Arbeitsbericht / Anmerkungen:</strong>
            <span style="white-space: pre-line;">${cs.notes}</span>
          </div>
        ` : ''}

        <!-- BILDER / DOKUMENTATION -->
        ${imagesHtml ? `
          <div style="margin-top: 5px; margin-bottom: 5px; page-break-inside: avoid;">
            <strong style="display: block; font-size: 8.5px; color: #111827; margin-bottom: 2px; text-transform: uppercase;">Fotodokumentation:</strong>
            ${imagesHtml}
          </div>
        ` : ''}
      </div>

      <!-- FUSSZEILE (im Druck fest am unteren Seitenrand fixiert) -->
      <div class="invoice-footer" style="
        padding-top: 4px;
        border-top: 1px solid #d1d5db;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
        font-size: 8px;
        color: #4b5563;
        margin-top: 10px;
      ">
        <div>
          <strong style="color: #111827; font-size: 8.5px;">Bankverbindung (Überweisung)</strong><br>
          Empfänger: ${biz.name}<br>
          IBAN: ${biz.iban}<br>
          BIC: ${biz.bic} | Bank: ${biz.bank}
        </div>
        <div>
          <strong style="color: #111827; font-size: 8.5px;">PayPal / Alternative</strong><br>
          PayPal-Me: ${biz.paypalMe}<br>
          E-Mail: ${biz.paypalEmail}<br>
          Verwendungszweck: ${c.plate || c.owner} - ${cs.date}
        </div>
      </div>
    </div>
  `;

  window.print();
}




/* --- EXPORT & IMPORT (BACKUP) --- */
function exportData() {
  appData.lastBackupDate = new Date().toISOString();
  saveData();
  updateLastBackupInfo();

  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(appData, null, 2));
  const dlAnchorElem = document.createElement('a');
  dlAnchorElem.setAttribute("href", dataStr);
  dlAnchorElem.setAttribute("download", `sgs_backup_${new Date().toISOString().split('T')[0]}.json`);
  document.body.appendChild(dlAnchorElem);
  dlAnchorElem.click();
  dlAnchorElem.remove();
}

function importData(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (!confirm("Achtung: Beim Import werden ALLE aktuellen Daten (Fahrzeuge, Kunden, Einstellungen) auf diesem Gerät unwiderruflich durch die Backup-Datei ersetzt. Fortfahren?")) {
    event.target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const parsed = JSON.parse(e.target.result);
      if (parsed && parsed.vehicles) {
        appData = parsed;
        if (!appData.businessInfo) appData.businessInfo = getDefaultBusinessInfo();
        if (!appData.customerVehicles) appData.customerVehicles = [];
        saveData();
        initApp();
        closeSettingsModal();
        alert("Daten erfolgreich wiederhergestellt!");
      } else {
        alert("Ungültiges Backup-Format.");
      }
    } catch (err) {
      alert("Fehler beim Lesen der Backup-Datei: " + err.message);
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

/* --- EINSTELLUNGEN-MENÜ --- */
function updateLastBackupInfo() {
  const el = document.getElementById('lastBackupInfo');
  if (!el) return;
  el.innerText = appData.lastBackupDate
    ? new Date(appData.lastBackupDate).toLocaleString('de-DE')
    : 'noch nie';
}

function openSettingsModal() {
  const info = appData.businessInfo || getDefaultBusinessInfo();
  document.getElementById('bizName').value = info.name || '';
  document.getElementById('bizSubtitle').value = info.subtitle || '';
  document.getElementById('bizIban').value = info.iban || '';
  document.getElementById('bizBic').value = info.bic || '';
  document.getElementById('bizBank').value = info.bank || '';
  document.getElementById('bizPaypalMe').value = info.paypalMe || '';
  document.getElementById('bizPaypalEmail').value = info.paypalEmail || '';

  updateLastBackupInfo();
  applyTheme(appData.theme || 'dark');
  applyBackgroundStyle(appData.backgroundStyle || 'concrete');
  applyAccentColor(appData.accentColor || 'amber');
  applyUiStyle(appData.uiStyle || 'standard');
  applyCustomerVehiclesVisibility();

  document.getElementById('settingsModal').classList.add('active');
}
window.openSettingsModal = openSettingsModal;

function closeSettingsModal() {
  document.getElementById('settingsModal').classList.remove('active');
}
window.closeSettingsModal = closeSettingsModal;

function saveBusinessInfo(e) {
  e.preventDefault();
  appData.businessInfo = {
    name: document.getElementById('bizName').value,
    subtitle: document.getElementById('bizSubtitle').value,
    iban: document.getElementById('bizIban').value,
    bic: document.getElementById('bizBic').value,
    bank: document.getElementById('bizBank').value,
    paypalMe: document.getElementById('bizPaypalMe').value,
    paypalEmail: document.getElementById('bizPaypalEmail').value
  };
  saveData();
  alert("Rechnungsdaten gespeichert.");
}
window.saveBusinessInfo = saveBusinessInfo;

function resetAllData() {
  if (!confirm("ACHTUNG: Damit werden ALLE Fahrzeuge, Kunden und Einstellungen auf diesem Gerät unwiderruflich gelöscht. Dies kann nicht rückgängig gemacht werden. Fortfahren?")) {
    return;
  }
  if (!confirm("Letzte Sicherheitsabfrage: Wirklich ALLE Daten endgültig löschen?")) {
    return;
  }
  localStorage.removeItem('sgs_data');
  localStorage.removeItem('fleethub_data');
  sgsIdbDelete('sgs_data').finally(() => location.reload());
}
window.resetAllData = resetAllData;
/* --- BILDER AUTOMATISCH KOMPRIMIEREN (MAX 800PX / JPEG 70%) --- */
function compressImage(base64Str, maxWidth = 800, maxHeight = 800, quality = 0.7) {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
  });
}
function printSaleReport() {
  const v = getActiveVehicle();
  const printContainer = document.getElementById('printableInvoice');

  if (!v) {
    alert("Kein aktives Fahrzeug ausgewählt.");
    return;
  }
  if (!printContainer) {
    alert("Fehler: Druck-Container ('printableInvoice') wurde im HTML nicht gefunden.");
    return;
  }

  const category = v.category || 'auto';
  const fuelList = v.fuelEntries || [];
  const serviceList = v.serviceEntries || [];
  const sortedServices = [...serviceList].sort(compareByDateThenMileageDesc);

  // Dezente, professionelle Farbcodierung je Kategorie (helle Pastelltöne)
  function getCategoryStyle(cat) {
    switch (cat) {
      case 'Wartung': return { bg: '#eaf7ef', color: '#1e7e42' };
      case 'Reparatur': return { bg: '#fdf3e3', color: '#92400e' };
      case 'TÜV': return { bg: '#e8f0fe', color: '#1d4ed8' };
      default: return { bg: '#f1f1f1', color: '#52525b' };
    }
  }

  // Historie-Zeilen inkl. Kosten & dezentem Kategorie-Badge
  let historyRowsHTML = "";
  let totalMaintenanceCost = 0;

  if (sortedServices.length > 0) {
    historyRowsHTML = sortedServices.map(s => {
      const dateStr = s.date ? new Date(s.date).toLocaleDateString('de-DE') : '-';
      const mileageStr = s.mileage ? `${s.mileage.toLocaleString('de-DE')} km` : '-';
      const performerStr = s.performer ? `<small>(${s.performer})</small>` : '';
      const notesStr = s.notes ? `<div style="font-size: 0.85rem; color: #555; margin-top: 4px;">${s.notes.replace(/\n/g, '<br>')}</div>` : '';
      const costVal = typeof s.cost === 'number' ? s.cost : 0;
      totalMaintenanceCost += costVal;
      const costStr = costVal > 0 ? `${costVal.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €` : '-';
      const catStyle = getCategoryStyle(s.category);

      return `
        <tr style="border-bottom: 1px solid #ddd;">
          <td style="padding: 8px; vertical-align: top;">${dateStr}</td>
          <td style="padding: 8px; vertical-align: top;">${mileageStr}</td>
          <td style="padding: 8px; vertical-align: top;">
            <strong>${s.title || 'Wartung / Reparatur'}</strong> ${performerStr}
            ${notesStr}
          </td>
          <td style="padding: 8px; vertical-align: top;">
            <span style="display:inline-block; padding:2px 8px; border-radius:10px; font-size:0.78rem; font-weight:600; background:${catStyle.bg}; color:${catStyle.color};">${s.category || 'Wartung'}</span>
          </td>
          <td style="padding: 8px; vertical-align: top; text-align: right;">${costStr}</td>
        </tr>
      `;
    }).join('');
  } else {
    historyRowsHTML = `<tr><td colspan="5" style="padding: 12px; text-align: center; color: #777;">Keine dokumentierten Wartungseinträge vorhanden.</td></tr>`;
  }

  // Kennzahlen: KM-Stand, Verbrauch, Investitionssumme, Dokumentationszeitraum
  const currentMileage = getVehicleCurrentMileage(v);
  const mileageUnit = v.type === 'hours' ? 'Std' : 'km';
  const currentMileageStr = `${currentMileage.toLocaleString('de-DE')} ${mileageUnit}`;

  // Voll-zu-Voll-Methode: Teilbetankungen fließen mit ein statt ignoriert zu werden
  const sortedFuelForReport = [...fuelList].sort((a, b) => a.mileage - b.mileage);
  const fullTankings = sortedFuelForReport.filter(f => f.full);
  let avgConsumption = 0;
  if (fullTankings.length >= 2) {
    const firstFull = fullTankings[0];
    const lastFull = fullTankings[fullTankings.length - 1];
    const totalDist = lastFull.mileage - firstFull.mileage;
    const totalLiters = sortedFuelForReport
      .filter(f => f.mileage > firstFull.mileage && f.mileage <= lastFull.mileage)
      .reduce((sum, f) => sum + (f.liters || 0), 0);
    avgConsumption = totalDist > 0 ? (totalLiters / totalDist) * 100 : 0;
  }
  const consumptionUnit = v.type === 'hours' ? 'L/Std' : 'L/100km';
  const hasEngine = vehicleHasEngine(v);
  const boatEngines = getBoatEngines(v);

  let documentedSinceStr = '-';
  if (sortedServices.length > 0) {
    const oldestYear = new Date(sortedServices[sortedServices.length - 1].date).getFullYear();
    documentedSinceStr = `seit ${oldestYear}`;
  }

  const firstRegStr = v.firstReg ? new Date(v.firstReg).toLocaleDateString('de-DE') : '-';
  const hsnTsnStr = (v.hsn || v.tsn) ? `${v.hsn || '-'} / ${v.tsn || '-'}` : '-';
  const imageHtml = v.image
    ? `<img src="${v.image}" style="width: 100%; height: 260px; object-fit: cover; border-radius: 8px; margin-bottom: 20px; cursor: zoom-in;" onclick="openImageZoomView(this.src)">`
    : '';

  // Fahrzeugdaten-Zeilen: je nach Fahrzeugart werden nicht passende Angaben weggelassen
  const dataRows = [
    `<div><strong>Erstzulassung:</strong> ${firstRegStr}</div>`
  ];
  if (category !== 'anhaenger') {
    dataRows.push(`<div><strong>Aktueller Stand:</strong> ${currentMileageStr}</div>`);
  }
  if (category === 'boot') {
    dataRows.push(`<div><strong>Rumpfnummer (HIN):</strong> ${v.hullNumber || '-'}</div>`);
    if (boatEngines.length > 0) {
      const engineListStr = boatEngines.map(e => e.name + (e.number ? ' (Nr. ' + e.number + ')' : '')).join(', ');
      dataRows.push(`<div><strong>Motor(en):</strong> ${engineListStr}</div>`);
    }
  } else {
    dataRows.push(`<div><strong>FIN / VIN:</strong> ${v.vin || '-'}</div>`);
  }
  if (category !== 'boot') {
    dataRows.push(`<div><strong>HSN / TSN:</strong> ${hsnTsnStr}</div>`);
  }
  if (hasEngine) {
    dataRows.push(`<div><strong>Kraftstoffart:</strong> ${v.fuelType || '-'}</div>`);
  }
  if (category !== 'boot') {
    dataRows.push(`<div><strong>Nächster TÜV / HU:</strong> ${v.nextTuev || '-'}</div>`);
  }
  if (category === 'auto') {
    dataRows.push(`<div><strong>Leistung:</strong> ${v.powerHp ? v.powerHp + ' PS' : '-'}</div>`);
  }
  if (category === 'anhaenger') {
    dataRows.push(`<div><strong>Zulässiges Gesamtgewicht:</strong> ${v.towingBraked ? v.towingBraked + ' kg' : '-'}</div>`);
  } else if (category === 'auto') {
    dataRows.push(`<div><strong>Anhängelast (gebremst):</strong> ${v.towingBraked ? v.towingBraked + ' kg' : '-'}</div>`);
  }

  // Kennzahlen-Kacheln: Verbrauch nur bei Fahrzeugen mit eigenem Antrieb
  const kpiCells = [];
  if (category !== 'anhaenger') {
    kpiCells.push(`<div style="background: #f9f9f9; border: 1px solid #e0e0e0; border-radius: 6px; padding: 10px; text-align: center;">
      <div style="font-size: 0.7rem; color: #777; text-transform: uppercase; margin-bottom: 4px;">Aktueller Stand</div>
      <div style="font-size: 1.05rem; font-weight: 700;">${currentMileageStr}</div>
    </div>`);
  }
  if (hasEngine) {
    kpiCells.push(`<div style="background: #f9f9f9; border: 1px solid #e0e0e0; border-radius: 6px; padding: 10px; text-align: center;">
      <div style="font-size: 0.7rem; color: #777; text-transform: uppercase; margin-bottom: 4px;">Ø Verbrauch</div>
      <div style="font-size: 1.05rem; font-weight: 700;">${avgConsumption > 0 ? avgConsumption.toFixed(2) + ' ' + consumptionUnit : '-'}</div>
    </div>`);
  }
  kpiCells.push(`<div style="background: #f9f9f9; border: 1px solid #e0e0e0; border-radius: 6px; padding: 10px; text-align: center;">
    <div style="font-size: 0.7rem; color: #777; text-transform: uppercase; margin-bottom: 4px;">Investiert in Pflege</div>
    <div style="font-size: 1.05rem; font-weight: 700;">${totalMaintenanceCost.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</div>
  </div>`);
  kpiCells.push(`<div style="background: #f9f9f9; border: 1px solid #e0e0e0; border-radius: 6px; padding: 10px; text-align: center;">
    <div style="font-size: 0.7rem; color: #777; text-transform: uppercase; margin-bottom: 4px;">Dokumentiert</div>
    <div style="font-size: 1.05rem; font-weight: 700;">${sortedServices.length} Einträge<br><span style="font-size:0.8rem; font-weight:400; color:#666;">${documentedSinceStr}</span></div>
  </div>`);

  // Druck-Layout zusammenbauen
  printContainer.innerHTML = `
    <div style="padding: 20px; font-family: Arial, sans-serif; color: #222; max-width: 800px; margin: 0 auto;">

      <!-- Kopfzeile -->
      <div style="border-bottom: 2px solid #222; padding-bottom: 15px; margin-bottom: 20px;">
        <h1 style="margin: 0; font-size: 1.8rem; text-transform: uppercase;">Fahrzeug-Verkaufsdossier</h1>
        <p style="margin: 5px 0 0 0; color: #666; font-size: 0.9rem;">Lückenlose Wartungs- & Historienübersicht</p>
        <h2 style="margin: 10px 0 0 0; font-size: 1.4rem; color: #0056b3;">${v.name || 'Fahrzeug'}</h2>
      </div>

      <!-- Fahrzeugfoto -->
      ${imageHtml}

      <!-- Eyecatcher-Kennzahlen -->
      <div style="display: grid; grid-template-columns: repeat(${kpiCells.length}, 1fr); gap: 10px; margin-bottom: 25px;">
        ${kpiCells.join('')}
      </div>

      <!-- Stammdaten Raster -->
      <div style="background: #f9f9f9; border: 1px solid #e0e0e0; border-radius: 6px; padding: 15px; margin-bottom: 25px;">
        <h3 style="margin-top: 0; margin-bottom: 12px; font-size: 1.1rem; border-bottom: 1px solid #ddd; padding-bottom: 5px;">Fahrzeugdaten</h3>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; font-size: 0.95rem;">
          ${dataRows.join('')}
        </div>
      </div>

      <!-- Spezifikationen (falls vorhanden) -->
      ${v.specs ? `
      <div style="margin-bottom: 25px;">
        <h3 style="margin-top: 0; margin-bottom: 8px; font-size: 1.1rem; border-bottom: 1px solid #ddd; padding-bottom: 5px;">Spezifikationen & Ausstattung</h3>
        <p style="white-space: pre-wrap; margin: 0; font-size: 0.9rem; line-height: 1.4; color: #333;">${v.specs}</p>
      </div>
      ` : ''}

      <!-- Wartungshistorie Tabelle -->
      <div style="margin-bottom: 30px;">
        <h3 style="margin-top: 0; margin-bottom: 12px; font-size: 1.1rem; border-bottom: 1px solid #ddd; padding-bottom: 5px;">Dokumentierte Wartungen & Instandhaltungen</h3>
        <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.9rem;">
          <thead>
            <tr style="background: #f0f0f0; border-bottom: 2px solid #ccc;">
              <th style="padding: 8px;">Datum</th>
              <th style="padding: 8px;">KM-Stand</th>
              <th style="padding: 8px;">Arbeiten / Notizen</th>
              <th style="padding: 8px;">Kategorie</th>
              <th style="padding: 8px; text-align: right;">Kosten</th>
            </tr>
          </thead>
          <tbody>
            ${historyRowsHTML}
          </tbody>
          ${sortedServices.length > 0 ? `
          <tfoot>
            <tr style="border-top: 2px solid #ccc;">
              <td colspan="4" style="padding: 8px; text-align: right; font-weight: 700;">Gesamt investiert:</td>
              <td style="padding: 8px; text-align: right; font-weight: 700;">${totalMaintenanceCost.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</td>
            </tr>
          </tfoot>
          ` : ''}
        </table>
      </div>

      <!-- Fußzeile / Hinweis -->
      <div style="margin-top: 40px; border-top: 1px solid #ccc; padding-top: 15px; font-size: 0.8rem; color: #666; text-align: center;">
        Dieser Bericht wurde automatisch aus der Service-Datenbank erstellt. Alle Angaben basieren auf den erfassten Wartungseinträgen.
      </div>

    </div>
  `;

  // Druckdialog öffnen
  window.print();
}

window.printSaleReport = printSaleReport;

/* ==========================================================================
   IMPORT AUS ACAR (.abp)
   Eine .abp-Datei ist ein ganz normales ZIP-Archiv, das u.a. eine
   vehicles.xml mit allen Fahrzeugen, Tankeinträgen und Wartungen enthält.
   Wird komplett im Browser gelesen (ZIP entpacken + XML parsen) - kein
   Server, keine externe Bibliothek nötig.
   ========================================================================== */

let acarImportParsedVehicles = []; // Zwischenergebnis der zuletzt gelesenen Datei

/* --- Minimaler ZIP-Reader (nur lesend, unterstützt "stored" & "deflate") --- */
function acarReadUint32LE(dv, off) { return dv.getUint32(off, true); }
function acarReadUint16LE(dv, off) { return dv.getUint16(off, true); }

async function acarInflateRaw(uint8arr) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([uint8arr]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

async function acarReadZip(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const dv = new DataView(arrayBuffer);

  // End-Of-Central-Directory-Record suchen (rückwärts ab Dateiende)
  const EOCD_SIG = 0x06054b50;
  let eocdOffset = -1;
  const maxBack = Math.min(bytes.length, 65557);
  for (let i = bytes.length - 22; i >= bytes.length - maxBack && i >= 0; i--) {
    if (acarReadUint32LE(dv, i) === EOCD_SIG) { eocdOffset = i; break; }
  }
  if (eocdOffset === -1) throw new Error('Kein gültiges ZIP-Archiv (evtl. keine echte .abp-Datei)');

  const entryCount = acarReadUint16LE(dv, eocdOffset + 10);
  const cdOffset = acarReadUint32LE(dv, eocdOffset + 16);

  const files = {};
  const CD_SIG = 0x02014b50;
  const LFH_SIG = 0x04034b50;
  const textDecoder = new TextDecoder('utf-8');

  let offset = cdOffset;
  for (let i = 0; i < entryCount; i++) {
    if (acarReadUint32LE(dv, offset) !== CD_SIG) throw new Error('ZIP-Archiv beschädigt (Central Directory)');
    const compressionMethod = acarReadUint16LE(dv, offset + 10);
    const compressedSize = acarReadUint32LE(dv, offset + 20);
    const fileNameLen = acarReadUint16LE(dv, offset + 28);
    const extraLen = acarReadUint16LE(dv, offset + 30);
    const commentLen = acarReadUint16LE(dv, offset + 32);
    const localHeaderOffset = acarReadUint32LE(dv, offset + 42);
    const nameBytes = bytes.slice(offset + 46, offset + 46 + fileNameLen);
    const fileName = textDecoder.decode(nameBytes);

    if (acarReadUint32LE(dv, localHeaderOffset) !== LFH_SIG) throw new Error('ZIP-Archiv beschädigt (Local File Header)');
    const lfhNameLen = acarReadUint16LE(dv, localHeaderOffset + 26);
    const lfhExtraLen = acarReadUint16LE(dv, localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + lfhNameLen + lfhExtraLen;
    const rawData = bytes.slice(dataStart, dataStart + compressedSize);

    let data;
    if (compressionMethod === 0) {
      data = rawData;
    } else if (compressionMethod === 8) {
      data = await acarInflateRaw(rawData);
    } else {
      throw new Error('Nicht unterstützte ZIP-Kompression (Methode ' + compressionMethod + ')');
    }
    files[fileName] = data;

    offset += 46 + fileNameLen + extraLen + commentLen;
  }
  return files;
}

/* --- Hilfsfunktionen für die XML-Auswertung --- */
function acarXmlText(parentNode, tagName) {
  const el = parentNode.querySelector(tagName);
  return el ? (el.textContent || '') : '';
}

// aCar-Datumsformat "MM/DD/YYYY - HH:MM" -> "YYYY-MM-DD"
function acarParseDate(str) {
  const fallback = new Date().toISOString().split('T')[0];
  if (!str) return fallback;
  const m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return fallback;
  return `${m[3]}-${m[1]}-${m[2]}`;
}

const ACAR_DISTANCE_FACTORS = { kilometer: 1, mile: 1.609344 };
const ACAR_VOLUME_FACTORS = { liter: 1, 'gallon-us': 3.785412, 'gallon-imperial': 4.546092 };

function acarExtractVehicles(vehiclesDoc, fuelTypeMap, subtypeMap) {
  const result = [];
  const vehicleNodes = vehiclesDoc.querySelectorAll('vehicles > vehicle');

  vehicleNodes.forEach(vNode => {
    const name = acarXmlText(vNode, 'name') || 'Unbenanntes Fahrzeug';
    const make = acarXmlText(vNode, 'make');
    const model = acarXmlText(vNode, 'model');
    const year = acarXmlText(vNode, 'year');
    const engine = acarXmlText(vNode, 'engine');
    const distanceUnit = acarXmlText(vNode, 'distance-unit') || 'kilometer';
    const volumeUnit = acarXmlText(vNode, 'volume-unit') || 'liter';
    const distanceFactor = ACAR_DISTANCE_FACTORS[distanceUnit] || 1;
    const volumeFactor = ACAR_VOLUME_FACTORS[volumeUnit] || 1;

    // aCar trägt oft keinen Kraftstoff pro Tankeintrag ein (fuel-type-id -1),
    // dafür steckt im Motor-Feld meist ein verlässlicher Hinweis (z.B.
    // "L4 DIESEL", "3,0L V6 DIESEL", "L6 GAS") - daraus einen Vorschlag
    // ableiten, den man im Vorschau-Schritt noch anpassen kann.
    const engineUpper = engine.toUpperCase();
    let guessedFuelType = 'Super';
    if (engineUpper.includes('DIESEL') || engineUpper.includes('TDI') || engineUpper.includes('CDI') || engineUpper.includes('HDI')) {
      guessedFuelType = 'Diesel';
    } else if (engineUpper.includes('ELECTRIC') || engineUpper.includes('EV')) {
      guessedFuelType = 'Strom';
    } else if (engineUpper.includes('GAS') || engineUpper.includes('PETROL') || engineUpper.includes('GASOLINE')) {
      guessedFuelType = 'Super';
    }

    const fillups = [];
    vNode.querySelectorAll(':scope > fillup-records > fillup-record').forEach(fNode => {
      const rawMileage = parseFloat(acarXmlText(fNode, 'odometer-reading')) || 0;
      const rawLiters = parseFloat(acarXmlText(fNode, 'volume')) || 0;
      const totalPrice = parseFloat(acarXmlText(fNode, 'total-cost')) || 0;
      const liters = Math.round(rawLiters * volumeFactor * 100) / 100;
      const mileage = Math.round(rawMileage * distanceFactor);
      const fuelTypeId = acarXmlText(fNode, 'fuel-type-id');
      const fuelTypeName = (fuelTypeId && fuelTypeId !== '-1' && fuelTypeMap[fuelTypeId]) ? fuelTypeMap[fuelTypeId] : '';
      const hasAdditive = acarXmlText(fNode, 'has-fuel-additive') === 'true';

      fillups.push({
        date: acarParseDate(acarXmlText(fNode, 'date')),
        fuelType: fuelTypeName, // leer = beim Import Fahrzeug-Standardkraftstoff verwenden
        mileage: mileage,
        liters: liters,
        totalPrice: Math.round(totalPrice * 100) / 100,
        pricePerLiter: liters > 0 ? Math.round((totalPrice / liters) * 1000) / 1000 : 0,
        full: acarXmlText(fNode, 'partial') !== 'true',
        hasAdditive: hasAdditive,
        additiveName: hasAdditive ? acarXmlText(fNode, 'fuel-additive-name') : '',
        notes: acarXmlText(fNode, 'notes')
      });
    });

    const services = [];
    vNode.querySelectorAll(':scope > event-records > event-record').forEach(eNode => {
      const type = acarXmlText(eNode, 'type');
      const rawMileage = parseFloat(acarXmlText(eNode, 'odometer-reading')) || 0;
      const mileage = Math.round(rawMileage * distanceFactor);
      const cost = parseFloat(acarXmlText(eNode, 'total-cost')) || 0;

      const subtypeIds = Array.from(eNode.querySelectorAll('subtypes > subtype')).map(s => s.getAttribute('id'));
      const subtypeNames = subtypeIds.map(id => subtypeMap[id]).filter(Boolean);
      let title = subtypeNames.length > 0 ? subtypeNames.join(', ') : null;

      let category = 'Sonstiges';
      if (type === 'service') { category = 'Wartung'; if (!title) title = 'Wartung (aCar-Import)'; }
      else if (type === 'expense') { if (!title) title = 'Sonstige Ausgabe (aCar-Import)'; }
      else if (type === 'purchased') { title = 'Fahrzeugkauf'; }
      else if (!title) { title = 'Eintrag (aCar-Import)'; }

      // Eingebettete Beleg-Fotos übernehmen (aCar speichert sie als reines
      // Base64 ohne Data-URI-Prefix)
      const images = [];
      eNode.querySelectorAll(':scope > photos').forEach(pNode => {
        const b64 = (pNode.textContent || '').trim();
        if (b64) images.push('data:image/jpeg;base64,' + b64);
      });

      services.push({
        category: category,
        title: title,
        date: acarParseDate(acarXmlText(eNode, 'date')),
        mileage: mileage,
        cost: Math.round(cost * 100) / 100,
        notes: acarXmlText(eNode, 'notes'),
        images: images
      });
    });

    result.push({
      name: name,
      make: make,
      model: model,
      year: year,
      fillups: fillups,
      services: services,
      selected: true,
      targetMode: 'new', // 'new' oder die id eines bestehenden Fahrzeugs
      defaultFuelType: guessedFuelType,
      defaultFuelTypeCustom: '' // nur befüllt, wenn "Sonstiges" gewählt wurde
    });
  });

  return result;
}

/* --- Modal-Steuerung & Ablauf --- */
function acarShowStep(step) {
  ['acarImportStepLoading', 'acarImportStepPreview', 'acarImportStepResult', 'acarImportStepError'].forEach(id => {
    document.getElementById(id).style.display = (id === step) ? '' : 'none';
  });
}

function openAcarImportModal() {
  acarShowStep('acarImportStepLoading');
  document.getElementById('acarImportModal').classList.add('active');
}
window.openAcarImportModal = openAcarImportModal;

function closeAcarImportModal() {
  document.getElementById('acarImportModal').classList.remove('active');
  const input = document.getElementById('acarFileInput');
  if (input) input.value = '';
  acarImportParsedVehicles = [];
}
window.closeAcarImportModal = closeAcarImportModal;

function showAcarImportError(message) {
  acarShowStep('acarImportStepError');
  document.getElementById('acarImportErrorText').textContent = message;
}

async function handleAcarFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  openAcarImportModal();

  try {
    const arrayBuffer = await file.arrayBuffer();
    const zipFiles = await acarReadZip(arrayBuffer);

    if (!zipFiles['vehicles.xml']) {
      showAcarImportError('In der Datei wurde keine vehicles.xml gefunden - ist das wirklich ein vollständiges aCar-Backup (.abp)?');
      return;
    }

    const decoder = new TextDecoder('utf-8');
    const vehiclesXml = decoder.decode(zipFiles['vehicles.xml']);
    const fuelTypesXml = zipFiles['fuel-types.xml'] ? decoder.decode(zipFiles['fuel-types.xml']) : '';
    const subtypesXml = zipFiles['event-subtypes.xml'] ? decoder.decode(zipFiles['event-subtypes.xml']) : '';

    const parser = new DOMParser();
    const vehiclesDoc = parser.parseFromString(vehiclesXml, 'application/xml');
    if (vehiclesDoc.querySelector('parsererror')) {
      showAcarImportError('Die vehicles.xml in der Datei ist fehlerhaft und konnte nicht gelesen werden.');
      return;
    }

    const fuelTypeMap = {};
    if (fuelTypesXml) {
      const fuelTypesDoc = parser.parseFromString(fuelTypesXml, 'application/xml');
      fuelTypesDoc.querySelectorAll('fuel-type').forEach(node => {
        const id = node.getAttribute('id');
        const nameEl = node.querySelector('name');
        if (id && nameEl && nameEl.textContent) fuelTypeMap[id] = nameEl.textContent;
      });
    }

    const subtypeMap = {};
    if (subtypesXml) {
      const subtypesDoc = parser.parseFromString(subtypesXml, 'application/xml');
      subtypesDoc.querySelectorAll('event-subtype').forEach(node => {
        const id = node.getAttribute('id');
        const nameEl = node.querySelector('name');
        if (id && nameEl && nameEl.textContent) subtypeMap[id] = nameEl.textContent;
      });
    }

    acarImportParsedVehicles = acarExtractVehicles(vehiclesDoc, fuelTypeMap, subtypeMap);

    if (acarImportParsedVehicles.length === 0) {
      showAcarImportError('Es wurden keine Fahrzeuge in der Datei gefunden.');
      return;
    }

    renderAcarImportPreview();
    acarShowStep('acarImportStepPreview');
  } catch (err) {
    console.error('aCar-Import Fehler:', err);
    showAcarImportError('Die Datei konnte nicht gelesen werden: ' + (err && err.message ? err.message : err));
  }
}
window.handleAcarFileSelect = handleAcarFileSelect;

function renderAcarImportPreview() {
  const container = document.getElementById('acarImportVehicleList');
  const existingVehicles = appData.vehicles.filter(v => !v.archived);

  container.innerHTML = acarImportParsedVehicles.map((av, idx) => {
    const subtitleParts = [av.make, av.model, av.year].filter(Boolean);
    const subtitle = subtitleParts.length > 0 ? subtitleParts.join(' · ') : '';

    // Bestehendes Fahrzeug mit gleichem Namen vorschlagen, falls vorhanden
    const matchingExisting = existingVehicles.find(v => v.name.trim().toLowerCase() === av.name.trim().toLowerCase());
    if (matchingExisting && av.targetMode === 'new') {
      av.targetMode = matchingExisting.id;
    }

    const optionsHtml = [
      `<option value="new">Neues Fahrzeug anlegen ("${av.name}")</option>`
    ].concat(existingVehicles.map(v =>
      `<option value="${v.id}" ${av.targetMode === v.id ? 'selected' : ''}>In "${v.name}" einordnen</option>`
    )).join('');

    return `
      <div class="acar-vehicle-card">
        <div class="acar-vehicle-card-header">
          <input type="checkbox" id="acarVehicleSelected_${idx}" ${av.selected ? 'checked' : ''} onchange="acarToggleVehicleSelected(${idx}, this.checked)">
          <div>
            <div class="acar-vehicle-card-title">${av.name}</div>
            ${subtitle ? `<div class="acar-vehicle-card-sub">${subtitle}</div>` : ''}
            <div class="acar-vehicle-card-counts">${av.fillups.length} Tankeinträge · ${av.services.length} Wartungen/Ausgaben</div>
          </div>
        </div>
        <div class="acar-vehicle-card-target">
          <select onchange="acarSetVehicleTarget(${idx}, this.value)">
            ${optionsHtml}
          </select>
        </div>
        ${av.fillups.length > 0 ? `
        <div class="acar-vehicle-card-target">
          <label class="acar-fuel-label">Kraftstoff für die Tankeinträge (aCar hat keinen hinterlegt - Vorschlag aus dem Motor-Feld)</label>
          <select onchange="acarSetVehicleFuelType(${idx}, this.value); document.getElementById('acarFuelCustom_${idx}').style.display = (this.value === 'Sonstiges') ? '' : 'none';">
            <option value="Super" ${av.defaultFuelType === 'Super' ? 'selected' : ''}>Super (E5 / E10)</option>
            <option value="Super Plus" ${av.defaultFuelType === 'Super Plus' ? 'selected' : ''}>Super Plus</option>
            <option value="Diesel" ${av.defaultFuelType === 'Diesel' ? 'selected' : ''}>Diesel</option>
            <option value="Premium Diesel" ${av.defaultFuelType === 'Premium Diesel' ? 'selected' : ''}>Premium Diesel (Ultimate / V-Power)</option>
            <option value="Strom" ${av.defaultFuelType === 'Strom' ? 'selected' : ''}>Strom</option>
            <option value="Sonstiges" ${av.defaultFuelType === 'Sonstiges' ? 'selected' : ''}>Sonstiges / Individuell</option>
          </select>
          <input type="text" id="acarFuelCustom_${idx}" class="acar-fuel-custom-input" placeholder="z.B. Zweitaktgemisch / LPG" value="${av.defaultFuelTypeCustom || ''}" oninput="acarSetVehicleFuelTypeCustom(${idx}, this.value)" style="display: ${av.defaultFuelType === 'Sonstiges' ? '' : 'none'};">
        </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

function acarSetVehicleFuelType(idx, value) {
  if (acarImportParsedVehicles[idx]) acarImportParsedVehicles[idx].defaultFuelType = value;
}
window.acarSetVehicleFuelType = acarSetVehicleFuelType;

function acarSetVehicleFuelTypeCustom(idx, value) {
  if (acarImportParsedVehicles[idx]) acarImportParsedVehicles[idx].defaultFuelTypeCustom = value;
}
window.acarSetVehicleFuelTypeCustom = acarSetVehicleFuelTypeCustom;

function acarToggleVehicleSelected(idx, checked) {
  if (acarImportParsedVehicles[idx]) acarImportParsedVehicles[idx].selected = checked;
}
window.acarToggleVehicleSelected = acarToggleVehicleSelected;

function acarSetVehicleTarget(idx, value) {
  if (acarImportParsedVehicles[idx]) acarImportParsedVehicles[idx].targetMode = value;
}
window.acarSetVehicleTarget = acarSetVehicleTarget;

// Grobe Dublettenprüfung: gleicher Tag, gleicher (gerundeter) KM-Stand und
// ungefähr gleicher Betrag gilt als bereits vorhanden
function acarIsDuplicateFillup(existing, candidate) {
  return existing.some(f =>
    f.date === candidate.date &&
    Math.abs((f.mileage || 0) - candidate.mileage) < 2 &&
    Math.abs((f.totalPrice || 0) - candidate.totalPrice) < 0.05
  );
}
function acarIsDuplicateService(existing, candidate) {
  return existing.some(s =>
    s.date === candidate.date &&
    Math.abs((s.mileage || 0) - candidate.mileage) < 2 &&
    Math.abs((s.cost || 0) - candidate.cost) < 0.05
  );
}

function runAcarImport() {
  let importedFillups = 0, skippedFillups = 0;
  let importedServices = 0, skippedServices = 0;
  let createdVehicles = 0;

  acarImportParsedVehicles.forEach(av => {
    if (!av.selected) return;

    let targetVehicle;
    if (av.targetMode === 'new') {
      targetVehicle = {
        id: "v_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
        name: av.name,
        category: 'auto',
        type: 'km',
        fuelType: 'Super',
        image: "",
        archived: false,
        boatType: "motorboot",
        engines: [],
        belongsToId: null,
        fuelEntries: [],
        serviceEntries: []
      };
      if (av.year) targetVehicle.firstReg = av.year + '-01-01';
      appData.vehicles.push(targetVehicle);
      createdVehicles++;
    } else {
      targetVehicle = appData.vehicles.find(v => v.id === av.targetMode);
    }
    if (!targetVehicle) return;

    if (!targetVehicle.fuelEntries) targetVehicle.fuelEntries = [];
    if (!targetVehicle.serviceEntries) targetVehicle.serviceEntries = [];

    // Im Vorschau-Schritt gewähltes Kraftstoff-Standard für dieses
    // aCar-Fahrzeug (greift, wenn aCar selbst keinen Kraftstoff eingetragen hat)
    const chosenFuelType = (av.defaultFuelType === 'Sonstiges')
      ? (av.defaultFuelTypeCustom || 'Sonstiges')
      : av.defaultFuelType;

    av.fillups.forEach(f => {
      if (acarIsDuplicateFillup(targetVehicle.fuelEntries, f)) { skippedFillups++; return; }
      targetVehicle.fuelEntries.push({
        id: "f_" + Date.now() + "_" + Math.floor(Math.random() * 100000),
        date: f.date,
        fuelType: f.fuelType || chosenFuelType || targetVehicle.fuelType || 'Super',
        mileage: f.mileage,
        liters: f.liters,
        totalPrice: f.totalPrice,
        pricePerLiter: f.pricePerLiter,
        full: f.full,
        hasAdditive: f.hasAdditive,
        additiveName: f.additiveName,
        notes: f.notes ? (f.notes + ' (aus aCar importiert)') : 'Aus aCar importiert'
      });
      importedFillups++;
    });

    av.services.forEach(s => {
      if (acarIsDuplicateService(targetVehicle.serviceEntries, s)) { skippedServices++; return; }
      targetVehicle.serviceEntries.push({
        id: "s_" + Date.now() + "_" + Math.floor(Math.random() * 100000),
        isStandEntry: false,
        category: s.category,
        title: s.title,
        date: s.date,
        mileage: s.mileage,
        cost: s.cost,
        performer: '',
        notes: s.notes ? (s.notes + ' (aus aCar importiert)') : 'Aus aCar importiert',
        images: s.images,
        nextKm: null,
        nextDate: null,
        engineId: null
      });
      importedServices++;
    });

    targetVehicle.fuelEntries.sort(compareByDateThenMileageDesc);
    targetVehicle.serviceEntries.sort(compareByDateThenMileageDesc);
  });

  saveData();
  renderVehicleSelect();
  renderGarageVehicleTiles();
  loadActiveVehicle();

  const resultLines = [
    `<div class="acar-import-summary-line"><span>Neue Fahrzeuge angelegt</span><strong>${createdVehicles}</strong></div>`,
    `<div class="acar-import-summary-line"><span>Tankeinträge importiert</span><strong>${importedFillups}</strong></div>`,
    `<div class="acar-import-summary-line"><span>Wartungen/Ausgaben importiert</span><strong>${importedServices}</strong></div>`
  ];
  if (skippedFillups > 0 || skippedServices > 0) {
    resultLines.push(`<div class="acar-import-summary-line"><span>Übersprungen (bereits vorhanden)</span><strong>${skippedFillups + skippedServices}</strong></div>`);
  }
  document.getElementById('acarImportResultText').innerHTML = resultLines.join('');
  acarShowStep('acarImportStepResult');
}
window.runAcarImport = runAcarImport;




