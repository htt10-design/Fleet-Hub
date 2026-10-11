/* --- BILDZUSCHNITT (wiederverwendet für Fahrzeugfoto & Fahrzeugschein-Foto) ---
   Das ganze Bild wird angezeigt, darüber liegt ein frei verschieb- und
   skalierbares Auswahlrechteck. Genau der Bereich innerhalb des Rechtecks
   wird beim Übernehmen ausgeschnitten. */
let cropTarget = 'vehicle';
let cropState = {
  naturalWidth: 0,
  naturalHeight: 0,
  displayWidth: 0,
  displayHeight: 0,
  sel: { x: 0, y: 0, w: 0, h: 0 },
  mode: null, // 'move' | 'nw' | 'ne' | 'sw' | 'se'
  startPointerX: 0,
  startPointerY: 0,
  startSel: { x: 0, y: 0, w: 0, h: 0 }
};
let cropHandlersAttached = false;
const CROP_MIN_SIZE = 32;
let cropOriginalDataUrl = null;
let cropRotation = 0; // 0, 90, 180, 270 (im Uhrzeigersinn)

function renderCropSelection() {
  const sel = document.getElementById('cropSelection');
  if (!sel) return;
  sel.style.left = cropState.sel.x + 'px';
  sel.style.top = cropState.sel.y + 'px';
  sel.style.width = cropState.sel.w + 'px';
  sel.style.height = cropState.sel.h + 'px';
}

function openImageCropModal(dataUrl) {
  const modal = document.getElementById('imageCropModal');

  cropOriginalDataUrl = dataUrl;
  cropRotation = 0;

  // Modal zuerst sichtbar machen, damit das Bild beim Laden schon seine
  // echte gerenderte Größe hat
  modal.classList.add('active');
  attachCropSelectionHandlers();

  loadCropImageSrc();
}

// Lädt das Ausgangsbild (ggf. gedreht) in den Zuschneide-Bereich und setzt
// die Auswahl danach wieder auf das komplette (gedrehte) Bild zurück
function loadCropImageSrc() {
  const img = document.getElementById('cropImage');

  img.onload = () => {
    cropState.naturalWidth = img.naturalWidth;
    cropState.naturalHeight = img.naturalHeight;
    // Nach dem Setzen von img.src braucht der Browser einen Layout-Tick,
    // bis clientWidth/-Height die tatsächlich gerenderte Größe zeigen
    requestAnimationFrame(() => {
      cropState.displayWidth = img.clientWidth;
      cropState.displayHeight = img.clientHeight;

      // Auswahl startet über das komplette Bild, damit standardmäßig
      // nichts abgeschnitten wird - der Nutzer zieht die Ecken bei Bedarf ein
      cropState.sel = { x: 0, y: 0, w: cropState.displayWidth, h: cropState.displayHeight };
      renderCropSelection();
    });
  };

  if (cropRotation === 0) {
    img.src = cropOriginalDataUrl;
    return;
  }

  // Für 90°/180°/270° wird das Originalbild einmalig über einen Canvas
  // gedreht - so bleibt die Drehung verlustfrei nachvollziehbar und die
  // Zuschnitt-Logik (natürliche/gerenderte Maße) funktioniert unverändert
  const rotSource = new Image();
  rotSource.onload = () => {
    const swap = cropRotation === 90 || cropRotation === 270;
    const canvas = document.createElement('canvas');
    canvas.width = swap ? rotSource.naturalHeight : rotSource.naturalWidth;
    canvas.height = swap ? rotSource.naturalWidth : rotSource.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(cropRotation * Math.PI / 180);
    ctx.drawImage(rotSource, -rotSource.naturalWidth / 2, -rotSource.naturalHeight / 2);
    img.src = canvas.toDataURL('image/jpeg', 0.92);
  };
  rotSource.src = cropOriginalDataUrl;
}

function rotateCropImage(deltaDeg) {
  cropRotation = (cropRotation + deltaDeg + 360) % 360;
  loadCropImageSrc();
}
window.rotateCropImage = rotateCropImage;

function attachCropSelectionHandlers() {
  if (cropHandlersAttached) return;
  cropHandlersAttached = true;

  const stage = document.getElementById('cropStage');
  const sel = document.getElementById('cropSelection');

  function clampSel() {
    const maxW = cropState.displayWidth;
    const maxH = cropState.displayHeight;
    cropState.sel.w = Math.max(CROP_MIN_SIZE, Math.min(cropState.sel.w, maxW));
    cropState.sel.h = Math.max(CROP_MIN_SIZE, Math.min(cropState.sel.h, maxH));
    cropState.sel.x = Math.min(Math.max(0, cropState.sel.x), maxW - cropState.sel.w);
    cropState.sel.y = Math.min(Math.max(0, cropState.sel.y), maxH - cropState.sel.h);
  }

  function startDrag(mode, e) {
    cropState.mode = mode;
    cropState.startPointerX = e.clientX;
    cropState.startPointerY = e.clientY;
    cropState.startSel = { ...cropState.sel };
    e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  }

  sel.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.crop-handle')) return; // Ecken haben eigenen Handler
    startDrag('move', e);
  });

  sel.querySelectorAll('.crop-handle').forEach(handle => {
    handle.addEventListener('pointerdown', (e) => {
      startDrag(handle.dataset.handle, e);
    });
  });

  window.addEventListener('pointermove', (e) => {
    if (!cropState.mode) return;
    const dx = e.clientX - cropState.startPointerX;
    const dy = e.clientY - cropState.startPointerY;
    const s = cropState.startSel;

    if (cropState.mode === 'move') {
      cropState.sel.x = s.x + dx;
      cropState.sel.y = s.y + dy;
    } else {
      let { x, y, w, h } = s;
      if (cropState.mode.includes('n')) { y = s.y + dy; h = s.h - dy; }
      if (cropState.mode.includes('s')) { h = s.h + dy; }
      if (cropState.mode.includes('w')) { x = s.x + dx; w = s.w - dx; }
      if (cropState.mode.includes('e')) { w = s.w + dx; }
      // Verhindert Umklappen des Rechtecks, wenn über den gegenüberliegenden Rand gezogen wird
      if (w < CROP_MIN_SIZE) { if (cropState.mode.includes('w')) x = s.x + s.w - CROP_MIN_SIZE; w = CROP_MIN_SIZE; }
      if (h < CROP_MIN_SIZE) { if (cropState.mode.includes('n')) y = s.y + s.h - CROP_MIN_SIZE; h = CROP_MIN_SIZE; }
      cropState.sel = { x, y, w, h };
    }
    clampSel();
    renderCropSelection();
  });

  const endDrag = () => { cropState.mode = null; };
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
}

function closeImageCropModal() {
  document.getElementById('imageCropModal').classList.remove('active');
  const input = document.getElementById('vehicleImageInput');
  if (input) input.value = '';
  const fzsInput = document.getElementById('fzscheinPhotoInput');
  if (fzsInput) fzsInput.value = '';
}
window.closeImageCropModal = closeImageCropModal;

function applyImageCrop() {
  const img = document.getElementById('cropImage');

  const ratioX = cropState.naturalWidth / cropState.displayWidth;
  const ratioY = cropState.naturalHeight / cropState.displayHeight;

  const sx = cropState.sel.x * ratioX;
  const sy = cropState.sel.y * ratioY;
  const sw = cropState.sel.w * ratioX;
  const sh = cropState.sel.h * ratioY;

  // Ausgabebreite an der Auswahl orientieren (max. 1000px), Seitenverhältnis
  // der Auswahl bleibt exakt erhalten - es wird nur beschnitten, nie verzerrt
  const outputWidth = Math.max(1, Math.min(1000, Math.round(sw)));
  const outputHeight = Math.max(1, Math.round(outputWidth * (sh / sw)));

  const canvas = document.createElement('canvas');
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const ctx = canvas.getContext('2d');

  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outputWidth, outputHeight);

  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

  if (cropTarget === 'fahrzeugschein') {
    tempFzscheinPhoto = dataUrl;
    renderFzscheinPhotoPreview();
    // Direkt sichern, damit das Foto auch dann erhalten bleibt, wenn das
    // Fahrzeugschein-Fenster zwischenzeitlich geschlossen wurde und das
    // Formular nicht mehr separat abgeschickt wird.
    const vFzs = getActiveVehicle();
    if (vFzs) {
      if (!vFzs.fahrzeugschein) vFzs.fahrzeugschein = {};
      vFzs.fahrzeugschein.photo = dataUrl;
      saveData();
    }
  } else {
    const v = getActiveVehicle();
    if (v) {
      v.image = dataUrl;
      saveData();
      loadActiveVehicle();
    }
  }

  closeImageCropModal();
}
window.applyImageCrop = applyImageCrop;

/* --- FOTO-ANSICHT MIT ZOOM (wiederverwendet für Fahrzeugfoto & Fahrzeugschein-Scan) ---
   Zeigt das Bild zunächst komplett (nichts abgeschnitten). Per Mausrad,
   Doppelklick/-tipp oder Zwei-Finger-Pinch kann hineingezoomt werden;
   im gezoomten Zustand lässt sich das Bild zum Ansehen von Details verschieben. */
let zoomViewState = {
  scale: 1, minScale: 1, maxScale: 5,
  x: 0, y: 0,
  dragging: false,
  startPX: 0, startPY: 0, startX: 0, startY: 0,
  pinchActive: false, pinchStartDist: 0, pinchStartScale: 1
};
let zoomViewHandlersAttached = false;

function openImageZoomView(src) {
  if (!src) return;
  const modal = document.getElementById('imageZoomViewModal');
  const img = document.getElementById('imageZoomImg');
  zoomViewState.scale = 1;
  zoomViewState.x = 0;
  zoomViewState.y = 0;
  img.src = src;
  img.style.transform = 'translate(0px, 0px) scale(1)';
  modal.classList.add('active');
  attachImageZoomHandlers();
}
window.openImageZoomView = openImageZoomView;

function closeImageZoomView() {
  document.getElementById('imageZoomViewModal').classList.remove('active');
}
window.closeImageZoomView = closeImageZoomView;

function applyZoomTransform() {
  const img = document.getElementById('imageZoomImg');
  img.style.transform = `translate(${zoomViewState.x}px, ${zoomViewState.y}px) scale(${zoomViewState.scale})`;
}

function clampZoomPan() {
  if (zoomViewState.scale <= zoomViewState.minScale) {
    zoomViewState.scale = zoomViewState.minScale;
    zoomViewState.x = 0;
    zoomViewState.y = 0;
  }
}

function getTouchDist(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function attachImageZoomHandlers() {
  if (zoomViewHandlersAttached) return;
  zoomViewHandlersAttached = true;

  const img = document.getElementById('imageZoomImg');
  const stage = document.getElementById('imageZoomStage');

  // Mausrad zum Zoomen (Desktop)
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = -e.deltaY * 0.0015;
    zoomViewState.scale = Math.min(zoomViewState.maxScale, Math.max(zoomViewState.minScale, zoomViewState.scale + delta));
    clampZoomPan();
    applyZoomTransform();
  }, { passive: false });

  // Doppelklick/Doppeltipp zum Rein-/Rauszoomen
  let lastTapTime = 0;
  img.addEventListener('pointerdown', (e) => {
    if (zoomViewState.pinchActive) return;
    const now = Date.now();
    if (now - lastTapTime < 300) {
      zoomViewState.scale = zoomViewState.scale > zoomViewState.minScale ? zoomViewState.minScale : 2.5;
      zoomViewState.x = 0;
      zoomViewState.y = 0;
      clampZoomPan();
      applyZoomTransform();
      lastTapTime = 0;
      return;
    }
    lastTapTime = now;

    if (zoomViewState.scale <= zoomViewState.minScale) return; // erst zoomen, dann verschieben
    zoomViewState.dragging = true;
    img.classList.add('dragging');
    zoomViewState.startPX = e.clientX;
    zoomViewState.startPY = e.clientY;
    zoomViewState.startX = zoomViewState.x;
    zoomViewState.startY = zoomViewState.y;
    img.setPointerCapture && img.setPointerCapture(e.pointerId);
  });

  img.addEventListener('pointermove', (e) => {
    if (!zoomViewState.dragging) return;
    zoomViewState.x = zoomViewState.startX + (e.clientX - zoomViewState.startPX);
    zoomViewState.y = zoomViewState.startY + (e.clientY - zoomViewState.startPY);
    applyZoomTransform();
  });

  const endDrag = () => { zoomViewState.dragging = false; img.classList.remove('dragging'); };
  img.addEventListener('pointerup', endDrag);
  img.addEventListener('pointercancel', endDrag);

  // Zwei-Finger-Pinch zum Zoomen (Touch)
  stage.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      zoomViewState.pinchActive = true;
      zoomViewState.dragging = false;
      zoomViewState.pinchStartDist = getTouchDist(e.touches);
      zoomViewState.pinchStartScale = zoomViewState.scale;
    }
  }, { passive: true });

  stage.addEventListener('touchmove', (e) => {
    if (zoomViewState.pinchActive && e.touches.length === 2) {
      e.preventDefault();
      const dist = getTouchDist(e.touches);
      const factor = dist / zoomViewState.pinchStartDist;
      zoomViewState.scale = Math.min(zoomViewState.maxScale, Math.max(zoomViewState.minScale, zoomViewState.pinchStartScale * factor));
      clampZoomPan();
      applyZoomTransform();
    }
  }, { passive: false });

  stage.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) zoomViewState.pinchActive = false;
  });
}
