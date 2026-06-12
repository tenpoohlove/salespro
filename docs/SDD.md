# 設計書 (SDD) — p3 SalesPro
IEEE 1016 準拠 / 版 1.0 / 2026-06-12 / 対応SRS: docs/SRS.md

## 1. 論理ビュー（モジュール構成）
既存(src/)＋新規(★):
```
src/
  server.ts        Expressエンドポイント・SSE・認証ミドルウェア
  analyze.ts       Claude分析(analyzeContent/compareContent) ← ★評価軸を商談向けに改修
  prompts.ts       プロンプト定義 ← ★商談クロージング評価軸を追加(SYSTEM_PROMPT分岐)
  extractors.ts    ファイル→テキスト/画像抽出
  auth.ts          セッション/認可
  db.ts            SQLiteスキーマ ← ★fish_key/voice_samples/audio_cache/reference_baselines 追加
  email.ts         メール確認
  ★voice.ts        声クローンProviderアダプタ(Fish Audio実装・DRY_RUN対応)
  ★closing.ts      理想クロージング台本生成 + 本人声サンプル抽出オーケストレーション
public/
  index.html       ★声見本UI(生成ボタン/音声プレイヤー/Fishキー入力/基準アップロード)追加
  ★（既存5画面は維持）
Dockerfile         ★新規(GCP VM用)
```

## 2. プロセスビュー（主要フロー）
**声見本生成フロー(FR-VOICE)**:
1. ユーザーが商談音声アップ → /api/transcribe(既存Whisper)で文字起こし
2. /api/analyze(改修) → FR-DATA-012評価軸＋(任意)FR-DATA-013基準で添削＋FR-DATA-010非言語補足
3. ユーザーが「理想クロージング音声見本」実行 → closing.ts:
   a. FR-DATA-011: Claudeで理想クロージング台本生成
   b. FR-VOICE-001: アップ音声から本人声サンプル(10秒+)抽出
   c. FR-VOICE-002: voice.ts→Fish AudioでvoiceID作成(DBキャッシュ)
   d. FR-VOICE-003: voiceID＋台本→Fish Audio TTS→mp3
   e. FR-VOICE-004: (voiceID+台本hash)でaudio_cache照合、ヒットならAPI呼ばずに返す
4. mp3をユーザーに返却・プレイヤーで再生

## 3. データビュー（スキーマ追加）
```sql
ALTER TABLE user_api_keys ADD COLUMN fish_key TEXT;           -- FR-USR-002
CREATE TABLE voice_samples(                                    -- DATA-004
  user_id TEXT PRIMARY KEY, fish_voice_id TEXT, created_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE audio_cache(                                      -- DATA-005
  cache_key TEXT PRIMARY KEY,   -- sha256(voiceID + 台本)
  audio_path TEXT, created_at TEXT);
CREATE TABLE reference_baselines(                              -- DATA-006(FR-DATA-013)
  id TEXT PRIMARY KEY, user_id TEXT, kind TEXT,  -- 'script'|'manual'
  content TEXT, created_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
```
- 保存先: SQLite(GCP VM永続ディスク /var/p3/data.db)。生成mp3は /var/p3/audio/ にキャッシュ、一時アップ音声は処理後削除。

## 4. 物理ビュー（GCPデプロイ / FR-SYS-001）
- GCP Compute Engine **e2-micro**(Always Free, USリージョン) / Ubuntu / Node 18+。
- 永続ディスク30GB(無料枠)に data.db と audio/ を配置(DB_PATH/AUDIO_DIR環境変数)。
- Dockerfile でコンテナ化 or 直接 `npm run start`。ポート3000、リバースプロキシ(任意)。
- 環境変数: PORT/ADMIN_EMAIL/SITE_URL/DB_PATH/AUDIO_DIR/SMTP_*。**APIキーは.envに書かない(BYOK)**。
- SSEはVM常時起動で問題なし(Cloud RunのLB越し不具合を回避: EV-RES1)。

## 5. 外部連携設計（アダプタ＋DRY_RUN）
- **VoiceProvider インターフェース**(voice.ts): `createVoiceId(sample, key)` / `synthesize(voiceId, text, key)`。
  - 実装1: FishAudioProvider(本番)。実装2: MockProvider(DRY_RUN=trueやテスト時。APIキー無しで全テスト通過: 黄金ルール対応)。
  - `DRY_RUN`環境変数 or キー未設定時は自動Mock。→ 課金/外部送信を安全制御(黄金ルール#3)。
- 既存Claude/Whisperも同様にBYOKヘッダー(X-Anthropic-Key/X-OpenAI-Key/★X-Fish-Key)。サーバー保存キーをフォールバックに使わない(SEC-001)。

## 6. ADR（設計判断記録）
- **ADR-001 声クローン=Fish Audio**: 日本語品質首位＋最安(EV-RES1)。Provider抽象化でMiniMaxに差替可(NFR-EXT-001)。
- **ADR-002 GCP=Compute Engine VM(not Cloud Run)**: SSE安定＋SQLite継続でDB移行不要(EV-RES1/2)。
- **ADR-003 評価軸=商談会話向けに再設計＋ハイブリッド基準**: コピー評価10要素と分離。デフォルト世界標準軸＋任意ユーザー基準(EV-RES3, FR-DATA-012/013)。
- **ADR-004 全AIキーBYOK・キャッシュ必須**: オーナー課金ゼロ(EV-RULE)。audio_cache/voice_samplesで2回目0円。
- **ADR-005 声クローンは本人同意必須**: なりすまし防止(SEC-002)。生成前同意UI。

## 7. トレーサビリティ（要件→モジュール→テスト）
| FR | モジュール | TC |
|---|---|---|
| FR-DATA-012/013 | prompts.ts, analyze.ts | TC-DATA-012/013 |
| FR-DATA-010/011 | prompts.ts, analyze.ts, closing.ts | TC-DATA-010/011 |
| FR-VOICE-001 | closing.ts | TC-VOICE-001 |
| FR-VOICE-002 | voice.ts, db.ts | TC-VOICE-002 |
| FR-VOICE-003 | voice.ts, closing.ts | TC-VOICE-003 |
| FR-VOICE-004 | db.ts(audio_cache) | TC-VOICE-004 |
| FR-USR-002 | server.ts, db.ts | TC-USR-002 |
| FR-SYS-001/002 | Dockerfile, server.ts(env) | TC-SYS-001/002 |
