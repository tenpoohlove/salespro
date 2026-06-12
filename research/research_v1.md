# リサーチ V1 — p3 声クローン添削機能 / GCPデプロイ

調査日: 2026-06-12 / 版: 無料版（WebSearch中心） / 信頼度: A=一次/公式, B=準公式, C=二次, D=不確実

## 観点1: 声クローンの最適ツール（open_item #1, #2）

| ツール | 日本語品質 | コスト | クローン方式 | 信頼度 |
|---|---|---|---|---|
| **Fish Audio** | **盲検テストで日本語首位**（S2 Pro 3.12 / S1 3.02 ＞ ElevenLabs 1.88） | **API ~$15/100万UTF-8バイト**（≈日本語1000字で約7円） | 10秒サンプルで即時ゼロショットclone・処理30秒未満・<300msストリーミング・13言語 | B (公式blog/比較) |
| MiniMax | 日本語対応(50+言語) | clone $1.5/声 ＋ Speech-02 HD $0.10/1000字($100/1M)・Turbo $30/1M | 10秒〜5分サンプルでvoice ID生成・ノイズ除去/音量正規化付き | B (公式docs) |
| ElevenLabs | 日本語は弱い(1.88) | ~$165/1M字（高い） | — | C |

**結論（確定）**: **Fish Audio を第一候補に採用**。理由=①日本語品質が最高 ②最安（MiniMaxのTTSの約1/6〜1/12、ElevenLabsの約1/10）③10秒サンプルで即クローン＝アップ商談音声から自動抽出する設計と相性良い。MiniMaxを代替候補として残す（BYOKで両対応も可）。
- コスト試算: クロージング見本1本(日本語~1000字×UTF-8 3バイト=3000バイト) → Fish Audio約$0.045≈**約7円/本**。DBキャッシュで2回目0円。
- 出典: [Fish Audio盲検比較](https://fish.audio/blog/blind-tts-provider-comparison-2026/) / [Fish Audio料金](https://docs.fish.audio/developer-guide/models-pricing/pricing-and-rate-limits) / [MiniMax voice clone docs](https://platform.minimax.io/docs/guides/speech-voice-clone)

## 観点2: GCPデプロイ方式（open_item #3, #4）

| 方式 | SSE(ストリーミング) | SQLite | ファイルアップロード | 無料枠 | 信頼度 |
|---|---|---|---|---|---|
| **Compute Engine VM (e2-micro)** | ✅ 常時起動で問題なし | ✅ **そのまま使える（移行不要）** | ✅ | ✅ Always Free(US region・e2-micro 1台/月+30GBディスク) | A/B |
| Cloud Run | △ SSE対応だがLB越しで2026年に throttle/drop 報告・タイムアウト要延長 | ❌ ステートレス→消える（Firestore等へ移行必要） | △ サイズ制約 | ✅ 月次無料枠 | A (公式docs/forum) |

**結論（確定）**: **Compute Engine VM（e2-micro・Always Free枠）を採用**。理由=①p3はSSEを多用→VMなら無問題（Cloud RunはLB越しSSEに既知不具合）②**SQLiteをそのまま使える＝DB移行(Firestore化)が不要で実装が大幅に簡単**③Always Free枠で実質$0。
- → open_item #4（SQLite移行先）は「**移行しない・VMの永続ディスクでSQLite継続**」で解決。
- 出典: [Cloud Run SSE/WebSocket docs](https://docs.cloud.google.com/run/docs/triggering/websockets) / [Cloud Run SSE behind LB throttle報告](https://discuss.google.dev/t/cloud-run-serverless-neg-behind-global-https-lb-sse-streaming-connections-throttled-vs-direct-cloud-run-url/361659)

## 未解決→V2へ
- Fish Audio APIの認証方式・エンドポイント・instant cloneの具体API仕様（実装前に一次docs確認）
- 商談音声からの本人声・クロージング区間の抽出方法（open_item #5・Phase3設計で詰める）
