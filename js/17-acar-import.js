/* ==========================================================================
   IMPORT AUS ACAR (.abp)
   Eine .abp-Datei ist ein ganz normales ZIP-Archiv, das u.a. eine
   vehicles.xml mit allen Fahrzeugen, Tankeinträgen und Wartungen enthält.
   Wird komplett im Browser gelesen (ZIP entpacken + XML parsen) - kein
   Server, keine externe Bibliothek nötig.
   ========================================================================== */

let acarImportParsedVehicles = []; // Zwischenergebnis der zuletzt gelesenen Datei

/* --- Minimaler ZIP-Reader (nur lesend, unterstützt "stored" & "deflate") --- */
function acarReadUint32LE(dv, off) { return dv.getUint32(off, true); }
function acarReadUint16LE(dv, off) { return dv.getUint16(off, true); }

async function acarInflateRaw(uint8arr) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([uint8arr]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

async function acarReadZip(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const dv = new DataView(arrayBuffer);

  // End-Of-Central-Directory-Record suchen (rückwärts ab Dateiende)
  const EOCD_SIG = 0x06054b50;
  let eocdOffset = -1;
  const maxBack = Math.min(bytes.length, 65557);
  for (let i = bytes.length - 22; i >= bytes.length - maxBack && i >= 0; i--) {
    if (acarReadUint32LE(dv, i) === EOCD_SIG) { eocdOffset = i; break; }
  }
  if (eocdOffset === -1) throw new Error('Kein gültiges ZIP-Archiv (evtl. keine echte .abp-Datei)');

  const entryCount = acarReadUint16LE(dv, eocdOffset + 10);
  const cdOffset = acarReadUint32LE(dv, eocdOffset + 16);

  const files = {};
  const CD_SIG = 0x02014b50;
  const LFH_SIG = 0x04034b50;
  const textDecoder = new TextDecoder('utf-8');

  let offset = cdOffset;
  for (let i = 0; i < entryCount; i++) {
    if (acarReadUint32LE(dv, offset) !== CD_SIG) throw new Error('ZIP-Archiv beschädigt (Central Directory)');
    const compressionMethod = acarReadUint16LE(dv, offset + 10);
    const compressedSize = acarReadUint32LE(dv, offset + 20);
    const fileNameLen = acarReadUint16LE(dv, offset + 28);
    const extraLen = acarReadUint16LE(dv, offset + 30);
    const commentLen = acarReadUint16LE(dv, offset + 32);
    const localHeaderOffset = acarReadUint32LE(dv, offset + 42);
    const nameBytes = bytes.slice(offset + 46, offset + 46 + fileNameLen);
    const fileName = textDecoder.decode(nameBytes);

    if (acarReadUint32LE(dv, localHeaderOffset) !== LFH_SIG) throw new Error('ZIP-Archiv beschädigt (Local File Header)');
    const lfhNameLen = acarReadUint16LE(dv, localHeaderOffset + 26);
    const lfhExtraLen = acarReadUint16LE(dv, localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + lfhNameLen + lfhExtraLen;
    const rawData = bytes.slice(dataStart, dataStart + compressedSize);

    let data;
    if (compressionMethod === 0) {
      data = rawData;
    } else if (compressionMethod === 8) {
      data = await acarInflateRaw(rawData);
    } else {
      throw new Error('Nicht unterstützte ZIP-Kompression (Methode ' + compressionMethod + ')');
    }
    files[fileName] = data;

    offset += 46 + fileNameLen + extraLen + commentLen;
  }
  return files;
}

/* --- Hilfsfunktionen für die XML-Auswertung --- */
function acarXmlText(parentNode, tagName) {
  const el = parentNode.querySelector(tagName);
  return el ? (el.textContent || '') : '';
}

// aCar-Datumsformat "MM/DD/YYYY - HH:MM" -> "YYYY-MM-DD"
function acarParseDate(str) {
  const fallback = new Date().toISOString().split('T')[0];
  if (!str) return fallback;
  const m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return fallback;
  return `${m[3]}-${m[1]}-${m[2]}`;
}

const ACAR_DISTANCE_FACTORS = { kilometer: 1, mile: 1.609344 };
const ACAR_VOLUME_FACTORS = { liter: 1, 'gallon-us': 3.785412, 'gallon-imperial': 4.546092 };

function acarExtractVehicles(vehiclesDoc, fuelTypeMap, subtypeMap) {
  const result = [];
  const vehicleNodes = vehiclesDoc.querySelectorAll('vehicles > vehicle');

  vehicleNodes.forEach(vNode => {
    const name = acarXmlText(vNode, 'name') || 'Unbenanntes Fahrzeug';
    const make = acarXmlText(vNode, 'make');
    const model = acarXmlText(vNode, 'model');
    const year = acarXmlText(vNode, 'year');
    const engine = acarXmlText(vNode, 'engine');
    const distanceUnit = acarXmlText(vNode, 'distance-unit') || 'kilometer';
    const volumeUnit = acarXmlText(vNode, 'volume-unit') || 'liter';
    const distanceFactor = ACAR_DISTANCE_FACTORS[distanceUnit] || 1;
    const volumeFactor = ACAR_VOLUME_FACTORS[volumeUnit] || 1;

    // aCar trägt oft keinen Kraftstoff pro Tankeintrag ein (fuel-type-id -1),
    // dafür steckt im Motor-Feld meist ein verlässlicher Hinweis (z.B.
    // "L4 DIESEL", "3,0L V6 DIESEL", "L6 GAS") - daraus einen Vorschlag
    // ableiten, den man im Vorschau-Schritt noch anpassen kann.
    const engineUpper = engine.toUpperCase();
    let guessedFuelType = 'Super';
    if (engineUpper.includes('DIESEL') || engineUpper.includes('TDI') || engineUpper.includes('CDI') || engineUpper.includes('HDI')) {
      guessedFuelType = 'Diesel';
    } else if (engineUpper.includes('ELECTRIC') || engineUpper.includes('EV')) {
      guessedFuelType = 'Strom';
    } else if (engineUpper.includes('GAS') || engineUpper.includes('PETROL') || engineUpper.includes('GASOLINE')) {
      guessedFuelType = 'Super';
    }

    const fillups = [];
    vNode.querySelectorAll(':scope > fillup-records > fillup-record').forEach(fNode => {
      const rawMileage = parseFloat(acarXmlText(fNode, 'odometer-reading')) || 0;
      const rawLiters = parseFloat(acarXmlText(fNode, 'volume')) || 0;
      const totalPrice = parseFloat(acarXmlText(fNode, 'total-cost')) || 0;
      const liters = Math.round(rawLiters * volumeFactor * 100) / 100;
      const mileage = Math.round(rawMileage * distanceFactor);
      const fuelTypeId = acarXmlText(fNode, 'fuel-type-id');
      const fuelTypeName = (fuelTypeId && fuelTypeId !== '-1' && fuelTypeMap[fuelTypeId]) ? fuelTypeMap[fuelTypeId] : '';
      const hasAdditive = acarXmlText(fNode, 'has-fuel-additive') === 'true';

      fillups.push({
        date: acarParseDate(acarXmlText(fNode, 'date')),
        fuelType: fuelTypeName, // leer = beim Import Fahrzeug-Standardkraftstoff verwenden
        mileage: mileage,
        liters: liters,
        totalPrice: Math.round(totalPrice * 100) / 100,
        pricePerLiter: liters > 0 ? Math.round((totalPrice / liters) * 1000) / 1000 : 0,
        full: acarXmlText(fNode, 'partial') !== 'true',
        hasAdditive: hasAdditive,
        additiveName: hasAdditive ? acarXmlText(fNode, 'fuel-additive-name') : '',
        notes: acarXmlText(fNode, 'notes')
      });
    });

    const services = [];
    vNode.querySelectorAll(':scope > event-records > event-record').forEach(eNode => {
      const type = acarXmlText(eNode, 'type');
      const rawMileage = parseFloat(acarXmlText(eNode, 'odometer-reading')) || 0;
      const mileage = Math.round(rawMileage * distanceFactor);
      const cost = parseFloat(acarXmlText(eNode, 'total-cost')) || 0;

      const subtypeIds = Array.from(eNode.querySelectorAll('subtypes > subtype')).map(s => s.getAttribute('id'));
      const subtypeNames = subtypeIds.map(id => subtypeMap[id]).filter(Boolean);
      let title = subtypeNames.length > 0 ? subtypeNames.join(', ') : null;

      let category = 'Sonstiges';
      if (type === 'service') { category = 'Wartung'; if (!title) title = 'Wartung (aCar-Import)'; }
      else if (type === 'expense') { if (!title) title = 'Sonstige Ausgabe (aCar-Import)'; }
      else if (type === 'purchased') { title = 'Fahrzeugkauf'; }
      else if (!title) { title = 'Eintrag (aCar-Import)'; }

      // Eingebettete Beleg-Fotos übernehmen (aCar speichert sie als reines
      // Base64 ohne Data-URI-Prefix)
      const images = [];
      eNode.querySelectorAll(':scope > photos').forEach(pNode => {
        const b64 = (pNode.textContent || '').trim();
        if (b64) images.push('data:image/jpeg;base64,' + b64);
      });

      services.push({
        category: category,
        title: title,
        date: acarParseDate(acarXmlText(eNode, 'date')),
        mileage: mileage,
        cost: Math.round(cost * 100) / 100,
        notes: acarXmlText(eNode, 'notes'),
        images: images
      });
    });

    result.push({
      name: name,
      make: make,
      model: model,
      year: year,
      fillups: fillups,
      services: services,
      selected: true,
      targetMode: 'new', // 'new' oder die id eines bestehenden Fahrzeugs
      defaultFuelType: guessedFuelType,
      defaultFuelTypeCustom: '' // nur befüllt, wenn "Sonstiges" gewählt wurde
    });
  });

  return result;
}

/* --- Modal-Steuerung & Ablauf --- */
function acarShowStep(step) {
  ['acarImportStepLoading', 'acarImportStepPreview', 'acarImportStepResult', 'acarImportStepError'].forEach(id => {
    document.getElementById(id).style.display = (id === step) ? '' : 'none';
  });
}

function openAcarImportModal() {
  acarShowStep('acarImportStepLoading');
  document.getElementById('acarImportModal').classList.add('active');
}
window.openAcarImportModal = openAcarImportModal;

function closeAcarImportModal() {
  document.getElementById('acarImportModal').classList.remove('active');
  const input = document.getElementById('acarFileInput');
  if (input) input.value = '';
  acarImportParsedVehicles = [];
}
window.closeAcarImportModal = closeAcarImportModal;

function showAcarImportError(message) {
  acarShowStep('acarImportStepError');
  document.getElementById('acarImportErrorText').textContent = message;
}

async function handleAcarFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  openAcarImportModal();

  try {
    const arrayBuffer = await file.arrayBuffer();
    const zipFiles = await acarReadZip(arrayBuffer);

    if (!zipFiles['vehicles.xml']) {
      showAcarImportError('In der Datei wurde keine vehicles.xml gefunden - ist das wirklich ein vollständiges aCar-Backup (.abp)?');
      return;
    }

    const decoder = new TextDecoder('utf-8');
    const vehiclesXml = decoder.decode(zipFiles['vehicles.xml']);
    const fuelTypesXml = zipFiles['fuel-types.xml'] ? decoder.decode(zipFiles['fuel-types.xml']) : '';
    const subtypesXml = zipFiles['event-subtypes.xml'] ? decoder.decode(zipFiles['event-subtypes.xml']) : '';

    const parser = new DOMParser();
    const vehiclesDoc = parser.parseFromString(vehiclesXml, 'application/xml');
    if (vehiclesDoc.querySelector('parsererror')) {
      showAcarImportError('Die vehicles.xml in der Datei ist fehlerhaft und konnte nicht gelesen werden.');
      return;
    }

    const fuelTypeMap = {};
    if (fuelTypesXml) {
      const fuelTypesDoc = parser.parseFromString(fuelTypesXml, 'application/xml');
      fuelTypesDoc.querySelectorAll('fuel-type').forEach(node => {
        const id = node.getAttribute('id');
        const nameEl = node.querySelector('name');
        if (id && nameEl && nameEl.textContent) fuelTypeMap[id] = nameEl.textContent;
      });
    }

    const subtypeMap = {};
    if (subtypesXml) {
      const subtypesDoc = parser.parseFromString(subtypesXml, 'application/xml');
      subtypesDoc.querySelectorAll('event-subtype').forEach(node => {
        const id = node.getAttribute('id');
        const nameEl = node.querySelector('name');
        if (id && nameEl && nameEl.textContent) subtypeMap[id] = nameEl.textContent;
      });
    }

    acarImportParsedVehicles = acarExtractVehicles(vehiclesDoc, fuelTypeMap, subtypeMap);

    if (acarImportParsedVehicles.length === 0) {
      showAcarImportError('Es wurden keine Fahrzeuge in der Datei gefunden.');
      return;
    }

    renderAcarImportPreview();
    acarShowStep('acarImportStepPreview');
  } catch (err) {
    console.error('aCar-Import Fehler:', err);
    showAcarImportError('Die Datei konnte nicht gelesen werden: ' + (err && err.message ? err.message : err));
  }
}
window.handleAcarFileSelect = handleAcarFileSelect;

function renderAcarImportPreview() {
  const container = document.getElementById('acarImportVehicleList');
  const existingVehicles = appData.vehicles.filter(v => !v.archived);

  container.innerHTML = acarImportParsedVehicles.map((av, idx) => {
    const subtitleParts = [av.make, av.model, av.year].filter(Boolean);
    const subtitle = subtitleParts.length > 0 ? subtitleParts.join(' · ') : '';

    // Bestehendes Fahrzeug mit gleichem Namen vorschlagen, falls vorhanden
    const matchingExisting = existingVehicles.find(v => v.name.trim().toLowerCase() === av.name.trim().toLowerCase());
    if (matchingExisting && av.targetMode === 'new') {
      av.targetMode = matchingExisting.id;
    }

    const optionsHtml = [
      `<option value="new">Neues Fahrzeug anlegen ("${av.name}")</option>`
    ].concat(existingVehicles.map(v =>
      `<option value="${v.id}" ${av.targetMode === v.id ? 'selected' : ''}>In "${v.name}" einordnen</option>`
    )).join('');

    return `
      <div class="acar-vehicle-card">
        <div class="acar-vehicle-card-header">
          <input type="checkbox" id="acarVehicleSelected_${idx}" ${av.selected ? 'checked' : ''} onchange="acarToggleVehicleSelected(${idx}, this.checked)">
          <div>
            <div class="acar-vehicle-card-title">${av.name}</div>
            ${subtitle ? `<div class="acar-vehicle-card-sub">${subtitle}</div>` : ''}
            <div class="acar-vehicle-card-counts">${av.fillups.length} Tankeinträge · ${av.services.length} Wartungen/Ausgaben</div>
          </div>
        </div>
        <div class="acar-vehicle-card-target">
          <select onchange="acarSetVehicleTarget(${idx}, this.value)">
            ${optionsHtml}
          </select>
        </div>
        ${av.fillups.length > 0 ? `
        <div class="acar-vehicle-card-target">
          <label class="acar-fuel-label">Kraftstoff für die Tankeinträge (aCar hat keinen hinterlegt - Vorschlag aus dem Motor-Feld)</label>
          <select onchange="acarSetVehicleFuelType(${idx}, this.value); document.getElementById('acarFuelCustom_${idx}').style.display = (this.value === 'Sonstiges') ? '' : 'none';">
            <option value="Super" ${av.defaultFuelType === 'Super' ? 'selected' : ''}>Super (E5 / E10)</option>
            <option value="Super Plus" ${av.defaultFuelType === 'Super Plus' ? 'selected' : ''}>Super Plus</option>
            <option value="Diesel" ${av.defaultFuelType === 'Diesel' ? 'selected' : ''}>Diesel</option>
            <option value="Premium Diesel" ${av.defaultFuelType === 'Premium Diesel' ? 'selected' : ''}>Premium Diesel (Ultimate / V-Power)</option>
            <option value="Strom" ${av.defaultFuelType === 'Strom' ? 'selected' : ''}>Strom</option>
            <option value="Sonstiges" ${av.defaultFuelType === 'Sonstiges' ? 'selected' : ''}>Sonstiges / Individuell</option>
          </select>
          <input type="text" id="acarFuelCustom_${idx}" class="acar-fuel-custom-input" placeholder="z.B. Zweitaktgemisch / LPG" value="${av.defaultFuelTypeCustom || ''}" oninput="acarSetVehicleFuelTypeCustom(${idx}, this.value)" style="display: ${av.defaultFuelType === 'Sonstiges' ? '' : 'none'};">
        </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

function acarSetVehicleFuelType(idx, value) {
  if (acarImportParsedVehicles[idx]) acarImportParsedVehicles[idx].defaultFuelType = value;
}
window.acarSetVehicleFuelType = acarSetVehicleFuelType;

function acarSetVehicleFuelTypeCustom(idx, value) {
  if (acarImportParsedVehicles[idx]) acarImportParsedVehicles[idx].defaultFuelTypeCustom = value;
}
window.acarSetVehicleFuelTypeCustom = acarSetVehicleFuelTypeCustom;

function acarToggleVehicleSelected(idx, checked) {
  if (acarImportParsedVehicles[idx]) acarImportParsedVehicles[idx].selected = checked;
}
window.acarToggleVehicleSelected = acarToggleVehicleSelected;

function acarSetVehicleTarget(idx, value) {
  if (acarImportParsedVehicles[idx]) acarImportParsedVehicles[idx].targetMode = value;
}
window.acarSetVehicleTarget = acarSetVehicleTarget;

// Grobe Dublettenprüfung: gleicher Tag, gleicher (gerundeter) KM-Stand und
// ungefähr gleicher Betrag gilt als bereits vorhanden
function acarIsDuplicateFillup(existing, candidate) {
  return existing.some(f =>
    f.date === candidate.date &&
    Math.abs((f.mileage || 0) - candidate.mileage) < 2 &&
    Math.abs((f.totalPrice || 0) - candidate.totalPrice) < 0.05
  );
}
function acarIsDuplicateService(existing, candidate) {
  return existing.some(s =>
    s.date === candidate.date &&
    Math.abs((s.mileage || 0) - candidate.mileage) < 2 &&
    Math.abs((s.cost || 0) - candidate.cost) < 0.05
  );
}

function runAcarImport() {
  let importedFillups = 0, skippedFillups = 0;
  let importedServices = 0, skippedServices = 0;
  let createdVehicles = 0;

  acarImportParsedVehicles.forEach(av => {
    if (!av.selected) return;

    let targetVehicle;
    if (av.targetMode === 'new') {
      targetVehicle = {
        id: "v_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
        name: av.name,
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
      if (av.year) targetVehicle.firstReg = av.year + '-01-01';
      appData.vehicles.push(targetVehicle);
      createdVehicles++;
    } else {
      targetVehicle = appData.vehicles.find(v => v.id === av.targetMode);
    }
    if (!targetVehicle) return;

    if (!targetVehicle.fuelEntries) targetVehicle.fuelEntries = [];
    if (!targetVehicle.serviceEntries) targetVehicle.serviceEntries = [];

    // Im Vorschau-Schritt gewähltes Kraftstoff-Standard für dieses
    // aCar-Fahrzeug (greift, wenn aCar selbst keinen Kraftstoff eingetragen hat)
    const chosenFuelType = (av.defaultFuelType === 'Sonstiges')
      ? (av.defaultFuelTypeCustom || 'Sonstiges')
      : av.defaultFuelType;

    av.fillups.forEach(f => {
      if (acarIsDuplicateFillup(targetVehicle.fuelEntries, f)) { skippedFillups++; return; }
      targetVehicle.fuelEntries.push({
        id: "f_" + Date.now() + "_" + Math.floor(Math.random() * 100000),
        date: f.date,
        fuelType: f.fuelType || chosenFuelType || targetVehicle.fuelType || 'Super',
        mileage: f.mileage,
        liters: f.liters,
        totalPrice: f.totalPrice,
        pricePerLiter: f.pricePerLiter,
        full: f.full,
        hasAdditive: f.hasAdditive,
        additiveName: f.additiveName,
        notes: f.notes ? (f.notes + ' (aus aCar importiert)') : 'Aus aCar importiert'
      });
      importedFillups++;
    });

    av.services.forEach(s => {
      if (acarIsDuplicateService(targetVehicle.serviceEntries, s)) { skippedServices++; return; }
      targetVehicle.serviceEntries.push({
        id: "s_" + Date.now() + "_" + Math.floor(Math.random() * 100000),
        isStandEntry: false,
        category: s.category,
        title: s.title,
        date: s.date,
        mileage: s.mileage,
        cost: s.cost,
        performer: '',
        notes: s.notes ? (s.notes + ' (aus aCar importiert)') : 'Aus aCar importiert',
        images: s.images,
        nextKm: null,
        nextDate: null,
        engineId: null
      });
      importedServices++;
    });

    targetVehicle.fuelEntries.sort(compareByDateThenMileageDesc);
    targetVehicle.serviceEntries.sort(compareByDateThenMileageDesc);
  });

  saveData();
  renderVehicleSelect();
  renderGarageVehicleTiles();
  loadActiveVehicle();

  const resultLines = [
    `<div class="acar-import-summary-line"><span>Neue Fahrzeuge angelegt</span><strong>${createdVehicles}</strong></div>`,
    `<div class="acar-import-summary-line"><span>Tankeinträge importiert</span><strong>${importedFillups}</strong></div>`,
    `<div class="acar-import-summary-line"><span>Wartungen/Ausgaben importiert</span><strong>${importedServices}</strong></div>`
  ];
  if (skippedFillups > 0 || skippedServices > 0) {
    resultLines.push(`<div class="acar-import-summary-line"><span>Übersprungen (bereits vorhanden)</span><strong>${skippedFillups + skippedServices}</strong></div>`);
  }
  document.getElementById('acarImportResultText').innerHTML = resultLines.join('');
  acarShowStep('acarImportStepResult');
}
window.runAcarImport = runAcarImport;
