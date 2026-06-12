# 要件ID台帳 / 受入基準 / Exit基準 / 採用停止基準 — p3

## 1. 要件ID台帳
| ID | タイトル | 優先度 | 状態 | テストID |
|---|---|---|---|---|
| FR-AUTH-001 | ユーザー登録 | Must | Implemented | TC-AUTH-001 |
| FR-AUTH-002 | メール確認 | Must | Implemented | TC-AUTH-002 |
| FR-AUTH-003 | ログイン | Must | Implemented | TC-AUTH-003 |
| FR-AUTH-004 | ログアウト/me | Must | Implemented | TC-AUTH-004 |
| FR-USR-001 | APIキーBYOK保存/同期 | Must | Implemented | TC-USR-001 |
| FR-ADM-001 | ユーザー管理 | Must | Implemented | TC-ADM-001 |
| FR-DATA-001 | 素材分析(SSE) | Must | Implemented | TC-DATA-001 |
| FR-DATA-002 | 比較分析 | Must | Implemented | TC-DATA-002 |
| FR-EXT-001 | 動画/音声文字起こし | Must | Implemented | TC-EXT-001 |
| FR-EXT-002 | URL取得 | Should | Implemented | TC-EXT-002 |
| FR-EXT-003 | ファイル抽出 | Must | Implemented | TC-EXT-003 |
| FR-DATA-010 | 非言語観点の文章補足 | Must | Draft | TC-DATA-010 |
| FR-DATA-011 | 理想クロージング台本生成 | Must | Draft | TC-DATA-011 |
| FR-DATA-012 | 商談クロージング評価軸(デフォルト基準) | Must | Draft | TC-DATA-012 |
| FR-DATA-013 | ユーザー基準のアップロード(ハイブリッド) | Should | Draft | TC-DATA-013 |
| FR-VOICE-001 | 本人の声サンプル抽出 | Must | Draft | TC-VOICE-001 |
| FR-VOICE-002 | 声クローンID作成(BYOK) | Must | Draft | TC-VOICE-002 |
| FR-VOICE-003 | 理想クロージング音声見本生成 | Must | Draft | TC-VOICE-003 |
| FR-VOICE-004 | 音声見本DBキャッシュ | Must | Draft | TC-VOICE-004 |
| FR-USR-002 | Fish AudioキーBYOK保存 | Must | Draft | TC-USR-002 |
| FR-SYS-001 | GCPデプロイ対応 | Must | Draft | TC-SYS-001 |
| FR-SYS-002 | 設定の環境変数化 | Should | Draft | TC-SYS-002 |

Must比率: 18/20=90%(既存実装12件を含むため高い。新規Must8件中スコープ妥当)。新規分のMust比率は許容範囲。

## 2. 受入基準表（新規分の主要）
| 要件ID | 受入基準 | 検証方法 |
|---|---|---|
| FR-DATA-012 | コピー10要素でなく商談会話向け評価軸でスコア/添削が出る | E2E/出力検査 |
| FR-DATA-013 | 基準アップ時は基準準拠の指摘が増え、無い時はデフォルト軸で必ず動く | E2E |
| FR-DATA-010 | 添削レポートに非言語観点セクションが含まれる | E2E/出力検査 |
| FR-DATA-011 | 読み上げ可能な理想クロージング台本が生成される | E2E |
| FR-VOICE-001 | 商談音声から10秒以上の声サンプルが得られる | 単体/統合 |
| FR-VOICE-002 | Fish AudioでvoiceID作成・DB保存される / 無効キーは日本語エラー | 統合(DRY_RUNモック) |
| FR-VOICE-003 | 本人声の音声(mp3)が再生可能な形で返る | E2E(モック) |
| FR-VOICE-004 | 同一入力の2回目はAPI未呼び出しでキャッシュ返却 | 単体 |
| FR-USR-002 | fish_key保存・X-Fish-Keyヘッダー送信・サーバー非フォールバック | 統合 |
| FR-SYS-001 | VM上で health=200 / analyze SSE が流れる / 再起動後もDB保持 | デプロイ検証 |

## 3. Exit Criteria（Phase完了判定）
- [ ] SRS全14章・全FRにID・GWT・MoSCoW付与
- [ ] 全MustにEvidence ID接続
- [ ] 全MustにTC-*接続（TEST_PLANで定義）
- [ ] 破壊的/外部送信/課金にDRY_RUN/承認/キャッシュ設計あり
- [ ] ユーザー(ゆかたん)承認

## 4. 採用停止基準表
| 技術/サービス | 採用停止条件 | 代替案 |
|---|---|---|
| Fish Audio | 日本語品質が実商談で実用不可、または料金が想定の3倍超 | MiniMax(BYOK切替) |
| GCP Compute Engine VM | SSE/SQLiteで重大問題、無料枠廃止 | Railway/Render(VM型) |
| Claude(分析) | 添削品質不足 or 単価高騰 | Gemini/GPTへProvider切替 |
