// The World Now — reads feed.json (rebuilt every ~5 min by a GitHub Action),
// polls the listed Bluesky accounts live in between, and flags breaking stories.
"use strict";

const CATS = [
  ["near", "📍 Near me"], ["all", "All"], ["video", "📺 Videos"], ["top", "Top"], ["world", "World"], ["mideast", "Middle East"], ["osint", "OSINT"],
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

// What ↺ Reset returns to. Theme, alerts, sound, your location and your 👍/👎 ratings are personal
// settings and stay as they are.
const DEFAULTS = { cat: "near", cluster: true, density: "comfortable", links: true, auto: true, interval: 120, hours: 24 };

// "Near me" rings: your country → its neighbourhood → its wider region → everything else.
// The fetcher tags each headline with countries (item.geo); this table says which countries are near which.
// [neighbourhood, region, member countries]
const GEO_GROUPS = [
  ["Gulf", "Middle East", "KW SA AE QA BH OM IQ IR YE"],
  ["Levant, Turkey & Egypt", "Middle East", "JO LB SY IL PS TR EG CY"],
  ["North Africa", "Africa", "LY TN DZ MA SD SS"],
  ["West & Central Africa", "Africa", "NG GH SN CI ML BF NE CM CD AO"],
  ["East Africa", "Africa", "KE ET SO UG TZ RW ER DJ"],
  ["Southern Africa", "Africa", "ZA ZW ZM MZ MG"],
  ["Western Europe", "Europe", "GB IE FR DE NL BE CH AT"],
  ["Northern Europe", "Europe", "SE NO DK FI IS EE LV LT"],
  ["Southern Europe", "Europe", "ES PT IT GR MT RS HR BA XK AL"],
  ["Eastern Europe", "Europe", "PL CZ SK HU RO BG UA BY MD RU"],
  ["North America", "Americas", "US CA"],
  ["Latin America", "Americas", "MX GT HN SV NI CR PA CU HT DO JM BR AR CL CO PE VE EC BO PY UY"],
  ["South Asia", "Asia", "IN PK BD NP LK AF MV"],
  ["East Asia", "Asia", "CN HK TW JP KR KP MN"],
  ["Southeast Asia", "Asia", "SG MY ID PH TH VN MM KH LA"],
  ["Central Asia & Caucasus", "Asia", "KZ UZ TM KG TJ AZ GE AM"],
  ["Oceania", "Oceania", "AU NZ PG FJ"],
];
const GEO = {}; // code → { hood, region, hoodSet, regionSet }
for (const [hood, region, list] of GEO_GROUPS) {
  const hoodSet = new Set(list.split(" "));
  const regionSet = new Set(GEO_GROUPS.filter((g) => g[1] === region).flatMap((g) => g[2].split(" ")));
  for (const c of hoodSet) GEO[c] = { hood, region, hoodSet, regionSet };
}
const REGION_NAMES = typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames(["en"], { type: "region" }) : null;
const countryName = (c) => { try { return (REGION_NAMES && REGION_NAMES.of(c)) || c; } catch { return c; } };

// The reader's country from the device's time zone (no permission prompt), else the browser language.
const TZ_COUNTRY = {
  Kuwait: "KW", Riyadh: "SA", Dubai: "AE", Qatar: "QA", Bahrain: "BH", Muscat: "OM", Baghdad: "IQ", Tehran: "IR", Aden: "YE",
  Amman: "JO", Beirut: "LB", Damascus: "SY", Jerusalem: "IL", Tel_Aviv: "IL", Gaza: "PS", Hebron: "PS", Istanbul: "TR", Cairo: "EG", Nicosia: "CY", Famagusta: "CY",
  Tripoli: "LY", Tunis: "TN", Algiers: "DZ", Casablanca: "MA", El_Aaiun: "MA", Khartoum: "SD", Juba: "SS",
  Lagos: "NG", Accra: "GH", Dakar: "SN", Abidjan: "CI", Bamako: "ML", Ouagadougou: "BF", Niamey: "NE", Douala: "CM", Kinshasa: "CD", Lubumbashi: "CD", Luanda: "AO",
  Nairobi: "KE", Addis_Ababa: "ET", Mogadishu: "SO", Kampala: "UG", Dar_es_Salaam: "TZ", Kigali: "RW", Asmara: "ER", Djibouti: "DJ",
  Johannesburg: "ZA", Harare: "ZW", Lusaka: "ZM", Maputo: "MZ", Antananarivo: "MG",
  London: "GB", Dublin: "IE", Paris: "FR", Berlin: "DE", Busingen: "DE", Amsterdam: "NL", Brussels: "BE", Zurich: "CH", Vienna: "AT",
  Stockholm: "SE", Oslo: "NO", Copenhagen: "DK", Helsinki: "FI", Reykjavik: "IS", Tallinn: "EE", Riga: "LV", Vilnius: "LT",
  Madrid: "ES", Ceuta: "ES", Canary: "ES", Lisbon: "PT", Azores: "PT", Madeira: "PT", Rome: "IT", Athens: "GR", Malta: "MT", Belgrade: "RS", Zagreb: "HR", Sarajevo: "BA", Tirane: "AL",
  Warsaw: "PL", Prague: "CZ", Bratislava: "SK", Budapest: "HU", Bucharest: "RO", Sofia: "BG", Kyiv: "UA", Kiev: "UA", Simferopol: "UA", Minsk: "BY", Chisinau: "MD",
  Moscow: "RU", Kaliningrad: "RU", Samara: "RU", Volgograd: "RU", Yekaterinburg: "RU", Omsk: "RU", Novosibirsk: "RU", Krasnoyarsk: "RU", Irkutsk: "RU", Yakutsk: "RU", Vladivostok: "RU", Magadan: "RU", Kamchatka: "RU",
  Toronto: "CA", Vancouver: "CA", Edmonton: "CA", Winnipeg: "CA", Halifax: "CA", St_Johns: "CA", Regina: "CA", Moncton: "CA", Whitehorse: "CA", Montreal: "CA",
  Mexico_City: "MX", Cancun: "MX", Monterrey: "MX", Tijuana: "MX", Guatemala: "GT", Tegucigalpa: "HN", El_Salvador: "SV", Managua: "NI", Costa_Rica: "CR", Panama: "PA",
  Havana: "CU", "Port-au-Prince": "HT", Santo_Domingo: "DO", Jamaica: "JM", Sao_Paulo: "BR", Bahia: "BR", Fortaleza: "BR", Recife: "BR", Manaus: "BR", Belem: "BR",
  Buenos_Aires: "AR", Cordoba: "AR", Santiago: "CL", Bogota: "CO", Lima: "PE", Caracas: "VE", Guayaquil: "EC", La_Paz: "BO", Asuncion: "PY", Montevideo: "UY",
  Kolkata: "IN", Calcutta: "IN", Karachi: "PK", Dhaka: "BD", Kathmandu: "NP", Colombo: "LK", Kabul: "AF", Maldives: "MV",
  Shanghai: "CN", Urumqi: "CN", Hong_Kong: "HK", Taipei: "TW", Tokyo: "JP", Seoul: "KR", Pyongyang: "KP", Ulaanbaatar: "MN",
  Singapore: "SG", Kuala_Lumpur: "MY", Kuching: "MY", Jakarta: "ID", Makassar: "ID", Jayapura: "ID", Manila: "PH", Bangkok: "TH", Ho_Chi_Minh: "VN", Saigon: "VN", Yangon: "MM", Rangoon: "MM", Phnom_Penh: "KH", Vientiane: "LA",
  Almaty: "KZ", Tashkent: "UZ", Ashgabat: "TM", Bishkek: "KG", Dushanbe: "TJ", Baku: "AZ", Tbilisi: "GE", Yerevan: "AM",
  Sydney: "AU", Melbourne: "AU", Brisbane: "AU", Perth: "AU", Adelaide: "AU", Hobart: "AU", Darwin: "AU", Auckland: "NZ", Port_Moresby: "PG", Fiji: "FJ",
};
function detectCountry() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    if (/^(America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage|Detroit|Boise|Juneau|Adak|Nome|Sitka|Indiana|Kentucky|North_Dakota|Menominee)|Pacific\/Honolulu|US\/)/.test(tz)) return "US";
    const c = TZ_COUNTRY[tz.split("/").pop()];
    if (c) return c;
  } catch { /* no Intl time zone */ }
  const lang = (navigator.language || "").split("-")[1];
  return lang && GEO[lang.toUpperCase()] ? lang.toUpperCase() : "";
}
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
  links: store.get("links", DEFAULTS.links), // search links under each headline (new key, so the old "off" default is gone)
  // Near me became the default in Oct 2026: show it once to people whose browser remembers another tab.
  cat: store.get("seen-near", false) ? store.get("cat", DEFAULTS.cat) : (store.set("seen-near", true), store.set("cat", "near"), "near"),
  hours: store.get("hours", DEFAULTS.hours), // show headlines from the last N hours
  country: store.get("country", null) ?? detectCountry(), // "Near me" centre; "" = no location
  ratings: store.get("ratings", {}), // source name → 1 (👍) or -1 (👎); this browser only
  near: null, // near.json: Google News per-country searches
  sectionsOpen: new Set(), // "Near me" sections showing all their stories
  actsOpen: null, // the row whose actions were opened with ⋯ (phones)
  editTerms: null, // the story whose search words are being chosen (✎)
  topHidden: store.get("top-hidden", false), // the Top stories strip folded away
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
    const t = Date.now();
    // near.json (Google News per-country searches) is optional: Near me still works from feed.json alone.
    const nearReq = fetch("near.json?t=" + t, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const res = await fetch("feed.json?t=" + t, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    const near = await nearReq;
    showError(null);
    const changed = !state.data || state.data.generated_at !== data.generated_at ||
      (near && (!state.near || state.near.generated_at !== near.generated_at));
    state.data = data;
    if (near) state.near = near;
    updateFreshness();
    if (changed) update(manual);
    if (manual) pollLive(true);
  } catch (e) {
    showError("Couldn't load the latest headlines (" + e.message + "). " + (state.items.length ? "Showing the last ones loaded." : "Press Refresh to try again."));
    if (!state.items.length) $("feed").innerHTML = '<div class="empty">No headlines yet. Press Refresh to try again.</div>';
  } finally {
    state.loading = false;
    $("btn-fetch").textContent = "Refresh now";
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
  renderRail(); // "updated 3m ago"
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

const normTitle = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function combined() {
  const base = state.data ? state.data.items : [];
  const ids = new Set(base.map((i) => i.id));
  const urls = new Set(base.map((i) => i.url));
  const titles = new Set(base.map((i) => normTitle(i.title)));
  const keep = (i) => {
    const t = normTitle(i.title);
    if (ids.has(i.id) || urls.has(i.url) || titles.has(t)) return false;
    ids.add(i.id); urls.add(i.url); titles.add(t);
    return true;
  };
  // Google News country items (category "local") only show in Near me; drop ones the main feed already has.
  const extra = [...state.live.values(), ...(state.near ? state.near.items : [])].filter(keep);
  return extra.length ? base.concat(extra).sort((a, b) => Date.parse(b.published) - Date.parse(a.published)) : base;
}

function update(manual) {
  const next = combined();
  computeBreaking(next.filter((i) => i.category !== "local" && !hiddenSource(i.source)));
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

// cleanHeadline drops labels like "| WION Shorts": shared by unrelated videos, they would group them as one story.
function tokens(title) {
  return new Set(cleanHeadline(title).toLowerCase().replace(/[’']s\b/g, "").split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w)));
}

const tokenCache = new Map(); // title → tokens, so re-renders don't re-split thousands of titles
function cachedTokens(title) {
  let t = tokenCache.get(title);
  if (!t) {
    if (tokenCache.size > 20000) tokenCache.clear();
    tokenCache.set(title, (t = [...tokens(title)]));
  }
  return t;
}

// Groups reports of the same story: a later headline joins an earlier one when they share 3+ keywords,
// or 2 that make up a third of their keywords. An index from keyword to headlines means each headline
// is only compared with the ones that share a word with it (thousands of headlines, ~50 ms).
function clusterItems(items) {
  const toks = items.map((i) => cachedTokens(i.title));
  const index = new Map();
  toks.forEach((ts, i) => { for (const t of ts) { let list = index.get(t); if (!list) index.set(t, (list = [])); list.push(i); } });
  const used = new Uint8Array(items.length);
  const shared = new Map();
  const out = [];
  for (let a = 0; a < items.length; a++) {
    if (used[a]) continue;
    used[a] = 1;
    shared.clear();
    for (const t of toks[a]) for (const b of index.get(t)) if (b > a && !used[b]) shared.set(b, (shared.get(b) || 0) + 1);
    const related = [];
    for (const b of [...shared.keys()].sort((x, y) => x - y)) {
      const n = shared.get(b);
      const union = toks[a].length + toks[b].length - n;
      if (n >= 3 || (n >= 2 && union > 0 && n / union >= 0.34)) {
        used[b] = 1;
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

// ---------- ratings (this browser only) ----------

const rating = (source) => state.ratings[source] || 0;
const hiddenSource = (source) => rating(source) < 0;

function rate(source, value) {
  if (rating(source) === value) delete state.ratings[source]; else state.ratings[source] = value;
  store.set("ratings", state.ratings);
  computeBreaking(state.items.filter((i) => i.category !== "local" && !hiddenSource(i.source)));
  render();
  if (state.panel === "sources") renderPanel();
}

// A 👍 source's report leads its story: the row shows its headline, the others go under "+N reports".
// The row keeps its place in time (the story's newest report).
function preferFavourites(view) {
  for (const s of view) {
    if (rating(s.item.source) > 0 || !s.related.length) continue;
    const fav = s.related.find((r) => rating(r.source) > 0);
    if (fav) {
      s.related = [s.item, ...s.related.filter((r) => r !== fav)];
      s.newest = s.item.published;
      s.item = fav;
    }
  }
  return view;
}

// ---------- near me ----------

// 0 = your country, 1 = its neighbourhood, 2 = its region, 3 = elsewhere (or no country known).
function ringOf(geo) {
  const me = state.country;
  if (!me || !geo || !geo.length) return 3;
  if (geo.includes(me)) return 0;
  const g = GEO[me];
  if (!g) return 3;
  if (geo.some((c) => g.hoodSet.has(c))) return 1;
  if (geo.some((c) => g.regionSet.has(c))) return 2;
  return 3;
}

// Where a story belongs: its headline's countries; if the headline names none, where most of its
// reports point (one Kuwaiti outlet's take on a Saudi story doesn't make it Kuwaiti news).
function storyRing(s) {
  if (s.item.geo && s.item.geo.length) return ringOf(s.item.geo);
  const votes = [0, 0, 0, 0];
  for (const r of s.related) if (r.geo && r.geo.length) votes[ringOf(r.geo)]++;
  const best = Math.max(...votes);
  return best ? votes.indexOf(best) : 3;
}

function ringTitles() {
  const g = GEO[state.country];
  return [countryName(state.country), g ? g.hood : "", g ? g.region : "", "Rest of the world"];
}

const SECTION_CAP = 8; // stories shown per Near me section before "See all", so every ring fits at a glance

// Time-ordered views get dividers instead of an age on every row.
function timeBucket(iso) {
  const t = new Date(iso), now = new Date();
  const mins = (now - t) / 60000;
  if (mins < 60) return "Last hour";
  if (mins < 180) return "1–3 hours ago";
  if (t.toDateString() === now.toDateString()) return "Earlier today";
  const y = new Date(now); y.setDate(now.getDate() - 1);
  return t.toDateString() === y.toDateString() ? "Yesterday" : "Older";
}

// ---------- rendering ----------

function filtered() {
  const q = state.query.trim().toLowerCase();
  const since = Date.now() - state.hours * 3600e3;
  return state.items.filter((i) =>
    Date.parse(i.published) >= since &&
    !hiddenSource(i.source) &&
    (state.cat === "near" ? true
      : i.category === "local" ? false
      : state.cat === "all" || (state.cat === "video" ? i.media === "video" : i.category === state.cat)) &&
    (!state.source || i.source === state.source) &&
    (!q || i.title.toLowerCase().includes(q) || i.source.toLowerCase().includes(q) || (i.summary || "").toLowerCase().includes(q)));
}

function render() {
  const list = filtered();
  let view = preferFavourites(state.cluster ? clusterItems(list) : list.map((item) => ({ item, related: [] })));
  let sections = null;
  if (state.cat === "near" && state.country) {
    // Split into rings; within each ring stories stay newest first.
    const rings = [[], [], [], []];
    for (const s of view) rings[storyRing(s)].push(s);
    const titles = ringTitles();
    view = [];
    sections = [];
    rings.forEach((r, n) => {
      if (!r.length) return;
      const open = state.sectionsOpen.has(n) || r.length <= SECTION_CAP + 2;
      const shown = open ? r : r.slice(0, SECTION_CAP);
      sections.push({ n, title: titles[n], start: view.length, count: r.length, more: r.length - shown.length });
      view.push(...shown);
    });
  }
  state.view = view;
  if (state.sel >= state.view.length) state.sel = state.view.length - 1;
  $("count").textContent = state.cluster ? list.length + " reports · " + (sections ? sections.reduce((a, s) => a + s.count, 0) : view.length) + " stories" : list.length + " headlines";

  const feed = $("feed");
  if (!state.view.length) {
    feed.innerHTML = '<div class="empty">' + (state.items.length ? 'Nothing matches these filters. <button class="chip reset" data-reset>↺ Reset</button>' : "No headlines yet. Press Refresh to try again.") + "</div>";
  } else if (sections) {
    let h = "";
    for (const sec of sections) {
      h += '<h2 class="ring" data-n="' + sec.n + '"><span>' + (sec.n === 0 ? "📍 " : "") + esc(sec.title) + '</span><span class="ring-n">' + sec.count + " stor" + (sec.count === 1 ? "y" : "ies") + "</span></h2>";
      for (let i = sec.start; i < sec.start + sec.count - sec.more; i++) h += rowHTML(state.view[i], i);
      if (sec.more) h += '<button class="ring-more" data-ring="' + sec.n + '">See all ' + sec.count + " from " + esc(sec.title) + " →</button>";
      else if (sec.count > SECTION_CAP + 2) h += '<button class="ring-more" data-ring-close="' + sec.n + '">Show fewer from ' + esc(sec.title) + "</button>";
    }
    feed.innerHTML = h;
  } else {
    let h = "", last = "";
    state.view.forEach((s, idx) => {
      const b = timeBucket(s.newest || s.item.published);
      if (b !== last) { h += '<div class="tdiv">' + b + "</div>"; last = b; }
      h += rowHTML(s, idx);
    });
    feed.innerHTML = h;
  }
  renderHiddenNote(list);
  renderTop();
  renderRail();
  renderCatCounts();
  if (state.panel === "heat") renderPanel();
}

function renderHiddenNote() {
  const hidden = Object.keys(state.ratings).filter((s) => state.ratings[s] < 0);
  const el = $("hidden-note");
  el.hidden = !hidden.length;
  el.innerHTML = hidden.length ? "👎 Hiding " + hidden.length + " source" + (hidden.length > 1 ? "s" : "") + ": " + hidden.slice(0, 4).map(esc).join(", ") + (hidden.length > 4 ? "…" : "") +
    ' <button class="chip" data-manage>Manage</button>' : "";
}

// ---------- top stories ----------

// The biggest stories right now: many different sources × fresh, more for breaking, more near you.
// Only in Near me and All, and not while searching or showing one source.
const TOP_COUNT = 6;
function topStories() {
  const now = Date.now();
  const recent = state.items.filter((i) => now - Date.parse(i.published) < 6 * 3600e3 && !hiddenSource(i.source) &&
    (state.cat === "near" || i.category !== "local"));
  const near = state.cat === "near" && state.country;
  const scored = [];
  for (const s of preferFavourites(clusterItems(recent))) {
    const all = [s.item, ...s.related];
    const sources = new Set(all.map((i) => i.source));
    if (sources.size < 3) continue;
    const newest = Math.max(...all.map((i) => Date.parse(i.published)));
    const ageH = (now - newest) / 3600e3;
    const breaking = all.some((i) => state.breakingIds.has(i.id));
    const ring = near ? storyRing(s) : 3;
    const score = sources.size * Math.exp(-ageH / 4) * (breaking ? 1.5 : 1) * (near ? [1.8, 1.4, 1.15, 1][ring] : 1);
    // The headline: a 👍 source's (preferFavourites), else a news outlet's rather than a social post.
    const lead = rating(s.item.source) > 0 ? s.item : all.find((i) => !i.social) || s.item;
    scored.push({ lead, sources: [...sources], reports: all.length, newest, breaking, ring, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, TOP_COUNT);
}

function renderTop() {
  const el = $("topstories");
  const show = (state.cat === "near" || state.cat === "all") && !state.query && !state.source && state.items.length;
  el.hidden = !show;
  if (!show) return;
  if (state.topHidden) { el.innerHTML = '<button class="chip ts-show" data-top-toggle>▸ Top stories now</button>'; return; }
  const top = topStories();
  if (!top.length) { el.hidden = true; return; }
  const titles = ringTitles();
  el.innerHTML = '<div class="ts-head"><h2>Top stories now</h2><span class="ts-sub">most-reported in the last 6 hours</span><button class="chip" data-top-toggle title="Hide top stories">Hide</button></div>' +
    '<div class="ts-grid">' + top.map((t) => {
      const others = t.sources.filter((s) => s !== t.lead.source);
      return '<article class="ts-card' + (t.breaking ? " brk" : "") + '">' +
        '<div class="ts-tags">' + (t.breaking ? '<span class="brk-tag">Breaking</span>' : "") + (state.cat === "near" && t.ring < 3 ? '<span class="ts-place">' + (t.ring === 0 ? "📍 " : "") + esc(titles[t.ring]) + "</span>" : "") + "</div>" +
        '<a class="ts-title" href="' + esc(t.lead.url) + '" target="_blank" rel="noopener" data-id="' + t.lead.id + '">' + mediaIcon(t.lead) + esc(t.lead.title) + "</a>" +
        '<div class="ts-foot"><span title="' + esc(t.sources.join(", ")) + '">' + esc(t.lead.source) + (others.length ? " + " + others.length + " more" : "") + '</span> · <span data-t="' + new Date(t.newest).toISOString() + '">' + timeAgo(new Date(t.newest).toISOString()) + "</span>" +
        '<button class="ts-all" data-jump="' + t.lead.id + '" title="Show all ' + t.reports + ' reports in the feed">' + t.reports + " reports →</button></div></article>";
    }).join("") + "</div>";
}

// ---------- side panel (wide screens) ----------

function renderRail() {
  const rail = $("rail");
  if (!window.matchMedia("(min-width: 1200px)").matches) { rail.innerHTML = ""; return; } // phones/laptops: ⚙ View has the same things
  const d = state.data;
  let h = '<section class="card rail-box"><h3>Trending · last 6h</h3>';
  const terms = trendingTerms(12);
  h += terms.length ? '<div class="rail-terms">' + terms.map(([t, n]) => '<button class="kw-chip" data-kw="' + esc(t) + '" title="Search for ' + esc(t) + '">' + esc(t) + ' <span class="n">' + n + "</span></button>").join("") + "</div>" : "<p>Not enough data yet.</p>";
  h += "</section>";

  const up = Object.keys(state.ratings).filter((s) => state.ratings[s] > 0).sort();
  const down = Object.keys(state.ratings).filter((s) => state.ratings[s] < 0).length;
  h += '<section class="card rail-box"><h3>Your sources</h3>' + (up.length
    ? '<div class="rail-list">' + up.map((s) => '<button class="src" data-src="' + esc(s) + '" style="--h:' + srcHue(s) + '" title="Show only ' + esc(s) + '">' + esc(s) + "</button>").join("") + "</div>"
    : "<p>👍 a source (hover over any headline) to make its reports lead their stories. They'll be listed here.</p>") +
    (down ? '<p class="rail-note">👎 hiding ' + down + ' · <button class="link" data-manage>manage</button></p>' : "") + "</section>";

  if (d) {
    const all = d.sources, failing = all.filter((s) => !s.ok);
    h += '<section class="card rail-box"><h3>Sources</h3><p><span class="dot ' + (failing.length ? "warn" : "ok") + '"></span> ' + (all.length - failing.length) + " of " + all.length + " working · updated " + timeAgo(d.generated_at) + " ago</p>" +
      (failing.length ? '<ul class="rail-fail">' + failing.slice(0, 4).map((s) => "<li>" + (s.parked ? "⏸ " : "✕ ") + esc(s.name) + "</li>").join("") + "</ul>" : "") +
      '<button class="link" data-manage>All sources and ratings →</button></section>';
  }
  rail.innerHTML = h;
}

// 👍 / 👎 for a source. data-rate-src (not data-src) so a click rates instead of filtering.
function rateHTML(source) {
  const r = rating(source);
  return '<span class="rate"><button class="' + (r > 0 ? "on" : "") + '" data-rate="1" data-rate-src="' + esc(source) + '" title="' + (r > 0 ? "Remove 👍 from " : "👍 Prefer ") + esc(source) + (r > 0 ? "" : ": its reports lead their stories") + '" aria-pressed="' + (r > 0) + '">👍</button>' +
    '<button class="' + (r < 0 ? "on" : "") + '" data-rate="-1" data-rate-src="' + esc(source) + '" title="' + (r < 0 ? "Show " + esc(source) + " again" : "👎 Hide " + esc(source) + " (undo under Sources)") + '" aria-pressed="' + (r < 0) + '">👎</button></span>';
}

// "via Reuters" for wire copy; "+N copies" when other outlets ran the same story word for word.
function syndHTML(item) {
  let h = "";
  if (item.via) h += '<span class="via" title="This story comes from ' + esc(item.via) + '">via ' + esc(item.via) + "</span>";
  if (item.also && item.also.length) h += '<span class="via" title="Also ran word for word by: ' + esc(item.also.join(", ")) + '">+' + item.also.length + " cop" + (item.also.length > 1 ? "ies" : "y") + "</span>";
  return h;
}

function srcHTML(item, tag) {
  return "<" + tag + ' class="src" data-src="' + esc(item.source) + '" style="--h:' + srcHue(item.source) + '" title="Show only ' + esc(item.source) + '">' + esc(item.source) + "</" + tag + ">" +
    (item.social ? ' <span class="plat" title="Social post, unverified">' + (item.id.startsWith("tg-") ? "TG" : "BSKY") + "</span>"
      : item.id.startsWith("yt-") ? ' <span class="plat" title="Video from the outlet\'s YouTube channel">YT</span>' : "");
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
  if (state.actsOpen === item.id || state.editTerms === item.id) cls.push("acts-open"); // ✎ open: keep it showing
  // Two short lines: the headline, then "source · +N reports". The rest (exact time, 👍/👎, copies,
  // search links) sits in .acts, shown on hover on a computer or after tapping ⋯ on a phone.
  // In the time-ordered views, "Last hour / Earlier today…" dividers replace the per-row age; Near me's
  // sections have no dividers, so its rows keep a short age.
  let h = '<article class="' + cls.join(" ") + '" id="row-' + idx + '">';
  h += '<a class="title" href="' + esc(item.url) + '" target="_blank" rel="noopener" data-id="' + item.id + '">' + mediaIcon(item) + esc(item.title) + "</a>";
  h += '<div class="meta">' + (breaking ? '<span class="brk-tag">Breaking</span>' : "") + srcHTML(item, "button");
  if (state.cat === "near") h += '<span class="age" data-t="' + item.published + '" title="' + esc(fullTime(item.published)) + '">' + timeAgo(item.published) + "</span>";
  if (related.length || item.summary) {
    const label = related.length ? (open ? "Hide " : "+") + related.length + " report" + (related.length > 1 ? "s" : "") : open ? "Less" : "More";
    h += '<button class="more" data-toggle="' + item.id + '" aria-expanded="' + open + '">' + label + "</button>";
  }
  h += '<button class="dots" data-acts="' + item.id + '" aria-expanded="' + (state.actsOpen === item.id) + '" aria-label="More actions" title="Time, 👍 / 👎, search links">⋯</button>';
  h += '<span class="acts"><span class="when" data-t="' + item.published + '" data-clock title="' + esc(fullTime(item.published)) + '">' + timeAgo(item.published) + " · " + hhmm(item.published) + "</span>" +
    rateHTML(item.source) + syndHTML(item) + (state.links ? videoLinks(item, related) : "") + "</span>";
  h += "</div>";
  if (open) {
    if (item.summary) h += '<div class="summary">' + esc(item.summary) + "</div>";
    if (related.length) {
      h += '<div class="related">' + related.map((r) =>
        '<div class="r">' + srcHTML(r, "button") + ' <span class="ago" data-t="' + r.published + '">' + timeAgo(r.published) + '</span><a href="' + esc(r.url) + '" target="_blank" rel="noopener" data-id="' + r.id + '">' + mediaIcon(r) + esc(r.title) + "</a></div>").join("") + "</div>";
    }
  }
  return h + "</article>";
}

// Compact: one line per story (time · source · headline · "+N"); details open underneath.
function compactRowHTML(item, related, idx, cls, breaking, open) {
  let h = '<article class="' + cls.join(" ") + ' c" id="row-' + idx + '">';
  h += '<span class="c-time" title="' + esc(fullTime(item.published)) + " (" + timeAgo(item.published) + ' ago)">' + hhmm(item.published) + "</span>";
  h += '<span class="c-src">' + srcHTML(item, "button") + "</span>";
  h += '<a class="title" href="' + esc(item.url) + '" target="_blank" rel="noopener" data-id="' + item.id + '" title="' + esc(item.title) + '">' +
    (breaking ? '<span class="brk-tag">Breaking</span> ' : "") + mediaIcon(item) + esc(item.title) + "</a>";
  { // always there: details hold 👍/👎 too
    const label = related.length ? "+" + related.length : open ? "−" : "…";
    const tip = related.length ? related.length + " more report" + (related.length > 1 ? "s" : "") : "Details, 👍 / 👎";
    h += '<button class="more" data-toggle="' + item.id + '" aria-expanded="' + open + '" title="' + tip + '">' + label + "</button>";
  }
  if (open) {
    h += '<div class="c-open">';
    h += '<div class="meta">' + srcHTML(item, "button") + rateHTML(item.source) + '<span class="when" data-t="' + item.published + '">' + timeAgo(item.published) + "</span>" + syndHTML(item) + "</div>";
    if (item.summary) h += '<div class="summary">' + esc(item.summary) + "</div>";
    if (state.links) h += '<div class="actions">' + videoLinks(item, related) + "</div>";
    if (related.length) {
      h += '<div class="related">' + related.map((r) =>
        '<div class="r">' + srcHTML(r, "button") + ' <span class="ago" data-t="' + r.published + '">' + timeAgo(r.published) + '</span><a href="' + esc(r.url) + '" target="_blank" rel="noopener" data-id="' + r.id + '">' + mediaIcon(r) + esc(r.title) + "</a></div>").join("") + "</div>";
    }
    h += "</div>";
  }
  return h + "</article>";
}


// ---------- search terms ----------
// The search links under each headline need words that pin the story down without being so literal
// that they find nothing. Five ideas work together:
//  1. Story consensus: words that several of a story's reports use describe the event; one outlet's
//     own phrasing doesn't. Units are scored by how many of the story's sources use them.
//  2. Rarity: a word in hundreds of today's headlines ("Trump", "war") narrows little; one in a few
//     ("Woodford", "Mandeb") pins the story down. Scored by inverse document frequency over the feed.
//  3. Cleaning: headline labels ("From Breakingviews -", "COMMENTARY:", "LIVE:", "| Firstpost") go;
//     names stay whole ("Bab el-Mandeb", "South Korea"); spellings are unified (Türkiye → Turkey).
//  4. Each site gets its own syntax and number of words (below).
//  5. You can change the words: ✎ in a headline's actions shows them as chips to switch on or off.

// Filler words and weak verbs that never make a good search term.
const SEARCH_STOP = new Set(("the and for are was were has had have his her its our not but all any can out who how why what when where new one two " +
  "says said say tell tells told after over amid amidst report reports video videos watch live latest update updates breaking exclusive analysis opinion " +
  "will would could should than then them they this that these those with from into onto about against more most " +
  "plan plans set sets get gets make makes take takes hit hits seek seeks warn warns urge urges call calls vow vows eye eyes face faces look looks " +
  "launch launches secure secures weigh weighs announce announced announces speak speaks hold holds held reach reaching reached see sees come comes " +
  "move moves back backs push pushes probe probes split splits buy buys sell sells worth million millions billion billions percent per cent " +
  "put puts faced faces goes going gets got give gives given show shows shown keep keeps kept " +
  "people time times days year years week weeks month months first last next amid during while still also just only very much many " +
  "three four five six seven eight nine ten dozens hundreds thousands " +
  "here there now today tonight morning evening news story stories photo photos images pictures shorts").split(" "));
// Titles in front of a name ("Rep. Ilhan Omar"): dropped so the name itself is the search term.
const HONORIFICS = new Set("rep sen gov pres mr mrs ms dr st lt gen col sgt capt prof sheikh hon".split(" "));
const WEAK_OPENERS = new Set("former green red orange yellow amber new top big major senior acting interim early late deadly fatal huge massive second third final key".split(" "));

// Headline labels and show names that aren't part of the story.
const LABEL_RES = [
  /^\s*from\s+[\p{L} ]{2,30}?\s+-\s+/iu, // "From Breakingviews - "
  /^\s*(breakingviews|commentary|analysis|opinion|explainer|exclusive|live|watch|video|breaking|factbox|instant view|insight|editorial|update\s*\d*)\s*[-:–—|]+\s*/i,
];
function cleanHeadline(title) {
  let t = title;
  for (let i = 0; i < 4; i++) for (const re of LABEL_RES) t = t.replace(re, "");
  const pipe = t.split(/\s+\|\s+/); // "Story | Firstpost", "Story | AJ #shorts"
  if (pipe.length > 1 && pipe[0].length >= 20) t = pipe[0];
  return t.replace(/#[\p{L}\p{N}_]+/gu, " ").replace(/\s+/g, " ").trim() || title;
}

// One spelling per name, so different outlets' versions count as the same word.
const SYNONYMS = { "türkiye": "turkey", "turkiye": "turkey", "houthis": "houthi", "kiev": "kyiv", "u.s": "us", "usa": "us", "u.k": "uk" };
// X understands OR, so it gets both spellings.
const X_VARIANTS = { turkey: "(Turkey OR Türkiye)", kyiv: "(Kyiv OR Kiev)", houthi: "(Houthi OR Houthis)" };
const CONNECTORS = new Set("al el de du da di bin ibn van von der la le".split(" "));
const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}’'.\-]*/gu;
const isCap = (w) => /^\p{Lu}/u.test(w);
const termKey = (w) => { const k = w.toLowerCase().replace(/[’']s$/, "").replace(/\.$/, ""); return SYNONYMS[k] || k; };

// A headline's candidate terms: single words, plus two-word names ("South Korea", "Bab el-Mandeb").
function headlineUnits(title) {
  const ws = (cleanHeadline(title).match(WORD_RE) || [])
    .map((w) => w.replace(/[’']s$/i, "").replace(/^[’'.\-]+|[’'.\-]+$/g, "")) // "View'" → "View", "Omar's" → "Omar"
    .filter((w) => w && !HONORIFICS.has(w.toLowerCase()));
  const titleCase = ws.length >= 4 && ws.filter(isCap).length / ws.length >= 0.7; // capitals mean nothing there
  const good = (w) => {
    const k = termKey(w);
    return !STOP.has(k) && !SEARCH_STOP.has(k) && !/^\d/.test(k) && (k.length >= 3 || (k.length === 2 && w === w.toUpperCase()));
  };
  const out = [];
  ws.forEach((w, i) => {
    if (good(w)) out.push({ key: termKey(w), text: w, words: [termKey(w)], name: isCap(w) && !titleCase && !(i === 0 && WEAK_OPENERS.has(w.toLowerCase())), pos: i });
  });
  if (!titleCase) {
    for (let i = 0; i < ws.length - 1; i++) {
      let a = ws[i], b = ws[i + 1], j = i + 1;
      if (CONNECTORS.has(b.toLowerCase()) && i + 2 < ws.length) { b = b + " " + ws[i + 2]; j = i + 2; } // "Bab el Mandeb"
      const last = ws[j];
      if (!isCap(a) || !isCap(last) || (i === 0 && WEAK_OPENERS.has(a.toLowerCase()))) continue;
      if (j + 1 < ws.length && isCap(ws[j + 1])) continue; // part of a longer run: too literal to quote
      if (i > 0 && isCap(ws[i - 1]) && !(i === 1 && WEAK_OPENERS.has(ws[0].toLowerCase()))) continue;
      const parts = (a + " " + b).split(" ");
      if (!parts.every((p) => CONNECTORS.has(p.toLowerCase()) || good(p))) continue;
      out.push({ key: parts.map(termKey).join(" "), text: a + " " + b, words: parts.filter((p) => !CONNECTORS.has(p.toLowerCase())).map(termKey), name: true, pos: i });
    }
  }
  return out;
}

// How many of today's headlines use each word (for rarity), rebuilt when the feed changes.
let dfCache = { items: null, map: new Map(), n: 1 };
function docFreq() {
  if (dfCache.items === state.items) return dfCache;
  const map = new Map();
  for (const it of state.items) for (const k of new Set((cleanHeadline(it.title).match(WORD_RE) || []).map(termKey))) map.set(k, (map.get(k) || 0) + 1);
  termCache.clear(); // scores depend on these counts
  return (dfCache = { items: state.items, map, n: state.items.length || 1 });
}

// All of a story's candidate terms, best first.
const termCache = new Map();
function storyTerms(item, related) {
  const reports = [item, ...related].slice(0, 30);
  const df = docFreq(); // first, so a changed feed clears the cache
  const cacheKey = item.id + "|" + reports.length;
  if (termCache.has(cacheKey)) return termCache.get(cacheKey);
  const sources = new Set(reports.map((r) => r.source)).size;
  const stats = new Map();
  reports.forEach((r, ri) => {
    for (const u of headlineUnits(r.title)) {
      let s = stats.get(u.key);
      if (!s) stats.set(u.key, (s = { ...u, srcs: new Set(), pos: ri === 0 ? u.pos : 1000 + u.pos }));
      s.srcs.add(r.source);
      if (ri === 0 && s.pos >= 1000) { s.pos = u.pos; s.text = u.text; }
      s.name = s.name || u.name;
    }
  });
  for (const s of stats.values()) {
    const d = Math.min(...s.words.map((w) => df.map.get(w) || 1));
    const rarity = Math.log((df.n + 1) / (d + 1)) + 0.1;
    const shared = sources > 1 ? s.srcs.size / sources : 1; // 1: consensus across the story's sources
    s.score = rarity * (0.4 + shared) * (s.name ? 1.25 : 1) * (s.words.length > 1 ? 1.3 : 1);
  }
  const ranked = [...stats.values()].sort((a, b) => b.score - a.score);
  if (termCache.size > 5000) termCache.clear();
  termCache.set(cacheKey, ranked);
  return ranked;
}

// The best terms within a word budget, in headline order; a name blocks its own words.
// must: a term that has to be in (the country the headline names), placed first.
function pickTerms(ranked, budget, must) {
  const chosen = [], used = new Set();
  let n = 0;
  for (const u of must ? [must, ...ranked.filter((x) => x !== must)] : ranked) {
    if (u.words.some((w) => used.has(w)) || n + u.words.length > budget) continue;
    chosen.push(u);
    u.words.forEach((w) => used.add(w));
    n += u.words.length;
    if (n >= budget) break;
  }
  return chosen.sort((a, b) => a.pos - b.pos);
}

// 4. Per site: how many words, and its own syntax. Each link asks for the newest results the site allows.
// YouTube no longer sorts by date (even its "Recently uploaded" chip ranks by relevance), so its link uses an
// upload-date filter: "last hour" for a busy fresh story (live streams and minutes-old uploads first), else
// "this week", because the last-hour filter finds nothing on a quiet story.
const YT_HOUR = "EgIIAQ%253D%253D", YT_WEEK = "EgIIAw%253D%253D";
const SEARCH_SITES = [
  { name: "X", words: 4, quote: true, or: true, url: (q) => "https://x.com/search?q=" + encodeURIComponent(q + " -filter:replies") + "&f=live" },
  { name: "YouTube", words: 3, url: (q, ctx) => "https://www.youtube.com/results?search_query=" + encodeURIComponent(q) + "&sp=" + (ctx.hot ? YT_HOUR : YT_WEEK),
    tip: (ctx) => (ctx.hot ? "uploaded in the last hour (busy story)" : "uploaded this week") },
  { name: "Google News", words: 4, quote: true, url: (q, ctx) => "https://www.google.com/search?q=" + encodeURIComponent(q) + "&tbm=nws&tbs=" + (ctx.ageH < 20 ? "qdr:d," : "qdr:w,") + "sbd:1",
    tip: (ctx) => (ctx.ageH < 20 ? "past 24 hours" : "past week") + ", newest first" },
  { name: "Yandex Video", words: 4, url: (q) => "https://yandex.com/video/search?text=" + encodeURIComponent(q) + "&how=tm", tip: () => "newest first" },
  { name: "Bilibili", words: 2, url: (q) => "https://www.bilibili.tv/en/search-result?q=" + encodeURIComponent(q), tip: () => "by relevance (no date sort)" },
];
function siteQuery(units, site) {
  return units.map((u) => (site.or && X_VARIANTS[u.key]) || (site.quote && u.text.includes(" ") ? '"' + u.text + '"' : u.text)).join(" ");
}

// 5. Your own picks per story, from the ✎ chips: story id → Set of term keys.
const termEdits = new Map();

// The country a headline names is the search's anchor, even when it's common today ("Saudi" is in
// hundreds of headlines, but "Strikes Put Economy Pressure" without it finds anything). Only when the
// headline itself says it (item.geo can also come from the outlet's home country).
function anchorTerm(item, ranked) {
  for (const code of item.geo || []) {
    const name = countryName(code).toLowerCase();
    const cand = ranked.filter((u) => u.pos < 1000 && (name === u.key || name.startsWith(u.key + " ") || (u.key.length >= 4 && (u.key.startsWith(name) || name.startsWith(u.key)))));
    if (cand.length) return cand.sort((a, b) => b.words.length - a.words.length || b.score - a.score)[0];
  }
  return null;
}

function videoLinks(item, related = []) {
  const ageH = (Date.now() - Date.parse(item.published)) / 3600e3;
  const ctx = { ageH, hot: ageH < 3 && (related.length >= 1 || state.breakingIds.has(item.id)) };
  const ranked = storyTerms(item, related);
  if (!ranked.length) return "";
  const edited = termEdits.get(item.id);
  const mine = edited ? ranked.filter((u) => edited.has(u.key)).sort((a, b) => a.pos - b.pos) : null;
  const must = anchorTerm(item, ranked);
  let h = '<span class="vids"><span class="vlab">Search:</span>' + SEARCH_SITES.map((site) => {
    const units = mine && mine.length ? mine : pickTerms(ranked, site.words, must);
    const q = siteQuery(units, site);
    return '<a href="' + esc(site.url(q, ctx)) + '" target="_blank" rel="noopener" title="' + esc(site.name + ": " + q + (site.tip ? " · " + site.tip(ctx) : "")) + '">' + site.name + "</a>";
  }).join("");
  const open = state.editTerms === item.id;
  h += '<button class="term-edit" data-edit-terms="' + item.id + '" aria-expanded="' + open + '" title="Choose the search words">✎</button></span>';
  if (open) {
    const on = new Set((mine && mine.length ? mine : pickTerms(ranked, 4, must)).map((u) => u.key));
    const onWords = new Set(ranked.filter((u) => on.has(u.key)).flatMap((u) => u.words));
    const offer = ranked.filter((u) => !on.has(u.key) && !u.words.some((w) => onWords.has(w))).slice(0, 6); // not "+ Saudi" next to "Saudi Arabia"
    const chip = (u, isOn) => '<button class="term' + (isOn ? " on" : "") + '" data-term="' + esc(u.key) + '" data-term-id="' + item.id + '" aria-pressed="' + isOn + '">' + (isOn ? "" : "+ ") + esc(u.text) + "</button>";
    h += '<span class="terms"><span class="vlab">Words:</span>' + ranked.filter((u) => on.has(u.key)).sort((a, b) => a.pos - b.pos).map((u) => chip(u, true)).join("") +
      offer.map((u) => chip(u, false)).join("") + (edited ? '<button class="term reset-terms" data-term-reset="' + item.id + '">↺ auto</button>' : "") + "</span>";
  }
  return h;
}

function toggleTerm(id, key) {
  const story = state.view.find((s) => s.item.id === id);
  if (!story) return;
  const ranked = storyTerms(story.item, story.related);
  const cur = termEdits.get(id) || new Set(pickTerms(ranked, 4, anchorTerm(story.item, ranked)).map((u) => u.key));
  if (cur.has(key)) cur.delete(key); else cur.add(key);
  termEdits.set(id, cur);
  render();
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
  const since = Date.now() - state.hours * 3600e3;
  for (const i of state.items) {
    if (Date.parse(i.published) < since || hiddenSource(i.source)) continue;
    if (state.country && ringOf(i.geo) === 0) counts.near = (counts.near || 0) + 1; // your country's count
    if (i.category === "local") continue;
    counts[i.category] = (counts[i.category] || 0) + 1;
    if (i.media === "video") counts.video = (counts.video || 0) + 1;
  }
  document.querySelectorAll("#cats button").forEach((b) => {
    const k = b.dataset.cat;
    b.querySelector(".n").textContent = k === "all" || (k === "near" && !state.country) ? "" : counts[k] || 0;
  });
}

function renderPlace() {
  const sel = $("country");
  if (!sel.options.length) {
    const codes = Object.keys(GEO).sort((a, b) => countryName(a).localeCompare(countryName(b)));
    sel.innerHTML = '<option value="">🌐 Anywhere</option>' + codes.map((c) => '<option value="' + c + '">' + esc(countryName(c)) + "</option>").join("");
  }
  sel.value = state.country || "";
  $("hours").value = String(state.hours);
}

function renderButtons() {
  const press = (id, on) => $(id).setAttribute("aria-pressed", on);
  press("btn-auto", state.auto);
  press("btn-snd", state.sound);
  press("btn-alerts", state.alerts);
  press("btn-video", state.links);
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
  renderPlace();
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
    "<div><h2>How it works</h2><p>Headlines come from about 130 public sources (news sites' RSS feeds, YouTube channels, public Telegram channels and Bluesky accounts) plus Google News searches for nearly 50 countries. A GitHub Action collects them every ~5 minutes, and this page also checks the Bluesky accounts live every minute.</p>" +
    "<p><b>📍 Near me</b> starts with your country (from your device's time zone; change it with the 📍 menu), then its neighbourhood, its region and the rest of the world, each newest first. Countries come from the places named in each headline, or the outlet's home country.</p>" +
    "<p>When several outlets run the same wire story word for word, only the earliest is shown, marked <b>via Reuters</b> (or AP…) and <b>+N copies</b>. <b>Grouped</b> puts different reports of the same story together. A story is marked <b>Breaking</b> when " + BREAK_MIN_SOURCES + " or more different sources report it within " + BREAK_WINDOW_H + " hours and the latest report is under " + BREAK_FRESH_MIN + " minutes old.</p>" +
    "<p>Each headline shows its source and how many reports it has. Hover over it (or tap <b>⋯</b> on a phone) for the exact time, 👍 / 👎 and search links. Layout, time range, alerts, Trends and Sources are under <b>⚙ View</b>.</p>" +
    "<p><b>👍</b> a source to make its reports lead their stories; <b>👎</b> one to hide it. Ratings stay in this browser only (no account). Manage them under Sources.</p>" +
    "<p>Posts marked <b>TG</b> (Telegram) or <b>BSKY</b> (Bluesky) come from social accounts and are unverified. Click a source's name to show only that source.</p>" +
    "<p><b>↺ Reset</b> clears the search and filters, closes everything and goes back to the default view. Your location, ratings, theme, alerts and sound stay as they are.</p></div></div>";
}

function sourcesHTML() {
  const d = state.data;
  if (!d) return "<h2>Sources</h2><p>No data yet.</p>";
  // Your ratings first, including outlets that only appear through Google News.
  const rated = Object.keys(state.ratings).sort((a, b) => state.ratings[b] - state.ratings[a] || a.localeCompare(b));
  let h = "<h2>Your ratings</h2>" + (rated.length
    ? '<div class="src-list">' + rated.map((name) => '<div class="src-row rated"><span>' + (state.ratings[name] > 0 ? "👍" : "👎") + "</span><span>" + esc(name) + "</span>" + rateHTML(name) + "</div>").join("") + "</div>"
    : "<p>None yet. 👍 a source to make its reports lead their stories, 👎 to hide it. Ratings stay in this browser only.</p>");
  // Each name once (several feeds can share one, like "NYT"): worst status first.
  const byName = new Map();
  for (const s of d.sources) {
    const cur = byName.get(s.name);
    if (!cur) byName.set(s.name, { ...s });
    else { cur.count += s.count; if (!s.ok) { cur.ok = false; cur.error = s.error; cur.parked = cur.parked || s.parked; } }
  }
  const all = [...byName.values()];
  const rank = (s) => (s.parked ? 0 : !s.ok ? 1 : s.count === 0 ? 2 : 3);
  const rows = all.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const failing = all.filter((s) => !s.ok).length, quiet = all.filter((s) => s.ok && !s.count).length, parked = all.filter((s) => s.parked).length;
  h += '<h2 style="margin-top:18px">Sources · ' + (all.length - failing) + " of " + all.length + " working" + (quiet ? " (" + quiet + " quiet)" : "") + (parked ? " · " + parked + " set aside" : "") + ' <span class="count">· updated ' + timeAgo(d.generated_at) + " ago</span></h2>" +
    (parked ? "<p>Sources failing for over a day are <b>set aside</b>: checked every 6 hours instead of every 5 minutes, and back automatically once they work.</p>" : "") +
    '<div class="src-list">' + rows.map((s) => '<div class="src-row"><span class="' + (!s.ok ? "bad-c" : s.count ? "ok-c" : "q-c") + '" title="' + (s.parked ? "set aside" : !s.ok ? "failing" : s.count ? "working" : "quiet") + '">' + (s.parked ? "⏸" : !s.ok ? "✕" : s.count ? "●" : "○") + "</span><span>" + esc(s.name) +
      (s.type ? ' <span class="plat">' + ({ telegram: "TG", bluesky: "BSKY", youtube: "YT" }[s.type] || s.type) + "</span>" : "") +
      "</span>" + rateHTML(s.name) + '<span class="num">' + s.count + "</span>" + (s.error ? '<span class="err">' + esc((s.parked ? "set aside: " : "") + s.error) + "</span>" : "") + "</div>").join("") + "</div>";
  return h;
}

// Most-used words in the last 6 hours' headlines (Trends panel and the side panel).
function trendingTerms(n) {
  const now = Date.now();
  const counts = new Map();
  for (const i of state.items) {
    if (now - Date.parse(i.published) >= 6 * 3600e3 || hiddenSource(i.source)) continue;
    for (const t of tokens(i.title)) counts.set(t, (counts.get(t) || 0) + 1);
  }
  return [...counts].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, n);
}

function heatHTML() {
  const now = Date.now();
  const top = trendingTerms(18);
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

// Times are shown in the reader's own time zone and clock style (24h or am/pm), from the browser's settings.
const TIME_FMT = new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" });
const FULL_FMT = new Intl.DateTimeFormat([], { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
const CLOCK_FMT = new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
function hhmm(iso) { return TIME_FMT.format(new Date(iso)); }
function fullTime(iso) { return FULL_FMT.format(new Date(iso)); }

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
// Show a story in the feed, staying in the current view when it's there (opening Near me's sections if it
// sits past their first 8), else switching to All.
function jumpTo(id) {
  applyPending();
  const at = () => state.view.findIndex((s) => s.item.id === id || s.related.some((r) => r.id === id));
  render();
  let idx = at();
  if (idx < 0 && state.cat === "near") { [0, 1, 2, 3].forEach((n) => state.sectionsOpen.add(n)); render(); idx = at(); }
  if (idx < 0) {
    state.cat = "all"; state.source = null; state.query = ""; $("search").value = "";
    renderCats();
    render();
    idx = at();
  }
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
  state.topHidden = false;
  store.set("top-hidden", false);
  state.sectionsOpen.clear();
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
$("btn-video").onclick = () => { state.links = !state.links; store.set("links", state.links); renderButtons(); render(); };
// The ⚙ View menu: everything that isn't needed all the time.
function setMenu(open) {
  $("viewmenu").hidden = !open;
  $("btn-view").setAttribute("aria-expanded", open);
}
$("btn-view").onclick = () => setMenu($("viewmenu").hidden);
// Trends / Sources / Help open a panel below the bar, so the menu closes to show it.
$("btn-heat").onclick = () => { setMenu(false); togglePanel("heat"); };
$("btn-sources").onclick = () => { setMenu(false); togglePanel("sources"); };
$("btn-help").onclick = () => { setMenu(false); togglePanel("help"); };
$("view").onclick = (e) => { const b = e.target.closest("button"); if (b) setCluster(b.dataset.v === "grouped"); };
$("density").onclick = (e) => { const b = e.target.closest("button"); if (b) setDensity(b.dataset.v); };
$("staged").onclick = () => { applyPending(); window.scrollTo({ top: 0 }); };
$("search").oninput = (e) => { state.query = e.target.value; state.sel = -1; render(); };
$("country").onchange = (e) => {
  state.country = e.target.value;
  store.set("country", state.country);
  state.sectionsOpen.clear();
  if (state.country && state.cat !== "near") { state.cat = "near"; store.set("cat", "near"); renderCats(); }
  state.sel = -1;
  render();
};
$("hours").onchange = (e) => { state.hours = +e.target.value; store.set("hours", state.hours); state.sel = -1; render(); };

document.addEventListener("click", (e) => {
  const t = e.target;
  const jump = t.closest("[data-jump]");
  const cat = t.closest("[data-cat]");
  const src = t.closest("[data-src]");
  const rateBtn = t.closest("[data-rate]");
  const ring = t.closest("[data-ring]");
  const ringClose = t.closest("[data-ring-close]");
  const dots = t.closest("[data-acts]");
  if (!$("viewmenu").hidden && !t.closest(".viewmenu-wrap")) setMenu(false); // click outside closes the menu
  const editBtn = t.closest("[data-edit-terms]");
  const termBtn = t.closest("[data-term]");
  const termReset = t.closest("[data-term-reset]");
  if (editBtn) { state.editTerms = state.editTerms === editBtn.dataset.editTerms ? null : editBtn.dataset.editTerms; render(); }
  else if (termBtn) toggleTerm(termBtn.dataset.termId, termBtn.dataset.term);
  else if (termReset) { termEdits.delete(termReset.dataset.termReset); render(); }
  else if (dots) { state.actsOpen = state.actsOpen === dots.dataset.acts ? null : dots.dataset.acts; render(); }
  else if (rateBtn) rate(rateBtn.dataset.rateSrc, +rateBtn.dataset.rate);
  else if (ring) { state.sectionsOpen.add(+ring.dataset.ring); render(); }
  else if (ringClose) {
    state.sectionsOpen.delete(+ringClose.dataset.ringClose);
    render();
    const head = [...document.querySelectorAll(".ring")].find((h) => h.dataset.n === ringClose.dataset.ringClose);
    if (head) head.scrollIntoView({ block: "start" });
  }
  else if (t.closest("[data-manage]")) { state.panel = "sources"; renderButtons(); renderPanel(); window.scrollTo({ top: 0 }); }
  else if (jump) jumpTo(jump.dataset.jump);
  else if (t.closest("[data-reset]")) reset();
  else if (cat) { state.cat = cat.dataset.cat; store.set("cat", state.cat); state.sel = -1; renderCats(); render(); }
  else if (t.id === "clear-src") { state.source = null; renderCats(); render(); }
  else if (src) { state.source = src.dataset.src; state.sel = -1; renderCats(); render(); window.scrollTo({ top: 0 }); }
  else if (t.dataset.toggle) toggleExpand(t.dataset.toggle);
  else if (t.closest("[data-top-toggle]")) { state.topHidden = !state.topHidden; store.set("top-hidden", state.topHidden); renderTop(); }
  else if (t.closest("[data-kw]")) { const kw = t.closest("[data-kw]").dataset.kw; $("search").value = kw; state.query = kw; render(); }
  else if (t.dataset.id) { markRead(t.dataset.id); const row = t.closest(".row"); if (row && t.classList.contains("title")) row.classList.add("read"); }
});

document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const inInput = e.target.tagName === "INPUT" || e.target.tagName === "SELECT";
  if (e.key === "Escape") {
    if (inInput) e.target.blur();
    if (!$("viewmenu").hidden) setMenu(false);
    else if (state.query) { state.query = ""; $("search").value = ""; render(); }
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

function tick() { $("clock").textContent = CLOCK_FMT.format(new Date()); }
setInterval(tick, 15000);

// "33m" labels age on their own: the list is only redrawn when new headlines are shown, and new
// headlines wait behind "↑ N new" while you're scrolled down, so without this a label could sit at
// "33m" for an hour.
function tickAges() {
  for (const el of document.querySelectorAll("[data-t]")) {
    const t = el.dataset.t;
    el.textContent = timeAgo(t) + ("clock" in el.dataset ? " · " + hhmm(t) : "");
  }
}
setInterval(tickAges, 30000);
setInterval(() => {
  updateFreshness();
  renderRail(); // "updated 3m ago"
  if (state.panel === "sources") renderPanel();
  if (state.items.length) computeBreaking(state.pending || state.items); // let stale stories drop off
}, 30000);

applyTheme(state.theme);
tick();
renderAll();
load(false).then(() => pollLive(true));
schedule();

// The side panel only exists on wide screens; redraw it when the window crosses that width.
let railTimer;
window.addEventListener("resize", () => { clearTimeout(railTimer); railTimer = setTimeout(renderRail, 200); });
