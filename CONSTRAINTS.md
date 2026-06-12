# CONSTRAINTS — p3 不変条件・禁止事項
版 1.0 / 2026-06-12 / 違反はRYG Red

## 1. 絶対遵守（コスト/課金）
- 全AIキー(Anthropic/OpenAI/Fish Audio)は**BYOK**。サーバー/オーナーのキーをユーザー操作のフォールバックに使うことを**禁止**。
- 声見本・分析は**オンデマンド生成のみ**。バックグラウンドでの全件事前生成を**禁止**（セッションリセットで多重課金事故）。
- 生成結果(voiceID/音声/分析)は**DBキャッシュ必須**。2回目は0円。

## 2. セキュリティ
- 声クローンは**本人の声のみ**。生成前に**同意UI**必須（なりすまし防止）。
- 認証必須API=requireAuth、管理API=requireAdmin、レート制限維持。
- XSS対策(DOMPurify+marked)維持。HTTPS前提。

## 3. データ
- SQLiteはGCP VM永続ディスク(DB_PATH)。アップ音声・一時ファイルは処理後削除。
- 本番前に data.db 初期化（テストユーザー除去）。

## 4. 外部送信/破壊操作
- Fish Audio/Claude/Whisper呼び出しは DRY_RUN/Mock を既定に持ち、キー有り＋承認時のみ実呼び出し。
- 本番デプロイ・feature flag有効化は個別の明示承認が必要（人ゼロ自動化しない）。

## 5. リグレッション防止
- 既存純粋関数(prompts/extractors等)は変更前にテスト作成。声クローン追加で既存分析を壊さない。
- 新機能は feature flag 裏で実装、検証まで off。

## 6. 技術制約
- 既存スタック(Node18+/Express/TS/SQLite)維持。GCP Compute Engine VM(e2-micro無料枠)。
- 動画身振りのGeminiネイティブ解析は非採用（コスト・EV-EXP）。文字起こし＋文章補足で代替。
