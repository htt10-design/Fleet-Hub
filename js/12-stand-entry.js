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
