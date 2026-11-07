#!/usr/bin/env node
// Wrap src/page.html (artifact-style body fragment) into a full HTML document with meta/OGP/favicon → site/index.html
import fs from "node:fs";
const body = fs.readFileSync("src/page.html", "utf8").replace(/^\s*<title>.*?<\/title>\s*/s, "").replace(/<meta name="claude:viewport-fit-sides"[^>]*>\s*/, "");
const SITE_URL = process.env.SITE_URL || "https://example.github.io/geo-scope/";
const fav = encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#050a0c"/><circle cx="32" cy="32" r="22" fill="none" stroke="#00e6b4" stroke-width="3"/><circle cx="32" cy="32" r="12" fill="none" stroke="#00e6b4" stroke-width="2" opacity=".6"/><path d="M32 32L52 20" stroke="#00e6b4" stroke-width="3"/><circle cx="32" cy="32" r="3" fill="#00e6b4"/><circle cx="44" cy="40" r="3" fill="#ff5a4e"/></svg>`);
const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>GEO-SCOPE レーダー — 世界情勢をコックピットから</title>
<meta name="description" content="世界100か国超の最新情勢・渡航レベル・地震速報をレーダー風の地図で俯瞰。出典つき、2時間ごと自動更新、24時間ライブ配信対応。">
<meta property="og:type" content="website">
<meta property="og:title" content="GEO-SCOPE レーダー">
<meta property="og:description" content="世界情勢をコックピットから。出典つきニュース・渡航レベル・地震速報を一枚の地図で。">
<meta property="og:url" content="${SITE_URL}">
<meta property="og:image" content="${SITE_URL}og.png">
<meta property="og:locale" content="ja_JP">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#050a0c">
<link rel="icon" href="data:image/svg+xml,${fav}">
<link rel="canonical" href="${SITE_URL}">
<style>html{color-scheme:dark}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
</head>
<body>
${body}
</body>
</html>`;
fs.mkdirSync("site", { recursive: true });
fs.writeFileSync("site/index.html", html);
console.log("site/index.html built", html.length, "bytes");
