/* --- HTML-ESCAPING für Benutzereingaben, die per innerHTML ausgegeben werden --- */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* --- VERBRAUCH: Voll-zu-Voll-Segmente (gemeinsame Grundlage für Tankliste,
   Durchschnitts-Kachel, Verlaufsgrafik und Verkaufsbericht) ---
   Von einer Volltankung bis zur nächsten werden die Liter ALLER Tankungen
   dazwischen (auch Teilbetankungen) zusammengezählt. Eine Volltankung mit
   firstFill = true ("Verbrauch hier neu beginnen", z.B. Spritmonitor-
   Erstbetankung oder vergessene Tankung davor) beendet keine Strecke, sondern
   startet die Rechnung neu. Liefert [{ entry, liters, dist }] je Volltankung. */
function getFullToFullSegments(fuelEntries) {
  const sorted = [...(fuelEntries || [])].sort((a, b) => (a.mileage || 0) - (b.mileage || 0));
  const segments = [];
  let lastFullIdx = -1;
  sorted.forEach((current, i) => {
    if (!current.full) return;
    if (lastFullIdx !== -1 && !current.firstFill) {
      const dist = current.mileage - sorted[lastFullIdx].mileage;
      let liters = 0;
      for (let j = lastFullIdx + 1; j <= i; j++) liters += sorted[j].liters || 0;
      if (dist > 0) segments.push({ entry: current, liters, dist });
    }
    lastFullIdx = i;
  });
  return segments;
}

// Gesamtdurchschnitt aus allen Segmenten (Summe Liter / Summe Strecke)
function getAverageConsumption(fuelEntries) {
  const segments = getFullToFullSegments(fuelEntries);
  const liters = segments.reduce((sum, s) => sum + s.liters, 0);
  const dist = segments.reduce((sum, s) => sum + s.dist, 0);
  return dist > 0 ? (liters / dist) * 100 : 0;
}

/* --- KM-/STUNDEN-EINGABEFELDER: AUTOMATISCHE TAUSENDERPUNKTE --- */
// Live-Formatierung während der Eingabe (z.B. "333200" -> "333.200").
// Erlaubt ein Komma für Nachkommastellen (z.B. Betriebsstunden "145,5").
function formatMileageInput(input) {
  let raw = input.value.replace(/[^\d,]/g, '');

  const commaIndex = raw.indexOf(',');
  let intPart = commaIndex === -1 ? raw : raw.slice(0, commaIndex);
  let decPart = commaIndex === -1 ? undefined : raw.slice(commaIndex + 1).replace(/,/g, '').slice(0, 2);

  intPart = intPart.replace(/^0+(?=\d)/, '');
  intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  input.value = decPart !== undefined ? `${intPart},${decPart}` : intPart;
}
window.formatMileageInput = formatMileageInput;

// Wandelt einen formatierten Wert ("333.200" oder "145,5") in eine echte Zahl um
function parseFormattedNumber(str) {
  if (!str) return 0;
  const normalized = str.toString().replace(/\./g, '').replace(',', '.');
  const num = parseFloat(normalized);
  return isNaN(num) ? 0 : num;
}
window.parseFormattedNumber = parseFormattedNumber;

// Wandelt eine echte Zahl in die formatierte Anzeige um ("333200" -> "333.200"),
// z.B. zum Vorbefüllen eines Feldes beim Bearbeiten eines Eintrags
function formatNumberForDisplay(num) {
  if (num === null || num === undefined || num === '' || isNaN(num)) return '';
  const parts = num.toString().split('.');
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return parts[1] ? `${intPart},${parts[1].slice(0, 2)}` : intPart;
}
window.formatNumberForDisplay = formatNumberForDisplay;

// Sortiert Einträge nach Datum (neueste zuerst); bei gleichem Datum kommt
// der Eintrag mit dem höheren KM-Stand/Betriebsstunden zuerst
function compareByDateThenMileageDesc(a, b) {
  const dateDiff = new Date(b.date) - new Date(a.date);
  if (dateDiff !== 0) return dateDiff;
  return (b.mileage || 0) - (a.mileage || 0);
}

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

// Ermittelt Daten für die kleine TÜV-Plaketten-Grafik auf der Fahrzeugkachel:
// echte 6-Jahres-Farbrotation (Braun/Rosa/Grün/Orange/Blau/Gelb), Monat & Jahr
// zur Anzeige, sowie ob der Termin überfällig ist. Bei Booten gibt's keine
// Plakette (TÜV nicht relevant); ohne eingetragenes Datum eine leere Plakette.
function getTuevPlaketteData(v, sizePx) {
  if (v.category === 'boot') return null;

  if (!v.nextTuev) {
    return { empty: true, overdue: false, month: '', year: '', colorClass: '' };
  }

  const tuevColors = ['braun', 'rosa', 'gruen', 'orange', 'blau', 'gelb'];
  const parts = v.nextTuev.split('-');
  const year = parseInt(parts[0], 10);
  const month = parts[1];
  const colorClass = 'color-' + tuevColors[((year % 6) + 6) % 6];

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(v.nextTuev + '-01');
  const overdue = due < today;

  return {
    empty: false,
    overdue,
    month,
    year: (year % 100).toString().padStart(2, '0'),
    colorClass,
    monthRingHtml: buildTuevMonthRing(parseInt(month, 10), sizePx)
  };
}

// Baut das fertige HTML für eine TÜV-Plakette aus den Daten von getTuevPlaketteData()
// (wird sowohl auf der Fahrzeugkachel als auch im Dashboard verwendet)
function renderTuevPlaketteHtml(plakette) {
  if (!plakette) return '';
  if (plakette.empty) return `<div class="tuev-plakette tuev-plakette-empty"></div>`;
  return `
    <div class="tuev-plakette ${plakette.colorClass}">
      <div class="tuev-plakette-ring">${plakette.monthRingHtml}</div>
      <div class="tuev-plakette-center">
        <span class="tuev-plakette-year">${plakette.year}</span>
      </div>
      ${plakette.overdue ? '<span class="tuev-plakette-overdue-badge">!</span>' : ''}
    </div>
  `;
}

// Randstärke des äußeren schwarzen Rings je Plaketten-Größe (muss exakt zum
// tatsächlichen CSS "border-width" von .tuev-plakette in dieser Größe passen -
// siehe style.css). Wird gebraucht, um die äußeren Striche rechnerisch exakt
// an den Innenrand des Rings andocken zu lassen (statt frei geschätzter Werte).
function getTuevBorderWidthForSize(sizePx) {
  if (sizePx === 44) return 2;
  if (sizePx === 52) return 2.4;
  if (sizePx === 64) return 3;
  return 3 * ((sizePx || 64) / 64);
}

// Liefert die Radien (Zahlenkranz / äußere & innere Strichmarken) für eine
// bestimmte, tatsächlich gerenderte Plaketten-Größe in Pixel. Der äußere
// Strich-Radius (normal & Monat-12-Spezialmarkierung) wird rechnerisch so
// bestimmt, dass die Striche den Innenrand des schwarzen Rings exakt berühren,
// unabhängig von der Größe - dafür muss die tatsächliche Randstärke (s.o.)
// sowie die CSS-Strichhöhe (11% / 12% der Plaketten-Größe) mit einbezogen
// werden. Der innere Strich-Radius bleibt handverlesen abgestimmt; die
// Zahlen sitzen genau mittig zwischen innerem und äußerem Strich.
function getTuevRingRadii(sizePx) {
  const size = sizePx || 64;
  const borderWidth = getTuevBorderWidthForSize(size);
  const ringInnerRadius = size / 2 - borderWidth;

  const tickHeightPx = 0.11 * size;
  const specialTickHeightPx = 0.12 * size;
  const tickRadius = ringInnerRadius - tickHeightPx / 2;

  const innerTickRadiusTable = { 44: 8, 52: 10, 64: 12 };
  const ratio = size / 64;
  const innerTickRadius = innerTickRadiusTable[size] ?? Math.round(12 * ratio);

  return {
    numRadius: (innerTickRadius + tickRadius) / 2,
    innerTickRadius,
    tickRadius,
    specialTickRadius: ringInnerRadius - specialTickHeightPx / 2
  };
}

// Baut den Zahlenkranz mit allen 12 Monaten am Rand der Plakette (wie beim
// echten Vorbild): jede Zahl radial ausgerichtet (wie ein Uhrzeiger gedreht)
// und so positioniert, dass der fällige Monat oben (12-Uhr) steht.
// sizePx muss der tatsächlich im CSS gerenderten Kantenlänge der Plakette
// entsprechen (siehe getTuevRingRadii) - sonst ragen die Striche über den
// Rand hinaus bzw. sitzen zu weit innen.
function buildTuevMonthRing(dueMonth, sizePx) {
  let html = '';
  const { numRadius, tickRadius, specialTickRadius, innerTickRadius } = getTuevRingRadii(sizePx);

  // Je Monat: kurzer Strich innen, Zahl in der Mitte, langer Strich außen -
  // alle drei auf derselben Linie/Winkel ausgerichtet.
  // Bei Monat 12 gibt's zusätzlich die spezielle, breitere Markierung wie beim Original.
  for (let m = 1; m <= 12; m++) {
    const angleDeg = (m - dueMonth) * 30; // 0° = oben, im Uhrzeigersinn
    const isTwoDigit = m >= 10;

    // Kurzer Strich von innen kommend (gleiche Stärke wie der äußere Strich)
    html += `<span class="tuev-plakette-tick tuev-plakette-tick-inner" style="transform: translate(-50%, -50%) rotate(${angleDeg}deg) translateY(-${innerTickRadius}px);"></span>`;

    if (m === 12) {
      // Spezialmarkierung: höher/breiter als die normalen Striche, berührt den
      // Ring aber exakt genauso (eigener Radius wegen der größeren Höhe) -
      // wirkt wie ein an dieser Stelle dickerer Rand, ohne über den Rand
      // hinauszuragen
      html += `<span class="tuev-plakette-tick tuev-plakette-tick-special" style="transform: translate(-50%, -50%) rotate(${angleDeg}deg) translateY(-${specialTickRadius}px);"></span>`;
    } else {
      html += `<span class="tuev-plakette-tick" style="transform: translate(-50%, -50%) rotate(${angleDeg}deg) translateY(-${tickRadius}px);"></span>`;
    }

    const numClass = isTwoDigit ? 'tuev-plakette-ring-num tuev-plakette-ring-num-narrow' : 'tuev-plakette-ring-num';
    html += `<span class="${numClass}" style="transform: translate(-50%, -50%) rotate(${angleDeg}deg) translateY(-${numRadius}px);">${m}</span>`;
  }

  return html;
}

// Ermittelt anstehende Routine-Wartungen anhand der hinterlegten KM-/Datums-Erinnerung.
// Pro Titel wird nur der jeweils neueste Wartungseintrag berücksichtigt (eine neue
// Wartung zum selben Thema ersetzt die alte Erinnerung).
function getUpcomingMaintenanceReminders(v) {
  const serviceList = v.serviceEntries || [];
  const currentMileage = getVehicleCurrentMileage(v);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // "TÜV" ist mit dabei, damit eine Nachprüfungs-Erinnerung (angelegt vom TÜV-Assistenten
  // bei Mängeln ohne neue Plakette) über denselben Mechanismus im Dashboard auftaucht
  const withReminder = serviceList.filter(s => (s.category === 'Wartung' || s.category === 'TÜV') && (s.nextKm || s.nextDate));

  // Boote mit mehreren Motoren: Titel + Motor zusammen als Schlüssel, sonst würde
  // z.B. "Ölwechsel" von Motor 1 und Motor 2 fälschlich zusammengeworfen
  const boatEnginesForReminders = getBoatEngines(v);
  const multiEngine = v.category === 'boot' && boatEnginesForReminders.length > 1;

  const latestByTitle = {};
  withReminder.forEach(s => {
    const key = (s.title || 'Wartung').trim().toLowerCase() + '|' + (s.engineId || '');
    if (!latestByTitle[key] || new Date(s.date) > new Date(latestByTitle[key].date)) {
      latestByTitle[key] = s;
    }
  });

  const reminders = Object.values(latestByTitle).map(s => {
    const kmRemaining = s.nextKm ? Math.round(s.nextKm - currentMileage) : null;
    let daysRemaining = null;
    if (s.nextDate) {
      const due = new Date(s.nextDate);
      daysRemaining = Math.round((due - today) / (1000 * 60 * 60 * 24));
    }
    const overdue = (kmRemaining !== null && kmRemaining <= 0) || (daysRemaining !== null && daysRemaining <= 0);

    // Bei Booten mit mehreren Motoren den Motornamen an den Titel anhängen,
    // damit z.B. "Ölwechsel Motor 1" von "Ölwechsel Motor 2" unterscheidbar ist
    let displayTitle = s.title || 'Wartung';
    if (multiEngine) {
      const engineName = s.engineId
        ? (boatEnginesForReminders.find(e => e.id === s.engineId)?.name || 'Motor')
        : 'Allgemein/Rumpf';
      displayTitle = `${displayTitle} (${engineName})`;
    }

    return {
      title: displayTitle,
      nextKm: s.nextKm || null,
      nextDate: s.nextDate || null,
      kmRemaining,
      daysRemaining,
      overdue
    };
  });

  // Dringendste zuerst: überfällige ganz oben, danach nach verbleibender Zeit/Strecke sortiert
  reminders.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    const aMetric = a.daysRemaining !== null ? a.daysRemaining : (a.kmRemaining !== null ? a.kmRemaining / 30 : Infinity);
    const bMetric = b.daysRemaining !== null ? b.daysRemaining : (b.kmRemaining !== null ? b.kmRemaining / 30 : Infinity);
    return aMetric - bMetric;
  });

  return reminders;
}

// Formatiert die verbleibende Zeit/Strecke einer Erinnerung als kurzen Text (KM • Datum)
function formatReminderMeta(r, unitLabel) {
  const unit = unitLabel || 'km';
  const metaParts = [];
  if (r.nextKm) {
    metaParts.push(r.kmRemaining <= 0
      ? `${Math.abs(r.kmRemaining).toLocaleString('de-DE')} ${unit} überfällig`
      : `noch ${r.kmRemaining.toLocaleString('de-DE')} ${unit}`);
  }
  if (r.nextDate) {
    const dateText = r.isTuev ? formatTuevDate(r.nextDate) : new Date(r.nextDate).toLocaleDateString('de-DE');
    metaParts.push(r.daysRemaining <= 0
      ? `seit ${dateText} fällig`
      : `fällig am ${dateText}`);
  }
  return metaParts.join(' • ');
}

// Zentrale Liste der (Standard-)Fahrzeugarten - "Auto" ist immer aktiv, Boot &
// Anhänger lassen sich in den Einstellungen ausblenden. Eine Fahrzeugart hier
// zu definieren heißt nur: sie taucht in der Kategorie-Auswahl beim Anlegen
// und in den Filter-Chips auf, wenn ihr "enabledKey" in appData true ist
// (bzw. wenn kein enabledKey gesetzt ist, wie bei "auto").
//
// Vorbereitung für später (noch nicht gebaut): eine frei konfigurierbare
// Sonderkategorie (z.B. Bagger, Radlader). appData.customVehicleCategories
// ist als leeres Array bereits vorhanden; sobald es eine UI zum Anlegen
// solcher Einträge gibt, kann getEnabledVehicleCategories() diese einfach an
// die Liste unten anhängen (label + icon + sizeSpec kämen dann von jedem
// benutzerdefinierten Eintrag statt aus dieser festen Liste) - der ganze
// Rest (Dropdown, Filter-Chips, Icon-Zuordnung) müsste dafür nicht mehr
// angefasst werden.
const VEHICLE_CATEGORY_DEFS = [
  { value: 'auto', label: 'Auto', enabledKey: null },
  { value: 'anhaenger', label: 'Anhänger', enabledKey: 'trailerCategoryEnabled' },
  { value: 'boot', label: 'Boot', enabledKey: 'boatCategoryEnabled' }
];

// Liefert alle aktuell aktivierten Fahrzeugarten (immer inkl. "Auto"),
// optional mit einem zusätzlichen Wert, der auf jeden Fall enthalten sein
// muss (z.B. die Kategorie eines bereits bestehenden Fahrzeugs, auch wenn
// diese Kategorie inzwischen deaktiviert wurde - bestehende Daten sollen
// weiterhin normal bearbeitbar bleiben).
function getEnabledVehicleCategories(mustIncludeValue) {
  const enabled = VEHICLE_CATEGORY_DEFS.filter(def => !def.enabledKey || appData[def.enabledKey] !== false);
  if (mustIncludeValue && !enabled.some(def => def.value === mustIncludeValue)) {
    const forced = VEHICLE_CATEGORY_DEFS.find(def => def.value === mustIncludeValue);
    if (forced) enabled.push(forced);
  }
  return enabled;
}

// Baut die <option>-Liste eines Fahrzeugart-Selects neu auf, entsprechend der
// aktuell aktivierten Kategorien. currentValue wird (falls gesetzt) in jedem
// Fall mit aufgenommen, auch wenn diese Kategorie deaktiviert ist - und danach
// wieder als ausgewählter Wert gesetzt.
function populateVehicleCategorySelect(selectEl, currentValue) {
  if (!selectEl) return;
  const valueToKeep = currentValue !== undefined ? currentValue : selectEl.value;
  const categories = getEnabledVehicleCategories(valueToKeep);
  selectEl.innerHTML = categories.map(def => `<option value="${def.value}">${def.label}</option>`).join('');
  if (valueToKeep) selectEl.value = valueToKeep;
}

// Blendet die Filter-Chips für deaktivierte Fahrzeugarten in der "Alle"-
// Übersicht aus bzw. wieder ein. Bereits vorhandene Fahrzeuge dieser Art
// bleiben unangetastet und sind weiterhin über "Alle" erreichbar.
function applyVehicleCategoryToggleVisibility() {
  VEHICLE_CATEGORY_DEFS.forEach(def => {
    if (!def.enabledKey) return;
    const enabled = appData[def.enabledKey] !== false;
    const chip = document.querySelector(`.category-filter-chip[data-category="${def.value}"]`);
    if (chip) chip.style.display = enabled ? '' : 'none';

    // Falls gerade nach der (jetzt versteckten) Kategorie gefiltert wird,
    // zurück auf "Alle" springen statt auf einem ausgeblendeten Chip hängen zu bleiben
    if (!enabled && vehicleCategoryFilter === def.value) {
      setVehicleCategoryFilter('all');
    }

    const onBtn = document.getElementById(def.value + 'CategoryToggleOn');
    const offBtn = document.getElementById(def.value + 'CategoryToggleOff');
    if (onBtn) onBtn.classList.toggle('active', enabled);
    if (offBtn) offBtn.classList.toggle('active', !enabled);
  });

  updateAllCategoryChipVisibility();

  // "Neues Fahrzeug"-Formular: nur relevant, falls das Modal gerade offen ist,
  // schadet aber auch sonst nicht, da es beim Öffnen ohnehin neu befüllt wird
  populateVehicleCategorySelect(document.getElementById('newVCategory'));

  // Stammdaten-Formular des aktuell angezeigten Fahrzeugs: bestehende
  // Kategorie unbedingt erhalten, auch wenn sie gerade deaktiviert wurde
  const activeVehicle = getActiveVehicle();
  if (activeVehicle) {
    populateVehicleCategorySelect(document.getElementById('vCategory'), activeVehicle.category || 'auto');
  }
}

// Der "Alle"-Filter-Chip ergibt nur einen Sinn, wenn es überhaupt mehr als
// eine Fahrzeugart zu unterscheiden gibt. Sind Boot & Anhänger deaktiviert
// UND besitzt man aktuell auch keine (nicht archivierten) Fahrzeuge dieser
// Art mehr, bleibt effektiv nur noch "Auto" übrig - dann blendet sich "Alle"
// automatisch aus, da es ohnehin identisch mit "Autos" wäre.
function updateAllCategoryChipVisibility() {
  const relevantCategories = new Set();
  VEHICLE_CATEGORY_DEFS.forEach(def => {
    if (!def.enabledKey || appData[def.enabledKey] !== false) relevantCategories.add(def.value);
  });
  (appData.vehicles || []).filter(v => !v.archived).forEach(v => {
    relevantCategories.add(v.category || 'auto');
  });

  const showAllChip = relevantCategories.size > 1;
  const allChip = document.querySelector('.category-filter-chip[data-category="all"]');
  if (allChip) allChip.style.display = showAllChip ? '' : 'none';

  if (!showAllChip && vehicleCategoryFilter === 'all') {
    setVehicleCategoryFilter('auto');
  }
}

function setBoatCategoryEnabled(enabled) {
  appData.boatCategoryEnabled = enabled;
  saveData();
  applyVehicleCategoryToggleVisibility();
}
window.setBoatCategoryEnabled = setBoatCategoryEnabled;

function setTrailerCategoryEnabled(enabled) {
  appData.trailerCategoryEnabled = enabled;
  saveData();
  applyVehicleCategoryToggleVisibility();
}
window.setTrailerCategoryEnabled = setTrailerCategoryEnabled;

// Liefert das passende Icon-SVG (als kleiner Markup-Schnipsel) für eine Fahrzeugart
function getCategoryIconSvg(category) {
  switch (category) {
    case 'anhaenger':
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="14" height="8" rx="1"/><circle cx="7" cy="18" r="1.5"/><circle cx="13" cy="18" r="1.5"/><path d="M17 11h2.5a1.5 1.5 0 0 1 1.5 1.5V16h-4"/></svg>';
    case 'boot':
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17h18l-1.5 3a2 2 0 0 1-1.8 1H6.3a2 2 0 0 1-1.8-1L3 17Z"/><path d="M12 17V3"/><path d="M12 4l5 9H12Z"/></svg>';
    default:
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>';
  }
}

// Filter-Status für die Fahrzeugart-Auswahl (Alle/Autos/Anhänger/Boote) auf dem Kachel-Bildschirm
let vehicleCategoryFilter = 'all';

function setVehicleCategoryFilter(category) {
  vehicleCategoryFilter = category;
  document.querySelectorAll('.category-filter-chip').forEach(chip => {
    chip.classList.toggle('active', chip.getAttribute('data-category') === category);
  });
  renderGarageVehicleTiles();
  playCategoryDriveByAnimation(category);
}

// Kleine, dezente Spielerei: beim Wechsel des Fahrzeugart-Filters fährt/schwimmt
// das passende Icon einmal quer über den Bildschirm
function playCategoryDriveByAnimation(category) {
  if (category === 'all') return;

  const existing = document.querySelector('.category-drive-by-icon');
  if (existing) existing.remove();

  const icon = document.createElement('div');
  icon.className = 'category-drive-by-icon';
  icon.innerHTML = getCategoryIconSvg(category);
  document.body.appendChild(icon);

  setTimeout(() => icon.remove(), 2500);
}
window.setVehicleCategoryFilter = setVehicleCategoryFilter;

// Rendert alle gespeicherten eigenen Fahrzeuge als Auswahlkacheln hinter "Meine Garage"
// Sortiert eine Fahrzeugliste so um, dass ein Dingi direkt nach seinem
// zugehörigen Hauptboot einsortiert wird (statt irgendwo verstreut zu liegen)
function sortWithDinghiesGrouped(vehicles) {
  const consumed = new Set();
  const result = [];

  vehicles.forEach(v => {
    if (consumed.has(v.id)) return;
    // Dingis werden erst behandelt, wenn ihr Hauptboot an der Reihe ist
    if (v.belongsToId && vehicles.some(x => x.id === v.belongsToId)) return;

    result.push(v);
    consumed.add(v.id);

    vehicles.forEach(child => {
      if (child.belongsToId === v.id && !consumed.has(child.id)) {
        result.push(child);
        consumed.add(child.id);
      }
    });
  });

  // Übrig gebliebene Dingis (z.B. Hauptboot gerade rausgefiltert) am Ende anhängen
  vehicles.forEach(v => {
    if (!consumed.has(v.id)) {
      result.push(v);
      consumed.add(v.id);
    }
  });

  return result;
}
