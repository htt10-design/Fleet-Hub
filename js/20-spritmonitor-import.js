/* ==========================================================================
   IMPORT AUS SPRITMONITOR (Tankungen-Export als .csv)
   Spritmonitor exportiert pro Fahrzeug eine CSV-Datei (Semikolon-getrennt,
   deutsche Zahlen) mit den Spalten u.a.:
   Datum;Km-Stand;Teil-Km;Spritmenge;Kosten;Währung;Tankart;...;Kraftstoff;
   Bemerkung;...;Tankstelle;Land;Großraum;Ort;...
   - Tankart: 1 = voll, 2 = teil, 3 = Erstbetankung (voll), 0 = ungültig
   - Kraftstoff: Nummer -> im Vorschau-Schritt einer Sorte zuordnen
   Tankstelle, Ort und Bemerkung landen in der Notiz. Erneutes Importieren
   überspringt bereits vorhandene Tankungen ("Synchronisieren").
   ========================================================================== */

let spritmonitorParsedFiles = [];

// Vorschläge für die Kraftstoff-Nummern von Spritmonitor (lassen sich im
// Vorschau-Schritt ändern, weil Spritmonitor die Liste nicht offiziell dokumentiert)
const SPRITMONITOR_FUEL_GUESSES = {
  1: 'Diesel', 2: 'Biodiesel', 3: 'Pflanzenöl', 4: 'Premium Diesel', 5: 'Premium Diesel',
  6: 'Super', 7: 'Super', 8: 'Super Plus', 9: 'Super Plus', 10: 'Super Plus',
  12: 'Autogas (LPG)', 13: 'Erdgas (CNG)', 14: 'Erdgas (CNG)', 17: 'Premium Diesel'
};
const SPRITMONITOR_FUEL_HINTS = {
  1: 'Diesel', 6: 'Normalbenzin / Super', 7: 'Super', 8: 'Super Plus', 9: 'V-Power',
  10: 'Ultimate 100', 12: 'Autogas', 13: 'Erdgas H', 14: 'Erdgas L'
};
// Auswahl im Vorschau-Schritt (Wert = gespeicherte Kraftstoff-Bezeichnung)
const SPRITMONITOR_FUEL_OPTIONS = [
  'Super', 'Super Plus', 'Diesel', 'Premium Diesel', 'Autogas (LPG)', 'Erdgas (CNG)', 'Strom'
];

/* --- CSV lesen --- */
function spritmonitorDecode(arrayBuffer) {
  let text = new TextDecoder('utf-8').decode(arrayBuffer);
  // Ältere Exporte sind ggf. Windows-1252 kodiert -> erkennbar an Ersatzzeichen
  if (text.includes('�')) text = new TextDecoder('windows-1252').decode(arrayBuffer);
  return text.replace(/^﻿/, '');
}

// Semikolon-CSV mit Anführungszeichen ("" = escaptes Anführungszeichen)
function spritmonitorParseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ';') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(f => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some(f => f.trim() !== '')) rows.push(row);
  return rows;
}

function spritmonitorNumber(value) {
  const cleaned = String(value || '').trim().replace(/\./g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

// "03.10.2026" -> "2026-10-03"
function spritmonitorDate(value) {
  const m = String(value || '').trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
}

function spritmonitorCapitalize(value) {
  const s = String(value || '').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

// Notiz aus Tankstelle, Ort und Bemerkung, z.B. "Shell, Laboe – Bemerkung"
function spritmonitorBuildNote(station, place, remark) {
  const where = [spritmonitorCapitalize(station), spritmonitorCapitalize(place)].filter(Boolean).join(', ');
  return [where, remark.trim()].filter(Boolean).join(' – ');
}

function spritmonitorExtractFile(fileName, text) {
  const rows = spritmonitorParseCsv(text);
  if (rows.length === 0) throw new Error('Die Datei ist leer.');
  const header = rows[0].map(h => h.trim());
  const col = name => header.indexOf(name);
  const required = ['Datum', 'Km-Stand', 'Spritmenge', 'Kosten'];
  const missing = required.filter(name => col(name) === -1);
  if (missing.length > 0) {
    throw new Error(`Das sieht nicht nach einem Spritmonitor-Tankungen-Export aus (es fehlen die Spalten: ${missing.join(', ')}).`);
  }
  const get = (r, name) => (col(name) === -1 ? '' : (r[col(name)] || ''));

  const fillups = [];
  rows.slice(1).forEach(r => {
    const date = spritmonitorDate(get(r, 'Datum'));
    const liters = Math.round(spritmonitorNumber(get(r, 'Spritmenge')) * 100) / 100;
    if (!date || liters <= 0) return;
    const totalPrice = Math.round(spritmonitorNumber(get(r, 'Kosten')) * 100) / 100;
    const tankType = parseInt(get(r, 'Tankart'), 10);
    fillups.push({
      date,
      mileage: Math.round(spritmonitorNumber(get(r, 'Km-Stand'))),
      liters,
      totalPrice,
      pricePerLiter: liters > 0 ? Math.round((totalPrice / liters) * 1000) / 1000 : 0,
      // 1 = voll, 3 = Erstbetankung (Tank voll) -> beides "voll"; 2 = teil, 0 = ungültig
      full: tankType === 1 || tankType === 3,
      // Erstbetankung: Tank voll, aber Verbrauch davor unbekannt -> Rechnung neu beginnen
      firstFill: tankType === 3,
      fuelCode: String(parseInt(get(r, 'Kraftstoff'), 10) || 0),
      notes: spritmonitorBuildNote(get(r, 'Tankstelle'), get(r, 'Ort'), get(r, 'Bemerkung'))
    });
  });

  // Kraftstoff-Nummern mit Anzahl & Ø-Preis (hilft bei der Zuordnung)
  const fuelCodes = {};
  fillups.forEach(f => {
    if (!fuelCodes[f.fuelCode]) fuelCodes[f.fuelCode] = { code: f.fuelCode, count: 0, liters: 0, cost: 0, first: f.date, last: f.date };
    const c = fuelCodes[f.fuelCode];
    c.count++; c.liters += f.liters; c.cost += f.totalPrice;
    if (f.date < c.first) c.first = f.date;
    if (f.date > c.last) c.last = f.date;
  });
  Object.values(fuelCodes).forEach(c => {
    const guess = SPRITMONITOR_FUEL_GUESSES[c.code];
    c.target = guess && SPRITMONITOR_FUEL_OPTIONS.includes(guess) ? guess : 'Sonstiges';
    c.custom = guess && !SPRITMONITOR_FUEL_OPTIONS.includes(guess) ? guess : (guess ? '' : `Kraftstoff ${c.code}`);
  });

  // Spritmonitor-Fahrzeugnummer steckt im Dateinamen, z.B. "1449200_fuelings.csv"
  const idMatch = fileName.match(/^(\d+)_/);
  const dates = fillups.map(f => f.date).sort();
  const mileages = fillups.map(f => f.mileage).filter(m => m > 0);

  return {
    fileName,
    name: idMatch ? `Spritmonitor-Fahrzeug ${idMatch[1]}` : fileName.replace(/\.csv$/i, ''),
    fillups,
    fuelCodes: Object.values(fuelCodes).sort((a, b) => b.count - a.count),
    firstDate: dates[0] || '',
    lastDate: dates[dates.length - 1] || '',
    minMileage: mileages.length ? Math.min(...mileages) : 0,
    maxMileage: mileages.length ? Math.max(...mileages) : 0,
    selected: true,
    targetMode: appData.activeVehicleId || 'new'
  };
}

/* --- Modal-Steuerung & Ablauf --- */
function spritmonitorShowStep(step) {
  ['smImportStepLoading', 'smImportStepPreview', 'smImportStepResult', 'smImportStepError'].forEach(id => {
    document.getElementById(id).style.display = (id === step) ? '' : 'none';
  });
}

function closeSpritmonitorImportModal() {
  document.getElementById('spritmonitorImportModal').classList.remove('active');
  const input = document.getElementById('spritmonitorFileInput');
  if (input) input.value = '';
  spritmonitorParsedFiles = [];
}
window.closeSpritmonitorImportModal = closeSpritmonitorImportModal;

function showSpritmonitorImportError(message) {
  spritmonitorShowStep('smImportStepError');
  document.getElementById('smImportErrorText').textContent = message;
}

async function handleSpritmonitorFileSelect(event) {
  const files = Array.from(event.target.files || []);
  if (files.length === 0) return;

  spritmonitorShowStep('smImportStepLoading');
  document.getElementById('spritmonitorImportModal').classList.add('active');

  try {
    spritmonitorParsedFiles = [];
    for (const file of files) {
      const text = spritmonitorDecode(await file.arrayBuffer());
      const parsed = spritmonitorExtractFile(file.name, text);
      if (parsed.fillups.length > 0) spritmonitorParsedFiles.push(parsed);
    }
    if (spritmonitorParsedFiles.length === 0) {
      showSpritmonitorImportError('In der Datei wurden keine Tankungen gefunden.');
      return;
    }
    renderSpritmonitorImportPreview();
    spritmonitorShowStep('smImportStepPreview');
  } catch (err) {
    console.error('Spritmonitor-Import Fehler:', err);
    showSpritmonitorImportError(err && err.message ? err.message : String(err));
  }
}
window.handleSpritmonitorFileSelect = handleSpritmonitorFileSelect;

function renderSpritmonitorImportPreview() {
  const container = document.getElementById('smImportFileList');
  const existingVehicles = appData.vehicles.filter(v => !v.archived);

  container.innerHTML = spritmonitorParsedFiles.map((sf, idx) => {
    if (sf.targetMode !== 'new' && !existingVehicles.some(v => v.id === sf.targetMode)) sf.targetMode = 'new';
    const targetOptions = [`<option value="new" ${sf.targetMode === 'new' ? 'selected' : ''}>Neues Fahrzeug anlegen</option>`]
      .concat(existingVehicles.map(v =>
        `<option value="${v.id}" ${sf.targetMode === v.id ? 'selected' : ''}>In "${escapeHtml(v.name)}" einordnen</option>`
      )).join('');

    const fuelRows = sf.fuelCodes.map((c, cIdx) => {
      const avg = c.liters > 0 ? (c.cost / c.liters).toFixed(3).replace('.', ',') : '-';
      const hint = SPRITMONITOR_FUEL_HINTS[c.code] ? ` (Spritmonitor: ${SPRITMONITOR_FUEL_HINTS[c.code]})` : '';
      const options = SPRITMONITOR_FUEL_OPTIONS.map(o => `<option value="${o}" ${c.target === o ? 'selected' : ''}>${o}</option>`).join('')
        + `<option value="Sonstiges" ${c.target === 'Sonstiges' ? 'selected' : ''}>Eigene Bezeichnung …</option>`;
      return `
        <div class="acar-vehicle-card-target sm-fuel-row">
          <label class="acar-fuel-label">Kraftstoff-Nr. ${escapeHtml(c.code)}${hint}: ${c.count} Tankungen · Ø ${avg} €/L · ${formatCostDate(c.first)} – ${formatCostDate(c.last)}</label>
          <select onchange="spritmonitorSetFuelTarget(${idx}, ${cIdx}, this.value)">${options}</select>
          <input type="text" id="smFuelCustom_${idx}_${cIdx}" class="acar-fuel-custom-input" placeholder="z.B. Autogas / E85" value="${escapeHtml(c.custom)}" oninput="spritmonitorSetFuelCustom(${idx}, ${cIdx}, this.value)" style="display: ${c.target === 'Sonstiges' ? '' : 'none'};">
        </div>`;
    }).join('');

    return `
      <div class="acar-vehicle-card">
        <div class="acar-vehicle-card-header">
          <input type="checkbox" ${sf.selected ? 'checked' : ''} onchange="spritmonitorToggleFile(${idx}, this.checked)">
          <div>
            <div class="acar-vehicle-card-title">${escapeHtml(sf.name)}</div>
            <div class="acar-vehicle-card-sub">${formatCostDate(sf.firstDate)} – ${formatCostDate(sf.lastDate)} · ${formatNumberForDisplay(sf.minMileage)} – ${formatNumberForDisplay(sf.maxMileage)} km</div>
            <div class="acar-vehicle-card-counts">${sf.fillups.length} Tankungen</div>
          </div>
        </div>
        <div class="acar-vehicle-card-target">
          <select onchange="spritmonitorSetTarget(${idx}, this.value)">${targetOptions}</select>
          <input type="text" id="smNewName_${idx}" class="acar-fuel-custom-input" placeholder="Name des neuen Fahrzeugs" value="${escapeHtml(sf.newName || '')}" oninput="spritmonitorSetNewName(${idx}, this.value)" style="display: ${sf.targetMode === 'new' ? '' : 'none'};">
        </div>
        ${fuelRows}
      </div>`;
  }).join('');
}

function spritmonitorToggleFile(idx, checked) {
  if (spritmonitorParsedFiles[idx]) spritmonitorParsedFiles[idx].selected = checked;
}
window.spritmonitorToggleFile = spritmonitorToggleFile;

function spritmonitorSetTarget(idx, value) {
  if (!spritmonitorParsedFiles[idx]) return;
  spritmonitorParsedFiles[idx].targetMode = value;
  document.getElementById(`smNewName_${idx}`).style.display = value === 'new' ? '' : 'none';
}
window.spritmonitorSetTarget = spritmonitorSetTarget;

function spritmonitorSetNewName(idx, value) {
  if (spritmonitorParsedFiles[idx]) spritmonitorParsedFiles[idx].newName = value;
}
window.spritmonitorSetNewName = spritmonitorSetNewName;

function spritmonitorSetFuelTarget(idx, cIdx, value) {
  const c = spritmonitorParsedFiles[idx] && spritmonitorParsedFiles[idx].fuelCodes[cIdx];
  if (!c) return;
  c.target = value;
  document.getElementById(`smFuelCustom_${idx}_${cIdx}`).style.display = value === 'Sonstiges' ? '' : 'none';
}
window.spritmonitorSetFuelTarget = spritmonitorSetFuelTarget;

function spritmonitorSetFuelCustom(idx, cIdx, value) {
  const c = spritmonitorParsedFiles[idx] && spritmonitorParsedFiles[idx].fuelCodes[cIdx];
  if (c) c.custom = value;
}
window.spritmonitorSetFuelCustom = spritmonitorSetFuelCustom;

// Bereits vorhanden = gleicher Tag, gleicher KM-Stand (±2) und gleicher Betrag
// oder gleiche Literzahl - so werden auch von Hand erfasste Tankungen erkannt
function spritmonitorFindDuplicate(existing, candidate) {
  return existing.find(f =>
    f.date === candidate.date &&
    Math.abs((f.mileage || 0) - candidate.mileage) < 2 &&
    (Math.abs((f.totalPrice || 0) - candidate.totalPrice) < 0.05 || Math.abs((f.liters || 0) - candidate.liters) < 0.05)
  );
}

function runSpritmonitorImport() {
  let imported = 0, skipped = 0, createdVehicles = 0;

  spritmonitorParsedFiles.forEach(sf => {
    if (!sf.selected) return;

    let target;
    if (sf.targetMode === 'new') {
      target = {
        id: "v_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
        name: (sf.newName || '').trim() || sf.name,
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
      appData.vehicles.push(target);
      createdVehicles++;
    } else {
      target = appData.vehicles.find(v => v.id === sf.targetMode);
    }
    if (!target) return;
    if (!target.fuelEntries) target.fuelEntries = [];

    const fuelNameByCode = {};
    sf.fuelCodes.forEach(c => {
      fuelNameByCode[c.code] = c.target === 'Sonstiges' ? (c.custom.trim() || 'Sonstiges') : c.target;
    });

    sf.fillups.forEach(f => {
      const duplicate = spritmonitorFindDuplicate(target.fuelEntries, f);
      if (duplicate) {
        // Erstbetankungs-Markierung bei früher importierten Tankungen nachtragen
        if (f.firstFill && duplicate.full && !duplicate.firstFill) duplicate.firstFill = true;
        skipped++;
        return;
      }
      target.fuelEntries.push({
        id: "f_" + Date.now() + "_" + Math.floor(Math.random() * 100000),
        date: f.date,
        fuelType: fuelNameByCode[f.fuelCode] || target.fuelType || 'Super',
        mileage: f.mileage,
        liters: f.liters,
        totalPrice: f.totalPrice,
        pricePerLiter: f.pricePerLiter,
        full: f.full,
        firstFill: f.firstFill,
        hasAdditive: false,
        additiveName: '',
        notes: f.notes,
        importSource: 'spritmonitor'
      });
      imported++;
    });

    target.fuelEntries.sort(compareByDateThenMileageDesc);
  });

  saveData();
  renderVehicleSelect();
  renderGarageVehicleTiles();
  loadActiveVehicle();

  const lines = [
    `<div class="acar-import-summary-line"><span>Neue Fahrzeuge angelegt</span><strong>${createdVehicles}</strong></div>`,
    `<div class="acar-import-summary-line"><span>Tankungen importiert</span><strong>${imported}</strong></div>`
  ];
  if (skipped > 0) {
    lines.push(`<div class="acar-import-summary-line"><span>Übersprungen (bereits vorhanden)</span><strong>${skipped}</strong></div>`);
  }
  document.getElementById('smImportResultText').innerHTML = lines.join('');
  spritmonitorShowStep('smImportStepResult');
}
window.runSpritmonitorImport = runSpritmonitorImport;
