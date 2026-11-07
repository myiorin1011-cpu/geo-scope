#!/usr/bin/env node
// Re-level clips that already exist in site/voice (made before loudness normalization was added).
// WAV → pure-JS RMS normalization (no ffmpeg needed). OGG → ffmpeg loudnorm re-encode (skipped without ffmpeg).
// Idempotent: a second run changes nothing. env: SITE_DIR, RMS_DB(-17), LUFS(-16)
import fs from "node:fs"; import path from "node:path"; import { execFileSync, spawnSync } from "node:child_process";
import { normalizeWav, gainDb, FF_LOUDNORM } from "./loudness.mjs";
const DIR = path.join(process.env.SITE_DIR || path.resolve("site"), "voice");
const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0;
let w = 0, o = 0, skipped = 0;
for (const f of fs.readdirSync(DIR)) {
  const p = path.join(DIR, f);
  if (f.endsWith(".wav")) { const b = fs.readFileSync(p); const before = gainDb(b); const n = normalizeWav(b); if (n !== b) { fs.writeFileSync(p, n); w++; console.log(`wav ${f}: ${before.toFixed(1)} → ${gainDb(n).toFixed(1)} dBFS`); } else skipped++; }
  else if (f.endsWith(".ogg")) {
    if (!HAS_FFMPEG) { skipped++; continue; }
    const tag = p + ".norm.ogg"; // marker-free idempotence: loudnorm on an already-normalized clip is a no-op within ±0.5 LU
    try { execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", p, ...FF_LOUDNORM, "-ac", "1", "-ar", "24000", "-c:a", "libopus", "-b:a", "32k", tag]); fs.renameSync(tag, p); o++; } catch (e) { console.error(`! ${f}: ${e.message}`); }
  }
}
console.log(`normalized: wav ${w}, ogg ${o}, unchanged/skipped ${skipped}${HAS_FFMPEG ? "" : " (ogg は ffmpeg が無いため未処理)"}`);
