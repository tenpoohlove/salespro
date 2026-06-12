# 引き継ぎファイル — p3 セールスアドバイザー（声クローン添削機能）
最終更新: 2026-06-12

このファイルを読めば「明日続きから」で再開できます。次回は **「HANDOFF.md を読んで続きからやって」** と言えばOK。

---

## いまどこまで進んだか（2026-06-12セッション）

spec-driven-autobuild パイプラインで「声クローン添削機能の追加」を設計→実装→実キー検証まで実施。
状態機械(harness/state)上は Phase 7(VERIFY)。コミット済み・GitHubにpush済み。

### 確定した方針（重要）
- クロージング添削＝文字起こしベース（動画の身振り解析はコスト/スピードで見送り、評価結果に文章補足する）
- デプロイ＝GCP Compute Engine VM（e2-micro無料枠）。SQLiteそのまま継続でDB移行不要。最初から根宜さんのGCPアカウントへ直接デプロイ（移行回避）
- 声クローン＝Fish Audio採用（日本語品質首位・最安）。全AIキーBYOK
- 評価基準＝ハイブリッド（デフォルト＝世界標準の商談評価軸／任意＝ユーザーが理想トークスクリプト・商材マニュアルをアップ）
- リール量産アプリは別案件＝対象外

### 実キー検証で確認できたこと（声クローン）
- ✅ 本人の声を再現できる（根宜さんの39秒録音→クローン→別文章も本人の声で生成成功）
- ✅ 抑揚も良好。ただし条件あり＝「抑揚つきで録音されたサンプル」を使うこと。平坦なサンプルだと平坦になる
- ✅ 棒読み回避＝Fishに勝手な日本語マーカー [○○] を入れると謎ノイズになるので入れない（素のテキストで合成）
- 注意: 声サンプルは40秒前後に切る（10MB/15分は524タイムアウト）。ffmpegは imageio-ffmpeg を使用

---

## 実装済みファイル（コミット済み）
- src/voice.ts … Fish Audioアダプタ（createVoiceId/synthesize）＋MockVoiceProvider＋DRY_RUN自動切替＋cacheKey
- src/closing.ts … buildIdealClosingPrompt / generateIdealClosingScript（理想台本生成）/ prepareVoiceSample（声サンプル検証）
- src/prompts.ts … CLOSING_SYSTEM_PROMPT・buildClosingAnalysisPrompt（商談評価軸＋非言語補足＋備考/相手情報context）
- src/db.ts … fish_key列・voice_samples・audio_cache・reference_baselines テーブル追加
- src/server.ts … POST /api/voice/generate-sample（feature flag FEATURE_VOICE_CLONE 既定off）、fish_key BYOK対応、/api/health に featureVoiceClone追加
- src/analyze.ts … Groqのオーナーキー・フォールバック違反を修正（BYOKのみ）
- public/index.html … Fishキー入力欄・声見本生成UI（音声アップ/同意チェック/備考欄/プレイヤー）。flag ON時のみ表示
- Dockerfile / .dockerignore … GCP VM用
- docs/（SRS,SDD,TEST_PLAN,E2E,requirements_ledger,risk_register）, CONSTRAINTS.md, CLAUDE.md, PROGRESS.md, TASKS.md
- tests/unit/（voice.test.ts, closing.test.ts）= 11件PASS / tests/manual/（v1〜v5 手動検証スクリプト・キーはenv渡し）

### テスト状況
- `npm test`（vitest）= ユニット11件 PASS
- `npx tsc --noEmit` = 緑 / `npm run build` = 緑
- サーバー起動スモーク = health 200・認証保護OK・DBマイグレーションOK

---

## 次回やること（残タスク・優先順）

### ★最優先: 評価基準ディープリサーチの反映
- バックグラウンドで「商談クロージング評価基準」の本格ディープリサーチを実行した（Task: wyfhfsx13）。
- 完了後の結果は research/closing_evaluation_criteria_report.md に保管予定（未完了なら次回 /workflows で確認 or 再実行）。
- → このレポートを根拠に prompts.ts の CLOSING_SYSTEM_PROMPT / buildClosingAnalysisPrompt の評価軸を強化する。

### 1. 分析(/api/analyze)に「商談クロージング評価軸＋備考/相手情報」を統合
- 現状: 新しい buildClosingAnalysisPrompt と context は「声見本フロー」には統合済みだが、メインの /api/analyze は旧コピー評価プロンプト(buildAnalysisPrompt)のまま。
- やること: analyze に「商談モード」を追加し、buildClosingAnalysisPrompt と context(備考/相手情報) を使えるようにする。UIにも分析時の備考欄を追加。

### 2. 声サンプルの自動トリミング処理
- アップ音声が長いとFishが524タイムアウト。サーバー側で声サンプルを40〜60秒に自動カットする処理を追加（ffmpeg）。closing.ts の prepareVoiceSample 付近に実装。

### 3. 抑揚の更なる改善（必要なら）
- 「抑揚つきサンプル」で十分実用レベルになったが、平坦な人向けには Speech-to-Speech（声変換）方式を要検討（未調査）。

### 4. GCPデプロイ（課金・要個別承認）
- 根宜さんがGCPアカウント作成＋ゆかたんを管理者(IAM)に追加 → 直接デプロイ。
- 根宜さん向けセットアップ説明書はまだ未作成（次回作る）。
- 本番前: data.db初期化(テストユーザー除去)、ADMIN_EMAIL/SITE_URL設定、SMTP設定。

---

## 起動・テスト方法
- 開発: `npm run dev` → http://localhost:3000
- テスト: `npm test`
- 声クローン機能を試す: 環境変数 `FEATURE_VOICE_CLONE=true` で起動（既定off）
- 声クローンの手動検証: `FISH_TEST_KEY=xxx ANTHROPIC_TEST_KEY=xxx npx tsx tests/manual/v4_negi.ts` 等

## API・課金（BYOK）
- 分析=Anthropic claude-sonnet-4-6 / 文字起こし=OpenAI whisper-1 / 声クローン=Fish Audio
- 全てユーザー自身のキー（X-Anthropic-Key / X-OpenAI-Key / X-Fish-Key）。サーバーキーをフォールバックに使わない
- 検証で使ったキーは会話履歴に露出したため、ローテーション(再発行)推奨

## 環境メモ
- 承認プロンプトは全ターミナルでゼロ設定済み（~/.claude/settings.json: bypassPermissions）
- ffmpeg: `python -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"` で取得
- Claudeは音声を聞けない→音声品質の判定はゆかたんが試聴して行う

## 既知のリスク（risk_register.md参照）
- RISK-002 声品質: 抑揚つきサンプルで解決見込みだが商談ごとに要確認
- RISK-005 複数話者: 本人の声区間の選択UIが必要（未実装）
- RISK-008 リグレッション: 既存分析を壊さないこと（テストで担保中）
