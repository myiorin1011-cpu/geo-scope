#!/usr/bin/env node
// GEO-SCOPE quake feed — USGS (world, M4.5+) + 気象庁 (国内) → site/quakes.json
// 認証不要。Actions でも手元でも動きます。 env: SITE_DIR, MIN_MAG(4.5), HOURS(24)
import fs from "node:fs";
import path from "node:path";
const SITE_DIR = process.env.SITE_DIR || path.resolve("site");
const MIN_MAG = Number(process.env.MIN_MAG || 4.5), HOURS = Number(process.env.HOURS || 24);
const since = Date.now() - HOURS * 3600e3;
const out = { updated: new Date().toISOString(), sources: [], items: [] };

async function usgs() {
  const r = await fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson", { headers: { "user-agent": "geo-scope/1.0" } });
  if (!r.ok) throw new Error("USGS " + r.status);
  const j = await r.json(); out.sources.push({ name: "USGS", url: "https://earthquake.usgs.gov/" });
  for (const f of j.features || []) {
    const p = f.properties, [lon, lat, depth] = f.geometry.coordinates;
    if (p.time < since || p.mag < MIN_MAG) continue;
    out.items.push({ id: "usgs:" + f.id, time: new Date(p.time).toISOString(), lat, lon, depth: Math.round(depth), mag: Math.round(p.mag * 10) / 10,
      place: p.place || "", src: "USGS", url: p.url, tsunami: !!p.tsunami, alert: p.alert || null });
  }
}
async function jma() {
  const r = await fetch("https://www.jma.go.jp/bosai/quake/data/list.json", { headers: { "user-agent": "geo-scope/1.0" } });
  if (!r.ok) throw new Error("JMA " + r.status);
  const j = await r.json(); out.sources.push({ name: "気象庁", url: "https://www.jma.go.jp/bosai/map.html#contents=earthquake_map" });
  for (const q of j) {
    const t = Date.parse(q.at || q.rdt); if (!t || t < since) continue;
    const mag = parseFloat(q.mag); if (!(mag >= Math.min(MIN_MAG, 4.0))) continue;
    const m = /^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)(?:([+-]\d+))?/.exec(q.cod || ""); if (!m) continue;
    const lat = parseFloat(m[1]), lon = parseFloat(m[2]), depth = m[3] ? Math.abs(parseInt(m[3], 10)) / 1000 : null;
    out.items.push({ id: "jma:" + (q.eid || q.json), time: new Date(t).toISOString(), lat, lon, depth: depth == null ? null : Math.round(depth), mag,
      place: q.anm || q.en_anm || "", src: "気象庁", url: "https://www.jma.go.jp/bosai/map.html#contents=earthquake_map", maxi: q.maxi || null, tsunami: /津波/.test(q.ttl || "") });
  }
}
const dist = (a, b) => { const R = 6371, d2r = Math.PI / 180; const dLat = (b.lat - a.lat) * d2r, dLon = (b.lon - a.lon) * d2r; const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * d2r) * Math.cos(b.lat * d2r) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); };

const errors = [];
await Promise.all([usgs().catch(e => errors.push(e.message)), jma().catch(e => errors.push(e.message))]);
// de-duplicate: same event seen by both (within 3 min & 150 km) → keep JMA entry (has 震度) but keep USGS url
const items = [];
for (const q of out.items.sort((a, b) => (a.src === "気象庁" ? -1 : 1))) {
  const dup = items.find(x => Math.abs(Date.parse(x.time) - Date.parse(q.time)) < 180e3 && dist(x, q) < 150);
  if (dup) { if (!dup.url_usgs && q.src === "USGS") dup.url_usgs = q.url; continue; }
  items.push(q);
}
out.items = items.sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
if (errors.length) out.errors = errors;
fs.mkdirSync(SITE_DIR, { recursive: true });
fs.writeFileSync(path.join(SITE_DIR, "quakes.json"), JSON.stringify(out, null, 1) + "\n");
console.log(`quakes: ${out.items.length} (${errors.length ? "errors: " + errors.join("; ") : "ok"})`);
