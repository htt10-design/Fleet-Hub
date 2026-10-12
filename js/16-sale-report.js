function printSaleReport() {
  const v = getActiveVehicle();
  const printContainer = document.getElementById('printableInvoice');

  if (!v) {
    alert("Kein aktives Fahrzeug ausgewählt.");
    return;
  }
  if (!printContainer) {
    alert("Fehler: Druck-Container ('printableInvoice') wurde im HTML nicht gefunden.");
    return;
  }

  const category = v.category || 'auto';
  const fuelList = v.fuelEntries || [];
  const serviceList = v.serviceEntries || [];
  const sortedServices = [...serviceList].sort(compareByDateThenMileageDesc);

  // Dezente, professionelle Farbcodierung je Kategorie (helle Pastelltöne)
  function getCategoryStyle(cat) {
    switch (cat) {
      case 'Wartung': return { bg: '#eaf7ef', color: '#1e7e42' };
      case 'Reparatur': return { bg: '#fdf3e3', color: '#92400e' };
      case 'TÜV': return { bg: '#e8f0fe', color: '#1d4ed8' };
      default: return { bg: '#f1f1f1', color: '#52525b' };
    }
  }

  // Historie-Zeilen inkl. Kosten & dezentem Kategorie-Badge
  let historyRowsHTML = "";
  let totalMaintenanceCost = 0;

  if (sortedServices.length > 0) {
    historyRowsHTML = sortedServices.map(s => {
      const dateStr = s.date ? new Date(s.date).toLocaleDateString('de-DE') : '-';
      const mileageStr = s.mileage ? `${s.mileage.toLocaleString('de-DE')} km` : '-';
      const performerStr = s.performer ? `<small>(${s.performer})</small>` : '';
      const notesStr = s.notes ? `<div style="font-size: 0.85rem; color: #555; margin-top: 4px;">${s.notes.replace(/\n/g, '<br>')}</div>` : '';
      const costVal = typeof s.cost === 'number' ? s.cost : 0;
      totalMaintenanceCost += costVal;
      const costStr = costVal > 0 ? `${costVal.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €` : '-';
      const catStyle = getCategoryStyle(s.category);

      return `
        <tr style="border-bottom: 1px solid #ddd;">
          <td style="padding: 8px; vertical-align: top;">${dateStr}</td>
          <td style="padding: 8px; vertical-align: top;">${mileageStr}</td>
          <td style="padding: 8px; vertical-align: top;">
            <strong>${s.title || 'Wartung / Reparatur'}</strong> ${performerStr}
            ${notesStr}
          </td>
          <td style="padding: 8px; vertical-align: top;">
            <span style="display:inline-block; padding:2px 8px; border-radius:10px; font-size:0.78rem; font-weight:600; background:${catStyle.bg}; color:${catStyle.color};">${s.category || 'Wartung'}</span>
          </td>
          <td style="padding: 8px; vertical-align: top; text-align: right;">${costStr}</td>
        </tr>
      `;
    }).join('');
  } else {
    historyRowsHTML = `<tr><td colspan="5" style="padding: 12px; text-align: center; color: #777;">Keine dokumentierten Wartungseinträge vorhanden.</td></tr>`;
  }

  // Kennzahlen: KM-Stand, Verbrauch, Investitionssumme, Dokumentationszeitraum
  const currentMileage = getVehicleCurrentMileage(v);
  const mileageUnit = v.type === 'hours' ? 'Std' : 'km';
  const currentMileageStr = `${currentMileage.toLocaleString('de-DE')} ${mileageUnit}`;

  // Voll-zu-Voll-Methode (inkl. Teilbetankungen, Neustart bei "firstFill")
  const avgConsumption = getAverageConsumption(fuelList);
  const consumptionUnit = v.type === 'hours' ? 'L/Std' : 'L/100km';
  const hasEngine = vehicleHasEngine(v);
  const boatEngines = getBoatEngines(v);

  let documentedSinceStr = '-';
  if (sortedServices.length > 0) {
    const oldestYear = new Date(sortedServices[sortedServices.length - 1].date).getFullYear();
    documentedSinceStr = `seit ${oldestYear}`;
  }

  const firstRegStr = v.firstReg ? new Date(v.firstReg).toLocaleDateString('de-DE') : '-';
  const hsnTsnStr = (v.hsn || v.tsn) ? `${v.hsn || '-'} / ${v.tsn || '-'}` : '-';
  const imageHtml = v.image
    ? `<img src="${v.image}" style="width: 100%; height: 260px; object-fit: cover; border-radius: 8px; margin-bottom: 20px; cursor: zoom-in;" onclick="openImageZoomView(this.src)">`
    : '';

  // Fahrzeugdaten-Zeilen: je nach Fahrzeugart werden nicht passende Angaben weggelassen
  const dataRows = [
    `<div><strong>Erstzulassung:</strong> ${firstRegStr}</div>`
  ];
  if (category !== 'anhaenger') {
    dataRows.push(`<div><strong>Aktueller Stand:</strong> ${currentMileageStr}</div>`);
  }
  if (category === 'boot') {
    dataRows.push(`<div><strong>Rumpfnummer (HIN):</strong> ${v.hullNumber || '-'}</div>`);
    if (boatEngines.length > 0) {
      const engineListStr = boatEngines.map(e => e.name + (e.number ? ' (Nr. ' + e.number + ')' : '')).join(', ');
      dataRows.push(`<div><strong>Motor(en):</strong> ${engineListStr}</div>`);
    }
  } else {
    dataRows.push(`<div><strong>FIN / VIN:</strong> ${v.vin || '-'}</div>`);
  }
  if (category !== 'boot') {
    dataRows.push(`<div><strong>HSN / TSN:</strong> ${hsnTsnStr}</div>`);
  }
  if (hasEngine) {
    dataRows.push(`<div><strong>Kraftstoffart:</strong> ${v.fuelType || '-'}</div>`);
  }
  if (category !== 'boot') {
    dataRows.push(`<div><strong>Nächster TÜV / HU:</strong> ${v.nextTuev || '-'}</div>`);
  }
  if (category === 'auto') {
    dataRows.push(`<div><strong>Leistung:</strong> ${v.powerHp ? v.powerHp + ' PS' : '-'}</div>`);
  }
  if (category === 'anhaenger') {
    dataRows.push(`<div><strong>Zulässiges Gesamtgewicht:</strong> ${v.towingBraked ? v.towingBraked + ' kg' : '-'}</div>`);
  } else if (category === 'auto') {
    dataRows.push(`<div><strong>Anhängelast (gebremst):</strong> ${v.towingBraked ? v.towingBraked + ' kg' : '-'}</div>`);
  }

  // Kennzahlen-Kacheln: Verbrauch nur bei Fahrzeugen mit eigenem Antrieb
  const kpiCells = [];
  if (category !== 'anhaenger') {
    kpiCells.push(`<div style="background: #f9f9f9; border: 1px solid #e0e0e0; border-radius: 6px; padding: 10px; text-align: center;">
      <div style="font-size: 0.7rem; color: #777; text-transform: uppercase; margin-bottom: 4px;">Aktueller Stand</div>
      <div style="font-size: 1.05rem; font-weight: 700;">${currentMileageStr}</div>
    </div>`);
  }
  if (hasEngine) {
    kpiCells.push(`<div style="background: #f9f9f9; border: 1px solid #e0e0e0; border-radius: 6px; padding: 10px; text-align: center;">
      <div style="font-size: 0.7rem; color: #777; text-transform: uppercase; margin-bottom: 4px;">Ø Verbrauch</div>
      <div style="font-size: 1.05rem; font-weight: 700;">${avgConsumption > 0 ? avgConsumption.toFixed(2) + ' ' + consumptionUnit : '-'}</div>
    </div>`);
  }
  kpiCells.push(`<div style="background: #f9f9f9; border: 1px solid #e0e0e0; border-radius: 6px; padding: 10px; text-align: center;">
    <div style="font-size: 0.7rem; color: #777; text-transform: uppercase; margin-bottom: 4px;">Investiert in Pflege</div>
    <div style="font-size: 1.05rem; font-weight: 700;">${totalMaintenanceCost.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</div>
  </div>`);
  kpiCells.push(`<div style="background: #f9f9f9; border: 1px solid #e0e0e0; border-radius: 6px; padding: 10px; text-align: center;">
    <div style="font-size: 0.7rem; color: #777; text-transform: uppercase; margin-bottom: 4px;">Dokumentiert</div>
    <div style="font-size: 1.05rem; font-weight: 700;">${sortedServices.length} Einträge<br><span style="font-size:0.8rem; font-weight:400; color:#666;">${documentedSinceStr}</span></div>
  </div>`);

  // Druck-Layout zusammenbauen
  printContainer.innerHTML = `
    <div style="padding: 20px; font-family: Arial, sans-serif; color: #222; max-width: 800px; margin: 0 auto;">

      <!-- Kopfzeile -->
      <div style="border-bottom: 2px solid #222; padding-bottom: 15px; margin-bottom: 20px;">
        <h1 style="margin: 0; font-size: 1.8rem; text-transform: uppercase;">Fahrzeug-Verkaufsdossier</h1>
        <p style="margin: 5px 0 0 0; color: #666; font-size: 0.9rem;">Lückenlose Wartungs- & Historienübersicht</p>
        <h2 style="margin: 10px 0 0 0; font-size: 1.4rem; color: #0056b3;">${v.name || 'Fahrzeug'}</h2>
      </div>

      <!-- Fahrzeugfoto -->
      ${imageHtml}

      <!-- Eyecatcher-Kennzahlen -->
      <div style="display: grid; grid-template-columns: repeat(${kpiCells.length}, 1fr); gap: 10px; margin-bottom: 25px;">
        ${kpiCells.join('')}
      </div>

      <!-- Stammdaten Raster -->
      <div style="background: #f9f9f9; border: 1px solid #e0e0e0; border-radius: 6px; padding: 15px; margin-bottom: 25px;">
        <h3 style="margin-top: 0; margin-bottom: 12px; font-size: 1.1rem; border-bottom: 1px solid #ddd; padding-bottom: 5px;">Fahrzeugdaten</h3>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; font-size: 0.95rem;">
          ${dataRows.join('')}
        </div>
      </div>

      <!-- Spezifikationen (falls vorhanden) -->
      ${v.specs ? `
      <div style="margin-bottom: 25px;">
        <h3 style="margin-top: 0; margin-bottom: 8px; font-size: 1.1rem; border-bottom: 1px solid #ddd; padding-bottom: 5px;">Spezifikationen & Ausstattung</h3>
        <p style="white-space: pre-wrap; margin: 0; font-size: 0.9rem; line-height: 1.4; color: #333;">${v.specs}</p>
      </div>
      ` : ''}

      <!-- Wartungshistorie Tabelle -->
      <div style="margin-bottom: 30px;">
        <h3 style="margin-top: 0; margin-bottom: 12px; font-size: 1.1rem; border-bottom: 1px solid #ddd; padding-bottom: 5px;">Dokumentierte Wartungen & Instandhaltungen</h3>
        <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.9rem;">
          <thead>
            <tr style="background: #f0f0f0; border-bottom: 2px solid #ccc;">
              <th style="padding: 8px;">Datum</th>
              <th style="padding: 8px;">KM-Stand</th>
              <th style="padding: 8px;">Arbeiten / Notizen</th>
              <th style="padding: 8px;">Kategorie</th>
              <th style="padding: 8px; text-align: right;">Kosten</th>
            </tr>
          </thead>
          <tbody>
            ${historyRowsHTML}
          </tbody>
          ${sortedServices.length > 0 ? `
          <tfoot>
            <tr style="border-top: 2px solid #ccc;">
              <td colspan="4" style="padding: 8px; text-align: right; font-weight: 700;">Gesamt investiert:</td>
              <td style="padding: 8px; text-align: right; font-weight: 700;">${totalMaintenanceCost.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</td>
            </tr>
          </tfoot>
          ` : ''}
        </table>
      </div>

      <!-- Fußzeile / Hinweis -->
      <div style="margin-top: 40px; border-top: 1px solid #ccc; padding-top: 15px; font-size: 0.8rem; color: #666; text-align: center;">
        Dieser Bericht wurde automatisch aus der Service-Datenbank erstellt. Alle Angaben basieren auf den erfassten Wartungseinträgen.
      </div>

    </div>
  `;

  // Druckdialog öffnen
  window.print();
}

window.printSaleReport = printSaleReport;
