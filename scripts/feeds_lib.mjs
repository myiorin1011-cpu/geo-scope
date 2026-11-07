// GEO-SCOPE feed collector — free sources only (official RSS/Atom feeds + the GDELT DOC API).
// Used by update_news.mjs / update_regions.mjs in SOURCE=feeds mode (default). No dependencies.
// The article text never gets published: titles/short descriptions are only given to Claude as material,
// Claude writes its own summary, and the script attaches the real article URL as the source.
import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto";

const UA = process.env.FEED_UA || "GEO-SCOPE/1.0 (news map; RSS reader)";
const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function fetchText(url, ms = 15000) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, application/json, */*" }, signal: ac.signal, redirect: "follow" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.text(); }
  finally { clearTimeout(t); }
}

// ---------- RSS 2.0 / RSS 1.0 (RDF) / Atom ----------
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };
export function decode(s) {
  return String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
}
const stripTags = s => decode(decode(s)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
function tag(block, names) {
  for (const n of names) { const m = new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, "i").exec(block); if (m) return m[1]; }
  return "";
}
function atomLink(block) {
  const links = [...block.matchAll(/<link\b([^>]*?)\/?>/gi)].map(m => m[1]);
  const pick = links.find(a => /rel=["']alternate["']/i.test(a)) || links.find(a => !/rel=/i.test(a)) || links[0];
  const m = pick && /href=["']([^"']+)["']/i.exec(pick); return m ? decode(m[1]) : "";
}
export function parseFeed(xml) {
  const out = []; const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const blocks = isAtom ? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [] : xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  for (const b of blocks) {
    const title = stripTags(tag(b, ["title"]));
    let link = isAtom ? atomLink(b) : stripTags(tag(b, ["link"])) || (/<guid[^>]*isPermaLink=["']?true["']?[^>]*>([\s\S]*?)<\/guid>/i.exec(b) || [])[1] || "";
    if (!link) { const m = /rdf:about=["']([^"']+)["']/i.exec(b); if (m) link = m[1]; }
    const date = stripTags(tag(b, ["pubDate", "dc:date", "published", "updated", "a10:updated"]));
    const desc = stripTags(tag(b, ["description", "summary", "content:encoded", "content"])).slice(0, 400);
    if (title && /^https?:\/\//.test(link.trim())) out.push({ title, link: link.trim(), date, desc });
  }
  return out;
}

// ---------- GDELT DOC 2.0 (free, ~1 request / 5 s) ----------
let lastGdelt = 0;
export async function gdelt(query, { timespan = "4h", max = 250 } = {}) {
  const wait = 5500 - (Date.now() - lastGdelt); if (wait > 0) await sleep(wait); lastGdelt = Date.now();
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?${new URLSearchParams({ query, mode: "artlist", format: "json", maxrecords: String(max), timespan, sort: "datedesc" })}`;
  const txt = await fetchText(url, 30000); let j; try { j = JSON.parse(txt); } catch { throw new Error("GDELT: non-JSON reply (" + txt.slice(0, 80).replace(/\s+/g, " ") + ")"); }
  return (j.articles || []).map(a => ({ title: String(a.title || "").trim(), link: a.url, date: a.seendate ? a.seendate.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z") : "", desc: "", domain: a.domain, lang: a.language, srcCountry: a.sourcecountry }));
}

// ---------- source names ----------
const DOMAIN_NAMES = { "reuters.com": "Reuters", "apnews.com": "AP", "afp.com": "AFP", "bbc.com": "BBC", "bbc.co.uk": "BBC", "aljazeera.com": "Al Jazeera", "theguardian.com": "The Guardian", "nytimes.com": "New York Times", "washingtonpost.com": "Washington Post", "wsj.com": "WSJ", "bloomberg.com": "Bloomberg", "ft.com": "Financial Times", "cnn.com": "CNN", "npr.org": "NPR", "dw.com": "DW", "france24.com": "France 24", "news.un.org": "UN News", "reliefweb.int": "ReliefWeb", "nhk.or.jp": "NHK", "japantimes.co.jp": "The Japan Times", "asia.nikkei.com": "Nikkei Asia", "nikkei.com": "日本経済新聞", "kyodonews.net": "共同通信", "asahi.com": "朝日新聞", "mainichi.jp": "毎日新聞", "yomiuri.co.jp": "読売新聞", "cnbc.com": "CNBC", "axios.com": "Axios", "politico.com": "Politico", "scmp.com": "SCMP", "straitstimes.com": "The Straits Times", "timesofindia.indiatimes.com": "Times of India", "abc.net.au": "ABC (Australia)", "euronews.com": "Euronews", "kyivindependent.com": "Kyiv Independent", "timesofisrael.com": "Times of Israel", "koreaherald.com": "Korea Herald", "yna.co.kr": "Yonhap" };
export function sourceName(link, fallback) {
  try { const h = new URL(link).hostname.replace(/^www\d?\./, ""); for (const [d, n] of Object.entries(DOMAIN_NAMES)) if (h === d || h.endsWith("." + d)) return n; return fallback || h; } catch { return fallback || "web"; }
}

// ---------- tagging (cheap keyword match; Claude makes the final call) ----------
// Builds a matcher from {key: [aliases...]}. ASCII aliases match on word boundaries (case-sensitive, so "US" ≠ "us"), CJK aliases as substrings.
export function makeTagger(aliasMap, { notAfter = {} } = {}) {
  const ascii = [], cjk = [];
  for (const [k, list] of Object.entries(aliasMap)) for (const a of list) { if (!a) continue; (/^[\x00-\x7f]+$/.test(a) ? ascii : cjk).push([a, k]); }
  ascii.sort((x, y) => y[0].length - x[0].length); cjk.sort((x, y) => y[0].length - x[0].length);
  const re = ascii.length ? new RegExp(`\\b(${ascii.map(([a]) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "g") : null;
  const amap = new Map(ascii.map(([a, k]) => [a, k]));
  return text => {
    const found = new Set(); const s = String(text || "");
    if (re) for (const m of s.matchAll(re)) { const k = amap.get(m[1]); if (k) found.add(k); }
    for (const [a, k] of cjk) { let i = s.indexOf(a); while (i >= 0) { const prev = notAfter[a]; if (!prev || !prev.includes(s[i - 1])) { found.add(k); break; } i = s.indexOf(a, i + 1); } }
    return [...found];
  };
}

// ---------- collection ----------
// sources: [{name,url,lang,tag?,weight?}]  gdeltQueries: [{query,timespan,max,weight?}]
export async function collect({ sources = [], gdeltQueries = [], sinceMs, log = console.log }) {
  const items = []; const stats = [];
  await Promise.all(sources.map(async s => {
    try { const xml = await fetchText(s.url); const got = parseFeed(xml); stats.push(`${s.name}:${got.length}`);
      for (const g of got) items.push({ ...g, source: sourceName(g.link, s.name), lang: s.lang || "en", defTag: s.tag || null, weight: s.weight ?? 1 }); }
    catch (e) { stats.push(`${s.name}:ERR(${e.message.slice(0, 40)})`); }
  }));
  for (const q of gdeltQueries) {
    try { const got = await gdelt(q.query, q); stats.push(`GDELT[${q.label || q.query.slice(0, 20)}]:${got.length}`);
      for (const g of got) items.push({ ...g, source: sourceName(g.link, g.domain), lang: (g.lang || "").toLowerCase().startsWith("japanese") ? "ja" : "en", defTag: q.tag || null, weight: q.weight ?? 0.8 }); }
    catch (e) { stats.push(`GDELT:ERR(${e.message.slice(0, 50)})`); }
  }
  log("feeds: " + stats.join("  "));
  // de-dup by URL and by normalized title; drop old items (undated items are kept — many feeds are "latest N")
  const seenU = new Set(), seenT = new Set(), out = [];
  for (const it of items) {
    const u = it.link.replace(/[?#].*$/, "").replace(/\/$/, ""); const t = it.title.toLowerCase().replace(/[\s\p{P}]+/gu, "").slice(0, 60);
    if (seenU.has(u) || seenT.has(t)) continue; seenU.add(u); seenT.add(t);
    const ms = Date.parse(it.date); it.ms = isNaN(ms) ? null : ms;
    if (sinceMs && it.ms && it.ms < sinceMs) continue;
    if (it.ms && it.ms > Date.now() + 3600e3) it.ms = Date.now();
    out.push(it);
  }
  return out;
}

// ---------- "already sent to Claude" memory (so the same article isn't paid for twice) ----------
export function seenStore(file, keepH = 72) {
  let db = {}; try { db = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  const now = Date.now(); for (const [k, t] of Object.entries(db)) if (now - t > keepH * 3600e3) delete db[k];
  const h = u => crypto.createHash("sha1").update(u.replace(/[?#].*$/, "")).digest("hex").slice(0, 16);
  return { has: u => !!db[h(u)], add: u => { db[h(u)] = now; }, save: () => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(db)); }, size: () => Object.keys(db).length };
}

// ---------- pick a balanced candidate list ----------
// score: tagged > untagged, source weight, recency; at most perKey per tag; round-robin so one feed can't fill the list
export function pickCandidates(items, { tagger, max = 160, perKey = 6, requireTag = false }) {
  for (const it of items) { const tags = tagger(`${it.title} ${it.desc}`); if (!tags.length && it.defTag) tags.push(it.defTag); it.tags = tags; }
  const pool = items.filter(it => !requireTag || it.tags.length);
  const now = Date.now(); pool.forEach(it => { it.score = (it.tags.length ? 2 : 0) + (it.weight || 1) + (it.ms ? Math.max(0, 1 - (now - it.ms) / (24 * 3600e3)) : 0.3); });
  pool.sort((a, b) => b.score - a.score);
  const per = {}, out = [];
  for (const it of pool) { if (out.length >= max) break; const k = it.tags[0] || "_"; per[k] = (per[k] || 0) + 1; if (k !== "_" && per[k] > perKey) continue; if (k === "_" && per[k] > max / 4) continue; out.push(it); }
  return out.map((it, i) => ({ ...it, id: i + 1 }));
}

// compact text block for the prompt
export function candidateBlock(cands, toJST) {
  return cands.map(c => `[${c.id}] (${c.source}${c.ms ? ", " + toJST(c.ms) : ""}${c.tags.length ? " | " + c.tags.slice(0, 3).join("/") : ""}) ${c.title}${c.desc && !c.desc.startsWith(c.title.slice(0, 30)) ? " — " + c.desc.slice(0, 180) : ""}`).join("\n");
}

// usage → rough cost line
export function costLine(usage, label = "") {
  if (!usage) return "";
  const pin = Number(process.env.PRICE_IN || 2), pout = Number(process.env.PRICE_OUT || 10);
  const inT = (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0), outT = usage.output_tokens || 0;
  const s = usage.server_tool_use?.web_search_requests || 0;
  const usd = inT / 1e6 * pin + outT / 1e6 * pout + s * 0.01;
  return `${label}usage: in ${inT} / out ${outT}${s ? ` / search ${s}` : ""} ≈ $${usd.toFixed(3)}`;
}
