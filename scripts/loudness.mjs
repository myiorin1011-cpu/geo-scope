// Loudness helpers shared by the voice scripts.
// ffmpeg available → EBU R128 loudnorm (I=-16 LUFS, TP=-1.5 dB). No ffmpeg → pure-JS RMS normalization of 16-bit PCM WAV
// (target -17 dBFS RMS, peak ≤ -1 dBFS), so VOICEVOX / Piper clips end up at the same level either way.
export const FF_LOUDNORM = ["-af", `loudnorm=I=${process.env.LUFS || -16}:TP=-1.5:LRA=11`];
const TARGET_RMS_DB = Number(process.env.RMS_DB || -17), PEAK_DB = -1;
export function normalizeWav(buf) {
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF") return buf;
  const bits = buf.readUInt16LE(34); if (bits !== 16) return buf;
  // locate the data chunk
  let p = 12, dataOff = -1, dataLen = 0;
  while (p + 8 <= buf.length) { const id = buf.toString("ascii", p, p + 4), len = buf.readUInt32LE(p + 4); if (id === "data") { dataOff = p + 8; dataLen = Math.min(len, buf.length - dataOff); break; } p += 8 + len + (len & 1); }
  if (dataOff < 0 || dataLen < 2) return buf;
  const n = dataLen >> 1; let sum = 0, peak = 0;
  for (let i = 0; i < n; i++) { const v = buf.readInt16LE(dataOff + i * 2); sum += v * v; if (Math.abs(v) > peak) peak = Math.abs(v); }
  const rms = Math.sqrt(sum / n) / 32768; if (!rms || !peak) return buf;
  let g = Math.pow(10, TARGET_RMS_DB / 20) / rms; const maxG = Math.pow(10, PEAK_DB / 20) * 32767 / peak; if (g > maxG) g = maxG;
  if (Math.abs(g - 1) < 0.02) return buf;
  const out = Buffer.from(buf);
  for (let i = 0; i < n; i++) { let v = Math.round(buf.readInt16LE(dataOff + i * 2) * g); if (v > 32767) v = 32767; else if (v < -32768) v = -32768; out.writeInt16LE(v, dataOff + i * 2); }
  return out;
}
export const gainDb = (buf) => { // for logging: RMS of a wav in dBFS
  const bits = buf.readUInt16LE(34); if (bits !== 16) return NaN; let p = 12, off = -1, len = 0;
  while (p + 8 <= buf.length) { const id = buf.toString("ascii", p, p + 4), l = buf.readUInt32LE(p + 4); if (id === "data") { off = p + 8; len = Math.min(l, buf.length - off); break; } p += 8 + l + (l & 1); }
  if (off < 0) return NaN; let s = 0; const n = len >> 1; for (let i = 0; i < n; i++) { const v = buf.readInt16LE(off + i * 2); s += v * v; } return 20 * Math.log10(Math.sqrt(s / n) / 32768);
};
