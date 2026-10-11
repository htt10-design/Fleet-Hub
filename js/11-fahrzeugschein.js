/* --- FAHRZEUGSCHEIN: Foto/Scan des echten Dokuments hinterlegen --- */
let tempFzscheinPhoto = null;

function handleFahrzeugscheinPhotoUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  cropTarget = 'fahrzeugschein';
  const reader = new FileReader();
  reader.onload = function(e) {
    openImageCropModal(e.target.result);
  };
  reader.readAsDataURL(file);
}
window.handleFahrzeugscheinPhotoUpload = handleFahrzeugscheinPhotoUpload;

function renderFzscheinPhotoPreview() {
  const container = document.getElementById('fzscheinPhotoPreviewContainer');
  if (!container) return;
  if (!tempFzscheinPhoto) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = `
    <div class="fzschein-photo-thumb-wrapper">
      <img src="${tempFzscheinPhoto}" class="fzschein-photo-thumb" onclick="viewFzscheinPhoto()">
      <button type="button" class="fzschein-photo-remove" onclick="removeFzscheinPhoto()">✕</button>
    </div>
  `;
}

function removeFzscheinPhoto() {
  tempFzscheinPhoto = null;
  renderFzscheinPhotoPreview();
}
window.removeFzscheinPhoto = removeFzscheinPhoto;

function viewFzscheinPhoto() {
  if (!tempFzscheinPhoto) return;
  openImageZoomView(tempFzscheinPhoto);
}
window.viewFzscheinPhoto = viewFzscheinPhoto;

/* --- FAHRZEUGSCHEIN (digital nachgebaut, alle Felder optional) --- */
const FAHRZEUGSCHEIN_FIELDS = [
  'erstzulassung', 'hsn', 'tsn', 'vin', 'typ', 'hersteller', 'handelsbezeichnung',
  'fahrzeugart', 'schadstoffklasse', 'kraftstoffart', 'hubraum',
  'leistungKw', 'drehzahl', 'hoechstgeschwindigkeit', 'laenge', 'breite', 'hoehe',
  'leergewicht', 'gesamtgewicht', 'achslastVorne', 'achslastHinten',
  'anhaengelastGebremst', 'anhaengelastUngebremst', 'bereifungVorne', 'bereifungHinten'
];

function openFahrzeugscheinModal() {
  const v = getActiveVehicle();
  if (!v) return;
  const daten = v.fahrzeugschein || {};

  FAHRZEUGSCHEIN_FIELDS.forEach(key => {
    const el = document.getElementById('fzs' + key.charAt(0).toUpperCase() + key.slice(1));
    if (el) el.value = daten[key] || '';
  });

  // Immer auf Seite 1 starten
  const page1 = document.getElementById('fzsPage1');
  const page2 = document.getElementById('fzsPage2');
  if (page1) { page1.style.display = ''; page1.classList.add('active'); }
  if (page2) { page2.style.display = 'none'; page2.classList.remove('active'); }

  // Hinterlegtes Foto/Scan laden
  tempFzscheinPhoto = daten.photo || null;
  renderFzscheinPhotoPreview();

  document.getElementById('fahrzeugscheinModal').classList.add('active');
}
window.openFahrzeugscheinModal = openFahrzeugscheinModal;

// Blättert dezent zwischen den beiden Schein-Seiten um
function switchFzscheinPage(targetPageNum) {
  const currentPage = document.querySelector('.fzschein-page.active');
  const targetPage = document.getElementById('fzsPage' + targetPageNum);
  if (!currentPage || !targetPage || currentPage === targetPage) return;

  currentPage.classList.add('fzschein-page-turning-out');
  setTimeout(() => {
    currentPage.classList.remove('active', 'fzschein-page-turning-out');
    currentPage.style.display = 'none';

    targetPage.style.display = '';
    targetPage.classList.add('active', 'fzschein-page-turning-in');
    setTimeout(() => targetPage.classList.remove('fzschein-page-turning-in'), 560);
  }, 550);
}
window.switchFzscheinPage = switchFzscheinPage;

function closeFahrzeugscheinModal() {
  document.getElementById('fahrzeugscheinModal').classList.remove('active');
}
window.closeFahrzeugscheinModal = closeFahrzeugscheinModal;

function saveFahrzeugschein(e) {
  e.preventDefault();
  const v = getActiveVehicle();
  if (!v) return;

  const daten = {};
  FAHRZEUGSCHEIN_FIELDS.forEach(key => {
    const el = document.getElementById('fzs' + key.charAt(0).toUpperCase() + key.slice(1));
    if (el) daten[key] = el.value;
  });

  daten.photo = tempFzscheinPhoto || null;
  v.fahrzeugschein = daten;

  // Umgekehrte Richtung: überschneidende Angaben zurück in die Stammdaten
  // übernehmen, damit beide Stellen immer synchron bleiben
  if (daten.erstzulassung) v.firstReg = daten.erstzulassung;
  if (daten.hsn) v.hsn = daten.hsn;
  if (daten.tsn) v.tsn = daten.tsn;
  if (daten.vin) v.vin = daten.vin;
  if (daten.kraftstoffart) v.fuelType = daten.kraftstoffart;
  if (daten.leistungKw) {
    const ps = Math.round(parseFloat(daten.leistungKw.replace(',', '.')) * 1.35962);
    if (!isNaN(ps) && ps > 0) v.powerHp = ps;
  }
  if (daten.anhaengelastGebremst) {
    const kg = parseInt(daten.anhaengelastGebremst, 10);
    if (!isNaN(kg) && kg > 0) v.towingBraked = kg;
  }

  saveData();
  closeFahrzeugscheinModal();

  // Stammdaten-Formular neu befüllen, falls es gerade im Hintergrund offen ist
  loadActiveVehicle();
}
window.saveFahrzeugschein = saveFahrzeugschein;
