#!/usr/bin/env node
// GEO-SCOPE disaster feed — tropical cyclones / floods / volcanoes / wildfires (GDACS), hurricanes (NHC),
// typhoons (JMA, best effort), tornado warnings (NWS) → site/disasters.json.  No API keys needed.
import fs from "node:fs";
import path from "node:path";
const SITE_DIR = process.env.SITE_DIR || path.resolve("site");
const UA = { "user-agent": "geo-scope/1.0 (+https://github.com/)" , "accept": "application/json" };
const out = { updated: new Date().toISOString(), sources: [], items: [], errors: [] };
const push = x => { if (Number.isFinite(x.lat) && Number.isFinite(x.lon)) out.items.push(x); };
const J = async u => { const r = await fetch(u, { headers: UA }); if (!r.ok) throw new Error(`${r.status} ${u}`); return r.json(); };

// 1) GDACS — global, alert levels Green/Orange/Red
async function gdacs() {
  const j = await J("https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP?eventlist=TC;FL;VO;WF;DR&alertlevel=Green;Orange;Red");
  out.sources.push({ name: "GDACS", url: "https://www.gdacs.org/" });
  const T = { TC: "cyclone", FL: "flood", VO: "volcano", WF: "wildfire", DR: "drought" };
  for (const f of j.features || []) {
    const p = f.properties || {}; const [lon, lat] = f.geometry?.coordinates || [];
    const since = Date.now() - 7 * 86400e3; if (p.todate && Date.parse(p.todate) < since - 3 * 86400e3) continue;
    push({ id: "gdacs:" + p.eventid + ":" + (p.episodeid || ""), type: T[p.eventtype] || "other", name: p.name || p.eventname || "", country: p.country || "",
      lat, lon, level: (p.alertlevel || "Green").toLowerCase(), severity: p.severitydata?.severitytext || p.severity || "", time: p.todate || p.fromdate || new Date().toISOString(),
      src: "GDACS", url: p.url?.report || p.url?.details || "https://www.gdacs.org/" });
  }
}
// 2) NHC — Atlantic / E. Pacific active storms
async function nhc() {
  const j = await J("https://www.nhc.noaa.gov/CurrentStorms.json");
  out.sources.push({ name: "NHC (NOAA)", url: "https://www.nhc.noaa.gov/" });
  for (const s of j.activeStorms || []) {
    const kt = Number(s.intensity) || 0; const cat = kt >= 137 ? 5 : kt >= 113 ? 4 : kt >= 96 ? 3 : kt >= 83 ? 2 : kt >= 64 ? 1 : 0;
    push({ id: "nhc:" + s.id, type: "cyclone", name: `${s.classification || ""} ${s.name}`.trim(), lat: Number(s.latitudeNumeric), lon: Number(s.longitudeNumeric),
      level: cat >= 3 ? "red" : cat >= 1 ? "orange" : "green", wind_kt: kt, cat, pressure: s.pressure, movement: `${s.movementDir || ""}° ${s.movementSpeed || ""}kt`,
      time: s.lastUpdate || new Date().toISOString(), src: "NHC", url: "https://www.nhc.noaa.gov/" });
  }
}
// 3) JMA typhoons — best effort (data layout may change)
async function jma() {
  const list = await J("https://www.jma.go.jp/bosai/typhoon/data/targetTc.json");
  out.sources.push({ name: "気象庁 台風情報", url: "https://www.jma.go.jp/bosai/map.html#contents=typhoon" });
  for (const t of list || []) {
    const tc = t.tropicalCyclone || t.tc || t; if (typeof tc !== "string") continue;
    try {
      const spec = await J(`https://www.jma.go.jp/bosai/typhoon/data/${tc}/specifications.json`);
      const a = (Array.isArray(spec) ? spec : spec.analysis || []).find(x => !x.forecast && (x.center || x.position)) || (Array.isArray(spec) ? spec[0] : spec);
      const c = a?.center || a?.position || {}; const lat = Number(c.latitude ?? c.lat ?? c[0]); const lon = Number(c.longitude ?? c.lon ?? c[1]);
      const name = a?.name?.en || a?.name || a?.typhoonName || tc; const kt = Number(a?.maximumWind?.sustained ?? a?.maxWind ?? 0);
      push({ id: "jma:" + tc, type: "cyclone", name: `台風 ${a?.number || ""} ${name}`.replace(/\s+/g, " ").trim(), lat, lon, wind_kt: kt || undefined,
        level: kt >= 85 ? "red" : kt >= 64 ? "orange" : "green", time: a?.validtime || new Date().toISOString(), src: "気象庁", url: "https://www.jma.go.jp/bosai/map.html#contents=typhoon" });
    } catch (e) { out.errors.push("JMA " + tc + ": " + e.message); }
  }
}
// 4) NWS — active tornado warnings (US). Use polygon centroid.
async function nws() {
  const j = await J("https://api.weather.gov/alerts/active?event=Tornado%20Warning");
  out.sources.push({ name: "NWS", url: "https://www.weather.gov/" });
  for (const f of j.features || []) {
    const g = f.geometry; if (!g || g.type !== "Polygon") continue; const ring = g.coordinates[0]; const n = ring.length;
    const lon = ring.reduce((s, c) => s + c[0], 0) / n, lat = ring.reduce((s, c) => s + c[1], 0) / n;
    push({ id: "nws:" + f.properties.id, type: "tornado", name: "Tornado Warning", country: "United States", area: f.properties.areaDesc, lat, lon, level: "red",
      time: f.properties.sent || f.properties.effective, src: "NWS", url: f.properties["@id"] || "https://www.weather.gov/" });
  }
}
await Promise.all([gdacs, nhc, jma, nws].map(fn => fn().catch(e => out.errors.push(e.message))));
// de-dup cyclones reported by several agencies (within 250 km): prefer JMA, then NHC, then GDACS
const dist = (a, b) => { const R = 6371, d = Math.PI / 180; const dl = (b.lat - a.lat) * d, dn = (b.lon - a.lon) * d; const x = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * d) * Math.cos(b.lat * d) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
const pri = { "気象庁": 0, NHC: 1, GDACS: 2 }; const items = [];
for (const it of out.items.sort((a, b) => (pri[a.src] ?? 9) - (pri[b.src] ?? 9))) {
  if (it.type === "cyclone" && items.some(x => x.type === "cyclone" && dist(x, it) < 250)) continue; items.push(it);
}
out.items = items; if (!out.errors.length) delete out.errors;
fs.mkdirSync(SITE_DIR, { recursive: true });
fs.writeFileSync(path.join(SITE_DIR, "disasters.json"), JSON.stringify(out, null, 1) + "\n");
console.log(`disasters: ${items.length} (${(out.errors || []).join("; ") || "ok"})`);
