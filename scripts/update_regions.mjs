#!/usr/bin/env node
// GEO-SCOPE regions.json updater — 都道府県ごとの地域経済ニュース（日経地方経済面のような粒度）と、米国の州ごとの経済ニュース。
// SOURCE=feeds（既定・安い）: 公式RSS＋GDELTで無料収集 → Claude は検索なしで選別・要約・翻訳のみ。出典URLはスクリプトが付ける。
// SOURCE=search（旧方式）: Claude の web_search で収集。どちらも site/regions.json に書き出します（最大 7 日分保持）。
// Requires: Node 20+, env ANTHROPIC_API_KEY. Optional: MODEL, SITE_DIR, REGIONS=japan,usa, DRY_RUN=1
// INIT=1: ニュースの無い地域を全部埋める初期化モード（各地域 1 件、直近 1 週間の経済トピック。25 地域ずつ API を呼ぶ）
import fs from "node:fs"; import path from "node:path";
import { collect, gdelt, makeTagger, pickCandidates, candidateBlock, seenStore, sourceName, costLine } from "./feeds_lib.mjs";
const API_KEY = process.env.ANTHROPIC_API_KEY; if (!API_KEY) { console.error("ANTHROPIC_API_KEY is not set"); process.exit(1); }
const MODEL = process.env.MODEL || "claude-sonnet-5-5";
const SITE_DIR = process.env.SITE_DIR || path.resolve("site"), OUT = path.join(SITE_DIR, "regions.json");
const REGIONS = (process.env.REGIONS || "japan,usa").split(","); const INIT = !!process.env.INIT;
const SOURCE = (process.env.SOURCE || "feeds").toLowerCase(); const HOURS = Number(process.env.REGION_HOURS || 48);
const toJST = ms => new Date(ms + 9 * 3600e3).toISOString().slice(5, 16).replace("T", " ");
const KEEP_DAYS = 7, MAX_PER_AREA = 3, MAX_TOTAL = 60;
const GEO = JSON.parse(fs.readFileSync(path.resolve("scripts/region_geo.json"), "utf8"));
const jstDate = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
let current = { japan: [], usa: [] }; try { const c = JSON.parse(fs.readFileSync(OUT, "utf8")); if (!c.note) current = { japan: c.japan || [], usa: c.usa || [] }; } catch {} // サンプル（note付き）は捨てる

const system = `あなたは世界情勢レーダーサイト「GEO-SCOPE」の地域経済デスクです。日本語で、政治的に中立に、出典を明示して書きます。出力はJSONのみ（コードフェンス・前置き・後書き禁止）。`;
const PROMPT = {
  japan: (areas, heads) => `今日は ${jstDate()}（JST）です。web_search を使って、直近48時間の日本の「都道府県単位の経済・産業ニュース」（日本経済新聞の地域経済面、地方紙の経済面、各県の報道発表で扱われるような粒度）を集め、新しい項目だけを返してください。
対象（area はこの表記のまま使う）: ${areas.join("、")}
既に掲載済みの見出し（重複させない）: ${JSON.stringify(heads)}
収集方針:
- 企業の工場・拠点の新設や撤退、雇用、観光・インバウンド、農林水産・物価、地銀・自治体予算、再エネ・半導体・データセンター、新路線・再開発、地場企業の決算など
- 1都道府県あたり最大2件、合計20〜30件。首都圏に偏らせず、できるだけ多くの地域を取り上げる。ニュースのない地域は省略してよい
- 見出し h は全角30字以内、本文 b は全角80〜110字で自分の言葉で要約（コピーしない）。数字・日付を含める
- lv は原則 "info"（大規模な撤退・倒産・雇用喪失は "warn"）
- t は "YYYY-MM-DD / カテゴリ"（産業/雇用/観光/農水/金融/行政/インフラ/小売 など2〜4字）
- ts は出来事または報道の日時をISO8601（JST）で。不明なら省略
- src は実際に参照したURLとメディア名を1〜2件（日経・地方紙・公式発表を優先）
- h_en に英訳見出し（12語以内）、b_en に英訳本文（40語前後）
出力形式（厳守）: {"items":[{"area":"北海道","t":"2026-11-05 / 産業","lv":"info","h":"見出し","h_en":"English headline","b":"本文","b_en":"English body","ts":"2026-11-05T09:00:00+09:00","src":[{"name":"日本経済新聞","url":"https://..."}]}]}`,
  usa: (areas, heads) => `今日は ${jstDate()}（JST）です。web_search を使って、直近48時間の米国の「州単位の経済・ビジネスニュース」（州の雇用統計、工場・データセンター投資、州法・州予算の経済影響、地域銀行、農業・エネルギー、不動産、地元大手企業の動き）を集め、新しい項目だけを返してください。
対象（area は英語の州名をこの表記のまま使う）: ${areas.join(", ")}
既に掲載済みの見出し（重複させない）: ${JSON.stringify(heads)}
収集方針:
- 1州あたり最大2件、合計20〜30件。カリフォルニア・ニューヨーク・テキサスに偏らせず、中西部・南部も含める。ニュースのない州は省略してよい
- 見出し h（日本語・全角30字以内）、本文 b（日本語・全角80〜110字、自分の言葉で要約、数字を含める）。h_en（12語以内）、b_en（40語前後）も付ける
- lv は原則 "info"（大規模レイオフ・破綻・災害級の経済被害は "warn"）
- t は "YYYY-MM-DD / カテゴリ"（産業/雇用/金融/エネルギー/農業/不動産/行政/小売 など2〜4字）、ts はISO8601（現地時刻でオフセット付き）、不明なら省略
- src は実際に参照したURLとメディア名を1〜2件（Reuters/AP/Bloomberg/WSJ/地元紙/州政府発表を優先）
出力形式（厳守）: {"items":[{"area":"Texas","t":"2026-11-05 / 産業","lv":"info","h":"見出し","h_en":"English headline","b":"本文","b_en":"English body","ts":"2026-11-05T09:00:00-06:00","src":[{"name":"Reuters","url":"https://..."}]}]}`,
};
async function ask(user, search = SOURCE === "search") {
  const body = { model: MODEL, max_tokens: 10000, system, messages: [{ role: "user", content: user }] };
  if (search) body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 25 }];
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": API_KEY, "anthropic-version": "2023-06-01" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`API ${r.status}: ${await r.text()}`);
  const data = await r.json(); console.log(costLine(data.usage, "regions ")); const text = data.content.filter(c => c.type === "text").map(c => c.text).join("\n");
  const s = text.indexOf("{"), e = text.lastIndexOf("}"); if (s < 0 || e < 0) throw new Error("no JSON in response"); return JSON.parse(text.slice(s, e + 1));
}
const clean = (s, m) => String(s || "").replace(/\s+/g, " ").trim().slice(0, m);
// ---------- feeds mode ----------
const RA = JSON.parse(fs.readFileSync(path.resolve("scripts/region_aliases.json"), "utf8"));
const FEEDS = JSON.parse(fs.readFileSync(path.resolve("scripts/feeds.json"), "utf8"));
const seen = seenStore(path.resolve(process.env.CACHE_DIR || ".cache", "region_seen.json"));
const FEED_PROMPT = {
  japan: (areas, heads, block, init) => `今日は ${jstDate()}（JST）です。下の「候補記事」は公式RSSとGDELTから集めた日本の記事の見出しと短い説明です（web 検索は使えません。この材料だけで書いてください）。
${init ? `次の都道府県について、候補の中からその地域の経済・産業の話題を1件ずつ選んでください。候補が無い地域は省略してかまいません。` : `日本の「都道府県単位の経済・産業ニュース」（工場・拠点の新設や撤退、雇用、観光・インバウンド、農林水産、地銀・自治体予算、再エネ・半導体・データセンター、新路線・再開発、地場企業の決算など）を選んでください。国政・全国一律の話題、事件事故、芸能・スポーツは除きます。`}
- area はこの表記のまま: ${areas.join("、")}（「推定地域」は機械判定。記事の主な舞台がどこかで決める）
- 1都道府県あたり最大2件、合計最大25件。首都圏に偏らせない。既に掲載済みの見出しと同じ出来事は除く: ${JSON.stringify(heads)}
- 見出し h は全角30字以内、本文 b は全角70〜110字で自分の言葉で要約（コピーしない）。候補に書かれていない事実・数字を足さない
- lv は原則 "info"（大規模な撤退・倒産・雇用喪失は "warn"）。t は "YYYY-MM-DD / カテゴリ"（産業/雇用/観光/農水/金融/行政/インフラ/小売 など2〜4字）
- h_en（12語以内）、b_en（40語前後）を付ける
- c: 根拠にした候補記事の番号（1〜2個）。URL・媒体名はスクリプトが付けるので書かない
候補記事（[番号] (媒体, 日時JST | 推定地域) 見出し — 説明）:
${block}
出力形式（厳守）: {"items":[{"area":"北海道","t":"2026-11-05 / 産業","lv":"info","h":"見出し","h_en":"English headline","b":"本文","b_en":"English body","c":[4]}]}`,
  usa: (areas, heads, block, init) => `今日は ${jstDate()}（JST）です。下の「候補記事」は公式RSSとGDELTから集めた米国の記事の見出しと短い説明です（web 検索は使えません。この材料だけで書いてください）。
${init ? `次の州について、候補の中からその州の経済・ビジネスの話題を1件ずつ選んでください。候補が無い州は省略してかまいません。` : `米国の「州単位の経済・ビジネスニュース」（州の雇用・レイオフ、工場・データセンター投資、州法・州予算の経済影響、地域銀行、農業・エネルギー、不動産、地元企業の動き）を選んでください。連邦政治そのもの、事件事故、スポーツは除きます。`}
- area は英語の州名をこの表記のまま: ${areas.join(", ")}（「推定地域」は機械判定。記事の主な舞台で決める）
- 1州あたり最大2件、合計最大25件。既に掲載済みの見出しと同じ出来事は除く: ${JSON.stringify(heads)}
- 見出し h（日本語・全角30字以内）、本文 b（日本語・全角70〜110字、自分の言葉で要約）。候補に書かれていない事実・数字を足さない。h_en（12語以内）、b_en（40語前後）
- lv は原則 "info"（大規模レイオフ・破綻は "warn"）。t は "YYYY-MM-DD / カテゴリ"（産業/雇用/金融/エネルギー/農業/不動産/行政/小売 など）
- c: 根拠にした候補記事の番号（1〜2個）。URL・媒体名はスクリプトが付けるので書かない
候補記事（[番号] (媒体, 日時JST | 推定地域) 見出し — 説明）:
${block}
出力形式（厳守）: {"items":[{"area":"Texas","t":"2026-11-05 / 産業","lv":"info","h":"見出し","h_en":"English headline","b":"本文","b_en":"English body","c":[7]}]}`,
};
async function feedItems(r, areas, heads, list) {
  const tagger = makeTagger(RA[r] || {}, { notAfter: { "京都": ["東"] } });
  let cands, init = false;
  if (INIT) { // one GDELT query per empty area (last 7 days)
    init = true; const empty = areas.filter(a => !list.some(i => i.area === a)); const items = [];
    for (const a of empty) {
      const en = r === "japan" ? GEO.japan[a][2] : a;
      const q = r === "japan" ? `"${en}" sourcecountry:japan (economy OR company OR tourism OR factory OR business)` : `"${en}" sourcelang:english sourcecountry:unitedstates (economy OR jobs OR business OR investment)`;
      try { for (const g of (await gdelt(q, { timespan: "7d", max: 6 })).slice(0, 4)) items.push({ ...g, source: sourceName(g.link, g.domain), tags: [a], ms: Date.parse(g.date) || null }); }
      catch (e) { console.error(`GDELT ${a}: ${e.message}`); }
    }
    cands = items.map((it, i) => ({ ...it, desc: "", id: i + 1 }));
  } else {
    const items = await collect({ sources: FEEDS[r] || [], gdeltQueries: FEEDS[r + "_gdelt"] || [], sinceMs: Date.now() - HOURS * 3600e3 });
    cands = pickCandidates(items.filter(it => !seen.has(it.link)), { tagger, max: Number(process.env.MAX_CANDIDATES || 120), perKey: 4, requireTag: true });
  }
  console.log(`${r}: ${cands.length} candidates`);
  if (cands.length < (init ? 1 : 3)) return [];
  const out = (await ask(FEED_PROMPT[r](init ? areas.filter(a => !list.some(i => i.area === a)) : areas, heads, candidateBlock(cands, toJST), init), false)).items || [];
  const byId = new Map(cands.map(c => [c.id, c]));
  for (const c of cands) seen.add(c.link);
  return out.map(it => { const used = (Array.isArray(it.c) ? it.c : []).map(Number).map(id => byId.get(id)).filter(Boolean); if (!used.length) return null;
    const ms = used.map(c => c.ms).filter(Boolean).sort((a, b) => a - b)[0];
    return { ...it, src: [...new Map(used.map(c => [c.source, c])).values()].slice(0, 2).map(c => ({ name: c.source, url: c.link })), ...(ms && !it.ts ? { ts: new Date(ms).toISOString() } : {}) }; }).filter(Boolean);
}
function validate(i, areas) {
  if (!i || !areas.includes(i.area)) return null; const t = clean(i.t, 40); if (!/^\d{4}-\d{2}-\d{2}/.test(t)) return null;
  const h = clean(i.h, 60), b = clean(i.b, 300); if (!h || !b) return null;
  const src = Array.isArray(i.src) ? i.src.filter(s => s && s.name).slice(0, 2).map(s => ({ name: clean(s.name, 40), ...(s.url && /^https?:\/\//.test(s.url) ? { url: String(s.url).slice(0, 400) } : {}) })) : [];
  let ts = i.ts && !isNaN(Date.parse(i.ts)) ? new Date(i.ts).toISOString().replace(/\.\d{3}Z$/, "Z") : new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const h_en = clean(i.h_en, 120), b_en = clean(i.b_en, 400);
  return { area: i.area, t, lv: i.lv === "warn" ? "warn" : "info", h, ...(h_en ? { h_en } : {}), b, ...(b_en ? { b_en } : {}), ts, src };
}
const sim = (a, b) => { const A = new Set(a), B = new Set(b); let n = 0; for (const c of A) if (B.has(c)) n++; return n / Math.max(A.size, B.size); };
(async () => {
  const keep = new Date(Date.now() - KEEP_DAYS * 86400e3); let added = 0;
  for (const r of REGIONS) {
    if (!GEO[r]) continue; const allAreas = Object.keys(GEO[r]); const list = current[r] || [];
    const heads = list.filter(i => Date.now() - Date.parse(i.ts || 0) < 2 * 86400e3).map(i => i.h);
    let fresh = [];
    if (SOURCE !== "search") { try { fresh = await feedItems(r, allAreas, heads, list); } catch (e) { console.error(`${r} (feeds): ${e.message}`); } }
    else if (INIT) { // fill every area that has nothing yet, 25 areas per call
      const empty = allAreas.filter(a => !list.some(i => i.area === a));
      for (let i = 0; i < empty.length; i += 25) { const chunk = empty.slice(i, i + 25);
        const user = PROMPT[r](chunk, heads).replace(/直近48時間/g, "直近1週間").replace(/新しい項目だけを返してください。/, "各地域について必ず1件ずつ（計 " + chunk.length + " 件）返してください。大きなニュースが無い地域は、その地域の経済の現状を示す直近の話題（主要産業の動き、観光客数、有効求人倍率、自治体の施策など）で構いません。") .replace(/合計20〜30件/g, "合計 " + chunk.length + " 件");
        try { fresh.push(...((await ask(user)).items || [])); } catch (e) { console.error(`${r} init: ${e.message}`); } }
    } else try { fresh = (await ask(PROMPT[r](allAreas, heads))).items || []; } catch (e) { console.error(`${r}: ${e.message}`); }
    const areas = allAreas;
    for (const raw of fresh) { const it = validate(raw, areas); if (!it) continue; if (list.some(x => x.h === it.h || sim(x.h, it.h) > 0.6)) continue; list.unshift(it); added++; console.log(`+ [${r}/${it.area}] ${it.h}`); }
    // prune: 7 days, per-area cap, total cap (newest first)
    const perArea = {}; current[r] = list.filter(i => new Date(i.t.slice(0, 10)) >= keep).sort((a, b) => b.t.localeCompare(a.t)).filter(i => (perArea[i.area] = (perArea[i.area] || 0) + 1) <= MAX_PER_AREA).slice(0, MAX_TOTAL);
  }
  const out = { updated: new Date().toISOString(), japan: current.japan, usa: current.usa };
  if (process.env.DRY_RUN) { console.log(JSON.stringify(out, null, 1)); return; }
  if (SOURCE !== "search") seen.save();
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
  console.log(`regions.json: japan ${out.japan.length} / usa ${out.usa.length} (new ${added})`);
})();
