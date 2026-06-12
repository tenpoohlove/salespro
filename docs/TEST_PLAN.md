# テスト計画 (TEST_PLAN) — p3
IEEE 829 / 版 1.0 / 2026-06-12 / カバレッジ目標: 純粋関数80%以上

## 1. 方針
- 既存機能はリグレッション防止(RISK-008)。新規は純粋関数にユニットテスト。外部API(Claude/Whisper/Fish)はMockで全テストをキー無し実行可能に(黄金ルール対応)。
- テスト種別: unit(純粋関数) / integration(エンドポイント・DB) / e2e(画面操作シナリオ)。

## 2. テストケース（Must要件→TC接続）
| TC-ID | 対象FR | 種別 | 検証内容 | 合格条件 |
|---|---|---|---|---|
| TC-AUTH-001 | FR-AUTH-001 | integration | 登録→確認メール送信/管理者は即セッション | needsVerification or session、重複は409 |
| TC-AUTH-002 | FR-AUTH-002 | integration | 確認トークンでis_verified=1 | 有効=確認/期限切れ=エラー |
| TC-AUTH-003 | FR-AUTH-003 | integration | ログイン/未確認はEMAIL_NOT_VERIFIED | Cookie発行・分岐正しい |
| TC-USR-001 | FR-USR-001 | integration | キー保存/同期・サーバー非フォールバック | DB保存、保存キーをユーザー処理に使わない |
| TC-USR-002 | FR-USR-002 | integration | fish_key保存・X-Fish-Key送信 | DB保存・ヘッダー反映 |
| TC-ADM-001 | FR-ADM-001 | integration | 一覧/toggle/CSV(管理者のみ) | 非管理者は403 |
| TC-DATA-001 | FR-DATA-001 | integration | analyze SSEストリーミング | SSEイベントが流れる/キー無しはエラー |
| TC-DATA-002 | FR-DATA-002 | integration | compare SSE | 比較レポート出力 |
| TC-DATA-010 | FR-DATA-010 | unit/e2e | 非言語観点セクションを含む | 出力に当該セクション存在 |
| TC-DATA-011 | FR-DATA-011 | unit | 理想クロージング台本生成(プロンプト構築) | 台本テキストが返る(Mock) |
| TC-DATA-012 | FR-DATA-012 | unit | 商談評価軸プロンプト構築 | BANT/MEDDIC/Pain等の軸を含む |
| TC-DATA-013 | FR-DATA-013 | unit | 基準あり=照合/基準なし=デフォルト | フォールバックが必ず動く |
| TC-EXT-001 | FR-EXT-001 | integration | 25MB境界の文字起こし | 25MB以下OK/超過はエラー |
| TC-EXT-003 | FR-EXT-003 | unit | pdf/pptx/docx/画像/字幕抽出 | 既存出力と同一(リグレッション) |
| TC-VOICE-001 | FR-VOICE-001 | unit | 声サンプル抽出(10秒+) | 10秒以上取得/複数話者は区間指定要求 |
| TC-VOICE-002 | FR-VOICE-002 | integration | voiceID作成(Mock)・DBキャッシュ | voiceID保存/無効キーは日本語エラー |
| TC-VOICE-003 | FR-VOICE-003 | integration | 音声見本生成(Mock) | 再生可能音声を返す |
| TC-VOICE-004 | FR-VOICE-004 | unit | audio_cacheヒットでAPI未呼出 | 2回目はMock呼び出し回数0 |
| TC-SYS-001 | FR-SYS-001 | e2e/deploy | VMでhealth=200/analyze SSE/再起動後DB保持 | 全て成立 |
| TC-SYS-002 | FR-SYS-002 | unit | 環境変数未設定時の明示エラー | 起動時に分かるエラー |

## 3. 境界値・異常系（8カテゴリ）
- 空入力/最大長(台本長大)/25MB境界/無効APIキー/複数話者/外部APIタイムアウト(3リトライ)/同意なし生成拒否/キャッシュ衝突。

## 4. リグレッション
既存FR(AUTH/USR/ADM/DATA-001,002/EXT)は変更前にユニット/統合テストを用意し、声クローン追加後も全PASSを確認(RISK-008・EV-RULE)。

## 5. カバレッジ・実行
- `npm test`(vitest/jest等を導入予定)。純粋関数(prompts/extractors/voiceアダプタMock/closing台本構築)80%以上。
- CI最低ゲート(lint/test/build緑)はPhase7検証で確認。
