#!/usr/bin/env node
// GEO-SCOPE country-profile voice clips — static text (capital / population / government / advisory / Japan ties), synthesized once per country.
// ja: VOICEVOX (http://127.0.0.1:50021)   en: Piper   → site/voice/profile_<ISO>_ja.ogg / _en.ogg + site/voice/index_profile.json  (keys "ISO|ja", "ISO|en")
// env: LANGS=ja,en  SPEAKER(30) SPEED(1.25) PITCH INTONATION PAUSE  VOICEVOX_URL  PIPER_BIN PIPER_VOICE(en_US-amy-medium) PIPER_DIR LENGTH_SCALE(0.8)  SITE_DIR  ONLY=ISO,ISO (subset)
import fs from "node:fs"; import path from "node:path"; import { execFileSync, spawnSync } from "node:child_process";
import { normalizeWav, FF_LOUDNORM } from "./loudness.mjs";
const SITE_DIR = process.env.SITE_DIR || path.resolve("site"), VOICE_DIR = path.join(SITE_DIR, "voice"); fs.mkdirSync(VOICE_DIR, { recursive: true });
const LANGS = (process.env.LANGS || "ja,en").split(","); const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0;
const DATA = JSON.parse(fs.readFileSync(path.resolve("scripts/data_all.json"), "utf8"));
let EN = {}; try { EN = JSON.parse(fs.readFileSync(path.join(SITE_DIR, "data_en.json"), "utf8")).countries || {}; } catch {}
const idxPath = path.join(VOICE_DIR, "index_profile.json");
const index = fs.existsSync(idxPath) ? JSON.parse(fs.readFileSync(idxPath, "utf8")) : { items: {} };
const readings = JSON.parse(fs.readFileSync(path.resolve("scripts/readings.json"), "utf8")); delete readings._comment;
const readEn = JSON.parse(fs.readFileSync(path.resolve("scripts/readings_en.json"), "utf8")); delete readEn._comment;
const applyR = (t, R) => { let s = t; for (const k of Object.keys(R).sort((a, b) => b.length - a.length)) s = s.split(k).join(R[k]); return s.replace(/[「」『』（）()]/g, " ").replace(/\s+/g, " ").trim(); };
const LJ = ["危険情報なし", "十分注意", "不要不急の渡航中止", "渡航中止勧告", "退避勧告"], LE = ["No advisory", "Exercise caution", "Avoid non-essential travel", "Do not travel", "Evacuate"];
const EN_NAME = { "United States of America": "the United States", "United Kingdom": "the United Kingdom", "Dem. Rep. Congo": "the Democratic Republic of the Congo", "S. Sudan": "South Sudan", "Central African Rep.": "the Central African Republic", "Eq. Guinea": "Equatorial Guinea", "Bosnia and Herz.": "Bosnia and Herzegovina", "Macedonia": "North Macedonia", "Solomon Is.": "the Solomon Islands", "Dominican Rep.": "the Dominican Republic", "eSwatini": "Eswatini", "Côte d'Ivoire": "Ivory Coast", "Congo": "the Republic of the Congo", "Czechia": "the Czech Republic", "Netherlands": "the Netherlands", "Philippines": "the Philippines", "United Arab Emirates": "the United Arab Emirates", "Bahamas": "the Bahamas", "Gambia": "the Gambia", "Maldives": "the Maldives", "Marshall Islands": "the Marshall Islands" };

// must match profileItem() in the page
function textJa(n, d) { const b = d.basic || {}; const trav = d.travel != null ? `渡航レベル${d.travel}、${LJ[d.travel] || ""}。` : ""; const jp = (d.jp || "").split(/(?<=。)/)[0] || ""; return `${d.ja}。${b["首都"]}、${b["人口"]}。${b["政体"]}。${trav}${jp}`; }
function textEn(n, d) { const e = EN[n] || {}; const b = e.basic || {}; const trav = d.travel != null ? `Travel advisory level ${d.travel}: ${LE[d.travel] || ""}. ` : ""; const jp = (e.jp || "").split(/(?<=\.)\s/)[0] || ""; return `${EN_NAME[n] || n}. ${b["Capital"] || d.basic["首都"]}, ${b["Population"] || d.basic["人口"]}. ${b["Government"] || d.basic["政体"]}. ${trav}${jp}`; }

// ---- ja: VOICEVOX
const VV = process.env.VOICEVOX_URL || "http://127.0.0.1:50021", SPEAKER = Number(process.env.SPEAKER || 30);
async function synthJa(text, base) {
  const q = await (await fetch(`${VV}/audio_query?${new URLSearchParams({ text, speaker: SPEAKER })}`, { method: "POST" })).json();
  q.speedScale = Number(process.env.SPEED || 1.25); q.pitchScale = Number(process.env.PITCH || 0.02); q.intonationScale = Number(process.env.INTONATION || 1.35); q.volumeScale = Number(process.env.VOLUME || 1.1); q.prePhonemeLength = 0.04; q.postPhonemeLength = 0.04; if ("pauseLengthScale" in q) q.pauseLengthScale = Number(process.env.PAUSE || 0.7); q.outputSamplingRate = 24000;
  const wav = Buffer.from(await (await fetch(`${VV}/synthesis?${new URLSearchParams({ speaker: SPEAKER })}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(q) })).arrayBuffer());
  return finish(wav, base, 24000);
}
// ---- en: Piper
const PIPER = process.env.PIPER_BIN || "piper", PVOICE = process.env.PIPER_VOICE || "en_US-amy-medium", PDIR = path.resolve(process.env.PIPER_DIR || ".piper");
const MODEL = path.join(PDIR, PVOICE + ".onnx");
function synthEn(text, base) { const wav = base + ".tmp.wav"; execFileSync(PIPER, ["-m", MODEL, "-c", MODEL + ".json", "-f", wav, "--length-scale", process.env.LENGTH_SCALE || "0.8", "--sentence-silence", "0.25"], { input: text }); const buf = fs.readFileSync(wav); fs.unlinkSync(wav); return finish(buf, base, buf.readUInt32LE(24) || 22050); }
function finish(wav, base, sr) {
  if (!HAS_FFMPEG) { wav = normalizeWav(wav); fs.writeFileSync(base + ".wav", wav); return { file: base + ".wav", dur: Math.max(0, wav.length - 44) / (sr * 2) }; }
  const tmp = base + ".src.wav"; fs.writeFileSync(tmp, wav); execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", tmp, ...FF_LOUDNORM, "-ac", "1", "-ar", "24000", "-c:a", "libopus", "-b:a", "32k", base + ".ogg"]); fs.unlinkSync(tmp);
  const dur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", base + ".ogg"]).toString().trim()); return { file: base + ".ogg", dur };
}
let credit = {}; try { if (LANGS.includes("ja")) { const sp = await (await fetch(`${VV}/speakers`)).json(); for (const s of sp) for (const st of s.styles) if (st.id === SPEAKER) credit.ja = `VOICEVOX:${s.name}`; } } catch { console.error("VOICEVOX に接続できません → 日本語はスキップ"); LANGS.splice(LANGS.indexOf("ja"), 1); }
if (LANGS.includes("en")) { if (spawnSync(PIPER, ["--help"]).status !== 0 || !fs.existsSync(MODEL)) { console.error("Piper または音声モデルが無いため英語はスキップ（pip install piper-tts / python -m piper.download_voices " + PVOICE + " --data-dir .piper）"); LANGS.splice(LANGS.indexOf("en"), 1); } else credit.en = `Piper TTS (${PVOICE})`; }

let made = 0;
for (const [n, d] of Object.entries(DATA)) {
  if (!d.iso || (ONLY && !ONLY.has(d.iso))) continue;
  for (const L of LANGS) {
    const key = `${d.iso}|${L}`; const base = path.join(VOICE_DIR, `profile_${d.iso}_${L}`);
    const text = L === "ja" ? applyR(textJa(n, d), readings) : applyR(textEn(n, d), readEn);
    const prev = index.items[key];
    if (prev && prev.text === text && fs.existsSync(path.join(SITE_DIR, prev.file))) continue; // unchanged → keep
    try { const r = L === "ja" ? await synthJa(text, base) : synthEn(text, base); index.items[key] = { file: "voice/" + path.basename(r.file), dur: Math.round(r.dur * 10) / 10, text }; made++; process.stdout.write(`+ ${d.iso} ${L} (${r.dur.toFixed(1)}s)\n`); }
    catch (e) { console.error(`! ${d.iso} ${L}: ${e.message}`); }
  }
}
index.updated = new Date().toISOString(); index.credit = credit;
fs.writeFileSync(idxPath, JSON.stringify(index, null, 1) + "\n");
console.log(`profile clips: ${Object.keys(index.items).length} (new ${made}) — ${Object.values(credit).join(" / ")}`);
