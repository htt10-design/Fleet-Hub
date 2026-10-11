/* --- KOSTEN IM DETAIL (Popup hinter der Kachel "Gesamtkosten") ---
   Nutzt nur vorhandene Daten des aktiven Fahrzeugs: Tankungen + Service-Einträge.
   Zeitraum umschaltbar; daraus: Summe, Ø pro Monat, Kosten pro 100 km,
   Aufschlüsselung nach Kategorie (aufklappbar, Kraftstoff -> Sorten) und Verlauf
   als gestapeltes Balkendiagramm. Außerdem die Mini-Vorschau in der Kachel. */

let costDetailPeriod = 'all';
let costDetailChartInstance = null;
let costDetailOpenCategory = null;

// Beschriftung der Zeiträume; "year"/"lastYear" zeigen die Jahreszahl (kurz & eindeutig)
function getCostDetailPeriodLabel(period, today) {
  const year = parseInt(today.slice(0, 4), 10);
  if (period === 'year') return String(year);
  if (period === 'lastYear') return String(year - 1);
  if (period === '12m') return '12 Monate';
  return 'Gesamt';
}

// Reihenfolge und Bezeichnungen der Kostenkategorien (Farben: COST_CATEGORY_COLORS)
// (Wartung, Reparatur und TÜV sind bewusst zu "Werkstatt" zusammengefasst)
const COST_DETAIL_CATEGORIES = [
  { key: 'Kraftstoff', label: 'Kraftstoff', short: 'Sprit' },
  { key: 'Werkstatt', label: 'Wartung, Reparatur & TÜV', short: 'Werkstatt' },
  { key: 'Sonstiges', label: 'Sonstiges / Pflege', short: 'Sonstiges' }
];

const COST_DETAIL_CHEVRON_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

function getCostCategoryColor(key) {
  const c = COST_CATEGORY_COLORS[key] || COST_CATEGORY_COLORS.Sonstiges;
  return appData.theme === 'dark' ? c.dark : c.light;
}

// Service-Kategorie auf eine der festen Kostenkategorien abbilden
function getServiceCostCategory(s) {
  return ['Wartung', 'Reparatur', 'TÜV'].includes(s.category) ? 'Werkstatt' : 'Sonstiges';
}

// Zeitraum als { start, end } ('YYYY-MM-DD', inklusive; null = offen)
function getCostDetailRange(period, today) {
  const year = parseInt(today.slice(0, 4), 10);
  if (period === 'year') return { start: `${year}-01-01`, end: `${year}-12-31` };
  if (period === 'lastYear') return { start: `${year - 1}-01-01`, end: `${year - 1}-12-31` };
  if (period === '12m') {
    const t = parseLocalDateStr(today);
    return { start: getLocalDateStr(new Date(t.getFullYear(), t.getMonth() - 11, 1)), end: today };
  }
  return { start: null, end: null };
}

function isDateInRange(dateStr, range) {
  if (!dateStr) return range.start === null;
  if (range.start && dateStr < range.start) return false;
  if (range.end && dateStr > range.end) return false;
  return true;
}

// Gefahrene Strecke im Zeitraum: höchster Stand im Zeitraum minus letzter
// Stand davor (bzw. niedrigster Stand im Zeitraum, falls es davor keinen gibt).
// Motorbezogene Einträge (Boote mit mehreren Motoren) bleiben außen vor.
function getDistanceInRange(v, range) {
  const readings = [...(v.fuelEntries || []), ...(v.serviceEntries || [])]
    .filter(e => e.date && e.mileage > 0 && !e.engineId)
    .map(e => ({ date: e.date, mileage: e.mileage }));
  const inRange = readings.filter(r => isDateInRange(r.date, range));
  if (inRange.length === 0) return 0;
  const before = range.start ? readings.filter(r => r.date < range.start) : [];
  const end = Math.max(...inRange.map(r => r.mileage));
  const start = before.length > 0
    ? Math.max(...before.map(r => r.mileage))
    : Math.min(...inRange.map(r => r.mileage));
  return Math.max(0, end - start);
}

function computeCostDetails(v, period, today) {
  const range = getCostDetailRange(period, today);
  const fuel = (v.fuelEntries || []).filter(f => isDateInRange(f.date, range));
  const services = (v.serviceEntries || []).filter(s => (s.cost || 0) > 0 && isDateInRange(s.date, range));

  const totals = {};
  COST_DETAIL_CATEGORIES.forEach(c => { totals[c.key] = 0; });
  fuel.forEach(f => { totals.Kraftstoff += f.totalPrice || 0; });
  services.forEach(s => { totals[getServiceCostCategory(s)] += s.cost || 0; });
  const total = Object.values(totals).reduce((a, b) => a + b, 0);

  // Kraftstoffsorten
  const fuelTypeMap = {};
  fuel.forEach(f => {
    const name = (f.fuelType || '').trim() || 'Unbekannt';
    if (!fuelTypeMap[name]) fuelTypeMap[name] = { name, liters: 0, cost: 0, count: 0 };
    fuelTypeMap[name].liters += f.liters || 0;
    fuelTypeMap[name].cost += f.totalPrice || 0;
    fuelTypeMap[name].count++;
  });
  const fuelTypes = Object.values(fuelTypeMap).sort((a, b) => b.liters - a.liters);
  const totalLiters = fuelTypes.reduce((sum, t) => sum + t.liters, 0);

  // Anzahl Monate für den Monatsschnitt
  const datedEntries = [...fuel, ...services].filter(e => e.date).map(e => e.date).sort();
  const currentMonth = today.slice(0, 7);
  let months;
  if (period === 'year') months = parseInt(today.slice(5, 7), 10);
  else if (period === 'lastYear' || period === '12m') months = 12;
  else months = datedEntries.length ? countMonthsInclusive(datedEntries[0].slice(0, 7), currentMonth) : 0;

  const distance = v.type === 'km' ? getDistanceInRange(v, range) : 0;

  // Tank-Deal-Ersparnis im Zeitraum (nur wenn die Funktion aktiv ist)
  let dealSaved = null;
  if (isFuelDealEnabled()) {
    const stats = computeFuelDealStats(appData.fuelDeal, today);
    dealSaved = fuel.reduce((sum, f) => sum + ((stats.perEntry[f.id] && stats.perEntry[f.id].saved) || 0), 0);
  }

  return { range, fuel, services, totals, total, fuelTypes, totalLiters, months, distance, dealSaved, datedEntries };
}

function formatCostEuro(value) {
  return value.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function formatCostDate(dateStr) {
  if (!dateStr) return '-';
  const [y, m, d] = dateStr.split('-');
  return `${d}.${m}.${y}`;
}

function openCostDetailModal() {
  const v = getActiveVehicle();
  if (!v) return;
  costDetailOpenCategory = null;
  renderCostDetailModal();
  document.getElementById('costDetailModal').classList.add('active');
}
window.openCostDetailModal = openCostDetailModal;

function closeCostDetailModal() {
  document.getElementById('costDetailModal').classList.remove('active');
  if (costDetailChartInstance) {
    costDetailChartInstance.destroy();
    costDetailChartInstance = null;
  }
}
window.closeCostDetailModal = closeCostDetailModal;

function setCostDetailPeriod(period) {
  costDetailPeriod = period;
  costDetailOpenCategory = null;
  renderCostDetailModal();
}
window.setCostDetailPeriod = setCostDetailPeriod;

function toggleCostDetailCategory(key) {
  costDetailOpenCategory = costDetailOpenCategory === key ? null : key;
  renderCostDetailModal();
}
window.toggleCostDetailCategory = toggleCostDetailCategory;

function renderCostDetailModal() {
  const v = getActiveVehicle();
  const body = document.getElementById('costDetailBody');
  if (!v || !body) return;

  const today = getLocalDateStr();
  document.querySelectorAll('#costDetailPeriodSwitch .theme-switch-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.period === costDetailPeriod);
    btn.textContent = getCostDetailPeriodLabel(btn.dataset.period, today);
  });

  const d = computeCostDetails(v, costDetailPeriod, today);
  const periodLabel = getCostDetailPeriodLabel(costDetailPeriod, today);

  if (d.total === 0 && d.fuel.length === 0) {
    body.innerHTML = `<p class="sub-text cost-detail-empty">Im Zeitraum „${periodLabel}“ sind keine Kosten erfasst.</p>`;
    if (costDetailChartInstance) { costDetailChartInstance.destroy(); costDetailChartInstance = null; }
    return;
  }

  // 1. Kopfzahlen
  const stats = [];
  if (d.months > 0) stats.push(`<div><span>Ø pro Monat</span><strong>${formatCostEuro(d.total / d.months)}</strong></div>`);
  if (d.distance > 0) {
    stats.push(`<div><span>Pro 100 km</span><strong>${formatCostEuro(d.total / d.distance * 100)}</strong>${d.totals.Kraftstoff > 0 ? `<small>davon Sprit ${formatCostEuro(d.totals.Kraftstoff / d.distance * 100)}</small>` : ''}</div>`);
    stats.push(`<div><span>Gefahren</span><strong>${formatNumberForDisplay(d.distance)} km</strong></div>`);
  }

  // Kraftstoffsorten (nur sichtbar, wenn "Kraftstoff" aufgeklappt ist)
  const fuelTypesHtml = d.fuelTypes.length === 0 ? '' : `
    <div class="cost-detail-fuel-types">
      ${d.fuelTypes.map(t => {
        const pct = d.totalLiters > 0 ? t.liters / d.totalLiters * 100 : 0;
        const avgPrice = t.liters > 0 ? t.cost / t.liters : 0;
        return `
          <div class="cost-detail-fuel">
            <div class="cost-detail-fuel-top">
              <span>${escapeHtml(t.name)} <small>${t.count}× getankt</small></span>
              <strong>${formatDealLiters(t.liters)} · ${pct.toFixed(0)} %</strong>
            </div>
            <div class="cost-detail-bar"><span style="width: ${pct.toFixed(1)}%; background: ${getCostCategoryColor('Kraftstoff')}"></span></div>
            <div class="cost-detail-fuel-sub">${formatCostEuro(t.cost)} · Ø ${avgPrice.toFixed(3).replace('.', ',')} €/L</div>
          </div>`;
      }).join('')}
      ${d.dealSaved !== null && d.dealSaved > 0 ? `<p class="cost-detail-note">Mit ${escapeHtml(getFuelDealName())} gespart: <strong>${formatCostEuro(d.dealSaved)}</strong> (Rabatt, ohne Gebühren)</p>` : ''}
    </div>`;

  // 2. Kategorien (nur Kraftstoff ist aufklappbar -> Sorten)
  const categoryRows = COST_DETAIL_CATEGORIES
    .filter(c => d.totals[c.key] > 0)
    .map(c => {
      const amount = d.totals[c.key];
      const pct = d.total > 0 ? amount / d.total * 100 : 0;
      const expandable = c.key === 'Kraftstoff' && fuelTypesHtml !== '';
      const isOpen = expandable && costDetailOpenCategory === c.key;
      const detailHtml = isOpen ? fuelTypesHtml : '';
      return `
        <div class="cost-detail-cat${isOpen ? ' is-open' : ''}">
          <button type="button" class="cost-detail-cat-head" ${expandable ? `onclick="toggleCostDetailCategory('${c.key}')"` : 'disabled'}>
            <span class="cost-detail-dot" style="background: ${getCostCategoryColor(c.key)}"></span>
            <span class="cost-detail-cat-name">${c.label}${expandable ? ` <small>(${d.fuel.length})</small>` : ''}</span>
            <span class="cost-detail-cat-pct">${pct.toFixed(0)} %</span>
            <strong>${formatCostEuro(amount)}</strong>
            <span class="cost-detail-chevron"${expandable ? ` aria-label="${isOpen ? 'Zuklappen' : 'Aufklappen'}"` : ''}>${expandable ? COST_DETAIL_CHEVRON_SVG : ''}</span>
          </button>
          <div class="cost-detail-bar"><span style="width: ${pct.toFixed(1)}%; background: ${getCostCategoryColor(c.key)}"></span></div>
          ${detailHtml}
        </div>`;
    }).join('');

  body.innerHTML = `
    <div class="cost-detail-hero">
      <span class="cost-detail-hero-label">${periodLabel}</span>
      <div class="cost-detail-hero-value">${formatCostEuro(d.total)}</div>
      ${stats.length ? `<div class="cost-detail-stats">${stats.join('')}</div>` : ''}
    </div>

    <section class="cost-detail-section">
      <h4>Nach Kategorie</h4>
      ${categoryRows}
    </section>

    <section class="cost-detail-section" id="costDetailChartSection">
      <h4 id="costDetailChartTitle">Verlauf</h4>
      <div class="chart-container cost-detail-chart"><canvas id="costDetailChart"></canvas></div>
    </section>

  `;

  renderCostDetailChart(d, today);
}

// Gestapelte Balken pro Monat (bzw. pro Jahr, wenn der Zeitraum > 24 Monate umfasst)
function renderCostDetailChart(d, today) {
  if (costDetailChartInstance) { costDetailChartInstance.destroy(); costDetailChartInstance = null; }
  const canvas = document.getElementById('costDetailChart');
  if (!canvas || typeof Chart === 'undefined') return;

  const firstMonth = d.range.start ? d.range.start.slice(0, 7) : (d.datedEntries[0] || today).slice(0, 7);
  const lastMonth = d.range.end && d.range.end < today ? d.range.end.slice(0, 7) : today.slice(0, 7);
  const byYear = countMonthsInclusive(firstMonth, lastMonth) > 24;

  const buckets = [];
  if (byYear) {
    for (let y = parseInt(firstMonth.slice(0, 4), 10); y <= parseInt(lastMonth.slice(0, 4), 10); y++) buckets.push(String(y));
  } else {
    let [y, m] = firstMonth.split('-').map(Number);
    while (`${y}-${String(m).padStart(2, '0')}` <= lastMonth) {
      buckets.push(`${y}-${String(m).padStart(2, '0')}`);
      m++; if (m > 12) { m = 1; y++; }
    }
  }
  const bucketOf = dateStr => byYear ? dateStr.slice(0, 4) : dateStr.slice(0, 7);

  const series = {};
  COST_DETAIL_CATEGORIES.forEach(c => { series[c.key] = buckets.map(() => 0); });
  d.fuel.forEach(f => {
    const i = f.date ? buckets.indexOf(bucketOf(f.date)) : -1;
    if (i !== -1) series.Kraftstoff[i] += f.totalPrice || 0;
  });
  d.services.forEach(s => {
    const i = s.date ? buckets.indexOf(bucketOf(s.date)) : -1;
    if (i !== -1) series[getServiceCostCategory(s)][i] += s.cost || 0;
  });

  const labels = buckets.map(b => byYear
    ? b
    : parseLocalDateStr(`${b}-01`).toLocaleDateString('de-DE', { month: 'short', year: '2-digit' }));
  document.getElementById('costDetailChartTitle').textContent = byYear ? 'Verlauf pro Jahr' : 'Verlauf pro Monat';

  const cardBg = getCssVar('--bg-card', '#131820');
  const textColor = getCssVar('--text-muted', '#8b98a5');
  const gridColor = getCssVar('--border-color', '#212c38');
  const datasets = COST_DETAIL_CATEGORIES
    .filter(c => d.totals[c.key] > 0)
    .map(c => ({
      label: c.label,
      data: series[c.key],
      backgroundColor: getCostCategoryColor(c.key),
      borderRadius: 4,
      borderSkipped: 'bottom',
      maxBarThickness: 28
    }));

  costDetailChartInstance = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { color: textColor, maxRotation: 0, autoSkip: true } },
        y: { stacked: true, grid: { color: gridColor }, border: { display: false },
             ticks: { color: textColor, callback: value => `${value} €` } }
      },
      plugins: {
        legend: { position: 'bottom', labels: { color: textColor, usePointStyle: true, pointStyle: 'circle', padding: 12 } },
        tooltip: {
          backgroundColor: cardBg,
          titleColor: getCssVar('--text-main', '#e6edf3'),
          bodyColor: getCssVar('--text-main', '#e6edf3'),
          borderColor: gridColor,
          borderWidth: 1,
          padding: 10,
          cornerRadius: 8,
          filter: item => item.parsed.y > 0,
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${formatCostEuro(ctx.parsed.y || 0)}`,
            footer: items => `Summe: ${formatCostEuro(items.reduce((sum, i) => sum + (i.parsed.y || 0), 0))}`
          }
        }
      }
    }
  });
}

/* --- Mini-Vorschau in der Kachel "Gesamtkosten": Anteile als Balken + Legende --- */
function renderCostTilePreview(v) {
  const el = document.getElementById('kpi-cost-preview');
  if (!el) return;
  const d = computeCostDetails(v, 'all', getLocalDateStr());
  const parts = COST_DETAIL_CATEGORIES.filter(c => d.totals[c.key] > 0);
  if (d.total <= 0 || parts.length === 0) {
    el.innerHTML = '';
    el.style.display = 'none';
    return;
  }
  const pctOf = key => d.totals[key] / d.total * 100;
  el.innerHTML = `
    <div class="kpi-cost-bar">
      ${parts.map(c => `<span style="flex-grow: ${pctOf(c.key).toFixed(2)}; background: ${getCostCategoryColor(c.key)}" title="${c.label}"></span>`).join('')}
    </div>
    <div class="kpi-cost-legend">
      ${parts.map(c => `<span><i style="background: ${getCostCategoryColor(c.key)}"></i>${c.short} ${Math.round(pctOf(c.key))} %</span>`).join('')}
    </div>`;
  el.style.display = '';
}
