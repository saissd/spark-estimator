/* ============================================================
 * sw.js — service worker for full offline support.
 *
 * Strategy: cache-first for the app shell (everything the app
 * needs to boot, including the vendored xlsx + jszip libraries).
 * The app holds all its data in localStorage / IndexedDB, so once
 * the shell is cached the app is 100% functional with no network.
 *
 * Bump CACHE_VERSION to ship an update; old caches are purged on
 * activate.
 * ============================================================ */

const CACHE_VERSION = 'spark-v1';
const SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/data.js',
  './js/store.js',
  './js/export.js',
  './js/ocr.js',
  './js/app.js',
  './vendor/xlsx.full.min.js',
  './vendor/jszip.min.js',
  './manifest.json',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

// Large OCR engine + language data. Cached best-effort (NOT part of the
// atomic shell install) so a slow/failed OCR fetch can never break the
// core app. Once cached, serial OCR works fully offline.
const OCR_ASSETS = [
  './vendor/tesseract/tesseract.min.js',
  './vendor/tesseract/worker.min.js',
  './vendor/tesseract/tesseract-core-simd.wasm.js',
  './vendor/tesseract/tesseract-core-simd.wasm',
  './vendor/tessdata/eng.traineddata.gz',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(SHELL))               // must succeed
      .then(() => caches.open(CACHE_VERSION))
      .then(cache => Promise.allSettled(                // best-effort
        OCR_ASSETS.map(u => cache.add(u).catch(() => {}))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Cache-first for same-origin shell; network fallback that also
  // populates the cache so subsequent loads work offline.
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req)
        .then(res => {
          // Only cache successful, basic (same-origin) responses.
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => {
          // Navigation requests fall back to the app shell when offline.
          if (req.mode === 'navigate') return caches.match('./index.html');
          return new Response('', { status: 504, statusText: 'offline' });
        });
    })
  );
});
