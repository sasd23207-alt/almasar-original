/*
 * Service worker for Almasar.
 * 1. Keeps the app shell so it opens without internet (network first, cache as fallback).
 * 2. Receives chats shared from WhatsApp ("Share" -> Almasar) and parks them in the
 *    'inbox' of the local database; the app imports them when it opens.
 * It never touches the ledger itself and never sends anything over the network.
 */
const CACHE_NAME = 'almasar-shell-v5';
const SHELL_FILES = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith(handleShare(event.request));
    return;
  }
  // Only the app's own files are handled here. Anything else (for example the AI API) passes through untouched.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) { return; }
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request)));
});

function openInboxDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('almasar-db', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('records')) { db.createObjectStore('records'); }
      if (!db.objectStoreNames.contains('inbox')) { db.createObjectStore('inbox', { keyPath: 'id' }); }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveToInbox(items) {
  const db = await openInboxDatabase();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction('inbox', 'readwrite');
    items.forEach((item) => transaction.objectStore('inbox').put(item));
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

async function handleShare(request) {
  try {
    const form = await request.formData();
    const items = [];
    for (const value of form.getAll('chat')) {
      if (typeof value !== 'string') {
        items.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: value.name, text: await value.text() });
      }
    }
    const sharedText = form.get('text');
    if (typeof sharedText === 'string' && sharedText.trim()) {
      items.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: form.get('title') || 'نص', text: sharedText });
    }
    if (items.length > 0) { await saveToInbox(items); }
  } catch (error) {
    // Even if parking fails, open the app instead of showing an error page.
  }
  return Response.redirect(new URL('./index.html?shared=1', self.registration.scope).href, 303);
}
