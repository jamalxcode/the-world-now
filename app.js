// The World Now — reads feed.json (rebuilt every ~5 min by a GitHub Action),
// polls the listed Bluesky accounts live in between, and flags breaking stories.
"use strict";

const CATS = [
  ["all", "ALL"], ["top", "TOP"], ["world", "WORLD"], ["mideast", "MIDEAST"], ["osint", "OSINT"],
  ["defense", "DEFENSE"], ["biz", "BIZ"], ["tech", "TECH"], ["hazard", "HAZARD"], ["science", "SCI"],
];
const STOP = new Set(("about above after again against also among amid amidst around because been before being below between both could does doing down during each from further have having here into itself just more most much near only other over said says same should some such than that their them then there these they this those through under until very were what when where which while with would your will year years week weeks today first last back news live update updates latest video watch report reports breaking urgent according officials official people told january february march april june july august september october november december monday tuesday wednesday thursday friday saturday sunday".split(" ")));

// A story is "breaking" when at least BREAK_MIN_SOURCES different outlets
// report it and the newest report is under BREAK_FRESH_MIN minutes old.
const BREAK_MIN_SOURCES = 3;
const BREAK_WINDOW_H = 3;
const BREAK_FRESH_MIN = 90;
const LIVE_POLL_S = 60;
const PAGE_START = Date.now();

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem("twn-" + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("twn-" + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

const state = {
  data: null,
  live: new Map(), // id -> item, from direct Bluesky polling
  liveAt: null,
  items: [], // what is on screen
  pending: null, // newer combined list waiting to be applied
  freshIds: new Set(),
  breaking: [],
  breakingIds: new Set(),
  alerted: new Set(store.get("alerted", [])),
  read: new Set(store.get("read", [])),
  auto: store.get("auto", true),
  interval: store.get("interval", 120),
  sound: store.get("sound", false),
  alerts: store.get("alerts", false),
  cluster: store.get("cluster", true),
  video: store.get("video", false),
  cat: store.get("cat", "all"),
  source: null,
  query: "",
  panel: null,
  sel: -1,
  expanded: new Set(),
  view: [],
  timers: [],
  loading: false,
};

// ---------- data ----------

async function load(manual) {
  if (state.loading) return;
  state.loading = true;
  $("btn-fetch").textContent = "[....]";
  try {
    const res = await fetch("feed.json?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    showError(null);
    const changed = !state.data || state.data.generated_at !== data.generated_at;
    state.data = data;
    updateFreshness();
    if (changed) update(manual);
    if (manual) pollLive(true);
  } catch (e) {
    showError("Could not load feed.json (" + e.message + "). " + (state.items.length ? "Showing last loaded headlines." : "Press [FETCH] to retry."));
    if (!state.items.length) $("feed").innerHTML = '<div class="empty dim">No stories available. Press [FETCH] to retry.</div>';
  } finally {
    state.loading = false;
    $("btn-fetch").textContent = "[FETCH]";
  }
}

// Bluesky's public API allows browser requests, so between feed builds we
// fetch the newest posts from the accounts the build lists in data.live.
let livePolling = false;
async function pollLive(force) {
  if (!state.data || !state.data.live || livePolling || (!force && document.hidden)) return;
  livePolling = true;
  const cutoff = Date.now() - 48 * 3600e3;
  let added = 0;
  try {
    await Promise.all(state.data.live.map(async (src) => {
      try {
        const u = "https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?filter=posts_no_replies&limit=10&actor=" + encodeURIComponent(src.handle);
        const res = await fetch(u);
        if (!res.ok) return;
        const { feed } = await res.json();
        for (const it of feed || []) {
          const item = bskyItem(it, src);
          if (!item || state.live.has(item.id) || Date.parse(item.published) < cutoff) continue;
          state.live.set(item.id, item);
          added++;
        }
      } catch { /* one account failing shouldn't stop the rest */ }
    }));
  } finally {
    livePolling = false;
  }
  for (const [id, it] of state.live) if (Date.parse(it.published) < cutoff) state.live.delete(id);
  state.liveAt = new Date();
  updateFreshness();
  if (added) update(false);
}

function bskyItem(it, src) {
  if (it.reason) return null; // repost
  const p = it.post;
  const rkey = p.uri.split("/").pop();
  let [title, summary] = splitPost((p.record && p.record.text) || "");
  let url = "https://bsky.app/profile/" + src.handle + "/post/" + rkey;
  const ext = p.embed && p.embed.external;
  if (ext && /^https?:/.test(ext.uri)) {
    url = ext.uri;
    if (ext.title && (title.length < 30 || title.includes("http"))) title = ext.title.trim();
  }
  if (!title) return null;
  return { id: "bsky-" + rkey, title, url, source: src.name, category: src.category, published: new Date(p.record.createdAt).toISOString(), summary, social: true };
}

function splitPost(text) {
  const lines = text.split("\n").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (!lines.length) return ["", ""];
  let title = lines[0], rest = lines.slice(1).join(" ");
  if (title.length < 25 && rest) { title += " " + rest; rest = ""; }
  if (title.length > 220) {
    let cut = 220;
    for (let i = 80; i < 220; i++) if (".!?".includes(title[i]) && title[i + 1] === " ") { cut = i + 1; break; }
    rest = (title.slice(cut) + " " + rest).trim();
    title = title.slice(0, cut).trim() + (cut === 220 ? "…" : "");
  }
  return [title, rest.slice(0, 280)];
}

function combined() {
  const base = state.data ? state.data.items : [];
  const ids = new Set(base.map((i) => i.id));
  const urls = new Set(base.map((i) => i.url));
  const extra = [...state.live.values()].filter((i) => !ids.has(i.id) && !urls.has(i.url));
  return extra.length ? base.concat(extra).sort((a, b) => Date.parse(b.published) - Date.parse(a.published)) : base;
}

function update(manual) {
  const next = combined();
  computeBreaking(next);
  if (!state.items.length) { state.items = next; render(); return; }
  const shown = new Set(state.items.map((i) => i.id));
  const newCount = next.filter((i) => !shown.has(i.id)).length;
  state.pending = next;
  if (!newCount) { applyPending(); return; } // only removals/reorders
  if (state.sound) beep(660);
  if (manual || (window.scrollY < 60 && state.sel < 0)) applyPending(); else renderStaged(newCount);
}

function applyPending() {
  if (!state.pending) return;
  const shown = new Set(state.items.map((i) => i.id));
  state.freshIds = new Set(state.pending.filter((i) => !shown.has(i.id)).map((i) => i.id));
  state.items = state.pending;
  state.pending = null;
  renderStaged(0);
  render();
  setTimeout(() => state.freshIds.clear(), 3000);
}

function schedule() {
  state.timers.forEach(clearInterval);
  state.timers = [];
  if (!state.auto) return;
  state.timers.push(setInterval(() => load(false), state.interval * 1000));
  state.timers.push(setInterval(() => pollLive(false), LIVE_POLL_S * 1000));
}

// ---------- clustering & breaking ----------

function tokens(title) {
  return new Set(title.toLowerCase().replace(/[’']s\b/g, "").split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w)));
}

function clusterItems(items) {
  const toks = items.map((i) => tokens(i.title));
  const used = new Array(items.length).fill(false);
  const out = [];
  for (let a = 0; a < items.length; a++) {
    if (used[a]) continue;
    used[a] = true;
    const related = [];
    for (let b = a + 1; b < items.length; b++) {
      if (used[b]) continue;
      let shared = 0;
      for (const t of toks[b]) if (toks[a].has(t)) shared++;
      const union = toks[a].size + toks[b].size - shared;
      if (shared >= 3 || (shared >= 2 && union > 0 && shared / union >= 0.34)) {
        used[b] = true;
        related.push(items[b]);
      }
    }
    out.push({ item: items[a], related });
  }
  return out;
}

function computeBreaking(items) {
  const now = Date.now();
  const recent = items.filter((i) => now - Date.parse(i.published) < BREAK_WINDOW_H * 3600e3);
  const found = [];
  for (const c of clusterItems(recent)) {
    const all = [c.item, ...c.related];
    const sources = [...new Set(all.map((i) => i.source))];
    const newest = Math.max(...all.map((i) => Date.parse(i.published)));
    const oldest = Math.min(...all.map((i) => Date.parse(i.published)));
    if (sources.length >= BREAK_MIN_SOURCES && now - newest < BREAK_FRESH_MIN * 60e3) {
      // Prefer a news outlet's headline over a social post as the lead.
      const lead = all.find((i) => !i.social) || c.item;
      found.push({ lead, all, sources, oldest });
    }
  }
  found.sort((a, b) => b.sources.length - a.sources.length || b.oldest - a.oldest);
  state.breaking = found.slice(0, 5);
  state.breakingIds = new Set(state.breaking.flatMap((b) => b.all.map((i) => i.id)));
  renderBreaking();
  notifyBreaking();
}

function notifyBreaking() {
  const fresh = state.breaking.filter((b) => !b.all.some((i) => state.alerted.has(i.id)));
  for (const b of state.breaking) for (const i of b.all) state.alerted.add(i.id);
  store.set("alerted", [...state.alerted].slice(-3000));
  // Don't fire for stories that were already breaking when the page opened.
  if (Date.now() - PAGE_START < 30000) return;
  if (!fresh.length) return;
  if (state.sound) beep(990, 3);
  if (state.alerts && "Notification" in window && Notification.permission === "granted") {
    for (const b of fresh.slice(0, 3)) {
      try {
        const n = new Notification("BREAKING · " + b.sources.length + " sources", { body: b.lead.title + "\n" + b.sources.slice(0, 5).join(", "), tag: b.lead.id });
        n.onclick = () => { window.focus(); jumpTo(b.lead.id); };
      } catch { /* notifications unavailable */ }
    }
  }
  if (document.hidden) document.title = "● BREAKING · The World Now";
}

// ---------- rendering ----------

function filtered() {
  const q = state.query.trim().toLowerCase();
  return state.items.filter((i) =>
    (state.cat === "all" || i.category === state.cat) &&
    (!state.source || i.source === state.source) &&
    (!q || i.title.toLowerCase().includes(q) || i.source.toLowerCase().includes(q) || (i.summary || "").toLowerCase().includes(q)));
}

function render() {
  const list = filtered();
  state.view = state.cluster ? clusterItems(list) : list.map((item) => ({ item, related: [] }));
  if (state.sel >= state.view.length) state.sel = state.view.length - 1;
  $("count").textContent = list.length + " items" + (state.cluster ? " · " + state.view.length + " stories" : "");

  const feed = $("feed");
  if (!state.view.length) {
    feed.innerHTML = '<div class="empty dim">' + (state.items.length ? "No headlines match the current filter." : "No stories available. Press [FETCH] to retrieve news.") + "</div>";
  } else {
    feed.innerHTML = state.view.map((s, idx) => rowHTML(s, idx)).join("");
  }
  if (state.panel === "heat") renderPanel();
}

function platform(item) {
  if (!item.social) return "";
  return '<span class="plat">' + (item.id.startsWith("tg-") ? "TG" : "BSKY") + "</span>";
}

function rowHTML({ item, related }, idx) {
  const cls = ["row"];
  if (idx === state.sel) cls.push("sel");
  if (state.read.has(item.id)) cls.push("read");
  if (state.freshIds.has(item.id)) cls.push("fresh");
  const breaking = state.breakingIds.has(item.id) || related.some((r) => state.breakingIds.has(r.id));
  if (breaking) cls.push("brk");
  const open = state.expanded.has(item.id);
  let h = '<div class="' + cls.join(" ") + '" data-idx="' + idx + '" id="row-' + idx + '" data-item="' + item.id + '">';
  h += '<span class="time" title="' + esc(new Date(item.published).toUTCString()) + '">' + timeLabel(item.published) + "</span>";
  h += '<span class="src" data-src="' + esc(item.source) + '" style="color:' + srcColor(item.source) + '" title="Filter by ' + esc(item.source) + '">' + platform(item) + esc(item.source) + "</span>";
  h += '<div class="body">' + (breaking ? '<span class="brk-tag">BREAKING</span>' : "");
  h += '<a class="title" href="' + esc(item.url) + '" target="_blank" rel="noopener" data-id="' + item.id + '">' + esc(item.title) + "</a>";
  if (related.length) h += '<button class="more" data-toggle="' + item.id + '">' + (open ? "- collapse" : "+" + related.length + " related") + "</button>";
  if (state.video) h += videoLinks(item.title);
  if (open) {
    if (item.summary) h += '<div class="summary">' + esc(item.summary) + "</div>";
    if (related.length) {
      h += '<div class="related">' + related.map((r) =>
        '<div><span class="rs" style="color:' + srcColor(r.source) + '">' + platform(r) + esc(r.source) + '</span><span class="rt">' + timeAgo(r.published) + '</span><a href="' + esc(r.url) + '" target="_blank" rel="noopener" data-id="' + r.id + '">' + esc(r.title) + "</a></div>").join("") + "</div>";
    }
  }
  return h + "</div></div>";
}

function renderBreaking() {
  const el = $("breaking");
  el.hidden = !state.breaking.length;
  el.innerHTML = state.breaking.map((b) =>
    '<div class="brk-row" data-jump="' + b.lead.id + '"><span class="brk-tag">BREAKING</span><span class="brk-title">' + esc(b.lead.title) +
    '</span><span class="dim brk-meta">' + b.sources.length + " sources · first " + timeAgo(new Date(b.oldest).toISOString()) + " ago</span></div>").join("");
}

function videoLinks(title) {
  const q = encodeURIComponent(title.split(/\s+/).slice(0, 10).join(" "));
  return '<span class="vids">' +
    '<a href="https://news.google.com/search?q=' + q + '" target="_blank" rel="noopener">[Goog]</a>' +
    '<a href="https://www.youtube.com/results?search_query=' + q + '&sp=EgIIAQ%253D%253D" target="_blank" rel="noopener">[Youtube]</a>' +
    '<a href="https://rumble.com/search/video?q=' + q + '&date=today" target="_blank" rel="noopener">[Rumble]</a>' +
    '<a href="https://yandex.com/video/search?text=' + q + '&within=77" target="_blank" rel="noopener">[Yandex]</a></span>';
}

function renderStaged(n) {
  const el = $("staged");
  el.hidden = !n;
  el.textContent = "[+" + n + " NEW] press n or click to apply";
}

function renderCats() {
  $("cats").innerHTML = CATS.map(([k, label]) => '<button class="cat' + (state.cat === k ? " on" : "") + '" data-cat="' + k + '">[' + label + "]</button>").join("");
  $("srcfilter").innerHTML = state.source ? "source: " + esc(state.source) + ' <button id="clear-src" title="Clear source filter">[x]</button>' : "";
}

function renderButtons() {
  const set = (id, on, onText, offText) => { const b = $(id); b.classList.toggle("on", on); b.textContent = on ? onText : offText; };
  set("btn-auto", state.auto, "[AUTO ON]", "[AUTO OFF]");
  set("btn-snd", state.sound, "[SND ON]", "[SND OFF]");
  set("btn-alerts", state.alerts, "[ALERTS ON]", "[ALERTS OFF]");
  set("btn-cluster", state.cluster, "[CLUSTER]", "[CLUSTER]");
  set("btn-video", state.video, "[VIDEO]", "[VIDEO]");
  set("btn-heat", state.panel === "heat", "[HEATMAPS]", "[HEATMAPS]");
  set("btn-sources", state.panel === "sources", "[SOURCES]", "[SOURCES]");
  set("btn-help", state.panel === "help", "[HELP]", "[HELP]");
  $("interval").value = String(state.interval);
}

function renderPanel() {
  const p = $("panel");
  p.hidden = !state.panel;
  if (!state.panel) return;
  if (state.panel === "help") p.innerHTML = helpHTML();
  else if (state.panel === "sources") p.innerHTML = sourcesHTML();
  else p.innerHTML = heatHTML();
}

function helpHTML() {
  const rows = [["j / k", "Navigate headlines"], ["o / enter", "Open selected headline"], ["space", "Expand / collapse related"], ["/", "Focus search"], ["esc", "Clear search / close panel"], ["r", "Refresh now"], ["n", "Apply staged updates"], ["b", "Jump to top breaking story"], ["a", "Toggle breaking-news alerts"], ["c", "Toggle clustering"], ["v", "Toggle video search links"], ["h", "Toggle heatmaps"], ["s", "Toggle source status"], ["?", "Toggle this help"]];
  return "<h3>KEYBOARD SHORTCUTS</h3>" + rows.map(([k, d]) => '<div class="help-row"><kbd>' + k + "</kbd><span>" + d + "</span></div>").join("") +
    '<p class="dim">Headlines come from public RSS feeds, public Telegram channels and public Bluesky accounts, collected every ~5 minutes by a GitHub Action. Bluesky accounts are also checked live every minute. ' +
    "A story is marked BREAKING when " + BREAK_MIN_SOURCES + "+ different sources report it within " + BREAK_WINDOW_H + "h and the latest report is under " + BREAK_FRESH_MIN + " min old. " +
    "Social/OSINT posts (TG, BSKY) are unverified. Click a source name to filter by it.</p>";
}

function sourcesHTML() {
  const d = state.data;
  if (!d) return "<h3>SOURCES</h3><span class='dim'>No data yet.</span>";
  const rank = (s) => (!s.ok ? 0 : s.count === 0 ? 1 : 2);
  const rows = [...d.sources].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const failing = d.sources.filter((s) => !s.ok).length, quiet = d.sources.filter((s) => s.ok && !s.count).length;
  return "<h3>SOURCES · " + (d.sources_total - failing) + "/" + d.sources_total + " OK" + (quiet ? " (" + quiet + " quiet)" : "") + " · built " + timeAgo(d.generated_at) + " ago</h3>" +
    rows.map((s) => '<div class="src-row"><span class="' + (!s.ok ? "bad-c" : s.count ? "ok-c" : "dim") + '">' + (!s.ok ? "✕" : s.count ? "●" : "○") + "</span><span>" + esc(s.name) +
      (s.type ? ' <span class="plat">' + (s.type === "telegram" ? "TG" : "BSKY") + "</span>" : "") +
      '</span><span class="dim cat-c">' + esc(s.category) + '</span><span class="num">' + s.count + '</span><span class="err">' + esc(s.error || "") + "</span></div>").join("");
}

function heatHTML() {
  const now = Date.now();
  const recent = state.items.filter((i) => now - Date.parse(i.published) < 6 * 3600e3);
  const counts = new Map();
  for (const i of recent) for (const t of tokens(i.title)) counts.set(t, (counts.get(t) || 0) + 1);
  const top = [...counts].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 18);
  const max = top.length ? top[0][1] : 1;
  let kw = "<div><h3>TRENDING TERMS · LAST 6H</h3>";
  kw += top.length ? top.map(([t, n]) => '<div class="kw" data-kw="' + esc(t) + '"><span class="kw-label">' + esc(t) + '</span><div class="bar" style="width:' + Math.max(4, (n / max) * 100) + '%"></div><span class="num">' + n + "</span></div>").join("") : '<span class="dim">Not enough data.</span>';
  kw += "</div>";

  const hours = 24, cats = CATS.slice(1);
  const grid = cats.map(() => new Array(hours).fill(0));
  let peak = 1;
  for (const i of state.items) {
    const h = Math.floor((now - Date.parse(i.published)) / 3600e3);
    const c = cats.findIndex(([k]) => k === i.category);
    if (h >= 0 && h < hours && c >= 0) peak = Math.max(peak, ++grid[c][hours - 1 - h]);
  }
  let hm = '<div><h3>VOLUME BY CATEGORY · LAST 24H (→ now)</h3><div class="heat" style="grid-template-columns:auto repeat(' + hours + ',1fr)">';
  cats.forEach(([, label], c) => {
    hm += '<span class="lbl">' + label + "</span>";
    for (let h = 0; h < hours; h++) {
      const v = grid[c][h];
      hm += '<span class="cell" title="' + label + ": " + v + " in hour -" + (hours - h) + '" style="background:' + (v ? "rgba(255,87,51," + (0.12 + 0.88 * v / peak).toFixed(2) + ")" : "#1a1a1a") + '"></span>';
    }
  });
  hm += "</div></div>";
  return '<div class="panel-grid">' + kw + hm + "</div>";
}

function updateFreshness() {
  const d = state.data;
  if (!d) return;
  const age = (Date.now() - Date.parse(d.generated_at)) / 60000;
  const ok = d.sources.filter((s) => s.ok).length;
  $("dot").className = "dot " + (age < 20 ? "ok" : age < 60 ? "warn" : "bad");
  $("fresh").textContent = "build " + timeAgo(d.generated_at) + " ago · " + ok + "/" + d.sources_total + " sources" +
    (state.liveAt ? " · live " + (d.live || []).length + " bsky " + Math.round((Date.now() - state.liveAt) / 1000) + "s ago" : "");
  if (age >= 60) showError("Heads up: the feed hasn't been rebuilt for " + timeAgo(d.generated_at) + " — the GitHub Action may be failing.");
}

function showError(msg) {
  const el = $("error");
  el.hidden = !msg;
  el.textContent = msg ? "⚠ " + msg : "";
}

// ---------- helpers ----------

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function timeAgo(iso) {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60);
  return h < 48 ? h + "h" + (h < 6 && m % 60 ? " " + (m % 60) + "m" : "") : Math.floor(h / 24) + "d";
}

function timeLabel(iso) {
  const d = new Date(iso);
  return String(d.getUTCHours()).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0") + ' <span style="color:var(--faint)">' + timeAgo(iso) + "</span>";
}

const colorCache = new Map();
function srcColor(name) {
  if (!colorCache.has(name)) {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    colorCache.set(name, "hsl(" + (h % 360) + ",62%,64%)");
  }
  return colorCache.get(name);
}

let audio;
function beep(freq = 880, times = 1) {
  try {
    audio = audio || new AudioContext();
    for (let k = 0; k < times; k++) {
      const t0 = audio.currentTime + k * 0.18;
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.05, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.15);
      o.connect(g).connect(audio.destination);
      o.start(t0);
      o.stop(t0 + 0.15);
    }
  } catch { /* audio unavailable */ }
}

function markRead(id) {
  state.read.add(id);
  store.set("read", [...state.read].slice(-1500));
}

function select(idx) {
  if (!state.view.length) return;
  state.sel = Math.max(0, Math.min(state.view.length - 1, idx));
  document.querySelectorAll(".row.sel").forEach((r) => r.classList.remove("sel"));
  const row = $("row-" + state.sel);
  if (row) {
    row.classList.add("sel");
    const top = row.getBoundingClientRect().top, hdr = $("top").offsetHeight;
    if (top < hdr + 4 || top > window.innerHeight - 40) row.scrollIntoView({ block: top < hdr ? "center" : "nearest" });
  }
}

// Show a story in the feed: clear filters, expand its cluster and select it.
function jumpTo(id) {
  applyPending();
  state.cat = "all"; state.source = null; state.query = ""; $("search").value = "";
  renderCats();
  render();
  const idx = state.view.findIndex((s) => s.item.id === id || s.related.some((r) => r.id === id));
  if (idx < 0) return;
  state.expanded.add(state.view[idx].item.id);
  render();
  select(idx);
  $("row-" + idx).scrollIntoView({ block: "center" });
}

function togglePanel(name) {
  state.panel = state.panel === name ? null : name;
  renderButtons();
  renderPanel();
}

function toggleExpand(id) {
  if (state.expanded.has(id)) state.expanded.delete(id); else state.expanded.add(id);
  render();
}

async function toggleAlerts() {
  if (!state.alerts && "Notification" in window && Notification.permission === "default") {
    try { await Notification.requestPermission(); } catch { /* ignore */ }
  }
  state.alerts = !state.alerts;
  if (state.alerts && "Notification" in window && Notification.permission === "denied") {
    showError("Browser notifications are blocked for this site; alerts will only beep (turn on [SND]) and show in the BREAKING bar.");
  }
  store.set("alerts", state.alerts);
  renderButtons();
}

// ---------- events ----------

$("btn-fetch").onclick = () => load(true);
$("btn-auto").onclick = () => { state.auto = !state.auto; store.set("auto", state.auto); renderButtons(); schedule(); };
$("interval").onchange = (e) => { state.interval = +e.target.value; store.set("interval", state.interval); schedule(); };
$("btn-snd").onclick = () => { state.sound = !state.sound; store.set("sound", state.sound); renderButtons(); if (state.sound) beep(); };
$("btn-alerts").onclick = toggleAlerts;
$("btn-cluster").onclick = () => { state.cluster = !state.cluster; store.set("cluster", state.cluster); renderButtons(); render(); };
$("btn-video").onclick = () => { state.video = !state.video; store.set("video", state.video); renderButtons(); render(); };
$("btn-heat").onclick = () => togglePanel("heat");
$("btn-sources").onclick = () => togglePanel("sources");
$("btn-help").onclick = () => togglePanel("help");
$("staged").onclick = applyPending;
$("search").oninput = (e) => { state.query = e.target.value; state.sel = -1; render(); };

document.addEventListener("click", (e) => {
  const t = e.target;
  const jump = t.closest("[data-jump]");
  if (jump) { jumpTo(jump.dataset.jump); return; }
  if (t.dataset.cat) { state.cat = t.dataset.cat; store.set("cat", state.cat); state.sel = -1; renderCats(); render(); }
  else if (t.id === "clear-src") { state.source = null; renderCats(); render(); }
  else if (t.closest("[data-src]")) { state.source = t.closest("[data-src]").dataset.src; state.sel = -1; renderCats(); render(); window.scrollTo(0, 0); }
  else if (t.dataset.toggle) toggleExpand(t.dataset.toggle);
  else if (t.closest(".kw")) { const kw = t.closest(".kw").dataset.kw; $("search").value = kw; state.query = kw; render(); }
  else if (t.dataset.id) { markRead(t.dataset.id); const row = t.closest(".row"); if (row && t.classList.contains("title")) row.classList.add("read"); }
});

document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const inInput = e.target.tagName === "INPUT" || e.target.tagName === "SELECT";
  if (e.key === "Escape") {
    if (inInput) e.target.blur();
    if (state.query) { state.query = ""; $("search").value = ""; render(); }
    else if (state.panel) togglePanel(state.panel);
    else if (state.source) { state.source = null; renderCats(); render(); }
    return;
  }
  if (inInput) return;
  const cur = state.view[state.sel];
  switch (e.key) {
    case "j": case "ArrowDown": select(state.sel + 1); break;
    case "k": case "ArrowUp": select(state.sel - 1); break;
    case "o": case "Enter": if (cur) { markRead(cur.item.id); window.open(cur.item.url, "_blank", "noopener"); render(); } break;
    case " ": if (cur) { toggleExpand(cur.item.id); select(state.sel); } break;
    case "/": $("search").focus(); break;
    case "r": load(true); break;
    case "n": applyPending(); break;
    case "b": if (state.breaking.length) jumpTo(state.breaking[0].lead.id); break;
    case "a": toggleAlerts(); break;
    case "c": $("btn-cluster").click(); break;
    case "v": $("btn-video").click(); break;
    case "h": togglePanel("heat"); break;
    case "s": togglePanel("sources"); break;
    case "?": togglePanel("help"); break;
    default: return;
  }
  e.preventDefault();
});

window.addEventListener("scroll", () => { if (window.scrollY < 60 && state.sel < 0 && state.pending) applyPending(); }, { passive: true });
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  document.title = "The World Now";
  if (state.auto) { load(false); pollLive(false); }
});

setInterval(() => {
  const n = new Date();
  $("clock").textContent = n.toISOString().slice(0, 10) + " " + n.toISOString().slice(11, 19) + " UTC";
}, 1000);
setInterval(() => {
  updateFreshness();
  if (state.panel === "sources") renderPanel();
  if (state.items.length) computeBreaking(state.pending || state.items); // let stale stories drop off
}, 30000);

renderButtons();
renderCats();
load(false).then(() => pollLive(true));
schedule();
