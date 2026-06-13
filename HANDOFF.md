# 引き継ぎファイル — p3 SalesPro（商談クロージング添削＋声クローン）
最終更新: 2026-06-13

このファイルを読めば「明日続きから」で再開できます。
次回は **「HANDOFF.md を読んで続きからやって」** と言えばOK。

---

## このプロジェクトは何か
セールスのZoomクロージング商談を分析・添削し、成約率を上げるWebツール。
さらに「本人の声」で“理想クロージング”を音声生成して返す。
クライアント＝根宜さん(オニオンリンク)へ納品。登録制で多数に配布。全AIキーBYOK（利用者負担）。

技術: Node/Express/TypeScript(tsx)/SSE/SQLite(better-sqlite3)/multer/Fish Audio/Anthropic/OpenAI Whisper。
起動: `npm run dev` → http://localhost:3000 （.env変更時は手動再起動）
テスト: `npm test`（vitest・現在24件PASS）/ 型: `npx tsc --noEmit`（緑）

---

## いま全体のどこにいるか（重要）
**実装はほぼ完了。残るは「実音声の試聴」と「GCP本番デプロイの実行」だけ。**
両方とも“待ち”や“課金”が絡むので次回に持ち越し。コードは全てコミット＆GitHubにpush済み。

---

## 残タスク（次回やること・この順で）

### ★1. 声クローン＝理想クロージング音声の「実音声 試聴」
- 目的: 実際にFish Audioで音を出して品質を耳で確認する（Claudeは音を聞けないのでゆかたんが試聴）。
- 必要なもの:
  - 営業“本人だけ”のクリーンな音声（30〜60秒）。商談録音は営業と客が混ざるので、本人だけが話している音源が望ましい。→ ゆかたんが根宜さん/対象者に「本人の声が大事」と伝えて用意してもらう。
  - Fish Audio APIキー（BYOK）。以前の検証キーは履歴露出のため再発行推奨。
  - 起動時に `FEATURE_VOICE_CLONE=true`（既定off）。
- 確認したいこと: ①本人の声で自然に聞こえるか ②営業↔客の会話の掛け合いとして成立するか ③客の汎用声(性別一致)が違和感ないか。
- 任意: 客の汎用声を指定したい場合、env `CUSTOMER_VOICE_FEMALE` / `CUSTOMER_VOICE_MALE` にFishの公開モデルIDを設定（未設定はFish既定声）。

### ★2. GCP本番デプロイの実行（課金・要承認）
- 前提: 根宜さんが ①GCPアカウント作成 ②支払い設定 ③ゆかたん(tenpoohlove@gmail.com)をオーナー招待 を完了すること。→ **依頼文は送付済み・返信待ち**。
- あわせて根宜さんに **公開ドメイン（サブドメイン1つ）** をもらう（HTTPSに必要）。
- 手順は全部 `docs/DEPLOY_GCP.md` に記載済み。招待が来たらその通りに実行するだけ。
- 利用者向けキー取得手順は `docs/API_KEY_GUIDE.md`。

### 3.（任意・後回し可）平坦な声向けの抑揚改善
- 抑揚つきサンプルなら実用十分。平坦な人向けに Speech-to-Speech 方式は未調査。必要になったら検討。

---

## 根宜さん待ちの状態
- GCPオーナー招待 ＋ サブドメイン1つ、の返信待ち。
- 返信が来たら → ★2（デプロイ）に進む。

---

## ⚠️ ゆかたんへの未処理リマインド
- 検証で使った **Anthropic APIキーがチャット履歴に平文露出**。console.anthropic.com → API Keys → 該当キーをDelete → 新規作成（再発行）。まだなら必ず実施。

---

## 今セッション(2026-06-13)で完了したこと
1. ディープリサーチ結果を評価軸に反映（prompts.ts）。MEDDIC(6)→MEDDPICC(8要素・緑/黄/赤診断)、Challenger 'Take Control'、Gong実証ベンチマーク(傾聴比43:57/独り語り≤2:30/質問11-14問/痛み3-4件/next-step+53%/価格中盤)、各軸1/5/10採点アンカー、「相関であり因果でない」但し書き、日本市場補正。
2. /api/analyze に商談クロージング評価モードを統合。analyzeContent に mode/context/referenceBaseline を追加。UIに分析タイプ切替（コピー評価/商談クロージング評価）＋備考欄＋理想トーク欄。既定copyで既存維持。
3. 声サンプル自動トリミング(ffmpeg-static)。長尺=Fish 524タイムアウト対策で先頭50秒・mono・22k・mp3に圧縮。**日本語ユーザー名でffmpegパスが文字化け→トリミング無言スキップのバグを修正**（python方式→ffmpeg-static採用）。
4. GCPデプロイ一式（docker-compose＋Caddy自動HTTPS / Caddyfile / .env.deploy.example / scripts/gcp-vm-bootstrap.sh / docs/DEPLOY_GCP.md / docs/API_KEY_GUIDE.md）。本番trust proxy対応も追加。
5. 添削品質を**実商談で検証→合格**。根宜さん本人の実商談(YouTube字幕)を本番ツール(Sonnet 4.6)に通し、的確かつ辛口(31点・失注商談)な添削を確認。内蔵レビュー工程の指摘2点（質問軸の出典統一・次アクション最優先）もprompts.tsに反映。
6. **声クローン＝理想クロージングを再設計**。①添削結果を反映した理想台本 ②営業/客の会話形式 ③2声音声化（営業=本人クローン声 / 客=汎用声・性別一致・顧客はクローンしない=同意問題回避）。synthesizeDialogue＋concatAudio(ffmpeg連結)。

---

## 主要ファイル
- src/server.ts … エンドポイント/SSE。/api/analyze(商談モード)・/api/voice/generate-sample(声見本)。本番trust proxy。
- src/analyze.ts … analyzeContent(mode:'copy'|'closing')。BYOKのみ。
- src/prompts.ts … CLOSING_SYSTEM_PROMPT / buildClosingAnalysisPrompt(MEDDPICC等)・buildAnalysisPrompt(旧コピー評価)。
- src/closing.ts … 理想クロージング会話生成(buildIdealClosingPrompt+parseClosingDialogue)・声サンプル(trimVoiceSample/getFfmpegPath via ffmpeg-static)・2声合成(synthesizeDialogue/concatAudio/pickCustomerVoiceId)。
- src/voice.ts … Fish Audioアダプタ。voiceId空ならreference_id省略=Fish既定声。Mock/DRY_RUN自動切替。
- src/db.ts / auth.ts / email.ts / extractors.ts
- public/index.html … 分析タイプ切替・商談備考・声クローンUI(客の性別選択・本人声明記)。
- 設定/手順: docker-compose.yml, Caddyfile, .env.deploy.example, scripts/gcp-vm-bootstrap.sh, docs/DEPLOY_GCP.md, docs/API_KEY_GUIDE.md, CONSTRAINTS.md, CLAUDE.md
- リサーチ: research/closing_evaluation_criteria_report.md（評価軸の出典）

---

## 起動・テスト
- 開発: `npm run dev`（http://localhost:3000）
- テスト: `npm test`（24件PASS）/ ビルド: `npm run build` / 型: `npx tsc --noEmit`
- 声クローンを試す: `FEATURE_VOICE_CLONE=true` で起動（既定off）
- ffmpeg: ffmpeg-static(npm)が自動解決。python/apt不要・日本語ユーザー名でも壊れない。

## 絶対ルール（CONSTRAINTS.md）
- 全AIキーBYOK。サーバーキーをユーザー操作のフォールバックに使わない。
- 声クローンは本人の声のみ＋生成前同意。顧客の声はクローンしない。
- 声見本はオンデマンド＋DBキャッシュ（2回目0円）。バックグラウンド全件生成禁止。
- 既存機能を壊さない（変更前テスト）。新機能はfeature flag裏。

## 納品時メモ
- data.db初期化(テストユーザー除去)、ADMIN_EMAIL/SITE_URL/SMTP設定、声クローンflag判断は本番化チェックリスト(docs/DEPLOY_GCP.md)参照。
- 納品時は.envを空にして渡し、クライアントが自分のAPIキーを設定する。
