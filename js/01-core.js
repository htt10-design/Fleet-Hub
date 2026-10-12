/* --- STATE MANAGEMENT --- */
let appData = {
  activeVehicleId: null,
  activeCustomerVehicleId: null,
  theme: "dark",
  backgroundStyle: "concrete",
  accentColor: "amber",
  uiStyle: "standard",
  customerVehiclesEnabled: true,
  boatCategoryEnabled: true,
  trailerCategoryEnabled: true,
  // Reserviert für eine spätere frei konfigurierbare Sonderkategorie
  // (z.B. Bagger, Radlader, ...) - noch ohne UI, nur Datenstruktur vorbereitet
  customVehicleCategories: [],
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
let tempServiceImages = [];
let tempCustomerServiceImages = [];

/* --- TÜV/HU-ASSISTENT: geführter 6-Schritte-Wizard --- */
let tuevWizardState = null;
let tuevWizardStep = 1;
let tempTuevImages = [];

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
  if (appData.boatCategoryEnabled === undefined) {
    appData.boatCategoryEnabled = true;
  }
  if (appData.trailerCategoryEnabled === undefined) {
    appData.trailerCategoryEnabled = true;
  }
  if (!appData.customVehicleCategories) {
    appData.customVehicleCategories = [];
  }
  if (!appData.uiStyle) {
    appData.uiStyle = 'standard';
  }
  // Migration: bestehende Fahrzeuge bekommen den neuen Archiv-Status nachgereicht
  appData.vehicles.forEach(v => {
    if (v.archived === undefined) v.archived = false;
    if (!v.category) v.category = 'auto';
    // Migration: Reifensätze (nur für Auto & Anhänger relevant, aber schadet
    // auch bei anderen Kategorien nicht, einfach als leeres Array vorzuhalten)
    if (!v.tireSets) v.tireSets = [];
    if (v.tireApprovedCombos === undefined) v.tireApprovedCombos = '';
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
  applyVehicleCategoryToggleVisibility();

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

  renderBackupReminder();
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
  saveData({ keepChangeDate: true });
}

function saveData(options = {}) {
  // Zeitpunkt der letzten Änderung merken (für die Backup-Erinnerung).
  // keepChangeDate: z.B. beim Backup selbst oder beim Anlegen der Demo-Daten
  if (!options.keepChangeDate) {
    appData.lastChangeDate = new Date().toISOString();
    if (!appData.firstChangeDate) appData.firstChangeDate = appData.lastChangeDate;
  }
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

  // Verbrauchsverlauf-Chart nutzt die Akzentfarbe live (siehe renderCharts) -
  // daher hier ebenfalls neu zeichnen, sonst zeigt er erst nach einem Reload
  // die neu gewählte Farbe
  const v = getActiveVehicle();
  if (v) renderCharts(v);
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
