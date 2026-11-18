/* Money Lab service worker: offline cache for same-origin files only.
 * Bump VERSION whenever app files change so phones pick up the update. */
var VERSION = 'moneylab-v3';

var CORE = [
  './',
  'index.html',
  'manifest.json',
  'css/styles.css',
  'js/money.js',
  'js/sheet.js',
  'js/sheet-ui.js',
  'js/store.js',
  'js/ui.js',
  'js/charts.js',
  'js/tools.js',
  'js/app.js',
  'icons/icon.svg',
  'content/app.json',
  'content/glossary.json',
  'content/sections/basics.json',
  'content/sections/budgeting.json',
  'content/sections/saving.json',
  'content/sections/banking.json',
  'content/sections/credit.json',
  'content/sections/snowball.json'
];

// PNG icons are made by tools/make_icons.py; cache them if present, skip if not.
var OPTIONAL = [
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(VERSION).then(function (cache) {
      return cache.addAll(CORE).then(function () {
        return Promise.all(OPTIONAL.map(function (u) { return cache.add(u).catch(function () {}); }));
      });
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf('moneylab-') === 0 && k !== VERSION; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch other sites

  // Content JSON: network first so edits show up, cache as an offline fallback.
  if (url.pathname.indexOf('/content/') !== -1 && url.pathname.slice(-5) === '.json') {
    event.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(VERSION).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return caches.match(req, { ignoreSearch: true }); })
    );
    return;
  }

  // App shell: cache first, then network (and remember it).
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.ok && res.type === 'basic') {
          var copy = res.clone();
          caches.open(VERSION).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        if (req.mode === 'navigate') return caches.match('index.html');
        return Response.error();
      });
    })
  );
});
