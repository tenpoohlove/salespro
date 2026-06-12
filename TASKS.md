# TASKS — p3 実装台帳（Phase 6b per-task）
更新: 2026-06-12 / 各タスク: RED→GREEN(flag裏)→レビュー→done

| T-ID | タスク | 対応FR | 状態 |
|---|---|---|---|
| T-001 | テスト基盤(vitest)導入＋既存純粋関数リグレッションテスト | NFR-MAINT-001, RISK-008 | done |
| T-002 | DB拡張(fish_key/voice_samples/audio_cache/reference_baselines) | FR-USR-002,VOICE-002/004,DATA-013 | done |
| T-003 | VoiceProviderアダプタ(voice.ts: Fish実装+Mock+DRY_RUN) | FR-VOICE-002/003 | done |
| T-004 | 評価軸プロンプト改修(商談クロージング軸+ハイブリッド基準+非言語補足) | FR-DATA-010/012/013 | done |
| T-005 | 理想クロージング台本生成(closing.ts) | FR-DATA-011 | done |
| T-006 | 本人声サンプル抽出(prepareVoiceSample) | FR-VOICE-001 | done |
| T-007 | 声見本生成エンドポイント+キャッシュ(/api/voice/generate-sample) | FR-VOICE-002/003/004 | done |
| T-008 | Fish key BYOKエンドポイント+UI(index.html配線済) | FR-USR-002 | done |
| T-009 | GCPデプロイ対応(Dockerfile/.dockerignore/env) | FR-SYS-001/002 | done |
| T-010 | README更新+Groqフォールバック違反修正 | RISK-009 | done |

## 残（非課金で可能）
- T-008b: index.html に声見本UI（Fishキー入力・生成ボタン・音声プレイヤー・同意チェック）を配線

## 課金が発生する＝要確認（Phase7後半/Phase8）
- V-1: 実Anthropicキーで「理想台本生成」検証（Claude課金・数円）
- V-2: 実Fish Audioキーで「音声見本生成」検証（Fish課金・約7円）
- V-3: GCP本番デプロイ（根宜さんアカウント・要個別承認）

feature flag: `FEATURE_VOICE_CLONE`（既定off。Phase7検証まで有効化しない）。
