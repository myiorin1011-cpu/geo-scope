#!/usr/bin/env node
// GEO-SCOPE voice synthesizer — VOICEVOX engine (http://127.0.0.1:50021) → ogg/opus → site/voice/
// env: VOICEVOX_URL, SPEAKER (default 30 = No.7 アナウンス。29=ノーマル 31=読み聞かせ), SITE_DIR, MAX_AGE_DAYS(3), SPEED(1.25), PITCH(0.02), INTONATION(1.35), VOLUME(1.1), PAUSE(0.7)
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { normalizeWav, FF_LOUDNORM } from "./loudness.mjs";
const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0; // 無ければ WAV のまま保存（約10倍大きいがページはそのまま再生できる）

const VV = process.env.VOICEVOX_URL || "http://127.0.0.1:50021";
const SPEAKER = Number(process.env.SPEAKER || 30);
const SITE_DIR = process.env.SITE_DIR || path.resolve("site");
const VOICE_DIR = path.join(SITE_DIR, "voice");
const MAX_AGE = Number(process.env.MAX_AGE_DAYS || 3) * 86400e3;
const readings = JSON.parse(fs.readFileSync(path.resolve("scripts/readings.json"), "utf8"));
delete readings._comment;
fs.mkdirSync(VOICE_DIR, { recursive: true });

const news = JSON.parse(fs.readFileSync(path.join(SITE_DIR, "news.json"), "utf8"));
// regional business items (regions.json) join the same loop under the page's keys "JP:<都道府県>" / "US:<State>"
try { const rg = JSON.parse(fs.readFileSync(path.join(SITE_DIR, "regions.json"), "utf8")); if (!rg.note) { for (const it of rg.japan || []) (news.items["JP:" + it.area] ||= []).push(it); for (const it of rg.usa || []) (news.items["US:" + it.area] ||= []).push(it); } } catch {}
const GEO = JSON.parse(fs.readFileSync(path.resolve("scripts/region_geo.json"), "utf8"));
const nameJa = c => c.startsWith("JP:") ? c.slice(3) : c.startsWith("US:") ? ((GEO.usa[c.slice(3)] || [])[2] || c.slice(3)) : null;
const idxPath = path.join(VOICE_DIR, "index.json");
const index = fs.existsSync(idxPath) ? JSON.parse(fs.readFileSync(idxPath, "utf8")) : { items: {} };

// must match the page: FNV-1a 32bit over country|t|h
const fnv = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, "0"); };

// country display names (ja) from index.html DATA would be ideal; keep a light map here
const JA = JSON.parse(fs.readFileSync(path.resolve("scripts/country_ja.json"), "utf8"));

function applyReadings(t) {
  let s = t;
  const keys = Object.keys(readings).sort((a, b) => b.length - a.length);
  for (const k of keys) s = s.split(k).join(readings[k]);
  return s.replace(/[「」『』（）()]/g, " ").replace(/\s+/g, " ").trim();
}

async function speakerInfo() {
  const sp = await (await fetch(`${VV}/speakers`)).json();
  for (const s of sp) for (const st of s.styles) if (st.id === SPEAKER) return `VOICEVOX:${s.name}`;
  return "VOICEVOX";
}

async function synth(text, outOgg) {
  const q = await (await fetch(`${VV}/audio_query?${new URLSearchParams({ text, speaker: SPEAKER })}`, { method: "POST" })).json();
  q.speedScale = Number(process.env.SPEED || 1.25);      // 速め（聞き比べ後に 1.15 → 1.25 へ）
  q.pitchScale = Number(process.env.PITCH || 0.02);       // ほんの少し高く
  q.intonationScale = Number(process.env.INTONATION || 1.35); // 抑揚強め＝ハキハキ
  q.volumeScale = Number(process.env.VOLUME || 1.1);
  q.prePhonemeLength = 0.04; q.postPhonemeLength = 0.04;  // 前後の間を詰める
  if ("pauseLengthScale" in q) q.pauseLengthScale = Number(process.env.PAUSE || 0.7); // 句読点の間を短く＝焦燥感
  q.outputSamplingRate = 24000;
  let wav = Buffer.from(await (await fetch(`${VV}/synthesis?${new URLSearchParams({ speaker: SPEAKER })}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(q) })).arrayBuffer());
  if (!HAS_FFMPEG) { // WAV fallback: 24kHz/16bit/mono → duration from the data chunk size
    const outWav = outOgg.replace(/\.ogg$/, ".wav"); wav = normalizeWav(wav); fs.writeFileSync(outWav, wav);
    return { file: outWav, dur: Math.max(0, wav.length - 44) / (24000 * 2) };
  }
  const tmp = outOgg + ".wav"; fs.writeFileSync(tmp, wav);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", tmp, ...FF_LOUDNORM, "-ac", "1", "-ar", "24000", "-c:a", "libopus", "-b:a", "32k", outOgg]);
  fs.unlinkSync(tmp);
  const dur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", outOgg]).toString().trim());
  return { file: outOgg, dur };
}

(async () => {
  const credit = await speakerInfo();
  const wanted = new Map();
  for (const [country, items] of Object.entries(news.items || {})) {
    for (const it of items) {
      const d = new Date((it.t || "").slice(0, 10)); if (isNaN(d) || Date.now() - d > MAX_AGE) continue;
      const key = fnv(country + "|" + it.t + "|" + it.h);
      wanted.set(key, { country, it });
    }
  }
  let made = 0;
  for (const [key, { country, it }] of wanted) {
    const file = `voice/${key}.${HAS_FFMPEG ? "ogg" : "wav"}`;
    if (index.items[key] && fs.existsSync(path.join(SITE_DIR, index.items[key].file))) continue;
    // index lost (e.g. overwritten by an update) but the clip is still on disk → re-register instead of re-synthesizing
    { const onDisk = ["ogg", "wav"].map(ext => `voice/${key}.${ext}`).find(f => fs.existsSync(path.join(SITE_DIR, f)));
      if (onDisk) { let dur = 0; try { dur = onDisk.endsWith(".wav") ? Math.max(0, fs.statSync(path.join(SITE_DIR, onDisk)).size - 44) / 48000 : Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.join(SITE_DIR, onDisk)]).toString().trim()); } catch {}
        index.items[key] = { file: onDisk, dur: Math.round(dur * 10) / 10 }; continue; } }
    const text = applyReadings(`${nameJa(country) || JA[country] || country}。${it.h}。${it.b}`);
    try {
      const r = await synth(text, path.join(SITE_DIR, `voice/${key}.ogg`));
      const dur = r.dur; index.items[key] = { file: `voice/${path.basename(r.file)}`, dur: Math.round(dur * 10) / 10 }; made++;
      console.log(`+ ${country}: ${it.h} (${dur.toFixed(1)}s)`);
    } catch (e) { console.error(`! ${country}: ${it.h}: ${e.message}`); }
  }
  // prune
  for (const key of Object.keys(index.items)) {
    if (!wanted.has(key)) { try { fs.unlinkSync(path.join(SITE_DIR, index.items[key].file)); } catch {} delete index.items[key]; }
  }
  index.updated = new Date().toISOString(); index.credit = credit; index.speaker = SPEAKER;
  fs.writeFileSync(idxPath, JSON.stringify(index, null, 1) + "\n");
  console.log(`voice clips: ${Object.keys(index.items).length} (new ${made}) — ${credit}${HAS_FFMPEG ? "" : "  [ffmpeg なし: WAV で保存。winget install ffmpeg で ogg に]"}`);
})();
