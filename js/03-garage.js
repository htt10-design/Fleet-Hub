/* --- LANGES DRÜCKEN AUF EINE FAHRZEUGKACHEL: KONTEXTMENÜ --- */
let tileLongPressTimer = null;
let tileLongPressTriggered = false;

function attachTileLongPress(card, vehicleId) {
  let startX = 0;
  let startY = 0;

  const start = (e) => {
    tileLongPressTriggered = false;
    startX = e.clientX;
    startY = e.clientY;
    tileLongPressTimer = setTimeout(() => {
      tileLongPressTriggered = true;
      openTileContextMenu(vehicleId, card);
    }, 500);
  };
  const cancel = () => {
    clearTimeout(tileLongPressTimer);
  };
  // Kleine Bewegungstoleranz, damit natürliches leichtes Zittern beim
  // Gedrückthalten auf dem Handy den Timer nicht sofort abbricht
  const moveCheck = (e) => {
    const dx = Math.abs(e.clientX - startX);
    const dy = Math.abs(e.clientY - startY);
    if (dx > 10 || dy > 10) cancel();
  };

  card.addEventListener('pointerdown', start);
  card.addEventListener('pointerup', cancel);
  card.addEventListener('pointerleave', cancel);
  card.addEventListener('pointercancel', cancel);
  card.addEventListener('pointermove', moveCheck);
}

function openTileContextMenu(vehicleId, cardEl) {
  closeTileContextMenu();

  const menu = document.createElement('div');
  menu.className = 'tile-context-menu';
  menu.id = 'tileContextMenu';
  menu.innerHTML = `
    <button type="button" onclick="event.stopPropagation(); closeTileContextMenu(); chooseGarageVehicle('${vehicleId}', 'settings')">
      ${ICON_EDIT_SVG}<span>Bearbeiten</span>
    </button>
    <button type="button" onclick="event.stopPropagation(); closeTileContextMenu(); archiveVehicleById('${vehicleId}')">
      ${ICON_ARCHIVE_SVG}<span>Als verkauft archivieren</span>
    </button>
    <button type="button" class="tile-context-menu-danger" onclick="event.stopPropagation(); closeTileContextMenu(); deleteVehicleById('${vehicleId}')">
      ${ICON_DELETE_SVG}<span>Löschen</span>
    </button>
  `;
  document.body.appendChild(menu);

  // Position dicht an der Kachel, aber innerhalb des sichtbaren Bereichs
  const rect = cardEl.getBoundingClientRect();
  const menuWidth = 230;
  let left = rect.left + window.scrollX;
  if (left + menuWidth > window.innerWidth - 10) {
    left = window.innerWidth - menuWidth - 10;
  }
  menu.style.top = (rect.top + window.scrollY + 16) + 'px';
  menu.style.left = Math.max(10, left) + 'px';

  setTimeout(() => {
    document.addEventListener('click', closeTileContextMenuOnOutsideClick);
    document.addEventListener('scroll', closeTileContextMenu, true);
  }, 0);
}
window.openTileContextMenu = openTileContextMenu;

function closeTileContextMenuOnOutsideClick(e) {
  const menu = document.getElementById('tileContextMenu');
  if (menu && !menu.contains(e.target)) {
    closeTileContextMenu();
  }
}

function closeTileContextMenu() {
  const menu = document.getElementById('tileContextMenu');
  if (menu) menu.remove();
  document.removeEventListener('click', closeTileContextMenuOnOutsideClick);
  document.removeEventListener('scroll', closeTileContextMenu, true);
}
window.closeTileContextMenu = closeTileContextMenu;

// Archivieren/Löschen eines bestimmten Fahrzeugs (aus dem Kontextmenü heraus),
// unabhängig davon, welches Fahrzeug gerade "aktiv" ist
function archiveVehicleById(id) {
  appData.activeVehicleId = id;
  archiveCurrentVehicle();
  renderGarageVehicleTiles();
}
window.archiveVehicleById = archiveVehicleById;

function deleteVehicleById(id) {
  appData.activeVehicleId = id;
  deleteCurrentVehicle();
  renderGarageVehicleTiles();
}
window.deleteVehicleById = deleteVehicleById;

function renderGarageVehicleTiles() {
  const grid = document.getElementById('garageVehicleGrid');
  if (!grid) return;

  // Bei jeder Änderung an der Fahrzeugliste (neu/gelöscht/archiviert) neu
  // bewerten, ob der "Alle"-Chip noch einen Mehrwert bietet
  updateAllCategoryChipVisibility();

  grid.innerHTML = '';

  // Beim Reiter "Alle" auf dem Smartphone: kompaktere 2-Spalten-Ansicht
  const isAllFilter = vehicleCategoryFilter === 'all';
  grid.classList.toggle('kachel-grid-compact', isAllFilter);

  const list = sortWithDinghiesGrouped(
    (appData.vehicles || [])
      .filter(v => !v.archived)
      .filter(v => vehicleCategoryFilter === 'all' || (v.category || 'auto') === vehicleCategoryFilter)
  );
  const archivedCount = (appData.vehicles || []).filter(v => v.archived).length;

  const toggleLink = document.getElementById('archiveToggleLink');
  if (toggleLink) {
    toggleLink.style.display = archivedCount > 0 ? '' : 'none';
    toggleLink.innerText = showArchivedVehicles
      ? `Archivierte Fahrzeuge ausblenden (${archivedCount})`
      : `Archivierte Fahrzeuge anzeigen (${archivedCount})`;
  }
  renderArchivedVehicleGrid();

  if (list.length === 0) {
    const categoryLabels = { auto: 'Autos', anhaenger: 'Anhänger', boot: 'Boote' };
    const emptyTitle = vehicleCategoryFilter === 'all'
      ? 'Noch kein Fahrzeug vorhanden'
      : `Keine ${categoryLabels[vehicleCategoryFilter] || 'Fahrzeuge'} vorhanden`;
    grid.innerHTML = `
      <div class="selection-card" onclick="openVehicleModal()" style="grid-column: 1 / -1; text-align: center;">
        <div class="kachel-icon">➕</div>
        <h3>${emptyTitle}</h3>
        <p>Klicke hier, um ein neues Fahrzeug anzulegen.</p>
      </div>
    `;
    return;
  }

  list.forEach(v => {
    const card = document.createElement('div');
    card.className = 'selection-card vehicle-tile' + (isAllFilter ? ' vehicle-tile-compact' : '');

    const imageHtml = v.image
      ? `<img src="${v.image}" class="vehicle-tile-image" alt="${v.name || 'Fahrzeug'}">`
      : `<div class="vehicle-tile-icon">🏎️</div>`;

    const mileage = getVehicleCurrentMileage(v);
    const mileageUnit = v.type === 'hours' ? 'Std' : 'km';
    const hsn = v.hsn || '-';
    const tsn = v.tsn || '-';

    // TÜV-Plakette (rechts auf der Kachel) statt Textzeile
    // Kachel "Alle" nutzt die kleinere 44px-Plakette (siehe .vehicle-tile-compact im CSS)
    const tuevPlakette = getTuevPlaketteData(v, isAllFilter ? 44 : 64);
    let tuevBadgeHtml = '';
    if (tuevPlakette) {
      if (tuevPlakette.empty) {
        tuevBadgeHtml = `<div class="tuev-plakette tuev-plakette-empty"></div>`;
      } else {
        tuevBadgeHtml = `
          <div class="tuev-plakette ${tuevPlakette.colorClass}">
            <div class="tuev-plakette-ring">${tuevPlakette.monthRingHtml}</div>
            <div class="tuev-plakette-center">
              <span class="tuev-plakette-year">${tuevPlakette.year}</span>
            </div>
            ${tuevPlakette.overdue ? '<span class="tuev-plakette-overdue-badge">!</span>' : ''}
          </div>
        `;
      }
    }

    // Nächste anstehende Routine-Wartung (dringendste zuerst)
    const nextMaintenance = getUpcomingMaintenanceReminders(v)[0] || null;
    const maintenanceHtml = nextMaintenance
      ? `<span class="${nextMaintenance.overdue ? 'reminder-overdue-text' : ''}"><strong>${nextMaintenance.title}:</strong> ${formatReminderMeta(nextMaintenance, v.type === 'hours' ? 'Std' : 'km')}</span>`
      : `<span><strong>Nächste Wartung:</strong> keine eingetragen</span>`;

    const hsnTsnHtml = v.category !== 'boot'
      ? `<span><strong>HSN/TSN:</strong> ${hsn} / ${tsn}</span>`
      : '';

    const mileageLabel = v.type === 'hours' ? 'Betriebsstunden' : 'KM-Stand';
    const mileageHtml = v.category !== 'anhaenger'
      ? `<span><strong>${mileageLabel}:</strong> ${mileage.toLocaleString('de-DE')} ${mileageUnit}</span>`
      : '';

    // Dingi/Beiboot: Hinweis, zu welchem Hauptboot es gehört
    let belongsToHtml = '';
    if (v.category === 'boot' && v.belongsToId) {
      const parentBoat = appData.vehicles.find(x => x.id === v.belongsToId);
      if (parentBoat) {
        belongsToHtml = `<span><strong>Gehört zu:</strong> ${parentBoat.name || 'Unbenanntes Boot'}</span>`;
      }
    }

    card.innerHTML = `
      <div class="vehicle-tile-category-badge">${getCategoryIconSvg(v.category)}</div>
      ${tuevBadgeHtml}
      ${imageHtml}
      <h3>${v.name || 'Unbenanntes Fahrzeug'}</h3>
      <p>${v.plate || 'Kein Kennzeichen'} ${(v.fuelType && vehicleHasEngine(v)) ? '• ' + v.fuelType : ''}</p>
      <div class="vehicle-tile-info">
        ${mileageHtml}
        ${hsnTsnHtml}
        ${belongsToHtml}
        ${maintenanceHtml}
      </div>
    `;

    card.onclick = () => {
      if (tileLongPressTriggered) {
        tileLongPressTriggered = false;
        return;
      }
      chooseGarageVehicle(v.id);
    };
    attachTileLongPress(card, v.id);
    grid.appendChild(card);
  });
}

/* --- ARCHIV (verkaufte Fahrzeuge) --- */
let showArchivedVehicles = false;

function toggleArchivedVehicles() {
  showArchivedVehicles = !showArchivedVehicles;
  const archiveGrid = document.getElementById('archivedVehicleGrid');
  if (archiveGrid) archiveGrid.classList.toggle('hidden', !showArchivedVehicles);
  renderGarageVehicleTiles();
}
window.toggleArchivedVehicles = toggleArchivedVehicles;

function renderArchivedVehicleGrid() {
  const grid = document.getElementById('archivedVehicleGrid');
  if (!grid) return;
  grid.innerHTML = '';

  const archived = (appData.vehicles || []).filter(v => v.archived);

  archived.forEach(v => {
    const card = document.createElement('div');
    card.className = 'selection-card vehicle-tile vehicle-tile-archived';

    const imageHtml = v.image
      ? `<img src="${v.image}" class="vehicle-tile-image" alt="${v.name || 'Fahrzeug'}">`
      : `<div class="vehicle-tile-icon">🏎️</div>`;

    card.innerHTML = `
      <div class="vehicle-tile-archived-badge">Archiviert</div>
      ${imageHtml}
      <h3>${v.name || 'Unbenanntes Fahrzeug'}</h3>
      <p>${v.plate || 'Kein Kennzeichen'} ${(v.fuelType && vehicleHasEngine(v)) ? '• ' + v.fuelType : ''}</p>
      <div class="vehicle-tile-archived-actions">
        <button type="button" class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); restoreVehicleFromArchive('${v.id}')">Wiederherstellen</button>
        <button type="button" class="btn btn-danger btn-sm" onclick="event.stopPropagation(); permanentlyDeleteArchivedVehicle('${v.id}')">Endgültig löschen</button>
      </div>
    `;

    // Klick auf die Kachel selbst öffnet das Fahrzeug weiterhin ganz normal
    // (z.B. um die Historie anzusehen oder das Verkaufsdossier erneut zu drucken)
    card.onclick = () => chooseGarageVehicle(v.id);
    grid.appendChild(card);
  });
}

// Aktuelles Fahrzeug als verkauft archivieren: Daten bleiben erhalten,
// verschwindet aber aus der normalen Kachel-Auswahl
function archiveCurrentVehicle() {
  const v = getActiveVehicle();
  if (!v) return;

  if (confirm("Möchtest du vor dem Archivieren noch das Verkaufsdossier ausdrucken?")) {
    printSaleReport();
  }

  if (!confirm(`"${v.name}" wirklich als verkauft archivieren? Es verschwindet aus "Meine Garage", bleibt aber inkl. aller Daten erhalten und kann jederzeit wiederhergestellt werden.`)) {
    return;
  }

  v.archived = true;

  const remainingActive = appData.vehicles.filter(x => !x.archived);
  if (remainingActive.length > 0) {
    appData.activeVehicleId = remainingActive[0].id;
    saveData();
    renderVehicleSelect();
    loadActiveVehicle();
  } else {
    appData.activeVehicleId = null;
    saveData();
    backToSelection();
  }
}
window.archiveCurrentVehicle = archiveCurrentVehicle;

function restoreVehicleFromArchive(id) {
  const v = appData.vehicles.find(x => x.id === id);
  if (!v) return;
  if (!confirm(`"${v.name}" wieder aktivieren und zu "Meine Garage" hinzufügen?`)) return;

  v.archived = false;
  saveData();
  renderGarageVehicleTiles();
}
window.restoreVehicleFromArchive = restoreVehicleFromArchive;

function permanentlyDeleteArchivedVehicle(id) {
  const v = appData.vehicles.find(x => x.id === id);
  if (!v) return;
  if (!confirm(`"${v.name}" inklusive ALLER Daten endgültig löschen? Das kann nicht rückgängig gemacht werden.`)) return;

  appData.vehicles = appData.vehicles.filter(x => x.id !== id);
  saveData();
  renderGarageVehicleTiles();
}
window.permanentlyDeleteArchivedVehicle = permanentlyDeleteArchivedVehicle;

// Zurück zur Haupt-Bereichsauswahl ("Meine Garage" vs. "Kundenfahrzeuge")
function showAreaSelection() {
  document.getElementById('area-selection-grid').style.display = 'grid';
  document.getElementById('garage-vehicle-selection').style.display = 'none';
  
  const title = document.getElementById('selection-title');
  if (title) title.innerText = 'Bitte wähle deinen Bereich';
}

function backToSelection() {
  renderBackupReminder();
  document.getElementById('app-wrapper').classList.add('hidden');
  document.getElementById('selection-screen').classList.remove('hidden');

  if (currentMode === 'eigene') {
    // Aus dem Tab-Modus der eigenen Fahrzeuge geht's zurück zu den Fahrzeug-Kacheln,
    // nicht bis ganz zum Start-Bildschirm
    const areaGrid = document.getElementById('area-selection-grid');
    const garageSelection = document.getElementById('garage-vehicle-selection');
    const title = document.getElementById('selection-title');

    if (areaGrid) areaGrid.style.display = 'none';
    if (garageSelection) garageSelection.style.display = 'block';
    if (title) title.innerText = 'Wähle dein Fahrzeug';

    renderGarageVehicleTiles();
  } else {
    // Kundenfahrzeuge: Verhalten bleibt wie gehabt
    showAreaSelection();
  }
}

function showTab(tabId, element) {
  // 1. Aktive Tabs und Nav-Buttons zurücksetzen
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  
  // 2. Ziel-Tab aktivieren
  const targetTab = document.getElementById(`tab-${tabId}`) || document.getElementById(tabId);
  if (targetTab) {
    targetTab.classList.add('active');
  } else {
    console.warn(`Tab-Inhalt mit ID "tab-${tabId}" oder "${tabId}" fehlt im HTML!`);
  }

  // 3. Wenn über Button geklickt, Button als 'active' markieren
  if (element) {
    element.classList.add('active');
  } else {
    // Falls via selectArea aufgerufen: Ersten sichtbaren Button aktivieren
    const activeSelector = currentMode === 'kunden' ? '.nav-kunden-only' : '.nav-eigene-only';
    document.querySelector(`.sidebar ${activeSelector}`)?.classList.add('active');
  }

  // 4. Nav-Sichtbarkeiten umschalten
  const isCustomerMode = (currentMode === 'kunden');

  document.querySelectorAll('.nav-eigene-only').forEach(item => {
    item.style.setProperty('display', isCustomerMode ? 'none' : 'flex', 'important');
  });

  document.querySelectorAll('.nav-kunden-only').forEach(item => {
    item.style.setProperty('display', isCustomerMode ? 'flex' : 'none', 'important');
  });

  // Die obige Zeile blendet pauschal ALLE "nav-eigene-only"-Punkte wieder ein
  // (auch den Tanken-Button) - hier direkt danach nochmal korrekt auf die
  // Fahrzeugart des aktiven Fahrzeugs anwenden, sonst würde z.B. bei einem
  // Anhänger der Tanken-Tab nach jedem Tab-Wechsel wieder auftauchen.
  if (!isCustomerMode) {
    const active = (typeof getActiveVehicle === 'function') ? getActiveVehicle() : null;
    if (active && typeof updateNavForCategory === 'function') {
      updateNavForCategory(active);
    }
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });

  // 5. Tab-Inhalte rendern
  try {
    if (tabId === 'dashboard' && typeof renderDashboard === 'function') renderDashboard();
    else if (tabId === 'service' && typeof renderCustomerServiceTable === 'function') renderCustomerServiceTable();
    else if (tabId === 'history' && typeof renderHistoryTable === 'function') renderHistoryTable();
    else if (tabId === 'customers' && typeof renderCustomerSection === 'function') renderCustomerSection();
    else if (tabId === 'settings' && typeof loadVehicleSettingsIntoForm === 'function') loadVehicleSettingsIntoForm();
  } catch (err) {
    console.error(`Fehler beim Laden von Tab ${tabId}:`, err);
  }
}

// Fahrzeug-Kachel wurde angeklickt -> aktives Fahrzeug setzen & in den Tab-Modus wechseln
function chooseGarageVehicle(vehicleId, startTab) {
  currentMode = 'eigene';
  appData.activeVehicleId = vehicleId;
  saveData();

  // Auswahlbildschirm verstecken & App anzeigen
  document.getElementById('selection-screen').classList.add('hidden');
  document.getElementById('app-wrapper').classList.remove('hidden');

  // Modus "Eigene Fahrzeuge" aktivieren
  document.body.classList.add('mode-eigene');
  document.body.classList.remove('mode-kunden');

  // Daten des gewählten Fahrzeugs laden (Tanken, Wartung, Historie, Dashboard...)
  renderVehicleSelect();
  loadActiveVehicle();

  const targetTab = startTab || 'dashboard';
  const targetNavBtn = document.querySelector(`.nav-item[onclick*="'${targetTab}'"]`);
  showTab(targetTab, targetNavBtn);
}


/* --- EIGENE FAHRZEUGE --- */
function renderVehicleSelect() {
  const select = document.getElementById('vehicleSelect');
  if (!select) return; // Falls das Element nicht mehr im Header existiert, abbrechen
  select.innerHTML = '';
  appData.vehicles.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = v.name;
    if (v.id === appData.activeVehicleId) opt.selected = true;
    select.appendChild(opt);
  });
}

function switchVehicle() {
  const select = document.getElementById('vehicleSelect');
  if (!select) return;
  appData.activeVehicleId = select.value;
  saveData();
  loadActiveVehicle();
}

function updateUnitLabels() {
  const typeEl = document.getElementById('vType');
  if (!typeEl) return;
  const isKm = typeEl.value === 'km';
  
  const fuelKmLabel = document.getElementById('fuelKmLabel');
  const serviceKmLabel = document.getElementById('serviceKmLabel');
  const kpiMileageUnit = document.getElementById('kpi-mileage-unit');
  const nextServiceKmLabel = document.getElementById('nextServiceKmLabel');
  const nextServiceKmInput = document.getElementById('nextServiceKm');

  if (fuelKmLabel) fuelKmLabel.innerText = isKm ? "KM-Stand" : "Betriebsstunden";
  if (serviceKmLabel) serviceKmLabel.innerText = isKm ? "KM-Stand" : "Betriebsstunden";
  if (kpiMileageUnit) kpiMileageUnit.innerText = isKm ? "Kilometerstand" : "Betriebsstunden";
  if (nextServiceKmLabel) nextServiceKmLabel.innerText = isKm ? "Bei KM-Stand" : "Bei Betriebsstunden";
  if (nextServiceKmInput) nextServiceKmInput.placeholder = isKm ? "z.B. 160.000" : "z.B. 250";
}

// Blendet den "Tanken"-Bereich (Nav-Punkt + Kraftstoffart-Feld) aus, wenn die
// aktuelle Fahrzeugart keinen eigenen Antrieb hat (z.B. Anhänger)
function updateNavForCategory(vehicleOrCategory) {
  // Kompatibel mit Aufrufen, die noch die reine Kategorie (String) übergeben
  const vehicle = (typeof vehicleOrCategory === 'object' && vehicleOrCategory) ? vehicleOrCategory : { category: vehicleOrCategory };
  const needsFuel = vehicleHasEngine(vehicle);

  const navFuelBtn = document.getElementById('navFuelBtn');
  if (navFuelBtn) navFuelBtn.style.display = needsFuel ? 'flex' : 'none';

  const fuelTypeFieldGroup = document.getElementById('fuelTypeFieldGroup');
  if (fuelTypeFieldGroup) fuelTypeFieldGroup.style.display = needsFuel ? '' : 'none';

  // Falls man gerade im Tanken-Tab ist und auf ein Fahrzeug ohne Antrieb wechselt,
  // zurück zum Dashboard springen, statt auf einem ausgeblendeten Tab hängen zu bleiben
  if (!needsFuel) {
    const fuelTab = document.getElementById('tab-fuel');
    if (fuelTab && fuelTab.classList.contains('active')) {
      showTab('dashboard');
    }
  }

}

// Blendet in den Stammdaten Felder ein/aus bzw. beschriftet sie um, je nachdem
// welche Fahrzeugart gewählt ist (Auto/Anhänger/Boot ergeben unterschiedliche
// Angaben sinnvoll)
function updateStammdatenFieldsForCategory(category) {
  const powerHpGroup = document.getElementById('powerHpFieldGroup');
  const towingBrakedGroup = document.getElementById('towingBrakedFieldGroup');
  const towingBrakedLabel = document.getElementById('towingBrakedLabel');
  const hsnTsnRow = document.getElementById('hsnTsnFieldRow');
  const nextTuevRow = document.getElementById('nextTuevFieldRow');
  const vinGroup = document.getElementById('vinFieldGroup');
  const boatIdRow = document.getElementById('boatIdFieldRow');
  const typeGroup = document.getElementById('vTypeFieldGroup');

  if (category === 'anhaenger') {
    if (powerHpGroup) powerHpGroup.style.display = 'none';
    if (towingBrakedGroup) towingBrakedGroup.style.display = '';
    if (towingBrakedLabel) towingBrakedLabel.innerText = 'Zulässiges Gesamtgewicht (kg)';
    if (hsnTsnRow) hsnTsnRow.style.display = '';
    if (nextTuevRow) nextTuevRow.style.display = '';
    if (vinGroup) vinGroup.style.display = '';
    if (boatIdRow) boatIdRow.style.display = 'none';
    if (typeGroup) typeGroup.style.display = 'none';
  } else if (category === 'boot') {
    if (powerHpGroup) powerHpGroup.style.display = 'none';
    if (towingBrakedGroup) towingBrakedGroup.style.display = 'none';
    if (hsnTsnRow) hsnTsnRow.style.display = 'none';
    if (nextTuevRow) nextTuevRow.style.display = 'none';
    if (vinGroup) vinGroup.style.display = 'none';
    if (boatIdRow) boatIdRow.style.display = '';
    if (typeGroup) typeGroup.style.display = '';
    populateBoatParentOptions();
    updateBoatTypeFields();
  } else {
    // Auto (Standard)
    if (powerHpGroup) powerHpGroup.style.display = '';
    if (towingBrakedGroup) towingBrakedGroup.style.display = '';
    if (towingBrakedLabel) towingBrakedLabel.innerText = 'Anhängelast gebremst (kg)';
    if (hsnTsnRow) hsnTsnRow.style.display = '';
    if (nextTuevRow) nextTuevRow.style.display = '';
    if (vinGroup) vinGroup.style.display = '';
    if (boatIdRow) boatIdRow.style.display = 'none';
    if (typeGroup) typeGroup.style.display = '';
  }
}
window.updateStammdatenFieldsForCategory = updateStammdatenFieldsForCategory;
