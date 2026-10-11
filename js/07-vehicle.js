function loadActiveVehicle() {
  const vehicle = getActiveVehicle();
  if (!vehicle) return;

  // Kategorie-Auswahl neu aufbauen, BEVOR der Wert gesetzt wird - sonst würde
  // eine inzwischen deaktivierte Kategorie (Boot/Anhänger) nicht als Option
  // existieren und die Auswahl bliebe leer stehen
  populateVehicleCategorySelect(document.getElementById('vCategory'), vehicle.category || 'auto');

  const fields = {
    'vName': vehicle.name || '',
    'vPlate': vehicle.plate || '',
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

  // Reifen-Tab (nur relevant bei Auto/Anhänger, s. updateNavForCategory)
  renderTireSection(vehicle);

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

  // Kategorie-Auswahl neu aufbauen (nur aktuell aktivierte Fahrzeugarten),
  // dann Fahrzeugart im Formular passend zum aktuell gewählten Filter vorauswählen
  const categoryEl = document.getElementById('newVCategory');
  populateVehicleCategorySelect(categoryEl);
  if (categoryEl) {
    const preselect = (vehicleCategoryFilter === 'all') ? 'auto' : vehicleCategoryFilter;
    // Falls der vorausgewählte Filter-Wert gerade keine gültige Option mehr ist
    // (z.B. Kategorie zwischenzeitlich deaktiviert), auf "Auto" zurückfallen
    const hasOption = Array.from(categoryEl.options).some(o => o.value === preselect);
    categoryEl.value = hasOption ? preselect : 'auto';
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
    serviceEntries: [],
    tireSets: [],
    tireApprovedCombos: ""
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
