# リサーチ V2 — 確定/推奨/要注意

調査日: 2026-06-12 / V1の未解決点を深掘り

## 確定事項
1. **声クローン = Fish Audio 採用**（日本語品質首位・最安・10秒で即クローン）。代替: MiniMax（BYOKで両対応も可）。
2. **GCP = Compute Engine VM（e2-micro / Always Free枠）採用**。SSE無問題・**SQLite継続（DB移行不要）**・実質$0。
3. **声クローンAPIもBYOK**（ユーザーが自分のFish Audioキーを入れる。X-ヘッダー送信・サーバー非保存。既存のAnthropic/OpenAIキー方式と同じ仕組みを流用）。
4. 出力は**音声のみ**（動画/HeyGenはDEFER）。

## Fish Audio API 仕様（一次docs確認・実装用）
- 課金: TTS = **$15 / 100万UTF-8バイト**（s2-pro / s1）。ASR(文字起こし) = $0.36/音声時間。
- レート制限: 支払額に応じ 5〜50 並行リクエスト。
- クローン: ①zero-shot/instant clone（参照音声を都度渡す）と②「Create a Voice Clone」でvoice ID作成、の2方式あり。
  - **推奨: ②でユーザーごとにvoice IDを1回作成しキャッシュ** → 毎回参照音声を送らず安定＆高速。
- 認証方式・正確なエンドポイントは実装時(Phase3/6)に [API reference](https://docs.fish.audio/llms.txt) で確定。

## 推奨（設計に反映）
- アップ商談音声 → 既存Whisper文字起こし＋本人の声サンプル(10秒)抽出 → Fish Audioでvoice ID作成 → 理想クロージング台本(AI生成)を読み上げ → 音声見本としてユーザーに返す。
- voice ID・生成音声はDBキャッシュ（コスト最小化・グローバルルール準拠）。

## 追加リサーチ: 商談クロージングの評価軸（EV-RES3）
SPECレビューで「何を基準に評価するか」の穴を発見(テル先生も指摘)。世界的な商談評価フレームを調査:
- **BANT**(Budget/Authority/Need/Timeline)=基本的な見込み度評価
- **MEDDIC**(Metrics/Economic Buyer/Decision Criteria/Decision Process/Identify Pain/Champion)=複雑商談向けの厳密版
- **Pain Articulation(痛みの言語化)** を早期に行うほど成約率が上がる(2026年の通話統計)
- **Value Milestone / Value Scorecard**(Gong/Chorus等の会話インテリジェンスの手法)=15分までに価値到達したか
- 営業コーチング用スコアカード(25点ルーブリック)も存在
→ p3のクロージング評価軸は、既存のコピー評価10要素ではなく、上記の**商談会話向け軸**で再設計する。
- 出典: [Sales Call Coaching Scorecard 25-point](https://muchbetter.ai/blog/sales-call-coaching-scorecard-a-25-point-rubric-for-managers) / [Measure Sales Conversation Quality](https://demandzen.com/measure-sales-conversation-quality-effectiveness/)
- **方針=ハイブリッド**(ゆかたん確定): デフォルト=この世界標準軸 / 任意=ユーザーが理想トークスクリプト・商材マニュアルをアップしたら基準に加味。

## 要注意（RISK候補）
- RISK: 商談音声に複数話者→本人の声の抽出が必要（話者分離 or ユーザーに区間指定させる）。Phase3で方式決定。
- RISK: Fish Audioのレート制限（無料/低額枠は並行5）→ 同時多数ユーザーでキュー必要になりうる（MVPでは許容、DEFERでジョブ化）。
- RISK: 声クローンの悪用・本人同意（自分の声のみクローン可とする規約・同意UIをSEC要件に）。
- RISK: GCP無料枠はUSリージョン限定→日本からのレイテンシ。MVPは許容、必要なら東京リージョン(有料)へ。
