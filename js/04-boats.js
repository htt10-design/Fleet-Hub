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
