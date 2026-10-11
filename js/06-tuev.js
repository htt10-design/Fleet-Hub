/* --- TÜV/HU-ASSISTENT ---
   Geführter Wizard mit 6 Schritten (Termin & Organisation → AU → HU →
   Plakette → Mängel/Bericht → Zusammenfassung), erreichbar durch Klick auf
   die TÜV-Plakette im Dashboard. Deckt sowohl den Ersteintrag (ohne
   frischen Bericht, AU/HU einfach überspringen) als auch die echte
   Erneuerung ab. Schritt 4 (Plakette/Animation) wird komplett übersprungen,
   wenn das HU-Ergebnis auf einen erheblichen/gefährlichen Mangel oder
   "Verkehrsunsicher" lautet - stattdessen wird automatisch eine kurze
   Nachprüfungs-Erinnerung (ca. 1 Monat) angelegt, ohne das bestehende
   TÜV-Fälligkeitsdatum zu verändern. */

const TUEV_STEP_LABELS = {
  1: 'Termin & Organisation',
  2: 'Abgasuntersuchung (AU)',
  3: 'Hauptuntersuchung (HU)',
  4: 'Neue Plakette',
  5: 'Mängel & Bericht',
  6: 'Zusammenfassung'
};

// Liefert die tatsächliche, zusammenhängende Schrittfolge: Schritt 4 (Plakette)
// entfällt komplett, wenn keine neue Plakette erteilt wird
function getTuevStepSequence() {
  return (tuevWizardState && tuevWizardState.stickerGranted) ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 5, 6];
}

function openTuevWizard() {
  const v = getActiveVehicle();
  if (!v) return;
  if (v.category === 'boot') {
    alert('Der TÜV/HU-Assistent ist für Boote nicht relevant.');
    return;
  }

  tuevWizardState = {
    date: new Date().toISOString().split('T')[0],
    mileage: null,
    org: 'TÜV',
    orgCustom: '',
    cost: null,
    auResult: null,
    huResult: null,
    stickerGranted: true,
    nextTuevDate: null,
    maengelNotes: ''
  };
  tempTuevImages = [];
  tuevWizardStep = 1;

  document.getElementById('tuevDate').value = tuevWizardState.date;
  document.getElementById('tuevMileage').value = '';
  document.getElementById('tuevOrg').value = 'TÜV';
  document.getElementById('tuevOrgCustom').value = '';
  updateTuevOrgCustomVisibility();
  document.getElementById('tuevCost').value = '';
  clearTuevChoiceSelection('tuevAuChoices');
  clearTuevChoiceSelection('tuevHuChoices');
  document.getElementById('tuevNextDate').value = '';
  document.getElementById('tuevMaengelNotes').value = '';
  renderTuevImagePreviews();

  document.getElementById('tuevWizardModal').classList.add('active');
  renderTuevWizardStep();
}
window.openTuevWizard = openTuevWizard;

function closeTuevWizard() {
  const modal = document.getElementById('tuevWizardModal');
  if (modal) modal.classList.remove('active');
}
window.closeTuevWizard = closeTuevWizard;

function updateTuevOrgCustomVisibility() {
  const select = document.getElementById('tuevOrg');
  const group = document.getElementById('tuevOrgCustomGroup');
  if (!select || !group) return;
  group.style.display = select.value === 'custom' ? '' : 'none';
}
window.updateTuevOrgCustomVisibility = updateTuevOrgCustomVisibility;

function clearTuevChoiceSelection(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.querySelectorAll('.wizard-choice-btn').forEach(btn => btn.classList.remove('active'));
}

// Klick auf einen AU-Auswahlbutton: markieren und automatisch weiter (kein
// separater "Weiter"-Tap nötig für diese Wahl)
function selectTuevAu(value) {
  if (!tuevWizardState) return;
  tuevWizardState.auResult = value;
  clearTuevChoiceSelection('tuevAuChoices');
  const btn = document.querySelector(`#tuevAuChoices .wizard-choice-btn[data-value="${value}"]`);
  if (btn) btn.classList.add('active');
  setTimeout(() => tuevWizardNext(), 150);
}
window.selectTuevAu = selectTuevAu;

// Klick auf einen HU-Auswahlbutton: markieren, Plaketten-Berechtigung neu
// bestimmen und automatisch weiter
function selectTuevHu(value) {
  if (!tuevWizardState) return;
  tuevWizardState.huResult = value;
  tuevWizardState.stickerGranted = !['Erheblicher Mangel', 'Gefährlicher Mangel', 'Verkehrsunsicher'].includes(value);
  clearTuevChoiceSelection('tuevHuChoices');
  const btn = document.querySelector(`#tuevHuChoices .wizard-choice-btn[data-value="${value}"]`);
  if (btn) btn.classList.add('active');
  setTimeout(() => tuevWizardNext(), 150);
}
window.selectTuevHu = selectTuevHu;

// "Überspringen" gibt es nur bei den AU-/HU-Auswahlschritten, um explizit
// ohne Auswahl weiterzugehen (z.B. beim Ersteintrag ohne Bericht)
function tuevWizardSkip() {
  if (!tuevWizardState) return;
  if (tuevWizardStep === 2) {
    tuevWizardState.auResult = null;
    clearTuevChoiceSelection('tuevAuChoices');
  } else if (tuevWizardStep === 3) {
    tuevWizardState.huResult = null;
    tuevWizardState.stickerGranted = true;
    clearTuevChoiceSelection('tuevHuChoices');
  }
  tuevWizardNext();
}
window.tuevWizardSkip = tuevWizardSkip;

function tuevWizardNext() {
  if (!tuevWizardState) return;
  const seq = getTuevStepSequence();
  const idx = seq.indexOf(tuevWizardStep);

  if (tuevWizardStep === 1) {
    const dateVal = document.getElementById('tuevDate').value;
    if (!dateVal) {
      alert('Bitte zuerst ein Datum eintragen.');
      return;
    }
    tuevWizardState.date = dateVal;
    tuevWizardState.mileage = parseFormattedNumber(document.getElementById('tuevMileage').value) || null;
    const orgSelect = document.getElementById('tuevOrg').value;
    tuevWizardState.org = orgSelect === 'custom'
      ? (document.getElementById('tuevOrgCustom').value.trim() || 'Sonstige')
      : orgSelect;
    tuevWizardState.cost = parseFloat(document.getElementById('tuevCost').value) || null;
  }

  if (tuevWizardStep === 4) {
    tuevWizardState.nextTuevDate = document.getElementById('tuevNextDate').value || null;
  }

  if (tuevWizardStep === 5) {
    tuevWizardState.maengelNotes = document.getElementById('tuevMaengelNotes').value.trim();
  }

  if (idx !== -1 && idx < seq.length - 1) {
    tuevWizardStep = seq[idx + 1];
    renderTuevWizardStep();
  }
}
window.tuevWizardNext = tuevWizardNext;

function tuevWizardBack() {
  if (!tuevWizardState) return;
  const seq = getTuevStepSequence();
  const idx = seq.indexOf(tuevWizardStep);
  if (idx > 0) {
    tuevWizardStep = seq[idx - 1];
    renderTuevWizardStep();
  }
}
window.tuevWizardBack = tuevWizardBack;

// Schlägt das nächste TÜV-Fälligkeitsdatum vor (Monat/Jahr), ohne ein
// bereits vom Nutzer ausgefülltes Feld zu überschreiben: bei einem echten
// beantworteten AU-/HU-Termin automatisch +2 Jahre ab Termin-Datum, sonst
// (Ersteintrag/übersprungen) als Rückfallwert das bisherige Fälligkeitsdatum
function prefillTuevNextDate() {
  const field = document.getElementById('tuevNextDate');
  if (!field || field.value) return;

  const v = getActiveVehicle();
  const state = tuevWizardState;
  const answered = !!(state.auResult || state.huResult);

  if (answered && state.date) {
    field.value = addMonthsToDateStr(state.date, 24).slice(0, 7);
  } else if (v && v.nextTuev) {
    field.value = v.nextTuev;
  } else {
    field.value = '';
  }
}

// Addiert eine Anzahl Monate zu einem "YYYY-MM-DD"-Datumsstring
function addMonthsToDateStr(dateStr, months) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setMonth(d.getMonth() + months);
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Spielt die "Plakette wird geklebt"-Animation ab (per CSS-Klasse mit
// erzwungenem Reflow, damit sie bei jedem erneuten Betreten von Schritt 4
// erneut abläuft), färbt die Plakette passend zum Zieljahr ein und zeichnet
// - wie bei der echten Plakette auf Kachel/Dashboard - den Monats-Zahlenkranz
// sowie die Jahreszahl in der Mitte
function playTuevStickerAnimation() {
  const badge = document.getElementById('tuevStickerBadge');
  if (!badge) return;

  const tuevColors = ['braun', 'rosa', 'gruen', 'orange', 'blau', 'gelb'];
  const nextDateField = document.getElementById('tuevNextDate');
  let colorClass = 'color-blau';
  let month = null;
  let yearShort = '';

  if (nextDateField && nextDateField.value) {
    const parts = nextDateField.value.split('-');
    const year = parseInt(parts[0], 10);
    const parsedMonth = parseInt(parts[1], 10);
    if (!isNaN(year)) {
      colorClass = 'color-' + tuevColors[((year % 6) + 6) % 6];
      yearShort = (year % 100).toString().padStart(2, '0');
    }
    if (!isNaN(parsedMonth)) month = parsedMonth;
  }

  const badgeSizePx = 56;
  const ringHtml = month ? buildTuevMonthRing(month, badgeSizePx) : '';

  badge.classList.remove('sticker-applied');
  void badge.offsetWidth;
  badge.className = 'tuev-sticker-badge ' + colorClass;
  badge.innerHTML = `
    <div class="tuev-plakette-ring">${ringHtml}</div>
    <div class="tuev-plakette-center">
      <span class="tuev-plakette-year">${yearShort}</span>
    </div>
  `;
  void badge.offsetWidth;
  badge.classList.add('sticker-applied');
}

function renderTuevWizardStep() {
  if (!tuevWizardState) return;
  const seq = getTuevStepSequence();
  const idx = seq.indexOf(tuevWizardStep);

  for (let s = 1; s <= 6; s++) {
    const el = document.getElementById('tuevStep' + s);
    if (el) el.style.display = (s === tuevWizardStep) ? '' : 'none';
  }

  const label = document.getElementById('tuevStepLabel');
  if (label) label.innerText = `Schritt ${idx + 1} von ${seq.length}: ${TUEV_STEP_LABELS[tuevWizardStep] || ''}`;

  const dotsContainer = document.getElementById('tuevStepDots');
  if (dotsContainer) {
    dotsContainer.innerHTML = seq.map((_, i) =>
      `<span class="wizard-step-dot${i === idx ? ' active' : ''}"></span>`
    ).join('');
  }

  const backBtn = document.getElementById('tuevBackBtn');
  const skipBtn = document.getElementById('tuevSkipBtn');
  const nextBtn = document.getElementById('tuevNextBtn');
  const saveBtn = document.getElementById('tuevSaveBtn');

  if (backBtn) backBtn.style.display = idx > 0 ? '' : 'none';
  if (skipBtn) skipBtn.style.display = (tuevWizardStep === 2 || tuevWizardStep === 3) ? '' : 'none';

  const isLastStep = idx === seq.length - 1;
  if (nextBtn) nextBtn.style.display = isLastStep ? 'none' : '';
  if (saveBtn) saveBtn.style.display = isLastStep ? '' : 'none';

  if (tuevWizardStep === 4) {
    prefillTuevNextDate();
    playTuevStickerAnimation();
    const nextDateField = document.getElementById('tuevNextDate');
    if (nextDateField) nextDateField.oninput = () => playTuevStickerAnimation();
  }

  if (tuevWizardStep === 5) {
    const hint = document.getElementById('tuevStep5Hint');
    if (hint) {
      hint.innerText = tuevWizardState.stickerGranted
        ? 'Mängel oder Auffälligkeiten aus dem Bericht (optional).'
        : 'Bitte die festgestellten Mängel notieren – daraus wird automatisch eine kurze Nachprüfungs-Erinnerung angelegt.';
    }
  }

  if (tuevWizardStep === 6) {
    renderTuevSummary();
  }
}

function handleTuevImageUpload(event) {
  const files = Array.from(event.target.files);
  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = async function(e) {
      const compressed = await compressImage(e.target.result);
      tempTuevImages.push(compressed);
      renderTuevImagePreviews();
    };
    reader.readAsDataURL(file);
  });
}
window.handleTuevImageUpload = handleTuevImageUpload;

function renderTuevImagePreviews() {
  const container = document.getElementById('tuevImagePreviewContainer');
  if (!container) return;
  container.innerHTML = '';
  tempTuevImages.forEach((imgSrc, index) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'preview-thumb-wrapper';
    wrapper.innerHTML = `
      <img src="${imgSrc}" class="preview-thumb">
      <button type="button" class="btn-remove-thumb" onclick="removeTempTuevImage(${index})">✕</button>
    `;
    container.appendChild(wrapper);
  });
}

function removeTempTuevImage(index) {
  tempTuevImages.splice(index, 1);
  renderTuevImagePreviews();
}
window.removeTempTuevImage = removeTempTuevImage;

function renderTuevSummary() {
  const container = document.getElementById('tuevSummary');
  if (!container || !tuevWizardState) return;
  const s = tuevWizardState;

  const rows = [];
  rows.push(['Datum', s.date ? new Date(s.date + 'T00:00:00').toLocaleDateString('de-DE') : '-']);
  if (s.mileage) rows.push(['KM-Stand', formatNumberForDisplay(String(s.mileage)) + ' km']);
  rows.push(['Organisation', s.org || '-']);
  if (s.cost) rows.push(['Kosten', s.cost.toFixed(2).replace('.', ',') + ' €']);
  rows.push(['AU-Ergebnis', s.auResult || 'nicht erfasst']);
  rows.push(['HU-Ergebnis', s.huResult || 'nicht erfasst']);

  if (s.stickerGranted) {
    rows.push(['Neue Plakette bis', s.nextTuevDate ? formatTuevDate(s.nextTuevDate) : '-']);
  }
  if (s.maengelNotes) rows.push(['Mängel/Notizen', s.maengelNotes]);
  if (tempTuevImages.length > 0) rows.push(['Fotos', `${tempTuevImages.length} Bild(er) angehängt`]);

  let html = rows.map(([label, value]) =>
    `<div class="tuev-summary-row"><strong>${label}:</strong> <span>${value}</span></div>`
  ).join('');

  if (!s.stickerGranted) {
    html += `<div class="tuev-summary-warning">Keine neue Plakette – es wird automatisch eine kurze Nachprüfungs-Erinnerung (ca. 1 Monat) angelegt. Das bestehende TÜV-Fälligkeitsdatum bleibt unverändert.</div>`;
  }

  container.innerHTML = html;
}

function saveTuevWizard() {
  const v = getActiveVehicle();
  if (!v || !tuevWizardState) return;

  const s = tuevWizardState;
  if (!v.serviceEntries) v.serviceEntries = [];

  let title = s.stickerGranted ? `HU/AU bei ${s.org || 'TÜV'}` : `TÜV-Termin bei ${s.org || 'TÜV'}`;
  if (!s.stickerGranted) title += ' (Nachprüfung nötig)';

  const noteLines = [];
  if (s.auResult) noteLines.push(`AU: ${s.auResult}`);
  if (s.huResult) noteLines.push(`HU: ${s.huResult}`);
  if (s.maengelNotes) noteLines.push(`Mängel: ${s.maengelNotes}`);
  const notes = noteLines.join('\n');

  const entry = {
    id: "s_" + Date.now(),
    isStandEntry: false,
    category: 'TÜV',
    title,
    date: s.date,
    mileage: s.mileage || 0,
    cost: s.cost || 0,
    performer: 'Werkstatt',
    notes,
    images: [...tempTuevImages],
    nextKm: null,
    nextDate: s.stickerGranted ? null : addMonthsToDateStr(s.date, 1),
    engineId: null,
    // Nur vom TÜV-Assistenten gesetzt (zusätzliches, optionales Feld - wird von
    // anderem Code, z.B. der Detailansicht, einfach ignoriert): merkt sich, ob
    // dieser Eintrag das TÜV-Fälligkeitsdatum geändert hat und was vorher
    // eingetragen war, damit es beim Löschen dieses Eintrags wiederhergestellt
    // werden kann (statt einfach so stehen zu bleiben)
    tuevUpdatedNextTuev: false,
    tuevPrevDueDate: null
  };

  if (s.stickerGranted && s.nextTuevDate) {
    entry.tuevUpdatedNextTuev = true;
    entry.tuevPrevDueDate = v.nextTuev || null;
    v.nextTuev = s.nextTuevDate;
  }

  v.serviceEntries.push(entry);
  v.serviceEntries.sort(compareByDateThenMileageDesc);

  saveData();
  closeTuevWizard();
  renderServiceTable();
  renderDashboard();
  renderGarageVehicleTiles();

  alert(s.stickerGranted
    ? 'TÜV/HU erfolgreich erfasst – neue Plakette hinterlegt.'
    : 'TÜV/HU erfasst. Da keine neue Plakette erteilt wurde, wurde eine kurze Nachprüfungs-Erinnerung angelegt.');
}
window.saveTuevWizard = saveTuevWizard;
