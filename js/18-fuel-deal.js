/* --- TANK-DEAL (z.B. Shell Smart Deal): Literkontingent & Ersparnis ---
   Optionale Funktion, standardmäßig aus. Einstellungen liegen in
   appData.fuelDeal = { enabled, name, monthlyLiters, yearlyLiters, discountCt, monthlyFee, startDate }.
   Tankungen, die mit dem Deal getankt wurden, tragen f.dealUsed = true.
   Gezählt wird über ALLE Fahrzeuge (auch archivierte), weil das Kontingent an
   der Tankkarte/dem Konto hängt und nicht an einem einzelnen Fahrzeug.
   Rabatt pro Tankung (optional): f.dealDiscountCt (ct/L, null = unbekannt).
   Ersparnis einer Tankung:
   - mit eingetragenem Rabatt: Rabatt × Liter (so wie auf dem Beleg)
   - ohne: geschätzt mit dem literbezogenen Durchschnitt aller eingetragenen
     Rabatte (Fallback: Standard-Rabatt aus den Einstellungen), und nur für
     Liter innerhalb der Monats-/Jahresgrenze
   Davon gehen die Monatsgebühren ab. Der in der Tankung eingetragene Preis
   ist der tatsächlich bezahlte (bereits rabattierte) Preis. */

function isFuelDealEnabled() {
  return !!(appData.fuelDeal && appData.fuelDeal.enabled);
}

function getFuelDealName() {
  return (appData.fuelDeal && appData.fuelDeal.name) || 'Tank-Deal';
}

// Heutiges Datum als 'YYYY-MM-DD' in lokaler Zeit
function getLocalDateStr(date = new Date()) {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

// Beginn des Vertragsjahres, in dem dateStr liegt: letzter Jahrestag des
// Vertragsbeginns (ohne Vertragsbeginn: Kalenderjahr ab 1. Januar)
function getFuelDealYearStart(deal, dateStr) {
  const year = parseInt(dateStr.slice(0, 4), 10);
  if (!deal.startDate) return `${year}-01-01`;
  const monthDay = deal.startDate.slice(5);
  return `${year}-${monthDay}` <= dateStr ? `${year}-${monthDay}` : `${year - 1}-${monthDay}`;
}

// 'YYYY-MM-DD' als lokales Datum (new Date('YYYY-MM-DD') wäre UTC)
function parseLocalDateStr(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Anzahl Monate von 'YYYY-MM' bis 'YYYY-MM' (beide inklusive), mindestens 0
function countMonthsInclusive(fromMonth, toMonth) {
  const diff = (parseInt(toMonth.slice(0, 4), 10) - parseInt(fromMonth.slice(0, 4), 10)) * 12
    + (parseInt(toMonth.slice(5, 7), 10) - parseInt(fromMonth.slice(5, 7), 10)) + 1;
  return Math.max(0, diff);
}

function getAllFuelDealEntries() {
  const entries = [];
  (appData.vehicles || []).forEach(v => {
    (v.fuelEntries || []).forEach(f => { if (f.dealUsed && f.date) entries.push(f); });
  });
  return entries.sort((a, b) => a.date.localeCompare(b.date) || (a.mileage || 0) - (b.mileage || 0));
}

function hasEnteredDealDiscount(f) {
  return typeof f.dealDiscountCt === 'number' && !isNaN(f.dealDiscountCt);
}

function computeFuelDealStats(deal, today) {
  const monthCap = deal.monthlyLiters > 0 ? deal.monthlyLiters : null;
  const yearCap = deal.yearlyLiters > 0 ? deal.yearlyLiters : (monthCap ? monthCap * 12 : null);
  const fee = deal.monthlyFee || 0;
  const currentMonth = today.slice(0, 7);
  const currentYearStart = getFuelDealYearStart(deal, today);

  const litersByMonth = {};
  const litersByYear = {};
  let grossMonth = 0, grossYear = 0, grossTotal = 0;
  let estimatedTotal = 0;
  const entries = getAllFuelDealEntries();
  const perEntry = {};

  // Durchschnittsrabatt (ct/L) aus allen Tankungen mit eingetragenem Rabatt
  const known = entries.filter(hasEnteredDealDiscount);
  const knownLiters = known.reduce((sum, f) => sum + (f.liters || 0), 0);
  const avgCt = knownLiters > 0
    ? known.reduce((sum, f) => sum + f.dealDiscountCt * (f.liters || 0), 0) / knownLiters
    : (deal.discountCt > 0 ? deal.discountCt : null);
  let unknownCount = 0;

  entries.forEach(f => {
    const liters = f.liters || 0;
    const month = f.date.slice(0, 7);
    const yearStart = getFuelDealYearStart(deal, f.date);
    const usedMonth = litersByMonth[month] || 0;
    const usedYear = litersByYear[yearStart] || 0;

    let saved = 0;
    if (hasEnteredDealDiscount(f)) {
      saved = liters * f.dealDiscountCt / 100;
      perEntry[f.id] = { saved, estimated: false };
    } else if (avgCt !== null) {
      // Schätzung: nur Liter innerhalb der Kontingente bekommen den Rabatt
      let eligible = liters;
      if (monthCap) eligible = Math.min(eligible, Math.max(0, monthCap - usedMonth));
      if (yearCap) eligible = Math.min(eligible, Math.max(0, yearCap - usedYear));
      saved = eligible * avgCt / 100;
      estimatedTotal += saved;
      perEntry[f.id] = { saved, estimated: true };
    } else {
      unknownCount++;
    }

    litersByMonth[month] = usedMonth + liters;
    litersByYear[yearStart] = usedYear + liters;
    grossTotal += saved;
    if (month === currentMonth) grossMonth += saved;
    if (yearStart === currentYearStart) grossYear += saved;
  });

  // Gebühren ab Vertragsbeginn (sonst ab der ersten Deal-Tankung) bis einschließlich diesen Monat
  const feeStartMonth = deal.startDate
    ? deal.startDate.slice(0, 7)
    : (entries.length ? entries[0].date.slice(0, 7) : currentMonth);
  const yearFeeStartMonth = feeStartMonth > currentYearStart.slice(0, 7) ? feeStartMonth : currentYearStart.slice(0, 7);
  const feesMonth = feeStartMonth <= currentMonth ? fee : 0;
  const feesYear = fee * countMonthsInclusive(yearFeeStartMonth, currentMonth);
  const feesTotal = fee * countMonthsInclusive(feeStartMonth, currentMonth);

  const nextYearStart = `${parseInt(currentYearStart.slice(0, 4), 10) + 1}${currentYearStart.slice(4)}`;
  const now = parseLocalDateStr(today);
  const nextMonthStart = getLocalDateStr(new Date(now.getFullYear(), now.getMonth() + 1, 1));

  return {
    monthCap, yearCap, yearCapDerived: !(deal.yearlyLiters > 0) && !!monthCap,
    monthLiters: litersByMonth[currentMonth] || 0,
    yearLiters: litersByYear[currentYearStart] || 0,
    nextMonthStart, nextYearStart,
    hasFee: fee > 0,
    avgCt, avgFromEntries: knownLiters > 0, knownCount: known.length,
    estimatedCount: entries.length - known.length - unknownCount, unknownCount,
    estimatedTotal, perEntry,
    gross: { month: grossMonth, year: grossYear, total: grossTotal },
    fees: { month: feesMonth, year: feesYear, total: feesTotal },
    net: { month: grossMonth - feesMonth, year: grossYear - feesYear, total: grossTotal - feesTotal }
  };
}

function formatDealLiters(value) {
  return value.toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' L';
}

function formatDealEuro(value) {
  return value.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function formatDealDate(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${d}.${m}.${y}`;
}

function buildFuelDealMeterHtml(label, used, cap, renewDate, capNote) {
  const remaining = cap - used;
  const pct = Math.min(100, (used / cap) * 100);
  const over = remaining < 0;
  const headline = over
    ? `${formatDealLiters(-remaining)} drüber`
    : `noch ${formatDealLiters(remaining)}`;
  return `
    <div class="fuel-deal-meter${over ? ' is-over' : ''}">
      <div class="fuel-deal-meter-top">
        <span>${label}</span>
        <strong>${headline}</strong>
      </div>
      <div class="fuel-deal-bar"><span style="width: ${pct.toFixed(1)}%"></span></div>
      <div class="fuel-deal-meter-sub">${formatDealLiters(used)} von ${formatDealLiters(cap)}${capNote} · neu ab ${formatDealDate(renewDate)}</div>
    </div>`;
}

function renderFuelDealCard() {
  const card = document.getElementById('fuelDealCard');
  if (!card) return;
  if (!isFuelDealEnabled()) {
    card.style.display = 'none';
    card.innerHTML = '';
    return;
  }

  const deal = appData.fuelDeal;
  const today = getLocalDateStr();
  const s = computeFuelDealStats(deal, today);
  const monthName = parseLocalDateStr(today).toLocaleDateString('de-DE', { month: 'long' });

  let metersHtml = '';
  if (s.monthCap) metersHtml += buildFuelDealMeterHtml(`Monat (${monthName})`, s.monthLiters, s.monthCap, s.nextMonthStart, '');
  if (s.yearCap) metersHtml += buildFuelDealMeterHtml(deal.startDate ? 'Vertragsjahr' : 'Jahr', s.yearLiters, s.yearCap, s.nextYearStart, s.yearCapDerived ? ' (12 × Monat)' : '');
  if (!metersHtml) {
    metersHtml = `<p class="sub-text">Getankt diesen Monat: <strong>${formatDealLiters(s.monthLiters)}</strong> · dieses Jahr: <strong>${formatDealLiters(s.yearLiters)}</strong>. Trage in den Einstellungen ein Literkontingent ein, um den Rest zu sehen.</p>`;
  }

  const savingCell = (label, period) => `
    <div class="fuel-deal-saving${s.net[period] < 0 ? ' is-negative' : ''}">
      <span>${label}</span>
      <strong>${formatDealEuro(s.net[period])}</strong>
      ${s.hasFee ? `<small>${formatDealEuro(s.gross[period])} Rabatt − ${formatDealEuro(s.fees[period])} Gebühr</small>` : ''}
    </div>`;

  card.innerHTML = `
    <div class="fuel-deal-head">
      <h3>${escapeHtml(getFuelDealName())}</h3>
      <span class="sub-text">alle Fahrzeuge</span>
    </div>
    ${metersHtml}
    ${s.avgCt !== null ? `
      <div class="fuel-deal-savings-title">Gespart${s.hasFee ? ' (nach Gebühr)' : ''}</div>
      <div class="fuel-deal-savings">
        ${savingCell('Monat', 'month')}
        ${savingCell(deal.startDate ? 'Vertragsjahr' : 'Jahr', 'year')}
        ${savingCell('Gesamt', 'total')}
      </div>
      <p class="fuel-deal-avg-note">${buildFuelDealAvgNote(s)}</p>` : `<p class="sub-text fuel-deal-hint">Trag bei einer Tankung den Rabatt vom Beleg ein, um deine Ersparnis zu sehen.</p>`}
  `;
  card.style.display = '';
}

function formatDealCt(ct) {
  return ct.toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' ct/L';
}

function buildFuelDealAvgNote(s) {
  const source = s.avgFromEntries
    ? `Ø ${formatDealCt(s.avgCt)} aus ${s.knownCount} ${s.knownCount === 1 ? 'Tankung' : 'Tankungen'} mit Rabatt`
    : `Standard-Rabatt ${formatDealCt(s.avgCt)} (noch keine Tankung mit Rabatt)`;
  if (!s.estimatedCount) return source;
  return `${source} · ${s.estimatedCount} ohne Angabe geschätzt (~${formatDealEuro(s.estimatedTotal)})`;
}

// Ersparnis einer Tankung für die Tabelle, z.B. "12,38 €" bzw. "~11,90 €" (geschätzt)
function getFuelDealEntryLabel(stats, entryId) {
  const info = stats && stats.perEntry[entryId];
  if (!info) return '';
  return `${info.estimated ? '~' : ''}${formatDealEuro(info.saved)}`;
}

/* --- Rabatt einer Tankung: ct/L ↔ € (gekoppelt über die Liter) --- */
function calcFuelDealDiscount(changedField) {
  const liters = parseFloat(document.getElementById('fuelLiters').value) || 0;
  const ctInput = document.getElementById('fuelDealCt');
  const euroInput = document.getElementById('fuelDealEuro');
  if (changedField === 'ct') {
    const ct = parseFloat(ctInput.value);
    euroInput.value = !isNaN(ct) && liters > 0 ? (ct * liters / 100).toFixed(2) : '';
  } else if (changedField === 'euro') {
    const euro = parseFloat(euroInput.value);
    ctInput.value = !isNaN(euro) && liters > 0 ? (euro / liters * 100).toFixed(1) : '';
  }
}
window.calcFuelDealDiscount = calcFuelDealDiscount;

// Gelesener Rabatt aus dem Formular in ct/L (null = leer gelassen)
function readFuelDealDiscountCt() {
  const liters = parseFloat(document.getElementById('fuelLiters').value) || 0;
  const ct = parseFloat(document.getElementById('fuelDealCt').value);
  const euro = parseFloat(document.getElementById('fuelDealEuro').value);
  if (!isNaN(euro) && liters > 0) return Math.round(euro / liters * 100 * 1000) / 1000;
  if (!isNaN(ct)) return ct;
  return null;
}

function toggleFuelDealDiscountGroup() {
  const group = document.getElementById('fuelDealDiscountGroup');
  const checkbox = document.getElementById('fuelDealUsed');
  if (!group || !checkbox) return;
  group.style.display = isFuelDealEnabled() && checkbox.checked ? '' : 'none';
}
window.toggleFuelDealDiscountGroup = toggleFuelDealDiscountGroup;

/* --- Häkchen "Mit Deal getankt" im Tank-Formular --- */
function syncFuelDealCheckbox() {
  const group = document.getElementById('fuelDealGroup');
  const checkbox = document.getElementById('fuelDealUsed');
  if (!group || !checkbox) return;

  const enabled = isFuelDealEnabled();
  group.style.display = enabled ? '' : 'none';
  if (!enabled) {
    toggleFuelDealDiscountGroup();
    return;
  }

  document.getElementById('fuelDealLabelText').textContent = `Mit ${getFuelDealName()} getankt`;

  const v = getActiveVehicle();
  const editId = document.getElementById('fuelEditId').value;
  const entries = (v && v.fuelEntries) || [];
  const ctInput = document.getElementById('fuelDealCt');
  const euroInput = document.getElementById('fuelDealEuro');
  ctInput.value = '';
  euroInput.value = '';
  if (editId) {
    const entry = entries.find(f => f.id === editId);
    checkbox.checked = !!(entry && entry.dealUsed);
    if (entry && hasEnteredDealDiscount(entry)) {
      ctInput.value = Math.round(entry.dealDiscountCt * 10) / 10;
      calcFuelDealDiscount('ct');
    }
  } else {
    // Neue Tankung: "an" - außer die letzte Tankung dieses Fahrzeugs wurde
    // bewusst ohne Deal gespeichert (dealUsed === false)
    const latest = [...entries].sort(compareByDateThenMileageDesc)[0];
    checkbox.checked = !(latest && latest.dealUsed === false);
  }

  const stats = computeFuelDealStats(appData.fuelDeal, getLocalDateStr());
  document.getElementById('fuelDealDiscountHint').textContent = stats.avgCt !== null
    ? `Leer lassen = Ø ${formatDealCt(stats.avgCt)} wird angenommen.`
    : 'Steht auf dem Beleg meist als „Rabatt“ oder „Ersparnis“.';
  toggleFuelDealDiscountGroup();
}

/* --- Einstellungen --- */
function applyFuelDealSettingsUI() {
  const deal = appData.fuelDeal || {};
  const enabled = isFuelDealEnabled();
  const onBtn = document.getElementById('fuelDealToggleOn');
  const offBtn = document.getElementById('fuelDealToggleOff');
  if (onBtn) onBtn.classList.toggle('active', enabled);
  if (offBtn) offBtn.classList.toggle('active', !enabled);

  const form = document.getElementById('fuelDealForm');
  if (!form) return;
  form.style.display = enabled ? '' : 'none';
  document.getElementById('fuelDealName').value = deal.name || '';
  document.getElementById('fuelDealMonthly').value = deal.monthlyLiters || '';
  document.getElementById('fuelDealYearly').value = deal.yearlyLiters || '';
  document.getElementById('fuelDealDiscount').value = deal.discountCt || '';
  document.getElementById('fuelDealFee').value = deal.monthlyFee || '';
  document.getElementById('fuelDealStart').value = deal.startDate || '';
}

function setFuelDealEnabled(enabled) {
  if (!appData.fuelDeal) appData.fuelDeal = { name: 'Shell Smart Deal' };
  appData.fuelDeal.enabled = enabled;
  saveData();
  applyFuelDealSettingsUI();
  renderFuelTable();
}
window.setFuelDealEnabled = setFuelDealEnabled;

function saveFuelDealSettings(e) {
  e.preventDefault();
  const num = id => {
    const value = parseFloat(String(document.getElementById(id).value).replace(',', '.'));
    return value > 0 ? value : 0;
  };
  appData.fuelDeal = {
    ...(appData.fuelDeal || {}),
    enabled: true,
    name: document.getElementById('fuelDealName').value.trim() || 'Tank-Deal',
    monthlyLiters: num('fuelDealMonthly'),
    yearlyLiters: num('fuelDealYearly'),
    discountCt: num('fuelDealDiscount'),
    monthlyFee: num('fuelDealFee'),
    startDate: document.getElementById('fuelDealStart').value || ''
  };
  saveData();
  renderFuelTable();
  alert('Tank-Deal gespeichert!');
}
window.saveFuelDealSettings = saveFuelDealSettings;
