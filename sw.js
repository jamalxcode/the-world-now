// Service worker: lets the site work as an installed app, open offline with the last headlines,
// and (where the browser allows it) check for breaking news in the background.
//
// Background alerts use Periodic Background Sync: only for an installed app, only in Chromium browsers
// (Chrome / Edge / Samsung Internet, mostly on Android), and the browser decides how often it runs,
// typically a few times a day at most. Everywhere else, alerts work while the page is open.

const CACHE = "twn-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/fonts/inter-latin.woff2"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== "twn-state").map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Network first, cache as the fallback: always the newest headlines when online, the last ones offline.
// Only this site's own files; Bluesky and the outlets' pages are left alone.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  const key = url.pathname.endsWith(".json") ? url.pathname : e.request; // ?t= / ?v= variants share one copy
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); }
        return res;
      })
      .catch(() => caches.match(key).then((hit) => hit || caches.match("/")))
  );
});

// ---------- background breaking-news check ----------

async function seenIds() {
  const res = await (await caches.open("twn-state")).match("/seen-breaking");
  return new Set(res ? await res.json() : []);
}
async function saveSeen(ids) {
  await (await caches.open("twn-state")).put("/seen-breaking", new Response(JSON.stringify([...ids].slice(-200))));
}

async function checkBreaking() {
  const res = await fetch("/breaking.json?t=" + Date.now(), { cache: "no-store" });
  if (!res.ok) return;
  const { stories = [] } = await res.json();
  const seen = await seenIds();
  for (const s of stories.slice(0, 3)) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    await self.registration.showNotification("Breaking · " + s.sources.length + " sources", {
      body: s.title + "\n" + s.sources.slice(0, 4).join(", "),
      tag: s.id,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: s.url },
    });
  }
  await saveSeen(seen);
}

self.addEventListener("periodicsync", (e) => {
  if (e.tag === "breaking") e.waitUntil(checkBreaking());
});
// The page marks stories it already alerted about, so the background check doesn't repeat them.
self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "seen") e.waitUntil(seenIds().then((s) => { e.data.ids.forEach((id) => s.add(id)); return saveSeen(s); }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(self.clients.openWindow(target));
});
