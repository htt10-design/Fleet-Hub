/* Feste Farben der Kostenkategorien (Kachel-Vorschau, Kosten-Detailansicht).
   Gegen Farbenblindheit/Kontrast geprüft (dataviz-Validator) - Reihenfolge fest. */
const COST_CATEGORY_COLORS = {
  Kraftstoff: { light: '#2a78d6', dark: '#3987e5' },
  Werkstatt:  { light: '#1baf7a', dark: '#199e70' },
  Sonstiges:  { light: '#a8741c', dark: '#b98a2c' }
};

/* --- DASHBOARD & CHARTS --- */
function renderDashboard() {
  const v = getActiveVehicle();
  if (!v) return;

  document.getElementById('dashVehicleName').innerText = v.name || 'Unbenanntes Fahrzeug';
  document.getElementById('dashVehiclePlate').innerText = v.plate || 'OHNE-ID';
  document.getElementById('dashVehicleFuel').innerText = `Kraftstoff: ${v.fuelType || '-'}`;
  document.getElementById('dashVehicleType').innerText = `Typ: ${v.type === 'km' ? 'KM' : 'Betriebsstunden'}`;

  // Kraftstoff & Erfassungstyp sind bei einem Anhänger (kein Motor, kein Stand) nicht relevant
  const dashSpecsRow = document.getElementById('dashSpecsRow');
  if (dashSpecsRow) dashSpecsRow.style.display = v.category === 'anhaenger' ? 'none' : '';
  if (v.category === 'boot') {
    document.getElementById('dashVehicleVin').innerText = `Rumpfnummer (HIN): ${v.hullNumber || '-'}`;
  } else {
    document.getElementById('dashVehicleVin').innerText = `VIN: ${v.vin || '-'}`;
  }
  document.getElementById('dashVehicleSpecs').innerText = v.specs || 'Keine Spezifikationen eingetragen.';

  // TÜV-Plakette auf dem Fahrzeugfoto im Dashboard (wie auf der Kachel)
  const dashPlaketteContainer = document.getElementById('dashTuevPlakette');
  if (dashPlaketteContainer) {
    // Auf dem Handy-Layout (siehe CSS @media max-width: 850px) wird die
    // Dashboard-Plakette per CSS auf 52px verkleinert - das muss hier bekannt
    // sein, sonst werden die Striche für 64px berechnet und ragen über den
    // (kleineren) Rand hinaus
    const dashPlaketteSizePx = window.innerWidth <= 850 ? 52 : 64;
    const dashTuevPlakette = getTuevPlaketteData(v, dashPlaketteSizePx);
    // Kleines Stift-Symbol + dezenter Puls-Ring, damit man auch ohne Hinweistext
    // erkennt, dass sich hinter der Plakette der TÜV-Assistent zum Antippen
    // verbirgt (v.a. auf dem Handy, wo es keinen Hover-Zustand gibt)
    const tapHintHtml = `<span class="tuev-plakette-tap-hint">${ICON_EDIT_SVG}</span>`;

    if (!dashTuevPlakette) {
      dashPlaketteContainer.innerHTML = '';
    } else if (dashTuevPlakette.empty) {
      dashPlaketteContainer.innerHTML = `<div class="tuev-plakette tuev-plakette-empty">${tapHintHtml}</div>`;
    } else {
      dashPlaketteContainer.innerHTML = `
        <div class="tuev-plakette ${dashTuevPlakette.colorClass}">
          <div class="tuev-plakette-ring">${dashTuevPlakette.monthRingHtml}</div>
          <div class="tuev-plakette-center">
            <span class="tuev-plakette-year">${dashTuevPlakette.year}</span>
          </div>
          ${dashTuevPlakette.overdue ? '<span class="tuev-plakette-overdue-badge">!</span>' : ''}
          ${tapHintHtml}
        </div>
      `;
    }
  }

  const hsn = v.hsn || '-';
  const tsn = v.tsn || '-';
  document.getElementById('dashVehicleHsnTsn').innerText = `HSN/TSN: ${hsn} / ${tsn}`;


  const imgDash = document.getElementById('vehicleDashboardImage');
  const imgPlaceholder = document.getElementById('vehicleImagePlaceholder');

  if (v.image) {
    imgDash.src = v.image;
    imgDash.style.display = 'block';
    imgPlaceholder.style.display = 'none';
  } else {
    imgDash.style.display = 'none';
    imgPlaceholder.style.display = 'block';
  }

  const fuelList = v.fuelEntries || [];
  const serviceList = v.serviceEntries || [];

  const allMileage = [
    ...fuelList.map(f => f.mileage || 0),
    ...serviceList.map(s => s.mileage || 0)
  ];
  const maxMileage = allMileage.length > 0 ? Math.max(...allMileage) : 0;
  document.getElementById('kpi-mileage').innerText = `${maxMileage.toLocaleString()} ${v.type === 'km' ? 'km' : 'Std'}`;

  // Voll-zu-Voll-Methode (inkl. Teilbetankungen, Neustart bei "firstFill")
  const avgConsumption = getAverageConsumption(fuelList);
  const unitLabel = v.type === 'km' ? 'L/100km' : 'L/Std';
  document.getElementById('kpi-consumption').innerHTML = `${avgConsumption.toFixed(2)} <small>${unitLabel}</small>`;

  const fuelCosts = fuelList.reduce((sum, f) => sum + (f.totalPrice || 0), 0);
  const serviceCosts = serviceList.reduce((sum, s) => sum + (s.cost || 0), 0);
  const totalCosts = fuelCosts + serviceCosts;
  document.getElementById('kpi-total-cost').innerText = `${totalCosts.toFixed(2)} €`;

  // Mini-Vorschau (Anteile Sprit / Werkstatt / Sonstiges) - Details per Tippen
  renderCostTilePreview(v);

  // KPI-Kacheln je nach Fahrzeugart ein-/ausblenden:
  // - Anhänger hat keinen eigenen Antrieb und keinen sinnvollen KM-Stand
  const kpiMileageCard = document.getElementById('kpiMileageCard');
  const kpiConsumptionCard = document.getElementById('kpiConsumptionCard');
  const kpiTireCard = document.getElementById('kpiTireCard');
  const hasEngine = vehicleHasEngine(v);
  const boatEnginesForDash = getBoatEngines(v);
  const multiEngineBoat = v.category === 'boot' && boatEnginesForDash.length > 1;
  // Bei Autos mit KM-Erfassung ersetzt die Tacho-Walzen-Anzeige die normale KPI-Kachel
  const useOdometer = (v.category || 'auto') === 'auto' && v.type !== 'hours';
  const showMileage = v.category !== 'anhaenger' && !multiEngineBoat && !useOdometer;
  if (kpiMileageCard) kpiMileageCard.style.display = showMileage ? '' : 'none';
  if (kpiConsumptionCard) kpiConsumptionCard.style.display = hasEngine ? '' : 'none';

  // Reifen-KPI-Kachel: nur Auto & Anhänger (Boote haben keine Reifen)
  const showTireCard = v.category !== 'boot';
  if (kpiTireCard) {
    kpiTireCard.style.display = showTireCard ? '' : 'none';
    if (showTireCard) {
      ensureTireKpiWheelsBuilt();
      const mounted = getMountedTireSet(v);
      const visualEl = document.getElementById('kpi-tire-visual');
      const tireSubEl = document.getElementById('kpi-tire-sub');
      const axleLabelEl = document.getElementById('kpi-tire-axle-label');
      const dotsEl = document.getElementById('kpi-tire-dots');
      if (!v.tireSets || v.tireSets.length === 0) {
        tireKpiAxleData = null;
        setTireArcText(document.getElementById('kpi-tire-arc-text-front'), document.getElementById('kpiTireArcPath-front'), '-');
        if (visualEl) visualEl.classList.add('tire-kpi-empty');
        if (axleLabelEl) axleLabelEl.style.display = 'none';
        if (dotsEl) dotsEl.style.display = 'none';
        tireKpiCurrentPage = 0;
        resetTireKpiTrackPosition();
        if (tireSubEl) {
          tireSubEl.innerText = 'Noch nicht erfasst';
          tireSubEl.classList.remove('kpi-sub-warning');
        }
      } else if (!mounted) {
        tireKpiAxleData = null;
        setTireArcText(document.getElementById('kpi-tire-arc-text-front'), document.getElementById('kpiTireArcPath-front'), '-');
        if (visualEl) visualEl.classList.add('tire-kpi-empty');
        if (axleLabelEl) axleLabelEl.style.display = 'none';
        if (dotsEl) dotsEl.style.display = 'none';
        tireKpiCurrentPage = 0;
        resetTireKpiTrackPosition();
        if (tireSubEl) {
          tireSubEl.innerText = 'Kein Satz als montiert markiert';
          tireSubEl.classList.remove('kpi-sub-warning');
        }
      } else {
        if (visualEl) visualEl.classList.remove('tire-kpi-empty');

        const frontParts = [mounted.tireSizeFront, mounted.rimSizeFront].filter(Boolean);
        const rearParts = [mounted.tireSizeRear, mounted.rimSizeRear].filter(Boolean);
        if (mounted.differentFrontRear && (frontParts.length || rearParts.length)) {
          // Eigenes Herstellungsdatum/Alter je Achse - der Sub-Text unter der
          // Kachel wird passend zur gerade sichtbaren Seite (vorne/hinten) in
          // renderTireKpiPage() gesetzt
          const ageFront = getTireAxleAgeInfo(mounted, 'front');
          const ageRear = getTireAxleAgeInfo(mounted, 'rear');
          const dateLabelFront = formatTireMonthLabel(mounted.manufactureDateFront || mounted.purchaseDate);
          const dateLabelRear = formatTireMonthLabel(mounted.manufactureDateRear || mounted.purchaseDate);
          tireKpiAxleData = {
            front: frontParts.length ? frontParts.join(' · ') : '-',
            rear: rearParts.length ? rearParts.join(' · ') : '-',
            subLabelFront: dateLabelFront ? `${mounted.label} VA von ${dateLabelFront}` : `${mounted.label} VA`,
            subLabelRear: dateLabelRear ? `${mounted.label} HA von ${dateLabelRear}` : `${mounted.label} HA`,
            isOldFront: ageFront.isOld,
            isOldRear: ageRear.isOld
          };
          setTireArcText(document.getElementById('kpi-tire-arc-text-front'), document.getElementById('kpiTireArcPath-front'), tireKpiAxleData.front);
          setTireArcText(document.getElementById('kpi-tire-arc-text-rear'), document.getElementById('kpiTireArcPath-rear'), tireKpiAxleData.rear);
          if (axleLabelEl) axleLabelEl.style.display = '';
          if (dotsEl) dotsEl.style.display = '';
          tireKpiCurrentPage = 0;
          resetTireKpiTrackPosition();
          renderTireKpiPage();
        } else {
          tireKpiAxleData = null;
          if (tireSubEl) {
            const age = getTireAgeInfo(mounted);
            const dateLabel = formatTireMonthLabel(mounted.manufactureDate || mounted.purchaseDate);
            tireSubEl.innerText = dateLabel ? `${mounted.label} von ${dateLabel}` : mounted.label;
            tireSubEl.classList.toggle('kpi-sub-warning', age.isOld);
          }
          if (axleLabelEl) axleLabelEl.style.display = 'none';
          if (dotsEl) dotsEl.style.display = 'none';
          tireKpiCurrentPage = 0;
          resetTireKpiTrackPosition();
          const sizeParts = [mounted.tireSize, mounted.rimSize].filter(Boolean);
          setTireArcText(document.getElementById('kpi-tire-arc-text-front'), document.getElementById('kpiTireArcPath-front'), sizeParts.length ? sizeParts.join(' · ') : mounted.label);
        }
      }
    }
  }

  const odometerWrapper = document.getElementById('odometerWrapper');
  if (odometerWrapper) {
    if (useOdometer) {
      odometerWrapper.style.display = '';
      const odoDigits = document.getElementById('odometerDigits');
      const paddedKm = Math.max(0, Math.round(maxMileage)).toString().padStart(6, '0').slice(-6);
      odoDigits.innerHTML = paddedKm.split('').map(d => `<span class="odometer-digit">${d}</span>`).join('');
    } else {
      odometerWrapper.style.display = 'none';
    }
  }

  // "Stand erfassen"-Button: bei Anhängern (kein sinnvoller Stand) ausblenden,
  // sonst Beschriftung passend zu KM/Betriebsstunden setzen
  const standEntryBtnWrapper = document.getElementById('standEntryBtnWrapper');
  const standEntryBtn = document.getElementById('standEntryBtn');
  if (standEntryBtnWrapper) standEntryBtnWrapper.style.display = (v.category === 'anhaenger') ? 'none' : '';
  if (standEntryBtn) standEntryBtn.innerText = v.type === 'hours' ? 'Betriebsstunden erfassen' : 'KM-Stand erfassen';

  // Fahrzeugschein-Kachel: nur bei Autos & Anhängern (straßenzugelassene Fahrzeuge)
  const fzscheinOpenCard = document.getElementById('fzscheinOpenCard');
  if (fzscheinOpenCard) fzscheinOpenCard.style.display = (v.category === 'boot') ? 'none' : '';

  // Bei Booten mit mehreren Motoren: eine eigene Betriebsstunden-Kachel pro Motor
  // statt nur einem gemeinsamen "Aktueller Stand"
  const engineHoursGrid = document.getElementById('engineHoursGrid');
  if (engineHoursGrid) {
    if (multiEngineBoat) {
      engineHoursGrid.innerHTML = boatEnginesForDash.map(engine => {
        const hours = getEngineCurrentHours(v, engine.id);
        return `
          <div class="kpi-card">
            <span class="kpi-label">${engine.name || 'Motor'}</span>
            <div class="kpi-value">${hours.toLocaleString('de-DE')} Std</div>
            <span class="kpi-sub">Betriebsstunden</span>
          </div>
        `;
      }).join('');
      engineHoursGrid.style.display = 'grid';
    } else {
      engineHoursGrid.innerHTML = '';
      engineHoursGrid.style.display = 'none';
    }
  }

  const reminderList = document.getElementById('reminderList');
  if (reminderList) {
    reminderList.innerHTML = '';

    const maintenanceReminders = getUpcomingMaintenanceReminders(v);

    maintenanceReminders.forEach(r => {
      const li = document.createElement('li');
      li.className = 'reminder-item' + (r.overdue ? ' reminder-overdue' : '');
      li.innerHTML = `<span class="reminder-title">${r.title}</span><span class="reminder-meta">${formatReminderMeta(r, v.type === 'hours' ? 'Std' : 'km')}</span>`;
      reminderList.appendChild(li);
    });

    // TÜV/HU ist für Boote nicht relevant
    const tuevRelevant = v.category !== 'boot';

    if (tuevRelevant && v.nextTuev) {
      const li = document.createElement('li');
      li.className = 'reminder-item';
      li.innerHTML = `<span class="reminder-title">Nächster TÜV / Inspektion</span><span class="reminder-meta">${formatTuevDate(v.nextTuev)}</span>`;
      reminderList.appendChild(li);
    }

    if (maintenanceReminders.length === 0 && (!tuevRelevant || !v.nextTuev)) {
      reminderList.innerHTML = '<li>Keine anstehenden Termine eingetragen.</li>';
    }
  }

  renderCharts(v);
}

// Liest eine CSS-Custom-Property vom Dokument (folgt also automatisch Theme
// (hell/dunkel) und der gewählten Akzentfarbe), mit Fallback falls leer.
function getCssVar(name, fallback) {
  const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return val || fallback;
}

// Wandelt eine "#rrggbb"-Hexfarbe in einen "rgba(...)"-String mit gewünschter
// Deckkraft um (für Verlaufsfüllungen/Glow-Effekte in Charts).
function hexToRgba(hex, alpha) {
  const clean = (hex || '').replace('#', '');
  if (clean.length !== 6) return `rgba(243, 156, 18, ${alpha})`;
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// "2026-10-03" -> "03.10.26" (kurz für die Achsenbeschriftung)
function formatChartDate(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${d}.${m}.${y.slice(2)}`;
}

function renderCharts(v) {
  if (typeof Chart === 'undefined') return;

  // Verbrauchsverlauf ergibt bei einem Anhänger (kein Motor, keine Betankung) keinen Sinn
  const hasEngineForCharts = vehicleHasEngine(v);
  const consumptionChartCard = document.getElementById('consumptionChartCard');
  if (consumptionChartCard) consumptionChartCard.style.display = hasEngineForCharts ? '' : 'none';

  const fuelList = v.fuelEntries || [];
  const serviceList = v.serviceEntries || [];

  // Voll-zu-Voll-Methode wie in der Tankliste: Teilbetankungen fließen in die
  // jeweils nächste Volltankung mit ein, statt ignoriert zu werden
  // Nur die letzten 10 Tankungen (Voll-zu-Voll), damit der Verlauf übersichtlich bleibt
  const CONSUMPTION_CHART_MAX_POINTS = 10;
  const segments = getFullToFullSegments(fuelList)
    .filter(seg => seg.entry.date)
    .sort((a, b) => a.entry.date.localeCompare(b.entry.date) || a.entry.mileage - b.entry.mileage)
    .slice(-CONSUMPTION_CHART_MAX_POINTS);
  const labels = segments.map(seg => formatChartDate(seg.entry.date));
  const dataPoints = segments.map(seg => (seg.liters / seg.dist * 100).toFixed(2));
  const consSub = document.getElementById('consumptionChartSub');
  if (consSub) {
    consSub.textContent = segments.length ? `Letzte ${segments.length} ${segments.length === 1 ? 'Tankung' : 'Tankungen'}` : '';
    consSub.style.display = segments.length ? '' : 'none';
  }

  const consCanvas = document.getElementById('consumptionChart');
  if (consCanvas && hasEngineForCharts) {
    const ctx1 = consCanvas.getContext('2d');
    if (consumptionChartInstance) consumptionChartInstance.destroy();

    // Farben direkt aus dem aktuellen Theme/Akzent lesen (CSS-Variablen), statt
    // fest verdrahteter Werte - passt sich so automatisch an hell/dunkel und
    // die gewählte Akzentfarbe an, statt wie bisher immer knallig blau zu sein.
    const textColor = getCssVar('--text-muted', '#8b98a5');
    const gridColor = getCssVar('--border-color', '#212c38');
    const cardBg = getCssVar('--bg-card', '#131820');
    const accentHex = getCssVar('--accent-primary', '#f39c12');

    // Sanfter Verlauf unter der Linie (wie ein dezentes "Instrumenten-Glühen"),
    // statt einer flachen Einheitsfarbe
    const chartHeight = consCanvas.parentElement ? consCanvas.parentElement.clientHeight || 260 : 260;
    const fillGradient = ctx1.createLinearGradient(0, 0, 0, chartHeight);
    fillGradient.addColorStop(0, hexToRgba(accentHex, 0.35));
    fillGradient.addColorStop(1, hexToRgba(accentHex, 0.02));

    consumptionChartInstance = new Chart(ctx1, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: v.type === 'km' ? 'Verbrauch (L/100km)' : 'Verbrauch (L/Std)',
          data: dataPoints,
          borderColor: accentHex,
          backgroundColor: fillGradient,
          borderWidth: 2,
          pointRadius: 3.5,
          pointHoverRadius: 6,
          pointBackgroundColor: accentHex,
          pointBorderColor: cardBg,
          pointBorderWidth: 1.5,
          fill: true,
          tension: 0.3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { ticks: { color: textColor, maxRotation: 0, autoSkip: true, maxTicksLimit: 6 }, grid: { display: false } },
          // Etwas Luft über/unter den Werten, damit kleine Schwankungen nicht dramatisch wirken
          y: { grace: '40%', ticks: { color: textColor, maxTicksLimit: 5 }, grid: { color: gridColor }, border: { display: false } }
        },
        plugins: {
          // Nur eine Linie - der Kartentitel benennt sie, keine Legende nötig
          legend: { display: false },
          tooltip: {
            backgroundColor: cardBg,
            titleColor: getCssVar('--text-main', '#e6edf3'),
            bodyColor: getCssVar('--text-main', '#e6edf3'),
            borderColor: gridColor,
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8,
            displayColors: false,
            callbacks: {
              label: ctx => ` ${Number(ctx.parsed.y).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${v.type === 'km' ? 'L/100km' : 'L/Std'}`
            }
          }
        }
      }
    });
  } else if (consumptionChartInstance) {
    consumptionChartInstance.destroy();
    consumptionChartInstance = null;
  }
}

let showAllHistoryEntries = false;

function renderHistoryTable() {
  const v = getActiveVehicle();
  const tbody = document.getElementById('fullHistoryTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const toggleContainer = document.getElementById('historyToggleBtnContainer');
  const toggleBtn = document.getElementById('historyToggleBtn');

  if (!v) {
    if (toggleContainer) toggleContainer.style.display = 'none';
    return;
  }

  const searchVal = (document.getElementById('historySearch')?.value || '').toLowerCase().trim();

  const fuelList = v.fuelEntries || [];
  const serviceList = v.serviceEntries || [];

  // 1. Alle Einträge zusammenführen
  let combined = [
    ...fuelList.map(f => ({
      id: f.id,
      sourceType: 'fuel',
      type: '⛽ Tanken',
      date: f.date,
      mileage: f.mileage || 0,
      desc: `${f.fuelType} (${f.liters}L @ ${(f.pricePerLiter || 0).toFixed(3)}€) ${f.notes || ''}`,
      amount: f.totalPrice || 0
    })),
    ...serviceList.map(s => ({
      id: s.id,
      sourceType: 'service',
      type: s.isStandEntry
        ? '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px; margin-right:3px;"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg> Standmeldung'
        : `🔧 ${s.category}`,
      date: s.date,
      mileage: s.mileage || 0,
      desc: `${s.title} - ${s.notes || ''}`,
      amount: s.cost || 0
    }))
  ];

  // 2. Suche anwenden
  if (searchVal) {
    combined = combined.filter(item => 
      item.desc.toLowerCase().includes(searchVal) || 
      item.type.toLowerCase().includes(searchVal)
    );
  }

  if (combined.length === 0) {
    if (toggleContainer) toggleContainer.style.display = 'none';
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;">Keine Einträge gefunden.</td></tr>`;
    return;
  }

  // 3. Nach Datum sortieren (neueste zuerst)
  combined.sort(compareByDateThenMileageDesc);

  // 4. Auf max. 5 Einträge begrenzen (sofern nicht ausgeklappt und keine Suche aktiv ist)
  const hasMoreThan5 = combined.length > 5;
  const entriesToRender = (hasMoreThan5 && !showAllHistoryEntries && !searchVal) 
    ? combined.slice(0, 5) 
    : combined;

  // 5. Tabelle befüllen
  entriesToRender.forEach(item => {
    const tr = document.createElement('tr');
    const editFn = item.sourceType === 'fuel' ? 'editFuelEntry' : 'editServiceEntry';
    const deleteFn = item.sourceType === 'fuel' ? 'deleteFuelEntry' : 'deleteServiceEntry';
    tr.innerHTML = `
      <td data-label="Typ">${item.type}</td>
      <td data-label="Datum">${item.date || '-'}</td>
      <td data-label="Stand">${item.mileage.toLocaleString()}</td>
      <td data-label="Beschreibung">${item.desc}</td>
      <td data-label="Betrag"><strong>${item.amount.toFixed(2)} €</strong></td>
      <td style="text-align: right; white-space: nowrap;">
        <button class="btn btn-secondary btn-sm" onclick="${editFn}('${item.id}')">${ICON_EDIT_SVG}</button>
        <button class="btn btn-danger btn-sm" onclick="${deleteFn}('${item.id}')">${ICON_DELETE_SVG}</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // 6. Button "Mehr anzeigen / Weniger anzeigen" steuern
  if (hasMoreThan5 && !searchVal && toggleContainer && toggleBtn) {
    toggleContainer.style.display = 'block';
    const remainingCount = combined.length - 5;
    toggleBtn.innerText = showAllHistoryEntries 
      ? 'Weniger anzeigen' 
      : `Mehr anzeigen (${remainingCount} weitere Einträge)`;
  } else if (toggleContainer) {
    toggleContainer.style.display = 'none';
  }
}

// Umschalt-Funktion & Global-Bindung
function toggleHistoryEntries() {
  showAllHistoryEntries = !showAllHistoryEntries;
  renderHistoryTable();
}

window.toggleHistoryEntries = toggleHistoryEntries;
