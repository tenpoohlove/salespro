# GCPデプロイ手順書（p3 SalesPro）

根宜さんのGoogle Cloudアカウントに、このツールを公開するための手順。
**前提**: 根宜さんが ① GCPアカウント作成 ② 支払い設定 ③ ゆかたん(tenpoohlove@gmail.com)をオーナー権限で招待 を済ませていること。

構成: **Compute Engine VM 1台** に Docker で `app`(Node/Express) と `caddy`(自動HTTPS) を載せる。SQLiteはVMの永続ディスクにそのまま継続（DB移行不要）。

---

## 0. 事前に決めておくもの
- **公開ドメイン**（例 `salespro.example.com`）。HTTPSにはドメインがほぼ必須（Caddyが無料証明書を自動取得）。根宜さんが持っているドメインのサブドメインを1つもらうのが楽。
- **管理者メール**（最初に管理者になる人。根宜さん or ゆかたん）。

> ドメインが用意できない場合はIPアドレス直打ち(HTTP)になり、ログインのパスワードが暗号化されないため非推奨。まずサブドメイン1つを確保するのが安全。

---

## 1. VMを作る（無料枠 e2-micro）
GCPコンソール → Compute Engine → 「インスタンスを作成」。

- リージョン: **us-west1 / us-central1 / us-east1 のいずれか**（e2-microのAlways Free無料枠はこの3つだけ）
- マシンタイプ: **e2-micro**
- ブートディスク: **Debian 12**、サイズ **30GB**（標準永続ディスクは30GBまで無料）
- ファイアウォール: **「HTTPトラフィックを許可」「HTTPSトラフィックを許可」両方にチェック**
- 外部IP: 後でドメインを向けるので **静的IPに昇格**しておく（VPCネットワーク→IPアドレス→エフェメラルを静的に予約）

作成後、表示される**外部IP**を控える。

## 2. ドメインをVMに向ける
ドメイン管理画面で **Aレコード** を追加: `salespro.example.com → VMの外部IP`。
反映確認（数分〜十数分）: `nslookup salespro.example.com` でVMのIPが返ればOK。

## 3. VMにログインしてDockerを入れる
コンソールのVM一覧 → 「SSH」ボタンでブラウザSSHを開く。

```bash
# このリポジトリの scripts/gcp-vm-bootstrap.sh の中身を実行（Docker導入＋/opt/p3作成）
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"
sudo mkdir -p /opt/p3 && sudo chown "$USER":"$USER" /opt/p3
exit   # ← dockerグループ反映のため一度ログアウト
```
再度SSHで入り直す。

## 4. アプリ一式をVMに置く
GitHubに上がっているのでcloneが楽（プライベートならデプロイキー or PAT）:
```bash
cd /opt/p3
git clone <このリポジトリのURL> .
```
（git未使用なら手元から `gcloud compute scp` か、SSH画面の歯車→ファイルアップロードでzipを送る）

## 5. 環境変数を設定
```bash
cd /opt/p3
cp .env.deploy.example .env.deploy
nano .env.deploy   # DOMAIN / SITE_URL / ADMIN_EMAIL / (任意)SMTP を編集
```
- `DOMAIN=salespro.example.com`
- `SITE_URL=https://salespro.example.com`
- `ADMIN_EMAIL=` 管理者にするメール
- `FEATURE_VOICE_CLONE=false`（声クローンは実音声で品質確認できるまでoff推奨）
- SMTPは任意（未設定でも動くが、メール確認リンクがログ出力になる。本番運用するなら設定推奨）

## 6. 起動
```bash
docker compose --env-file .env.deploy up -d --build
docker compose logs -f app     # 「🚀 セールスアドバイザー起動中」が出ればOK。Ctrl+Cでログ閲覧終了
```
ブラウザで `https://salespro.example.com` を開く → ログイン画面が出れば成功（証明書取得に初回数十秒かかることあり）。

## 7. 動作確認（必ず実施）
1. `ADMIN_EMAIL` に設定したメールで新規登録 → そのアカウントは自動で管理者・確認済みになる。
2. ログイン → APIキー（自分のAnthropicキー）を入力 → 短いテキストで分析が走るか。
3. 分析タイプを「商談クロージング評価」に切替 → MEDDPICC等の評価が返るか。
4. （flag ON時のみ）声クローンの動作。

---

## 運用：更新・バックアップ・ログ

**コード更新時の再デプロイ:**
```bash
cd /opt/p3 && git pull
docker compose --env-file .env.deploy up -d --build
```

**バックアップ（SQLite＋音声）:** データは Docker volume `p3data`（VM内 `/var/lib/docker/volumes/...`）。定期バックアップ例:
```bash
docker run --rm -v p3_p3data:/data -v /opt/p3/backup:/backup busybox \
  tar czf /backup/p3-$(date +%F).tar.gz -C /data .
```
（volume名は `docker volume ls` で確認。`<compose プロジェクト名>_p3data`）

**ログ:** `docker compose logs --tail=100 app` / `docker compose logs caddy`

**停止/再起動:** `docker compose down` / `docker compose --env-file .env.deploy up -d`

---

## 本番化チェックリスト（公開前）
- [ ] `data.db` がまっさら（開発用テストユーザーが入っていない）。cloneした新規VMなら自然と空。手元のdata.dbを誤って持ち込まないこと（.dockerignore済だが scp に注意）
- [ ] `ADMIN_EMAIL` を本番の管理者に設定した
- [ ] `SITE_URL` が本番ドメイン（メール確認リンクが正しく届く）
- [ ] HTTPSで開ける（Caddy証明書取得OK）。`NODE_ENV=production` でcookieがSecureになる（compose設定済）
- [ ] SMTPを設定したか、ログ出力運用で割り切るか決めた
- [ ] 声クローン(FEATURE_VOICE_CLONE)を有効化するか決めた（実音声で品質確認後にtrue）
- [ ] APIキーは一切サーバーに置いていない（全てBYOK）

## トラブル時
- 証明書が取れない → ドメインのAレコードがVMのIPを指しているか、80/443が開いているか確認
- ビルドが重い/落ちる → e2-microはメモリ1GB。`docker compose build` がOOMするなら一時的にスワップを足す: `sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile`
- レート制限が全員に効く → `NODE_ENV=production` が効いているか（trust proxy が有効になる）
