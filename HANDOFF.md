# 引き継ぎファイル — p3 セールスアドバイザー（声クローン添削機能）
最終更新: 2026-06-13

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

### ✅ 完了済み（2026-06-13セッション）
- ★評価基準ディープリサーチ(wyfhfsx13)の反映 → prompts.ts を MEDDPICC(8要素・緑/黄/赤)＋Challenger Take Control＋Gong実証ベンチマーク(傾聴比43:57/独り語り≤2:30/質問11-14問/痛み3-4件/next-step+53%/価格中盤)＋採点アンカー＋「相関であり因果でない」但し書き＋日本市場補正に強化。(コミット de13b31)
- /api/analyze に商談クロージング評価モードを統合。analyzeContent に AnalyzeOptions{mode,context,referenceBaseline}追加。UIに分析タイプ切替(コピー評価/商談クロージング評価)＋備考欄＋理想トーク欄。既定はcopyで既存維持。(8d00557)
- 声サンプルの自動トリミング(ffmpeg)実装。trimVoiceSample()で先頭50秒・mono・22k・mp3に圧縮。**重要バグ修正**: 日本語ユーザー名でpython経由のffmpegパスが文字化け→ENOENT→トリミング無言スキップしていた。ffmpeg-static(npm)を主軸にして解決。(a3ea8dd)
- テスト計20件PASS / tsc緑。

### ✅ 声クローン＝理想クロージングの再設計（2026-06-13）
- 理想クロージングを「①添削結果(評価)を反映」かつ「②営業/客の会話形式」で生成するよう変更（buildIdealClosingPrompt/parseClosingDialogue）。
- 音声を2声で合成: **営業=本人のクローン声**（本人だけのクリーン音声30-60秒をアップ）/ **客=汎用の声**（性別一致・Fish既定声 or env CUSTOMER_VOICE_FEMALE/MALE）。**顧客はクローンしない**（同意問題回避）。synthesizeDialogue()＋concatAudio()でffmpeg連結。実mp3連結は動作確認済。
- UIに客の性別選択を追加・声サンプルは「営業本人の声」と明記・添削結果を声EPに送信。
- ★未確認: **実音声（Fishキー＋本人のクリーン音声）での最終試聴**。ゆかたんが本人にクリーン音声を用意してもらう旨を先方に伝える予定。テスト24件PASS・tsc緑。

### 1. 抑揚の更なる改善（必要なら）
- 「抑揚つきサンプル」で十分実用レベルになったが、平坦な人向けには Speech-to-Speech（声変換）方式を要検討（未調査）。

### ✅ デプロイ準備（先行作成済み・2026-06-13）
- 根宜さんへ「GCPアカウント作成＋支払い設定＋ゆかたん(tenpoohlove@gmail.com)をオーナー招待」の依頼文を送付済み。**根宜さんの準備完了連絡待ち**。
- デプロイ一式を作成済（招待が来たら docs/DEPLOY_GCP.md の手順で即公開できる）:
  - docker-compose.yml（app＋caddy自動HTTPS）/ Caddyfile / .env.deploy.example / scripts/gcp-vm-bootstrap.sh
  - docs/DEPLOY_GCP.md（e2-micro作成→DNS→起動→運用→本番化チェックリスト）
  - docs/API_KEY_GUIDE.md（利用者向けBYOKキー取得手順・コスト目安）
  - server.ts に本番 trust proxy 対応を追加（プロキシ背後でのレート制限誤動作を防止）

### 2. GCPデプロイ実行（課金・要個別承認）★根宜さんの準備完了後ここから
- 手順は docs/DEPLOY_GCP.md に全部記載。根宜さんがオーナー招待してくれたら、その手順通りに実行するだけ。
- 公開ドメイン（サブドメイン1つ）が必要。根宜さんに確認する。
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
- ffmpeg: **ffmpeg-static(npm)を使用**（getFfmpegPath()が自動解決）。Win+GCP Linux VM両対応・python/apt不要。日本語ユーザー名でも文字化けしない（旧python方式は文字化けでENOENTになるバグがあった）
- Claudeは音声を聞けない→音声品質の判定はゆかたんが試聴して行う

## 既知のリスク（risk_register.md参照）
- RISK-002 声品質: 抑揚つきサンプルで解決見込みだが商談ごとに要確認
- RISK-005 複数話者: 本人の声区間の選択UIが必要（未実装）
- RISK-008 リグレッション: 既存分析を壊さないこと（テストで担保中）
