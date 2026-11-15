/* --- SYNC MIT POCKETBASE (mehrere Geräte, geteilte Fahrzeuge) ---
   Offline zuerst: Alles bleibt wie bisher lokal in IndexedDB. Ist ein Konto
   angemeldet, gleicht die App beim Start, nach Änderungen (kurz verzögert),
   beim Zurückkehren in die App und regelmäßig mit dem Server ab.

   Server-Collections (siehe server/pocketbase-collections.json):
   - sgs_vehicles:          ein Datensatz je Fahrzeug (owner, shared_with, vid, data)
   - sgs_customer_vehicles: ein Datensatz je Kundenfahrzeug (nur Besitzer)
   - sgs_user_settings:     Konto-Einstellungen (Tank-Deal, Rechnungsdaten)
   - sgs_images:            Fotos als Dateien; in den Daten steht nur "pbimg:<hash>"

   Abgleich je Datensatz als Drei-Wege-Merge (letzter gemeinsamer Stand =
   "base", lokal, Server): Änderungen beider Seiten bleiben erhalten, Listen
   mit IDs (Tankungen, Wartungen, ...) werden eintragsweise zusammengeführt,
   Löschungen erkannt. Nur wenn derselbe Wert auf beiden Seiten geändert
   wurde, gewinnt dieses Gerät.

   Login-Token & Sync-Stand liegen bewusst NICHT in appData (sonst stünden
   sie in jedem Backup), sondern unter eigenem IndexedDB-Schlüssel. */

const SYNC_DEFAULT_URL = 'https://heimserver.tail8f2780.ts.net';
const SYNC_STATE_KEY = 'sgs_sync_state';
const SYNC_DEBOUNCE_MS = 2500;
const SYNC_INTERVAL_MS = 60000;

let syncState = null;          // siehe createSyncState()
let syncRunning = false;
let syncQueued = false;
let syncDebounceTimer = null;
let syncStatus = 'off';        // off | ok | busy | offline | error | login
let syncStatusText = '';
let syncUiRefreshPending = false;
let syncUsersCache = null;
const syncHashCache = new Map(); // dataURL -> Hash (nur im Speicher)

// Server-Adresse vereinheitlichen: Leerzeichen, abschließende "/" und eine
// versehentlich mitkopierte Admin-Adresse ("/_/") entfernen, https ergänzen
function normalizeSyncUrl(url) {
  let u = String(url || SYNC_DEFAULT_URL).trim();
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  u = u.replace(/#.*$/, '').replace(/\/_\/?.*$/, '').replace(/\/+$/, '');
  return u;
}

function createSyncState(url) {
  return {
    url: normalizeSyncUrl(url),
    token: null,
    user: null,               // { id, name, email, gast }
    lastSync: null,
    needsInitialMerge: true,  // erster Abgleich nach Login/Import: nur zusammenführen, nichts löschen
    rec: { vehicles: {}, customers: {}, settings: null }, // lokale ID -> { id, owner, shared_with }
    base: { vehicles: {}, customers: {}, settings: null }, // Datensatz-ID -> letzter gemeinsamer Stand
    images: {}                // Hash -> { id, file }
  };
}

async function loadSyncState() {
  try {
    const saved = await sgsIdbGet(SYNC_STATE_KEY);
    syncState = saved && saved.token ? saved : null;
  } catch (e) {
    syncState = null;
  }
  return !!syncState;
}

function saveSyncState() {
  return sgsIdbSet(SYNC_STATE_KEY, syncState).catch(e => console.error('Sync-Stand konnte nicht gespeichert werden:', e));
}

function isSyncLoggedIn() {
  return !!(syncState && syncState.token);
}

function isSyncGuest() {
  return !!(syncState && syncState.user && syncState.user.gast);
}

/* --- HTTP --- */
async function pbFetch(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (syncState && syncState.token && !opts.noAuth) headers.Authorization = syncState.token;
  let body = opts.body;
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.json);
  }
  let res;
  try {
    res = await fetch(syncState.url + path, { method: opts.method || 'GET', headers, body });
  } catch (e) {
    // Netzwerk-Ebene: Server aus, kein Tailscale, oder der Browser blockiert den Zugriff
    throw Object.assign(new Error('Keine Verbindung (' + (e && e.message ? e.message : e) + ')'), { offline: true });
  }
  if (opts.raw) {
    if (!res.ok) throw Object.assign(new Error('HTTP ' + res.status), { status: res.status });
    return res;
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
  if (!res.ok) {
    throw Object.assign(new Error((data && data.message) || ('HTTP ' + res.status)), { status: res.status, data });
  }
  return data;
}

async function pbListAll(collection, params = '') {
  const items = [];
  for (let page = 1; page < 100; page++) {
    const r = await pbFetch(`/api/collections/${collection}/records?perPage=200&page=${page}${params}`);
    items.push(...r.items);
    if (page >= r.totalPages) break;
  }
  return items;
}

// Jede Änderung bekommt eine neue Revision; der Server nimmt eine Änderung nur
// an, wenn base_rev der aktuellen Revision entspricht (sonst 404 = Konflikt)
function syncNewRev() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Schreiben genau zwei Geräte im selben Moment, kann die Prüfung auf dem
// Server beide durchlassen - daher kurz danach nachlesen, ob die eigene
// Version noch gilt; sonst wird neu zusammengeführt
async function pbUpdateWithRev(collection, record, body) {
  const conflict = () => Object.assign(new Error('Konflikt: Datensatz wurde gerade woanders geändert'), { syncConflict: true });
  const rev = syncNewRev();
  let saved;
  try {
    saved = await pbFetch(`/api/collections/${collection}/records/${record.id}`, {
      method: 'PATCH', json: { ...body, rev, base_rev: record.rev || '' }
    });
  } catch (e) {
    if (e.status === 404) throw conflict();
    throw e;
  }
  await new Promise(r => setTimeout(r, 400));
  const check = await pbFetch(`/api/collections/${collection}/records/${record.id}?fields=rev`);
  if (!check || check.rev !== rev) throw conflict();
  return saved;
}

function pbFilter(expr) {
  return '&filter=' + encodeURIComponent(expr);
}

/* --- Vergleichen & Zusammenführen --- */
function syncStable(v) {
  if (v === undefined) return undefined;
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(x => (x === undefined ? 'null' : syncStable(x))).join(',') + ']';
  return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + syncStable(v[k])).join(',') + '}';
}

function syncEqual(a, b) {
  return syncStable(a) === syncStable(b);
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isIdList(a) {
  return Array.isArray(a) && a.length > 0 && a.every(x => isPlainObject(x) && x.id !== undefined && x.id !== null);
}

// Drei-Wege-Merge: base = letzter gemeinsamer Stand (undefined = unbekannt).
// Echter Konflikt (beide Seiten haben denselben Wert geändert): dieses Gerät
// gewinnt - außer es gibt noch keinen gemeinsamen Stand (erster Abgleich,
// eingespieltes Backup): dann gilt der Server, damit nichts Veraltetes gewinnt.
function syncMerge3(base, local, remote) {
  if (syncEqual(local, remote)) return local;
  if (base !== undefined && syncEqual(local, base)) return remote;
  if (base !== undefined && syncEqual(remote, base)) return local;
  const listy = x => x === undefined || Array.isArray(x);
  if (listy(local) && listy(remote) && listy(base) && (isIdList(local) || isIdList(remote) || isIdList(base))) {
    return syncMergeIdList(base || [], local || [], remote || []);
  }
  if (isPlainObject(local) && isPlainObject(remote)) {
    const b = isPlainObject(base) ? base : {};
    const out = {};
    new Set([...Object.keys(remote), ...Object.keys(local)]).forEach(k => {
      const m = syncMerge3(isPlainObject(base) ? b[k] : undefined, local[k], remote[k]);
      if (m !== undefined) out[k] = m;
    });
    return out;
  }
  if (base === undefined) return (remote === undefined || remote === null) ? local : remote;
  return local;
}

function syncMergeIdList(base, local, remote) {
  const key = x => String(x.id);
  const B = new Map(base.filter(isPlainObject).map(x => [key(x), x]));
  const L = new Map(local.filter(isPlainObject).map(x => [key(x), x]));
  const R = new Map(remote.filter(isPlainObject).map(x => [key(x), x]));
  const order = [...R.keys(), ...[...L.keys()].filter(k => !R.has(k))];
  const out = [];
  order.forEach(k => {
    const b = B.get(k), l = L.get(k), r = R.get(k);
    if (l && r) out.push(syncMerge3(b, l, r));
    else if (l) { if (!(b && syncEqual(l, b))) out.push(l); }      // auf dem Server gelöscht?
    else if (r) { if (!(b && syncEqual(r, b))) out.push(r); }      // hier gelöscht?
  });
  return out;
}

/* --- Bilder: lokal Data-URLs, auf dem Server Dateien --- */
async function syncHash(str) {
  if (syncHashCache.has(str)) return syncHashCache.get(str);
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
  syncHashCache.set(str, hex);
  return hex;
}

// Ersetzt alle Bild-Data-URLs durch "pbimg:<hash>" und sammelt sie in images
async function syncToRemoteForm(value, images) {
  if (typeof value === 'string') {
    if (value.startsWith('data:image/')) {
      const h = await syncHash(value);
      images.set(h, value);
      return 'pbimg:' + h;
    }
    return value;
  }
  if (Array.isArray(value)) {
    const out = [];
    for (const x of value) out.push(await syncToRemoteForm(x, images));
    return out;
  }
  if (isPlainObject(value)) {
    const out = {};
    for (const k of Object.keys(value)) out[k] = await syncToRemoteForm(value[k], images);
    return out;
  }
  return value;
}

async function syncFromRemoteForm(value, known) {
  if (typeof value === 'string') {
    if (value.startsWith('pbimg:')) {
      const h = value.slice(6);
      if (!known.has(h)) {
        try { known.set(h, await syncDownloadImage(h)); } catch (e) { console.warn('Bild konnte nicht geladen werden:', h, e); }
      }
      return known.get(h) || value; // Bild nicht ladbar -> Verweis behalten, nächster Sync versucht es erneut
    }
    return value;
  }
  if (Array.isArray(value)) {
    const out = [];
    for (const x of value) out.push(await syncFromRemoteForm(x, known));
    return out;
  }
  if (isPlainObject(value)) {
    const out = {};
    for (const k of Object.keys(value)) out[k] = await syncFromRemoteForm(value[k], known);
    return out;
  }
  return value;
}

async function syncLookupImages(hashes) {
  const missing = hashes.filter(h => !syncState.images[h]);
  for (let i = 0; i < missing.length; i += 25) {
    const chunk = missing.slice(i, i + 25);
    const items = await pbListAll('sgs_images', pbFilter(chunk.map(h => `hash='${h}'`).join(' || ')) + '&fields=id,hash,file');
    items.forEach(it => { syncState.images[it.hash] = { id: it.id, file: it.file }; });
  }
}

async function syncUploadImages(images) {
  const hashes = [...images.keys()].filter(h => !syncState.images[h]);
  if (hashes.length === 0) return;
  await syncLookupImages(hashes);
  for (const h of hashes) {
    if (syncState.images[h]) continue;
    const dataUrl = images.get(h);
    const blob = await (await fetch(dataUrl)).blob();
    const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    const form = new FormData();
    form.append('owner', syncState.user.id);
    form.append('hash', h);
    form.append('file', blob, `${h}.${ext}`);
    const rec = await pbFetch('/api/collections/sgs_images/records', { method: 'POST', body: form });
    syncState.images[h] = { id: rec.id, file: rec.file };
  }
}

let syncFileToken = null;
async function syncDownloadImage(hash) {
  if (!syncState.images[hash]) await syncLookupImages([hash]);
  const info = syncState.images[hash];
  if (!info) throw new Error('Bild nicht auf dem Server');
  if (!syncFileToken || Date.now() - syncFileToken.at > 90000) {
    const r = await pbFetch('/api/files/token', { method: 'POST' });
    syncFileToken = { token: r.token, at: Date.now() };
  }
  const res = await pbFetch(`/api/files/sgs_images/${info.id}/${encodeURIComponent(info.file)}?token=${syncFileToken.token}`, { raw: true, noAuth: true });
  const blob = await res.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/* --- Anmelden / Abmelden --- */
function syncPickUser(rec) {
  return { id: rec.id, name: rec.name || '', email: rec.email || '', gast: !!rec.gast };
}

async function syncLogin(url, email, password) {
  syncState = createSyncState(url);
  try {
    const r = await pbFetch('/api/collections/users/auth-with-password', { method: 'POST', json: { identity: email, password }, noAuth: true });
    syncState.token = r.token;
    syncState.user = syncPickUser(r.record);
  } catch (e) {
    syncState = null;
    throw e;
  }
  await saveSyncState();
  applySyncGuestMode();
  updateSyncIndicator();
  await runSync({ manual: true });
}

async function syncLogout() {
  if (!confirm('Abmelden? Die Daten bleiben auf diesem Gerät erhalten, werden aber nicht mehr abgeglichen.')) return;
  syncState = null;
  syncStatus = 'off';
  syncUsersCache = null;
  try { await sgsIdbDelete(SYNC_STATE_KEY); } catch (e) { /* egal */ }
  applySyncGuestMode();
  updateSyncIndicator();
  renderSyncSettings();
  renderVehicleShareCard();
}
window.syncLogout = syncLogout;

async function syncRefreshAuth() {
  // Token regelmäßig erneuern (Standard-Laufzeit bei PocketBase: 7 Tage)
  if (syncState.lastRefresh && Date.now() - syncState.lastRefresh < 12 * 3600 * 1000) return;
  const r = await pbFetch('/api/collections/users/auth-refresh', { method: 'POST' });
  syncState.token = r.token;
  syncState.user = syncPickUser(r.record);
  syncState.lastRefresh = Date.now();
}

// Nach Backup-Import oder "Alle Daten löschen": Zuordnung vergessen, beim
// nächsten Abgleich nur zusammenführen (sonst würden Server-Daten gelöscht)
function syncResetMapping() {
  if (!syncState) return;
  syncState.rec = { vehicles: {}, customers: {}, settings: null };
  syncState.base = { vehicles: {}, customers: {}, settings: null };
  syncState.needsInitialMerge = true;
  saveSyncState();
}

/* --- Der eigentliche Abgleich --- */
function scheduleSync() {
  if (!isSyncLoggedIn()) return;
  clearTimeout(syncDebounceTimer);
  // leicht gestreut, damit mehrere Geräte nicht exakt gleichzeitig schreiben
  syncDebounceTimer = setTimeout(() => runSync(), SYNC_DEBOUNCE_MS + Math.random() * 1500);
}

async function runSync(opts = {}) {
  if (!isSyncLoggedIn()) return;
  if (syncRunning) { syncQueued = true; return; }
  syncRunning = true;
  setSyncStatus('busy', 'Gleiche ab …');
  try {
    await syncRefreshAuth();
    let changedLocal = false;
    for (let attempt = 1; ; attempt++) {
      try {
        changedLocal = (await syncAll(opts)) || changedLocal;
        break;
      } catch (e) {
        if (!e.syncConflict || attempt >= 4) throw e;
        await new Promise(r => setTimeout(r, 300 + Math.random() * 700)); // anderes Gerät war schneller
      }
    }
    syncState.lastSync = new Date().toISOString();
    syncState.needsInitialMerge = false;
    await saveSyncState();
    if (changedLocal) {
      saveData({ fromSync: true });
      refreshUiAfterSync();
    }
    setSyncStatus('ok', 'Synchron');
  } catch (e) {
    console.warn('Sync fehlgeschlagen:', e);
    if (e && e.status === 401) {
      setSyncStatus('login', 'Bitte neu anmelden');
    } else if (e && e.offline) {
      setSyncStatus('offline', 'Server nicht erreichbar – Änderungen bleiben gespeichert');
    } else {
      setSyncStatus('error', 'Fehler beim Abgleich: ' + (e && e.message ? e.message : e));
    }
    if (opts.manual) alert('Abgleich nicht möglich: ' + syncStatusText);
  } finally {
    syncRunning = false;
    if (syncQueued) { syncQueued = false; scheduleSync(); }
  }
}

// Unveränderte Demo-Daten (beim allerersten App-Start angelegt) nicht ins Konto übernehmen
function isUntouchedDemoData() {
  const vs = appData.vehicles || [];
  if (appData.firstChangeDate || vs.length !== 1 || (appData.customerVehicles || []).length > 0) return false;
  const v = vs[0];
  const ids = list => (list || []).map(x => x.id).join(',');
  // exakt das Beispielfahrzeug aus loadDefaultData() - echte Daten nie verwerfen
  return v.id === 'v1' && v.plate === 'KI-E 420' && ids(v.fuelEntries) === 'f1,f2' && ids(v.serviceEntries) === 's1' && !v.image;
}

async function syncAll(opts) {
  const me = syncState.user.id;
  let changed = false;
  const known = new Map(); // Hash -> Data-URL (aus lokalen Daten, spart Downloads)

  const [remoteVehicles, remoteCustomers, remoteSettings] = await Promise.all([
    pbListAll('sgs_vehicles'),
    syncState.user.gast ? Promise.resolve([]) : pbListAll('sgs_customer_vehicles'),
    pbListAll('sgs_user_settings')
  ]);

  // Erster Abgleich auf diesem Gerät: lokale Daten übernehmen oder verwerfen?
  if (syncState.needsInitialMerge && !syncState.lastSync) {
    if (isUntouchedDemoData()) {
      appData.vehicles = []; // Beispielfahrzeug vom ersten App-Start nicht ins Konto übernehmen
      changed = true;
    } else {
      const localCount = (appData.vehicles || []).length + (appData.customerVehicles || []).length;
      const remoteCount = remoteVehicles.length + remoteCustomers.length;
      if (localCount > 0 && remoteCount > 0 &&
          !confirm(`Auf diesem Gerät sind ${localCount} Fahrzeuge gespeichert, und in deinem Konto gibt es bereits Daten.\n\nOK = beides zusammenführen\nAbbrechen = Gerätedaten verwerfen und nur die Daten aus dem Konto verwenden`)) {
        appData.vehicles = [];
        appData.customerVehicles = [];
        changed = true;
      }
    }
  }

  changed = (await syncCollection({
    collection: 'sgs_vehicles', idField: 'vid', list: appData.vehicles || [], setList: l => { appData.vehicles = l; },
    remote: remoteVehicles, recMap: syncState.rec.vehicles, baseMap: syncState.base.vehicles, known, me,
    canDelete: r => r.owner === me, renameLocal: syncRenameLocalVehicle
  })) || changed;

  if (!syncState.user.gast) {
    changed = (await syncCollection({
      collection: 'sgs_customer_vehicles', idField: 'cid', list: appData.customerVehicles || [], setList: l => { appData.customerVehicles = l; },
      remote: remoteCustomers, recMap: syncState.rec.customers, baseMap: syncState.base.customers, known, me,
      canDelete: () => true, renameLocal: syncRenameLocalCustomer
    })) || changed;
  }

  changed = (await syncSettings(remoteSettings[0] || null, known)) || changed;

  // aktives Fahrzeug gültig halten
  if (!appData.vehicles.some(v => v.id === appData.activeVehicleId)) {
    appData.activeVehicleId = appData.vehicles[0] ? appData.vehicles[0].id : null;
  }
  if (appData.customerVehicles && !appData.customerVehicles.some(c => c.id === appData.activeCustomerVehicleId)) {
    appData.activeCustomerVehicleId = appData.customerVehicles[0] ? appData.customerVehicles[0].id : null;
  }
  return changed;
}

// Gleicht eine lokale Liste (Fahrzeuge bzw. Kundenfahrzeuge) mit einer Collection ab
async function syncCollection(c) {
  let changed = false;
  let list = c.list.slice();
  const remoteById = new Map(c.remote.map(r => [r.id, r]));
  const recIdOf = localId => (c.recMap[localId] ? c.recMap[localId].id : null);
  const mappedRecIds = new Set(Object.values(c.recMap).map(x => x.id));

  // 1. Neue Server-Datensätze zuordnen (gleiche ID & eigener Datensatz = dasselbe Fahrzeug)
  for (const r of c.remote) {
    if (mappedRecIds.has(r.id)) continue;
    const localId = r[c.idField];
    const local = list.find(x => x.id === localId);
    if (local && !c.recMap[localId] && r.owner === c.me) {
      c.recMap[localId] = { id: r.id, owner: r.owner, shared_with: r.shared_with || [] };
    } else {
      if (local) { // ID-Kollision mit einem fremden Fahrzeug -> lokales umbenennen
        const newId = localId + '_' + Math.random().toString(36).slice(2, 7);
        c.renameLocal(localId, newId, list);
        if (c.recMap[localId]) { c.recMap[newId] = c.recMap[localId]; delete c.recMap[localId]; }
      }
      const known = c.known;
      const data = await syncFromRemoteForm(r.data || {}, known);
      data.id = localId;
      list.push(data);
      c.recMap[localId] = { id: r.id, owner: r.owner, shared_with: r.shared_with || [] };
      c.baseMap[r.id] = r.data;
      changed = true;
    }
    mappedRecIds.add(r.id);
  }

  // Sicherheitsnetz: nie mehr als die Hälfte der eigenen Datensätze auf einmal löschen
  const ownRemote = c.remote.filter(r => r.owner === c.me);
  const toDelete = Object.entries(c.recMap).filter(([lid, m]) => !list.some(x => x.id === lid) && remoteById.has(m.id) && c.canDelete(remoteById.get(m.id)));
  if (toDelete.length > 1 && toDelete.length > ownRemote.length / 2 &&
      !confirm(`Beim Abgleich würden ${toDelete.length} Einträge auch auf dem Server gelöscht. Wirklich löschen?\n\nAbbrechen = vom Server wiederherstellen`)) {
    toDelete.forEach(([lid]) => { delete c.recMap[lid]; });
    return syncCollection({ ...c, list }); // erneut: gilt jetzt als "neu vom Server"
  }

  // 2. Lokale Einträge abgleichen
  const nextList = [];
  for (const local of list) {
    const map = c.recMap[local.id];
    const remoteData = await syncToRemoteForm(local, c.known);
    if (!map) {
      // neu auf diesem Gerät -> hochladen
      await syncUploadImages(c.known);
      const body = { owner: c.me, [c.idField]: local.id, data: remoteData, rev: syncNewRev() };
      const rec = await pbFetch(`/api/collections/${c.collection}/records`, { method: 'POST', json: body });
      c.recMap[local.id] = { id: rec.id, owner: rec.owner, shared_with: rec.shared_with || [] };
      c.baseMap[rec.id] = remoteData;
      nextList.push(local);
      continue;
    }
    const r = remoteById.get(map.id);
    if (!r) {
      // auf dem Server gelöscht bzw. Freigabe entzogen -> hier entfernen
      delete c.recMap[local.id];
      delete c.baseMap[map.id];
      changed = true;
      continue;
    }
    map.owner = r.owner;
    map.shared_with = r.shared_with || [];
    const merged = syncMerge3(c.baseMap[map.id], remoteData, r.data || {});
    if (!syncEqual(merged, r.data)) {
      await syncUploadImages(c.known);
      await pbUpdateWithRev(c.collection, r, { data: merged });
    }
    c.baseMap[map.id] = merged;
    if (!syncEqual(merged, remoteData)) {
      const restored = await syncFromRemoteForm(merged, c.known);
      restored.id = local.id;
      nextList.push(restored);
      changed = true;
    } else {
      nextList.push(local);
    }
  }

  // 3. Hier gelöschte Einträge auch auf dem Server löschen (nur eigene)
  for (const [lid, m] of Object.entries(c.recMap)) {
    if (nextList.some(x => x.id === lid)) continue;
    const r = remoteById.get(m.id);
    if (r && c.canDelete(r)) {
      try { await pbFetch(`/api/collections/${c.collection}/records/${m.id}`, { method: 'DELETE' }); } catch (e) { if (e.status !== 404) throw e; }
    }
    delete c.recMap[lid];
    delete c.baseMap[m.id];
  }

  if (changed || nextList.length !== c.list.length) c.setList(nextList);
  return changed;
}

function syncRenameLocalVehicle(oldId, newId, list) {
  list.forEach(v => {
    if (v.id === oldId) v.id = newId;
    if (v.belongsToId === oldId) v.belongsToId = newId;
  });
  if (appData.activeVehicleId === oldId) appData.activeVehicleId = newId;
}

function syncRenameLocalCustomer(oldId, newId, list) {
  list.forEach(c => { if (c.id === oldId) c.id = newId; });
  if (appData.activeCustomerVehicleId === oldId) appData.activeCustomerVehicleId = newId;
}

// Konto-Einstellungen: Tank-Deal & Rechnungsdaten gelten für alle Geräte des Kontos
async function syncSettings(remote, known) {
  const local = await syncToRemoteForm({ fuelDeal: appData.fuelDeal || null, businessInfo: appData.businessInfo || null }, known);
  if (!remote) {
    if (syncState.user.gast && !appData.fuelDeal) return false;
    const rec = await pbFetch('/api/collections/sgs_user_settings/records', { method: 'POST', json: { owner: syncState.user.id, data: local, rev: syncNewRev() } });
    syncState.rec.settings = rec.id;
    syncState.base.settings = local;
    return false;
  }
  syncState.rec.settings = remote.id;
  const merged = syncMerge3(syncState.base.settings || undefined, local, remote.data || {});
  if (!syncEqual(merged, remote.data)) {
    await pbUpdateWithRev('sgs_user_settings', remote, { data: merged });
  }
  syncState.base.settings = merged;
  if (syncEqual(merged, local)) return false;
  const restored = await syncFromRemoteForm(merged, known);
  if (restored.fuelDeal !== undefined) appData.fuelDeal = restored.fuelDeal || undefined;
  if (restored.businessInfo) appData.businessInfo = restored.businessInfo;
  return true;
}

/* --- Freigabe ("Teilen mit ...") --- */
async function syncLoadUsers(force) {
  if (syncUsersCache && !force) return syncUsersCache;
  const items = await pbListAll('users', '&fields=id,name,email,gast&sort=name');
  syncUsersCache = items.map(syncPickUser);
  return syncUsersCache;
}

function syncUserLabel(u) {
  return u ? (u.name || u.email || 'Unbekannt') : 'Unbekannt';
}

async function renderVehicleShareCard() {
  const card = document.getElementById('vehicleShareCard');
  if (!card) return;
  const v = getActiveVehicle();
  if (!isSyncLoggedIn() || !v) {
    card.style.display = 'none';
    return;
  }
  card.style.display = '';
  const body = document.getElementById('vehicleShareBody');
  const map = syncState.rec.vehicles[v.id];
  if (!map) {
    body.innerHTML = '<p class="sub-text">Dieses Fahrzeug wird beim nächsten Abgleich hochgeladen – danach kannst du es teilen.</p>';
    return;
  }
  let users = [];
  try { users = await syncLoadUsers(); } catch (e) { /* offline: nur Basisinfo */ }
  if (map.owner !== syncState.user.id) {
    const owner = users.find(u => u.id === map.owner);
    body.innerHTML = `<p class="sub-text">Dieses Fahrzeug wurde von <strong>${escapeHtml(syncUserLabel(owner))}</strong> mit dir geteilt. Deine Einträge werden für beide abgeglichen.</p>`;
    return;
  }
  const others = users.filter(u => u.id !== syncState.user.id);
  if (others.length === 0) {
    body.innerHTML = '<p class="sub-text">Es gibt noch keine weiteren Konten auf deinem Server.</p>';
    return;
  }
  body.innerHTML = `
    <p class="sub-text">Wer dieses Fahrzeug sehen und Einträge (Tankungen, Wartungen …) machen darf:</p>
    <div class="share-user-list">
      ${others.map(u => `
        <label class="share-user">
          <input type="checkbox" value="${u.id}" ${map.shared_with.includes(u.id) ? 'checked' : ''} onchange="saveVehicleShare()">
          <span>${escapeHtml(syncUserLabel(u))}${u.gast ? ' <small>(Gast)</small>' : ''}</span>
        </label>`).join('')}
    </div>
    <p class="sub-text share-status" id="vehicleShareStatus"></p>`;
}
window.renderVehicleShareCard = renderVehicleShareCard;

async function saveVehicleShare() {
  const v = getActiveVehicle();
  const map = v && syncState && syncState.rec.vehicles[v.id];
  if (!map) return;
  const ids = Array.from(document.querySelectorAll('#vehicleShareBody input:checked')).map(cb => cb.value);
  const status = document.getElementById('vehicleShareStatus');
  try {
    const rec = await pbFetch(`/api/collections/sgs_vehicles/records/${map.id}`, { method: 'PATCH', json: { shared_with: ids } });
    map.shared_with = rec.shared_with || ids;
    await saveSyncState();
    if (status) status.textContent = 'Freigabe gespeichert.';
  } catch (e) {
    if (status) status.textContent = 'Freigabe konnte nicht gespeichert werden (Server nicht erreichbar?).';
    renderVehicleShareCard();
  }
}
window.saveVehicleShare = saveVehicleShare;

function isVehicleSharedWithMe(v) {
  const map = v && syncState && syncState.rec.vehicles[v.id];
  return !!(map && map.owner !== syncState.user.id);
}

/* --- Oberfläche: Status, Einstellungen, Gast-Modus --- */
function setSyncStatus(status, text) {
  syncStatus = status;
  syncStatusText = text || '';
  updateSyncIndicator();
  renderSyncSettings();
}

function updateSyncIndicator() {
  document.querySelectorAll('.sync-indicator').forEach(btn => {
    btn.style.display = isSyncLoggedIn() ? '' : 'none';
    btn.dataset.state = syncStatus;
    btn.title = syncStatusText || 'Abgleich';
  });
}

function syncNow() {
  if (!isSyncLoggedIn()) { openSettingsModal(); return; }
  runSync({ manual: true });
}
window.syncNow = syncNow;

function renderSyncSettings() {
  const el = document.getElementById('syncSettingsBody');
  if (!el) return;
  if (!isSyncLoggedIn()) {
    el.innerHTML = `
      <p class="sub-text">Melde dich an, um deine Daten zwischen Handy, Tablet und weiteren Personen abzugleichen. Ohne Anmeldung bleibt alles nur auf diesem Gerät.</p>
      <form onsubmit="submitSyncLogin(event)">
        <div class="form-group"><label>Server</label><input type="url" id="syncUrl" value="${escapeHtml((syncState && syncState.url) || SYNC_DEFAULT_URL)}" required></div>
        <div class="form-group"><label>E-Mail</label><input type="email" id="syncEmail" autocomplete="username" required></div>
        <div class="form-group"><label>Passwort</label><input type="password" id="syncPassword" autocomplete="current-password" required></div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary" id="syncLoginBtn">Anmelden</button>
          <button type="button" class="btn btn-secondary" onclick="runSyncDiagnose()">Verbindung testen</button>
        </div>
        <p class="sub-text" id="syncLoginError" style="color: var(--accent-danger);"></p>
        <p class="sub-text" id="syncDiagnoseResult"></p>
      </form>`;
    return;
  }
  const u = syncState.user;
  const last = syncState.lastSync ? new Date(syncState.lastSync).toLocaleString('de-DE') : 'noch nie';
  el.innerHTML = `
    <p class="sub-text">Angemeldet als <strong>${escapeHtml(syncUserLabel(u))}</strong>${u.email ? ' (' + escapeHtml(u.email) + ')' : ''}${u.gast ? ' · Gast-Konto' : ''}</p>
    <p class="sub-text">Status: <strong class="sync-status-text" data-state="${syncStatus}">${escapeHtml(syncStatusText || '–')}</strong><br>Letzter Abgleich: ${last}</p>
    <div class="form-actions">
      <button type="button" class="btn btn-primary" onclick="syncNow()">Jetzt abgleichen</button>
      <button type="button" class="btn btn-secondary" onclick="runSyncDiagnose()">Verbindung testen</button>
      <button type="button" class="btn btn-secondary" onclick="syncLogout()">Abmelden</button>
    </div>
    <p class="sub-text" id="syncDiagnoseResult"></p>`;
}

async function submitSyncLogin(e) {
  e.preventDefault();
  const btn = document.getElementById('syncLoginBtn');
  const err = document.getElementById('syncLoginError');
  btn.disabled = true;
  btn.textContent = 'Anmelden …';
  err.textContent = '';
  try {
    await syncLogin(document.getElementById('syncUrl').value.trim(), document.getElementById('syncEmail').value.trim(), document.getElementById('syncPassword').value);
    renderSyncSettings();
  } catch (ex) {
    if (ex && ex.offline) {
      err.textContent = 'Server nicht erreichbar – prüfe Verbindung …';
      err.textContent = await syncDiagnose(document.getElementById('syncUrl').value);
    } else {
      err.textContent = ex.status === 400 ? 'E-Mail oder Passwort falsch (bzw. Konto nicht in "users" angelegt).' : 'Anmeldung fehlgeschlagen: ' + (ex && ex.message ? ex.message : ex);
    }
    btn.disabled = false;
    btn.textContent = 'Anmelden';
  }
}
window.submitSyncLogin = submitSyncLogin;

// "Verbindung testen": unterscheidet "Server nicht erreichbar" von
// "Server antwortet, aber der Browser blockiert den Zugriff"
async function syncDiagnose(rawUrl) {
  const url = normalizeSyncUrl(rawUrl);
  if (!window.crypto || !window.crypto.subtle) {
    return 'Dieser Browser erlaubt die nötige Verschlüsselung hier nicht – die App muss über https geöffnet sein.';
  }
  try {
    const res = await fetch(url + '/api/health', { cache: 'no-store' });
    if (res.ok) return `Verbindung zu ${url} klappt. ✔`;
    return `Server antwortet, aber mit Fehler ${res.status}. Ist die Adresse ${url} wirklich der PocketBase-Server?`;
  } catch (e) {
    try {
      await fetch(url + '/api/health', { mode: 'no-cors', cache: 'no-store' });
      return `Der Server ${url} ist erreichbar, aber der Browser blockiert den Zugriff der App. Häufigste Ursache: Chrome fragt nach der Berechtigung "Lokales Netzwerk" bzw. "Geräte im lokalen Netzwerk" – auf das Schloss links neben der Adresse der App tippen → Website-Einstellungen → Zugriff erlauben. Sonst CORS-Einstellungen des Servers prüfen.`;
    } catch (e2) {
      return `Keine Verbindung zu ${url}. Ist Tailscale auf diesem Gerät eingeschaltet und die Adresse richtig? (Test: diese Adresse + /api/health im Browser öffnen)`;
    }
  }
}

async function runSyncDiagnose() {
  const out = document.getElementById('syncDiagnoseResult');
  if (!out) return;
  out.textContent = 'Teste Verbindung …';
  const urlInput = document.getElementById('syncUrl');
  out.textContent = await syncDiagnose(urlInput ? urlInput.value : (syncState && syncState.url));
}
window.runSyncDiagnose = runSyncDiagnose;

// Gast-Konten (Feld "gast" am Nutzer): nur die Garage mit den geteilten Fahrzeugen
function applySyncGuestMode() {
  const guest = isSyncGuest();
  document.body.classList.toggle('sync-guest', guest);
  const areaGrid = document.getElementById('area-selection-grid');
  if (areaGrid) areaGrid.classList.toggle('single-area', guest || appData.customerVehiclesEnabled === false);
  if (guest && currentMode === 'kunden') backToSelection();
}

// Nach eingespielten Server-Änderungen die sichtbare Ansicht neu zeichnen
// (nicht während ein Formular/Fenster offen ist - dann später)
function refreshUiAfterSync() {
  if (document.querySelector('.modal-overlay.active')) {
    syncUiRefreshPending = true;
    return;
  }
  syncUiRefreshPending = false;
  const appVisible = !document.getElementById('app-wrapper').classList.contains('hidden');
  if (appVisible && currentMode === 'kunden') {
    renderCustomerSection();
  } else if (appVisible) {
    if (!getActiveVehicle()) { backToSelection(); return; }
    renderVehicleSelect();
    loadActiveVehicle();
  } else {
    const garage = document.getElementById('garage-vehicle-selection');
    if (garage && garage.style.display !== 'none') renderGarageVehicleTiles();
  }
}

// Beim App-Start: Status anzeigen, ersten Abgleich anstoßen und Auslöser
// einrichten (laufen immer, tun aber nichts, solange niemand angemeldet ist)
let syncTimersStarted = false;
function initSync() {
  applySyncGuestMode();
  updateSyncIndicator();
  if (isSyncLoggedIn()) runSync();
  if (syncTimersStarted) return;
  syncTimersStarted = true;
  setInterval(() => { if (document.visibilityState === 'visible') runSync(); }, SYNC_INTERVAL_MS);
  setInterval(() => { if (syncUiRefreshPending) refreshUiAfterSync(); }, 3000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') runSync(); });
  window.addEventListener('online', () => runSync());
}
