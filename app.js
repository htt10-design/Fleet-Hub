/* --- STATE MANAGEMENT --- */
let appData = {
  activeVehicleId: null,
  vehicles: []
};

let consumptionChartInstance = null;
let costPieChartInstance = null;
let tempServiceImages = [];

// App Start
function initApp() {
  const saved = localStorage.getItem('fleethub_data');
  if (saved) {
    appData = JSON.parse(saved);
  } else {
    // Initialdaten
    appData = {
      activeVehicleId: "v1",
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
            { id: "f1", date: "2026-08-10", mileage: 184200, liters: 72.5, totalPrice: 130.50, pricePerLiter: 1.80, full: true, hasAdditive: true, additiveName: "ERC Benzoinjection Reiniger", notes: "Aral Kiel" },
            { id: "f2", date: "2026-08-28", mileage: 184750, liters: 68.0, totalPrice: 122.40, pricePerLiter: 1.80, full: true, hasAdditive: false, additiveName: "", notes: "Shell" }
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
      ]
    };
    saveData();
  }

  document.getElementById('fuelDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('serviceDate').value = new Date().toISOString().split('T')[0];

  renderVehicleSelect();
  loadActiveVehicle();
}

function saveData() {
  localStorage.setItem('fleethub_data', JSON.stringify(appData));
}

function getActiveVehicle() {
  return appData.vehicles.find(v => v.id === appData.activeVehicleId);
}

/* --- NAVIGATION & TABS --- */
function showTab(tabId, element) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  
  document.getElementById(`tab-${tabId}`).classList.add('active');
  element.classList.add('active');

  if (tabId === 'dashboard') {
    renderDashboard();
  } else if (tabId === 'history') {
    renderHistoryTable();
  }
}

/* --- FAHRZEUG MANAGEMENT --- */
function renderVehicleSelect() {
  const select = document.getElementById('vehicleSelect');
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
  appData.activeVehicleId = document.getElementById('vehicleSelect').value;
  saveData();
  loadActiveVehicle();
}

function loadActiveVehicle() {
  const vehicle = getActiveVehicle();
  if (!vehicle) return;

  const isKm = vehicle.type === 'km';
  document.getElementById('fuelKmLabel').innerText = isKm ? "KM-Stand" : "Betriebsstunden";
  document.getElementById('kpi-mileage-unit').innerText = isKm ? "Kilometerstand" : "Betriebsstunden";

  document.getElementById('vName').value = vehicle.name || '';
  document.getElementById('vPlate').value = vehicle.plate || '';
  document.getElementById('vType').value = vehicle.type || 'km';
  document.getElementById('vFuelType').value = vehicle.fuelType || '';
  document.getElementById('vVin').value = vehicle.vin || '';
  document.getElementById('vFirstReg').value = vehicle.firstReg || '';
  document.getElementById('vHsn').value = vehicle.hsn || '';
  document.getElementById('vTsn').value = vehicle.tsn || '';
  document.getElementById('vPowerHp').value = vehicle.powerHp || '';
  document.getElementById('vTowingBraked').value = vehicle.towingBraked || '';
  document.getElementById('vNextTuev').value = vehicle.nextTuev || '';
  document.getElementById('vSpecs').value = vehicle.specs || '';

  const settingsImgPreview = document.getElementById('vehicleImageSettingsPreview');
  settingsImgPreview.innerHTML = vehicle.image ? `<img src="${vehicle.image}" alt="Fahrzeug">` : '';

  renderFuelTable();
  renderServiceTable();
  renderDashboard();
}

function openVehicleModal() { document.getElementById('vehicleModal').classList.add('active'); }
function closeVehicleModal() { document.getElementById('vehicleModal').classList.remove('active'); }

function createNewVehicle(e) {
  e.preventDefault();
  const name = document.getElementById('newVName').value;
  const type = document.getElementById('newVType').value;
  const mileage = parseFloat(document.getElementById('newVMileage').value) || 0;

  const newV = {
    id: "v_" + Date.now(),
    name: name,
    type: type,
    image: "",
    fuelEntries: [],
    serviceEntries: []
  };

  appData.vehicles.push(newV);
  appData.activeVehicleId = newV.id;
  saveData();
  closeVehicleModal();
  renderVehicleSelect();
  loadActiveVehicle();
}

function deleteCurrentVehicle() {
  if (appData.vehicles.length <= 1) {
    alert("Das letzte verbleibende Fahrzeug kann nicht gelöscht werden.");
    return;
  }
  if (!confirm("Möchtest du dieses Fahrzeug inklusive aller Daten wirklich löschen?")) return;

  appData.vehicles = appData.vehicles.filter(v => v.id !== appData.activeVehicleId);
  appData.activeVehicleId = appData.vehicles[0].id;
  saveData();
  renderVehicleSelect();
  loadActiveVehicle();
}

/* --- FAHRZEUGBILD UPLOAD --- */
function handleVehicleImageUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    const v = getActiveVehicle();
    v.image = e.target.result;
    saveData();
    loadActiveVehicle();
  };
  reader.readAsDataURL(file);
}

function removeVehicleImage() {
  const v = getActiveVehicle();
  v.image = "";
  saveData();
  loadActiveVehicle();
}

function saveVehicleDetails(e) {
  e.preventDefault();
  const v = getActiveVehicle();
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

/* --- FAHRZEUGSCHEIN OCR SCANNER --- */
async function handleRegistrationScan(event) {
  const file = event.target.files[0];
  if (!file) return;

  const statusBox = document.getElementById('ocrRegStatus');
  const statusText = document.getElementById('ocrRegStatusText');
  statusBox.style.display = 'flex';
  statusText.innerText = 'Lese Fahrzeugschein aus...';

  try {
    const worker = await Tesseract.createWorker('deu');
    statusText.innerText = 'Erkenne Feldwerte...';

    const ret = await worker.recognize(file);
    await worker.terminate();

    parseRegistrationOCR(ret.data.text);
    statusBox.style.display = 'none';
  } catch (err) {
    console.error(err);
    alert("Fehler beim Scannen des Fahrzeugscheins.");
    statusBox.style.display = 'none';
  }
}

function parseRegistrationOCR(text) {
  // FIN (Feld E): 17-stellige VIN
  const vinMatch = text.match(/\b([A-HJ-NPR-Z0-9]{17})\b/i);
  if (vinMatch) {
    document.getElementById('vVin').value = vinMatch[1].toUpperCase();
  }

  // Erstzulassung (Feld B): DD.MM.YYYY -> YYYY-MM-DD
  const dateMatch = text.match(/\b(\d{2})\.(\d{2})\.(\d{4})\b/);
  if (dateMatch) {
    document.getElementById('vFirstReg').value = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
  }

  // HSN (Feld 2.1): 4-stellige Nummer
  const hsnMatch = text.match(/2\.1[^\d]*(\d{4})/i);
  if (hsnMatch) {
    document.getElementById('vHsn').value = hsnMatch[1];
  }

  // TSN (Feld 2.2): Erste 3-4 Alphanumerische Zeichen
  const tsnMatch = text.match(/2\.2[^\w]*([A-Z0-9]{3,4})/i);
  if (tsnMatch) {
    document.getElementById('vTsn').value = tsnMatch[1].toUpperCase();
  }

  // Leistung in kW (Feld P.2 / P.4) -> Umrechnung in PS (1 kW = 1.35962 PS)
  const powerMatch = text.match(/P\.2[^\d]*(\d{2,4})/i) || text.match(/(\d{2,3})\s*kW/i);
  if (powerMatch) {
    const kw = parseInt(powerMatch[1], 10);
    if (!isNaN(kw)) {
      document.getElementById('vPowerHp').value = Math.round(kw * 1.35962);
    }
  }

  // Anhängelast gebremst (Feld O.1 in kg)
  const towingMatch = text.match(/O\.1[^\d]*(\d{3,4})/i);
  if (towingMatch) {
    document.getElementById('vTowingBraked').value = towingMatch[1];
  }

  // Kennzeichen (Feld A)
  const plateMatch = text.match(/A[.\s]+([A-Z]{1,3}[-\s]?[A-Z]{1,2}\s?\d{1,4})/i);
  if (plateMatch) {
    document.getElementById('vPlate').value = plateMatch[1].toUpperCase();
  }

  alert("Fahrzeugschein gescannt! Bitte überprüfe die ausgelesenen Werte in den Feldern.");
}

/* --- ADDITIV / ZUSATZ TOGGLE --- */
function toggleAdditiveInput() {
  const hasAdd = document.getElementById('fuelHasAdditive').checked;
  const group = document.getElementById('fuelAdditiveGroup');
  group.style.display = hasAdd ? 'block' : 'none';
  if (!hasAdd) document.getElementById('fuelAdditiveName').value = '';
}

/* --- TANKBELEG OCR SCANNER --- */
async function handleOCRScan(event) {
  const file = event.target.files[0];
  if (!file) return;

  const statusBox = document.getElementById('ocrStatus');
  const statusText = document.getElementById('ocrStatusText');
  statusBox.style.display = 'flex';
  statusText.innerText = 'Lese Bilddaten aus...';

  try {
    const worker = await Tesseract.createWorker('deu');
    statusText.innerText = 'Erkenne Text (OCR)...';
    
    const ret = await worker.recognize(file);
    await worker.terminate();
    
    const text = ret.data.text;
    parseOCRResults(text);
    
    statusBox.style.display = 'none';
  } catch (err) {
    console.error(err);
    alert("Fehler beim Verarbeiten des Bildes.");
    statusBox.style.display = 'none';
  }
}

function parseOCRResults(text) {
  const lines = text.split('\n');
  let foundTotal = null;
  let foundLiters = null;

  const amountRegex = /(\d+[.,]\d{2})/;

  lines.forEach(line => {
    if (line.toLowerCase().includes('eur') || line.toLowerCase().includes('gesamt') || line.toLowerCase().includes('summe')) {
      const match = line.match(amountRegex);
      if (match) foundTotal = match[1].replace(',', '.');
    }
    if (line.toLowerCase().includes('liter') || line.toLowerCase().includes(' l ')) {
      const match = line.match(amountRegex);
      if (match) foundLiters = match[1].replace(',', '.');
    }
  });

  if (foundTotal) document.getElementById('fuelTotalPrice').value = parseFloat(foundTotal).toFixed(2);
  if (foundLiters) document.getElementById('fuelLiters').value = parseFloat(foundLiters).toFixed(2);

  calcFuelFields('total');
  alert("OCR-Scan abgeschlossen! Bitte überprüfe die übertragenen Werte.");
}

/* --- TANKUNGEN (CRUD) --- */
function calcFuelFields(changedField) {
  const liters = parseFloat(document.getElementById('fuelLiters').value) || 0;
  const total = parseFloat(document.getElementById('fuelTotalPrice').value) || 0;
  const ppl = parseFloat(document.getElementById('fuelPricePerLiter').value) || 0;

  if (changedField === 'liters' && ppl > 0) {
    document.getElementById('fuelTotalPrice').value = (liters * ppl).toFixed(2);
  } else if (changedField === 'total' && liters > 0) {
    document.getElementById('fuelPricePerLiter').value = (total / liters).toFixed(3);
  } else if (changedField === 'ppl' && liters > 0) {
    document.getElementById('fuelTotalPrice').value = (liters * ppl).toFixed(2);
  }
}

function saveFuelEntry(e) {
  e.preventDefault();
  const v = getActiveVehicle();
  const editId = document.getElementById('fuelEditId').value;
  const hasAdditive = document.getElementById('fuelHasAdditive').checked;

  const entry = {
    id: editId ? editId : "f_" + Date.now(),
    date: document.getElementById('fuelDate').value,
    mileage: parseFloat(document.getElementById('fuelMileage').value) || 0,
    liters: parseFloat(document.getElementById('fuelLiters').value) || 0,
    totalPrice: parseFloat(document.getElementById('fuelTotalPrice').value) || 0,
    pricePerLiter: parseFloat(document.getElementById('fuelPricePerLiter').value) || 0,
    full: document.getElementById('fuelFull').checked,
    hasAdditive: hasAdditive,
    additiveName: hasAdditive ? document.getElementById('fuelAdditiveName').value : '',
    notes: document.getElementById('fuelNotes').value
  };

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
  const entry = v.fuelEntries.find(f => f.id === id);
  if (!entry) return;

  document.getElementById('fuelEditId').value = entry.id;
  document.getElementById('fuelDate').value = entry.date;
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
}

function deleteFuelEntry(id) {
  if (!confirm("Diesen Tankeintrag wirklich löschen?")) return;
  const v = getActiveVehicle();
  v.fuelEntries = v.fuelEntries.filter(f => f.id !== id);
  saveData();
  renderFuelTable();
  renderDashboard();
}

function resetFuelForm() {
  document.getElementById('fuelEditId').value = '';
  document.getElementById('fuelForm').reset();
  document.getElementById('fuelDate').value = new Date().toISOString().split('T')[0];
  toggleAdditiveInput();
  document.getElementById('fuelSubmitBtn').innerText = "Tankung Speichern";
  document.getElementById('fuelCancelBtn').style.display = "none";
}

function renderFuelTable() {
  const v = getActiveVehicle();
  const tbody = document.getElementById('fuelTableBody');
  tbody.innerHTML = '';

  v.fuelEntries.forEach(f => {
    const tr = document.createElement('tr');
    const additiveBadge = f.hasAdditive ? `<span class="badge-additive" title="${f.additiveName || ''}">🧪 ${f.additiveName || 'Zusatz'}</span>` : '-';
    tr.innerHTML = `
      <td>${f.date}</td>
      <td>${f.mileage}</td>
      <td>${f.liters.toFixed(2)} L</td>
      <td>${additiveBadge}</td>
      <td>${f.totalPrice.toFixed(2)} €</td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="editFuelEntry('${f.id}')">✏️</button>
        <button class="btn btn-danger btn-sm" onclick="deleteFuelEntry('${f.id}')">🗑️</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

/* --- WARTUNGS-BILDER --- */
function handleServiceImageUpload(event) {
  const files = Array.from(event.target.files);
  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = function(e) {
      tempServiceImages.push(e.target.result);
      renderServiceImagePreviews();
    };
    reader.readAsDataURL(file);
  });
}

function removeTempServiceImage(index) {
  tempServiceImages.splice(index, 1);
  renderServiceImagePreviews();
}

function renderServiceImagePreviews() {
  const container = document.getElementById('serviceImagePreviewContainer');
  container.innerHTML = '';
  tempServiceImages.forEach((imgSrc, idx) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'preview-thumb-wrapper';
    wrapper.innerHTML = `
      <img src="${imgSrc}" class="preview-thumb">
      <button type="button" class="btn-remove-thumb" onclick="removeTempServiceImage(${idx})">✕</button>
    `;
    container.appendChild(wrapper);
  });
}

/* --- WARTUNGEN (CRUD & DETAILS) --- */
function saveServiceEntry(e) {
  e.preventDefault();
  const v = getActiveVehicle();
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

function editServiceEntry(id) {
  const v = getActiveVehicle();
  const entry = v.serviceEntries.find(s => s.id === id);
  if (!entry) return;

  closeServiceDetailModal();

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
}

function deleteServiceEntry(id) {
  if (!confirm("Diesen Wartungseintrag wirklich löschen?")) return;
  const v = getActiveVehicle();
  v.serviceEntries = v.serviceEntries.filter(s => s.id !== id);
  saveData();
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
  tbody.innerHTML = '';

  v.serviceEntries.forEach(s => {
    const tr = document.createElement('tr');
    tr.className = 'clickable-row';
    const hasImg = s.images && s.images.length > 0 ? ` 📷(${s.images.length})` : '';
    tr.innerHTML = `
      <td onclick="openServiceDetailModal('${s.id}')">${s.date}</td>
      <td onclick="openServiceDetailModal('${s.id}')"><span class="badge">${s.category}</span></td>
      <td onclick="openServiceDetailModal('${s.id}')"><strong>${s.title}</strong>${hasImg}</td>
      <td onclick="openServiceDetailModal('${s.id}')">${s.cost.toFixed(2)} €</td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); editServiceEntry('${s.id}')">✏️</button>
        <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); deleteServiceEntry('${s.id}')">🗑️</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

/* --- WARTUNG DETAILS MODAL --- */
function openServiceDetailModal(id) {
  const v = getActiveVehicle();
  const entry = v.serviceEntries.find(s => s.id === id);
  if (!entry) return;

  const unit = v.type === 'km' ? 'km' : 'h';
  document.getElementById('sdTitle').innerText = entry.title;
  document.getElementById('sdCategory').innerText = entry.category;
  document.getElementById('sdDate').innerText = entry.date;
  document.getElementById('sdMileage').innerText = `${entry.mileage} ${unit}`;
  document.getElementById('sdCost').innerText = `${entry.cost.toFixed(2)} €`;
  document.getElementById('sdPerformer').innerText = entry.performer;
  document.getElementById('sdNotes').innerText = entry.notes || 'Keine Notizen angegeben.';

  const gallery = document.getElementById('sdImagesContainer');
  gallery.innerHTML = '';

  if (entry.images && entry.images.length > 0) {
    entry.images.forEach(imgSrc => {
      const wrapper = document.createElement('div');
      wrapper.className = 'gallery-img-wrapper';
      wrapper.innerHTML = `<img src="${imgSrc}" onclick="window.open('${imgSrc}', '_blank')">`;
      gallery.appendChild(wrapper);
    });
  } else {
    gallery.innerHTML = '<span class="text-muted">Keine Bilder vorhanden.</span>';
  }

  document.getElementById('sdEditBtn').onclick = () => editServiceEntry(entry.id);
  document.getElementById('serviceDetailModal').classList.add('active');
}

function closeServiceDetailModal() {
  document.getElementById('serviceDetailModal').classList.remove('active');
}

/* --- CHRONIK / HISTORIE --- */
function renderHistoryTable() {
  const v = getActiveVehicle();
  const tbody = document.getElementById('fullHistoryTableBody');
  const search = document.getElementById('historySearch').value.toLowerCase();
  tbody.innerHTML = '';

  let all = [];
  v.fuelEntries.forEach(f => all.push({
    type: 'Fuel',
    id: f.id,
    date: f.date,
    mileage: f.mileage,
    desc: `Tankung: ${f.liters.toFixed(2)}L ${f.hasAdditive ? '[Zusatz: ' + f.additiveName + ']' : ''} (${f.notes || ''})`,
    cost: f.totalPrice
  }));

  v.serviceEntries.forEach(s => all.push({
    type: 'Service',
    id: s.id,
    date: s.date,
    mileage: s.mileage,
    desc: `${s.category}: ${s.title} (${s.notes || ''})`,
    cost: s.cost
  }));

  all.sort((a,b) => new Date(b.date) - new Date(a.date));

  all.filter(item => item.desc.toLowerCase().includes(search) || item.date.includes(search))
     .forEach(item => {
       const tr = document.createElement('tr');
       tr.innerHTML = `
         <td>${item.type === 'Fuel' ? '⛽ Tanken' : '🔧 Service'}</td>
         <td>${item.date}</td>
         <td>${item.mileage}</td>
         <td>${item.desc}</td>
         <td>${item.cost.toFixed(2)} €</td>
         <td>
           <button class="btn btn-secondary btn-sm" onclick="${item.type === 'Fuel' ? `showTab('fuel', document.querySelectorAll('.nav-item')[1]); editFuelEntry('${item.id}')` : `openServiceDetailModal('${item.id}')`}">👁️ / ✏️</button>
         </td>
       `;
       tbody.appendChild(tr);
     });
}

/* --- DASHBOARD, KENNZAHLEN & CHARTS --- */
function renderDashboard() {
  const v = getActiveVehicle();
  if (!v) return;

  document.getElementById('dashVehicleName').innerText = v.name;
  document.getElementById('dashVehiclePlate').innerText = v.plate || 'OHNE KENNZEICHEN';
  document.getElementById('dashVehicleFuel').innerText = `Kraftstoff: ${v.fuelType || '-'}`;
  document.getElementById('dashVehicleType').innerText = `Typ: ${v.type === 'km' ? 'Kilometer (km)' : 'Betriebsstunden (h)'}`;
  document.getElementById('dashVehicleVin').innerText = `VIN: ${v.vin || '-'}`;

  const powerText = v.powerHp ? `${v.powerHp} PS` : '';
  const hsnTsnText = (v.hsn || v.tsn) ? `HSN/TSN: ${v.hsn || '-'}/${v.tsn || '-'}` : '';
  const firstRegText = v.firstReg ? `EZ: ${v.firstReg}` : '';
  const towingText = v.towingBraked ? `Anhängelast: ${v.towingBraked} kg` : '';

  const detailsLine = [powerText, hsnTsnText, firstRegText, towingText].filter(Boolean).join(' | ');

  document.getElementById('dashVehicleSpecs').innerText = detailsLine 
    ? `${detailsLine}\n\n${v.specs || ''}` 
    : (v.specs || 'Keine Notizen/Spezifikationen hinterlegt.');

  const imgElement = document.getElementById('vehicleDashboardImage');
  const imgPlaceholder = document.getElementById('vehicleImagePlaceholder');
  if (v.image) {
    imgElement.src = v.image;
    imgElement.style.display = 'block';
    imgPlaceholder.style.display = 'none';
  } else {
    imgElement.style.display = 'none';
    imgPlaceholder.style.display = 'block';
  }

  let maxMileage = 0;
  v.fuelEntries.forEach(f => { if(f.mileage > maxMileage) maxMileage = f.mileage; });
  v.serviceEntries.forEach(s => { if(s.mileage > maxMileage) maxMileage = s.mileage; });
  document.getElementById('kpi-mileage').innerText = maxMileage > 0 ? maxMileage.toLocaleString() + (v.type === 'km' ? ' km' : ' h') : '0';

  let totalFuelCost = 0;
  v.fuelEntries.forEach(f => totalFuelCost += f.totalPrice);

  let totalServiceCost = 0;
  v.serviceEntries.forEach(s => totalServiceCost += s.cost);

  document.getElementById('kpi-total-cost').innerText = (totalFuelCost + totalServiceCost).toFixed(2) + ' €';

  let avgConsumption = 0;
  if (v.fuelEntries.length >= 2) {
    const sortedFuel = [...v.fuelEntries].sort((a,b) => a.mileage - b.mileage);
    const first = sortedFuel[0];
    const last = sortedFuel[sortedFuel.length - 1];
    const dist = last.mileage - first.mileage;
    
    let litersSum = 0;
    for(let i = 1; i < sortedFuel.length; i++) litersSum += sortedFuel[i].liters;

    if (dist > 0) {
      avgConsumption = (litersSum / dist) * 100;
    }
  }
  
  const unitLabel = v.type === 'km' ? ' L/100km' : ' L/Std';
  document.getElementById('kpi-consumption').innerHTML = `${avgConsumption.toFixed(2)} <small>${unitLabel}</small>`;

  if (maxMileage > 0 && totalFuelCost > 0) {
    document.getElementById('kpi-cost-per-km').innerText = (totalFuelCost / maxMileage * 100).toFixed(2) + ' € / 100km';
  }

  const reminderList = document.getElementById('reminderList');
  reminderList.innerHTML = '';
  if (v.nextTuev) {
    const li = document.createElement('li');
    li.innerHTML = `📅 Nächster TÜV / Hauptuntersuchung: <strong>${v.nextTuev}</strong>`;
    reminderList.appendChild(li);
  }

  renderCharts(v);
}

function renderCharts(v) {
  const ctxLine = document.getElementById('consumptionChart').getContext('2d');
  const sortedFuel = [...v.fuelEntries].sort((a,b) => new Date(a.date) - new Date(b.date));

  const labels = sortedFuel.map(f => f.date);
  const dataPoints = sortedFuel.map(f => f.pricePerLiter);

  if (consumptionChartInstance) consumptionChartInstance.destroy();

  consumptionChartInstance = new Chart(ctxLine, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Spritpreis (€/L)',
        data: dataPoints,
        borderColor: '#2563eb',
        backgroundColor: 'rgba(37, 99, 235, 0.1)',
        fill: true,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#94a3b8' }, grid: { color: '#334155' } },
        y: { ticks: { color: '#94a3b8' }, grid: { color: '#334155' } }
      }
    }
  });

  const ctxPie = document.getElementById('costPieChart').getContext('2d');
  let fuelCost = v.fuelEntries.reduce((sum, f) => sum + f.totalPrice, 0);
  let serviceCost = v.serviceEntries.reduce((sum, s) => sum + s.cost, 0);

  if (costPieChartInstance) costPieChartInstance.destroy();

  costPieChartInstance = new Chart(ctxPie, {
    type: 'doughnut',
    data: {
      labels: ['Treibstoff', 'Wartung / Reparatur'],
      datasets: [{
        data: [fuelCost, serviceCost],
        backgroundColor: ['#2563eb', '#10b981']
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { color: '#f8fafc' } } }
    }
  });
}

document.addEventListener('DOMContentLoaded', initApp);
