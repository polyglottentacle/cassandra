/* Pizia · tiene l'app in memoria così funziona anche senza rete.
   Serve solo i file dell'app: nessuna richiesta verso l'esterno. */
const VERSIONE = 'pizia-5';
const FILE = ['./', 'index.html', 'pizia.js', 'manifest.webmanifest', 'icona.svg', 'icona-180.png', 'icona-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSIONE).then((c) => c.addAll(FILE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((nomi) => Promise.all(nomi.filter((n) => n !== VERSIONE).map((n) => caches.delete(n)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  // prima la rete (così gli aggiornamenti arrivano), poi la copia in memoria
  e.respondWith(fetch(e.request).then((r) => {
    const copia = r.clone();
    caches.open(VERSIONE).then((c) => c.put(e.request, copia));
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
