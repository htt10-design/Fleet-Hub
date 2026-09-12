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
  const icon = document.getElementById('themeToggleIcon');
  if (icon) icon.innerText = theme === 'light' ? '☀️' : '🌙';
  const v = getActiveVehicle();
  if (v) renderCharts(v);
}

/* --- TABS --- */
function showTab(tabId, element) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  
  const targetTab = document.getElementById(`tab-${tabId}`);
  if (targetTab) targetTab.classList.add('active');
  if (element) element.classList.add('active');

  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (tabId === 'dashboard') renderDashboard();
  else if (tabId === 'history') renderHistoryTable();
  else if (tabId === 'customers') renderCustomerSection();
}

/* --- EIGENE FAHRZEUGE --- */
function renderVehicleSelect() {
  const select = document.getElementById('vehicleSelect');
  if (!select) return;
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

function renderFuelTable() {
  const v = getActiveVehicle();
  const tbody = document.getElementById('fuelTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!v || !v.fuelEntries) return;

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

  v.fuelEntries.forEach(f => {
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
}

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

function renderServiceTable() {
  const v = getActiveVehicle();
  const tbody = document.getElementById('serviceTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!v || !v.serviceEntries) return;

  v.serviceEntries.forEach(s => {
    const tr = document.createElement('tr');
    tr.className = 'clickable-row';
    tr.onclick = (e) => {
      if (e.target.tagName !== 'BUTTON') openServiceDetailModal(s.id);
    };

    tr.innerHTML = `
      <td data-label="Datum">${s.date}</td>
      <td data-label="Kategorie"><span class="badge">${s.category}</span></td>
      <td data-label="Titel"><strong>${s.title}</strong></td>
      <td data-label="Kosten">${s.cost.toFixed(2)} €</td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="editServiceEntry('${s.id}')">✏️</button>
        <button class="btn btn-danger btn-sm" onclick="deleteServiceEntry('${s.id}')">🗑️</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

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

/* --- HISTORIE TAB --- */
function renderHistoryTable() {
  const v = getActiveVehicle();
  const tbody = document.getElementById('fullHistoryTableBody');
  if (!tbody) return;
  const searchVal = (document.getElementById('historySearch').value || '').toLowerCase();
  tbody.innerHTML = '';
  if (!v) return;

  const fuelList = v.fuelEntries || [];
  const serviceList = v.serviceEntries || [];

  const combined = [
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

  combined.sort((a,b) => new Date(b.date) - new Date(a.date));

  combined.forEach(item => {
    if (searchVal && !item.desc.toLowerCase().includes(searchVal) && !item.type.toLowerCase().includes(searchVal)) {
      return;
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td data-label="Typ">${item.type}</td>
      <td data-label="Datum">${item.date}</td>
      <td data-label="Stand">${item.mileage.toLocaleString()}</td>
      <td data-label="Beschreibung">${item.desc}</td>
      <td data-label="Betrag"><strong>${item.amount.toFixed(2)} €</strong></td>
      <td>-</td>
    `;
    tbody.appendChild(tr);
  });
}

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

function renderCustomerServiceTable() {
  const c = getActiveCustomerVehicle();
  const tbody = document.getElementById('custServiceTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!c || !c.services) return;

  c.services.forEach(cs => {
    const tr = document.createElement('tr');
    tr.className = 'clickable-row';
    tr.onclick = (e) => {
      if (e.target.tagName !== 'BUTTON') openCustomerServiceDetailModal(cs.id);
    };

    tr.innerHTML = `
      <td data-label="Datum">${cs.date}</td>
      <td data-label="Titel"><strong>${cs.title}</strong></td>
      <td data-label="KM-Stand">${cs.mileage.toLocaleString()} km</td>
      <td data-label="Gesamt">${cs.totalCost.toFixed(2)} €</td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="editCustomerServiceEntry('${cs.id}')">✏️</button>
        <button class="btn btn-primary btn-sm" onclick="printInvoice('${cs.id}')">🖨️ Drucken</button>
        <button class="btn btn-danger btn-sm" onclick="deleteCustomerServiceEntry('${cs.id}')">🗑️</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

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
    <div class="invoice-box">
      <div class="invoice-header">
        <div>
          <div class="invoice-title">SGS Fahrzeug-Service</div>
          <div class="invoice-subtitle">Smart Garage Solutions & Werkstattdokumentation</div>
        </div>
        <div style="text-align: right;">
          <strong>Datum:</strong> ${cs.date}
        </div>
      </div>

      <div class="invoice-details-grid">
        <div>
          <strong>Kunde / Halter:</strong><br>
          ${c.owner}<br>
          ${c.contact || ''}
        </div>
        <div>
          <strong>Fahrzeug-Daten:</strong><br>
          Modell: ${c.model}<br>
          Kennzeichen: ${c.plate || '-'}<br>
          FIN: ${c.vin || '-'}<br>
          HSN / TSN: ${c.hsn || '-'}${c.tsn ? ' / ' + c.tsn : ''}<br>
          KM-Stand: ${cs.mileage.toLocaleString()} km
        </div>
      </div>

      <h3>${cs.title}</h3>

      <table class="invoice-table">
        <thead>
          <tr>
            <th>Position / Beschreibung</th>
            <th style="text-align: right;">Betrag</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
      </table>

      <div class="invoice-total">
        Gesamtsumme: ${cs.totalCost.toFixed(2)} €
      </div>

      ${cs.notes ? `<div class="invoice-notes"><strong>Arbeitsbericht / Anmerkungen:</strong><br>${cs.notes}</div>` : ''}
      ${imagesHtml}
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
