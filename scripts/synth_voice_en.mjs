#!/usr/bin/env node
// GEO-SCOPE English voice synthesizer — Piper TTS (open source, offline) → site/voice/en_*.ogg + site/voice/index_en.json
// 日本語の VOICEVOX クリップと同じ鍵（fnv(country|t|h)）で英訳（h_en/b_en）を読み上げ、ページ側で同じ無線加工を通します。
// 必要: pip install piper-tts  と 音声モデル（python -m piper.download_voices en_US-lessac-medium --data-dir .piper）
// env: PIPER_BIN(piper) PIPER_VOICE(en_US-amy-medium) PIPER_DIR(.piper) LENGTH_SCALE(0.8=速め) SITE_DIR MAX_AGE_DAYS(3)
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { normalizeWav, FF_LOUDNORM } from "./loudness.mjs";

const PIPER = process.env.PIPER_BIN || "piper";
const VOICE = process.env.PIPER_VOICE || "en_US-amy-medium";
const PDIR = path.resolve(process.env.PIPER_DIR || ".piper");
const SITE_DIR = process.env.SITE_DIR || path.resolve("site");
const VOICE_DIR = path.join(SITE_DIR, "voice");
const MAX_AGE = Number(process.env.MAX_AGE_DAYS || 3) * 86400e3;
const LENGTH = process.env.LENGTH_SCALE || "0.8"; // <1 = faster (urgent operator pace)
const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0;
fs.mkdirSync(VOICE_DIR, { recursive: true });

// model files: <dir>/<voice>.onnx + .onnx.json (download_voices puts them flat in the data dir)
function findModel() {
  const cands = [path.join(PDIR, VOICE + ".onnx"), ...(fs.existsSync(PDIR) ? fs.readdirSync(PDIR).filter(f => f.endsWith(".onnx") && f.includes(VOICE)).map(f => path.join(PDIR, f)) : [])];
  const m = cands.find(f => fs.existsSync(f) && fs.existsSync(f + ".json"));
  if (!m) { console.error(`Piper voice model not found: ${VOICE}\n  → python -m piper.download_voices ${VOICE} --data-dir ${PDIR}`); process.exit(1); }
  return m;
}
if (spawnSync(PIPER, ["--help"]).status !== 0) { console.error("piper が見つかりません。 pip install piper-tts  を実行してください（PIPER_BIN でパス指定も可）"); process.exit(1); }
const MODEL = findModel();

const news = JSON.parse(fs.readFileSync(path.join(SITE_DIR, "news.json"), "utf8"));
const idxPath = path.join(VOICE_DIR, "index_en.json");
const index = fs.existsSync(idxPath) ? JSON.parse(fs.readFileSync(idxPath, "utf8")) : { items: {} };
const fnv = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, "0"); };
const EN_NAME = { "United States of America": "the United States", "United Kingdom": "the United Kingdom", "Dem. Rep. Congo": "the Democratic Republic of the Congo", "S. Sudan": "South Sudan", "Central African Rep.": "the Central African Republic", "Eq. Guinea": "Equatorial Guinea", "Bosnia and Herz.": "Bosnia and Herzegovina", "Macedonia": "North Macedonia", "Solomon Is.": "the Solomon Islands", "Dominican Rep.": "the Dominican Republic", "eSwatini": "Eswatini", "Côte d'Ivoire": "Ivory Coast", "Congo": "the Republic of the Congo", "Czechia": "the Czech Republic", "Netherlands": "the Netherlands", "Philippines": "the Philippines", "United Arab Emirates": "the United Arab Emirates", "Bahamas": "the Bahamas", "Gambia": "the Gambia", "Maldives": "the Maldives", "Marshall Islands": "the Marshall Islands" };
const READ_EN = JSON.parse(fs.readFileSync(path.resolve("scripts/readings_en.json"), "utf8")); delete READ_EN._comment;
function prep(t) { let s = String(t || ""); for (const k of Object.keys(READ_EN).sort((a, b) => b.length - a.length)) s = s.split(k).join(READ_EN[k]); return s.replace(/[“”"]/g, "").replace(/\s+/g, " ").trim(); }

function synth(text, outBase) {
  const wav = outBase + ".wav";
  execFileSync(PIPER, ["-m", MODEL, "-c", MODEL + ".json", "-f", wav, "--length-scale", LENGTH, "--sentence-silence", "0.25"], { input: text });
  if (!HAS_FFMPEG) { const buf = normalizeWav(fs.readFileSync(wav)); fs.writeFileSync(wav, buf); const sr = buf.readUInt32LE(24) || 22050; return { file: wav, dur: Math.max(0, buf.length - 44) / (sr * 2) }; }
  const ogg = outBase + ".ogg";
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", wav, ...FF_LOUDNORM, "-ac", "1", "-ar", "24000", "-c:a", "libopus", "-b:a", "32k", ogg]); fs.unlinkSync(wav);
  const dur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", ogg]).toString().trim());
  return { file: ogg, dur };
}

// English text: item.h_en/b_en (added by update_news.mjs); older items fall back to the data_en.json overlay (news[{ja,h,b}])
let EN = {}; try { const de = JSON.parse(fs.readFileSync(path.join(SITE_DIR, "data_en.json"), "utf8")); for (const [c, v] of Object.entries(de.countries || {})) { EN[c] = {}; for (const n of v.news || []) EN[c][n.ja] = n; } } catch {}
const enOf = (country, it) => it.h_en ? { h: it.h_en, b: it.b_en || "" } : (EN[country] && EN[country][it.h]) ? { h: EN[country][it.h].h, b: EN[country][it.h].b || "" } : null;
try { const rg = JSON.parse(fs.readFileSync(path.join(SITE_DIR, "regions.json"), "utf8")); if (!rg.note) { for (const it of rg.japan || []) (news.items["JP:" + it.area] ||= []).push(it); for (const it of rg.usa || []) (news.items["US:" + it.area] ||= []).push(it); } } catch {}
const GEO = JSON.parse(fs.readFileSync(path.resolve("scripts/region_geo.json"), "utf8"));
const nameEn = c => c.startsWith("JP:") ? ((GEO.japan[c.slice(3)] || [])[2] || c.slice(3)) + ", Japan" : c.startsWith("US:") ? c.slice(3) : null;
const wanted = new Map();
for (const [country, items] of Object.entries(news.items || {})) for (const it of items) {
  const d = new Date((it.t || "").slice(0, 10)); if (isNaN(d) || Date.now() - d > MAX_AGE) continue;
  const en = enOf(country, it); if (!en) continue;
  wanted.set(fnv(country + "|" + it.t + "|" + it.h), { country, it, en });
}
let made = 0;
for (const [key, { country, it, en }] of wanted) {
  if (index.items[key] && fs.existsSync(path.join(SITE_DIR, index.items[key].file))) continue;
  { const onDisk = ["ogg", "wav"].map(ext => `voice/en_${key}.${ext}`).find(f => fs.existsSync(path.join(SITE_DIR, f)));
    if (onDisk && index.voice === VOICE) { let dur = 0; try { dur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.join(SITE_DIR, onDisk)]).toString().trim()); } catch {}
      index.items[key] = { file: onDisk, dur: Math.round(dur * 10) / 10 }; continue; } }
  const text = prep(`${nameEn(country) || EN_NAME[country] || country}. ${en.h}. ${en.b}`);
  try {
    const r = synth(text, path.join(VOICE_DIR, "en_" + key));
    index.items[key] = { file: "voice/" + path.basename(r.file), dur: Math.round(r.dur * 10) / 10 }; made++;
    console.log(`+ ${country}: ${en.h} (${r.dur.toFixed(1)}s)`);
  } catch (e) { console.error(`! ${country}: ${en.h}: ${e.message}`); }
}
for (const key of Object.keys(index.items)) if (!wanted.has(key)) { try { fs.unlinkSync(path.join(SITE_DIR, index.items[key].file)); } catch {} delete index.items[key]; }
index.updated = new Date().toISOString(); index.credit = `Piper TTS (${VOICE})`; index.voice = VOICE;
fs.writeFileSync(idxPath, JSON.stringify(index, null, 1) + "\n");
console.log(`english voice clips: ${Object.keys(index.items).length} (new ${made}) — ${index.credit}${HAS_FFMPEG ? "" : "  [ffmpeg なし: WAV で保存]"}`);
