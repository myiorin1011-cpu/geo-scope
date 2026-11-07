#!/usr/bin/env node
// English voice sampler (Piper TTS). 候補モデルを取得し、同じ文を合成して voice_samples_en/index.html で聞き比べ（無線加工はブラウザ内）。
// 必要: pip install piper-tts   env: VOICES (カンマ区切り), TEXT, LENGTH_SCALE(0.8), PIPER_DIR(.piper), PIPER_BIN(piper)
import fs from "node:fs"; import path from "node:path"; import { execFileSync, spawnSync } from "node:child_process";
const PIPER = process.env.PIPER_BIN || "piper", PDIR = path.resolve(process.env.PIPER_DIR || ".piper"), OUT = path.resolve("voice_samples_en");
const LENGTH = process.env.LENGTH_SCALE || "0.8";
const VOICES = (process.env.VOICES || "en_US-lessac-medium,en_US-amy-medium,en_US-kristin-medium,en_GB-alba-medium,en_US-hfc_female-medium,en_US-joe-medium,en_US-ryan-high").split(",").map(s => s.trim()).filter(Boolean);
const TEXT = process.env.TEXT || "Geo Scope. Ukraine, Kyiv. Agreement with Russia on monthly aid deliveries to residents of Oleshky. Zelensky asks Musk to lift Starlink speed limits; no reply. Over.";
if (spawnSync(PIPER, ["--help"]).status !== 0) { console.error("piper が見つかりません: pip install piper-tts"); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(PDIR, { recursive: true });
const rows = [];
for (const v of VOICES) {
  const model = path.join(PDIR, v + ".onnx");
  if (!fs.existsSync(model) || !fs.existsSync(model + ".json")) {
    process.stdout.write(`  downloading ${v} … `);
    const r = spawnSync("python", ["-m", "piper.download_voices", v, "--data-dir", PDIR], { stdio: "pipe" });
    if (r.status !== 0) { const r2 = spawnSync("python3", ["-m", "piper.download_voices", v, "--data-dir", PDIR], { stdio: "pipe" }); if (r2.status !== 0) { console.log("failed (skip)"); continue; } }
    console.log("ok");
  }
  process.stdout.write(`  ${v} … `);
  const wav = path.join(OUT, v + ".wav");
  try { execFileSync(PIPER, ["-m", model, "-c", model + ".json", "-f", wav, "--length-scale", LENGTH], { input: TEXT }); } catch (e) { console.log("failed: " + e.message.split("\n")[0]); continue; }
  rows.push({ id: v, data: "data:audio/wav;base64," + fs.readFileSync(wav).toString("base64") }); console.log("ok");
}
const html = `<!doctype html><meta charset="utf-8"><title>GEO-SCOPE English voice samples</title>
<style>body{font-family:system-ui;background:#0b1114;color:#dfe;padding:24px;max-width:960px;margin:auto}h1{font-size:18px}table{border-collapse:collapse;width:100%}td,th{padding:8px 10px;border-bottom:1px solid #234;text-align:left;font-size:14px;vertical-align:middle}audio{width:260px;height:32px}code{background:#122;padding:2px 6px;border-radius:4px}.t{color:#9bc;font-size:13px;margin:8px 0 18px}
button{background:#0f2a26;color:#8ff;border:1px solid #2a6;padding:6px 14px;border-radius:4px;cursor:pointer;font-size:13px}button.on{background:#1b4;color:#021}.ctl{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin:0 0 14px;font-size:13px;color:#9bc}.ctl label{display:flex;gap:6px;align-items:center}input[type=range]{width:110px}</style>
<h1>GEO-SCOPE English voice samples (Piper)</h1>
<div class="t">Text: ${TEXT.replace(/</g, "&lt;")}<br>length_scale ${LENGTH}　Set the chosen voice as Actions variable <code>GEOSCOPE_PIPER_VOICE</code> (or env <code>PIPER_VOICE</code>).</div>
<div class="ctl"><b>Radio</b><label>drive <input id="drv" type="range" min="1" max="5" step=".1" value="5"></label><label>noise <input id="nz" type="range" min="0" max="0.08" step=".005" value="0.08"></label><label>band <select id="bw"><option value="320,3200">320–3200Hz</option><option value="400,2600" selected>400–2600Hz (same as the page)</option></select></label><label>squelch <input id="sq" type="range" min="0" max="1" step=".05" value=".4"></label></div>
<table><tr><th>voice</th><th>raw</th><th>radio</th></tr>
${rows.map((r, i) => `<tr><td><code>${r.id}</code></td><td><audio controls preload="metadata" src="${r.data}"></audio></td><td><button data-i="${i}">▶ radio</button></td></tr>`).join("\n")}
</table>
<script>
const DATA=${JSON.stringify(rows.map(r => r.data))};
let ctx,cur=null;const dec=new Map();
async function buf(i){if(dec.has(i))return dec.get(i);const ab=await (await fetch(DATA[i])).arrayBuffer();const b=await ctx.decodeAudioData(ab);dec.set(i,b);return b;}
function noiseBuf(sec){const n=ctx.sampleRate*sec,b=ctx.createBuffer(1,n,ctx.sampleRate),d=b.getChannelData(0);let l=0;for(let i=0;i<n;i++){const w=Math.random()*2-1;l=.97*l+.03*w;d[i]=(w*.6+l*1.4)*.5;}return b;}
function squelch(t,dur,v){if(v<=0)return;const s=ctx.createBufferSource();s.buffer=noiseBuf(dur);const hp=ctx.createBiquadFilter();hp.type='highpass';hp.frequency.value=700;const sh=ctx.createWaveShaper();{const c=new Float32Array(256);for(let k=0;k<256;k++){const x=k/127.5-1;c[k]=Math.tanh(4*x)}sh.curve=c;}const g=ctx.createGain();g.gain.setValueAtTime(v*.9,t);g.gain.setValueAtTime(v*.9,t+dur*.45);g.gain.exponentialRampToValueAtTime(.0001,t+dur);s.connect(hp);hp.connect(sh);sh.connect(g);g.connect(ctx.destination);s.start(t);s.stop(t+dur+.02);}
async function play(i,btn){ctx=ctx||new (window.AudioContext||window.webkitAudioContext)();await ctx.resume();if(cur){try{cur.stop()}catch(e){}cur=null;document.querySelectorAll('button.on').forEach(b=>{b.classList.remove('on');b.textContent='▶ radio'});}
  const b=await buf(i);const drive=+drv.value,nz=+document.getElementById('nz').value,sq=+document.getElementById('sq').value,[f1,f2]=bw.value.split(',').map(Number);
  const t0=ctx.currentTime+.05;const src=ctx.createBufferSource();src.buffer=b;
  const hp=ctx.createBiquadFilter();hp.type='highpass';hp.frequency.value=f1;hp.Q.value=.8;const pk=ctx.createBiquadFilter();pk.type='peaking';pk.frequency.value=1800;pk.Q.value=1;pk.gain.value=6;
  const sh=ctx.createWaveShaper();{const c=new Float32Array(1024);for(let k=0;k<1024;k++){const x=k/511.5-1;c[k]=Math.tanh(drive*x)/Math.tanh(drive);}sh.curve=c;sh.oversample='2x';}
  const lp=ctx.createBiquadFilter();lp.type='lowpass';lp.frequency.value=f2;lp.Q.value=.9;const comp=ctx.createDynamicsCompressor();comp.threshold.value=-24;comp.ratio.value=6;comp.attack.value=.004;comp.release.value=.12;const g=ctx.createGain();g.gain.value=1.4;
  src.connect(hp);hp.connect(pk);pk.connect(sh);sh.connect(lp);lp.connect(comp);comp.connect(g);g.connect(ctx.destination);
  const n=ctx.createBufferSource();n.buffer=noiseBuf(b.duration+.4);const nb=ctx.createBiquadFilter();nb.type='bandpass';nb.frequency.value=1500;nb.Q.value=.6;const ng=ctx.createGain();ng.gain.value=nz;n.connect(nb);nb.connect(ng);ng.connect(ctx.destination);
  squelch(t0-.04,.16,sq);src.start(t0+.16);n.start(t0);n.stop(t0+b.duration+.4);squelch(t0+b.duration+.2,.12,sq*.9);
  cur=src;btn.classList.add('on');btn.textContent='■ playing';src.onended=()=>{if(cur===src){cur=null;btn.classList.remove('on');btn.textContent='▶ radio';}};}
document.querySelectorAll('button[data-i]').forEach(b=>b.addEventListener('click',()=>{if(b.classList.contains('on')){try{cur.stop()}catch(e){}return;}play(+b.dataset.i,b);}));
</script>`;
fs.writeFileSync(path.join(OUT, "index.html"), html);
console.log(`\n→ ${path.join(OUT, "index.html")} をブラウザで開いてください（${rows.length} voices）`);
