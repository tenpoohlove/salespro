# 引き継ぎファイル — p3 セールスアドバイザー
最終更新: 2026-05-29

---

## プロジェクト概要
セールス素材（動画・音声・スライド・LPなど）を入力すると成約率向上のための分析レポートをAIが生成するWebツール。
クライアント（根宜さん案件・株式会社オニオンリンク）向けに開発・納品予定。
クライアントはさらに複数人に販売・無料配布する想定 → 登録制でリスト取得が目的。

## リポジトリ
- GitHub: https://github.com/tenpoohlove/salespro.git
- ローカル: C:\Users\長沼有香\OneDrive\デスクトップ\dev\ｐ3
- ブランチ: main

## 起動方法
```
cd "C:\Users\長沼有香\OneDrive\デスクトップ\dev\ｐ3"
npm run dev
```
ブラウザで http://localhost:3000 を開く。

**重要:** tsx watch は .env の変更を検知しない。.env を変更したらサーバーを手動再起動すること。

---

## 現在の技術スタック
- Node.js + Express + TypeScript（tsx で実行）
- SSE（Server-Sent Events）でAI応答をストリーミング
- 分析AI: Anthropic claude-sonnet-4-6（PROVIDER=anthropic）
- 文字起こし: OpenAI Whisper API（whisper-1）
- 認証: Cookie ベースセッション（bcryptjs + SQLite）
- DB: SQLite（better-sqlite3）、ファイル: data.db
- multer（ファイルアップロード）
- express-rate-limit（レート制限）
- DOMPurify + marked（XSS対策済みMarkdownレンダリング）
- nodemailer（メール確認機能）

## .env 設定
```
PROVIDER=anthropic
PORT=3000
ADMIN_EMAIL=admin@salespro.com   ← このメールで登録した人が管理者になる

# メール確認 (Gmail SMTPを使う場合)
# Googleアカウント → セキュリティ → 2段階認証ON → アプリパスワード で16文字のパスワードを発行
# SMTP_HOST=smtp.gmail.com
# SMTP_PORT=587
# SMTP_USER=your-gmail@gmail.com
# SMTP_PASS=xxxx xxxx xxxx xxxx
# SITE_URL=http://localhost:3000
```
※ SMTP未設定時はコンソールに確認リンクを出力（開発用）
※ APIキーは .env には書かない（BYOK方式でDBに保存）

---

## 2026-05-29 に実装したこと

### 1. メールアドレス確認機能（メール認証）
- nodemailer を追加（npm install nodemailer @types/nodemailer）
- users テーブルに is_verified カラムを追加
  - 既存ユーザー: ALTER TABLE で DEFAULT 1（自動確認）
  - 新規ユーザー: DEFAULT 0（メール確認必須）
  - 管理者（ADMIN_EMAIL一致）: 自動で is_verified = 1
- email_verifications テーブルを追加（id / user_id / token / expires_at）
- src/email.ts 新規作成（sendVerificationEmail 関数）
- 登録フロー変更:
  - 一般ユーザー: 登録 → 確認メール送信 → セッション作成しない → { needsVerification: true }
  - 管理者: 登録 → 即セッション作成（従来通り）
- ログインフロー変更:
  - is_verified = 0 のユーザーはログイン不可（code: 'EMAIL_NOT_VERIFIED'）
- 新規エンドポイント:
  - GET /api/auth/verify-email?token=...&userId=... （確認リンク）
  - POST /api/auth/resend-verification （確認メール再送）
- public/verify-email.html 新規作成（確認リンクのハンドリングページ）
- signup.html 更新: 登録成功後に「確認メール送信済み」画面を表示、再送信ボタンあり
- login.html 更新: メール未確認エラー時に「再送信」リンクを表示

### 2. APIキーをDBに保存（ユーザーごと・デバイス間引き継ぎ）
- user_api_keys テーブルを追加（user_id / anthropic_key / openai_key / updated_at）
- 新規エンドポイント:
  - GET /api/user/api-keys （ログイン中ユーザーのキー取得）
  - POST /api/user/api-keys （キー保存・更新）
- index.html 更新:
  - checkAuth() 内でDBからAPIキーをlocalStorageに自動同期
  - saveApiKey() / saveOpenAIKey() でlocalStorage + DB両方に保存
  - → どのデバイスからログインしても同じキーが使える

---

## DBスキーマ（SQLite: data.db）
- users: id / email / password_hash / name / phone / is_admin / is_verified / enabled / created_at
- sessions: id / user_id / token / expires_at / created_at
- email_verifications: id / user_id / token / expires_at / created_at
- user_api_keys: user_id / anthropic_key / openai_key / updated_at

---

## 管理者ユーザーの作り方
1. .env に ADMIN_EMAIL=メールアドレス を設定
2. サーバー再起動
3. そのメールアドレスでサインアップ → 自動で管理者・確認済みになる

---

## 次回やること

### 最優先: デプロイ先の確定（根宜さんへの確認待ち）
根宜さんに以下を確認中:
- 動画をそのままアップロードして文字起こし→分析が必要か？
- テキスト貼り付けだけでOKか？

結果によって：
- 動画アップロードが必要 → Railway（$5/月）でデプロイ
- テキストだけでOK → Vercelでも可能だがSQLite問題あり、要検討

### Railwayでデプロイする場合の手順
1. Railway のアカウント作成（長沼さんのアカウントで開発中は無料枠）
2. GitHubと連携してデプロイ
3. 環境変数設定（PROVIDER / PORT / ADMIN_EMAIL / SMTP設定）
4. SQLite の永続ディスク（Persistent Volume）を有効化
5. 動作確認
6. 納品時に根宜さんのアカウントに移管

### 本番前に必ずやること
- data.db を削除してテストユーザーをリセット（文字化けユーザーが残っている）
- ADMIN_EMAIL を根宜さんのメールアドレスに変更
- SITE_URL を本番URLに変更（確認メールのリンク先）
- SMTP設定（Gmail アプリパスワード）を設定

---

## 実装状況サマリー
- 分析（通常モード）: 完成
- 分析（比較モード）: 完成
- ファイルアップロード（PDF/PPTX/DOCX/画像/テキスト）: 完成
- 動画・音声の自動文字起こし: 完成（25MB制限あり）
- URLからテキスト取得: 完成
- 分析履歴（localStorage）: 完成
- Constitutional Review（品質審査）: 完成
- APIキー設定モーダル（BYOK・DB保存）: 完成
- ユーザー登録・ログイン・セッション管理: 完成
- メールアドレス確認機能: 完成
- APIキーをDBに保存（デバイス間引き継ぎ）: 完成
- 管理者ページ（一覧・有効化/無効化・CSV）: 完成
- デプロイ: 未実装（根宜さんへの確認待ち）

---

## 注意事項
- tsx watch は .env の変更を検知しない → 変更後は手動再起動
- 動画は25MB以下のみ対応。超える場合はVLC/QuickTimeでmp3に変換
- .gitignore に .env と data.db が含まれていることを確認済み
- data.db はサーバー上に残るため、Railway では persistent disk を有効にすること
- テスト用ユーザーが data.db に残っている → 本番前に data.db を削除してリセット
