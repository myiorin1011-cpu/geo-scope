#!/usr/bin/env node
// GEO-SCOPE markets.json — a handful of quotes for the LIVE strip (Nikkei / S&P 500 / Dow / USD-JPY / EUR-JPY / BTC / Gold).
// Source: Stooq daily CSV (no API key; delayed/last-close values, fine for a news stream). Fallbacks: Frankfurter (ECB FX) and Coinbase (BTC).
// No Anthropic API call, no cost. env: SITE_DIR, SYMBOLS="^nkx,^spx,..."  Output: site/markets.json {updated, quotes:[{symbol,label,price,chg_pct,date}]}
import fs from "node:fs"; import path from "node:path";
const SITE_DIR = process.env.SITE_DIR || path.resolve("site"), OUT = path.join(SITE_DIR, "markets.json");
const LABELS = { "^nkx": "N225", "^spx": "S&P500", "^dji": "DOW", "usdjpy": "USD/JPY", "eurjpy": "EUR/JPY", "btcusd": "BTC", "xauusd": "GOLD" };
const SYMBOLS = (process.env.SYMBOLS || Object.keys(LABELS).join(",")).split(",");
let prev = {}; try { for (const q of JSON.parse(fs.readFileSync(OUT, "utf8")).quotes || []) prev[q.symbol] = q; } catch {}
const quotes = [];
try {
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(SYMBOLS.join(","))}&f=sd2t2ohlcv&h&e=csv`;
  const txt = await (await fetch(url, { headers: { "user-agent": "geo-scope/1.0" } })).text();
  const rows = txt.trim().split(/\r?\n/).slice(1).map(l => l.split(","));
  for (const r of rows) {
    const [sym, date, , open, , , close] = r; const s = sym.toLowerCase(); const price = Number(close), o = Number(open);
    if (!isFinite(price) || price <= 0) continue;
    // Stooq's row has today's open/close; % change vs previous close is derived from the last stored price when the date moved on
    const p = prev[s]; const ref = p && p.date && p.date !== date ? p.price : (isFinite(o) && o > 0 ? o : null);
    quotes.push({ symbol: s, label: LABELS[s] || sym, price, chg_pct: ref ? Math.round((price / ref - 1) * 10000) / 100 : null, date });
  }
} catch (e) { console.error("stooq failed:", e.message); }
// fallbacks when Stooq gave nothing for FX / BTC
if (!quotes.some(q => q.symbol === "usdjpy")) try { const j = await (await fetch("https://api.frankfurter.app/latest?from=USD&to=JPY")).json(); if (j.rates?.JPY) quotes.push({ symbol: "usdjpy", label: "USD/JPY", price: j.rates.JPY, chg_pct: prev.usdjpy ? Math.round((j.rates.JPY / prev.usdjpy.price - 1) * 10000) / 100 : null, date: j.date }); } catch {}
if (!quotes.some(q => q.symbol === "btcusd")) try { const j = await (await fetch("https://api.coinbase.com/v2/prices/BTC-USD/spot")).json(); const v = Number(j.data?.amount); if (v) quotes.push({ symbol: "btcusd", label: "BTC", price: v, chg_pct: prev.btcusd ? Math.round((v / prev.btcusd.price - 1) * 10000) / 100 : null, date: new Date().toISOString().slice(0, 10) }); } catch {}
if (!quotes.length) { console.error("no quotes — keeping the previous markets.json"); process.exit(0); }
fs.writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString(), source: "Stooq / ECB / Coinbase", quotes }, null, 1) + "\n");
console.log("markets.json:", quotes.map(q => `${q.label} ${q.price}${q.chg_pct != null ? ` (${q.chg_pct > 0 ? "+" : ""}${q.chg_pct}%)` : ""}`).join(" · "));
