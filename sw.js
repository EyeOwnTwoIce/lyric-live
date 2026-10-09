/**
 * Service worker: red primero, cache como respaldo.
 *
 * Decision de diseno: NO cache-first. Asi nunca se sirve codigo viejo mientras
 * hay conexion (evita el clasico "he cambiado algo y no se actualiza"),
 * pero la app sigue abriendo sin conexion.
 *
 * Nunca interceptamos peticiones a otras origenes (api.audd.io, lrclib.net)
 * ni metodos distintos de GET.
 */
const VERSION = 'lyric-live-v1.2.0';

const SHELL = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'src/app.js',
  'src/config.js',
  'src/audio/capture.js',
  'src/audio/recorder-worklet.js',
  'src/audio/wav.js',
  'src/recognition/index.js',
  'src/recognition/audd.js',
  'src/recognition/acrcloud.js',
  'src/lyrics/lrclib.js',
  'src/lyrics/lrc.js',
  'src/lyrics/cache.js',
  'src/sync/engine.js',
  'src/ui/renderer.js',
  'src/ui/waveform.js',
  'src/ui/toast.js',
  'src/util/log.js',
  'src/util/storage.js',
  'src/util/time.js',
  'src/util/text.js',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('index.html')));
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy)).catch(() => undefined);
        }
        return response;
      })
      .catch(() => caches.match(request)),
  );
});
