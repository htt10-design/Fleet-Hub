/* SGS Tuning-Studio (Prototyp)
   Stilisierte 3D-Garage im Stil alter Need-for-Speed-Spiele: ein selbst aus
   Grundformen gebautes Auto (kantige Limousine) auf einer Drehscheibe.
   Einstellbar: Lack, Felgen (Design/Größe/Farbe), Tieferlegung, Spur, Sturz,
   Scheibentönung, Spoiler, Bremssättel, Scheinwerfer. Reine Spaß-Funktion,
   speichert nur die letzte Konfiguration lokal im Browser. */
import * as THREE from 'three';
import { OrbitControls } from '../vendor/three/OrbitControls.js';
import { RoomEnvironment } from '../vendor/three/RoomEnvironment.js';

/* ---------------- Optionen ---------------- */
const PAINTS = [
  ['Arktikweiß', '#e9ecef'], ['Brillantsilber', '#a9b0b7'], ['Rauchsilber', '#6c737a'], ['Blauschwarz', '#141a24'],
  ['Schwarz', '#0b0b0d'], ['Signalrot', '#b3121d'], ['Nautikblau', '#1f3a64'], ['Malachit', '#1e4d3b'],
  ['Kaschmirbeige', '#c2b08d'], ['Rennorange', '#e86a12'], ['Limettengelb', '#d7d21b'], ['Violett', '#4b2a6b']
];
const FINISHES = {
  glanz: { label: 'Glanz', metalness: 0.05, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06 },
  metallic: { label: 'Metallic', metalness: 0.65, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 },
  matt: { label: 'Matt', metalness: 0.15, roughness: 0.82, clearcoat: 0, clearcoatRoughness: 1 },
  chrom: { label: 'Chrom', metalness: 1, roughness: 0.06, clearcoat: 0.6, clearcoatRoughness: 0.05 }
};
const RIM_DESIGNS = {
  gulli: 'Gullideckel',
  five: '5-Speiche',
  mesh: 'Kreuzspeiche',
  dish: 'Tiefbett',
  yspoke: 'Y-Speiche'
};
const RIM_SIZES = [15, 16, 17, 18, 19];
const RIM_COLORS = { silber: ['Silber', '#c9ced3'], anthrazit: ['Anthrazit', '#3a3f45'], schwarz: ['Schwarz', '#111316'], gold: ['Gold', '#c9a24a'], chrom: ['Chrom', '#e8ecef'], wagenfarbe: ['Wagenfarbe', null] };
const CALIPERS = { serie: ['Serie', '#5a5f66'], rot: ['Rot', '#c0161f'], gelb: ['Gelb', '#e3b40f'], blau: ['Blau', '#1d4fbf'] };
const LIGHTS = { halogen: ['Halogen', '#ffe2a8'], xenon: ['Xenon', '#dfeaff'], gelb: ['Gelb (Frankreich)', '#ffd23f'] };
const PRESETS = {
  serie: { drop: 0, track: 0, camber: 0 },
  sport: { drop: 40, track: 15, camber: 1.5 },
  stance: { drop: 90, track: 35, camber: 6 }
};
const DEFAULTS = {
  paint: '#a9b0b7', finish: 'metallic', rim: 'gulli', rimSize: 15, rimColor: 'silber',
  drop: 0, track: 0, camber: 0, tint: 25, spoiler: false, caliper: 'serie', light: 'halogen'
};
const STORAGE_KEY = 'sgs_tuning_prototype';

let config = { ...DEFAULTS };
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  if (saved) config = { ...DEFAULTS, ...saved };
} catch (e) { /* ohne gespeicherte Konfiguration starten */ }
function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)); } catch (e) { /* egal */ }
}

/* ---------------- Renderer & Szene ---------------- */
const stage = document.getElementById('stage');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
} catch (e) {
  document.getElementById('webglError').style.display = 'flex';
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#07090c');
scene.fog = new THREE.Fog('#07090c', 12, 30);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
camera.position.set(6.2, 2.4, 6.2);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.7, 0);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 4;
controls.maxDistance = 16;
controls.minPolarAngle = 0.35;
controls.maxPolarAngle = Math.PI / 2 - 0.04;

// Licht: weiches Grundlicht + zwei Spots von oben + Kantenlicht von hinten
scene.add(new THREE.HemisphereLight('#9fb3c8', '#0b0d10', 0.35));
function addSpot(x, y, z, intensity) {
  const s = new THREE.SpotLight('#ffffff', intensity, 30, Math.PI / 6.5, 0.7, 1.4);
  s.position.set(x, y, z);
  s.castShadow = true;
  s.shadow.mapSize.set(1024, 1024);
  s.shadow.bias = -0.0004;
  scene.add(s);
  return s;
}
addSpot(4, 9, 4, 95);
addSpot(-5, 8, -2, 60);
const rimLight = new THREE.DirectionalLight('#f3a64a', 0.6);
rimLight.position.set(-6, 3, -6);
scene.add(rimLight);

// Boden + Drehscheibe mit leuchtendem Ring in SGS-Amber
const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.MeshStandardMaterial({ color: '#07090c', roughness: 0.6, metalness: 0.2 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const turntable = new THREE.Group();
scene.add(turntable);
const disc = new THREE.Mesh(new THREE.CylinderGeometry(3.3, 3.3, 0.06, 96), new THREE.MeshStandardMaterial({ color: '#101318', roughness: 0.45, metalness: 0.5 }));
disc.position.y = 0.03;
disc.receiveShadow = true;
turntable.add(disc);
const ring = new THREE.Mesh(new THREE.TorusGeometry(3.3, 0.025, 8, 128), new THREE.MeshStandardMaterial({ color: '#f39c12', emissive: '#f39c12', emissiveIntensity: 1.1 }));
ring.rotation.x = Math.PI / 2;
ring.position.y = 0.06;
turntable.add(ring);
for (let i = 0; i < 24; i++) { // feine Rillen auf der Scheibe
  const a = (i / 24) * Math.PI * 2;
  const line = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.004, 0.012), new THREE.MeshStandardMaterial({ color: '#232a33', roughness: 0.6 }));
  line.position.set(Math.cos(a) * 1.9, 0.062, Math.sin(a) * 1.9);
  line.rotation.y = -a;
  turntable.add(line);
}

/* ---------------- Materialien ---------------- */
const paintMat = new THREE.MeshPhysicalMaterial({ color: config.paint });
const trimMat = new THREE.MeshStandardMaterial({ color: '#2a2e33', roughness: 0.75, metalness: 0.1 });
const chromeMat = new THREE.MeshStandardMaterial({ color: '#e8ecef', roughness: 0.08, metalness: 1 });
const glassMat = new THREE.MeshPhysicalMaterial({ color: '#05080b', roughness: 0.04, metalness: 0.4, transparent: true, clearcoat: 1 });
const headMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffe2a8', emissiveIntensity: 1.6 });
const tailMat = new THREE.MeshStandardMaterial({ color: '#4a0508', emissive: '#d0101c', emissiveIntensity: 1.3 });
const tireMat = new THREE.MeshStandardMaterial({ color: '#111214', roughness: 0.9 });
const rimMat = new THREE.MeshStandardMaterial({ color: '#c9ced3', roughness: 0.22, metalness: 0.92 });
const discMat = new THREE.MeshStandardMaterial({ color: '#7d838a', roughness: 0.35, metalness: 0.9 });
const caliperMat = new THREE.MeshStandardMaterial({ color: '#5a5f66', roughness: 0.4, metalness: 0.3 });

/* ---------------- Auto (Maße grob in Metern) ---------------- */
const WHEELBASE_HALF = 1.4;
const TIRE_R = 0.315;     // Außenradius Reifen (bleibt gleich, Felge wird größer)
const TIRE_W = 0.21;
const TRACK_HALF = 0.79;  // halbe Spurweite (Radmitte)

const car = new THREE.Group();
car.position.y = 0.06; // steht auf der Drehscheibe
turntable.add(car);
const body = new THREE.Group();
car.add(body);

function mesh(geo, mat, parent = body) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
function box(sx, sy, sz, x, y, z, mat, parent) {
  const m = mesh(new THREE.BoxGeometry(sx, sy, sz), mat, parent);
  m.position.set(x, y, z);
  return m;
}
// Dünner Balken zwischen zwei Punkten (für Dach-/Fenstersäulen)
function beam(a, b, thickness, depth, z, mat) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const m = box(len, thickness, depth, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z, mat);
  m.rotation.z = Math.atan2(dy, dx);
  return m;
}

// Unterbau: Seitenprofil mit Radausschnitten, in die Breite extrudiert
(function buildBody() {
  const s = new THREE.Shape();
  const archR = 0.42, sill = 0.33;
  s.moveTo(-2.36, sill);
  s.lineTo(-WHEELBASE_HALF - archR, sill);
  s.absarc(-WHEELBASE_HALF, TIRE_R, archR, Math.PI, 0, true);
  s.lineTo(WHEELBASE_HALF - archR, sill);
  s.absarc(WHEELBASE_HALF, TIRE_R, archR, Math.PI, 0, true);
  s.lineTo(2.36, sill);
  s.lineTo(2.42, 0.56);
  s.lineTo(2.36, 0.79);
  s.lineTo(1.12, 0.87);
  s.lineTo(-1.92, 0.89);
  s.lineTo(-2.34, 0.85);
  s.lineTo(-2.42, 0.6);
  s.closePath();
  const depth = 1.64;
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.04, bevelSegments: 3, curveSegments: 24 });
  g.translate(0, 0, -depth / 2);
  mesh(g, paintMat);

  // Glaskabine + Dach + Säulen
  const c = new THREE.Shape();
  c.moveTo(1.1, 0.88);
  c.lineTo(0.32, 1.37);
  c.lineTo(-0.98, 1.39);
  c.lineTo(-1.82, 0.9);
  c.closePath();
  const cd = 1.42;
  const cg = new THREE.ExtrudeGeometry(c, { depth: cd, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 });
  cg.translate(0, 0, -cd / 2);
  const cabin = mesh(cg, glassMat);
  cabin.castShadow = false;
  box(1.36, 0.05, 1.5, -0.33, 1.41, 0, paintMat);                     // Dach
  for (const z of [-0.74, 0.74]) {
    beam([1.1, 0.88], [0.32, 1.39], 0.07, 0.06, z, paintMat);         // A-Säule
    beam([-0.98, 1.39], [-1.82, 0.9], 0.1, 0.06, z, paintMat);        // C-Säule
    box(0.09, 0.52, 0.06, -0.28, 1.13, z, paintMat);                  // B-Säule
    box(0.16, 0.09, 0.07, 0.92, 1.0, z * 1.24, paintMat);             // Spiegel
  }

  // Stoßfänger, Flankenschutz, Grill, Lichter
  box(0.16, 0.22, 1.78, 2.44, 0.43, 0, trimMat);
  box(0.16, 0.22, 1.78, -2.44, 0.45, 0, trimMat);
  for (const z of [-0.86, 0.86]) {
    box(0.52, 0.13, 0.05, -2.08, 0.42, z, trimMat);
    box(1.94, 0.13, 0.05, 0, 0.42, z, trimMat);
    box(0.52, 0.13, 0.05, 2.08, 0.42, z, trimMat);
    box(3.6, 0.012, 0.02, 0.1, 0.62, z * 1.005, chromeMat);           // Zierleiste
  }
  box(0.05, 0.2, 0.42, 2.45, 0.64, 0, chromeMat);                     // Grill-Rahmen
  box(0.04, 0.16, 0.36, 2.46, 0.64, 0, trimMat);
  for (const z of [-0.57, 0.57]) {
    box(0.05, 0.17, 0.46, 2.43, 0.64, z, headMat);                     // Scheinwerfer
    box(0.05, 0.08, 0.14, 2.44, 0.43, z * 1.18, headMat);              // Nebel
    box(0.05, 0.17, 0.5, -2.43, 0.68, z, tailMat);                     // Rückleuchten
  }
})();

// Heckspoiler (ein-/ausblendbar)
const spoiler = new THREE.Group();
body.add(spoiler);
box(0.34, 0.04, 1.54, -2.12, 0.99, 0, paintMat, spoiler);
for (const z of [-0.55, 0.55]) box(0.06, 0.09, 0.05, -2.08, 0.93, z, paintMat, spoiler);

/* ---------------- Räder ---------------- */
// Reifen als Rotationskörper; Felge je nach Design aus Grundformen
function buildTire(rimR) {
  const pts = [
    [rimR, -TIRE_W / 2], [TIRE_R - 0.035, -TIRE_W / 2], [TIRE_R, -TIRE_W / 2 + 0.035],
    [TIRE_R, TIRE_W / 2 - 0.035], [TIRE_R - 0.035, TIRE_W / 2], [rimR, TIRE_W / 2]
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(pts, 48);
  g.rotateX(Math.PI / 2);
  return g;
}
function spokeBox(len, width, depth, angle, r0, z, parent) {
  const m = mesh(new THREE.BoxGeometry(len, width, depth), rimMat, parent);
  m.position.set(Math.cos(angle) * (r0 + len / 2), Math.sin(angle) * (r0 + len / 2), z);
  m.rotation.z = angle;
  return m;
}
function buildRimFace(design, rimR, parent) {
  const face = TIRE_W / 2 - 0.02;
  const hub = mesh(new THREE.CylinderGeometry(rimR * 0.2, rimR * 0.22, 0.05, 24), rimMat, parent);
  hub.rotation.x = Math.PI / 2;
  hub.position.z = face;
  if (design === 'gulli') {
    // flache Scheibe mit 8 runden Löchern
    const s = new THREE.Shape();
    s.absarc(0, 0, rimR * 0.96, 0, Math.PI * 2, false);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const h = new THREE.Path();
      h.absarc(Math.cos(a) * rimR * 0.62, Math.sin(a) * rimR * 0.62, rimR * 0.15, 0, Math.PI * 2, true);
      s.holes.push(h);
    }
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 20 });
    const m = mesh(g, rimMat, parent);
    m.position.z = face - 0.03;
  } else if (design === 'five') {
    for (let i = 0; i < 5; i++) spokeBox(rimR * 0.8, rimR * 0.2, 0.035, (i / 5) * Math.PI * 2 + Math.PI / 2, rimR * 0.15, face, parent);
  } else if (design === 'mesh') {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      spokeBox(rimR * 0.84, 0.014, 0.025, a + 0.22, rimR * 0.12, face, parent);
      spokeBox(rimR * 0.84, 0.014, 0.025, a - 0.22, rimR * 0.12, face - 0.008, parent);
    }
    const ring2 = mesh(new THREE.TorusGeometry(rimR * 0.55, 0.008, 6, 48), rimMat, parent);
    ring2.position.z = face;
  } else if (design === 'dish') {
    const lip = mesh(new THREE.RingGeometry(rimR * 0.72, rimR, 48), chromeMat, parent);
    lip.position.z = face + 0.012;
    for (let i = 0; i < 8; i++) spokeBox(rimR * 0.58, rimR * 0.1, 0.03, (i / 8) * Math.PI * 2, rimR * 0.15, face - 0.05, parent);
  } else if (design === 'yspoke') {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 2;
      spokeBox(rimR * 0.42, rimR * 0.16, 0.035, a, rimR * 0.15, face, parent);
      spokeBox(rimR * 0.4, rimR * 0.1, 0.03, a + 0.18, rimR * 0.52, face, parent);
      spokeBox(rimR * 0.4, rimR * 0.1, 0.03, a - 0.18, rimR * 0.52, face, parent);
    }
  }
}
function buildWheel() {
  const rimR = (config.rimSize * 0.0254) / 2 + 0.02; // Zoll -> Felgenradius inkl. Horn
  const wheel = new THREE.Group();
  const spin = new THREE.Group();           // dreht sich beim Fahren nicht - nur zur Strukturierung
  wheel.add(spin);
  mesh(buildTire(rimR), tireMat, spin);
  const barrel = mesh(new THREE.CylinderGeometry(rimR, rimR, TIRE_W * 0.92, 40, 1, true), rimMat, spin);
  barrel.rotation.x = Math.PI / 2;
  barrel.material = rimMat;
  const lip = mesh(new THREE.TorusGeometry(rimR, 0.012, 8, 48), rimMat, spin);
  lip.position.z = TIRE_W / 2 - 0.01;
  buildRimFace(config.rim, rimR, spin);
  // Bremse hinter der Felge
  const bd = mesh(new THREE.CylinderGeometry(rimR * 0.78, rimR * 0.78, 0.025, 36), discMat, wheel);
  bd.rotation.x = Math.PI / 2;
  bd.position.z = -0.03;
  const cal = mesh(new THREE.BoxGeometry(rimR * 0.5, rimR * 0.32, 0.07), caliperMat, wheel);
  cal.position.set(-rimR * 0.62, rimR * 0.3, 0.0);
  cal.rotation.z = 0.5;
  return wheel;
}
const wheels = [];
function rebuildWheels() {
  wheels.forEach(w => { car.remove(w.mount); w.mount.traverse(o => { if (o.geometry) o.geometry.dispose(); }); });
  wheels.length = 0;
  for (const x of [WHEELBASE_HALF, -WHEELBASE_HALF]) {
    for (const side of [1, -1]) {
      const mount = new THREE.Group();     // Position am Auto
      const camber = new THREE.Group();    // Sturz
      mount.add(camber);
      mount.scale.z = side;                // linke Seite gespiegelt -> Felge zeigt immer nach außen
      camber.add(buildWheel());
      car.add(mount);
      wheels.push({ mount, camber, x, side });
    }
  }
  applyChassis(true);
}

/* ---------------- Anwenden der Konfiguration ---------------- */
const live = { drop: config.drop, track: config.track, camber: config.camber };
function applyChassis(immediate) {
  if (immediate) Object.assign(live, { drop: config.drop, track: config.track, camber: config.camber });
  body.position.y = -live.drop / 1000;
  wheels.forEach(w => {
    w.mount.position.set(w.x, TIRE_R, w.side * (TRACK_HALF + live.track / 1000));
    w.camber.rotation.x = -THREE.MathUtils.degToRad(live.camber);
  });
}
function applyPaint() {
  const f = FINISHES[config.finish] || FINISHES.metallic;
  paintMat.color.set(config.paint);
  Object.assign(paintMat, { metalness: f.metalness, roughness: f.roughness, clearcoat: f.clearcoat, clearcoatRoughness: f.clearcoatRoughness });
  applyRimColor();
}
function applyRimColor() {
  const c = RIM_COLORS[config.rimColor] || RIM_COLORS.silber;
  rimMat.color.set(c[1] || config.paint);
  rimMat.roughness = config.rimColor === 'chrom' ? 0.05 : config.rimColor === 'schwarz' || config.rimColor === 'anthrazit' ? 0.45 : 0.22;
  rimMat.metalness = config.rimColor === 'wagenfarbe' ? (FINISHES[config.finish] || FINISHES.metallic).metalness : 0.92;
}
function applyExtras() {
  glassMat.opacity = 0.72 + (config.tint / 90) * 0.26;
  spoiler.visible = !!config.spoiler;
  caliperMat.color.set((CALIPERS[config.caliper] || CALIPERS.serie)[1]);
  headMat.emissive.set((LIGHTS[config.light] || LIGHTS.halogen)[1]);
}
function applyAll() {
  applyPaint();
  applyExtras();
  rebuildWheels();
}

/* ---------------- Bedienelemente ---------------- */
const $ = id => document.getElementById(id);
function chipGroup(containerId, options, key, onChange) {
  const el = $(containerId);
  el.innerHTML = '';
  Object.entries(options).forEach(([value, label]) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = Array.isArray(label) ? label[0] : label;
    b.dataset.value = value;
    b.onclick = () => { config[key] = isNaN(+value) || typeof config[key] === 'string' ? value : +value; onChange(); syncUi(); persist(); };
    el.appendChild(b);
  });
}
function rimIconSvg(design) {
  const ring = '<circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="24" cy="24" r="4" fill="currentColor"/>';
  let inner = '';
  if (design === 'gulli') for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; inner += `<circle cx="${24 + Math.cos(a) * 11}" cy="${24 + Math.sin(a) * 11}" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/>`; }
  if (design === 'five') for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2 - Math.PI / 2; inner += `<line x1="24" y1="24" x2="${24 + Math.cos(a) * 18}" y2="${24 + Math.sin(a) * 18}" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>`; }
  if (design === 'mesh') for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; inner += `<line x1="${24 + Math.cos(a + 0.5) * 5}" y1="${24 + Math.sin(a + 0.5) * 5}" x2="${24 + Math.cos(a) * 18}" y2="${24 + Math.sin(a) * 18}" stroke="currentColor" stroke-width="1.2"/>`; }
  if (design === 'dish') { inner += '<circle cx="24" cy="24" r="15" fill="none" stroke="currentColor" stroke-width="5"/>'; for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; inner += `<line x1="24" y1="24" x2="${24 + Math.cos(a) * 11}" y2="${24 + Math.sin(a) * 11}" stroke="currentColor" stroke-width="2"/>`; } }
  if (design === 'yspoke') for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 - Math.PI / 2; const mx = 24 + Math.cos(a) * 9, my = 24 + Math.sin(a) * 9; inner += `<line x1="24" y1="24" x2="${mx}" y2="${my}" stroke="currentColor" stroke-width="3"/><line x1="${mx}" y1="${my}" x2="${24 + Math.cos(a + 0.25) * 18}" y2="${24 + Math.sin(a + 0.25) * 18}" stroke="currentColor" stroke-width="2"/><line x1="${mx}" y1="${my}" x2="${24 + Math.cos(a - 0.25) * 18}" y2="${24 + Math.sin(a - 0.25) * 18}" stroke="currentColor" stroke-width="2"/>`; }
  return `<svg viewBox="0 0 48 48">${ring}${inner}</svg>`;
}
function buildUi() {
  const sw = $('paintSwatches');
  sw.innerHTML = '';
  PAINTS.forEach(([name, hex]) => {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.style.background = hex;
    b.title = name;
    b.dataset.value = hex;
    b.onclick = () => { config.paint = hex; applyPaint(); syncUi(); persist(); toast(name); };
    sw.appendChild(b);
  });
  const custom = document.createElement('label');
  custom.className = 'swatch custom';
  custom.title = 'Eigene Farbe';
  custom.innerHTML = '<input type="color">';
  custom.querySelector('input').oninput = e => { config.paint = e.target.value; applyPaint(); syncUi(); persist(); };
  sw.appendChild(custom);

  chipGroup('finishChips', Object.fromEntries(Object.entries(FINISHES).map(([k, v]) => [k, v.label])), 'finish', applyPaint);

  const rd = $('rimDesigns');
  rd.innerHTML = '';
  Object.entries(RIM_DESIGNS).forEach(([key, label]) => {
    const b = document.createElement('button');
    b.className = 'rim-card';
    b.dataset.value = key;
    b.innerHTML = rimIconSvg(key) + `<span>${label}</span>`;
    b.onclick = () => { config.rim = key; rebuildWheels(); syncUi(); persist(); };
    rd.appendChild(b);
  });
  chipGroup('rimSizes', Object.fromEntries(RIM_SIZES.map(s => [s, `${s}"`])), 'rimSize', rebuildWheels);
  chipGroup('rimColors', RIM_COLORS, 'rimColor', applyRimColor);
  chipGroup('spoilerChips', { aus: 'Ohne', an: 'Mit Spoiler' }, 'spoilerChoice', () => { config.spoiler = config.spoilerChoice === 'an'; delete config.spoilerChoice; applyExtras(); });
  chipGroup('caliperChips', CALIPERS, 'caliper', applyExtras);
  chipGroup('lightChips', LIGHTS, 'light', applyExtras);

  for (const key of ['drop', 'track', 'camber', 'tint']) {
    $(key).oninput = e => {
      config[key] = parseFloat(e.target.value);
      if (key === 'tint') applyExtras();
      syncUi();
      persist();
    };
  }
  document.querySelectorAll('[data-preset]').forEach(b => {
    b.onclick = () => { Object.assign(config, PRESETS[b.dataset.preset]); syncUi(); persist(); };
  });
  $('btnRandom').onclick = () => {
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    Object.assign(config, {
      paint: pick(PAINTS)[1], finish: pick(Object.keys(FINISHES)), rim: pick(Object.keys(RIM_DESIGNS)),
      rimSize: pick(RIM_SIZES), rimColor: pick(Object.keys(RIM_COLORS)), drop: pick([0, 30, 50, 70, 90]),
      track: pick([0, 10, 20, 30]), camber: pick([0, 1, 2.5, 5]), tint: pick([10, 40, 70, 90]),
      spoiler: Math.random() > 0.5, caliper: pick(Object.keys(CALIPERS)), light: pick(Object.keys(LIGHTS))
    });
    applyAll(); syncUi(); persist(); toast('Zufalls-Setup');
  };
  $('btnReset').onclick = () => { config = { ...DEFAULTS }; applyAll(); syncUi(); persist(); toast('Serienzustand'); };

  document.querySelectorAll('.tab').forEach(t => {
    t.onclick = () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
      document.querySelectorAll('.section').forEach(s => s.classList.toggle('active', s.id === 'sec-' + t.dataset.tab));
    };
  });
}
function syncUi() {
  const mark = (id, value) => $(id).querySelectorAll('[data-value]').forEach(b => b.classList.toggle('active', String(b.dataset.value) === String(value)));
  mark('paintSwatches', config.paint);
  mark('finishChips', config.finish);
  mark('rimDesigns', config.rim);
  mark('rimSizes', config.rimSize);
  mark('rimColors', config.rimColor);
  mark('spoilerChips', config.spoiler ? 'an' : 'aus');
  mark('caliperChips', config.caliper);
  mark('lightChips', config.light);
  $('rimSizeVal').textContent = `${config.rimSize} Zoll`;
  for (const [key, unit] of [['drop', ' mm'], ['track', ' mm'], ['camber', '°'], ['tint', ' %']]) {
    $(key).value = config[key];
    $(key + 'Val').textContent = (key === 'camber' && config[key] > 0 ? '−' : '') + String(config[key]).replace('.', ',') + unit;
  }
}
let toastTimer = null;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1400);
}

// Drehscheibe: dreht automatisch, bis man selbst anfasst
let spinning = true;
$('btnSpin').onclick = () => { spinning = !spinning; $('btnSpin').classList.toggle('active', spinning); };
renderer.domElement.addEventListener('pointerdown', () => { spinning = false; $('btnSpin').classList.remove('active'); });

// Bild speichern (teilen, wenn möglich - sonst herunterladen)
$('btnShot').onclick = () => {
  renderer.render(scene, camera);
  renderer.domElement.toBlob(async blob => {
    if (!blob) return;
    const file = new File([blob], `sgs-tuning-${Date.now()}.png`, { type: 'image/png' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Mein Tuning-Setup' });
        return;
      }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('Bild gespeichert');
  }, 'image/png');
};

/* ---------------- Größe & Animationsschleife ---------------- */
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // Bedienleiste verdeckt unten (Handy) bzw. rechts (Desktop) einen Teil des
  // Bildes -> Auto entsprechend höher bzw. weiter links ins Bild rücken
  if (w >= 900) camera.setViewOffset(w, h, 170, 0, w, h);
  else camera.setViewOffset(w, h, 0, h * 0.16, w, h);
  camera.updateProjectionMatrix();
  // Abstand so wählen, dass das ganze Auto (ca. 5,2 m) ins Bild passt - im
  // Hochformat muss die Kamera deutlich weiter weg
  const hFov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const dist = THREE.MathUtils.clamp(Math.max(3.3 / Math.tan(hFov / 2), 2.4 / Math.tan(vFov / 2)), 8, 15);
  const dir = camera.position.clone().sub(controls.target).normalize();
  camera.position.copy(controls.target).addScaledVector(dir, dist);
}
window.addEventListener('resize', resize);

const clock = new THREE.Clock();
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (spinning) turntable.rotation.y += dt * 0.35;
  // Fahrwerk sanft nachführen (wie ein Luftfahrwerk)
  const k = 1 - Math.pow(0.002, dt);
  for (const key of ['drop', 'track', 'camber']) {
    const diff = config[key] - live[key];
    if (Math.abs(diff) > 0.01) live[key] += diff * k; else live[key] = config[key];
  }
  applyChassis(false);
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

buildUi();
applyAll();
syncUi();
resize();
tick();
window.__tuning = { get config() { return config; }, scene }; // für Tests
