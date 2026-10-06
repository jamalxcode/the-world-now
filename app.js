// The World Now — reads feed.json (rebuilt every ~5 min by a GitHub Action),
// polls the listed Bluesky accounts live in between, and flags breaking stories.
"use strict";

const CATS = [
  ["all", "All"], ["top", "Top"], ["world", "World"], ["mideast", "Middle East"], ["osint", "OSINT"],
  ["defense", "Defense"], ["biz", "Business"], ["tech", "Tech"], ["hazard", "Hazards"], ["science", "Science"],
];
const STOP = new Set(("about above after again against also among amid amidst around because been before being below between both could does doing down during each from further have having here into itself just more most much near only other over said says same should some such than that their them then there these they this those through under until very were what when where which while with would your will year years week weeks today first last back news live update updates latest video watch report reports breaking urgent according officials official people told january february march april june july august september october november december monday tuesday wednesday thursday friday saturday sunday".split(" ")));

// A story is "breaking" when at least BREAK_MIN_SOURCES different outlets
// report it and the newest report is under BREAK_FRESH_MIN minutes old.
const BREAK_MIN_SOURCES = 3;
const BREAK_WINDOW_H = 3;
const BREAK_FRESH_MIN = 90;
const LIVE_POLL_S = 60;
const PAGE_START = Date.now();

// What ↺ Reset returns to. Theme, alerts and sound are personal settings and stay as they are.
const DEFAULTS = { cat: "all", cluster: true, density: "comfortable", video: false, auto: true, interval: 120 };
const THEMES = ["", "light", "dark"], THEME_LABEL = { "": "◐ Auto", light: "☀ Light", dark: "☾ Dark" };

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
  auto: store.get("auto", DEFAULTS.auto),
  interval: store.get("interval", DEFAULTS.interval),
  sound: store.get("sound", false),
  alerts: store.get("alerts", false),
  cluster: store.get("cluster", DEFAULTS.cluster),
  density: store.get("density", DEFAULTS.density),
  video: store.get("video", DEFAULTS.video),
  cat: store.get("cat", DEFAULTS.cat),
  theme: store.get("theme", ""),
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
  $("btn-fetch").textContent = "Refreshing…";
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
    showError("Couldn't load the latest headlines (" + e.message + "). " + (state.items.length ? "Showing the last ones loaded." : "Press Refresh to try again."));
    if (!state.items.length) $("feed").innerHTML = '<div class="empty">No headlines yet. Press Refresh to try again.</div>';
  } finally {
    state.loading = false;
    $("btn-fetch").textContent = "Refresh";
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
  if (title.split(/\s+/).filter(Boolean).length < 4) return null; // same rule as the fetcher
  const isVideo = (t) => typeof t === "string" && t.startsWith("app.bsky.embed.video");
  const hint = p.embed && (isVideo(p.embed.$type) || (p.embed.media && isVideo(p.embed.media.$type))) ? "video" : "";
  const item = { id: "bsky-" + rkey, title, url, source: src.name, category: src.category, published: new Date(p.record.createdAt).toISOString(), summary, social: true };
  const media = detectMedia(hint, url, title);
  if (media) item.media = media;
  return item;
}

// Mirrors detectMedia in fetcher/main.go.
const VIDEO_URL = /(\/videos?\/|\/av\/|\/watch\/|\/clip\/|\/live-video|youtube\.com\/(watch|shorts|live)|youtu\.be\/|vimeo\.com\/|rumble\.com\/|\.(mp4|m3u8|webm)(\?|$))/i;
const AUDIO_URL = /(\/podcasts?\/|\/audio\/|\/sounds\/|\/listen\/|\/radio\/|open\.spotify\.com\/(episode|show)|podcasts\.apple\.com\/|soundcloud\.com\/|\.(mp3|m4a|ogg)(\?|$))/i;
function detectMedia(hint, url, title) {
  if (hint) return hint;
  if (VIDEO_URL.test(url) || /^(watch|video|live video)\s*[:|–—-]/i.test(title)) return "video";
  if (AUDIO_URL.test(url) || /^(listen|podcast|audio)\s*[:|–—-]/i.test(title)) return "audio";
  return "";
}

function mediaIcon(item) {
  if (item.media === "video") return '<span class="media" role="img" aria-label="Has video" title="Has video">📺</span>';
  if (item.media === "audio") return '<span class="media" role="img" aria-label="Has audio" title="Has audio">🔊</span>';
  return "";
}

// Mirrors splitPost/tidyPostTitle in fetcher/main.go.
function splitPost(text) {
  text = text.replace(/(https?:\/\/\S+|\b[a-z0-9-]+\.(rs|com|org|net|co|ly|gl|me|news|io|tv|uk)\/\S*)/gi, "");
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
  return [tidyPostTitle(title), rest.slice(0, 280)];
}

function tidyPostTitle(t) {
  for (let i = 0; i < 3; i++) t = t.replace(/^[^\p{L}\p{N}"'“(#]+/u, "").replace(/^#?(breaking|urgent|just in|flash)\b\s*[:\-–—|]*\s*/i, "");
  return t.replace(/#(\p{L})/gu, "$1").trim();
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
        const n = new Notification("Breaking · " + b.sources.length + " sources", { body: b.lead.title + "\n" + b.sources.slice(0, 5).join(", "), tag: b.lead.id });
        n.onclick = () => { window.focus(); jumpTo(b.lead.id); };
      } catch { /* notifications unavailable */ }
    }
  }
  if (document.hidden) document.title = "● Breaking · The World Now";
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
  $("count").textContent = state.cluster ? state.view.length + " stories · " + list.length + " reports" : list.length + " headlines";

  const feed = $("feed");
  if (!state.view.length) {
    feed.innerHTML = '<div class="empty">' + (state.items.length ? 'Nothing matches these filters. <button class="chip reset" data-reset>↺ Reset</button>' : "No headlines yet. Press Refresh to try again.") + "</div>";
  } else {
    feed.innerHTML = state.view.map((s, idx) => rowHTML(s, idx)).join("");
  }
  renderCatCounts();
  if (state.panel === "heat") renderPanel();
}

function srcHTML(item, tag) {
  return "<" + tag + ' class="src" data-src="' + esc(item.source) + '" style="--h:' + srcHue(item.source) + '" title="Show only ' + esc(item.source) + '">' + esc(item.source) + "</" + tag + ">" +
    (item.social ? ' <span class="plat" title="Social post, unverified">' + (item.id.startsWith("tg-") ? "TG" : "BSKY") + "</span>" : "");
}

function rowHTML({ item, related }, idx) {
  const cls = ["row"];
  if (idx === state.sel) cls.push("sel");
  if (state.read.has(item.id)) cls.push("read");
  if (state.freshIds.has(item.id)) cls.push("fresh");
  const breaking = state.breakingIds.has(item.id) || related.some((r) => state.breakingIds.has(r.id));
  if (breaking) cls.push("brk");
  const open = state.expanded.has(item.id);
  if (state.density === "compact") return compactRowHTML(item, related, idx, cls, breaking, open);
  let h = '<article class="' + cls.join(" ") + '" id="row-' + idx + '">';
  h += '<div class="meta">' + (breaking ? '<span class="brk-tag">Breaking</span>' : "") + srcHTML(item, "button") +
    '<span title="' + esc(new Date(item.published).toUTCString()) + '">' + timeAgo(item.published) + " ago · " + hhmm(item.published) + " UTC</span></div>";
  h += '<a class="title" href="' + esc(item.url) + '" target="_blank" rel="noopener" data-id="' + item.id + '">' + mediaIcon(item) + esc(item.title) + "</a>";
  let actions = "";
  if (related.length || item.summary) {
    const label = related.length ? (open ? "Hide " : "") + related.length + " more report" + (related.length > 1 ? "s" : "") : open ? "Less" : "More";
    actions += '<button class="more" data-toggle="' + item.id + '" aria-expanded="' + open + '">' + label + "</button>";
  }
  if (state.video) actions += videoLinks(item.title);
  if (actions) h += '<div class="actions">' + actions + "</div>";
  if (open) {
    if (item.summary) h += '<div class="summary">' + esc(item.summary) + "</div>";
    if (related.length) {
      h += '<div class="related">' + related.map((r) =>
        '<div class="r">' + srcHTML(r, "button") + ' <span class="ago">' + timeAgo(r.published) + '</span><a href="' + esc(r.url) + '" target="_blank" rel="noopener" data-id="' + r.id + '">' + mediaIcon(r) + esc(r.title) + "</a></div>").join("") + "</div>";
    }
  }
  return h + "</article>";
}

// Compact: one line per story (time · source · headline · "+N"); details open underneath.
function compactRowHTML(item, related, idx, cls, breaking, open) {
  let h = '<article class="' + cls.join(" ") + ' c" id="row-' + idx + '">';
  h += '<span class="c-time" title="' + esc(new Date(item.published).toUTCString()) + " (" + timeAgo(item.published) + ' ago)">' + hhmm(item.published) + "</span>";
  h += '<span class="c-src">' + srcHTML(item, "button") + "</span>";
  h += '<a class="title" href="' + esc(item.url) + '" target="_blank" rel="noopener" data-id="' + item.id + '" title="' + esc(item.title) + '">' +
    (breaking ? '<span class="brk-tag">Breaking</span> ' : "") + mediaIcon(item) + esc(item.title) + "</a>";
  if (related.length || item.summary || state.video) {
    const label = related.length ? "+" + related.length : open ? "−" : "…";
    const tip = related.length ? related.length + " more report" + (related.length > 1 ? "s" : "") : "Details";
    h += '<button class="more" data-toggle="' + item.id + '" aria-expanded="' + open + '" title="' + tip + '">' + label + "</button>";
  }
  if (open) {
    h += '<div class="c-open">';
    if (item.summary) h += '<div class="summary">' + esc(item.summary) + "</div>";
    if (state.video) h += '<div class="actions">' + videoLinks(item.title) + "</div>";
    if (related.length) {
      h += '<div class="related">' + related.map((r) =>
        '<div class="r">' + srcHTML(r, "button") + ' <span class="ago">' + timeAgo(r.published) + '</span><a href="' + esc(r.url) + '" target="_blank" rel="noopener" data-id="' + r.id + '">' + mediaIcon(r) + esc(r.title) + "</a></div>").join("") + "</div>";
    }
    h += "</div>";
  }
  return h + "</article>";
}


// Search links use a few keywords, not the whole headline: a full headline is so literal
// that it often finds nothing. Each link asks for the newest results where the site allows it.
const SEARCH_LINKS = [
  ["X", (q) => "https://x.com/search?q=" + q + "&f=live"], // Latest tab (X needs you to be signed in)
  ["YouTube", (q) => "https://www.youtube.com/results?search_query=" + q + "&sp=EgIIAw%253D%253D"], // uploaded this week; YouTube no longer sorts by date
  ["Google News", (q) => "https://www.google.com/search?q=" + q + "&tbm=nws&tbs=sbd:1"], // news, sorted by date
  ["Rumble", (q) => "https://rumble.com/search/video?q=" + q + "&sort=date"], // newest first
  ["Yandex", (q) => "https://yandex.com/video/search?text=" + q + "&how=tm"], // newest first
];
// Filler words and weak verbs that make a search too literal.
const SEARCH_STOP = new Set(("the and for are was were has had have his her its our not but all any can out who how why what when where new one two " +
  "says said say tell tells told after over amid amidst report reports video videos watch live latest update updates breaking exclusive analysis opinion " +
  "will would could should than then them they this that these those with from into onto about against more most " +
  "plan plans set sets get gets make makes take takes hit hits seek seeks warn warns urge urges call calls vow vows eye eyes face faces look looks " +
  "launch launches secure secures weigh weighs announce announced announces speak speaks hold holds held reach reaching reached see sees come comes " +
  "move moves back backs push pushes probe probes split splits").split(" "));

// Keywords for search: the names in the headline (capitalised words) topped up with its first ordinary
// keywords, in headline order: 3 words, or 4 when there are 3 names.
// "Italy regulator probes AI music startup Suno over terms of service" → "Italy regulator Suno".
function searchQuery(title) {
  const seen = new Set();
  const words = title.replace(/@\w+/g, " ").replace(/[’']s\b/g, "").replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/)
    .filter((w) => {
      const k = w.toLowerCase();
      if (w.length < 3 || !/^\p{L}/u.test(w) || STOP.has(k) || SEARCH_STOP.has(k) || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  if (!words.length) return encodeURIComponent(title.split(/\s+/).slice(0, 4).join(" "));
  const isName = (w) => /^\p{Lu}/u.test(w);
  const names = words.filter(isName);
  let pick;
  if (names.length >= words.length * 0.7) pick = words.slice(0, 3); // Title Case Headline: capitals tell us nothing
  else {
    const keep = new Set(names.slice(0, 3));
    const target = keep.size === 3 ? 4 : 3;
    for (const w of words) if (keep.size < target && !isName(w)) keep.add(w);
    pick = words.filter((w) => keep.has(w));
  }
  return encodeURIComponent(pick.join(" "));
}

function videoLinks(title) {
  const q = searchQuery(title);
  return '<span class="vids">' + SEARCH_LINKS.map(([name, url]) => '<a href="' + esc(url(q)) + '" target="_blank" rel="noopener">' + name + "</a>").join("") + "</span>";
}

function renderStaged(n) {
  const el = $("staged");
  el.hidden = !n;
  el.textContent = "↑ " + n + " new headline" + (n === 1 ? "" : "s");
}

function renderCats() {
  $("cats").innerHTML = CATS.map(([k, label]) => '<button data-cat="' + k + '" aria-pressed="' + (state.cat === k) + '">' + label + '<span class="n"></span></button>').join("");
  renderCatCounts();
  const note = $("srcfilter");
  note.hidden = !state.source;
  note.innerHTML = state.source ? "Showing only <b>" + esc(state.source) + '</b><button class="chip" id="clear-src">✕ Show all sources</button>' : "";
}

function renderCatCounts() {
  const counts = {};
  for (const i of state.items) counts[i.category] = (counts[i.category] || 0) + 1;
  document.querySelectorAll("#cats button").forEach((b) => {
    const k = b.dataset.cat;
    b.querySelector(".n").textContent = k === "all" ? "" : counts[k] || 0;
  });
}

function renderButtons() {
  const press = (id, on) => $(id).setAttribute("aria-pressed", on);
  press("btn-auto", state.auto);
  press("btn-snd", state.sound);
  press("btn-alerts", state.alerts);
  press("btn-video", state.video);
  press("btn-heat", state.panel === "heat");
  press("btn-sources", state.panel === "sources");
  press("btn-help", state.panel === "help");
  document.querySelectorAll("#density button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === state.density));
  $("feed").classList.toggle("compact", state.density === "compact");
  document.querySelectorAll("#view button").forEach((b) => b.setAttribute("aria-pressed", (b.dataset.v === "grouped") === state.cluster));
  $("interval").value = String(state.interval);
  $("interval").disabled = !state.auto;
}

function renderAll() {
  renderButtons();
  renderCats();
  renderPanel();
  render();
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
  const rows = [["j / k", "Next / previous headline"], ["o / enter", "Open the selected headline"], ["space", "Show / hide more reports"], ["/", "Search"], ["esc", "Clear search, close a panel"], ["x", "↺ Reset the view"], ["r", "Refresh now"], ["n", "Show new headlines"], ["b", "Jump to the top breaking story"], ["a", "Breaking-news alerts on / off"], ["c", "Grouped / all posts"], ["d", "Comfortable / compact"], ["v", "Search links on / off"], ["h", "Trends"], ["s", "Sources"], ["?", "This help"]];
  return '<div class="panel-grid"><div><h2>Keyboard shortcuts</h2>' + rows.map(([k, d]) => '<div class="help-row"><kbd>' + k + "</kbd><span>" + d + "</span></div>").join("") + "</div>" +
    "<div><h2>How it works</h2><p>Headlines come from about 95 public sources: news sites' RSS feeds, public Telegram channels and public Bluesky accounts. A GitHub Action collects them every ~5 minutes, and this page also checks the Bluesky accounts live every minute.</p>" +
    "<p><b>Grouped</b> puts reports of the same story together. A story is marked <b>Breaking</b> when " + BREAK_MIN_SOURCES + " or more different sources report it within " + BREAK_WINDOW_H + " hours and the latest report is under " + BREAK_FRESH_MIN + " minutes old.</p>" +
    "<p>Posts marked <b>TG</b> (Telegram) or <b>BSKY</b> (Bluesky) come from social accounts and are unverified. Click a source's name to show only that source.</p>" +
    "<p><b>↺ Reset</b> clears the search and filters, closes everything and goes back to the default view. Your theme, alerts and sound settings stay as they are.</p></div></div>";
}

function sourcesHTML() {
  const d = state.data;
  if (!d) return "<h2>Sources</h2><p>No data yet.</p>";
  const rank = (s) => (!s.ok ? 0 : s.count === 0 ? 1 : 2);
  const rows = [...d.sources].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const failing = d.sources.filter((s) => !s.ok).length, quiet = d.sources.filter((s) => s.ok && !s.count).length;
  return "<h2>Sources · " + (d.sources_total - failing) + " of " + d.sources_total + " working" + (quiet ? " (" + quiet + " quiet)" : "") + ' <span class="count">· updated ' + timeAgo(d.generated_at) + " ago</span></h2>" +
    '<div class="src-list">' + rows.map((s) => '<div class="src-row"><span class="' + (!s.ok ? "bad-c" : s.count ? "ok-c" : "q-c") + '" title="' + (!s.ok ? "failing" : s.count ? "working" : "quiet") + '">' + (!s.ok ? "✕" : s.count ? "●" : "○") + "</span><span>" + esc(s.name) +
      (s.type ? ' <span class="plat">' + (s.type === "telegram" ? "TG" : "BSKY") + "</span>" : "") +
      '</span><span class="count">' + esc(catLabel(s.category)) + '</span><span class="num">' + s.count + "</span>" + (s.error ? '<span class="err">' + esc(s.error) + "</span>" : "") + "</div>").join("") + "</div>";
}

function heatHTML() {
  const now = Date.now();
  const recent = state.items.filter((i) => now - Date.parse(i.published) < 6 * 3600e3);
  const counts = new Map();
  for (const i of recent) for (const t of tokens(i.title)) counts.set(t, (counts.get(t) || 0) + 1);
  const top = [...counts].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 18);
  const max = top.length ? top[0][1] : 1;
  let kw = "<div><h2>Trending terms</h2><h3>Most-used words in headlines, last 6 hours. Click one to search.</h3>";
  kw += top.length ? top.map(([t, n]) => '<div class="kw" data-kw="' + esc(t) + '"><span class="kw-label">' + esc(t) + '</span><div class="bar" style="width:' + Math.max(4, (n / max) * 100) + '%"></div><span class="num">' + n + "</span></div>").join("") : "<p>Not enough data yet.</p>";
  kw += "</div>";

  const hours = 24, cats = CATS.slice(1);
  const grid = cats.map(() => new Array(hours).fill(0));
  let peak = 1;
  for (const i of state.items) {
    const h = Math.floor((now - Date.parse(i.published)) / 3600e3);
    const c = cats.findIndex(([k]) => k === i.category);
    if (h >= 0 && h < hours && c >= 0) peak = Math.max(peak, ++grid[c][hours - 1 - h]);
  }
  const shade = (v) => "var(--heat-" + (v === 0 ? 0 : Math.min(4, 1 + Math.floor((v / peak) * 3.999))) + ")";
  let hm = '<div><h2>Volume by category</h2><h3>Headlines per hour, last 24 hours (newest on the right)</h3><div class="heat" style="grid-template-columns:auto repeat(' + hours + ',1fr)">';
  cats.forEach(([, label], c) => {
    hm += '<span class="lbl">' + label + "</span>";
    for (let h = 0; h < hours; h++) {
      const v = grid[c][h];
      hm += '<span class="cell" title="' + label + ": " + v + " headline" + (v === 1 ? "" : "s") + ", " + (hours - h) + 'h ago" style="background:' + shade(v) + '"></span>';
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
  $("fresh").innerHTML = "<b>Updated " + timeAgo(d.generated_at) + " ago</b> · " + ok + " of " + d.sources_total + " sources" +
    (state.liveAt ? " · Bluesky live, checked " + Math.round((Date.now() - state.liveAt) / 1000) + "s ago" : "");
  if (age >= 60) showError("Updates are running late: the last one was " + timeAgo(d.generated_at) + " ago. Bluesky posts still arrive live.");
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

function catLabel(k) {
  const c = CATS.find(([key]) => key === k);
  return c ? c[1] : k;
}

function timeAgo(iso) {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60);
  return h < 48 ? h + "h" + (h < 6 && m % 60 ? " " + (m % 60) + "m" : "") : Math.floor(h / 24) + "d";
}

function hhmm(iso) {
  const d = new Date(iso);
  return String(d.getUTCHours()).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0");
}

const hueCache = new Map();
function srcHue(name) {
  if (!hueCache.has(name)) {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    hueCache.set(name, h % 360);
  }
  return hueCache.get(name);
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
    const top = row.getBoundingClientRect().top, hdr = $("top").getBoundingClientRect().bottom;
    if (top < hdr + 4 || top > window.innerHeight - 60) row.scrollIntoView({ block: "center" });
  }
}

// Show a story in the feed: clear filters, expand its group and select it.
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

// ↺ Reset: back to the default view in one click.
function reset() {
  Object.assign(state, DEFAULTS, { source: null, query: "", panel: null, sel: -1 });
  state.expanded.clear();
  state.read.clear();
  for (const [k, v] of Object.entries(DEFAULTS)) store.set(k, v);
  store.set("read", []);
  $("search").value = "";
  $("search").blur();
  applyPending();
  schedule();
  renderAll();
  window.scrollTo({ top: 0 });
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

function setCluster(on) {
  state.cluster = on;
  store.set("cluster", on);
  state.sel = -1;
  renderButtons();
  render();
}

function setDensity(d) {
  state.density = d;
  store.set("density", d);
  renderButtons();
  render();
  if (state.sel >= 0) select(state.sel);
}

async function toggleAlerts() {
  if (!state.alerts && "Notification" in window && Notification.permission === "default") {
    try { await Notification.requestPermission(); } catch { /* ignore */ }
  }
  state.alerts = !state.alerts;
  if (state.alerts && "Notification" in window && Notification.permission === "denied") {
    showError("Notifications are blocked for this site in your browser settings. Breaking stories will still show at the top, and beep if Sound is on.");
  }
  store.set("alerts", state.alerts);
  renderButtons();
}

function applyTheme(th) {
  state.theme = th;
  if (th) document.documentElement.dataset.theme = th; else delete document.documentElement.dataset.theme;
  $("btn-theme").textContent = THEME_LABEL[th];
  store.set("theme", th);
}

// ---------- events ----------

$("btn-fetch").onclick = () => load(true);
$("btn-reset").onclick = reset;
$("btn-theme").onclick = () => applyTheme(THEMES[(THEMES.indexOf(state.theme) + 1) % THEMES.length]);
$("btn-auto").onclick = () => { state.auto = !state.auto; store.set("auto", state.auto); renderButtons(); schedule(); };
$("interval").onchange = (e) => { state.interval = +e.target.value; store.set("interval", state.interval); schedule(); };
$("btn-snd").onclick = () => { state.sound = !state.sound; store.set("sound", state.sound); renderButtons(); if (state.sound) beep(); };
$("btn-alerts").onclick = toggleAlerts;
$("btn-video").onclick = () => { state.video = !state.video; store.set("video", state.video); renderButtons(); render(); };
$("btn-heat").onclick = () => togglePanel("heat");
$("btn-sources").onclick = () => togglePanel("sources");
$("btn-help").onclick = () => togglePanel("help");
$("view").onclick = (e) => { const b = e.target.closest("button"); if (b) setCluster(b.dataset.v === "grouped"); };
$("density").onclick = (e) => { const b = e.target.closest("button"); if (b) setDensity(b.dataset.v); };
$("staged").onclick = () => { applyPending(); window.scrollTo({ top: 0 }); };
$("search").oninput = (e) => { state.query = e.target.value; state.sel = -1; render(); };

document.addEventListener("click", (e) => {
  const t = e.target;
  const jump = t.closest("[data-jump]");
  const cat = t.closest("[data-cat]");
  const src = t.closest("[data-src]");
  if (jump) jumpTo(jump.dataset.jump);
  else if (t.closest("[data-reset]")) reset();
  else if (cat) { state.cat = cat.dataset.cat; store.set("cat", state.cat); state.sel = -1; renderCats(); render(); }
  else if (t.id === "clear-src") { state.source = null; renderCats(); render(); }
  else if (src) { state.source = src.dataset.src; state.sel = -1; renderCats(); render(); window.scrollTo({ top: 0 }); }
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
    case "x": reset(); break;
    case "r": load(true); break;
    case "n": applyPending(); break;
    case "b": if (state.breaking.length) jumpTo(state.breaking[0].lead.id); break;
    case "a": toggleAlerts(); break;
    case "c": setCluster(!state.cluster); break;
    case "d": setDensity(state.density === "compact" ? "comfortable" : "compact"); break;
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
  document.title = "The World Now · news.sala.company";
  if (state.auto) { load(false); pollLive(false); }
});

function tick() { $("clock").textContent = hhmm(new Date().toISOString()) + " UTC"; }
setInterval(tick, 15000);
setInterval(() => {
  updateFreshness();
  if (state.panel === "sources") renderPanel();
  if (state.items.length) computeBreaking(state.pending || state.items); // let stale stories drop off
}, 30000);

applyTheme(state.theme);
tick();
renderAll();
load(false).then(() => pollLive(true));
schedule();
