#!/usr/bin/env node
// GEO-SCOPE charts.json — index charts for the MARKETS slot (prototype; the page shows it only with #charts=on).
//   全世界株式 = eMAXIS Slim 全世界株式（オール・カントリー）の基準価額 CSV（三菱UFJアセットマネジメント）
//   S&P500 / 日経平均 = FRED の CSV（APIキー不要。S&P500 は直近10年分のみ）
// Commercial use (a monetised stream) needs permission from the index owners (S&P DJI, Nikkei) and a check of the
// fund site's terms before this is switched on. No Anthropic API call, no cost. Not wired into any workflow yet.
// env: SITE_DIR  Output: site/charts.json {updated, source, series:[{key,label,sub,unit,last,date,periods:{d,w,m,all}}]}
import fs from "node:fs";
import path from "node:path";

const SITE = process.env.SITE_DIR || path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..", "site");
const OUT = path.join(SITE, "charts.json");
const get = async (url) => { const r = await fetch(url, { signal: AbortSignal.timeout(60000) }); if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`); return Buffer.from(await r.arrayBuffer()); };

async function fred(id) {
  const t = (await get(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`)).toString("utf8");
  return t.trim().split(/\r?\n/).slice(1).map(l => l.split(",")).filter(([d, v]) => /^\d{4}-\d\d-\d\d$/.test(d) && v && v !== "." && !isNaN(+v)).map(([d, v]) => [d, +v]);
}
async function emaxis(code) {
  const t = new TextDecoder("shift_jis").decode(await get(`https://emaxis.am.mufg.jp/fund_file/setteirai/${code}.csv`));
  return t.trim().split(/\r?\n/).map(l => l.split(",")).filter(([d, v]) => /^\d{4}\/\d\d\/\d\d$/.test(d) && !isNaN(+v)).map(([d, v]) => [d.replace(/\//g, "-"), +v]);
}

// last close of each ISO week / calendar month
const weekKey = (d) => { const t = new Date(d + "T00:00:00Z"); const day = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - day); return t.toISOString().slice(0, 10); };
const bucket = (rows, key) => { const m = new Map(); for (const r of rows) m.set(key(r[0]), r); return [...m.values()]; };
const round = (v) => Math.round(v * 100) / 100;
function periods(rows) {
  const w = bucket(rows, weekKey), m = bucket(rows, d => d.slice(0, 7));
  const pack = (a) => a.map(([d, v]) => [d, round(v)]);
  return { d: pack(rows.slice(-66)), w: pack(w.slice(-104)), m: pack(m.slice(-120)), all: pack(m) };
}

const SRC = [
  { key: "acwi", label: "全世界株式", en: "ALL-COUNTRY", sub: "eMAXIS Slim 全世界株式 基準価額", unit: "JPY", load: () => emaxis("253425") },
  { key: "spx", label: "S&P500", en: "S&P 500", sub: "S&P 500 Index (FRED)", unit: "pt", load: () => fred("SP500") },
  { key: "n225", label: "日経平均", en: "NIKKEI 225", sub: "Nikkei Stock Average (FRED)", unit: "円", load: () => fred("NIKKEI225") },
];

const prev = (() => { try { return JSON.parse(fs.readFileSync(OUT, "utf8")); } catch { return null; } })();
const series = [];
for (const s of SRC) {
  try {
    const rows = await s.load();
    if (rows.length < 30) throw new Error(`only ${rows.length} rows`);
    const [date, last] = rows.at(-1);
    series.push({ key: s.key, label: s.label, en: s.en, sub: s.sub, unit: s.unit, last: round(last), date, periods: periods(rows) });
    console.log(`${s.key}: ${rows.length} rows, last ${date} ${last}`);
  } catch (e) {
    console.error(`${s.key} failed: ${e.message}`);
    const old = prev?.series?.find(x => x.key === s.key);
    if (old) series.push(old);
  }
}
if (!series.length) { console.error("no series; charts.json left as is"); process.exit(1); }
fs.writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString(), source: "eMAXIS (MUFG AM) / FRED", series }) + "\n");
console.log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
