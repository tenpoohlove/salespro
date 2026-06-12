# CLAUDE.md — p3 SalesPro（プロジェクト指示）

## これは何
セールスのZoomクロージング商談を分析し、成約率を上げる添削＋「本人の声での理想クロージング音声見本」を返すWebツール。クライアント=根宜さん(オニオンリンク)へ納品、登録制で多数に配布。

## 技術スタック
Node.js 18+ / Express / TypeScript(tsx) / SSE / SQLite(better-sqlite3) / multer / express-rate-limit / DOMPurify+marked / bcryptjs / nodemailer。
分析=Claude(claude-sonnet-4-6) / 文字起こし=OpenAI Whisper(whisper-1) / 声クローン=Fish Audio。**全てBYOK**。

## 起動
`npm run dev` → http://localhost:3000 。tsx watchは.env変更を検知しない→変更時は手動再起動。

## 絶対ルール（CONSTRAINTS.md 参照）
- 全AIキーBYOK。サーバーキーをユーザー操作のフォールバックに使わない。
- 声見本はオンデマンド＋DBキャッシュ。バックグラウンド全件生成禁止。
- 声クローンは本人の声のみ＋生成前同意。
- 既存機能を壊さない（変更前テスト）。新機能はfeature flag裏。

## 主要ファイル
- src/server.ts(エンドポイント/SSE) / analyze.ts(分析) / prompts.ts(評価軸) / extractors.ts(抽出) / auth.ts / db.ts / email.ts
- 新規: voice.ts(声クローンアダプタ) / closing.ts(理想台本・声サンプル)
- 仕様: docs/SRS.md, SDD.md, TEST_PLAN.md, E2E_SCENARIOS.md / 制約: CONSTRAINTS.md

## デプロイ
GCP Compute Engine VM(e2-micro/Always Free)。最初から根宜さんのGCPアカウントへ。SQLiteは永続ディスク継続(移行不要)。

## 評価基準（重要）
商談クロージング向け評価軸(Pain Articulation/BANT/MEDDIC/反論処理/次アクション確保等)がデフォルト。ユーザーが理想トークスクリプト/商材マニュアルをアップしたら照合して精度UP(ハイブリッド)。
