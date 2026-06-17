# 引き継ぎファイル — Pitch Navi（商談クロージング添削＋本人声の理想クロージング）
最終更新: 2026-06-17

このファイルを読めば「明日続きから」で再開できます。
次回は **「HANDOFF.md を読んで続きからやって」** と言えばOK。

---

## このプロジェクトは何か
セールスのZoomクロージング商談を分析・添削し、成約率を上げるWebツール「**Pitch Navi**」。
さらに「本人の声」で“理想クロージング”を音声生成して返す。
クライアント＝根宜さん(株式会社オニオンリンク)へ納品。登録制で多数に配布。全AIキーBYOK（利用者負担）。

技術: Node/Express/TypeScript(tsx)/SSE/SQLite(better-sqlite3)/multer/Fish Audio/Anthropic/OpenAI Whisper/nodemailer/Caddy。
起動: `npm run dev` → http://localhost:3000 （.env変更時は手動再起動）
テスト: `npm test`（vitest・現在31件PASS）/ 型: `npx tsc --noEmit`（緑）

---

## いま全体のどこにいるか（重要）
**主要機能はすべて実装済み・本番にデプロイ済み・本番で声クローン機能も有効化済み。**
残るのは「ゆかたんが本番で実際に音を出して品質確認（実音声 試聴）」と「納品時の切り替え作業」だけ。

本番は公開URLでHTTPSで動いており、メール認証・APIキーテスト・フル尺理想クロージング生成まで使える状態。

### 2026-06-17のUI改善は本番デプロイ済み（完了）
今日のUI改善4件はGitHub push済み＋**本番VMへデプロイ済み**（VM HEAD=9256a25）。
本番(https://pitchnavi.8-231-192-187.sslip.io)で新UI（新トップ・使い方ページ・管理2分割・ロゴクリック・新ラベル）が稼働中。
デプロイ後検証OK: /api/health で featureVoiceClone:true / /howto.html・/admin-users.html ともに200 / 新ラベル「何を分析しますか？」配信確認。
再デプロイ時の注意（次回も同じ）: vm-setup.sh が .env.deploy を FEATURE_VOICE_CLONE=false で再生成するため、ビルド後に true へ戻して docker compose up し直す（手順は下記「本番への再デプロイ」）。

### メール認証フローは本番でE2E実証済み（2026-06-17）
ゆかたんの質問を受けて本番で実テスト実施。結果すべて正常：
- 新規登録→未確認ユーザー作成＋確認メール送信（needsVerification:true）
- 未確認のままログイン（正しいPW）→ 403で拒否（EMAIL_NOT_VERIFIED）
- 確認メールのリンククリック→確認完了→ログイン成功（200）
- 重複登録は400で拒否 / 一般ユーザーは isAdmin:false
- ※管理者メール(ADMIN_EMAIL)だけは登録時に自動で確認済みになりメール認証をスキップ（管理者が締め出されない設計）。納品時は根宜さんのアドレスへ。
- テストに使った tenpoohlove+e2etest@gmail.com は本番DBから削除済み。

---

## 本番環境の情報
- 公開URL: **https://pitchnavi.8-231-192-187.sslip.io**
- GCPプロジェクト: `pitch-navi`（owner=negigon@gmail.com / editor=tenpoohlove@gmail.com）。課金有効。
- VM: `pitch-navi-vm`（e2-micro / us-west1-a / Debian12 / 無料枠）。静的IP=**8.231.192.187**。FWで80/443開放。
- 構成: Docker Compose（app=Node/Express + caddy=自動HTTPS）。SQLiteはDocker volume `p3_p3data` に永続。
- ドメイン: sslip.io方式（VMのIPから自動。納品時に根宜さんの正式サブドメインへ付け替え可）。
- 本番フラグ: `FEATURE_VOICE_CLONE=true`（有効化済み）。`ADMIN_EMAIL=tenpoohlove@gmail.com`。
- メール送信(SMTP): 本番DBの app_settings に設定済み（smtp.gmail.com / tenpoohlove@gmail.com / アプリパスワード）。→ P6のクラウドDB(Neon)から移行。テストメール送信成功確認済み。
- gcloud CLI: ローカル導入済み・`gcloud auth login`済(tenpoohlove)。パス:
  `C:\Users\長沼有香\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd`

---

## 次回やること（残タスク・この順で）

### ★1. フル尺・理想クロージングの「実音声 試聴」（← 次回ここから・本来の続き）
- 本番URLでログイン（管理者＝tenpoohlove@gmail.com。未登録なら新規登録→確認メール無しで即ログイン）
- 「🔑 キー設定」で Anthropicキー＋Fish Audioキーを入力（各テストボタンで有効性確認できる）
- 商談を分析（または文字起こしをテキスト欄に貼る）
- 「🎙️ 理想クロージングの音声見本」で本人だけのクリーン音声をアップ＋同意チェック。
- 【コスト事故防止の段階確認ラダー（2026-06-16実装）】いきなり長尺で失敗するとコストが高いので、安い順に確認する：
  1. まず「🎙️ 短い見本（要点1〜2分）」ボタン＝ほぼ最安。声クローン経路（キー有効性・クローン生成・音声再生）が通るか確認。
  2. OKなら「🎬 フル理想クロージング」で尺=「約5分（テスト用・最安）」を選び生成（≈20〜30円目安）。
  3. 問題なければ 約10分 → 約30分 → 45分 → 60分 と段階的に伸ばす。
  - 尺選択は public/index.html の #voiceMinutes。デフォルトは5分。短尺が正しく反映されるよう closing.ts の targetCharsForMinutes の下限を500→150字に変更済み（30/45/60は不変）。
- 進捗バーが進み、数分でフル尺音声が再生できる。耳で品質確認。
- 必要なら: 平坦な声向けの抑揚改善（Speech-to-Speech方式）を検討。

### ★2. 納品時の切り替え（クライアント=根宜さんへ）
- SMTPを根宜さんのアドレスへ（本番admin画面のSMTP設定で再入力するだけ。プリセットでGmail等を選べばホスト・ポート自動入力）
- ADMIN_EMAIL を根宜さんへ / 正式サブドメインへ付け替え / data.db初期化（テストユーザー除去。管理画面の「削除」ボタンでも個別削除可）
- 声クローンを納品時に有効のままにするか判断（現在true）
- 手順は docs/DEPLOY_GCP.md / docs/API_KEY_GUIDE.md

### 3.（未処理リマインド）
- 検証で使った Anthropic APIキーがチャット履歴に平文露出 → console.anthropic.com で再発行（未対応なら）。

---

## 本日(2026-06-17)やったことの要約 ← 最新
すべてローカルでPlaywright実機検証済み・テスト31件PASS・GitHub(origin/main)へpush済み・**本番VMへデプロイ済み(VM HEAD=9256a25)**。
4コミット: 474428e / ae0f90e / 6ffb96d / b4e1dda。新規ファイル: public/admin-users.html, public/howto.html。
（セッション最後にゆかたん依頼で本番再デプロイ実行→featureVoiceClone:true・新ページ200・新ラベル配信を検証済み）
1. メール認証フローを本番でE2E実証（コミットなし・検証作業）。
   - ゆかたんの「登録→メール→クリックで完了する？未確認はログイン不可？」の質問に対し、本番で実テスト。
   - register/login/verify-email のコードを確認のうえ、本番に tenpoohlove+e2etest@gmail.com を実登録→403確認→メールリンク踏んで確認→ログイン成功(200)まで通し、最後にテストユーザーを本番DBから削除。すべて正常。
2. 管理者ページを2分割（コミット 474428e）。
   - 登録ユーザー一覧テーブルを別ページ public/admin-users.html に分離（ユーザー数が増えても管理トップが重くならないように）。
   - 管理トップ(admin.html)は「統計カード3つ＋『👥 登録ユーザー一覧』導線カード＋SMTP設定」だけに。
   - 一覧ページのヘッダーに「← 管理トップ」戻る導線。機能(検索/CSV/認証切替/有効無効/削除)は不変・APIも不変。
3. ヘッダーのロゴ/タイトル「Pitch Navi」クリックでトップ(/)へ戻れるように（コミット ae0f90e）。
   - index.html / admin.html / admin-users.html の3ページ。cursor:pointer + title="トップへ" + onclick="location.href='/'"。
4. トップ画面をシンプル化（コミット 6ffb96d）。
   - 情報過多で分かりにくかったので、右カラムの説明パネル(分析できる素材/困ったときは/分析内容)を別ページ public/howto.html に分離。
   - トップ(index.html)は1カラム中央寄せ(.container max-width:860px / grid 1fr)にして「やることだけ」の縦一列に。
   - ヘッダーに「📖 使い方」リンク追加。howto.html には「🚀 かんたん3ステップ」解説も新規追加。
5. 「分析タイプ/分析フォーカス」の見出しを質問形に＋説明文追加（コミット b4e1dda）。
   - 「🧩 分析タイプ」→「🧩 何を分析しますか？」、「🎯 分析フォーカス」→「🎯 特に見てほしい所（任意）」。各カードに一文の説明。
   - 補足: 分析フォーカス(full/hook/cta/trust)は buildAnalysisPrompt(コピー評価)にだけ渡る。商談クロージング評価では toggleAnalysisMode() が focusCard を display:none にする既存挙動があり、無視される観点はそもそも表示されない（混乱しない）。今回はそこは変更不要だった。

### ローカル検証用メモ（次回も使える）
- ローカルADMIN_EMAIL=admin@salespro.com。動作確認用に admin@salespro.com / パスワード AdminPass1234 を登録済み（ローカルDBのみ・本番には無い）。
- ローカルdev serverは別途 npm run dev で起動中だった（ポート3000）。Playwrightはキーモーダルやカスタムラジオでクリックがブロックされやすい→モーダルは button[onclick="closeKeyModal()"] で閉じる、ラジオは label[for=...] をクリックする。

## 前回(2026-06-16)やったことの要約（参考・git履歴にあり・本番デプロイ済み）
1. フル理想クロージングに短尺テスト枠を追加（コミット 8c8a4b8）。
   - 目的: いきなり長尺だと失敗時コストが高いので、安い尺から段階確認できるように。
   - UI(#voiceMinutes)に「約5分（テスト用・最安）」「約10分」を追加しデフォルトを5分に。
   - closing.ts の targetCharsForMinutes の文字数下限を500→150に変更（短尺を正しく反映。30/45/60は不変）。
2. 管理者ページをP1準拠に強化（コミット a3d36f8）。
   - メール認証の手動切替: POST /api/admin/users/:id/verify（is_verified を反転。メールが届かない人を手動で通せる）。
   - ユーザー削除: DELETE /api/admin/users/:id（管理者・自分自身は不可。FKの ON DELETE CASCADE で関連データも自動削除）。
   - ユーザー一覧テーブルに「メルマガ同意」「認証状態」の列を追加。
   - SMTP設定にプリセット（Gmail / Yahoo! / Outlook / 手動）を追加し、選ぶとホスト・ポートを自動入力。
   - CSV出力は現状維持（ゆかたん指定。名前/メール/電話/有効/登録日のまま）。
3. 通常画面ヘッダーに管理者ページへのリンク「🛡️ 管理」を追加（コミット f6ee5f4）。
   - me.isAdmin が true のときだけ表示。一般ユーザーには非表示で、管理APIも403で保護。
   - 自動で管理画面を開くのではなく、リンクをクリックして遷移する方式（ゆかたん合意済み）。

## 2026-06-15の要約（参考・git履歴にあり・本番デプロイ済み）
1. ツール名を「Pitch Navi」に統一。コミット bc41669。
2. GCP本番デプロイ（gcloud導入・VM作成・FW・静的IP・Docker+Caddy自動HTTPS・sslip.io公開）。
3. 登録フロー強化＋APIキー/SMTP管理をP1準拠に。コミット 110eda4。
4. 理想クロージングのフル尺化（セクション分割生成）。コミット ca2a315。
5. 理想クロージング台本をリサーチ直結に。コミット 96fd769。
6. フル尺音声を長尺バックグラウンド生成（Phase2・UI・進捗）。コミット bf8ccc7。
7. P6のNeon DBからSMTP実値を移行→本番DBに書き込み→テストメール送信成功。
8. 本番再デプロイ＋FEATURE_VOICE_CLONE=true 有効化。

---

## 起動・テスト・デプロイ手順

### ローカル開発
- 開発: `npm run dev`（http://localhost:3000）。声クローンを試すなら `FEATURE_VOICE_CLONE=true npm run dev`
- テスト: `npm test`（31件PASS）/ 型: `npx tsc --noEmit` / ビルド: `npm run build`
- ffmpeg: ffmpeg-static(npm)が自動解決。日本語ユーザー名でも壊れない。
- ポート競合(EADDRINUSE)時: `netstat -ano | grep ':3000' | grep LISTENING` でPID→`taskkill //PID <pid> //F`

### 本番への再デプロイ（コード変更後）
1. ローカルで `git push origin main`
2. VMで最新を取り込み再ビルド（バックグラウンド・冪等）:
   `gcloud compute ssh pitch-navi-vm --zone=us-west1-a --project pitch-navi --quiet --command="sudo bash -c 'setsid bash /tmp/vm-setup.sh >/tmp/setup.log 2>&1 </dev/null &'"`
   ※ vm-setup.sh は `git reset --hard origin/main` + `docker compose up -d --build` を実行（scripts/vm-setup.sh）。
   ※ 注意: vm-setup.sh は .env.deploy を再生成し FEATURE_VOICE_CLONE=false に戻すので、再デプロイ後は下記でフラグを戻す:
   `cd /opt/p3 && sudo sed -i 's/^FEATURE_VOICE_CLONE=.*/FEATURE_VOICE_CLONE=true/' .env.deploy && sudo docker compose --env-file .env.deploy up -d`
3. 確認: `curl -s https://pitchnavi.8-231-192-187.sslip.io/api/health`（featureVoiceClone等が返る）

---

## ハマりどころ（次回の自分へ）
- gcloud(Windows版)はSSHにPuTTY(plink.exe)を使い、PuTTY形式の鍵(.ppk)が要る。鍵が壊れていたら
  `~/.ssh/google_compute_engine*` を削除して `gcloud compute ssh ... --quiet` で再生成させる（空パスフレーズ）。
- 長時間SSH(sleep等)は plink が "Network error: Software caused connection abort" で切れる。
  → 重い処理はVM側で `setsid ... &` してSSHは即切る。状態確認は短いコマンドで。
- PowerShellツールが稀に EPERM(uv_spawn失敗)になる→リトライで回復。Bashから gcloud.cmd 直叩きはパスのスペースで失敗するのでPowerShellで実行。
- e2-microはディスクが遅く、Docker初回ビルドの exporting layers に約5分。2回目はキャッシュで速い。
- git の LF→CRLF 警告は無害。
- gcloud ssh の username 文字化け警告(????)は無害（自動で tenpoohlove を使う）。

---

## フル尺・理想クロージングの仕組み（今日実装の中核）
- 入力: 商談音声＋文字起こし(＋添削結果＋備考＋理想基準＋客の性別)。
- 流れ: ①文字起こし(Whisper) ②添削=評価(Claude) ③フル尺の理想台本(Claude・6章セクション分割生成) ④2声音声化(Fish: 営業=本人クローン声/客=汎用声)→1本に連結。
- リサーチ根拠: 評価軸(prompts.ts)＝Gong大規模通話分析/MEDDPICC/Challenger。台本生成にも IDEAL_CLOSING_BENCHMARKS / SECTION_FOCUS で同じ実証指標を明示注入（痛み3-4件・傾聴比43:57・Take Control・next-step+53%・日本式合意形成・相関但し書き）。出典: research/closing_evaluation_criteria_report.md。
- 長尺対応: バックグラウンドジョブ(/api/voice/generate-full→jobId, /api/voice/job/:id 進捗ポーリング, /api/voice/audio/:id ストリーム配信)。in-memoryジョブ・キー非保存・所有者チェック。UIに尺選択＋進捗バー＋プレーヤー。
- 【コスト】1回・BYOK・2回目以降キャッシュ0円・$1=150円: 約5分≈20〜30円 / 30分≈140円 / 45分≈205円 / 60分≈270円。
  Fish=$15/100万UTF-8byte(日本語3byte/字)、Claude Sonnet4.6=$3/$15(in/out per 1M)、Whisper=$0.006/分。
- 尺選択(2026-06-16): 約5分(デフォルト)/10/30/45/60。短尺ほど安いので、まず短い見本→5分→…と段階確認するのが安全。

---

## 主要ファイル
- src/server.ts … 全エンドポイント。/api/auth/*（登録/ログイン/確認/再送）, /api/user/api-keys(+/test), /api/admin/smtp(+/test), /api/admin/users(一覧), /api/admin/users/:id/toggle(有効無効), /api/admin/users/:id/verify(認証切替・2026-06-16追加), DELETE /api/admin/users/:id(削除・2026-06-16追加), /api/admin/export-csv, /api/analyze(SSE・copy/closing), /api/voice/generate-sample(短), /api/voice/generate-full・job/:id・audio/:id(フル尺), /api/health。本番trust proxy。
- src/closing.ts … 理想クロージング生成。buildIdealClosingPrompt(短)/buildSectionPrompt+generateFullIdealClosingScript(フル尺)/CLOSING_SECTIONS/IDEAL_CLOSING_BENCHMARKS/SECTION_FOCUS/targetCharsForMinutes/parseClosingDialogue/trimVoiceSample/synthesizeDialogue(onProgress)/concatAudio/pickCustomerVoiceId。
- src/prompts.ts … CLOSING_SYSTEM_PROMPT / buildClosingAnalysisPrompt(MEDDPICC等・リサーチベース) / buildAnalysisPrompt(旧コピー評価)。
- src/voice.ts … Fish Audioアダプタ(createVoiceId/synthesize)。キー無し/DRY_RUNでMock。
- src/analyze.ts … analyzeContent(copy/closing)。Anthropic/OpenAI SDK。BYOK。
- src/db.ts … SQLite。users(newsletter_consent追加)/sessions/email_verifications/user_api_keys/voice_samples/audio_cache/reference_baselines/app_settings。getSetting/setSetting。
- src/email.ts … nodemailer。SMTPはDB(app_settings)優先>env。sendVerificationEmail/sendTestEmail/isSmtpConfigured。
- src/auth.ts / extractors.ts
- public/index.html … 分析UI＋APIキー設定(テストボタン)＋声クローンUI(短/フル尺・尺選択[5/10/30/45/60分]・進捗バー)。2026-06-17に1カラム中央寄せ化(.container max-width:860px,grid 1fr)＋右カラム説明を howto.html へ分離。ヘッダーに「📖 使い方」(/howto.html)・管理者のみ表示の「🛡️ 管理」リンク(#adminLink)・ロゴ/タイトルクリックでトップへ。見出しは「🧩 何を分析しますか？」「🎯 特に見てほしい所(任意)」。
- public/howto.html … 使い方ガイド(2026-06-17新規)。かんたん3ステップ＋分析できる素材/困ったときは/分析でわかること。ロゴ→/・「← ツールに戻る」導線。
- public/admin.html … 管理トップ(2026-06-17に一覧を分離)。統計カード3つ＋「👥 登録ユーザー一覧」導線カード(/admin-users.html)＋SMTP設定[プリセット付き]。ロゴ/タイトルクリックでトップへ。
- public/admin-users.html … 登録ユーザー一覧(2026-06-17新規)。検索/CSV/認証手動切替/有効無効/削除/メルマガ・認証列。ヘッダーに「← 管理トップ」。APIは従来のまま(/api/admin/users 等)。
- public/login.html / signup.html(チェックボックス2つ必須・ボタン制御・P1風完了画面) / terms.html(利用規約) / verify-email.html
- 設定/手順: docker-compose.yml, Caddyfile, .env.deploy.example, scripts/gcp-vm-bootstrap.sh, scripts/vm-setup.sh, docs/DEPLOY_GCP.md, docs/API_KEY_GUIDE.md, CONSTRAINTS.md, CLAUDE.md
- リサーチ: research/closing_evaluation_criteria_report.md（評価軸・台本の出典）

## 絶対ルール（CONSTRAINTS.md）
- 全AIキーBYOK。サーバーキーをユーザー操作のフォールバックに使わない。
- 声クローンは本人の声のみ＋生成前同意。顧客の声はクローンしない（汎用声）。
- 声見本はオンデマンド＋DBキャッシュ（2回目0円）。バックグラウンド全件生成禁止。
- 既存機能を壊さない（変更前テスト）。LLM機能は実装前にコスト試算を提示。

## 納品時メモ
- data.db初期化(テストユーザー除去)、ADMIN_EMAIL/SITE_URL/SMTP/ドメインを根宜さんのものへ、声クローンflag判断。本番化チェックリストは docs/DEPLOY_GCP.md。
- 納品時は.envを空にして渡し、クライアントが自分のAPIキーを設定する（BYOK）。
