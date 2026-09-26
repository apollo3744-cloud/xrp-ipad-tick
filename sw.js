const C='xrp-tick-pwa-v4-3-r11-idb4-vwapoverlay';
const A=[
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './icon.svg'
];

self.addEventListener(
  'install',
  e=>e.waitUntil(
    caches
      .open(C)
      .then(c=>c.addAll(A))
      .then(()=>self.skipWaiting())
  )
);

self.addEventListener(
  'activate',
  e=>e.waitUntil(
    caches
      .keys()
      .then(keys=>
        Promise.all(
          keys
            .filter(x=>x!==C)
            .map(x=>caches.delete(x))
        )
      )
      .then(()=>self.clients.claim())
  )
);

self.addEventListener(
  'fetch',
  e=>e.respondWith(
    fetch(e.request)
      .catch(()=>caches.match(e.request))
  )
);
