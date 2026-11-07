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

## 現状（2026-11-07 移行時点）

- v75 を zip から展開し、ビルドと検査は通過。ローカル git で控えを作った（リモートなし）
- まだ個人アカウントの GitHub リポジトリは無く、公開もしていない

## 次にやること

1. 個人アカウントで GitHub リポジトリを作って push し、Pages の Source を GitHub Actions にする。Secrets に ANTHROPIC_API_KEY を入れる
2. DRY_RUN=1 node scripts/update_news.mjs で RSS と GDELT の取得を実環境で確かめ、エラーのフィードは feeds.json を差し替える
3. Stooq の取得、実費（Actions ログの usage）、音声の生成と正規化を確かめる
4. 公開前に site/about.html の運営者情報、連絡先、ポリシーを書く
5. 残りの TODO は HANDOFF.md 7章を見る
