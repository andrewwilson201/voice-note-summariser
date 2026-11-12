const VERSION = "v9";
const SHELL = ["./", "index.html", "app.js", "asr-worker.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open("shell-" + VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("shell-") && k !== "shell-" + VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

// GitHub Pages can't send the headers that let the browser use several CPU cores for
// speech recognition (cross-origin isolation), so they are added here.
function isolate(res) {
  if (res.status === 0 || res.type === "opaqueredirect") return res;
  const headers = new Headers(res.headers);
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Embedder-Policy", "credentialless");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Android share sheet posts the voice note here (see manifest share_target).
  if (e.request.method === "POST" && url.pathname.endsWith("/share-target")) {
    e.respondWith((async () => {
      const form = await e.request.formData();
      const file = form.getAll("audio").find((f) => f instanceof File);
      if (!file) return Response.redirect("./?shared=none", 303);
      const cache = await caches.open("shared-files");
      await cache.put("shared-audio", new Response(file, {
        headers: { "content-type": file.type || "audio/ogg", "x-file-name": encodeURIComponent(file.name || "voice-note") },
      }));
      return Response.redirect("./?shared=1", 303);
    })());
    return;
  }

  // App shell: network first so updates land, cache as offline fallback.
  if (e.request.method === "GET" && url.origin === location.origin) {
    e.respondWith((async () => {
      let res;
      try {
        res = await fetch(e.request);
        if (res.ok) (await caches.open("shell-" + VERSION)).put(e.request, res.clone());
      } catch {
        res = await caches.match(e.request, { ignoreSearch: true });
        if (!res) return Response.error();
      }
      return isolate(res);
    })());
  }
});
