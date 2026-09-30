// Service Worker für SGS Fahrzeug-Management Pro
//
// WICHTIG: Diese Versionsnummer bei jeder inhaltlichen Änderung an
// index.html / app.js / style.css hochzählen (z.B. v2, v3, ...).
// Nur so merkt der Browser, dass es eine neue Version gibt und lädt sie
// nach - sonst bekommen Nutzer u.U. dauerhaft die alte, zwischengespeicherte
// Version ausgeliefert.
const CACHE_VERSION = 'sgs-pro-v28';

// Alle Dateien, die die App offline-fähig machen ("App-Shell")
const APP_SHELL_FILES = [
  './',
  './index.html',
  './app.js',
  './style.css',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

// Lädt eine Datei beim Installieren IMMER wirklich frisch vom Server, statt
// sich auf den normalen HTTP-Cache des Browsers zu verlassen. WICHTIG: das
// eingebaute cache.addAll() allein reicht dafür nicht - es nutzt intern ganz
// normale fetch()-Aufrufe, und wenn der Browser für z.B. app.js noch eine
// (fälschlich) nicht abgelaufene HTTP-Cache-Antwort von VOR der letzten
// Änderung hat, landet trotz neuer CACHE_VERSION genau diese veraltete
// Version im neuen Cache - man bekäme dann nie die echten Änderungen zu
// sehen, egal wie oft man die Versionsnummer hochzählt.
async function fetchFreshAndCache(cache, url) {
  const response = await fetch(url, { cache: 'reload' });
  await cache.put(url, response.clone());
  return response;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => Promise.all(APP_SHELL_FILES.map((url) => fetchFreshAndCache(cache, url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_VERSION)
            .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// Strategie: "Network first, fall back to cache" für die App-Shell-Dateien.
// So bekommt man bei bestehender Verbindung immer die aktuellste Version,
// und offline (oder bei Netzwerkfehlern) greift automatisch der letzte
// zwischengespeicherte Stand.
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Nur eigene GET-Anfragen behandeln, alles andere (POST, andere Domains,
  // z.B. Kartendienste/Fonts) unangetastet durchreichen
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    // { cache: 'no-store' } erzwingt hier ebenfalls eine echte Netzwerk-Anfrage
    // statt einer evtl. veralteten Antwort aus dem normalen HTTP-Cache
    fetch(request, { cache: 'no-store' })
      .then((networkResponse) => {
        const responseClone = networkResponse.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(request, responseClone));
        return networkResponse;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match('./index.html')))
  );
});
