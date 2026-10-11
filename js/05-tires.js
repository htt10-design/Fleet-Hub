/* --- REIFEN & FELGEN --- */

const TIRE_AGE_WARNING_YEARS = 6;

// Für die Dashboard-Kachel: wenn der montierte Satz vorne/hinten unterschiedliche
// Größen hat, hält das den Wisch-Status (welche Seite gerade gezeigt wird)
let tireKpiAxleData = null; // {front: "...", rear: "..."} oder null wenn nur eine Größe
let tireKpiCurrentPage = 0; // 0 = Vorne, 1 = Hinten
let tireKpiWheelsBuilt = false;
let tireCardSwipeStartX = null;
let tireCardSwipeDragging = false;
let tireCardSwipeSuppressClick = false;
let tireKpiDragBaseX = 0;
let tireKpiDragWidth = 124;

// Baut die eigentliche Rad-Grafik (Reifen, Felge, Speichen, gebogene Größenangabe) als
// Markup-String - wird für "Vorne" und "Hinten" je einmal mit eigenen IDs eingesetzt,
// damit beide Seiten des Wisch-Karussells unabhängig voneinander Text tragen können
function buildTireKpiWheelSvg(suffix) {
  return `
    <svg class="tire-kpi-wheel" viewBox="0 0 200 100" width="124" height="62" xmlns:xlink="http://www.w3.org/1999/xlink">
      <defs>
        <radialGradient id="tireKpiTireGrad-${suffix}" cx="38%" cy="15%" r="90%">
          <stop offset="0%" stop-color="#39392f"/>
          <stop offset="65%" stop-color="#221f1b"/>
          <stop offset="100%" stop-color="#131210"/>
        </radialGradient>
        <linearGradient id="tireKpiRimGrad-${suffix}" x1="10%" y1="0%" x2="90%" y2="100%">
          <stop offset="0%" stop-color="#8c8c85"/>
          <stop offset="42%" stop-color="#b7b7ae"/>
          <stop offset="58%" stop-color="#9f9f96"/>
          <stop offset="100%" stop-color="#6b6b64"/>
        </linearGradient>
        <linearGradient id="tireKpiSpokeGrad-${suffix}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#dcdcd4"/>
          <stop offset="50%" stop-color="#9d9d93"/>
          <stop offset="100%" stop-color="#5c5c55"/>
        </linearGradient>
        <radialGradient id="tireKpiHubGrad-${suffix}" cx="35%" cy="15%" r="85%">
          <stop offset="0%" stop-color="#cccac2"/>
          <stop offset="60%" stop-color="#87857c"/>
          <stop offset="100%" stop-color="#57554d"/>
        </radialGradient>
      </defs>
      <path d="M 2,98 A 96,96 0 0 1 198,98 Z" fill="url(#tireKpiTireGrad-${suffix})" stroke="rgba(0,0,0,0.3)" stroke-width="1"/>
      <path d="M 14,98 A 84,84 0 0 1 186,98" fill="none" stroke="rgba(0,0,0,0.2)" stroke-width="1"/>
      <path d="M 38,98 A 62,62 0 0 1 162,98 Z" fill="url(#tireKpiRimGrad-${suffix})" stroke="rgba(0,0,0,0.25)" stroke-width="0.8"/>
      <path d="M 40,96.5 A 60,60 0 0 1 160,96.5" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="1" stroke-linecap="round"/>
      <g fill="url(#tireKpiSpokeGrad-${suffix})" stroke="#3a3934" stroke-width="0.6" stroke-linejoin="round">
        <path d="M 116.5,96.9 L153.8,82.4 L152.7,79.0 L114.0,89.3 Z"/>
        <path d="M 112.6,87.4 L134.4,53.8 L131.5,51.6 L106.2,82.7 Z"/>
        <path d="M 104,82 L101.8,42 L98.2,42 L96,82 Z"/>
        <path d="M 93.8,82.7 L68.5,51.6 L65.6,53.8 L87.4,87.4 Z"/>
        <path d="M 86.0,89.3 L47.3,79.0 L46.2,82.4 L83.5,96.9 Z"/>
      </g>
      <path d="M 86,98 A 14,14 0 0 1 114,98 Z" fill="url(#tireKpiHubGrad-${suffix})" stroke="rgba(0,0,0,0.35)" stroke-width="0.8"/>
      <path d="M 93,98 A 7,7 0 0 1 107,98 Z" fill="#232320"/>
      <path id="kpiTireArcPath-${suffix}" d="M 24,98 A 74,74 0 0 1 176,98" fill="none"/>
      <text font-size="16.5" font-weight="700" fill="#f2f1ea" letter-spacing="0.2">
        <textPath href="#kpiTireArcPath-${suffix}" xlink:href="#kpiTireArcPath-${suffix}" startOffset="50%" text-anchor="middle" id="kpi-tire-arc-text-${suffix}">-</textPath>
      </text>
    </svg>
  `;
}

// Erzeugt die beiden Rad-Grafiken (Vorne/Hinten) einmalig im Karussell
function ensureTireKpiWheelsBuilt() {
  if (tireKpiWheelsBuilt) return;
  const frontPage = document.getElementById('kpi-tire-page-front');
  const rearPage = document.getElementById('kpi-tire-page-rear');
  if (!frontPage || !rearPage) return;
  frontPage.innerHTML = buildTireKpiWheelSvg('front');
  rearPage.innerHTML = buildTireKpiWheelSvg('rear');
  tireKpiWheelsBuilt = true;
}

// Setzt das Karussell ohne Animation auf die übergebene Seite zurück (z.B. beim Laden neuer Daten)
function resetTireKpiTrackPosition() {
  const track = document.getElementById('kpi-tire-track');
  if (!track) return;
  track.style.transition = 'none';
  track.style.transform = 'translateX(0px)';
  void track.offsetHeight; // Reflow erzwingen, damit die nächste Änderung wieder animiert
  track.style.transition = '';
}

// Bewegt das Karussell zur aktuellen Seite (mit Animation) und aktualisiert Label + Punkte
function renderTireKpiPage() {
  if (!tireKpiAxleData) return;
  const track = document.getElementById('kpi-tire-track');
  const visualEl = document.getElementById('kpi-tire-visual');
  const axleLabelEl = document.getElementById('kpi-tire-axle-label');
  const tireSubEl = document.getElementById('kpi-tire-sub');
  const dot0 = document.getElementById('kpi-tire-dot-0');
  const dot1 = document.getElementById('kpi-tire-dot-1');
  const width = visualEl ? (visualEl.clientWidth || 124) : 124;
  const isRear = tireKpiCurrentPage === 1;
  if (track) track.style.transform = `translateX(${isRear ? -width : 0}px)`;
  if (axleLabelEl) axleLabelEl.innerText = isRear ? 'Hinten' : 'Vorne';
  if (dot0) dot0.classList.toggle('active', !isRear);
  if (dot1) dot1.classList.toggle('active', isRear);
  // Sub-Text (Bezeichnung + Herstellungsdatum) passend zur gerade sichtbaren
  // Achse, da vorne/hinten jeweils ein eigenes Datum/Alter haben können
  if (tireSubEl) {
    tireSubEl.innerText = isRear ? tireKpiAxleData.subLabelRear : tireKpiAxleData.subLabelFront;
    tireSubEl.classList.toggle('kpi-sub-warning', isRear ? tireKpiAxleData.isOldRear : tireKpiAxleData.isOldFront);
  }
}

// Wechselt die Reifen-Kachel auf Vorne (0) oder Hinten (1)
function showTireKpiPage(idx) {
  if (!tireKpiAxleData) return;
  const target = idx === 1 ? 1 : 0;
  if (target === tireKpiCurrentPage) return;
  tireKpiCurrentPage = target;
  renderTireKpiPage();
}
window.showTireKpiPage = showTireKpiPage;

// Wisch-Geste auf der Reifen-Kachel: das Karussell folgt live dem Finger (wie beim
// Homescreen-Wischen), inkl. leichtem "Rubber-Banding" an den Rändern, und schnappt
// beim Loslassen in die nächste bzw. wieder in die aktuelle Seite ein.
function tireCardTouchStart(e) {
  tireCardSwipeStartX = null;
  tireCardSwipeDragging = false;
  if (!tireKpiAxleData || !e.touches || e.touches.length !== 1) return;
  const track = document.getElementById('kpi-tire-track');
  const visualEl = document.getElementById('kpi-tire-visual');
  if (!track || !visualEl) return;
  tireCardSwipeStartX = e.touches[0].clientX;
  tireKpiDragWidth = visualEl.clientWidth || 124;
  tireKpiDragBaseX = tireKpiCurrentPage === 1 ? -tireKpiDragWidth : 0;
  track.style.transition = 'none';
}
window.tireCardTouchStart = tireCardTouchStart;

function tireCardTouchMove(e) {
  if (tireCardSwipeStartX === null || !tireKpiAxleData || !e.touches || e.touches.length !== 1) return;
  const dx = e.touches[0].clientX - tireCardSwipeStartX;
  if (Math.abs(dx) > 6) {
    tireCardSwipeDragging = true;
    e.preventDefault(); // ab hier eindeutig ein horizontaler Wisch - Seiten-Scroll unterbinden
  }
  const track = document.getElementById('kpi-tire-track');
  if (!track) return;
  let target = tireKpiDragBaseX + dx;
  const minX = -tireKpiDragWidth;
  const maxX = 0;
  // Leichter Widerstand, wenn man über den Anfang/das Ende hinaus zieht
  if (target > maxX) target = maxX + (target - maxX) * 0.35;
  if (target < minX) target = minX + (target - minX) * 0.35;
  track.style.transform = `translateX(${target}px)`;
}
window.tireCardTouchMove = tireCardTouchMove;

function tireCardTouchEnd(e) {
  const track = document.getElementById('kpi-tire-track');
  if (tireCardSwipeStartX === null || !tireKpiAxleData) {
    tireCardSwipeStartX = null;
    tireCardSwipeDragging = false;
    return;
  }
  const endX = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0].clientX : tireCardSwipeStartX;
  const dx = endX - tireCardSwipeStartX;
  tireCardSwipeStartX = null;
  if (track) track.style.transition = '';

  if (tireCardSwipeDragging) {
    e.preventDefault();
    e.stopPropagation();
    const threshold = tireKpiDragWidth * 0.22;
    if (dx <= -threshold) tireKpiCurrentPage = 1;
    else if (dx >= threshold) tireKpiCurrentPage = 0;
    renderTireKpiPage();
    // Verhindert, dass der nach dem Wischen ausgelöste Klick versehentlich das Reifen-Fenster öffnet
    tireCardSwipeSuppressClick = true;
    setTimeout(() => { tireCardSwipeSuppressClick = false; }, 350);
  }
  tireCardSwipeDragging = false;
}
window.tireCardTouchEnd = tireCardTouchEnd;

// Öffnet das Reifen-Fenster per Klick auf die Dashboard-Kachel - außer es war gerade ein Wisch-Gestus
function handleTireCardClick() {
  if (tireCardSwipeSuppressClick) { tireCardSwipeSuppressClick = false; return; }
  openTireOverviewModal();
}
window.handleTireCardClick = handleTireCardClick;

// Schreibt Text auf den gebogenen Pfad der Reifen-Kachel und staucht ihn nur,
// wenn er länger ist als der verfügbare Bogen (kurze Größen bleiben in normaler Schriftgröße)
function setTireArcText(textPathEl, pathEl, text) {
  if (!textPathEl) return;
  textPathEl.textContent = text;
  textPathEl.removeAttribute('textLength');
  textPathEl.removeAttribute('lengthAdjust');
  if (!pathEl || typeof textPathEl.getComputedTextLength !== 'function') return;
  try {
    const maxLen = pathEl.getTotalLength() * 0.88;
    const natural = textPathEl.getComputedTextLength();
    if (natural > maxLen && maxLen > 0) {
      textPathEl.setAttribute('textLength', maxLen.toFixed(1));
      textPathEl.setAttribute('lengthAdjust', 'spacingAndGlyphs');
    }
  } catch (e) { /* z.B. Element noch nicht sichtbar im DOM - dann einfach normale Größe lassen */ }
}

// Formatiert ein Herstellungs- ("YYYY-MM") oder Kaufdatum ("YYYY-MM-DD") als "MM/YYYY" für die Dashboard-Kachel
function formatTireMonthLabel(dateStr) {
  if (!dateStr || dateStr.length < 7) return '';
  const [year, month] = dateStr.split('-');
  if (!year || !month) return '';
  return `${month}/${year}`;
}

// Ermittelt das Alter zu einem einzelnen Datumsstring ("YYYY-MM" Herstellungsdatum
// oder "YYYY-MM-DD" Kaufdatum) in Jahren sowie ob es damit als "alt" gilt.
// Liefert null für das Alter, wenn kein (gültiges) Datum übergeben wurde.
function getTireAgeInfoForDate(dateStr) {
  if (!dateStr) return { years: null, isOld: false, label: 'Alter unbekannt' };

  // "YYYY-MM" (Herstellungsdatum) oder "YYYY-MM-DD" (Kaufdatum) - beides von "-01" ergänzbar
  const parsable = dateStr.length === 7 ? dateStr + '-01' : dateStr;
  const refDate = new Date(parsable);
  if (isNaN(refDate.getTime())) return { years: null, isOld: false, label: 'Alter unbekannt' };

  const ageMs = Date.now() - refDate.getTime();
  const years = ageMs / (1000 * 60 * 60 * 24 * 365.25);
  const roundedYears = Math.floor(years * 10) / 10;
  const isOld = years >= TIRE_AGE_WARNING_YEARS;

  return {
    years: roundedYears,
    isOld,
    label: `${roundedYears.toFixed(1).replace('.0', '')} Jahre alt`
  };
}

// Ermittelt das Alter eines Reifensatzes (bevorzugt Herstellungsdatum, sonst
// Kaufdatum als Näherung) - für den "normalen" Fall ohne unterschiedliche
// Größe vorne/hinten
function getTireAgeInfo(tireSet) {
  return getTireAgeInfoForDate(tireSet.manufactureDate || tireSet.purchaseDate);
}

// Wie getTireAgeInfo(), aber achsenspezifisch: nutzt das Herstellungsdatum der
// jeweiligen Achse (vorne/hinten), fällt mangels achsenspezifischem Datum auf
// das allgemeine Kaufdatum des Satzes zurück
function getTireAxleAgeInfo(tireSet, axle) {
  const dateStr = axle === 'front'
    ? (tireSet.manufactureDateFront || tireSet.purchaseDate)
    : (tireSet.manufactureDateRear || tireSet.purchaseDate);
  return getTireAgeInfoForDate(dateStr);
}

function getMountedTireSet(v) {
  return (v.tireSets || []).find(t => t.mounted) || null;
}

// Öffnet das Reifen & Felgen Fenster (Übersicht) vom Dashboard aus
function openTireOverviewModal() {
  const v = getActiveVehicle();
  if (!v) return;
  renderTireSection(v);
  const modal = document.getElementById('tireOverviewModal');
  if (modal) modal.classList.add('active');
}
window.openTireOverviewModal = openTireOverviewModal;

function closeTireOverviewModal() {
  const modal = document.getElementById('tireOverviewModal');
  if (modal) modal.classList.remove('active');
}
window.closeTireOverviewModal = closeTireOverviewModal;

// Baut die Liste der Reifensatz-Karten im Reifen-Fenster auf
function renderTireSection(v) {
  const list = document.getElementById('tireSetsList');
  const emptyHint = document.getElementById('tireSetsEmptyHint');
  const swapBtn = document.getElementById('tireSwapBtn');
  if (!list) return;

  const tireSets = v.tireSets || [];
  list.innerHTML = '';

  if (emptyHint) emptyHint.style.display = tireSets.length === 0 ? '' : 'none';
  if (swapBtn) swapBtn.style.display = tireSets.length >= 2 ? '' : 'none';

  tireSets.forEach(tireSet => {
    const card = document.createElement('div');
    card.className = 'tire-set-card' + (tireSet.mounted ? ' tire-set-mounted' : '');

    let specsHtml;
    let ageHtml;
    let isOldOverall;
    if (tireSet.differentFrontRear) {
      const frontParts = [tireSet.tireSizeFront, tireSet.rimSizeFront].filter(Boolean);
      const rearParts = [tireSet.tireSizeRear, tireSet.rimSizeRear].filter(Boolean);
      specsHtml = `
        <span class="tire-set-specs">VA: ${frontParts.length ? frontParts.join(' • ') : 'nicht hinterlegt'}</span>
        <span class="tire-set-specs">HA: ${rearParts.length ? rearParts.join(' • ') : 'nicht hinterlegt'}</span>
      `;
      // Bei unterschiedlicher Größe hat jede Achse ihr eigenes Herstellungsdatum
      // (optional) und damit auch ihr eigenes Alter
      const ageFront = getTireAxleAgeInfo(tireSet, 'front');
      const ageRear = getTireAxleAgeInfo(tireSet, 'rear');
      isOldOverall = ageFront.isOld || ageRear.isOld;
      ageHtml = `
        <span class="tire-set-age${ageFront.isOld ? ' tire-set-age-old' : ''}">VA: ${ageFront.label}</span>
        <span class="tire-set-age${ageRear.isOld ? ' tire-set-age-old' : ''}">HA: ${ageRear.label}</span>
      `;
    } else {
      const specsParts = [tireSet.tireSize, tireSet.rimSize].filter(Boolean);
      specsHtml = `<span class="tire-set-specs">${specsParts.length ? specsParts.join(' • ') : 'Größe nicht hinterlegt'}</span>`;
      const age = getTireAgeInfo(tireSet);
      isOldOverall = age.isOld;
      ageHtml = `<span class="tire-set-age${age.isOld ? ' tire-set-age-old' : ''}">${age.label}</span>`;
    }

    card.innerHTML = `
      <div class="tire-set-main">
        <div class="tire-set-title-row">
          <span class="tire-set-title">${tireSet.label}</span>
          <span class="tire-set-badge ${tireSet.mounted ? 'tire-set-badge-mounted' : 'tire-set-badge-stored'}">${tireSet.mounted ? 'Montiert' : 'Eingelagert'}</span>
          ${isOldOverall ? '<span class="tire-set-badge tire-set-badge-old">Alt</span>' : ''}
        </div>
        ${specsHtml}
        ${ageHtml}
      </div>
      <div class="tire-set-actions">
        <button type="button" class="btn btn-secondary btn-sm" onclick="openTireFormModal('${tireSet.id}')">${ICON_EDIT_SVG}</button>
        <button type="button" class="btn btn-danger btn-sm" onclick="deleteTireSet('${tireSet.id}')">${ICON_DELETE_SVG}</button>
      </div>
    `;
    list.appendChild(card);
  });
}

function updateTireLabelCustomVisibility() {
  const labelEl = document.getElementById('tireLabel');
  const customGroup = document.getElementById('tireLabelCustomGroup');
  if (labelEl && customGroup) {
    customGroup.style.display = labelEl.value === 'custom' ? '' : 'none';
  }
}
window.updateTireLabelCustomVisibility = updateTireLabelCustomVisibility;

// Blendet je nach Checkbox "Vorne/hinten unterschiedlich" die passenden Größenfelder ein/aus
function updateTireFrontRearVisibility() {
  const diffEl = document.getElementById('tireDiffFrontRear');
  const singleGroup = document.getElementById('tireSizeSingleGroup');
  const frontRearGroup = document.getElementById('tireSizeFrontRearGroup');
  // Bei unterschiedlicher Größe vorne/hinten gibt's auch ein eigenes
  // Herstellungsdatum je Achse statt des einen allgemeinen Feldes
  const manufactureSingleGroup = document.getElementById('tireManufactureSingleGroup');
  if (!diffEl) return;
  const isDiff = diffEl.checked;
  if (singleGroup) singleGroup.style.display = isDiff ? 'none' : '';
  if (frontRearGroup) frontRearGroup.style.display = isDiff ? '' : 'none';
  if (manufactureSingleGroup) manufactureSingleGroup.style.display = isDiff ? 'none' : '';
}
window.updateTireFrontRearVisibility = updateTireFrontRearVisibility;

// editId leer/undefined = neuer Reifensatz, sonst wird der bestehende Satz vorausgefüllt
function openTireFormModal(editId) {
  const v = getActiveVehicle();
  if (!v) return;
  const existing = editId ? (v.tireSets || []).find(t => t.id === editId) : null;

  document.getElementById('tireEditId').value = editId || '';
  document.getElementById('tireFormTitle').innerText = existing ? 'Reifensatz bearbeiten' : 'Neuer Reifensatz';

  const knownLabels = ['Sommerreifen', 'Winterreifen', 'Ganzjahresreifen'];
  const labelEl = document.getElementById('tireLabel');
  const customEl = document.getElementById('tireLabelCustom');

  if (existing && !knownLabels.includes(existing.label)) {
    labelEl.value = 'custom';
    customEl.value = existing.label;
  } else {
    labelEl.value = existing ? existing.label : 'Sommerreifen';
    customEl.value = '';
  }
  updateTireLabelCustomVisibility();

  document.getElementById('tireSize').value = existing ? (existing.tireSize || '') : '';
  document.getElementById('tireRimSize').value = existing ? (existing.rimSize || '') : '';
  document.getElementById('tireManufactureDate').value = existing ? (existing.manufactureDate || '') : '';
  document.getElementById('tirePurchaseDate').value = existing ? (existing.purchaseDate || '') : '';

  const diffEl = document.getElementById('tireDiffFrontRear');
  diffEl.checked = !!(existing && existing.differentFrontRear);
  document.getElementById('tireSizeFront').value = existing ? (existing.tireSizeFront || '') : '';
  document.getElementById('tireRimSizeFront').value = existing ? (existing.rimSizeFront || '') : '';
  document.getElementById('tireSizeRear').value = existing ? (existing.tireSizeRear || '') : '';
  document.getElementById('tireRimSizeRear').value = existing ? (existing.rimSizeRear || '') : '';
  document.getElementById('tireManufactureDateFront').value = existing ? (existing.manufactureDateFront || '') : '';
  document.getElementById('tireManufactureDateRear').value = existing ? (existing.manufactureDateRear || '') : '';
  updateTireFrontRearVisibility();

  document.getElementById('tireFormModal').classList.add('active');
}
window.openTireFormModal = openTireFormModal;

function closeTireFormModal() {
  document.getElementById('tireFormModal').classList.remove('active');
}
window.closeTireFormModal = closeTireFormModal;

function saveTireSet(e) {
  e.preventDefault();
  const v = getActiveVehicle();
  if (!v) return;

  const editId = document.getElementById('tireEditId').value;
  const labelEl = document.getElementById('tireLabel');
  const label = labelEl.value === 'custom'
    ? (document.getElementById('tireLabelCustom').value.trim() || 'Sonstige')
    : labelEl.value;

  if (!v.tireSets) v.tireSets = [];
  const existing = editId ? v.tireSets.find(t => t.id === editId) : null;

  const differentFrontRear = document.getElementById('tireDiffFrontRear').checked;

  const tireSet = {
    id: editId || ('tire_' + Date.now()),
    label,
    tireSize: document.getElementById('tireSize').value.trim(),
    rimSize: document.getElementById('tireRimSize').value.trim(),
    differentFrontRear,
    tireSizeFront: differentFrontRear ? document.getElementById('tireSizeFront').value.trim() : '',
    rimSizeFront: differentFrontRear ? document.getElementById('tireRimSizeFront').value.trim() : '',
    tireSizeRear: differentFrontRear ? document.getElementById('tireSizeRear').value.trim() : '',
    rimSizeRear: differentFrontRear ? document.getElementById('tireRimSizeRear').value.trim() : '',
    // Herstellungsdatum: bei unterschiedlicher Größe vorne/hinten je Achse
    // eigenes Feld (beide optional), sonst das eine allgemeine Feld
    manufactureDate: differentFrontRear ? '' : (document.getElementById('tireManufactureDate').value || ''),
    manufactureDateFront: differentFrontRear ? (document.getElementById('tireManufactureDateFront').value || '') : '',
    manufactureDateRear: differentFrontRear ? (document.getElementById('tireManufactureDateRear').value || '') : '',
    purchaseDate: document.getElementById('tirePurchaseDate').value || '',
    // Der allererste angelegte Satz gilt automatisch als montiert, damit nicht
    // jeder gleich manuell einen Reifenwechsel durchführen muss
    mounted: existing ? existing.mounted : v.tireSets.length === 0
  };

  if (existing) {
    const idx = v.tireSets.findIndex(t => t.id === editId);
    v.tireSets[idx] = tireSet;
  } else {
    v.tireSets.push(tireSet);
  }

  saveData();
  closeTireFormModal();
  renderTireSection(v);
  renderDashboard();
}
window.saveTireSet = saveTireSet;

function deleteTireSet(id) {
  const v = getActiveVehicle();
  if (!v || !v.tireSets) return;
  if (!confirm('Diesen Reifensatz wirklich löschen?')) return;

  const wasMounted = v.tireSets.find(t => t.id === id)?.mounted;
  v.tireSets = v.tireSets.filter(t => t.id !== id);

  // Falls der montierte Satz gelöscht wurde und noch andere übrig sind,
  // keinen automatisch neu montieren lassen - lieber bewusst per Reifenwechsel
  // festlegen, damit nichts fälschlich als "montiert" gilt
  if (wasMounted) {
    // nichts weiter zu tun - keiner ist mehr als montiert markiert
  }

  saveData();
  renderTireSection(v);
  renderDashboard();
}
window.deleteTireSet = deleteTireSet;

function openTireSwapModal() {
  const v = getActiveVehicle();
  if (!v || !v.tireSets || v.tireSets.length < 2) return;

  const list = document.getElementById('tireSwapList');
  list.innerHTML = v.tireSets.map(t => {
    const specs = [t.tireSize, t.rimSize].filter(Boolean).join(' • ') || 'Größe nicht hinterlegt';
    return `
      <button type="button" class="tire-swap-option${t.mounted ? ' tire-swap-option-current' : ''}" onclick="applyTireSwap('${t.id}')">
        <span>
          <strong>${t.label}</strong><br>
          <span class="sub-text">${specs}</span>
        </span>
        ${t.mounted ? '<span class="tire-set-badge tire-set-badge-mounted">Aktuell montiert</span>' : ''}
      </button>
    `;
  }).join('');

  document.getElementById('tireSwapModal').classList.add('active');
}
window.openTireSwapModal = openTireSwapModal;

function closeTireSwapModal() {
  document.getElementById('tireSwapModal').classList.remove('active');
}
window.closeTireSwapModal = closeTireSwapModal;

function applyTireSwap(id) {
  const v = getActiveVehicle();
  if (!v || !v.tireSets) return;

  v.tireSets.forEach(t => { t.mounted = (t.id === id); });

  saveData();
  closeTireSwapModal();
  renderTireSection(v);
  renderDashboard();
}
window.applyTireSwap = applyTireSwap;
