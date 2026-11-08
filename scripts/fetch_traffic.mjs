#!/usr/bin/env node
// GEO-SCOPE traffic.json — aircraft squawking emergency codes + ships seen at maritime chokepoints. No Anthropic call, no cost.
//   Aircraft: adsb.lol public API (data ODbL 1.0 — attribution "adsb.lol" required). 7500 = hijack, 7600 = radio failure, 7700 = emergency.
//   Ships:    aisstream.io WebSocket (free key: sign in with GitHub at aisstream.io → API keys). Skipped when AISSTREAM_KEY is unset.
//             Browsers may not connect to aisstream directly, so this runs on the streaming PC / in local_loop and writes a JSON file.
// env: SITE_DIR, AISSTREAM_KEY, AIS_SECONDS(60 = listening window per run)   Output: site/traffic.json
// STATUS (2026-11): prototype, not wired into any workflow or local_loop. Confirm commercial use with adsb.lol / aisstream.io first
// (fallback for aircraft: FlyItalyADSB, commercial OK with attribution). The page shows the layer only with URL "traffic=on".
import fs from "node:fs"; import path from "node:path";
const SITE_DIR = process.env.SITE_DIR || path.resolve("site"), OUT = path.join(SITE_DIR, "traffic.json");
const UA = { "user-agent": "geo-scope/1.0 (news map)" };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let prev = {}; try { prev = JSON.parse(fs.readFileSync(OUT, "utf8")); } catch {}

// ---------- aircraft ----------
const SQK = { "7500": "HIJACK", "7600": "RADIO FAILURE", "7700": "EMERGENCY" };
async function aircraft() {
  const out = [];
  for (const sq of Object.keys(SQK)) {
    const r = await fetch(`https://api.adsb.lol/v2/sqk/${sq}`, { headers: UA }); if (!r.ok) throw new Error(`adsb.lol HTTP ${r.status}`);
    for (const a of (await r.json()).ac || []) {
      if (a.lat == null || a.lon == null) continue;
      out.push({ hex: a.hex, flight: (a.flight || "").trim(), reg: a.r || "", type: a.t || "", lat: +a.lat.toFixed(3), lon: +a.lon.toFixed(3),
        alt: typeof a.alt_baro === "number" ? a.alt_baro : (a.alt_baro || null), squawk: sq, kind: SQK[sq], seen: a.seen ?? null });
    }
    await sleep(1100);
  }
  return out;
}

// ---------- ships ----------
// [id, label, [[latS, lonW], [latN, lonE]]] — kept small so the counts mean "ships in the strait right now"
const ZONES = [
  ["hormuz", "HORMUZ", [[25.8, 55.8], [27.0, 57.2]]],
  ["babelmandeb", "BAB-EL-MANDEB", [[12.2, 42.8], [13.2, 43.8]]],
  ["suez", "SUEZ", [[29.8, 32.2], [31.4, 32.7]]],
  ["malacca", "SINGAPORE STR.", [[1.0, 103.4], [1.5, 104.4]]],
  ["taiwan", "TAIWAN STR.", [[22.8, 118.5], [25.8, 121.0]]],
  ["panama", "PANAMA", [[8.8, -80.0], [9.5, -79.4]]],
  ["bosporus", "BOSPORUS", [[40.95, 28.9], [41.3, 29.2]]],
  ["gibraltar", "GIBRALTAR", [[35.8, -6.0], [36.2, -5.2]]],
];
const inBox = (lat, lon, [[s, w], [n, e]]) => lat >= s && lat <= n && lon >= w && lon <= e;
function ships(key, seconds) {
  return new Promise(resolve => {
    const seen = Object.fromEntries(ZONES.map(([id]) => [id, new Set()]));
    let ws; const done = err => { try { ws?.close(); } catch {} resolve({ seen, err }); };
    const timer = setTimeout(() => done(null), seconds * 1000);
    try { ws = new WebSocket("wss://stream.aisstream.io/v0/stream"); } catch (e) { clearTimeout(timer); return done(e.message); }
    ws.onopen = () => ws.send(JSON.stringify({ APIKey: key, BoundingBoxes: ZONES.map(z => z[2]), FilterMessageTypes: ["PositionReport", "StandardClassBPositionReport", "ExtendedClassBPositionReport"] }));
    ws.onmessage = async ev => {
      let m; try { m = JSON.parse(typeof ev.data === "string" ? ev.data : await ev.data.text()); } catch { return; }
      if (m.error) { clearTimeout(timer); return done(String(m.error)); }
      const md = m.MetaData || {}; const lat = md.latitude, lon = md.longitude; if (lat == null || !md.MMSI) return;
      for (const [id, , box] of ZONES) if (inBox(lat, lon, box)) seen[id].add(md.MMSI);
    };
    ws.onerror = () => { clearTimeout(timer); done("websocket error"); };
  });
}

const out = { updated: new Date().toISOString(), credit: "ADS-B: adsb.lol (ODbL)", aircraft: prev.aircraft || [], ships: prev.ships || null };
try { out.aircraft = await aircraft(); console.log(`aircraft: ${out.aircraft.length} squawking 7500/7600/7700${out.aircraft.map(a => ` · ${a.squawk} ${a.flight || a.hex}`).join("")}`); }
catch (e) { console.error("aircraft failed (keeping previous):", e.message); }
const KEY = process.env.AISSTREAM_KEY;
if (KEY) {
  const secs = Number(process.env.AIS_SECONDS || 60);
  const { seen, err } = await ships(KEY, secs);
  const total = Object.values(seen).reduce((s, x) => s + x.size, 0);
  if (err && !total) console.error("ships failed (keeping previous):", err);
  else {
    out.ships = { window_s: secs, zones: ZONES.map(([id, label, [[s, w], [n, e]]]) => ({ id, label, lat: +((s + n) / 2).toFixed(2), lon: +((w + e) / 2).toFixed(2), n: seen[id].size })) };
    console.log(`ships (${secs}s): ` + out.ships.zones.map(z => `${z.label} ${z.n}`).join(" · "));
  }
  out.credit += " / AIS: aisstream.io";
} else console.log("ships: skipped (set AISSTREAM_KEY to enable)");
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
