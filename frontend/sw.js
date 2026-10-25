// Offline shell for Sisyphus.
//
// Strategy is deliberately NETWORK-FIRST for the shell rather than the usual
// cache-first. This app is actively developed and served from localhost, so
// cache-first would hand back stale JS after every edit — the classic "why
// am I running old code" trap. Network-first keeps development honest and
// still gives a working shell when the server is unreachable.
//
// API requests are never cached: a training log showing a stale ride list
// would be worse than showing an error.

const CACHE = 'sisyphus-shell-v29';

const SHELL = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/js/log.js',
  '/js/i18n.js',
  '/js/theme.js',
  '/js/i18n/en.js',
  '/js/i18n/fr.js',
  '/js/zones.js',
  '/js/gears.js',
  '/js/api/client.js',
  '/js/ble/connection.js',
  '/js/ble/constants.js',
  '/js/ble/ftms-parser.js',
  '/js/ble/trainer-control.js',
  '/js/metrics/distance.js',
  '/js/metrics/virtual-speed.js',
  '/js/metrics/rolling-average.js',
  '/js/session/recorder.js',
  '/js/session/pending.js',
  '/js/workout/builder.js',
  '/js/workout/files.js',
  '/js/workout/names.js',
  '/js/workout/runner.js',
  '/js/workout/targets.js',
  '/js/ui/badges.js',
  '/js/ui/cards.js',
  '/js/ui/image-resize.js',
  '/js/ui/chart.js',
  '/js/ui/chronicle.js',
  '/js/ui/config-forms.js',
  '/js/ui/feats.js',
  '/js/ui/ftp-test.js',
  '/js/ui/home.js',
  '/js/ui/leaderboard.js',
  '/js/ui/login.js',
  '/js/ui/log-panel.js',
  '/js/ui/live-screen.js',
  '/js/ui/ride-hero.js',
  '/js/ui/sisyphus-loop.js',
  '/js/ui/trainer-button.js',
  '/js/ui/trainer-settings.js',
  '/js/ui/remote-link.js',
  '/js/ui/routes.js',
  '/js/ui/ride-picker.js',
  '/js/ui/trainer-gate.js',
  '/js/ui/tutorial.js',
  '/js/ui/shop.js',
  '/js/ui/admin.js',
  '/js/ui/settings-tabs.js',
  '/js/ui/profile-tabs.js',
  '/js/shop/cosmetics.js',
  '/js/shop/avatar.js',
  '/js/ui/route-player.js',
  '/js/workout/route-track.js',
  '/js/ui/views.js',
  '/js/ui/scenery.js',
  '/js/ui/scenery-editor.js',
  '/js/ui/scenery-settings.js',
  '/js/ui/strava-export.js',
  '/js/ui/strava-text.js',
  '/js/ui/workouts.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/media/texture.jpg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // Individual failures must not abort the whole install, so each entry
      // is added independently.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // let cross-origin through
  if (url.pathname.startsWith('/api/')) return; // never cache the log

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Refresh the cached copy on every successful fetch.
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        // A navigation with nothing cached still needs the shell.
        if (request.mode === 'navigate') return caches.match('/index.html');
        throw new Error('offline and not cached');
      })
  );
});
