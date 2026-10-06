// The World Now — reads feed.json (built every 15 min by a GitHub Action) and renders it.
"use strict";

const CATS = [
  ["all", "ALL"], ["top", "TOP"], ["world", "WORLD"], ["mideast", "MIDEAST"],
  ["biz", "BIZ"], ["tech", "TECH"], ["defense", "DEFENSE"], ["science", "SCI"],
];
const STOP = new Set(("about above after again against also among amid amidst around because been before being below between both could does doing down during each from further have having here into itself just more most much near only other over said says same should some such than that their them then there these they this those through under until very were what when where which while with would your will year years week weeks today first last into over back after says said news live update updates latest video watch report reports".split(" ")));

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem("twn-" + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("twn-" + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

const state = {
  data: null,
  items: [],
  staged: [],
  freshIds: new Set(),
  read: new Set(store.get("read", [])),
  auto: store.get("auto", true),
  interval: store.get("interval", 300),
  sound: store.get("sound", false),
  cluster: store.get("cluster", true),
  video: store.get("video", false),
  cat: store.get("cat", "all"),
  source: null,
  query: "",
  panel: null,
  sel: -1,
  expanded: new Set(),
  view: [],
  timer: null,
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
    ingest(data, manual);
  } catch (e) {
    showError("Could not load feed.json (" + e.message + "). " + (state.items.length ? "Showing last loaded headlines." : "Press [FETCH] to retry."));
    if (!state.items.length) $("feed").innerHTML = '<div class="empty dim">No stories available. Press [FETCH] to retry.</div>';
  } finally {
    state.loading = false;
    $("btn-fetch").textContent = "[FETCH]";
  }
}

function ingest(data, manual) {
  const first = !state.data;
  const sameBuild = state.data && state.data.generated_at === data.generated_at;
  state.data = data;
  updateFreshness();
  if (sameBuild) return;
  if (first) { state.items = data.items; render(); return; }

  const known = new Set(state.items.map((i) => i.id).concat(state.staged.map((i) => i.id)));
  const incoming = data.items.filter((i) => !known.has(i.id));
  if (!incoming.length) return;
  state.staged = incoming.concat(state.staged);
  if (state.sound) beep();
  const atTop = window.scrollY < 60 && state.sel < 0;
  if (atTop || manual) applyStaged(); else renderStaged();
}

function applyStaged() {
  if (!state.staged.length) return;
  state.freshIds = new Set(state.staged.map((i) => i.id));
  // Use the latest build as the base so items that aged out disappear too.
  const latest = state.data.items;
  const ids = new Set(latest.map((i) => i.id));
  state.items = latest.concat(state.items.filter((i) => !ids.has(i.id) && state.freshIds.has(i.id)));
  state.staged = [];
  renderStaged();
  render();
  setTimeout(() => state.freshIds.clear(), 3000);
}

function schedule() {
  clearInterval(state.timer);
  if (state.auto) state.timer = setInterval(() => load(false), state.interval * 1000);
}

// ---------- clustering ----------

function tokens(title) {
  return new Set(title.toLowerCase().replace(/[’']s\b/g, "").split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4 && !STOP.has(w)));
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
    return;
  }
  feed.innerHTML = state.view.map((s, idx) => rowHTML(s, idx)).join("");
  if (state.panel === "heat") renderPanel();
}

function rowHTML({ item, related }, idx) {
  const cls = ["row"];
  if (idx === state.sel) cls.push("sel");
  if (state.read.has(item.id)) cls.push("read");
  if (state.freshIds.has(item.id)) cls.push("fresh");
  const open = state.expanded.has(item.id);
  let h = '<div class="' + cls.join(" ") + '" data-idx="' + idx + '" id="row-' + idx + '">';
  h += '<span class="time" title="' + esc(new Date(item.published).toUTCString()) + '">' + timeLabel(item.published) + "</span>";
  h += '<span class="src" data-src="' + esc(item.source) + '" style="color:' + srcColor(item.source) + '" title="Filter by ' + esc(item.source) + '">' + esc(item.source) + "</span>";
  h += '<div class="body"><a class="title" href="' + esc(item.url) + '" target="_blank" rel="noopener" data-id="' + item.id + '">' + esc(item.title) + "</a>";
  if (related.length) h += '<button class="more" data-toggle="' + item.id + '">' + (open ? "- collapse" : "+" + related.length + " related") + "</button>";
  if (state.video) h += videoLinks(item.title);
  if (open) {
    if (item.summary) h += '<div class="summary">' + esc(item.summary) + "</div>";
    if (related.length) {
      h += '<div class="related">' + related.map((r) =>
        '<div><span class="rs" style="color:' + srcColor(r.source) + '">' + esc(r.source) + '</span><a href="' + esc(r.url) + '" target="_blank" rel="noopener" data-id="' + r.id + '">' + esc(r.title) + "</a></div>").join("") + "</div>";
    }
  }
  return h + "</div></div>";
}

function videoLinks(title) {
  const q = encodeURIComponent(title.split(/\s+/).slice(0, 10).join(" "));
  return '<span class="vids">' +
    '<a href="https://news.google.com/search?q=' + q + '" target="_blank" rel="noopener">[Goog]</a>' +
    '<a href="https://www.youtube.com/results?search_query=' + q + '&sp=EgIIAQ%253D%253D" target="_blank" rel="noopener">[Youtube]</a>' +
    '<a href="https://rumble.com/search/video?q=' + q + '&date=today" target="_blank" rel="noopener">[Rumble]</a>' +
    '<a href="https://yandex.com/video/search?text=' + q + '&within=77" target="_blank" rel="noopener">[Yandex]</a></span>';
}

function renderStaged() {
  const el = $("staged");
  el.hidden = !state.staged.length;
  el.textContent = "[+" + state.staged.length + " NEW] press n or click to apply";
}

function renderCats() {
  $("cats").innerHTML = CATS.map(([k, label]) => '<button class="cat' + (state.cat === k ? " on" : "") + '" data-cat="' + k + '">[' + label + "]</button>").join("");
  $("srcfilter").innerHTML = state.source ? "source: " + esc(state.source) + ' <button id="clear-src" title="Clear source filter">[x]</button>' : "";
}

function renderButtons() {
  const set = (id, on, onText, offText) => { const b = $(id); b.classList.toggle("on", on); b.textContent = on ? onText : offText; };
  set("btn-auto", state.auto, "[AUTO ON]", "[AUTO OFF]");
  set("btn-snd", state.sound, "[SND ON]", "[SND OFF]");
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
  const rows = [["j / k", "Navigate headlines"], ["o / enter", "Open selected headline"], ["space", "Expand / collapse related"], ["/", "Focus search"], ["esc", "Clear search / close panel"], ["r", "Refresh now"], ["n", "Apply staged updates"], ["c", "Toggle clustering"], ["v", "Toggle video search links"], ["h", "Toggle heatmaps"], ["s", "Toggle source status"], ["?", "Toggle this help"]];
  return "<h3>KEYBOARD SHORTCUTS</h3>" + rows.map(([k, d]) => '<div class="help-row"><kbd>' + k + "</kbd><span>" + d + "</span></div>").join("") +
    '<p class="dim">Headlines come from public RSS feeds, collected every ~15 minutes by a GitHub Action. Click a source name to filter by it.</p>';
}

function sourcesHTML() {
  const d = state.data;
  if (!d) return "<h3>SOURCES</h3><span class='dim'>No data yet.</span>";
  const rows = [...d.sources].sort((a, b) => (a.ok === b.ok ? a.name.localeCompare(b.name) : a.ok ? 1 : -1));
  return "<h3>SOURCES · " + d.sources_ok + "/" + d.sources_total + " OK · built " + timeAgo(d.generated_at) + " ago</h3>" +
    rows.map((s) => '<div class="src-row"><span class="' + (s.ok ? "ok-c" : "bad-c") + '">' + (s.ok ? "●" : "✕") + "</span><span>" + esc(s.name) +
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
  $("dot").className = "dot " + (age < 40 ? "ok" : age < 120 ? "warn" : "bad");
  $("fresh").textContent = "data " + timeAgo(d.generated_at) + " ago · " + d.sources_ok + "/" + d.sources_total + " sources";
  if (age >= 120) showError("Heads up: the feed hasn't been rebuilt for " + timeAgo(d.generated_at) + " — the GitHub Action may be failing.");
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
function beep() {
  try {
    audio = audio || new AudioContext();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.05, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.25);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.25);
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

function togglePanel(name) {
  state.panel = state.panel === name ? null : name;
  renderButtons();
  renderPanel();
}

function toggleExpand(id) {
  if (state.expanded.has(id)) state.expanded.delete(id); else state.expanded.add(id);
  render();
}

// ---------- events ----------

$("btn-fetch").onclick = () => load(true);
$("btn-auto").onclick = () => { state.auto = !state.auto; store.set("auto", state.auto); renderButtons(); schedule(); };
$("interval").onchange = (e) => { state.interval = +e.target.value; store.set("interval", state.interval); schedule(); };
$("btn-snd").onclick = () => { state.sound = !state.sound; store.set("sound", state.sound); renderButtons(); if (state.sound) beep(); };
$("btn-cluster").onclick = () => { state.cluster = !state.cluster; store.set("cluster", state.cluster); renderButtons(); render(); };
$("btn-video").onclick = () => { state.video = !state.video; store.set("video", state.video); renderButtons(); render(); };
$("btn-heat").onclick = () => togglePanel("heat");
$("btn-sources").onclick = () => togglePanel("sources");
$("btn-help").onclick = () => togglePanel("help");
$("staged").onclick = applyStaged;
$("search").oninput = (e) => { state.query = e.target.value; state.sel = -1; render(); };

document.addEventListener("click", (e) => {
  const t = e.target;
  if (t.dataset.cat) { state.cat = t.dataset.cat; store.set("cat", state.cat); state.sel = -1; renderCats(); render(); }
  else if (t.id === "clear-src") { state.source = null; renderCats(); render(); }
  else if (t.dataset.src) { state.source = t.dataset.src; state.sel = -1; renderCats(); render(); window.scrollTo(0, 0); }
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
    case "n": applyStaged(); break;
    case "c": $("btn-cluster").click(); break;
    case "v": $("btn-video").click(); break;
    case "h": togglePanel("heat"); break;
    case "s": togglePanel("sources"); break;
    case "?": togglePanel("help"); break;
    default: return;
  }
  e.preventDefault();
});

window.addEventListener("scroll", () => { if (window.scrollY < 60 && state.sel < 0 && state.staged.length) applyStaged(); }, { passive: true });
document.addEventListener("visibilitychange", () => { if (!document.hidden && state.auto) load(false); });

setInterval(() => {
  const n = new Date();
  $("clock").textContent = n.toISOString().slice(0, 10) + " " + n.toISOString().slice(11, 19) + " UTC";
}, 1000);
setInterval(() => { updateFreshness(); if (state.panel === "sources") renderPanel(); }, 30000);

renderButtons();
renderCats();
load(false);
schedule();
