/* --- STATE MANAGEMENT --- */
let appData = {
  activeVehicleId: null,
  activeCustomerVehicleId: null,
  theme: "dark",
  vehicles: [],
  customerVehicles: []
};

let consumptionChartInstance = null;
let costPieChartInstance = null;
let tempServiceImages = [];
let tempCustomerServiceImages = [];

/* --- INITIALISIERUNG --- */
document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

function initApp() {
 
  const saved = localStorage.getItem('sgs_data') || localStorage.getItem('fleethub_data');
  if (saved) {
    try {
      appData = JSON.parse(saved);
    } catch (e) {
      console.error("Fehler beim Laden des Speicherstands, Fallback auf Standardwerte", e);
      loadDefaultData();
    }
  } else {
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

  applyTheme(appData.theme || 'dark');

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
    customerVehicles: []
  };
  saveData();
}

function saveData() {
  localStorage.setItem('sgs_data', JSON.stringify(appData));
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
  appData.theme = newTheme;
  saveData();
  applyTheme(newTheme);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const iconText = theme === 'light' ? '☀️' : '🌙';

  const icon = document.getElementById('themeToggleIcon');
  if (icon) icon.innerText = iconText;

  const iconSelection = document.getElementById('themeToggleIconSelection');
  if (iconSelection) iconSelection.innerText = iconText;

  const v = getActiveVehicle();
  if (v) renderCharts(v);
}

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
      const selectElem = document.getElementById('customerVehicleSelect');
      if (selectElem && selectElem.options.length > 0) {
        if (!selectElem.value) {
          selectElem.selectedIndex = 0;
        }
        if (typeof switchCustomerVehicle === 'function') {
          switchCustomerVehicle();
        }
      }
    } catch (err) {
      console.error("Fehler beim Laden der Kundendaten:", err);
    }
  }
}


// Ermittelt den aktuellen Kilometer-/Betriebsstundenstand aus Tank- & Wartungseinträgen
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

// Rendert alle gespeicherten eigenen Fahrzeuge als Auswahlkacheln hinter "Meine Garage"
function renderGarageVehicleTiles() {
  const grid = document.getElementById('garageVehicleGrid');
  if (!grid) return;

  grid.innerHTML = '';

  const list = appData.vehicles || [];

  if (list.length === 0) {
    grid.innerHTML = `
      <div class="selection-card" onclick="openVehicleModal()" style="grid-column: 1 / -1; text-align: center;">
        <div class="kachel-icon">➕</div>
        <h3>Noch kein Fahrzeug vorhanden</h3>
        <p>Klicke hier, um dein erstes Fahrzeug anzulegen.</p>
      </div>
    `;
    return;
  }

  list.forEach(v => {
    const card = document.createElement('div');
    card.className = 'selection-card vehicle-tile';

    const imageHtml = v.image
      ? `<img src="${v.image}" class="vehicle-tile-image" alt="${v.name || 'Fahrzeug'}">`
      : `<div class="vehicle-tile-icon">🏎️</div>`;

    const mileage = getVehicleCurrentMileage(v);
    const mileageUnit = v.type === 'hours' ? 'Std' : 'km';
    const hsn = v.hsn || '-';
    const tsn = v.tsn || '-';
    const tuev = formatTuevDate(v.nextTuev);

    card.innerHTML = `
      ${imageHtml}
      <h3>${v.name || 'Unbenanntes Fahrzeug'}</h3>
      <p>${v.plate || 'Kein Kennzeichen'} ${v.fuelType ? '• ' + v.fuelType : ''}</p>
      <div class="vehicle-tile-info">
        <span><strong>KM-Stand:</strong> ${mileage.toLocaleString('de-DE')} ${mileageUnit}</span>
        <span><strong>HSN/TSN:</strong> ${hsn} / ${tsn}</span>
        <span><strong>Nächster TÜV:</strong> ${tuev}</span>
      </div>
    `;

    card.onclick = () => chooseGarageVehicle(v.id);
    grid.appendChild(card);
  });
}

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
function chooseGarageVehicle(vehicleId) {
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

  const defaultNavBtn = document.querySelector('.nav-item[onclick*="dashboard"]');
  showTab('dashboard', defaultNavBtn);
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

  if (fuelKmLabel) fuelKmLabel.innerText = isKm ? "KM-Stand" : "Betriebsstunden";
  if (serviceKmLabel) serviceKmLabel.innerText = isKm ? "KM-Stand" : "Betriebsstunden";
  if (kpiMileageUnit) kpiMileageUnit.innerText = isKm ? "Kilometerstand" : "Betriebsstunden";
}

function loadActiveVehicle() {
  const vehicle = getActiveVehicle();
  if (!vehicle) return;

  const fields = {
    'vName': vehicle.name || '',
    'vPlate': vehicle.plate || '',
    'vType': vehicle.type || 'km',
    'vFuelType': vehicle.fuelType || '',
    'vVin': vehicle.vin || '',
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
}

function closeVehicleModal() { 
  const el = document.getElementById('vehicleModal');
  if (el) el.classList.remove('active'); 
}

function createNewVehicle(e) {
  e.preventDefault();
  const nameEl = document.getElementById('newVName');
  const typeEl = document.getElementById('newVType');
  const fuelTypeEl = document.getElementById('newVFuelType');
  const mileageEl = document.getElementById('newVMileage');

  const startMileage = parseFloat(mileageEl ? mileageEl.value : 0) || 0;
  
  const newV = {
    id: "v_" + Date.now(),
    name: nameEl ? nameEl.value : 'Neues Fahrzeug',
    type: typeEl ? typeEl.value : 'km',
    fuelType: fuelTypeEl ? fuelTypeEl.value : 'Super',
    image: "",
    fuelEntries: [],
    serviceEntries: []
  };

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
  const reader = new FileReader();
  reader.onload = async function(e) {
    const compressed = await compressImage(e.target.result);
    const v = getActiveVehicle();
    if (v) {
      v.image = compressed;
      saveData();
      loadActiveVehicle();
    }
  };
  reader.readAsDataURL(file);
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
  v.type = document.getElementById('vType').value;
  v.fuelType = document.getElementById('vFuelType').value;
  v.vin = document.getElementById('vVin').value;
  v.firstReg = document.getElementById('vFirstReg').value;
  v.hsn = document.getElementById('vHsn').value;
  v.tsn = document.getElementById('vTsn').value;
  v.powerHp = parseInt(document.getElementById('vPowerHp').value) || null;
  v.towingBraked = parseInt(document.getElementById('vTowingBraked').value) || null;
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
    mileage: parseFloat(document.getElementById('fuelMileage').value) || 0,
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

  v.fuelEntries.sort((a,b) => new Date(b.date) - new Date(a.date));

  saveData();
  resetFuelForm();
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

  document.getElementById('fuelMileage').value = entry.mileage;
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
  window.scrollTo({ top: 0, behavior: 'smooth' });
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

// Globalen Status ganz oben in der app.js halten (oder vor renderFuelTable)
let showAllFuelEntries = false;

function renderFuelTable() {
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
  const sortedFuel = [...v.fuelEntries].sort((a, b) => a.mileage - b.mileage);
  const consumptionMap = {};
  const unitLabel = v.type === 'km' ? 'L/100km' : 'L/Std';

  for (let i = 0; i < sortedFuel.length; i++) {
    const current = sortedFuel[i];
    if (i === 0 || !current.full) {
      consumptionMap[current.id] = '-';
      continue;
    }
    const previous = sortedFuel[i - 1];
    const dist = current.mileage - previous.mileage;
    if (dist > 0) {
      const consumption = (current.liters / dist) * 100;
      consumptionMap[current.id] = `${consumption.toFixed(2)} ${unitLabel}`;
    } else {
      consumptionMap[current.id] = '-';
    }
  }

  // 2. Sortierung für die Anzeige in der Tabelle (neueste Einträge zuerst)
  const displaySorted = [...v.fuelEntries].sort((a, b) => new Date(b.date) - new Date(a.date));

  // 3. Auf max. 5 Einträge begrenzen (falls nicht ausgeklappt)
  const hasMoreThan10 = displaySorted.length > 5;
  const entriesToRender = (hasMoreThan10 && !showAllFuelEntries) 
    ? displaySorted.slice(0, 5) 
    : displaySorted;

  // 4. Tabelle befüllen
  entriesToRender.forEach(f => {
    const tr = document.createElement('tr');
    const additiveBadge = f.hasAdditive ? `<span class="badge-additive" title="${f.additiveName || ''}">🧪 ${f.additiveName || 'Zusatz'}</span>` : '-';
    const consumptionVal = consumptionMap[f.id] || '-';
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
        <button class="btn btn-secondary btn-sm" onclick="editFuelEntry('${f.id}')">✏️</button>
        <button class="btn btn-danger btn-sm" onclick="deleteFuelEntry('${f.id}')">🗑️</button>
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

  const entry = {
    id: editId ? editId : "s_" + Date.now(),
    category: document.getElementById('serviceCategory').value,
    title: document.getElementById('serviceTitle').value,
    date: document.getElementById('serviceDate').value,
    mileage: parseFloat(document.getElementById('serviceMileage').value) || 0,
    cost: parseFloat(document.getElementById('serviceCost').value) || 0,
    performer: document.getElementById('servicePerformer').value,
    notes: document.getElementById('serviceNotes').value,
    images: [...tempServiceImages]
  };

  if (!v.serviceEntries) v.serviceEntries = [];

  if (editId) {
    const idx = v.serviceEntries.findIndex(s => s.id === editId);
    if (idx !== -1) v.serviceEntries[idx] = entry;
  } else {
    v.serviceEntries.push(entry);
  }

  v.serviceEntries.sort((a,b) => new Date(b.date) - new Date(a.date));

  saveData();
  resetServiceForm();
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
}

// Globaler Status für die Wartungstabelle (ganz oben in app.js oder vor der Funktion)
let showAllServiceEntries = false;

function renderServiceTable() {
  const v = getActiveVehicle();
  const tbody = document.getElementById('serviceTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const toggleContainer = document.getElementById('serviceToggleBtnContainer');
  const toggleBtn = document.getElementById('serviceToggleBtn');

  if (!v || !v.serviceEntries || v.serviceEntries.length === 0) {
    if (toggleContainer) toggleContainer.style.display = 'none';
    return;
  }

  // 1. Nach Datum sortieren (neueste Einträge zuerst)
  const sortedServices = [...v.serviceEntries].sort((a, b) => new Date(b.date) - new Date(a.date));

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

    tr.innerHTML = `
      <td data-label="Datum">${s.date || '-'}</td>
      <td data-label="Kategorie"><span class="badge">${s.category || 'Allgemein'}</span></td>
      <td data-label="Titel"><strong>${s.title || 'Wartung'}</strong></td>
      <td data-label="Kosten">${costVal}</td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="editServiceEntry('${s.id}')">✏️</button>
        <button class="btn btn-danger btn-sm" onclick="deleteServiceEntry('${s.id}')">🗑️</button>
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
  document.getElementById('serviceMileage').value = entry.mileage;
  document.getElementById('serviceCost').value = entry.cost;
  document.getElementById('servicePerformer').value = entry.performer;
  document.getElementById('serviceNotes').value = entry.notes || '';

  tempServiceImages = entry.images ? [...entry.images] : [];
  renderServiceImagePreviews();

  document.getElementById('serviceSubmitBtn').innerText = "Änderungen Speichern";
  document.getElementById('serviceCancelBtn').style.display = "inline-block";
  window.scrollTo({ top: 0, behavior: 'smooth' });
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
  document.getElementById('dashVehicleVin').innerText = `VIN: ${v.vin || '-'}`;
  document.getElementById('dashVehicleSpecs').innerText = v.specs || 'Keine Spezifikationen eingetragen.';
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

  const fullTankings = [...fuelList].filter(f => f.full).sort((a,b) => a.mileage - b.mileage);
  let totalLiters = 0;
  let totalDist = 0;

  if (fullTankings.length >= 2) {
    totalDist = fullTankings[fullTankings.length - 1].mileage - fullTankings[0].mileage;
    for (let i = 1; i < fullTankings.length; i++) {
      totalLiters += fullTankings[i].liters;
    }
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

  const reminderList = document.getElementById('reminderList');
  if (reminderList) {
    reminderList.innerHTML = '';
    if (v.nextTuev) {
      const li = document.createElement('li');
      li.innerHTML = `<strong>Nächster TÜV / Inspektion:</strong> ${v.nextTuev}`;
      reminderList.appendChild(li);
    } else {
      reminderList.innerHTML = '<li>Keine anstehenden Termine eingetragen.</li>';
    }
  }

  renderCharts(v);
}

function renderCharts(v) {
  if (typeof Chart === 'undefined') return;

  const fuelList = v.fuelEntries || [];
  const serviceList = v.serviceEntries || [];

  const fullTankings = [...fuelList].filter(f => f.full).sort((a,b) => a.mileage - b.mileage);
  const labels = [];
  const dataPoints = [];

  for (let i = 1; i < fullTankings.length; i++) {
    const dist = fullTankings[i].mileage - fullTankings[i-1].mileage;
    if (dist > 0) {
      const cons = (fullTankings[i].liters / dist) * 100;
      labels.push(fullTankings[i].date);
      dataPoints.push(cons.toFixed(2));
    }
  }

  const consCanvas = document.getElementById('consumptionChart');
  if (consCanvas) {
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

    costPieChartInstance = new Chart(ctx2, {
      type: 'doughnut',
      data: {
        labels: ['Kraftstoff', 'Wartung', 'Reparatur', 'TÜV'],
        datasets: [{
          data: [fuelTotal, serviceTotal, repairTotal, tuevTotal],
          backgroundColor: ['#2563eb', '#10b981', '#ef4444', '#f59e0b']
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
      type: '⛽ Tanken',
      date: f.date,
      mileage: f.mileage || 0,
      desc: `${f.fuelType} (${f.liters}L @ ${(f.pricePerLiter || 0).toFixed(3)}€) ${f.notes || ''}`,
      amount: f.totalPrice || 0
    })),
    ...serviceList.map(s => ({
      type: `🔧 ${s.category}`,
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
  combined.sort((a, b) => new Date(b.date) - new Date(a.date));

  // 4. Auf max. 5 Einträge begrenzen (sofern nicht ausgeklappt und keine Suche aktiv ist)
  const hasMoreThan5 = combined.length > 5;
  const entriesToRender = (hasMoreThan5 && !showAllHistoryEntries && !searchVal) 
    ? combined.slice(0, 5) 
    : combined;

  // 5. Tabelle befüllen
  entriesToRender.forEach(item => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td data-label="Typ">${item.type}</td>
      <td data-label="Datum">${item.date || '-'}</td>
      <td data-label="Stand">${item.mileage.toLocaleString()}</td>
      <td data-label="Beschreibung">${item.desc}</td>
      <td data-label="Betrag"><strong>${item.amount.toFixed(2)} €</strong></td>
      <td style="text-align: right;">-</td>
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
  const select = document.getElementById('customerVehicleSelect');
  if (!select) return;
  select.innerHTML = '<option value="">-- Kundenfahrzeug wählen --</option>';

  appData.customerVehicles.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = `${c.owner} (${c.model} - ${c.plate || 'Kein KZ'})`;
    if (c.id === appData.activeCustomerVehicleId) opt.selected = true;
    select.appendChild(opt);
  });
}

function switchCustomerVehicle() {
  const select = document.getElementById('customerVehicleSelect');
  if (!select) return;
  appData.activeCustomerVehicleId = select.value;
  saveData();
  renderCustomerSection();
}

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

  c.services.sort((a,b) => new Date(b.date) - new Date(a.date));

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
  const sortedServices = [...c.services].sort((a, b) => new Date(b.date) - new Date(a.date));

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
        <button class="btn btn-secondary btn-sm" onclick="editCustomerServiceEntry('${cs.id}')">✏️</button>
        <button class="btn btn-primary btn-sm" onclick="printInvoice('${cs.id}')">🖨️ Drucken</button>
        <button class="btn btn-danger btn-sm" onclick="deleteCustomerServiceEntry('${cs.id}')">🗑️</button>
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
          <div>
            <div class="invoice-title" style="
              font-size: 17px;
              font-weight: 700;
              color: #111827;
              letter-spacing: -0.3px;
              text-transform: uppercase;
            ">SGS Fahrzeug-Service</div>
            <div class="invoice-subtitle" style="
              font-size: 9.5px;
              color: #4b5563;
              margin-top: 1px;
            ">Smart Garage Solutions & Werkstattdokumentation</div>
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
          Empfänger: SGS Fahrzeug-Service<br>
          IBAN: DE00 0000 0000 0000 0000 00<br>
          BIC: XXXXXXXXXXX | Bank: Musterbank
        </div>
        <div>
          <strong style="color: #111827; font-size: 8.5px;">PayPal / Alternative</strong><br>
          PayPal-Me: paypal.me/SGSFahrzeugservice<br>
          E-Mail: paypal@sgs-service.de<br>
          Verwendungszweck: ${c.plate || c.owner} - ${cs.date}
        </div>
      </div>
    </div>
  `;

  window.print();
}




/* --- EXPORT & IMPORT (BACKUP) --- */
function exportData() {
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

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const parsed = JSON.parse(e.target.result);
      if (parsed && parsed.vehicles) {
        appData = parsed;
        saveData();
        initApp();
        alert("Daten erfolgreich wiederhergestellt!");
      } else {
        alert("Ungültiges Backup-Format.");
      }
    } catch (err) {
      alert("Fehler beim Lesen der Backup-Datei: " + err.message);
    }
  };
  reader.readAsText(file);
}
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

  // 1. Service-Einträge nach Datum sortieren (neueste zuerst)
  const serviceList = v.serviceEntries || [];
  const sortedServices = [...serviceList].sort((a, b) => new Date(b.date) - new Date(a.date));

  // 2. HTML-Zeilen für die Historie aufbauen
  let historyRowsHTML = "";
  if (sortedServices.length > 0) {
    historyRowsHTML = sortedServices.map(s => {
      const dateStr = s.date ? new Date(s.date).toLocaleDateString('de-DE') : '-';
      const mileageStr = s.mileage ? `${s.mileage.toLocaleString('de-DE')} km` : '-';
      const performerStr = s.performer ? `<small>(${s.performer})</small>` : '';
      const notesStr = s.notes ? `<div style="font-size: 0.85rem; color: #555; margin-top: 4px;">${s.notes.replace(/\n/g, '<br>')}</div>` : '';

      return `
        <tr style="border-bottom: 1px solid #ddd;">
          <td style="padding: 8px; vertical-align: top;">${dateStr}</td>
          <td style="padding: 8px; vertical-align: top;">${mileageStr}</td>
          <td style="padding: 8px; vertical-align: top;">
            <strong>${s.title || 'Wartung / Reparatur'}</strong> ${performerStr}
            ${notesStr}
          </td>
          <td style="padding: 8px; vertical-align: top; text-align: right;">${s.category || 'Wartung'}</td>
        </tr>
      `;
    }).join('');
  } else {
    historyRowsHTML = `<tr><td colspan="4" style="padding: 12px; text-align: center; color: #777;">Keine dokumentierten Wartungseinträge vorhanden.</td></tr>`;
  }

  // 3. Formatierungs-Vorbereitung für Stammdaten
  const firstRegStr = v.firstReg ? new Date(v.firstReg).toLocaleDateString('de-DE') : '-';
  const currentMileageStr = v.mileage ? `${v.mileage.toLocaleString('de-DE')} km` : '-';
  const hsnTsnStr = (v.hsn || v.tsn) ? `${v.hsn || '-'} / ${v.tsn || '-'}` : '-';

  // 4. Druck-Layout zusammenbauen
  printContainer.innerHTML = `
    <div style="padding: 20px; font-family: Arial, sans-serif; color: #222; max-width: 800px; margin: 0 auto;">
      
      <!-- Kopfzeile -->
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #222; padding-bottom: 15px; margin-bottom: 20px;">
        <div>
          <h1 style="margin: 0; font-size: 1.8rem; text-transform: uppercase;">Fahrzeug-Verkaufsbericht</h1>
          <p style="margin: 5px 0 0 0; color: #666; font-size: 0.9rem;">Lückenlose Wartungs- & Historienübersicht</p>
        </div>
        <div style="text-align: right;">
          <h2 style="margin: 0; font-size: 1.4rem; color: #0056b3;">${v.name || 'Fahrzeug'}</h2>
          <span style="display: inline-block; padding: 3px 8px; background: #eee; border: 1px solid #ccc; font-weight: bold; border-radius: 4px; margin-top: 5px;">
            ${v.plate || 'OHNE KENNZEICHEN'}
          </span>
        </div>
      </div>

      <!-- Stammdaten Raster -->
      <div style="background: #f9f9f9; border: 1px solid #e0e0e0; border-radius: 6px; padding: 15px; margin-bottom: 25px;">
        <h3 style="margin-top: 0; margin-bottom: 12px; font-size: 1.1rem; border-bottom: 1px solid #ddd; padding-bottom: 5px;">Fahrzeugdaten</h3>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; font-size: 0.95rem;">
          <div><strong>Erstzulassung:</strong> ${firstRegStr}</div>
          <div><strong>Aktueller Stand:</strong> ${currentMileageStr}</div>
          <div><strong>FIN / VIN:</strong> ${v.vin || '-'}</div>
          <div><strong>HSN / TSN:</strong> ${hsnTsnStr}</div>
          <div><strong>Kraftstoffart:</strong> ${v.fuelType || '-'}</div>
          <div><strong>Nächster TÜV / HU:</strong> ${v.nextTuev || '-'}</div>
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
              <th style="padding: 8px; text-align: right;">Kategorie</th>
            </tr>
          </thead>
          <tbody>
            ${historyRowsHTML}
          </tbody>
        </table>
      </div>

      <!-- Fußzeile / Hinweis -->
      <div style="margin-top: 40px; border-top: 1px solid #ccc; padding-top: 15px; font-size: 0.8rem; color: #666; text-align: center;">
        Dieser Bericht wurde automatisch aus der Service-Datenbank erstellt. Alle Angaben basieren auf den erfassten Wartungseinträgen.
      </div>

    </div>
  `;

  // 5. Druckdialog öffnen
  window.print();
}

window.printSaleReport = printSaleReport;


