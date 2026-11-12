const VERSION = "v1";
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
      try {
        const res = await fetch(e.request);
        if (res.ok) (await caches.open("shell-" + VERSION)).put(e.request, res.clone());
        return res;
      } catch {
        return (await caches.match(e.request, { ignoreSearch: true })) || Response.error();
      }
    })());
  }
});
