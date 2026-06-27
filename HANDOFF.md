# 引き継ぎ — Pitch Navi（商談クロージング添削＋本人声の理想クロージング）

このファイルだけ読めば再開できます。**過去の詳細ログは git 履歴に全部残っています**（このノートには「今の確定状態」と「次の一手」だけ書く方針）。

---

## 🟢 現在の確定状態（2026-06-27・実地で事実確認済み）

唯一の正。下記が事実：

- **コード最終コミット = 自動再生をやめる修正(I3)**。**本番に反映済み**。
- **本日2026-06-27は声の致命的バグの根本対処＋UI動線の根本見直し＋共有のための仕組みを 1日で全部本番反映した日**。
  - ホラー音声化(言語崩壊)を止める / 文間の謎の無音を消す / 公式声と客声の被り解消 / 履歴の別ページ化 / ヘッダー固定 / 分析と同時にお手本一括自動生成 / 読み取り専用共有URL / self-critic で外れ回を作り直し / 生成済みお手本は「お手本を聞く」ボタンが消える / 自動再生をやめて再生ボタンを押した時だけ鳴る…まで全部済み。
  - 詳細は `docs/session_2026-06-27.md` 参照。
- **コード最終コミット（旧表記の続き）= 声の名前付き保存・選択（複数管理）**。**本番に反映済み**。直前に「お手本音声のリアル化（間・抑揚・対話/語り2モード）＋声設定UIを評価の上へ移動」も反映済み。
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

### ▶ 次の一手（明日ここから・最優先）
**デプロイ系タスクは無し（本番＝最新で反映済み）。最優先＝「分析時間の目安」表示の実装（タスク#26 / J1）**。
そのあとに「耳での最終確認」(ゆかたん本人のFish/Anthropicキー＋声サンプルが要るBYOK作業)。

#### J2. 数字の読み誤り対策（新規・最優先級）
ゆかたん指摘：本人声・公式声いずれでも、台本中の算用数字（例「228万円」）が「ににはち万円」と桁を無視して読まれる。Fish s2.1-pro は日本語の数字をしばしば字面通り読む。
方針候補（実装時に1つ選ぶ）:
- 案A（コスト0・効きが穏やか）: `closing.ts` の `buildSampleDialoguePrompt` と `buildIdealClosingPrompt` に「数字は必ず日本語の読みで書け（228万円→にひゃくにじゅうはちまんえん／または200万円台と丸める）」を追加
- 案B（コスト0・効きが強い）: サーバ側でClaudeの出力をポストプロセス。算用数字＋単位を正規表現で抽出して読み下しに変換（228万円→「にひゃくにじゅうはち万円」）。
- 案C（最強・実装重い）: 専用の「読み仮名付与」プロンプトで台本全体を1回投げ直す。

最初は案A→効きが弱ければ案B、の順で。実装場所: `src/closing.ts` のプロンプト関数、または新規 `normalizeNumberReading()` 純粋関数。

#### J3. 生成音声の品質判定＋声の選定（新規・最優先級）
ゆかたん指摘：「ちょっと微妙に前より音声のクオリティが下がってる。音質とか文字の読み方とか」。
原因候補（要切り分け）:
1. 今日入れた `concatAudioTight()` の PCM 経由再エンコード（44.1kHz / 128kbps mp3）でビットレートが落ちている可能性
2. temperature 0.88→0.7 にしたことで「表情の多様性」が薄くなった（読み方が単調＝数字も誤読しやすい）
3. チャンク分割（180字）で1チャンクが短くなり文末イントネーションが取りにくい
4. Fish の人気声 index が時間経過で変わって「お客様声」「公式声」のキャッシュ内容が古くなった
5. self-critic 採点が「読み方の不自然さ」を見ていない（採点項目に line_used / line_count / specificity / delivery_tags / no_proper_nouns / ending しか無い）

切り分けの順序:
1. まず 4 を確認：`app_settings` の `customer_voice_female`/`customer_voice_male`/`official_voice_female_0..2`/`official_voice_male_0..2` を一度 NULL に戻して再取得させる（J2 と同じ起動時マイグレーションフラグで実行可能）
2. 次に 2 を切り戻し試験：temperature 0.7→0.78 / top_p 0.8→0.82 で再聴
3. 5 を埋める：critique 項目に「natural_reading（数字・固有名詞の読み方が自然か）」「audio_quality（耳での音質）」を追加（耳での音質はAIに採点不可なのでサーバ側ではダミー、UIで人間の星評価）
4. 「気に入った音声に⭐️」UIを追加してDBに保存→以降同じセリフは⭐️音声を優先キャッシュ

#### J1. 分析時間の目安を表示（新規・実装する）
本番でゆかたんが「分析だけで何分かかるか分からない」「お手本生成も含めるとさらに何分か分からない」と感じる体感を埋める。

実装方針（おおまかな指針・実装時に調整可）:
- 「クロージングを採点・添削する」ボタン押下→「分析中…（だいたい X 分前後）」を画面上部に表示
- 推定式（仮）: テキスト貼り付け文字数または文字起こし結果の長さから「分析=Lチャート / Constitutional Review=0.3L / お手本一括(チェックON時)=セリフ数×60秒/3並列」
- 既存の `progressStepper` の各ステップに「現在ステップの目安残り○秒」を併記する
- お手本一括は分析完了後にバックグラウンドで走るので、共有ボタン横バッジに「お手本生成中… N/M（あと約Y分）」を出す（バッジは既に存在＝updateBadge() を拡張するだけでOK）
- 参考実装位置：
  - `public/index.html` `startAnalysis()` の冒頭（statusBadge を表示するあたり）
  - `public/index.html` `generateAllSampleVoices()` の `updateBadge()` 関数

#### 耳での最終確認（J1の後・本人BYOK必要）
本番 https://pitchnavi.8-231-192-187.sslip.io にログイン→キー設定→「声の準備」で声を選択→分析→各「お手本」で確認：
1. 後半の文と文の間の「謎の無音」が消えたか（D1）
2. 1分過ぎ以降に「中国語化・ノイズ化（ホラー音声化）」が出ないか（A1）
3. 1回目「お手本を聞く」と2回目「再生成」で**冒頭から展開が変わる**か（D4）
4. self-critic で「外れ回」の頻度が体感下がったか（E1）
5. 本人＝公式声①と お客様＝女性 で**声が被らない**か（G3）
6. 生成済みお手本では「お手本を聞く」が消えて、音声プレイヤー＋「再生成」だけになっているか（I2）
7. 自動再生されず、再生ボタンを押した時だけ鳴るか（I3）

#### 共有URLの実機ひと往復
1. 分析→お手本自動生成完了→紫「📤 この結果を共有」を押す
2. 出た URL をシークレットウィンドウで開く（未ログインの相手の目線）
3. レポート＋お手本（生成済みのもの全部）が見えて聞ける、追加生成や声選択はできない、を確認

#### 履歴ページの動線
1. ヘッダー右上の緑「⏰ 分析履歴」リンク
2. /history で全件カードが見える、「開いて再表示」で `/?history=N` でメインに戻りレポートが復元される
3. 復元後にそのまま「再生成」「この結果を共有」が押せる

#### その後の残タスク
- 検証用 Anthropic APIキーの再発行（前々から残ってる懸案）
- 納品切替（根宜さんへ）：SMTP / ADMIN_EMAIL / 正式サブドメイン / data.db 初期化（docs/DEPLOY_GCP.md 参照）

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

## 残りの製品タスク（2026-06-27 更新）
- **J1（最優先・新規）**：分析時間の目安表示（上の「次の一手」参照）
- **「耳での最終確認」**（本番反映済み・未試聴・本人BYOK必要）：上の「次の一手」参照
- **(B) 声見本ボタンの切り分け**（押せない/案内が緑にならない件・据え置き）。`generateVoiceSample`/`generateFullClosing`（public/index.html）。**注意**：現在のメインフローは「分析と同時にお手本自動生成→再生成」に移行済みなので、(B)の優先度は下がっている。残骸コードとして public/index.html 内に `display:none` で温存されている。
- **(C) 実音声 試聴の品質確認**：安い順に「短い見本(1-2分)→5分→10/30/45/60分」。
- **納品切替（根宜さんへ）**：SMTPを根宜さんのアドレスへ／`ADMIN_EMAIL`を根宜さんへ／正式サブドメインへ付替／`data.db`初期化（**注意**：data.db初期化前に G3 マイグレーションフラグ `customer_voice_migrated_g3` が「none」（無し）の状態になるので、新規DBで初回利用時に公式声・お客様声がちゃんと別になることを確認しておく）／声クローンflag判断。手順 `docs/DEPLOY_GCP.md`。
- **(リマインド)** 検証で使った Anthropic APIキーがチャット履歴に平文露出 → 未対応なら console.anthropic.com で再発行。

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
