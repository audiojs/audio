// The site cross-origin isolated where its host sets no headers (GitHub Pages): each of its own responses given COOP
// and COEP, so the playground's ONNX Runtime wasm runs a model on threads (SharedArrayBuffer), not on one. COEP credentialless:
// a found sound previews from its host as before, fetched without cookies. Others' responses pass as they are.
// playground.html registers it, for the whole site: a page apart from the others (COOP) would cross to them in another
// browsing context group, and the wordmark's spin would not carry over.
const isolated = { 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'credentialless' }

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', e => {
  if (new URL(e.request.url).origin !== location.origin) return
  e.respondWith(fetch(e.request).then(r => {
    // a redirect not followed, or nothing to rewrite
    if (r.type === 'opaqueredirect' || r.status === 0) return r
    let headers = new Headers(r.headers)
    for (let k in isolated) headers.set(k, isolated[k])
    return new Response(r.body, { status: r.status, statusText: r.statusText, headers })
  }))
})
