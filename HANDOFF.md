# GEO-SCOPE 引き継ぎメモ（v75 / 2026-11-06）

別PC・別アカウントで開発を続けるための資料です。新しい Claude のセッションでは、まずこのファイルと `README.md` を読ませてから作業を頼んでください（末尾に最初に渡すプロンプト例があります）。

---

## 1. これは何か
- コックピット／レーダー風の世界地図ニュースサイト。YouTube の 24 時間配信レイアウトとしても使う（`#live`）
- 単一 HTML（`src/page.html`、約 530KB）＋ JSON データ＋音声クリップ。GitHub Pages で静的配信し、GitHub Actions がニュース取得・音声生成・デプロイを回す
- 国連加盟 194 か国（台湾を含む。極小国はマーカーのみ、日付変更線をまたいで表示）

## 2. フォルダ構成
| 場所 | 中身 |
|---|---|
| `src/page.html` | ページ本体（編集するのはここ） |
| `site/` | 公開フォルダ。`build_site.mjs` が `index.html` を生成。`news.json` `regions.json` `markets.json` `data_en.json` `about.html` `changelog.json` `og.png` |
| `site/voice/` | 音声クリップと索引（`index.json`＝日本語、`index_en.json`＝英語、`index_profile.json`＝国紹介）。**zip には含めていない**（PC ごとに生成） |
| `scripts/` | 収集・音声・ビルド・検査・ローカル運用のスクリプト（下表） |
| `.github/workflows/` | `update-news.yml`（2時間おき）、`update-quakes.yml`、`update-markets.yml` |
| `extras/voice_profile_en/` | 生成済みの英語国紹介クリップ 194 本（Piper amy）。§6 参照 |

主なスクリプト:
- `update_news.mjs` … RSS＋GDELT で無料収集 → Claude（検索なし）で選別・要約 → `news.json`。`SOURCE=search` で旧方式、`INIT=1` でニュースの無い国を埋める
- `feeds_lib.mjs` / `feeds.json` / `region_aliases.json` … 収集元の一覧、RSS・GDELT の取得、国・都道府県・州の別名辞書
- `.cache/` … 既に Claude に渡した記事の記録（二重課金防止）。Actions が自動でコミットする
- `update_regions.mjs` … 都道府県・米国州の経済ニュース → `regions.json`（同じく RSS＋GDELT → Claude）。`INIT=1` で全地域を埋める
- `update_markets.mjs` … Stooq（無料・キー不要）→ `markets.json`
- `synth_voice.mjs` / `synth_voice_en.mjs` / `synth_profile.mjs` … VOICEVOX / Piper で音声生成（ラウドネス正規化込み）
- `normalize_voice.mjs` … 既存クリップの音量を揃える
- `serve_local.mjs` … ローカルサーバー（8080）。`local_loop.mjs` … ニュース→音声→マーケットを定期実行（Actions の代わり）
- `chat_relay.mjs` … YouTube ライブチャット → `commands.json` / `chat.json`
- `build_site.mjs` / `check.mjs` / `soak_test.cjs`（長時間テスト、Playwright が必要）

## 3. 新しい PC でのセットアップ
1. Node.js 20 以上を入れる
2. zip を展開し、そのフォルダで
   ```powershell
   node scripts\build_site.mjs
   node scripts\check.mjs
   node scripts\serve_local.mjs     # http://localhost:8080/#live
   ```
3. 音声（日本語）: VOICEVOX アプリを起動して `node scripts\synth_voice.mjs`
4. 音声（英語）: `pip install piper-tts` → `python -m piper.download_voices en_US-amy-medium --data-dir .piper` → `node scripts\synth_voice_en.mjs`
5. 国紹介音声: `node scripts\synth_profile.mjs`（英語分は §6 の extras を使えば生成を省ける）
6. ニュース更新を手元で回すなら環境変数 `ANTHROPIC_API_KEY` を設定して `node scripts\local_loop.mjs`

旧 PC の音声を持っていく場合は、旧フォルダの `site\voice\*` を新フォルダの `site\voice\` にコピーするだけで使えます。

## 4. GitHub に載せる手順（本番化）
1. 新しいアカウントで GitHub リポジトリを作り、このフォルダを push
2. Settings → Pages → Source を **GitHub Actions** に
3. Settings → Secrets → Actions に `ANTHROPIC_API_KEY`
4. （任意）Variables に `GEOSCOPE_SITE_URL`（OGP 用の公開 URL）、`GEOSCOPE_MODEL`
5. Actions タブで `update-news` を手動実行（初回は `init` にチェックすると全か国・全地域を埋める）
6. 不要なジョブ（例: マーケット）は該当 yml を削除

### 独自ドメインを取ったあとの手順
1. DNS（ドメインを買ったサービスの管理画面）に登録する
   - サブドメイン（例 `news.example.com`）なら CNAME を `<GitHubユーザー名>.github.io` に向ける
   - ドメイン直下（例 `example.com`）なら A レコード 4 つ（185.199.108.153 / 185.199.109.153 / 185.199.110.153 / 185.199.111.153）
2. GitHub の Settings → Pages → Custom domain にドメインを入れて Save。DNS が通ったら Enforce HTTPS にチェック（証明書の発行に最大 1 日）
3. Settings → Secrets and variables → Actions → Variables の `GEOSCOPE_SITE_URL` を `https://<ドメイン>/` に変更（OGP の URL に使う）
4. update-news を手動実行して、新しい URL で OGP 画像とページが出ることを確認
   - Pages の Source が GitHub Actions のときは `CNAME` ファイルは不要（設定画面の値が使われる）

> 旧アカウントの claude.ai アーティファクト（プレビュー用ページ）は新アカウントからは編集できません。本番は GitHub Pages が正です。

## 5. 確定済みの仕様・方針（変えるときはユーザー確認）
**デザイン**
- 全画面アラートはエヴァンゲリオン風の「雰囲気」だけ参考。**デザインの直接的な模倣は NG**
- アラート: 8 秒、英語タイトル＋英語国名のみ、二重枠、縦長コンデンスのセリフ体（Bodoni Moda 600 を横に圧縮）の中抜き文字を枠いっぱいに収める（2026-11-08 ユーザー指定の参考画像に合わせて Helvetica Bold から変更）。種類と色＝赤 STATE OF EMERGENCY（サイレン音）／黄 SEISMIC ALERT／紫 NUCLEAR / BIO ALERT／青 CYBER ALERT／白 BREAKING NEWS。初日のみ表示、表示後にそのニュースを地図で出す
- コールアウト: 引き出し線→枠の順に描く。関連国は 2 秒後にピン＋ズームアウト＋左右反転
- 無線ノイズ＋画面の乱れ（SVG displacement / RGB ずれ / ドロップアウト）
- ヘッダー: 2 段目は SND・VOICE・BGM・EN・LIVE と ⚙SET のみ。他の設定は SET パネル

**音声**
- 日本語: VOICEVOX **No.7 アナウンス（speaker ID 30）**、speed 1.25 / pitch 0.02 / intonation 1.35 / volume 1.1 / pause 0.7
- 英語: Piper **en_US-amy-medium（女声）**、length_scale 0.8
- 無線加工（ページ側 Web Audio）: 帯域 400–2600Hz、歪み drive 5、ノイズ 0.08、前後のスケルチ「ザッ」強さ 0.4、残響なし（SND を ON にしても声に残響がかからないこと）
- BGM: 432Hz 系のドローン＋バイノーラル＋シンギングボウル、独自リバーブ、読み上げ中はダッキング
- VOICE / BGM / SND はそれぞれ独立した ON/OFF
- クリップの無い項目はブラウザ音声で代読（自己診断バッジに出る）

**進行**
- 1 件 10 秒、読み上げが長ければ 5 秒単位で延長
- 毎時 :00 TOP OF THE HOUR（約 1 分）、:20 都道府県経済、:50 米国州別経済（各 最長 6 分）
- ニュース 1 巡後に国紹介（PROFILE: なし／3 か国／全か国）
- 表示期間 24H / 3D / 7D（配信は 3D 推奨）
- 6 時間ごとに自動リロード（LIVE 時）

**ニュース収集（v75〜）**
- 記事集めは公式 RSS と GDELT（無料）、Claude は検索なしで選別・要約・翻訳のみ（月 4〜5 千円の見込み。旧方式は月 2〜3 万円）
- 出典 URL は Claude に書かせず、スクリプトが候補記事の実 URL を付ける
- 世界ニュース 4 時間おき、地域枠（日本＋米国）1 日 2 回

**運用**
- 旧アカウントでは scheduled task を作らない方針だった（移行前提のため）。新アカウントで Claude 側の定期実行を使うかは改めて決める。現状は GitHub Actions / `local_loop.mjs` で完結している

## 6. extras（任意）
`extras/voice_profile_en/` は英語の国紹介クリップ 194 本と索引です。新しい PC の `site\voice\` に **`index_profile.json` がまだ無い場合だけ** 中身をまるごとコピーしてください（既にある場合は上書きせず、`node scripts\synth_profile.mjs` で生成）。日本語の国紹介は VOICEVOX で `LANGS=ja node scripts/synth_profile.mjs` を一度走らせると索引に追記されます。

## 7. 残っている TODO / 検討事項
- [ ] **公開前**: `site/about.html` の運営者情報・連絡先・ポリシーを記入（公開時に対応予定）
- [ ] GitHub の schedule が発火しない（2026-11-08 時点で一度も動いていない。ワークフローは active、cron を登録し直しても同じ）。代わりに作業 PC のタスクスケジューラ（フォルダ \GEO-SCOPE\）が `scripts/kick_hidden.vbs` → `scripts/kick_actions.ps1` で gh workflow run を呼ぶ。地震 15 分ごと、ニュース 4 時間ごと（JST 1,5,9,13,17,21 時 19 分、`scheduled=true` で地域枠は 1 日 2 回）。PC が切れている間は止まる。GitHub 側の schedule 実行が最近あれば自動でスキップする。ログは `%LOCALAPPDATA%\geo-scope\kick.log`。直ったら `Unregister-ScheduledTask -TaskPath \GEO-SCOPE\ -TaskName *` で外す
- [ ] 実費の確認：Actions のログの `usage: … ≈ $…` を 1〜2 日分見る
- [ ] マーケット表示の取得先を決め直す。2026-11-08 に確認したところ Stooq は無料 CSV をやめていた（/q/l/ は 404、/q/d/l/ は 403）。ECB（為替）と Coinbase（BTC）の予備は取れる。update-markets.yml のスケジュールは止めてあり、古いデータは 36 時間で自動的に隠れる
- [ ] RSS は 2026-11-08 の実環境確認で ReliefWeb（HTTP 406）以外すべて取得できた。GDELT は手元の PC からも Actions からも 429（回数制限）。最初の 429 か通信エラーでその実行の GDELT を打ち切るようにした（`GDELT=off` で最初から使わない）。地域枠の INIT は GDELT が取れないと RSS に切り替わる。ReliefWeb がだめなら feeds.json から外すか URL を差し替える
- [ ] 同梱の `regions.json` / `markets.json` はサンプル（見出しに【サンプル】）。初回の更新で置き換わる
- [ ] 航空機・船レイヤー（試作のみ、既定で無効）。`scripts/fetch_traffic.mjs` が緊急スコーク 7500/7600/7700 の機体（adsb.lol、データは ODbL）と要所 8 か所の船舶数（aisstream.io、要 `AISSTREAM_KEY`）を `site/traffic.json` に書く。ページは URL に `traffic=on` を付けたときだけ表示。有効化の前に adsb.lol と aisstream.io へ商用利用（収益化した配信）の可否を確認する。航空機が不可なら FlyItalyADSB（無料枠でも商用可・出典表記、全世界は月 49 ユーロ）に切り替え。可なら地震ワークフロー（15 分おき）か配信 PC で fetch_traffic を回し、ページの既定を on にして about.html のデータ出所に追記する
- [ ] 国紹介 ALL だと 1 ラウンドが 10 分以上になる → `PROFILE 3` 既定化か「1 巡おき」にするか検討
- [ ] 既存音声を `normalize_voice.mjs` で正規化（1 回）
- [ ] 公開後: YouTube 配信で OBS ブラウザソース（1920×1080、`#live`）の長時間安定を確認

## 8. バージョン履歴（要点）
- v69: 英語 Piper（amy）、BGM、出典リンク
- v70: 表示期間設定、国紹介ラウンド
- v71: ヘッダー UI 整理（SET パネル）、レスポンシブ
- v72: 左下ライブチャット表示（`chat.json`）
- v73: 都道府県・米国州の地域経済枠（`regions.json`）
- v75: ニュース収集を RSS＋GDELT ＋ 検索なし Claude に変更（コスト約 1/6）、更新 4 時間おき・地域枠 1 日 2 回、ワークフローの YAML 不備を修正
- v74: 自己診断バッジ、ラウドネス正規化、ON AIR 行、毎正時まとめ、マーケット表示、地域枠の改善、静かな国の光点を静止（CPU 約 3 割減）、50 分ソークテストでリークなしを確認

## 9. 新しい Claude セッションに最初に渡すプロンプト例
```
GEO-SCOPE というプロジェクトの続きを手伝ってください。
添付の zip を展開し、まず HANDOFF.md と README.md を読んで現状を把握してください。
ページ本体は src/page.html、ビルドは node scripts/build_site.mjs です。
HANDOFF.md の「確定済みの仕様・方針」は私が決めたものなので、変える場合は先に確認してください。
今日やりたいこと: （ここに書く）
```
