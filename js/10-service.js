/* --- WARTUNG & SERVICE --- */

// Blendet die Wiederholungs-Erinnerung (KM/Datum) nur bei Kategorie "Wartung" ein
function toggleRoutineIntervalFields() {
  const category = document.getElementById('serviceCategory').value;
  const container = document.getElementById('routineIntervalContainer');

  // Hinweis auf den geführten TÜV-Assistenten, wenn hier die Kategorie "TÜV" gewählt wird
  const tuevHint = document.getElementById('tuevWizardFormHint');
  if (tuevHint) tuevHint.style.display = category === 'TÜV' ? '' : 'none';

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

// Status: Wartungstabelle ausgeklappt?
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
      <td data-label="Titel"><strong>${s.title || 'Wartung'}</strong>${engineTagHtml}</td>
      <td data-label="Kategorie"><span class="badge">${s.category || 'Allgemein'}</span></td>
      <td data-label="Datum">${s.date || '-'}</td>
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

  const entry = v.serviceEntries.find(s => s.id === id);
  v.serviceEntries = v.serviceEntries.filter(s => s.id !== id);

  // Wurde dieser Eintrag vom TÜV-Assistenten angelegt und hat dabei die
  // TÜV-Plakette (v.nextTuev) neu gesetzt, dann beim Löschen wieder auf den
  // Stand davor zurücksetzen (ggf. wieder "keine Plakette hinterlegt")
  if (entry && entry.tuevUpdatedNextTuev) {
    v.nextTuev = entry.tuevPrevDueDate || null;
  }

  saveData();
  renderServiceTable();
  renderDashboard();
  renderGarageVehicleTiles();
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
