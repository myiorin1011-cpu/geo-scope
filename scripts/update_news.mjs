#!/usr/bin/env node
// GEO-SCOPE news.json updater — runs on GitHub Actions (or locally).
// Requires: Node 20+, env ANTHROPIC_API_KEY. Optional: MODEL, SITE_DIR, DRY_RUN=1, SOURCE, INIT, HOURS, MAX_CANDIDATES
//
// SOURCE=feeds (default, cheap): articles are collected for free from official RSS feeds + GDELT (scripts/feeds.json).
//   Claude gets only titles/short descriptions as material — NO web search tool — and selects, summarizes, translates
//   and assigns countries. The script attaches the real article URLs as sources (Claude never writes URLs).
//   Articles already sent in earlier runs are remembered (site/.cache/feed_seen.json) so they are not paid for twice.
// SOURCE=search (previous behaviour, ~10x the cost): Claude's web_search tool does the collecting.
// INIT=1: fill countries that have no dated item yet (1 item each). feeds mode uses a GDELT query per country (last 7 days).
import fs from "node:fs";
import path from "node:path";
import { collect, gdelt, makeTagger, pickCandidates, candidateBlock, seenStore, sourceName, costLine } from "./feeds_lib.mjs";

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) { console.error("ANTHROPIC_API_KEY is not set"); process.exit(1); }
const MODEL = process.env.MODEL || "claude-sonnet-5-5";
const SOURCE = (process.env.SOURCE || "feeds").toLowerCase();
const SITE_DIR = process.env.SITE_DIR || path.resolve("site");
const NEWS_PATH = path.join(SITE_DIR, "news.json");
const KEEP_DAYS = 7, MAX_PER_COUNTRY = 6;
const INIT = !!process.env.INIT;
const HOURS = Number(process.env.HOURS || 8);                 // feeds: look back this many hours (runs every 4h → 8h overlap is safe; seen-memory removes repeats)
const MAX_CANDIDATES = Number(process.env.MAX_CANDIDATES || 160);

const JST = () => new Date(Date.now() + 9 * 3600e3);
const jstISO = () => JST().toISOString().replace("Z", "+09:00");
const jstDate = (d = JST()) => d.toISOString().slice(0, 10);
const toJST = ms => new Date(ms + 9 * 3600e3).toISOString().slice(5, 16).replace("T", " ");

const current = JSON.parse(fs.readFileSync(NEWS_PATH, "utf8"));
const keys = Object.keys(current.items);
const datedOf = i => !isNaN(Date.parse((i.t || "").slice(0, 10)));
const initTargets = INIT ? keys.filter(k => !(current.items[k] || []).some(datedOf)).slice(0, Number(process.env.INIT_BATCH || 40)) : null;

const cutoff = new Date(Date.now() - 2 * 86400e3);
const recentHeads = Object.fromEntries(keys.map(k => [k, (current.items[k] || [])
  .filter(i => new Date((i.t || "").slice(0, 10)) >= cutoff).map(i => i.h)]).filter(([, v]) => v.length));

const system = `あなたは世界情勢レーダーサイト「GEO-SCOPE」のニュースデスクです。日本語で、政治的に中立に、出典を明示して書きます。出力はJSONのみ（コードフェンス不要、前後の文章不要）。`;

// rules shared by both modes
const RULES = `- 見出し h は全角30字以内、本文 b は全角70〜110字で自分の言葉で要約（記事の文章をコピーしない）。日付・数字を含める。死者数などは「少なくとも」「報道ベース」を付ける
- lv: 紛争・死者・退避・攻撃・政権崩壊級 = "alert"、緊張・警告・制裁・大規模抗議・重大事故 = "warn"、それ以外 = "info"
- t は "YYYY-MM-DD / カテゴリ"（日付は出来事の発生日JST、カテゴリは 外交/安全保障/選挙/事故/災害/経済/社会 など2〜4字）
- h_en に見出しの英訳（12語以内）、b_en に本文の英訳（自然な英語、40語前後）
- alert_type: 緊急事態宣言・非常事態宣言・戒厳令 = "emerg"、核兵器・ミサイル発射・感染症の拡大 = "nuke"、サイバー攻撃・情報漏洩 = "cyber"、地震・津波 = "quake"、それ以外の重大速報（lv が alert のもの）= "break"、該当なし = 省略
- rel: その出来事に直接関わる他国を対象国キーの英語名で最大3つ（なければ省略）。自国は含めない`;

// ---------------- search mode (previous behaviour) ----------------
const searchPrompt = () => INIT ? `今日は ${jstDate()}（JST）です。次の各国について、web_search で直近1週間の主要な出来事を1件ずつ調べ、国ごとに必ず1項目（計 ${initTargets.length} 項目）返してください。見出し・本文・出典は通常の規則どおり。t は出来事の日付（直近1週間に目立った出来事がなければ、現在進行中の最重要テーマを「今日の日付 / 概況」として要約）。
${RULES}
- src は実際に参照したURLとメディア名を1〜3件
対象国キー（この英語名キー以外は使わない）:
${initTargets.join(", ")}
出力形式: {"items":{"<国キー>":[{"t":"...","lv":"info","h":"...","h_en":"...","b":"...","b_en":"...","ts":"...","src":[{"name":"...","url":"https://..."}]}]}}` : `今日は ${jstDate()}（JST）です。web_search を使って直近24時間の国際ニュースを収集し、次の国について新しい項目だけを返してください。

対象国キー（この英語名キー以外は使わない）:
${keys.join(", ")}

既に掲載済みの見出し（重複させない）:
${JSON.stringify(recentHeads)}

収集方針:
- 優先: 紛争・安全保障、外交・首脳会談、選挙・政変、大規模事故・災害、重大な経済・通商、日本に関わる出来事
- 情報源は通信社・公共放送・主要紙を優先。2つ以上の情報源で裏が取れたものだけ採用し、SNS発の未確認情報は載せない
- 1か国あたり最大3件、合計で最大40件。ニュースのない国は省略してよい
${RULES}
- ts に出来事または第一報の日時をISO8601（JST）で。不明なら省略
- src は実際に参照したURLとメディア名を1〜3件

出力形式（厳守）:
{"items":{"<国キー>":[{"t":"2026-11-04 / 外交","lv":"info","h":"見出し","h_en":"English headline","b":"本文","b_en":"English body","ts":"2026-11-04T14:30:00+09:00","alert_type":"emerg","rel":["Russia","Ukraine"],"src":[{"name":"Reuters","url":"https://..."}]}]}}`;

// ---------------- feeds mode ----------------
function countryTagger(extra) {
  let ja = {}; try { ja = JSON.parse(fs.readFileSync(path.resolve("scripts/country_ja.json"), "utf8")); } catch {}
  let data = {}; try { data = JSON.parse(fs.readFileSync(path.resolve("scripts/data_all.json"), "utf8")); } catch {}
  const map = {}; for (const k of keys) map[k] = [k, ja[k], data[k]?.ja, ...(extra[k] || [])].filter(Boolean);
  return makeTagger(map);
}
const feedsPrompt = (block, n) => INIT ? `今日は ${jstDate()}（JST）です。下の「候補記事」は国ごとに集めた直近1週間の記事の見出しと短い説明です（web 検索は使えません。この材料だけで書いてください）。
次の各国について、候補の中から最も重要な出来事を1件選び、国ごとに1項目を返してください。候補が無い・材料が乏しすぎる国は省略してかまいません。
${RULES}
- c: その項目の根拠にした候補記事の番号（1〜3個）。出典URLはスクリプトが番号から付けるので、URLやメディア名は書かない
- 候補の見出し・説明に書かれていない事実や数字を足さない
対象国キー: ${initTargets.join(", ")}

候補記事（[番号] (媒体, 日時JST | 推定国) 見出し — 説明）:
${block}

出力形式（厳守）: {"items":{"<国キー>":[{"t":"2026-11-04 / 外交","lv":"info","h":"見出し","h_en":"English headline","b":"本文","b_en":"English body","c":[3,17]}]}}` : `今日は ${jstDate()}（JST）です。下の「候補記事」は公式RSSとGDELTから集めた直近${HOURS}時間ほどの国際ニュースの見出しと短い説明（${n}件）です。web 検索は使えません。この材料だけで、GEO-SCOPE に載せる新しい項目を選んで書いてください。

選び方:
- 優先: 紛争・安全保障、外交・首脳会談、選挙・政変、大規模事故・災害、重大な経済・通商、日本に関わる出来事。芸能・スポーツ・生活情報・論説は除く
- 同じ出来事を複数の候補が報じていれば1項目にまとめ、c に最大3つの番号を入れる（複数媒体が報じた出来事ほど優先）
- 「既に掲載済みの見出し」と同じ出来事は、大きな新展開がない限り載せない
- 1か国あたり最大3件、合計で最大35件。国キーは記事の主な舞台となる国（「推定国」は機械判定なので誤りがあれば直す）
- 候補の見出し・説明に書かれていない事実や数字を足さない。不確かな点は「〜と報じられている」とする
${RULES}
- c: 根拠にした候補記事の番号（1〜3個）。出典URL・媒体名・日時はスクリプトが番号から付けるので書かない

対象国キー（この英語名キー以外は使わない）:
${keys.join(", ")}

既に掲載済みの見出し（直近2日）:
${JSON.stringify(recentHeads)}

候補記事（[番号] (媒体, 日時JST | 推定国) 見出し — 説明）:
${block}

出力形式（厳守）:
{"items":{"<国キー>":[{"t":"2026-11-04 / 外交","lv":"info","h":"見出し","h_en":"English headline","b":"本文","b_en":"English body","alert_type":"break","rel":["Russia"],"c":[3,17]}]}}`;

async function feedCandidates() {
  const cfg = JSON.parse(fs.readFileSync(path.resolve("scripts/feeds.json"), "utf8"));
  const tagger = countryTagger(cfg.country_aliases || {});
  const seen = seenStore(path.resolve(process.env.CACHE_DIR || ".cache", "feed_seen.json"));
  if (INIT) { // one GDELT query per target country
    const items = [];
    for (const k of initTargets) {
      const name = (cfg.country_aliases?.[k] || []).find(a => /^[A-Z][a-z]/.test(a) && a.length > 3) || k.replace(/\./g, "");
      try { const got = await gdelt(`"${name}" sourcelang:english`, { timespan: "7d", max: 8 }); for (const g of got.slice(0, 5)) items.push({ ...g, source: sourceName(g.link, g.domain), lang: "en", tags: [k], ms: Date.parse(g.date) || null, weight: 1 }); }
      catch (e) { console.error(`GDELT ${k}: ${e.message}`); }
    }
    const cands = items.map((it, i) => ({ ...it, desc: "", id: i + 1 }));
    console.log(`INIT candidates: ${cands.length} for ${initTargets.length} countries`);
    return { cands, seen };
  }
  const items = await collect({ sources: cfg.world || [], gdeltQueries: cfg.world_gdelt || [], sinceMs: Date.now() - HOURS * 3600e3 });
  const fresh = items.filter(it => !seen.has(it.link));
  const cands = pickCandidates(fresh, { tagger, max: MAX_CANDIDATES, perKey: 6 });
  console.log(`candidates: ${cands.length} (collected ${items.length}, new ${fresh.length}, remembered ${seen.size()})`);
  return { cands, seen };
}

// ---------------- Claude ----------------
async function callClaude(user, { search }) {
  const body = { model: MODEL, max_tokens: INIT ? 16000 : 9000, system, messages: [{ role: "user", content: user }] };
  if (search) body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: INIT ? 60 : Number(process.env.MAX_SEARCHES || 25) }];
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`API ${r.status}: ${await r.text()}`);
  const data = await r.json();
  console.log(costLine(data.usage, "news "));
  return data.content.filter(c => c.type === "text").map(c => c.text).join("\n");
}
function extractJSON(text) {
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s < 0 || e < 0) throw new Error("no JSON in response");
  return JSON.parse(text.slice(s, e + 1));
}
function clean(str, max) { return String(str || "").replace(/\s+/g, " ").trim().slice(0, max); }

// feeds mode: turn candidate numbers into real sources + a timestamp
function attachSources(fresh, cands) {
  const byId = new Map(cands.map(c => [c.id, c]));
  for (const arr of Object.values(fresh.items || {})) if (Array.isArray(arr)) for (const it of arr) {
    const used = (Array.isArray(it.c) ? it.c : []).map(Number).map(id => byId.get(id)).filter(Boolean);
    if (!used.length) { it._drop = true; continue; } // no grounding → not published
    const bySrc = new Map(); for (const c of used) if (!bySrc.has(c.source)) bySrc.set(c.source, c);
    it.src = [...bySrc.values()].slice(0, 3).map(c => ({ name: clean(c.source, 40), url: c.link }));
    const ms = used.map(c => c.ms).filter(Boolean).sort((a, b) => a - b)[0];
    if (ms && !it.ts) it.ts = new Date(ms).toISOString();
    if (ms && !/^\d{4}-\d{2}-\d{2}/.test(it.t || "")) it.t = `${new Date(ms + 9 * 3600e3).toISOString().slice(0, 10)} / ${String(it.t || "ニュース").replace(/^.*\/\s*/, "")}`;
    it._used = used;
  }
}

function validateItem(i) {
  if (!i || typeof i !== "object" || i._drop) return null;
  const t = clean(i.t, 40); if (!/^\d{4}-\d{2}-\d{2}/.test(t)) return null;
  const lv = ["alert", "warn", "info"].includes(i.lv) ? i.lv : "info";
  const h = clean(i.h, 60); const b = clean(i.b, 300); if (!h || !b) return null;
  const src = Array.isArray(i.src) ? i.src.filter(s => s && s.name).slice(0, 3)
    .map(s => ({ name: clean(s.name, 40), ...(s.url && /^https?:\/\//.test(s.url) ? { url: String(s.url).slice(0, 400) } : {}) })) : [];
  const h_en = clean(i.h_en, 120), b_en = clean(i.b_en, 400);
  let ts = null; if (i.ts && !isNaN(Date.parse(i.ts))) ts = new Date(i.ts).toISOString().replace(/\.\d{3}Z$/, "Z");
  if (!ts) ts = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const at = ["emerg", "nuke", "cyber", "quake", "break"].includes(i.alert_type) ? i.alert_type : null;
  const rel = Array.isArray(i.rel) ? i.rel.filter(r => typeof r === "string" && keys.includes(r)).slice(0, 3) : [];
  return { t, lv, h, ...(h_en ? { h_en } : {}), b, ...(b_en ? { b_en } : {}), ts, ...(at ? { alert_type: at } : {}), ...(rel.length ? { rel } : {}), src };
}

function merge(fresh) {
  let added = 0; const log = []; const usedLinks = [];
  for (const [k, arr] of Object.entries(fresh.items || {})) {
    if (!keys.includes(k) || !Array.isArray(arr)) continue;
    const list = current.items[k] || [];
    if (INIT) { const raw = arr.find(x => !x._drop); const it = validateItem(raw); if (it) { it.rel = (it.rel || []).filter(r => r !== k); current.items[k] = [it, ...list.filter(x => !datedOf(x))]; added++; log.push(`[${k}] ${it.h}`); (raw._used || []).forEach(c => usedLinks.push(c.link)); } continue; }
    const seen = new Set(list.map(i => i.h)); const seenUrl = new Set(list.flatMap(i => (i.src || []).map(s => s.url)).filter(Boolean));
    for (const raw of arr) {
      const it = validateItem(raw); if (!it || seen.has(it.h)) continue;
      if (list.some(x => sim(x.h, it.h) > 0.6)) continue;                       // near-duplicate headline
      if (it.src.length && it.src.every(s => s.url && seenUrl.has(s.url))) continue; // same articles as an existing item
      it.rel = (it.rel || []).filter(r => r !== k); if (!it.rel.length) delete it.rel;
      list.unshift(it); seen.add(it.h); added++; log.push(`[${k}] ${it.h}`);
      (raw._used || []).forEach(c => usedLinks.push(c.link));
    }
    current.items[k] = list;
  }
  const keep = new Date(Date.now() - KEEP_DAYS * 86400e3);
  for (const k of keys) {
    const fresh_ = (current.items[k] || []).filter(i => datedOf(i) && new Date((i.t || "").slice(0, 10)) >= keep)
      .sort((a, b) => (b.t || "").localeCompare(a.t || ""));
    const overview = (current.items[k] || []).filter(i => !datedOf(i));
    current.items[k] = [...fresh_, ...overview].slice(0, MAX_PER_COUNTRY);
  }
  return { added, log, usedLinks };
}
function sim(a, b) { const A = new Set(a), B = new Set(b); let n = 0; for (const c of A) if (B.has(c)) n++; return n / Math.max(A.size, B.size); }

(async () => {
  let fresh = { items: {} }; let seen = null; let cands = [];
  try {
    if (SOURCE === "search") fresh = extractJSON(await callClaude(searchPrompt(), { search: true }));
    else {
      ({ cands, seen } = await feedCandidates());
      if (cands.length < (INIT ? 1 : 5)) throw new Error(`too few candidates (${cands.length}) — feeds unreachable? (SOURCE=search で旧方式に切り替え可)`);
      fresh = extractJSON(await callClaude(feedsPrompt(candidateBlock(cands, toJST), cands.length), { search: false }));
      attachSources(fresh, cands);
    }
  } catch (e) {
    console.error("fetch/parse failed, will only refresh timestamp:", e.message);
  }
  const before = JSON.parse(JSON.stringify(current.items));
  const { added, log } = merge(fresh);
  // every candidate that was shown to Claude counts as "seen" (picked or not) → it is not sent (= paid for) again
  if (seen && !process.env.DRY_RUN) { for (const c of cands) seen.add(c.link); seen.save(); }
  try {
    const clPath = path.join(SITE_DIR, "changelog.json");
    const cl = fs.existsSync(clPath) ? JSON.parse(fs.readFileSync(clPath, "utf8")) : { entries: [] };
    const ts = jstISO();
    for (const k of keys) {
      const was = new Set((before[k] || []).map(i => i.h)), now = new Set((current.items[k] || []).map(i => i.h));
      for (const h of now) if (!was.has(h)) cl.entries.push({ ts, type: "add", country: k, h });
      for (const h of was) if (!now.has(h)) cl.entries.push({ ts, type: "remove", country: k, h, note: "掲載期間終了" });
    }
    cl.entries = cl.entries.slice(-2000);
    if (!process.env.DRY_RUN) fs.writeFileSync(clPath, JSON.stringify(cl, null, 1) + "\n");
  } catch (e) { console.error("changelog failed:", e.message); }
  current.updated = jstISO();
  current.note = `GEO-SCOPE news feed. items[country]=[{t,lv,h,b,src:[{name,url}]}] — generated by scripts/update_news.mjs (source: ${SOURCE === "search" ? "web search" : "RSS + GDELT"})`;
  if (process.env.DRY_RUN) { console.log(JSON.stringify(fresh, (k, v) => k === "_used" ? undefined : v, 1).slice(0, 3000)); }
  else fs.writeFileSync(NEWS_PATH, JSON.stringify(current, null, 1) + "\n");
  console.log(`added ${added} items`); log.slice(0, 25).forEach(l => console.log("  +", l));
})();
