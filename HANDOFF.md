# 引き継ぎファイル — p3 セールスアドバイザー
作成日: 2026-05-27

---

## プロジェクト概要
セールス素材（動画・音声・スライド・LPなど）を入力すると成約率向上のための分析レポートをAIが生成するWebツール。
クライアント（根宜さん案件・株式会社オニオンリンク）向けに開発・納品予定。

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

---

## 現在の技術スタック
- Node.js + Express + TypeScript（tsx で実行）
- SSE（Server-Sent Events）でAI応答をストリーミング
- 分析AI: Anthropic claude-sonnet-4-6（PROVIDER=anthropic）
- 文字起こし: OpenAI Whisper API（whisper-1）
- multer（ファイルアップロード、メモリストレージ）
- express-rate-limit（レート制限）
- DOMPurify + marked（XSS対策済みMarkdownレンダリング）

## 現在の.env設定
```
PROVIDER=anthropic
PORT=3000
ANTHROPIC_API_KEY=（空 → ブラウザのバナーから入力）
OPENAI_API_KEY=（空 → ブラウザのバナーから入力）
```

---

## 今日（2026-05-27）やったこと

### 1. 動画・音声の自動文字起こし機能を追加
- .mp4 / .mov / .mp3 / .m4a / .wav / .ogg / .flac / .webm に対応
- ファイルをドロップすると自動でOpenAI Whisper APIに送信
- 文字起こし結果がテキストエリアに自動転記される
- ファイルリストに「文字起こし中...」→「✅ 文字起こし完了」の状態表示
- 25MB超の場合は明確なエラーメッセージ（VLC/QuickTimeでの変換手順も案内）
- multerに /api/transcribe 用の uploadMedia 設定を追加（200MBまで受付、チェックは25MB）

### 2. 分析エンジンをGroq → Anthropicに切り替え
- .envのPROVIDER=groq → PROVIDER=anthropic に変更
- 分析がclaude-sonnet-4-6で動くように（品質向上）
- Groqは安かったが品質が低め、Anthropicは約55円/回（30分動画の場合）

### 3. 文字起こしAPIをGroq → OpenAIに切り替え
- Whisperモデル自体は同品質（同じOpenAI Whisperベース）
- クライアントがOpenAIキーを持っているため切り替え
- /api/transcribe エンドポイントがOpenAI Whisper（whisper-1）を使うように変更

### 4. APIキー設定UIを2段構成に更新
- 上のバナー: Anthropicキー（sk-ant-...）→ 分析用
- 下のバナー: OpenAIキー（sk-...）→ 文字起こし用（緑色）
- /api/setup-openai エンドポイントを新規追加
- /api/health がhasOpenAIKeyを返すように更新

### 5. 「困ったときは」セクションをUIに追加
- 動画が25MB超の場合の変換手順（Windows: VLC / Mac: QuickTime）
- 文字起こし済みの場合の使い方
- エラー時の対処法
- URLから読み込む方法
- APIキー取得先リンク（Anthropic / OpenAI）

---

## 次回やること（優先順）

### 最優先: APIキー管理をBYOK（各自持ち込み）方式に変更
現在の問題:
- 今の設計は「1台のサーバーに1セットのAPIキー」
- クライアントが複数ユーザーに販売・配布する予定のため、全員がキーを共有してしまう
- .envへのキー書き込みはサーバーレス環境では消える

変更内容:
- ユーザーが入力したキーをサーバーの.envではなくブラウザのlocalStorageに保存する
- 分析・文字起こしリクエスト送信時にキーをリクエストヘッダーに乗せる
- サーバー側はヘッダーからキーを読み取って使う（保存しない）
- /api/setup・/api/setup-openai・writeEnvKey関数は不要になる

### 次に: デプロイ先を決めてデプロイ
検討事項:
- Vercelは4.5MBのファイルアップロード制限があり動画が使えない → NG
- Railwayを推奨（SSE・ファイルアップロード・Node.js全部そのまま動く、月$5）
- BYOKへの変更が完了してからデプロイするのが望ましい

### その後: クライアントの実動画でテスト
- 届いた動画ファイルでテスト（文字起こし → 分析の一連の流れ）
- 25MB制限にひっかかる場合はmp3変換が必要
- テスト完了後に納品

---

## 現在の実装状況サマリー
- 分析（通常モード）: ✅ 完成
- 分析（比較モード）: ✅ 完成
- ファイルアップロード（PDF/PPTX/DOCX/画像/テキスト）: ✅ 完成
- 動画・音声の自動文字起こし: ✅ 完成（25MB制限あり）
- URLからテキスト取得: ✅ 完成
- 分析履歴（localStorage）: ✅ 完成
- Constitutional Review（品質審査）: ✅ 完成
- APIキー設定バナー（ブラウザから設定）: ✅ 完成
- 「困ったときは」ヘルプセクション: ✅ 完成
- マルチユーザー対応（BYOK）: ❌ 未実装（次回）
- デプロイ: ❌ 未実装（次回）

---

## 注意事項
- tsx watch は .env の変更を検知しない。APIキーを変更したらサーバーを再起動すること
- 動画は25MB以下のみ対応。超える場合はVLC/QuickTimeでmp3に変換してもらう
- .gitignoreに.envが含まれていることを確認すること（APIキーをコミットしない）
