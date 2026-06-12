# PROGRESS — p3 声クローン添削機能
更新: 2026-06-12

## フェーズ進捗
- [x] Phase 0 ヒアリング (spec/intake_sheet.md, scope_table.md, open_items.md)
- [x] Phase 1 リサーチ V1/V2 (research/) — Fish Audio採用・GCP VM採用・評価軸EV-RES3
- [x] Phase 2 SRS (docs/SRS.md, requirements_ledger.md, risk_register.md) — 承認済
- [x] Phase 3 SDD (docs/SDD.md) — 5モジュール構成・声クローンアダプタ・GCP VM
- [x] Phase 4 テスト計画 (docs/TEST_PLAN.md, E2E_SCENARIOS.md, CONSTRAINTS.md, CLAUDE.md)
- [x] Phase 5 レビュー (harness/review-log.md) — 🟢 GO(条件付き)・Blocker0
- [x] Phase 6 実装（T-001〜T-010、UIのみpartial）— Mock/DRY_RUN・flag off で課金なし
- [x] Phase 7 検証: ユニット10件PASS / tsc緑 / build緑 / サーバー起動・health200・認証保護OK / UI配線済
      → 実キー検証も完了: V-1 Claude理想台本生成 成功 / V-2 Fish Audio声クローン+合成 成功(Downloads\v2_声見本テスト.mp3)
      → Fish Create Model APIの正しい仕様(type/train_mode/visibility)を確定しvoice.ts修正済
      → 残: 声品質の人間判定(ゆかたんが生成音声を試聴・RISK-002)
- [ ] Phase 8 本番移行(根宜さんGCPアカウント・個別承認)

## 課金検証メモ(2026-06-12)
- 声サンプルは10MB(15分)だとFish側524タイムアウト → 40秒に切る必要あり(ffmpegで前処理)。実装時は声サンプルを短く切る処理を追加すること。
- 実キーは会話履歴に露出したため使用後ローテーション推奨。

## 実装サマリー（2026-06-12 自走モード完了分）
- src/voice.ts(声クローンアダプタ Fish+Mock+DRY_RUN) / src/closing.ts(理想台本+声サンプル)
- src/prompts.ts(商談クロージング評価軸+非言語補足+ハイブリッド基準)
- src/db.ts(fish_key/voice_samples/audio_cache/reference_baselines)
- src/server.ts(/api/voice/generate-sample, fish_key対応, feature flag)
- Dockerfile/.dockerignore(GCP VM用) / README更新 / Groqフォールバック違反修正
- テスト: tests/unit/voice.test.ts, closing.test.ts (計10件PASS)
- feature flag FEATURE_VOICE_CLONE 既定off

## GO条件(本番前に解消)
1. Fish Audio APIを一次docsで確定
2. 声クローン品質を実商談で検証
3. 複数話者の本人区間指定UI

## 状態機械: REVIEW (次: IMPL)
