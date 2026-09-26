// Service Worker für SGS Fahrzeug-Management Pro
//
// WICHTIG: Diese Versionsnummer bei jeder inhaltlichen Änderung an
// index.html / app.js / style.css hochzählen (z.B. v2, v3, ...).
// Nur so merkt der Browser, dass es eine neue Version gibt und lädt sie
// nach - sonst bekommen Nutzer u.U. dauerhaft die alte, zwischengespeicherte
// Version ausgeliefert.
const CACHE_VERSION = 'sgs-pro-v5';

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

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL_FILES))
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
    fetch(request)
      .then((networkResponse) => {
        const responseClone = networkResponse.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(request, responseClone));
        return networkResponse;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match('./index.html')))
  );
});
