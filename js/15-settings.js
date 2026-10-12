/* --- EXPORT & IMPORT (BACKUP) --- */
/* --- BACKUP: Sichern (Teilen-Menü oder Download) --- */
// Die Datei ist immer reines JSON. Chrome (Android) lässt beim Teilen keine
// .json-Dateien zu - dann wird dieselbe Datei als .txt geteilt; der Import
// akzeptiert beides.
function buildBackupFile(extension) {
  const now = new Date();
  const stamp = `${getLocalDateStr(now)}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  const payload = { ...appData, lastBackupDate: now.toISOString(), exportedAt: now.toISOString() };
  const json = JSON.stringify(payload, null, 2);
  const type = extension === 'txt' ? 'text/plain' : 'application/json';
  return new File([json], `sgs_backup_${stamp}.${extension}`, { type });
}

// Welche Dateiendung lässt das Teilen-Menü zu? (Test mit Mini-Datei, damit nicht
// jedes Mal das komplette Backup samt Fotos gebaut werden muss)
function getShareableBackupExtension() {
  if (!navigator.share || !navigator.canShare) return null;
  for (const ext of ['json', 'txt']) {
    const probe = new File(['{}'], `probe.${ext}`, { type: ext === 'txt' ? 'text/plain' : 'application/json' });
    try {
      if (navigator.canShare({ files: [probe] })) return ext;
    } catch (e) { /* nächste Variante probieren */ }
  }
  return null;
}

function canShareBackup() {
  return getShareableBackupExtension() !== null;
}

function markBackupDone() {
  appData.lastBackupDate = new Date().toISOString();
  appData.backupReminderSnoozeUntil = null;
  saveData({ keepChangeDate: true });
  updateLastBackupInfo();
  renderBackupReminder();
}

function downloadBackup() {
  const file = buildBackupFile('json');
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  markBackupDone();
}
window.downloadBackup = downloadBackup;

async function shareBackup() {
  const ext = getShareableBackupExtension();
  if (!ext) {
    downloadBackup();
    return;
  }
  const file = buildBackupFile(ext);
  try {
    await navigator.share({ files: [file], title: 'SGS Pro Backup' });
    markBackupDone();
  } catch (err) {
    // Abbruch im Teilen-Menü ist kein Fehler - dann gilt das Backup nur nicht als erledigt
    if (err && err.name === 'AbortError') return;
    console.warn('Teilen fehlgeschlagen, lade stattdessen herunter:', err);
    downloadBackup();
  }
}
window.shareBackup = shareBackup;

// Ältere Aufrufe (z.B. aus gespeicherten Seiten) weiter unterstützen
function exportData() { downloadBackup(); }
window.exportData = exportData;

/* --- BACKUP: Wiederherstellen (mit Vorschau, was in der Datei steckt) --- */
function summarizeBackupData(data) {
  const vehicles = (data.vehicles || []);
  return {
    vehicles: vehicles.length,
    fuel: vehicles.reduce((sum, v) => sum + (v.fuelEntries || []).length, 0),
    services: vehicles.reduce((sum, v) => sum + (v.serviceEntries || []).filter(s => !s.isStandEntry).length, 0),
    customers: (data.customerVehicles || []).length
  };
}

function formatBackupSummary(sum) {
  const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  const parts = [n(sum.vehicles, 'Fahrzeug', 'Fahrzeuge'), n(sum.fuel, 'Tankung', 'Tankungen'), n(sum.services, 'Wartung/Ausgabe', 'Wartungen/Ausgaben')];
  if (sum.customers > 0) parts.push(n(sum.customers, 'Kundenfahrzeug', 'Kundenfahrzeuge'));
  return parts.join(', ');
}

function importData(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    let parsed;
    try {
      parsed = JSON.parse(e.target.result);
    } catch (err) {
      alert("Die Datei ist kein gültiges Backup (kein lesbares JSON): " + err.message);
      return;
    }
    if (!parsed || !Array.isArray(parsed.vehicles)) {
      alert("Ungültiges Backup-Format.");
      return;
    }

    const backupDateIso = parsed.exportedAt || parsed.lastBackupDate;
    const backupDateText = backupDateIso ? new Date(backupDateIso).toLocaleString('de-DE') : 'unbekannt';
    const lines = [
      `Backup vom ${backupDateText}:`,
      formatBackupSummary(summarizeBackupData(parsed)),
      '',
      'Aktuell auf diesem Gerät:',
      formatBackupSummary(summarizeBackupData(appData)),
      ''
    ];
    if (backupDateIso && appData.lastChangeDate && appData.lastChangeDate > backupDateIso) {
      lines.push('⚠ Achtung: Auf diesem Gerät gibt es neuere Änderungen als in diesem Backup - sie gehen beim Wiederherstellen verloren.', '');
    }
    lines.push('Alle aktuellen Daten auf diesem Gerät werden durch das Backup ersetzt. Fortfahren?');
    if (!confirm(lines.join('\n'))) return;

    delete parsed.exportedAt;
    appData = parsed;
    if (!appData.businessInfo) appData.businessInfo = getDefaultBusinessInfo();
    if (!appData.customerVehicles) appData.customerVehicles = [];
    // Das wiederhergestellte Backup gilt als gesichert (die Datei existiert ja)
    appData.lastChangeDate = backupDateIso || null;
    saveData({ keepChangeDate: true });
    initApp();
    closeSettingsModal();
    alert("Daten erfolgreich wiederhergestellt!");
  };
  reader.readAsText(file);
  event.target.value = '';
}

/* --- BACKUP-ERINNERUNG (Hinweis auf dem Startbildschirm) ---
   Erscheint, wenn es seit dem letzten Backup Änderungen gibt und das letzte
   Backup länger als appData.backupReminderDays (Standard 14, 0 = aus) her ist.
   Wird pro Gerät gezählt, weil jedes Gerät seine eigenen Daten hat. */
const BACKUP_REMINDER_DEFAULT_DAYS = 14;
const BACKUP_REMINDER_SNOOZE_DAYS = 3;

function getBackupReminderDays() {
  return typeof appData.backupReminderDays === 'number' ? appData.backupReminderDays : BACKUP_REMINDER_DEFAULT_DAYS;
}

function getBackupReminderState(now = new Date()) {
  const days = getBackupReminderDays();
  if (days <= 0 || !appData.lastChangeDate) return null;
  if (appData.lastBackupDate && appData.lastChangeDate <= appData.lastBackupDate) return null;
  if (appData.backupReminderSnoozeUntil && now.toISOString() < appData.backupReminderSnoozeUntil) return null;
  // Ohne bisheriges Backup zählt die Frist ab der ersten erfassten Änderung
  const since = appData.lastBackupDate || appData.firstChangeDate || appData.lastChangeDate;
  const daysSince = Math.floor((now - new Date(since)) / 86400000);
  if (daysSince < days) return null;
  return { daysSince, neverBackedUp: !appData.lastBackupDate };
}

function renderBackupReminder() {
  const el = document.getElementById('backupReminder');
  if (!el) return;
  const state = getBackupReminderState();
  if (!state) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  const text = state.neverBackedUp
    ? 'Du hast noch nie ein Backup gemacht.'
    : `Letztes Backup vor ${state.daysSince} Tagen.`;
  const shareAvailable = canShareBackup();
  el.innerHTML = `
    <div class="backup-reminder-text">
      <strong>Daten sichern?</strong>
      <span>${text} Deine Daten liegen nur auf diesem Gerät.</span>
    </div>
    <div class="backup-reminder-actions">
      ${shareAvailable ? '<button type="button" class="btn btn-primary btn-sm" onclick="shareBackup()">Sichern / Teilen</button>' : ''}
      <button type="button" class="btn ${shareAvailable ? 'btn-secondary' : 'btn-primary'} btn-sm" onclick="downloadBackup()">Herunterladen</button>
      <button type="button" class="btn btn-secondary btn-sm" onclick="snoozeBackupReminder()">Später</button>
    </div>`;
  el.style.display = '';
}

function snoozeBackupReminder() {
  appData.backupReminderSnoozeUntil = new Date(Date.now() + BACKUP_REMINDER_SNOOZE_DAYS * 86400000).toISOString();
  saveData({ keepChangeDate: true });
  renderBackupReminder();
}
window.snoozeBackupReminder = snoozeBackupReminder;

function setBackupReminderDays(value) {
  appData.backupReminderDays = parseInt(value, 10) || 0;
  saveData({ keepChangeDate: true });
  renderBackupReminder();
}
window.setBackupReminderDays = setBackupReminderDays;

/* --- EINSTELLUNGEN-MENÜ --- */
function updateLastBackupInfo() {
  const el = document.getElementById('lastBackupInfo');
  if (!el) return;
  el.innerText = appData.lastBackupDate
    ? new Date(appData.lastBackupDate).toLocaleString('de-DE')
    : 'noch nie';
}

function openSettingsModal() {
  const info = appData.businessInfo || getDefaultBusinessInfo();
  document.getElementById('bizName').value = info.name || '';
  document.getElementById('bizSubtitle').value = info.subtitle || '';
  document.getElementById('bizIban').value = info.iban || '';
  document.getElementById('bizBic').value = info.bic || '';
  document.getElementById('bizBank').value = info.bank || '';
  document.getElementById('bizPaypalMe').value = info.paypalMe || '';
  document.getElementById('bizPaypalEmail').value = info.paypalEmail || '';

  updateLastBackupInfo();
  const reminderSelect = document.getElementById('backupReminderDays');
  if (reminderSelect) reminderSelect.value = String(getBackupReminderDays());
  const shareBtn = document.getElementById('backupShareBtn');
  if (shareBtn) shareBtn.style.display = canShareBackup() ? '' : 'none';
  applyTheme(appData.theme || 'dark');
  applyBackgroundStyle(appData.backgroundStyle || 'concrete');
  applyAccentColor(appData.accentColor || 'amber');
  applyUiStyle(appData.uiStyle || 'standard');
  applyCustomerVehiclesVisibility();
  applyVehicleCategoryToggleVisibility();
  applyFuelDealSettingsUI();

  document.getElementById('settingsModal').classList.add('active');
}
window.openSettingsModal = openSettingsModal;

function closeSettingsModal() {
  document.getElementById('settingsModal').classList.remove('active');
}
window.closeSettingsModal = closeSettingsModal;

function saveBusinessInfo(e) {
  e.preventDefault();
  appData.businessInfo = {
    name: document.getElementById('bizName').value,
    subtitle: document.getElementById('bizSubtitle').value,
    iban: document.getElementById('bizIban').value,
    bic: document.getElementById('bizBic').value,
    bank: document.getElementById('bizBank').value,
    paypalMe: document.getElementById('bizPaypalMe').value,
    paypalEmail: document.getElementById('bizPaypalEmail').value
  };
  saveData();
  alert("Rechnungsdaten gespeichert.");
}
window.saveBusinessInfo = saveBusinessInfo;

function resetAllData() {
  if (!confirm("ACHTUNG: Damit werden ALLE Fahrzeuge, Kunden und Einstellungen auf diesem Gerät unwiderruflich gelöscht. Dies kann nicht rückgängig gemacht werden. Fortfahren?")) {
    return;
  }
  if (!confirm("Letzte Sicherheitsabfrage: Wirklich ALLE Daten endgültig löschen?")) {
    return;
  }
  localStorage.removeItem('sgs_data');
  localStorage.removeItem('fleethub_data');
  sgsIdbDelete('sgs_data').finally(() => location.reload());
}
window.resetAllData = resetAllData;
/* --- BILDER AUTOMATISCH KOMPRIMIEREN (MAX 800PX / JPEG 70%) --- */
function compressImage(base64Str, maxWidth = 800, maxHeight = 800, quality = 0.7) {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
  });
}
