#!/usr/bin/env node
// GEO-SCOPE voice sampler — 手元の VOICEVOX（アプリ or エンジン）で、候補の話者ごとに同じ文を合成して聞き比べるためのツール。
// 使い方:  VOICEVOX アプリを起動した状態で  node scripts/voice_sample.mjs
//          → voice_samples/index.html をブラウザで開く（素の音声と、配信ページと同じ無線加工をブラウザ内でかけた音声を聞き比べ。ffmpeg 不要）
// env: VOICEVOX_URL (http://127.0.0.1:50021), GROUP=female|male|all（既定 all。女性候補→男性候補の順に並ぶ）, SPEAKERS (カンマ区切りのスタイルID。指定時は GROUP より優先),
//      TEXT (サンプル文), SPEED(1.25) PITCH(0.02) INTONATION(1.35) VOLUME(1.1) PAUSE(0.7)  ※ synth_voice.mjs と同じ既定値（ハキハキ・緊張感寄り）
import fs from "node:fs";
import path from "node:path";

const VV = process.env.VOICEVOX_URL || "http://127.0.0.1:50021";
const OUT = path.resolve("voice_samples");
const TEXT = process.env.TEXT || "こちらジオスコープ。ウクライナ、キーウ。オレシュキ住民への支援物資搬入で、月1回以上の仕組みにロシアと合意。以上。";
const SPEED = Number(process.env.SPEED || 1.25), PITCH = Number(process.env.PITCH || 0.02), INTON = Number(process.env.INTONATION || 1.35), VOL = Number(process.env.VOLUME || 1.1), PAUSE = Number(process.env.PAUSE || 0.7);
// 候補（キャラ名の部分一致。実際の ID は /speakers から引く）。GROUP=female|male|all で絞り込み（既定 all）
const PREFER_F = ["波音リツ", "冥鳴ひまり", "ナースロボ", "九州そら", "四国めたん", "春日部つむぎ", "WhiteCUL", "小夜", "琴詠ニア", "もち子", "櫻歌ミコ", "No.7"];
const PREFER_M = ["青山龍星", "玄野武宏", "白上虎太郎", "剣崎雌雄", "麒ヶ島宗麟", "後鬼", "栗田まろん", "満別花丸", "雀松朱司", "中部つるぎ", "聖騎士 紅桜", "†聖騎士 紅桜†"];
const GROUP = (process.env.GROUP || "all").toLowerCase();


async function main() {
  let speakers;
  try { speakers = await (await fetch(`${VV}/speakers`)).json(); }
  catch (e) {
    console.error(`VOICEVOX に接続できません (${VV})。VOICEVOX アプリを起動してから再実行してください。`);
    console.error("  ダウンロード: https://voicevox.hiroshiba.jp/  （無料。起動中は同じURLでエンジンAPIが使えます）");
    process.exit(1);
  }
  let targets = [];
  if (process.env.SPEAKERS) {
    const ids = process.env.SPEAKERS.split(",").map(s => Number(s.trim()));
    for (const s of speakers) for (const st of s.styles) if (ids.includes(st.id)) targets.push({ id: st.id, name: s.name, style: st.name });
  } else {
    const pick = (list, group) => { for (const s of speakers) if (list.some(p => s.name.includes(p))) for (const st of s.styles) if (/ノーマル|通常|normal/i.test(st.name) || s.styles.length === 1 || /No\.7/.test(s.name)) targets.push({ id: st.id, name: s.name, style: st.name, group }); }; // No.7 は全スタイル（アナウンス/読み聞かせ）を並べる
    if (GROUP !== "male") pick(PREFER_F, "女性");
    if (GROUP !== "female") pick(PREFER_M, "男性");
  }
  if (!targets.length) { console.error("対象の話者が見つかりません。SPEAKERS=9,13 のようにIDを指定してください。利用可能:"); for (const s of speakers) console.error(`  ${s.name}: ${s.styles.map(st => `${st.name}=${st.id}`).join(", ")}`); process.exit(1); }

  fs.mkdirSync(OUT, { recursive: true });
  const rows = [];
  for (const t of targets) {
    process.stdout.write(`  ${t.group ? "[" + t.group + "] " : ""}${t.name}（${t.style} / id ${t.id}）… `);
    const q = await (await fetch(`${VV}/audio_query?${new URLSearchParams({ text: TEXT, speaker: t.id })}`, { method: "POST" })).json();
    q.speedScale = SPEED; q.pitchScale = PITCH; q.intonationScale = INTON; q.volumeScale = VOL; q.prePhonemeLength = 0.04; q.postPhonemeLength = 0.04; if ("pauseLengthScale" in q) q.pauseLengthScale = PAUSE; q.outputSamplingRate = 24000;
    const wav = Buffer.from(await (await fetch(`${VV}/synthesis?${new URLSearchParams({ speaker: t.id })}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(q) })).arrayBuffer());
    const raw = path.join(OUT, `sp${t.id}_raw.wav`); fs.writeFileSync(raw, wav);
    rows.push({ ...t, raw: path.basename(raw), data: "data:audio/wav;base64," + wav.toString("base64") });
    console.log("ok");
  }
  // 無線加工はブラウザ側（Web Audio）で行う: 配信ページと同じチェーン（HP320 → ピーク → 歪み → LP3200 → コンプ ＋ スケルチ音・ノイズ床）。
  // file:// で開いても動くように音声は data URI で埋め込む（ffmpeg 不要）。
  const html = `<!doctype html><meta charset="utf-8"><title>GEO-SCOPE voice samples</title>
<style>body{font-family:system-ui;background:#0b1114;color:#dfe;padding:24px;max-width:960px;margin:auto}h1{font-size:18px}table{border-collapse:collapse;width:100%}td,th{padding:8px 10px;border-bottom:1px solid #234;text-align:left;font-size:14px;vertical-align:middle}audio{width:260px;height:32px}code{background:#122;padding:2px 6px;border-radius:4px}.t{color:#9bc;font-size:13px;margin:8px 0 18px}
button{background:#0f2a26;color:#8ff;border:1px solid #2a6;padding:6px 14px;border-radius:4px;cursor:pointer;font-size:13px}button:disabled{opacity:.5;cursor:default}button.on{background:#1b4;color:#021}
.ctl{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin:0 0 14px;font-size:13px;color:#9bc}.ctl label{display:flex;gap:6px;align-items:center}input[type=range]{width:110px}</style>
<h1>GEO-SCOPE 読み上げ声サンプル</h1>
<div class="t">文: ${TEXT.replace(/</g, "&lt;")}<br>speed ${SPEED} / pitch ${PITCH} / intonation ${INTON} / volume ${VOL} / pause ${PAUSE}　気に入ったIDを Actions の変数 <code>GEOSCOPE_SPEAKER</code>（または env <code>SPEAKER</code>）に設定してください。</div>
<div class="ctl"><b>無線加工</b><label>歪み <input id="drv" type="range" min="1" max="5" step=".1" value="5"></label><label>ノイズ <input id="nz" type="range" min="0" max="0.08" step=".005" value="0.08"></label><label>帯域 <select id="bw"><option value="320,3200">320–3200Hz</option><option value="250,4000">250–4000Hz（少し広め）</option><option value="400,2600" selected>400–2600Hz（より無線らしく・配信ページと同じ）</option></select></label><label>ザッ <input id="sq" type="range" min="0" max="1" step=".05" value=".4"></label></div>
<table><tr><th>ID</th><th>話者</th><th>素の音声</th><th>無線加工後</th></tr>
${rows.map((r, i) => `${r.group && (i === 0 || rows[i - 1].group !== r.group) ? `<tr><th colspan="4" style="padding-top:18px;color:#8ff;letter-spacing:.1em">${r.group}声</th></tr>` : ""}<tr><td><code>${r.id}</code></td><td>${r.name}<br><small>${r.style}</small></td><td><audio controls preload="metadata" src="${r.data}"></audio></td><td><button data-src="${r.raw}" data-i="${i}">▶ 無線で再生</button></td></tr>`).join("\n")}
</table>
<p class="t">クレジット表記: ${rows.map(r => `VOICEVOX:${r.name}`).filter((v, i, a) => a.indexOf(v) === i).join(" / ")}</p>
<script>
const DATA=${JSON.stringify(rows.map(r => r.data))};
let ctx,cur=null;const dec=new Map();
async function buf(i){if(dec.has(i))return dec.get(i);const ab=await (await fetch(DATA[i])).arrayBuffer();const b=await ctx.decodeAudioData(ab);dec.set(i,b);return b;}
function noiseBuf(sec){const n=ctx.sampleRate*sec,b=ctx.createBuffer(1,n,ctx.sampleRate),d=b.getChannelData(0);let l=0;for(let i=0;i<n;i++){const w=Math.random()*2-1;l=.97*l+.03*w;d[i]=(w*.6+l*1.4)*.5;}return b;}
function squelch(t,dur,v){if(v<=0)return;const s=ctx.createBufferSource();s.buffer=noiseBuf(dur);const hp=ctx.createBiquadFilter();hp.type='highpass';hp.frequency.value=700;const sh=ctx.createWaveShaper();{const c=new Float32Array(256);for(let k=0;k<256;k++){const x=k/127.5-1;c[k]=Math.tanh(4*x)}sh.curve=c;}const g=ctx.createGain();g.gain.setValueAtTime(v*.9,t);g.gain.setValueAtTime(v*.9,t+dur*.45);g.gain.exponentialRampToValueAtTime(.0001,t+dur);s.connect(hp);hp.connect(sh);sh.connect(g);g.connect(ctx.destination);s.start(t);s.stop(t+dur+.02);} // hard-edged "zatt"
async function play(i,btn){ctx=ctx||new (window.AudioContext||window.webkitAudioContext)();await ctx.resume();if(cur){try{cur.stop()}catch(e){}cur=null;document.querySelectorAll('button.on').forEach(b=>{b.classList.remove('on');b.textContent='▶ 無線で再生'});}
  const b=await buf(i);const drive=+document.getElementById('drv').value,nz=+document.getElementById('nz').value,sq=+document.getElementById('sq').value,[f1,f2]=document.getElementById('bw').value.split(',').map(Number);
  const t0=ctx.currentTime+.05;const src=ctx.createBufferSource();src.buffer=b;
  const hp=ctx.createBiquadFilter();hp.type='highpass';hp.frequency.value=f1;hp.Q.value=.8;
  const pk=ctx.createBiquadFilter();pk.type='peaking';pk.frequency.value=1800;pk.Q.value=1;pk.gain.value=6;
  const sh=ctx.createWaveShaper();{const c=new Float32Array(1024);for(let k=0;k<1024;k++){const x=k/511.5-1;c[k]=Math.tanh(drive*x)/Math.tanh(drive);}sh.curve=c;sh.oversample='2x';}
  const lp=ctx.createBiquadFilter();lp.type='lowpass';lp.frequency.value=f2;lp.Q.value=.9;
  const comp=ctx.createDynamicsCompressor();comp.threshold.value=-24;comp.ratio.value=6;comp.attack.value=.004;comp.release.value=.12;
  const g=ctx.createGain();g.gain.value=1.4;
  src.connect(hp);hp.connect(pk);pk.connect(sh);sh.connect(lp);lp.connect(comp);comp.connect(g);g.connect(ctx.destination);
  // noise floor under the voice
  const n=ctx.createBufferSource();n.buffer=noiseBuf(b.duration+.4);n.loop=false;const nb=ctx.createBiquadFilter();nb.type='bandpass';nb.frequency.value=1500;nb.Q.value=.6;const ng=ctx.createGain();ng.gain.value=nz;n.connect(nb);nb.connect(ng);ng.connect(ctx.destination);
  squelch(t0-.04,.16,sq);src.start(t0+.16);n.start(t0);n.stop(t0+b.duration+.4);squelch(t0+b.duration+.2,.12,sq*.9);
  cur=src;btn.classList.add('on');btn.textContent='■ 再生中';src.onended=()=>{if(cur===src){cur=null;btn.classList.remove('on');btn.textContent='▶ 無線で再生';}};}
document.querySelectorAll('button[data-i]').forEach(b=>b.addEventListener('click',()=>{if(b.classList.contains('on')){try{cur.stop()}catch(e){}return;}play(+b.dataset.i,b);}));
</script>`;
  fs.writeFileSync(path.join(OUT, "index.html"), html);
  console.log(`\n→ ${path.join(OUT, "index.html")} をブラウザで開いてください（${rows.length} 話者）。「無線で再生」はブラウザ内で加工するので ffmpeg は不要です`);
}
main().catch(e => { console.error(e); process.exit(1); });
