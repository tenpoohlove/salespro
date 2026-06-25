# 引き継ぎ — Pitch Navi（商談クロージング添削＋本人声の理想クロージング）

このファイルだけ読めば再開できます。**過去の詳細ログは git 履歴に全部残っています**（このノートには「今の確定状態」と「次の一手」だけ書く方針）。

---

## 🟢 現在の確定状態（2026-06-26・実地で事実確認済み）

唯一の正。**コミットHEAD番号を書き換えたら必ずここも更新する**（HEADと本文がズレると再開時に長考の原因になる）。下記が事実：

- **コード最終コミット = 声の名前付き保存・選択（複数管理）**。**本番に反映済み**。直前に「お手本音声のリアル化（間・抑揚・対話/語り2モード）＋声設定UIを評価の上へ移動」も反映済み。
  - 声リアル化: Fishに `s2.1-pro`/`temperature0.88`/`top_p0.85`/`prosody.speed0.92`（emotionは存在しないため不追加）。台本に `[pause]`/`[低い声で]` 等のタグと独自記法 `[[SILENCE:ms]]`（ffmpegで無音挿入）を埋め込み。お手本は「対話版（営業=本人声＋客=汎用声）／語り版（営業の語りのみ・客は間で表現）」の2モード。`#voicePanel` を `#output` の上へ移動。
  - 声の保存: `voice_profiles` テーブルで本人の声を名前付きで複数保存・選択（次回アップ不要）。CRUD=`/api/voice/profiles`(GET/POST/PATCH/DELETE)。旧 `voice_samples`(1件)は「保存した声」へ冪等移行済み。保存済み利用時はアップ・再同意不要。お手本/各生成は `voiceProfileId` 解決を `resolveVoiceId()` で共通化。
  - 声の試聴: 保存済みの声に「この声を試聴」ボタン＋登録直後に自動試聴（固定セリフを語り版＝AI無しで再生）。`previewVoiceProfile()`。
  - 対話版お手本: ポイント別「お手本を聞く」の対話版は、お手本セリフ1行から `generateSampleDialogue()` で掛け合いをAI生成し2声合成（語り版は営業1声）。対話版はクライアントが Anthropic キーも送る。キャッシュキーに客声＋文脈も含め2回目0円維持。
  - 対話のクオリティUP: `buildSampleDialoguePrompt(line, context)` に商談文脈（添削レポート/文字起こし/備考）＋`IDEAL_CLOSING_BENCHMARKS` を注入し、6〜10行・各営業セリフに言い方タグ＋間を必須化。say-line がクライアントから `analysis`/`transcript`/`context` を受け取り渡す。
  - 客の声を1声に固定: Fishは `reference_id` 必須・`seed` 無しのため、客声を空にすると毎回別の声＝老若男女バラバラだった。`resolveCustomerVoiceId(gender, fishKey)` が Fishの人気日本語ボイス(`GET /model?sort_by=score&language=ja`、`fetchTopVoiceId`)を男女1声ずつ自動選定し `app_settings`(`customer_voice_female`/`customer_voice_male`)へ固定保存（以降同じ声）。env `CUSTOMER_VOICE_FEMALE/MALE` でも上書き可。UIは対話版のときだけ「お客様の声(女性/男性)」を選べる。
  - 誤読防止: 掛け合い生成で固有名詞(人名/社名/難読語)を禁止し「お客様/御社」に統一。
  - 変な終わり方: 締めは営業の言い切りで終える指示＋`max_tokens 1600`＋`tidyDialogueScript()` で途中切れの末尾行を除去。
  - 仕様書: `docs/SPEC_voice_realism.md`。テスト `tests/unit/voice_realism.test.ts`（`npm test` 全55件通過）。セッション詳細ログ: `docs/session_2026-06-26.md`。
  - ⚠️**運用ルール**: HEADの“具体的なハッシュ”はここに書かない（コミットの度にズレて長考の原因になるため）。判断は常に **「ローカル == origin/main で一致しているか」＋「コード最終コミットが本番に反映済みか」** の2点だけで行う。
- **ローカル == GitHub `origin/main`**（✅ 常に push して一致させる運用。確認: `git status -sb` が ahead/behind なし）。
- **本番VM = 最新反映済み（✅デプロイ完了）**。本番index に「重要ポイント／お手本／理想クロージング」が表示され、`/api/health` = `status:ok` / `featureVoiceClone:true`。新レポート型＋声クローンとも本番で稼働中。
- **未コミット変更 = なし（作業ツリー完全クリーン）**。CRLF↔LFノイズは `.gitattributes` で恒久対策済み。

### ▶ 次の一手（明日ここから）
**デプロイ系タスクは無し（本番＝最新で反映済み）。最優先＝声まわりの「耳での確認」**（ゆかたん本人のFish/Anthropicキー＋声サンプルが要るBYOK作業のため未実施）。本番 https://pitchnavi.8-231-192-187.sslip.io にログイン→「キー設定」でFish/Anthropicキー→「声の準備」で声を名前付き保存（自動で試し聞きが鳴る）→分析→各「お手本を聞く」で確認：
1. **対話版**：客の声が毎回「同じ1人」になっているか（女性/男性切替も）。固有名詞の誤読が減ったか。会話がきりよく終わるか。中身がその商談に即して濃いか。
2. **語り版**：営業の語り＋間で対話が想像できるか。
3. もし**客の男女が合っていない／声質が好みでない**なら、Fishで選んだ好きな声IDに差し替える＝管理画面に「お客様の声ID設定」欄を追加する（未実装・次の候補タスク）。暫定の手動差し替えは本番DBの `app_settings` の `customer_voice_female` / `customer_voice_male` を上書き、または `.env.deploy` に `CUSTOMER_VOICE_FEMALE/MALE` を設定。
4. 声の品質が物足りなければ `src/voice.ts` の `temperature(0.88)`/`prosody.speed(0.92)`、`src/closing.ts` の掛け合いプロンプト/モデル(Opus化)で追い込む。

その後の残タスクは下記「残りの製品タスク」の B/C/納品切替/APIキー再発行。

参考: 再デプロイが必要になった時の手順（push 後にVMを再ビルド）
```
# 1. VMで最新取り込み＆再ビルド（バックグラウンド・冪等）
gcloud compute ssh pitch-navi-vm --zone=us-west1-a --project pitch-navi --quiet \
  --command="sudo bash -c 'setsid bash /tmp/vm-setup.sh >/tmp/setup.log 2>&1 </dev/null &'"
# 2. ビルド後に声フラグを戻す（vm-setup.sh は FEATURE_VOICE_CLONE=false に戻すため）
#   cd /opt/p3 && sudo sed -i 's/^FEATURE_VOICE_CLONE=.*/FEATURE_VOICE_CLONE=true/' .env.deploy && sudo docker compose --env-file .env.deploy up -d
# 3. 確認
curl -s https://pitchnavi.8-231-192-187.sslip.io/api/health
```

---

## 残りの製品タスク
0. **「耳での最終確認」（声リアル化＋2モード＋声の保存）**（本番反映済み・未試聴）。本番にゆかたん本人でログイン→Fish/Anthropicキー設定(BYOK)→「声の準備」で名前を付けて声を保存→以降は保存した声を選ぶだけ→「対話版」「語り版」をそれぞれ生成し、①クロージング質問・価格の後に沈黙が入るか ②語尾が下がって言い切れているか／一本調子でないか ③語り版で客の声が無く間で対話が想像できるか を確認。あわせて声の保存/選択/リネーム/削除が効くか確認。違和感あれば `prosody.speed` や `temperature`（src/voice.ts）を微調整。
1. ✅ **新レポート型添削の本番動作確認 — 完了**（2026-06-26 本番indexに重要ポイント/お手本/理想クロージング表示・声フラグtrue を確認）。
2. **(B) 声見本ボタンの切り分け**（押せない/案内が緑にならない件・ゆかたん回答待ちで据え置き）。`generateVoiceSample`/`generateFullClosing`（public/index.html）。
3. **(C) 実音声 試聴の品質確認**：安い順に「短い見本(1-2分)→5分→10/30/45/60分」。コスト目安は下記。
4. **納品切替（根宜さんへ）**：SMTPを根宜さんのアドレスへ／`ADMIN_EMAIL`を根宜さんへ／正式サブドメインへ付替／`data.db`初期化／声クローンflag判断。手順 `docs/DEPLOY_GCP.md`。
5. **(リマインド)** 検証で使った Anthropic APIキーがチャット履歴に平文露出 → 未対応なら console.anthropic.com で再発行。

---

## このプロジェクトは何か
セールスのZoomクロージング商談を分析・添削し、さらに「本人の声」で“理想クロージング”を音声生成して返すWebツール「**Pitch Navi**」。クライアント＝根宜さん(株式会社オニオンリンク)へ納品。登録制・全AIキーBYOK（利用者負担）。
技術: Node/Express/TypeScript(tsx)/SSE/SQLite(better-sqlite3)/Fish Audio/Anthropic/OpenAI Whisper/nodemailer/Caddy。

## 起動・テスト
- 開発: `npm run dev`（http://localhost:3000）。声クローン込み: `FEATURE_VOICE_CLONE=true npm run dev`
- テスト: `npm test`（vitest）／型: `npx tsc --noEmit`／ビルド: `npm run build`
- ポート競合: `netstat -ano | grep ':3000' | grep LISTENING` → `taskkill //PID <pid> //F`

## 本番環境
- 公開URL: **https://pitchnavi.8-231-192-187.sslip.io**
- GCP: project `pitch-navi`（owner=negigon@gmail.com / editor=tenpoohlove@gmail.com・課金有効）
- VM: `pitch-navi-vm`（e2-micro / us-west1-a / Debian12 / 無料枠）・静的IP **8.231.192.187**・FW 80/443開放
- 構成: Docker Compose（app=Node/Express + caddy=自動HTTPS）。SQLiteは volume `p3_p3data` に永続。ドメインは sslip.io 方式。
- フラグ: `FEATURE_VOICE_CLONE=true` / `ADMIN_EMAIL=tenpoohlove@gmail.com`（このメールで登録すると確認メール不要で即管理者）
- SMTP: 本番DBの app_settings に設定済（smtp.gmail.com / tenpoohlove@gmail.com / アプリパスワード）
- gcloud: ローカル導入＆`auth login`済(tenpoohlove)。Win版パス `C:\Users\長沼有香\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd`

## デプロイのハマりどころ
- gcloud(Windows)はSSHにPuTTY(.ppk)を使う。鍵が壊れたら `~/.ssh/google_compute_engine*` を消して `gcloud compute ssh ... --quiet` で再生成（空パスフレーズ）。
- 長時間SSHは plink が切れる → 重い処理はVM側で `setsid ... &`、SSHは即切る。状態確認は短いコマンドで。
- e2-microはディスク遅く初回ビルド約5分（2回目はキャッシュで速い）。
- `vm-setup.sh` は `git reset --hard origin/main` + `docker compose up -d --build` を実行し、.env.deploy を `FEATURE_VOICE_CLONE=false` で再生成する → **ビルド後に必ず true へ戻す**（上記コマンド2）。

## フル尺・理想クロージングの仕組み
入力(商談音声＋文字起こし＋添削＋備考＋理想基準＋客の性別)→ ①Whisper文字起こし ②Claude添削 ③Claudeでフル尺台本(6章分割生成) ④Fishで2声音声化(営業=本人クローン/客=汎用声)を1本に連結。バックグラウンドjob(`/api/voice/generate-full`→jobId, `/job/:id`進捗, `/audio/:id`配信)・キー非保存・所有者チェック。
**コスト**（1回・BYOK・2回目以降キャッシュ0円・$1=150円）: 約5分≈20〜30円 / 30分≈140円 / 45分≈205円 / 60分≈270円。

## 主要ファイル
- `src/server.ts` … 全エンドポイント（auth/api-keys/admin/analyze[SSE]/voice/health・本番trust proxy）
- `src/closing.ts` … 理想クロージング生成（短/フル尺・CLOSING_SECTIONS・targetCharsForMinutes・synthesizeDialogue）
- `src/prompts.ts` … 添削プロンプト（MEDDPICC/Gong/Challenger・リサーチベース）
- `src/voice.ts` … Fish Audioアダプタ（キー無し/DRY_RUNでMock）
- `src/analyze.ts` / `src/db.ts`（SQLite・getSetting/setSetting）/ `src/email.ts`（SMTPはDB優先>env）/ `src/auth.ts`
- `public/index.html` … 分析UI＋キー設定＋声クローンUI（尺5/10/30/45/60分・進捗バー）
- `public/howto.html` / `admin.html` / `admin-users.html` / `login.html` / `signup.html` / `terms.html` / `verify-email.html`
- 設定: `docker-compose.yml` `Caddyfile` `scripts/vm-setup.sh` `scripts/redeploy.sh` `docs/DEPLOY_GCP.md` `docs/API_KEY_GUIDE.md` `CONSTRAINTS.md`
- リサーチ: `research/closing_evaluation_criteria_report.md`（評価軸・台本の出典）

## 絶対ルール（CONSTRAINTS.md）
- 全AIキーBYOK。サーバーキーをユーザー操作のフォールバックに使わない。
- 声クローンは本人の声のみ＋生成前同意。顧客の声はクローンしない（汎用声）。
- 声見本はオンデマンド＋DBキャッシュ（2回目0円）。バックグラウンド全件生成禁止。
- 既存機能を壊さない（変更前テスト）。LLM機能は実装前にコスト試算を提示。
