// Change the build when shipping a new shell so an already-installed preview refreshes.
const BUILD = '7.1-travel-1';
const SHELL = 'trainer-v71-preview.html';
const FILES = new Map([
  [SHELL, ['text/html']],
  ['trainer-v71-offline.js', ['text/javascript', 'application/javascript', 'application/x-javascript']],
  ['trainer-v71-manifest.webmanifest', ['application/manifest+json', 'application/json', 'application/octet-stream']],
  ['trainer-icon.svg', ['image/svg+xml']],
  ...[180, 192, 512].map(size => [`trainer-v71-icon-${size}.png`, ['image/png']])
].map(([name, types]) => [new URL(name, self.location.href).href, types]));

// The main app removes other CacheStorage entries when its worker activates.
// Store this small preview bundle separately and commit all files together.
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('my-trainer-offline:' + self.registration.scope, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('bundles');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function bundleStore(mode, action) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('bundles', mode);
      const request = action(transaction.objectStore('bundles'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error || new Error('Offline storage unavailable'));
    });
  } finally {
    db.close();
  }
}

function readBundle() {
  return bundleStore('readonly', store => store.get(BUILD));
}

async function prepareBundle() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const entries = await Promise.all(Array.from(FILES, async ([url, types]) => {
      const response = await fetch(url, {
        cache: 'reload', redirect: 'error', credentials: 'same-origin', signal: controller.signal
      });
      const type = (response.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
      if (response.status !== 200 || !types.includes(type)) throw new Error('Unavailable offline file: ' + url);
      const body = await response.arrayBuffer();
      if (!body.byteLength) throw new Error('Empty offline file: ' + url);
      // Fetch decodes the bytes. Preserve origin security headers, drop transport headers.
      const headers = new Headers(response.headers);
      for (const name of ['Content-Encoding', 'Content-Length', 'Transfer-Encoding']) headers.delete(name);
      return [url, { body, headers: Array.from(headers) }];
    }));
    await bundleStore('readwrite', store => store.put(Object.fromEntries(entries), BUILD));
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

self.addEventListener('install', event => {
  event.waitUntil(prepareBundle().then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', event => {
  if (event.data !== 'check-trainer-offline' || !event.ports[0]) return;
  const port = event.ports[0];
  event.waitUntil((async () => {
    try {
      if (!(await readBundle())) await prepareBundle();
      port.postMessage(true);
    } catch {
      port.postMessage(false);
    }
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Keep ordinary query parameters on launch links working in airplane mode.
  if (request.mode === 'navigate') url.search = '';
  if (!FILES.has(url.href)) return;
  event.respondWith((async () => {
    let bundle;
    try { bundle = await readBundle(); } catch { /* Storage can be disabled or cleared. */ }
    const file = bundle && bundle[url.href];
    return file ? new Response(file.body, { headers: file.headers }) : fetch(request);
  })());
});
