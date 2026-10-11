/* --- EXPORT & IMPORT (BACKUP) --- */
function exportData() {
  appData.lastBackupDate = new Date().toISOString();
  saveData();
  updateLastBackupInfo();

  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(appData, null, 2));
  const dlAnchorElem = document.createElement('a');
  dlAnchorElem.setAttribute("href", dataStr);
  dlAnchorElem.setAttribute("download", `sgs_backup_${new Date().toISOString().split('T')[0]}.json`);
  document.body.appendChild(dlAnchorElem);
  dlAnchorElem.click();
  dlAnchorElem.remove();
}

function importData(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (!confirm("Achtung: Beim Import werden ALLE aktuellen Daten (Fahrzeuge, Kunden, Einstellungen) auf diesem Gerät unwiderruflich durch die Backup-Datei ersetzt. Fortfahren?")) {
    event.target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const parsed = JSON.parse(e.target.result);
      if (parsed && parsed.vehicles) {
        appData = parsed;
        if (!appData.businessInfo) appData.businessInfo = getDefaultBusinessInfo();
        if (!appData.customerVehicles) appData.customerVehicles = [];
        saveData();
        initApp();
        closeSettingsModal();
        alert("Daten erfolgreich wiederhergestellt!");
      } else {
        alert("Ungültiges Backup-Format.");
      }
    } catch (err) {
      alert("Fehler beim Lesen der Backup-Datei: " + err.message);
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

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
