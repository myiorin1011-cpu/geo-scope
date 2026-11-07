#!/usr/bin/env node
// ローカル自動運転: 一定間隔で ニュース更新 → 日本語音声(VOICEVOX) → 英語音声(Piper) を回し続ける（Actions を使わずPC1台で配信するとき用）
// 使い方: ANTHROPIC_API_KEY を設定し、VOICEVOX アプリを起動してから  node scripts/local_loop.mjs
// env: INTERVAL_MIN(240) REGIONS_EVERY_H(12) MARKETS_MIN(30) SKIP_NEWS=1(ニュース更新を飛ばして音声だけ) SKIP_EN=1 SKIP_REGIONS=1  ほか各スクリプトの env はそのまま引き継がれます
import { spawnSync } from "node:child_process";
const EVERY = Number(process.env.INTERVAL_MIN || 240) * 60e3;
const REG_EVERY = Number(process.env.REGIONS_EVERY_H || 12) * 3600e3; let lastRegions = 0; // 地域枠は 12 時間おき（1日2回）
const run = (name, args) => { console.log(`\n[${new Date().toLocaleTimeString("ja-JP")}] ${name}`); const r = spawnSync(process.execPath, args, { stdio: "inherit" }); if (r.status !== 0) console.error(`  ! ${name} failed (exit ${r.status}) — continuing`); };
async function cycle() {
  if (!process.env.SKIP_NEWS) { if (process.env.ANTHROPIC_API_KEY) { run("update news", ["scripts/update_news.mjs"]); if (!process.env.SKIP_REGIONS && Date.now() - lastRegions >= REG_EVERY - 60e3) { run("update regions (都道府県・米国州)", ["scripts/update_regions.mjs"]); lastRegions = Date.now(); } } else console.log("ANTHROPIC_API_KEY が無いのでニュース更新は飛ばします（音声だけ更新）"); }
  run("voice (ja / VOICEVOX)", ["scripts/synth_voice.mjs"]);
  if (!process.env.SKIP_EN) run("voice (en / Piper)", ["scripts/synth_voice_en.mjs"]);
  console.log(`next run in ${EVERY / 60e3} min (Ctrl+C で終了)`);
}
const MK = Number(process.env.MARKETS_MIN || 30) * 60e3; // market quotes are cheap (no API key) → own, shorter interval; MARKETS_MIN=0 で無効
if (MK > 0) { run("markets (Stooq)", ["scripts/update_markets.mjs"]); setInterval(() => run("markets (Stooq)", ["scripts/update_markets.mjs"]), MK); }
await cycle(); setInterval(cycle, EVERY);
