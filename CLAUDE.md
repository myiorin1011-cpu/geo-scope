# GEO-SCOPE プロジェクト

コックピット・レーダー風の世界地図ニュースサイト。YouTube の24時間配信レイアウト（#live）としても使う。
作業を始める前に HANDOFF.md と README.md を読むこと。HANDOFF.md 5章の確定済みの仕様・方針はユーザーが決めたものなので、変えるときは先に確認する。

## 基本

- ページ本体は src/page.html（ここを編集する）。site/index.html は node scripts/build_site.mjs で生成する
- 検査は node scripts/check.mjs、ローカル表示は node scripts/serve_local.mjs（http://localhost:8080/#live）
- 本番は GitHub Pages と GitHub Actions（ニュース、地震、マーケットの3ワークフロー）。旧アカウントの claude.ai アーティファクトはもう編集できない
- site/voice/ の音声は git に入れず PC ごとに生成する。英語の国紹介は extras/voice_profile_en/ を、index_profile.json が無いときだけコピーする

## 守るルール

- 全画面アラートはエヴァンゲリオン風の雰囲気だけ参考にし、デザインを直接まねしない
- ANTHROPIC_API_KEY などの鍵はチャットにもファイルにも貼らない。GitHub の Secrets と環境変数に置く
- GitHub への push、Pages の公開、Actions の手動実行は毎回ユーザーに確認してから行う
- 出力では ** や "" の記号を使わない

## 現状（2026-11-08）

- 公開リポジトリ myiorin1011-cpu/geo-scope、Pages は https://myiorin1011-cpu.github.io/geo-scope/ （Source は GitHub Actions）。Secrets に ANTHROPIC_API_KEY、Variables に GEOSCOPE_SITE_URL を登録済み
- gh CLI は C:\Program Files\GitHub CLI\gh.exe（PATH 未反映のときはフルパスで呼ぶ）。piper は C:\Users\User\AppData\Roaming\Python\Python312\Scripts\piper.exe（PIPER_BIN で指定）。ffmpeg は winget で導入済み
- 通常の更新は約5分・1回 0.09 ドル前後。GDELT は 429 で使えず RSS のみで動く。音声は Actions で ogg を生成してコミットする
- マーケット表示は Stooq の無料 CSV 廃止のため停止中
- 手元の site/voice は Actions が作ったものを pull で受け取る。以前手元で作った音声は C:\Users\User\geo-scope-voice-backup に退避

## 次にやること

1. 定期実行（schedule）が 2026-11-08 時点で一度も動いていない。当面は PC のタスクスケジューラが代行中（HANDOFF.md 7章）。GitHub サポートへの問い合わせも検討
2. 独自ドメインを取得し、HANDOFF.md 4章の手順で設定する
3. about.html の連絡先に Google フォームの URL を入れる
4. マーケット表示の代わりの取得先を決める
5. 残りの TODO は HANDOFF.md 7章を見る
