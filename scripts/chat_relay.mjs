#!/usr/bin/env node
// GEO-SCOPE YouTube Live Chat relay
// ローカルPC（OBSと同じマシン）で実行。YouTubeのライブチャットから "!国名" を拾い、
//   1) <SITE_DIR>/commands.json に書き出す（ページが3秒おきに読む）
//   2) （任意）WebSocket :8787 で配信（ページを index.html?cmd=ws://localhost:8787 で開く）
// 使い方: YT_API_KEY=xxxx VIDEO_ID=yyyy node scripts/chat_relay.mjs
//   YT_API_KEY: Google Cloud Console で YouTube Data API v3 を有効化して発行
//   VIDEO_ID  : 配信のURL watch?v=XXXX の部分
import fs from "node:fs";
import path from "node:path";

const KEY = process.env.YT_API_KEY, VIDEO = process.env.VIDEO_ID;
const SITE_DIR = process.env.SITE_DIR || path.resolve("site");
const OUT = path.join(SITE_DIR, "commands.json");
const CHAT_OUT = path.join(SITE_DIR, "chat.json"); // 直近のコメント（コマンド以外も）— LIVE 画面の左下に流す
const CHAT_KEEP = Number(process.env.CHAT_KEEP || 12);
const WS_PORT = Number(process.env.WS_PORT || 8787);
if (!KEY || !VIDEO) { console.error("YT_API_KEY と VIDEO_ID を環境変数で指定してください"); process.exit(1); }

const api = (p, q) => fetch(`https://www.googleapis.com/youtube/v3/${p}?${new URLSearchParams({ key: KEY, ...q })}`).then(r => r.json());

let wss = null;
try { const { WebSocketServer } = await import("ws"); wss = new WebSocketServer({ port: WS_PORT }); console.log(`ws://localhost:${WS_PORT}`); }
catch { console.log("ws パッケージ未導入のため WebSocket は無効（npm i ws で有効化）。commands.json 経由で動きます"); }

const v = await api("videos", { part: "liveStreamingDetails", id: VIDEO });
const chatId = v.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
if (!chatId) { console.error("activeLiveChatId が取れません（配信中か、VIDEO_ID を確認）", JSON.stringify(v).slice(0, 300)); process.exit(1); }

let pageToken, cmds = [], chat = [];
const CMD_RE = /^[!！]\s*\S+/;
async function loop() {
  try {
    const r = await api("liveChat/messages", { part: "snippet,authorDetails", liveChatId: chatId, maxResults: 200, ...(pageToken ? { pageToken } : {}) });
    pageToken = r.nextPageToken;
    for (const m of r.items || []) {
      const text = (m.snippet?.displayMessage || "").replace(/https?:\/\/\S+/g, "").trim(); // URLs are never shown on the stream
      if (text) { chat.push({ id: m.id, user: (m.authorDetails?.displayName || "viewer").slice(0, 24), text: text.slice(0, 80), ts: m.snippet?.publishedAt, mod: !!(m.authorDetails?.isChatModerator || m.authorDetails?.isChatOwner) }); chat = chat.slice(-CHAT_KEEP); }
      if (!CMD_RE.test(text)) continue;
      const c = { id: m.id, user: m.authorDetails?.displayName || "viewer", text: text.slice(0, 40), ts: m.snippet?.publishedAt };
      cmds.push(c); cmds = cmds.slice(-50);
      console.log(`[cmd] ${c.user}: ${c.text}`);
      wss?.clients.forEach(ws => ws.readyState === 1 && ws.send(JSON.stringify(c)));
    }
    fs.writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString(), commands: cmds }));
    fs.writeFileSync(CHAT_OUT, JSON.stringify({ updated: new Date().toISOString(), messages: chat }));
    setTimeout(loop, Math.max(3000, r.pollingIntervalMillis || 5000));
  } catch (e) { console.error("poll error", e.message); setTimeout(loop, 10000); }
}
loop();
