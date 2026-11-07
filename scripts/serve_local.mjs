#!/usr/bin/env node
// ローカル確認用の簡易サーバー: node scripts/serve_local.mjs → http://localhost:8080/ で site/ を配信（追加パッケージ不要）
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const ROOT = path.resolve(process.env.SITE_DIR || "site"); const PORT = Number(process.env.PORT || 8080);
const TYPES = { ".html": "text/html; charset=utf-8", ".json": "application/json; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".ogg": "audio/ogg", ".wav": "audio/wav", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname); if (p.endsWith("/")) p += "index.html";
  const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end("not found"); }
  res.setHeader("content-type", TYPES[path.extname(f)] || "application/octet-stream"); res.setHeader("cache-control", "no-store"); fs.createReadStream(f).pipe(res);
}).listen(PORT, () => console.log(`GEO-SCOPE local: http://localhost:${PORT}/   (配信モード: http://localhost:${PORT}/#live)  Ctrl+C で終了`));
