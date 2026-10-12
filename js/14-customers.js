/* --- KUNDEN SEKTION (KUNDENFAHRZEUGE & WERKSTATT) --- */
function renderCustomerSection() {
  renderCustomerVehicleSelect();
  const custV = getActiveCustomerVehicle();
  const contentDiv = document.getElementById('customerVehicleContent');

  if (!custV) {
    if (contentDiv) contentDiv.style.display = 'none';
    return;
  }

  if (contentDiv) contentDiv.style.display = 'block';
  document.getElementById('custBannerName').innerText = `${custV.owner} - ${custV.model}`;
  document.getElementById('custBannerPlate').innerText = custV.plate || 'OHNE-ID';
  document.getElementById('custBannerOwner').innerText = custV.owner;
  document.getElementById('custBannerContact').innerText = custV.contact || '-';
  document.getElementById('custBannerVin').innerText = custV.vin || '-';
  
  const hsnTsnEl = document.getElementById('custBannerHsnTsn');
  if (hsnTsnEl) {
    hsnTsnEl.innerText = `${custV.hsn || '-'}` + (custV.tsn ? ` / ${custV.tsn}` : '');
  }
  
  document.getElementById('custBannerFirstReg').innerText = custV.firstReg || '-';

  renderCustomerServiceTable();
}

function renderCustomerVehicleSelect() {
  const toggleLabel = document.getElementById('customerSelectToggleLabel');
  if (!toggleLabel) return;

  const active = getActiveCustomerVehicle();
  toggleLabel.innerText = active
    ? `${active.owner} (${active.model} - ${active.plate || 'Kein KZ'})`
    : '-- Kundenfahrzeug wählen --';

  renderCustomerVehicleList();
}

function toggleCustomerSelectPanel() {
  const group = document.querySelector('.customer-select-group');
  const panel = document.getElementById('customerSelectPanel');
  if (!group || !panel) return;

  const isOpen = !panel.classList.contains('hidden');
  if (isOpen) {
    panel.classList.add('hidden');
    group.classList.remove('open');
  } else {
    panel.classList.remove('hidden');
    group.classList.add('open');
    document.getElementById('customerSearchInput').value = '';
    renderCustomerVehicleList();
    document.getElementById('customerSearchInput').focus();
  }
}
window.toggleCustomerSelectPanel = toggleCustomerSelectPanel;

function renderCustomerVehicleList() {
  const list = document.getElementById('customerSelectList');
  if (!list) return;

  const searchInput = document.getElementById('customerSearchInput');
  const query = (searchInput ? searchInput.value : '').trim().toLowerCase();

  const filtered = appData.customerVehicles.filter(c => {
    if (!query) return true;
    const haystack = `${c.owner} ${c.model} ${c.plate || ''}`.toLowerCase();
    return haystack.includes(query);
  });

  if (filtered.length === 0) {
    list.innerHTML = '<div class="customer-select-empty">Keine Kundenfahrzeuge gefunden.</div>';
    return;
  }

  list.innerHTML = '';
  filtered.forEach(c => {
    const item = document.createElement('div');
    item.className = 'customer-select-list-item' + (c.id === appData.activeCustomerVehicleId ? ' active' : '');
    item.innerHTML = `
      <div class="cs-owner">${c.owner}</div>
      <div class="cs-meta">${c.model} - ${c.plate || 'Kein Kennzeichen'}</div>
    `;
    item.onclick = () => selectCustomerVehicleFromList(c.id);
    list.appendChild(item);
  });
}
window.renderCustomerVehicleList = renderCustomerVehicleList;

function selectCustomerVehicleFromList(id) {
  appData.activeCustomerVehicleId = id;
  saveData();
  renderCustomerSection();
  toggleCustomerSelectPanel();
}
window.selectCustomerVehicleFromList = selectCustomerVehicleFromList;

function openCustomerVehicleModal(isEdit = false) {
  const modal = document.getElementById('customerVehicleModal');
  const title = document.getElementById('custModalTitle');

  if (isEdit) {
    const c = getActiveCustomerVehicle();
    if (!c) return;
    if (title) title.innerText = "Kundenfahrzeug bearbeiten";
    document.getElementById('custModalEditId').value = c.id;
    document.getElementById('custModalOwner').value = c.owner;
    document.getElementById('custModalContact').value = c.contact || '';
    document.getElementById('custModalModel').value = c.model;
    document.getElementById('custModalPlate').value = c.plate || '';
    document.getElementById('custModalVin').value = c.vin || '';
    document.getElementById('custModalFirstReg').value = c.firstReg || '';
    
    const hsnInput = document.getElementById('custModalHsn');
    const tsnInput = document.getElementById('custModalTsn');
    if (hsnInput) hsnInput.value = c.hsn || '';
    if (tsnInput) tsnInput.value = c.tsn || '';
  } else {
    if (title) title.innerText = "Kundenfahrzeug anlegen";
    document.getElementById('custModalEditId').value = '';
    const form = document.querySelector('#customerVehicleModal form');
    if (form) form.reset();
  }

  if (modal) modal.classList.add('active');
}

function closeCustomerVehicleModal() {
  const modal = document.getElementById('customerVehicleModal');
  if (modal) modal.classList.remove('active');
}

function saveCustomerVehicleModal(e) {
  e.preventDefault();
  const editId = document.getElementById('custModalEditId').value;

  const hsnInput = document.getElementById('custModalHsn');
  const tsnInput = document.getElementById('custModalTsn');

  const data = {
    id: editId ? editId : "c_" + Date.now(),
    owner: document.getElementById('custModalOwner').value,
    contact: document.getElementById('custModalContact').value,
    model: document.getElementById('custModalModel').value,
    plate: document.getElementById('custModalPlate').value,
    vin: document.getElementById('custModalVin').value,
    firstReg: document.getElementById('custModalFirstReg').value,
    hsn: hsnInput ? hsnInput.value : '',
    tsn: tsnInput ? tsnInput.value : '',
    services: editId ? (getActiveCustomerVehicle()?.services || []) : []
  };

  if (editId) {
    const idx = appData.customerVehicles.findIndex(c => c.id === editId);
    if (idx !== -1) appData.customerVehicles[idx] = data;
  } else {
    appData.customerVehicles.push(data);
    appData.activeCustomerVehicleId = data.id;
  }

  saveData();
  closeCustomerVehicleModal();
  renderCustomerSection();
}

function deleteCurrentCustomerVehicle() {
  const c = getActiveCustomerVehicle();
  if (!c) return;
  if (!confirm(`Möchtest du das Kundenfahrzeug von ${c.owner} wirklich löschen?`)) return;

  appData.customerVehicles = appData.customerVehicles.filter(item => item.id !== c.id);
  appData.activeCustomerVehicleId = appData.customerVehicles.length > 0 ? appData.customerVehicles[0].id : null;

  saveData();
  renderCustomerSection();
}

/* Positionen-Kalkulator */
function addInvoiceItemRow(description = '', price = '') {
  const container = document.getElementById('invoiceItemsContainer');
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'invoice-item-row';
  row.innerHTML = `
    <input type="text" placeholder="Beschreibung / Teilenummer" value="${description}" oninput="calcCustomerTotalCost()">
    <input type="number" step="0.01" placeholder="Preis (€)" value="${price}" oninput="calcCustomerTotalCost()">
    <button type="button" class="btn btn-danger btn-sm" onclick="this.parentElement.remove(); calcCustomerTotalCost();">✕</button>
  `;
  container.appendChild(row);
}

function calcCustomerTotalCost() {
  const rows = document.querySelectorAll('#invoiceItemsContainer .invoice-item-row');
  let total = 0;
  rows.forEach(r => {
    const inputs = r.querySelectorAll('input');
    const price = parseFloat(inputs[1].value) || 0;
    total += price;
  });
  if (total > 0) {
    document.getElementById('custServiceTotalCost').value = total.toFixed(2);
  }
}

function handleCustomerServiceImageUpload(event) {
  const files = Array.from(event.target.files);
  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = async function(e) {
      const compressed = await compressImage(e.target.result);
      tempCustomerServiceImages.push(compressed);
      renderCustomerServiceImagePreviews();
    };
    reader.readAsDataURL(file);
  });
}
function renderCustomerServiceImagePreviews() {
  const container = document.getElementById('custServiceImagePreviewContainer');
  if (!container) return;
  container.innerHTML = '';
  tempCustomerServiceImages.forEach((imgSrc, index) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'preview-thumb-wrapper';
    wrapper.innerHTML = `
      <img src="${imgSrc}" class="preview-thumb">
      <button type="button" class="btn-remove-thumb" onclick="removeTempCustomerServiceImage(${index})">✕</button>
    `;
    container.appendChild(wrapper);
  });
}

function removeTempCustomerServiceImage(index) {
  tempCustomerServiceImages.splice(index, 1);
  renderCustomerServiceImagePreviews();
}

function saveCustomerServiceEntry(e) {
  e.preventDefault();
  const c = getActiveCustomerVehicle();
  if (!c) return;

  const editId = document.getElementById('custServiceEditId').value;

  const items = [];
  document.querySelectorAll('#invoiceItemsContainer .invoice-item-row').forEach(row => {
    const inputs = row.querySelectorAll('input');
    const desc = inputs[0].value;
    const val = parseFloat(inputs[1].value) || 0;
    if (desc || val > 0) {
      items.push({ desc: desc, price: val });
    }
  });

  const entry = {
    id: editId ? editId : "cs_" + Date.now(),
    title: document.getElementById('custServiceTitle').value,
    date: document.getElementById('custServiceDate').value,
    mileage: parseFloat(document.getElementById('custServiceMileage').value) || 0,
    totalCost: parseFloat(document.getElementById('custServiceTotalCost').value) || 0,
    items: items,
    notes: document.getElementById('custServiceNotes').value,
    images: [...tempCustomerServiceImages]
  };

  if (!c.services) c.services = [];

  if (editId) {
    const idx = c.services.findIndex(cs => cs.id === editId);
    if (idx !== -1) c.services[idx] = entry;
  } else {
    c.services.push(entry);
  }

  c.services.sort(compareByDateThenMileageDesc);

  saveData();
  resetCustomerServiceForm();
  renderCustomerServiceTable();
}

function resetCustomerServiceForm() {
  document.getElementById('custServiceEditId').value = '';
  document.getElementById('custServiceForm').reset();
  document.getElementById('custServiceDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('invoiceItemsContainer').innerHTML = '';
  tempCustomerServiceImages = [];
  renderCustomerServiceImagePreviews();
  document.getElementById('custServiceSubmitBtn').innerText = "Auftrag Speichern";
  document.getElementById('custServiceCancelBtn').style.display = "none";
}

// Status: Kunden-Service-Tabelle ausgeklappt?
let showAllCustomerServiceEntries = false;

function renderCustomerServiceTable() {
  const c = getActiveCustomerVehicle();
  const tbody = document.getElementById('custServiceTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const toggleContainer = document.getElementById('custServiceToggleBtnContainer');
  const toggleBtn = document.getElementById('custServiceToggleBtn');

  if (!c || !c.services || c.services.length === 0) {
    if (toggleContainer) toggleContainer.style.display = 'none';
    return;
  }

  // 1. Nach Datum sortieren (neueste Einträge zuerst)
  const sortedServices = [...c.services].sort(compareByDateThenMileageDesc);

  // 2. Auf max. 5 Einträge begrenzen (falls nicht ausgeklappt)
  const hasMoreThan5 = sortedServices.length > 5;
  const entriesToRender = (hasMoreThan5 && !showAllCustomerServiceEntries) 
    ? sortedServices.slice(0, 5) 
    : sortedServices;

  // 3. Tabelle befüllen
  entriesToRender.forEach(cs => {
    const tr = document.createElement('tr');
    tr.className = 'clickable-row';
    tr.onclick = (e) => {
      if (e.target.tagName !== 'BUTTON') openCustomerServiceDetailModal(cs.id);
    };

    const mileageVal = typeof cs.mileage === 'number' ? cs.mileage.toLocaleString() + ' km' : '-';
    const totalCostVal = typeof cs.totalCost === 'number' ? cs.totalCost.toFixed(2) + ' €' : '-';

    tr.innerHTML = `
      <td data-label="Datum">${cs.date || '-'}</td>
      <td data-label="Titel"><strong>${cs.title || 'Auftrag'}</strong></td>
      <td data-label="KM-Stand">${mileageVal}</td>
      <td data-label="Gesamt">${totalCostVal}</td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="editCustomerServiceEntry('${cs.id}')">${ICON_EDIT_SVG}</button>
        <button class="btn btn-primary btn-sm" onclick="printInvoice('${cs.id}')">🖨️ Drucken</button>
        <button class="btn btn-danger btn-sm" onclick="deleteCustomerServiceEntry('${cs.id}')">${ICON_DELETE_SVG}</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // 4. Button "Mehr anzeigen / Weniger anzeigen" steuern
  if (hasMoreThan5 && toggleContainer && toggleBtn) {
    toggleContainer.style.display = 'block';
    const remainingCount = sortedServices.length - 5;
    toggleBtn.innerText = showAllCustomerServiceEntries 
      ? 'Weniger anzeigen' 
      : `Mehr anzeigen (${remainingCount} weitere Einträge)`;
  } else if (toggleContainer) {
    toggleContainer.style.display = 'none';
  }
}

// Umschalt-Funktion & Global-Bindung für HTML
function toggleCustomerServiceEntries() {
  showAllCustomerServiceEntries = !showAllCustomerServiceEntries;
  renderCustomerServiceTable();
}

window.toggleCustomerServiceEntries = toggleCustomerServiceEntries;

function editCustomerServiceEntry(id) {
  const c = getActiveCustomerVehicle();
  if (!c || !c.services) return;

  const cs = c.services.find(item => item.id === id);
  if (!cs) return;

  document.getElementById('custServiceEditId').value = cs.id;
  document.getElementById('custServiceTitle').value = cs.title;
  document.getElementById('custServiceDate').value = cs.date;
  document.getElementById('custServiceMileage').value = cs.mileage;
  document.getElementById('custServiceTotalCost').value = cs.totalCost;
  document.getElementById('custServiceNotes').value = cs.notes || '';

  const container = document.getElementById('invoiceItemsContainer');
  if (container) {
    container.innerHTML = '';
    if (cs.items && cs.items.length > 0) {
      cs.items.forEach(it => addInvoiceItemRow(it.desc, it.price));
    }
  }

  tempCustomerServiceImages = cs.images ? [...cs.images] : [];
  renderCustomerServiceImagePreviews();

  document.getElementById('custServiceSubmitBtn').innerText = "Änderungen Speichern";
  document.getElementById('custServiceCancelBtn').style.display = "inline-block";
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function deleteCustomerServiceEntry(id) {
  if (!confirm("Diesen Auftrags-Eintrag wirklich löschen?")) return;
  const c = getActiveCustomerVehicle();
  if (!c || !c.services) return;

  c.services = c.services.filter(item => item.id !== id);
  saveData();
  renderCustomerServiceTable();
}

function openCustomerServiceDetailModal(id) {
  const c = getActiveCustomerVehicle();
  if (!c || !c.services) return;

  const cs = c.services.find(item => item.id === id);
  if (!cs) return;

  document.getElementById('csdTitle').innerText = cs.title;
  document.getElementById('csdDate').innerText = cs.date;
  document.getElementById('csdMileage').innerText = `${cs.mileage.toLocaleString()} km`;
  document.getElementById('csdTotalCost').innerText = `${cs.totalCost.toFixed(2)} €`;
  document.getElementById('csdNotes').innerText = cs.notes || 'Keine Notizen vorhanden.';

  const container = document.getElementById('csdImagesContainer');
  if (container) {
    container.innerHTML = '';
    if (cs.images && cs.images.length > 0) {
      cs.images.forEach(img => {
        const wrapper = document.createElement('div');
        wrapper.className = 'gallery-img-wrapper';
        wrapper.innerHTML = `<img src="${img}" onclick="window.open('${img}')">`;
        container.appendChild(wrapper);
      });
    } else {
      container.innerHTML = '<span class="text-muted">Keine Bilder vorhanden.</span>';
    }
  }

  document.getElementById('csdEditBtn').onclick = () => {
    closeCustomerServiceDetailModal();
    editCustomerServiceEntry(cs.id);
  };

  document.getElementById('customerServiceDetailModal').classList.add('active');
}

function closeCustomerServiceDetailModal() {
  const modal = document.getElementById('customerServiceDetailModal');
  if (modal) modal.classList.remove('active');
}

// Öffnet den Druckdialog erst, wenn alle Bilder im Druckbereich geladen sind
// (z.B. das Werkstatt-Logo aus icons/) - sonst fehlen sie u.U. im Ausdruck.
function printWhenImagesLoaded(container) {
  const pending = Array.from(container.querySelectorAll('img'))
    .filter(img => !img.complete)
    .map(img => new Promise(resolve => { img.onload = img.onerror = resolve; }));
  Promise.all(pending).then(() => window.print());
}

/* Druck / PDF Generierung (Startet direkt von oben, Rebranding SGS, OHNE Belegnummer) */

function printInvoice(serviceId) {
  const c = getActiveCustomerVehicle();
  if (!c || !c.services) return;
  const cs = c.services.find(item => item.id === serviceId);
  if (!cs) return;
  printCustomerInvoice(c, [cs]);
}

// Positionen eines Auftrags als Tabellenzeilen (ohne Positionen: Pauschale)
function buildInvoiceItemRows(cs, indent) {
  const pad = indent ? ' style="padding-left: 12px;"' : '';
  if (cs.items && cs.items.length > 0) {
    return cs.items.map(it => `
        <tr>
          <td${pad}>${it.desc}</td>
          <td style="text-align: right;">${it.price ? parseFloat(it.price).toFixed(2) + ' €' : '-'}</td>
        </tr>
      `).join('');
  }
  return `<tr><td${pad}>Pauschale Durchführung / Arbeitswert</td><td style="text-align: right;">${(cs.totalCost || 0).toFixed(2)} €</td></tr>`;
}

// Druckt eine Rechnung für einen Auftrag oder - als Sammelrechnung - für
// mehrere Aufträge desselben Kundenfahrzeugs (gegliedert nach Auftrag)
function printCustomerInvoice(c, services) {
  const printContainer = document.getElementById('printableInvoice');
  if (!printContainer || !services || services.length === 0) return;

  const isCombined = services.length > 1;
  const jobs = [...services].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const cs = jobs[jobs.length - 1];
  const invoiceDate = isCombined ? getLocalDateStr() : cs.date;
  const invoiceMileage = Math.max(...jobs.map(j => j.mileage || 0));
  const invoiceTotal = jobs.reduce((sum, j) => sum + (j.totalCost || 0), 0);
  const invoiceTitle = isCombined ? `Sammelrechnung – ${jobs.length} Aufträge` : cs.title;

  let itemsHtml = '';
  if (isCombined) {
    jobs.forEach(j => {
      itemsHtml += `
        <tr style="background-color: #f3f4f6; border-top: 1px solid #d1d5db;">
          <td><strong>${escapeHtml(j.title || 'Auftrag')}</strong> <span style="color: #4b5563;">· ${j.date || '-'}${j.mileage ? ' · ' + j.mileage.toLocaleString('de-DE') + ' km' : ''}</span></td>
          <td style="text-align: right;"><strong>${(j.totalCost || 0).toFixed(2)} €</strong></td>
        </tr>
        ${buildInvoiceItemRows(j, true)}
      `;
    });
  } else {
    itemsHtml = buildInvoiceItemRows(cs, false);
  }

  const allImages = jobs.flatMap(j => j.images || []);
  let imagesHtml = '';
  if (allImages.length > 0) {
    imagesHtml = `
      <div class="invoice-images">
        <h4>Fotodokumentation:</h4>
        <div class="invoice-image-grid">
          ${allImages.map(img => `<img src="${img}">`).join('')}
        </div>
      </div>
    `;
  }

  const notesText = isCombined
    ? jobs.filter(j => j.notes).map(j => `${j.title || 'Auftrag'}: ${j.notes}`).join('\n')
    : cs.notes;

  const biz = appData.businessInfo || getDefaultBusinessInfo();

      printContainer.innerHTML = `
    <!-- DRUCK-STYLES (MOBIL-OPTIMIERT, STRIKT 1 SEITE, FUSSZEILE UNTEN FIXIERT) -->
    <style>
      @media print {
        @page {
          size: A4 portrait;
          margin: 6mm 8mm; /* Sehr schmaler oberer/unterer Rand */
        }
        html, body {
          height: auto !important;
          margin: 0 !important;
          padding: 0 !important;
          background: #fff !important;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        /* Der äußere Druck-Container bekommt sonst 15mm Padding aus style.css
           (.print-only) - das würde unsere Höhenrechnung sprengen, daher hier
           für diesen Druck auf 0 gesetzt. */
        #printableInvoice.print-only {
          padding: 0 !important;
        }
        .invoice-box {
          position: relative !important;
          /* Druckbare A4-Höhe (297mm - 2x6mm Seitenrand, mit Puffer). min-height statt
             height: lange Sammelrechnungen dürfen auf eine 2. Seite wachsen, statt
             in die Fußzeile zu laufen - kurze Rechnungen bleiben exakt 1 Seite. */
          min-height: 283mm !important;
          height: auto !important;
          max-height: none !important;
          display: block !important; /* Kein Flexbox im Druck, um Mobile-Bugs zu vermeiden */
          padding: 0 0 62px 0 !important; /* Platz für die fixierte Fußzeile freihalten */
          margin: 0 !important;
          box-sizing: border-box !important;
          page-break-inside: avoid !important;
          break-inside: avoid !important;
        }
        .invoice-footer {
          position: absolute !important;
          left: 0 !important;
          right: 0 !important;
          bottom: 0 !important;
          margin-top: 0 !important;
          page-break-inside: avoid !important;
          break-inside: avoid !important;
        }
      }
    </style>

    <div class="invoice-box" style="
      max-width: 800px;
      margin: 0 auto;
      padding: 4px 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #111827;
      background: #ffffff;
      line-height: 1.2;
      box-sizing: border-box;
    ">
      <!-- INHALT -->
      <div class="invoice-content">
        <!-- HEADER -->
        <div class="invoice-header" style="
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          border-bottom: 2px solid #111827;
          padding-bottom: 4px;
          margin-bottom: 8px;
        ">
          <div style="display: flex; align-items: center; gap: 8px;">
            <img src="icons/logo-dark.png" style="width: 32px; height: 32px; flex-shrink: 0;">
            <div>
              <div class="invoice-title" style="
                font-size: 17px;
                font-weight: 700;
                color: #111827;
                letter-spacing: -0.3px;
                text-transform: uppercase;
              ">${biz.name}</div>
              <div class="invoice-subtitle" style="
                font-size: 9.5px;
                color: #4b5563;
                margin-top: 1px;
              ">${biz.subtitle}</div>
            </div>
          </div>
          <div style="text-align: right; font-size: 10.5px; color: #111827;">
            <strong>Datum:</strong> ${invoiceDate}
          </div>
        </div>

        <!-- KUNDEN & FAHRZEUG DETAILS -->
        <div class="invoice-details-grid" style="
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px;
          background-color: #f9fafb;
          border: 1px solid #d1d5db;
          border-radius: 4px;
          padding: 5px 8px;
          margin-bottom: 8px;
          font-size: 9.5px;
        ">
          <div>
            <div style="
              font-size: 7.5px;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              color: #4b5563;
              font-weight: 700;
              margin-bottom: 1px;
            ">Kunde / Halter</div>
            <strong style="font-size: 10.5px; color: #111827;">${c.owner}</strong><br>
            <span style="color: #374151;">${c.contact || ''}</span>
          </div>
          <div>
            <div style="
              font-size: 7.5px;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              color: #4b5563;
              font-weight: 700;
              margin-bottom: 1px;
            ">Fahrzeug-Daten</div>
            <table style="width: 100%; font-size: 9px; border-collapse: collapse;">
              <tr>
                <td style="color: #4b5563; padding: 0;">Modell:</td>
                <td style="text-align: right; font-weight: 600; color: #111827;">${c.model}</td>
              </tr>
              <tr>
                <td style="color: #4b5563; padding: 0;">Kennzeichen:</td>
                <td style="text-align: right; font-weight: 600; color: #111827;">${c.plate || '-'}</td>
              </tr>
              <tr>
                <td style="color: #4b5563; padding: 0;">FIN:</td>
                <td style="text-align: right; font-weight: 500; font-family: monospace; color: #111827;">${c.vin || '-'}</td>
              </tr>
              <tr>
                <td style="color: #4b5563; padding: 0;">HSN / TSN:</td>
                <td style="text-align: right; font-weight: 500; color: #111827;">${c.hsn || '-'}${c.tsn ? ' / ' + c.tsn : ''}</td>
              </tr>
              <tr>
                <td style="color: #4b5563; padding: 0;">KM-Stand:</td>
                <td style="text-align: right; font-weight: 600; color: #111827;">${invoiceMileage.toLocaleString('de-DE')} km</td>
              </tr>
            </table>
          </div>
        </div>

        <!-- TITEL / AUFTRAG -->
        <h3 style="
          font-size: 11.5px;
          font-weight: 700;
          color: #111827;
          margin: 0 0 5px 0;
          padding-bottom: 2px;
          border-bottom: 1px solid #e5e7eb;
          text-transform: uppercase;
          letter-spacing: 0.3px;
        ">${invoiceTitle}</h3>

        <!-- LEISTUNGSTABELLE -->
        <table class="invoice-table" style="
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 6px;
          font-size: 10px;
        ">
          <thead>
            <tr style="background-color: #f3f4f6; color: #111827; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #d1d5db;">
              <th style="padding: 3px 5px; text-align: left;">Position / Beschreibung</th>
              <th style="padding: 3px 5px; text-align: right;">Betrag</th>
            </tr>
          </thead>
          <tbody style="color: #1f2937;">
            ${itemsHtml}
          </tbody>
        </table>

        <!-- GESAMTSUMME -->
        <div class="invoice-total" style="
          display: flex;
          justify-content: flex-end;
          align-items: center;
          background-color: #111827;
          color: #ffffff;
          padding: 4px 6px;
          border-radius: 3px;
          font-size: 12px;
          font-weight: 700;
          margin-top: 5px;
          margin-bottom: 6px;
        ">
          <span style="margin-right: 6px; font-weight: 400; font-size: 9.5px; opacity: 0.9;">Gesamtsumme:</span>
          <span>${invoiceTotal.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</span>
        </div>

        <!-- ARBEITSBERICHT & ANMERKUNGEN -->
        ${notesText ? `
          <div class="invoice-notes" style="
            background-color: #f9fafb;
            border: 1px solid #d1d5db;
            border-left: 3px solid #111827;
            border-radius: 3px;
            padding: 4px 6px;
            margin-bottom: 6px;
            font-size: 9.5px;
            color: #1f2937;
          ">
            <strong style="display: block; margin-bottom: 1px; color: #111827; font-size: 8.5px; text-transform: uppercase;">Arbeitsbericht / Anmerkungen:</strong>
            <span style="white-space: pre-line;">${notesText}</span>
          </div>
        ` : ''}

        <!-- BILDER / DOKUMENTATION -->
        ${imagesHtml ? `
          <div style="margin-top: 5px; margin-bottom: 5px; page-break-inside: avoid;">
            <strong style="display: block; font-size: 8.5px; color: #111827; margin-bottom: 2px; text-transform: uppercase;">Fotodokumentation:</strong>
            ${imagesHtml}
          </div>
        ` : ''}
      </div>

      <!-- FUSSZEILE (im Druck fest am unteren Seitenrand fixiert) -->
      <div class="invoice-footer" style="
        padding-top: 4px;
        border-top: 1px solid #d1d5db;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
        font-size: 8px;
        color: #4b5563;
        margin-top: 10px;
      ">
        <div>
          <strong style="color: #111827; font-size: 8.5px;">Bankverbindung (Überweisung)</strong><br>
          Empfänger: ${biz.name}<br>
          IBAN: ${biz.iban}<br>
          BIC: ${biz.bic} | Bank: ${biz.bank}
        </div>
        <div>
          <strong style="color: #111827; font-size: 8.5px;">PayPal / Alternative</strong><br>
          PayPal-Me: ${biz.paypalMe}<br>
          E-Mail: ${biz.paypalEmail}<br>
          Verwendungszweck: ${c.plate || c.owner} - ${invoiceDate}
        </div>
      </div>
    </div>
  `;

  printWhenImagesLoaded(printContainer);
}

/* --- SAMMELRECHNUNG: mehrere Aufträge eines Kundenfahrzeugs auf eine Rechnung --- */
function openCombinedInvoiceModal() {
  const c = getActiveCustomerVehicle();
  if (!c || !c.services || c.services.length === 0) {
    alert('Für dieses Fahrzeug sind noch keine Aufträge erfasst.');
    return;
  }
  const list = document.getElementById('combinedInvoiceList');
  const jobs = [...c.services].sort(compareByDateThenMileageDesc);
  list.innerHTML = jobs.map(j => `
    <label class="combined-invoice-item">
      <input type="checkbox" value="${j.id}" onchange="updateCombinedInvoiceTotal()">
      <span class="combined-invoice-item-main">
        <strong>${escapeHtml(j.title || 'Auftrag')}</strong>
        <small>${j.date || '-'}${j.mileage ? ' · ' + j.mileage.toLocaleString('de-DE') + ' km' : ''}${j.items && j.items.length ? ' · ' + j.items.length + (j.items.length === 1 ? ' Position' : ' Positionen') : ''}</small>
      </span>
      <span class="combined-invoice-item-price">${(j.totalCost || 0).toFixed(2)} €</span>
    </label>`).join('');
  updateCombinedInvoiceTotal();
  document.getElementById('combinedInvoiceModal').classList.add('active');
}
window.openCombinedInvoiceModal = openCombinedInvoiceModal;

function closeCombinedInvoiceModal() {
  document.getElementById('combinedInvoiceModal').classList.remove('active');
}
window.closeCombinedInvoiceModal = closeCombinedInvoiceModal;

function getSelectedCombinedInvoiceJobs() {
  const c = getActiveCustomerVehicle();
  if (!c || !c.services) return [];
  const ids = Array.from(document.querySelectorAll('#combinedInvoiceList input:checked')).map(cb => cb.value);
  return c.services.filter(j => ids.includes(j.id));
}

function updateCombinedInvoiceTotal() {
  const jobs = getSelectedCombinedInvoiceJobs();
  const total = jobs.reduce((sum, j) => sum + (j.totalCost || 0), 0);
  document.getElementById('combinedInvoiceSummary').textContent =
    `${jobs.length} ${jobs.length === 1 ? 'Auftrag' : 'Aufträge'} ausgewählt · Summe ${total.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
  document.getElementById('combinedInvoicePrintBtn').disabled = jobs.length === 0;
}
window.updateCombinedInvoiceTotal = updateCombinedInvoiceTotal;

function printCombinedInvoice() {
  const c = getActiveCustomerVehicle();
  const jobs = getSelectedCombinedInvoiceJobs();
  if (!c || jobs.length === 0) return;
  closeCombinedInvoiceModal();
  printCustomerInvoice(c, jobs);
}
window.printCombinedInvoice = printCombinedInvoice;
