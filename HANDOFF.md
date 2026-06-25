# 引き継ぎ — Pitch Navi（商談クロージング添削＋本人声の理想クロージング）

このファイルだけ読めば再開できます。**過去の詳細ログは git 履歴に全部残っています**（このノートには「今の確定状態」と「次の一手」だけ書く方針）。

---

## 🟢 現在の確定状態（2026-06-26・実地で事実確認済み）

唯一の正。**コミットHEAD番号を書き換えたら必ずここも更新する**（HEADと本文がズレると再開時に長考の原因になる）。下記が事実：

- **コード最終コミット = `bd8db77`**（「添削＝重要ポイント3つのレポート型＋お手本セリフのピンポイント音声化」）。**これが本番に反映済みの製品コード**。以降に乗っているのは docs/chore のみ（.gitattributes・HANDOFF更新・調査ログ等）＝コードは変わっていない。
  - ⚠️**運用ルール**: HEADの“具体的なハッシュ”はここに書かない（コミットの度にズレて長考の原因になるため）。判断は常に **「ローカル == origin/main で一致しているか」＋「コード最終コミットが本番に反映済みか」** の2点だけで行う。
- **ローカル == GitHub `origin/main`**（✅ 常に push して一致させる運用。確認: `git status -sb` が ahead/behind なし）。
- **本番VM = 最新反映済み（✅デプロイ完了）**。本番index に「重要ポイント／お手本／理想クロージング」が表示され、`/api/health` = `status:ok` / `featureVoiceClone:true`。新レポート型＋声クローンとも本番で稼働中。
- **未コミット変更 = なし（作業ツリー完全クリーン）**。CRLF↔LFノイズは `.gitattributes` で恒久対策済み。

### ▶ 次の一手
**デプロイ系のタスクは無し（本番＝最新で反映済み）。** 残りは下記「残りの製品タスク」の B/C/納品切替/APIキー再発行。

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
