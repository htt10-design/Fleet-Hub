/* --- TANKEN --- */
function toggleCustomFuelInput() {
  const selectVal = document.getElementById('fuelCategorySelect').value;
  const customGroup = document.getElementById('customFuelGroup');
  if (customGroup) customGroup.style.display = selectVal === 'Sonstiges' ? 'block' : 'none';
}

// "Verbrauch hier neu beginnen" ergibt nur bei einer Volltankung Sinn
function toggleFirstFillOption() {
  const full = document.getElementById('fuelFull').checked;
  const group = document.getElementById('fuelFirstFillGroup');
  if (group) group.style.display = full ? '' : 'none';
  if (!full) document.getElementById('fuelFirstFill').checked = false;
}
window.toggleFirstFillOption = toggleFirstFillOption;

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

  // Tank-Deal-Rabatt in € an die neue Literzahl anpassen
  if (changedField === 'liters' && isFuelDealEnabled()) calcFuelDealDiscount('ct');
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
    firstFill: document.getElementById('fuelFull').checked && document.getElementById('fuelFirstFill').checked,
    hasAdditive: hasAdditive,
    additiveName: hasAdditive ? document.getElementById('fuelAdditiveName').value : '',
    notes: document.getElementById('fuelNotes').value
  };

  // Tank-Deal: nur übernehmen, wenn die Funktion aktiv ist - sonst beim
  // Bearbeiten den bisherigen Wert behalten
  if (isFuelDealEnabled()) {
    entry.dealUsed = document.getElementById('fuelDealUsed').checked;
    entry.dealDiscountCt = entry.dealUsed ? readFuelDealDiscountCt() : null;
  } else if (editId) {
    const previous = (v.fuelEntries || []).find(f => f.id === editId);
    if (previous && previous.dealUsed) {
      entry.dealUsed = true;
      entry.dealDiscountCt = previous.dealDiscountCt ?? null;
    }
  }

  // Herkunft (z.B. Spritmonitor-Import) beim Bearbeiten beibehalten
  if (editId) {
    const previous = (v.fuelEntries || []).find(f => f.id === editId);
    if (previous && previous.importSource) entry.importSource = previous.importSource;
  }

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
  document.getElementById('fuelFirstFill').checked = !!entry.firstFill;
  toggleFirstFillOption();
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
  toggleFirstFillOption();
  document.getElementById('fuelSubmitBtn').innerText = "Tankung Speichern";
  document.getElementById('fuelCancelBtn').style.display = "none";
}

// Formular für neue/bearbeitete Tankungen als Modal öffnen/schließen (FAB-Button)
function openFuelFormModal() {
  syncFuelDealCheckbox();
  document.getElementById('fuelFormModal').classList.add('active');
}
window.openFuelFormModal = openFuelFormModal;

function closeFuelFormModal() {
  document.getElementById('fuelFormModal').classList.remove('active');
  resetFuelForm();
}
window.closeFuelFormModal = closeFuelFormModal;

// Status: Tankungs-Tabelle ausgeklappt?
let showAllFuelEntries = false;

function renderFuelTable() {
  if (typeof renderHistoryTable === 'function') renderHistoryTable();
  renderFuelDealCard();
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
  const consumptionMap = {};
  const unitLabel = v.type === 'km' ? 'L/100km' : 'L/Std';
  getFullToFullSegments(v.fuelEntries).forEach(seg => {
    consumptionMap[seg.entry.id] = `${(seg.liters / seg.dist * 100).toFixed(2)} ${unitLabel}`;
  });

  // 2. Sortierung für die Anzeige in der Tabelle (neueste Einträge zuerst)
  const displaySorted = [...v.fuelEntries].sort(compareByDateThenMileageDesc);

  // 3. Auf max. 5 Einträge begrenzen (falls nicht ausgeklappt)
  const hasMoreThan10 = displaySorted.length > 5;
  const entriesToRender = (hasMoreThan10 && !showAllFuelEntries) 
    ? displaySorted.slice(0, 5) 
    : displaySorted;

  // 4. Tabelle befüllen
  const dealEnabled = isFuelDealEnabled();
  const dealStats = dealEnabled ? computeFuelDealStats(appData.fuelDeal, getLocalDateStr()) : null;
  entriesToRender.forEach(f => {
    const tr = document.createElement('tr');
    const additiveBadge = f.hasAdditive ? `<span class="badge-additive" title="${escapeHtml(f.additiveName)}">🧪 ${escapeHtml(f.additiveName || 'Zusatz')}</span>` : '-';
    const dealSaving = f.dealUsed && dealEnabled ? getFuelDealEntryLabel(dealStats, f.id) : '';
    const dealBadge = f.dealUsed && dealEnabled
      ? ` <span class="badge badge-deal" title="${hasEnteredDealDiscount(f) ? 'Gespart laut Beleg' : 'Gespart, geschätzt mit Durchschnittsrabatt'}">Deal${dealSaving ? ' ' + dealSaving : ''}</span>`
      : '';
    const notesVal = f.notes && f.notes.trim()
      ? `<span class="fuel-note">${escapeHtml(f.notes.trim())}</span>`
      : '-';
    const consumptionVal = f.full
      ? (consumptionMap[f.id] || '-')
      : '<span class="badge badge-partial" title="Teilbetankung – fließt erst in die nächste Volltankung mit ein">Teilbetankung</span>';
    const pricePerLiterVal = f.pricePerLiter ? `${f.pricePerLiter.toFixed(3)} €` : '-';

    tr.innerHTML = `
      <td data-label="Datum">${f.date}</td>
      <td data-label="Kraftstoff"><span>${escapeHtml(f.fuelType)}${dealBadge}</span></td>
      <td data-label="Stand">${f.mileage.toLocaleString()}</td>
      <td data-label="Liter">${f.liters.toFixed(2)} L</td>
      <td data-label="€/Liter">${pricePerLiterVal}</td>
      <td data-label="Verbrauch">${consumptionVal}</td>
      <td data-label="Zusatz">${additiveBadge}</td>
      <td data-label="Notiz" class="fuel-note-cell">${notesVal}</td>
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
