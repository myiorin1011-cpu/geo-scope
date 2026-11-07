#!/usr/bin/env node
// Smoke test for the published data files. Fails (exit 1) on schema problems so a broken feed never ships.
import fs from "node:fs";
const SITE = process.env.SITE_DIR || "site";
let bad = 0; const fail = m => { console.error("✗", m); bad++; };
const read = f => { try { return JSON.parse(fs.readFileSync(`${SITE}/${f}`, "utf8")); } catch (e) { fail(`${f}: ${e.message}`); return null; } };
const news = read("news.json");
if (news) {
  if (!news.updated || isNaN(Date.parse(news.updated))) fail("news.json: updated missing/invalid");
  if (!news.items || typeof news.items !== "object") fail("news.json: items missing");
  else for (const [k, arr] of Object.entries(news.items)) {
    if (!Array.isArray(arr)) { fail(`news.json: ${k} not array`); continue; }
    if (arr.length > 6) fail(`news.json: ${k} has ${arr.length} items (>6)`);
    arr.forEach((i, n) => { if (!/^\d{4}(-\d{2}(-\d{2})?)?\s*\//.test(i.t || "")) fail(`news.json: ${k}[${n}] bad t`); if (!i.h || !i.b) fail(`news.json: ${k}[${n}] missing h/b`); if (!["alert", "warn", "info"].includes(i.lv)) fail(`news.json: ${k}[${n}] bad lv`); });
  }
  console.log(`news.json: ${Object.keys(news.items || {}).length} countries, ${Object.values(news.items || {}).flat().length} items`);
}
const en = read("data_en.json");
if (en && news) { const missing = Object.keys(news.items).filter(k => !en.countries?.[k]); if (missing.length) console.warn("! data_en.json missing:", missing.join(", ")); }
if (fs.existsSync(`${SITE}/quakes.json`)) { const q = read("quakes.json"); if (q && !Array.isArray(q.items)) fail("quakes.json: items not array"); }
if (fs.existsSync(`${SITE}/voice/index.json`)) { const v = read("voice/index.json"); if (v) { let miss = 0; for (const it of Object.values(v.items || {})) if (!fs.existsSync(`${SITE}/${it.file}`)) miss++; if (miss) fail(`voice/index.json: ${miss} files missing`); } }
if (fs.existsSync(`${SITE}/regions.json`)) { const rg = read("regions.json"); if (rg) { const GEO = JSON.parse(fs.readFileSync("scripts/region_geo.json", "utf8")); for (const r of ["japan", "usa"]) { if (!Array.isArray(rg[r])) { fail(`regions.json: ${r} not array`); continue; } rg[r].forEach((i, n) => { if (!GEO[r][i.area]) fail(`regions.json: ${r}[${n}] unknown area ${i.area}`); if (!i.h || !i.b || !/^\d{4}-\d{2}-\d{2}\s*\//.test(i.t || "")) fail(`regions.json: ${r}[${n}] missing h/b/t`); }); } console.log(`regions.json: japan ${rg.japan?.length || 0} / usa ${rg.usa?.length || 0}${rg.note ? " (sample)" : ""}`); } }
const html = fs.readFileSync(`${SITE}/index.html`, "utf8"); if (!/const DATA = \{/.test(html)) fail("index.html: DATA not found");
if (bad) { console.error(`${bad} problem(s)`); process.exit(1); } console.log("✓ check passed");
