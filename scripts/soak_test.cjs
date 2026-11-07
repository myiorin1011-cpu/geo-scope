// GEO-SCOPE soak test (optional dev tool). Usage: npm i playwright && npx playwright install chromium && node scripts/soak_test.cjs 60 soak.csv
// Runs the built site (site/) in headless Chromium with #live,alerttest for N minutes and logs heap / DOM / timers / audio nodes once a minute.
// GEO-SCOPE soak test: run #live for N minutes, sample heap/DOM/timers/audio nodes every minute.
const {chromium}=require('playwright') /* npm i playwright && npx playwright install chromium */;const fs=require('fs');const {spawn}=require('child_process');
const MIN=Number(process.argv[2]||45), OUT=process.argv[3]||'soak.csv';
(async()=>{
const srv=spawn(process.execPath,['scripts/serve_local.mjs'],{env:{...process.env,PORT:'8099'},stdio:'ignore'});await new Promise(r=>setTimeout(r,1500));
const b=await chromium.launch({args:['--autoplay-policy=no-user-gesture-required']});
const ctx=await b.newContext({viewport:{width:1920,height:1080}});
await ctx.addInitScript(()=>{
  // live counters for timers / rAF / audio nodes
  window.__t={to:0,iv:0,raf:0,liveTO:new Set(),liveIV:new Set(),audio:0,osc:0};
  const _st=setTimeout,_si=setInterval,_ct=clearTimeout,_ci=clearInterval,_raf=requestAnimationFrame;
  window.setTimeout=(f,ms,...a)=>{__t.to++;const id=_st(function(){__t.liveTO.delete(id);return typeof f==='function'?f.apply(this,a):eval(f)},ms);__t.liveTO.add(id);return id};
  window.clearTimeout=id=>{__t.liveTO.delete(id);return _ct(id)};
  window.setInterval=(f,ms,...a)=>{__t.iv++;const id=_si(f,ms,...a);__t.liveIV.add(id);return id};
  window.clearInterval=id=>{__t.liveIV.delete(id);return _ci(id)};
  window.requestAnimationFrame=f=>{__t.raf++;return _raf(f)};
  const AC=window.AudioContext||window.webkitAudioContext;if(AC){for(const m of ['createOscillator','createGain','createBufferSource','createBiquadFilter','createWaveShaper','createConvolver','createDelay','createStereoPanner','createDynamicsCompressor']){const o=AC.prototype[m];if(o)AC.prototype[m]=function(...a){__t.audio++;if(m==='createOscillator')__t.osc++;return o.apply(this,a)}}}
});
const pg=await ctx.newPage();const errs=[];pg.on('pageerror',e=>errs.push(e.message));pg.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errs.push('console: '+m.text().slice(0,160))});
await pg.route(/^https?:\/\/(?!localhost|fonts\.)/,r=>r.abort());
const cdp=await ctx.newCDPSession(pg);await cdp.send('Performance.enable');
await pg.goto('http://localhost:8099/#live,alerttest',{waitUntil:'load'});await pg.waitForTimeout(2000);
// turn everything on, like a stream would
await pg.evaluate(()=>{for(const id of ['sndBtn','bgmBtn','voxBtn']){const b=document.getElementById(id);if(b&&b.getAttribute('aria-pressed')!=='true')b.click();}});
fs.writeFileSync(OUT,'min,heapMB,nodes,listeners,domAll,svgKids,callouts,timersLive,intervalsLive,toCreated,rafCreated,audioNodes,osc,errors,current,mode\n');
const t0=Date.now();let regionDone=0;
for(let m=0;m<=MIN;m++){
  const met=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x=>[x.name,x.value]));
  const s=await pg.evaluate(()=>({domAll:document.querySelectorAll('*').length,svgKids:document.querySelectorAll('svg *').length,callouts:document.querySelectorAll('#callout, .callout, #alertFull, .alertfull').length,timersLive:__t.liveTO.size,intervalsLive:__t.liveIV.size,to:__t.to,raf:__t.raf,audio:__t.audio,osc:__t.osc,cur:typeof current!=='undefined'?current:'',mode:document.getElementById('modeLabel')?.textContent||''}));
  const row=[m,(met.JSHeapUsedSize/1048576).toFixed(1),met.Nodes,met.JSEventListeners,s.domAll,s.svgKids,s.callouts,s.timersLive,s.intervalsLive,s.to,s.raf,s.audio,s.osc,errs.length,s.cur,s.mode].join(',');
  fs.appendFileSync(OUT,row+'\n');console.log(row);
  if(m>0&&m%12===0){await pg.evaluate(r=>GEOSCOPE.region(r),regionDone++%2?'usa':'japan');} // exercise the region segment every 12 min
  if(m===MIN)break;
  await pg.waitForTimeout(60000-((Date.now()-t0)%60000));
}
fs.writeFileSync(OUT.replace('.csv','_errors.txt'),errs.join('\n'));
await pg.screenshot({path:OUT.replace('.csv','_end.png')});
await b.close();srv.kill();
})();
