# 要件定義書 (SRS) — p3 SalesPro
IEEE 29148 / ISO 25010 準拠 / 版 1.0 / 2026-06-12

## 0. 文書管理
| 版 | 日付 | 変更内容 | 承認 |
|---|---|---|---|
| 1.0 | 2026-06-12 | 既存機能の要件化＋声クローン添削機能の追加要件を定義 | ゆかたん(廣瀬) |

- 凡例: 優先度=MoSCoW / Evidence=根拠ID(EV-*) / 状態=Draft/Approved/Implemented/Verified
- EV出典: EV-CODE=既存実装(src/), EV-RES1=research_v1.md, EV-RES2=research_v2.md, EV-EXP=テル先生相談(文字起こし), EV-RULE=ゆかたんグローバルルール

## 1. はじめに
- **目的**: セールスのZoomクロージング商談を分析し、成約率を上げる具体的添削＋「本人の声での理想クロージング音声見本」を提供するWebツール。
- **範囲**: 既存p3(分析・文字起こし・認証・BYOK・管理者)＋新規(声クローン見本生成・添削仕上げ・GCPデプロイ)。
- **用語**: BYOK=利用者自身のAPIキー利用 / SSE=Server-Sent Events / 声クローン=本人の声を再現した音声合成 / クロージング=商談の成約段階。
- **参考**: research/research_v1.md, research_v2.md, spec/intake_sheet.md, HANDOFF.md。

## 2. システム概要
Node.js+Express+TypeScriptのWebアプリ。ブラウザ→(SSE)→サーバー→各AI API(BYOK)。素材(動画/音声/PDF/画像/テキスト/URL)を入力→文字起こし→Claudeで分析→添削レポート。新たに、本人音声→Fish Audioで声クローン→理想クロージング音声見本を返す。DBはSQLite(GCP VMの永続ディスクで継続)。

```
[ブラウザ] --SSE--> [Express/TS] --BYOK--> [Claude(分析)/Whisper(文字起こし)/Fish Audio(声クローン)]
                          |
                       [SQLite: users/sessions/api_keys/...(+voice_samples/audio_cache)]
```

## 3. ステークホルダー
| 区分 | 関心事 |
|---|---|
| 利用者(営業本人/スタッフ) | 自分の商談を改善したい。自分のAPIキーで使う。声見本で真似したい。 |
| クライアント(根宜さん/オニオンリンク) | 多数に配布・販売。リスト取得(登録制)。サーバー代を自分のGCPで持つ。 |
| オーナー(ゆかたん/開発) | オーナー課金ゼロ(EV-RULE)。納品品質。コスト最小。 |
| 外部サービス | Anthropic Claude / OpenAI Whisper / Fish Audio / (将来MiniMax) / GCP |

## 4. 運用サイクル
- 都度: 利用者が商談をアップ→添削＋音声見本をオンデマンド生成(事前一括生成は禁止 EV-RULE)。
- 月次: 管理者が登録ユーザーをCSV確認。Fish Audio/Claude/Whisperの各自課金はユーザー側ダッシュボードで確認。

## 5. フェーズ計画
- **MVP(今回)**: 文字起こし添削の仕上げ＋声クローン音声見本＋GCPデプロイ。
- **V2(DEFER)**: 声見本の動画化(HeyGen)、話者分離の高度化、大規模化(Postgres/ジョブキュー)。
- **対象外**: リール量産アプリ(別案件)、Gemini動画ネイティブ解析(コスト理由・EV-EXP)。

## 6. 外部インターフェース
| ID | 種別 | 内容 | Evidence |
|---|---|---|---|
| API-CLAUDE-001 | 外部API | claude-sonnet-4-6で分析(BYOK: X-Anthropic-Key) | EV-CODE |
| API-OPENAI-001 | 外部API | whisper-1で文字起こし(BYOK: X-OpenAI-Key) | EV-CODE |
| API-FISH-001 | 外部API | Fish Audio TTS/voice clone(BYOK: X-Fish-Key)。$15/100万UTF-8バイト | EV-RES1/2 |
| UI-001 | 画面 | index/login/signup/verify-email/admin (public/*.html) | EV-CODE |
| FILE-001 | 入力 | pdf/pptx/docx/txt/md/srt/vtt/png/jpg/webp/動画/音声(25MB上限) | EV-CODE |

## 7. 機能要件 (FR)

### 既存機能（現状の要件として記録 / 状態=Implemented）

**FR-AUTH-001 ユーザー登録** [Must][EV-CODE]
- Given 未登録のメール/パスワード/氏名 When POST /api/auth/register Then 一般ユーザーは確認メール送信(needsVerification)、ADMIN_EMAIL一致なら即セッション作成。例外: 既存メールは409。

**FR-AUTH-002 メール確認** [Must][EV-CODE] Given 確認トークン When GET /api/auth/verify-email Then is_verified=1。例外: 期限切れトークンはエラー。

**FR-AUTH-003 ログイン** [Must][EV-CODE] Given 登録済み資格情報 When POST /api/auth/login Then セッションCookie発行。例外: is_verified=0は EMAIL_NOT_VERIFIED。

**FR-AUTH-004 ログアウト/セッション確認** [Must][EV-CODE] /api/auth/logout でセッション破棄、/api/auth/me で現在ユーザー返却。

**FR-USR-001 APIキーBYOK保存/同期** [Must][EV-CODE][EV-RULE] Given ログイン中 When POST /api/user/api-keys Then anthropic_key/openai_keyをDB保存しlocalStorage同期。サーバーは保存キーをフォールバックに使わない。

**FR-ADM-001 ユーザー管理** [Must][EV-CODE] 管理者は GET /api/admin/users で一覧、toggleで有効/無効、export-csvでCSV出力。requireAdminで保護。

**FR-DATA-001 セールス素材の分析(SSE)** [Must][EV-CODE] Given 素材＋focus(総合/Hook/CTA/信頼) When POST /api/analyze Then SSEで分析レポートをストリーミング(10要素スコア・TOP3改善・改善スクリプト等)。BYOK必須。例外: キー無しはエラー表示。

**FR-DATA-002 改善前後の比較分析** [Must][EV-CODE] before/after2素材 → /api/compare でSSE比較レポート。

**FR-EXT-001 動画/音声の文字起こし** [Must][EV-CODE] Given 25MB以下の動画/音声 When POST /api/transcribe Then whisper-1で日本語文字起こしを返す。例外: 25MB超は上限エラー。

**FR-EXT-002 URL取得** [Should][EV-CODE] URLからテキスト抽出(/api/scrape)。

**FR-EXT-003 ファイル抽出** [Must][EV-CODE] pdf/pptx/docx/画像/字幕からテキスト/画像を抽出。

### 新規機能（今回実装 / 状態=Draft）

**FR-DATA-010 添削への非言語観点の文章補足** [Must][EV-EXP]
- Given 文字起こし済みクロージング When 分析実行 Then 添削レポート内に「声のトーン・話速・間・身振り手振り」観点の改善示唆を**文章で**補足する。
- 受入: レポートに非言語観点セクションが必ず含まれる。例外: 文字起こしが空なら当セクションをスキップし注記。

**FR-DATA-011 理想クロージング台本の生成** [Must][EV-EXP]
- Given 分析対象のクロージング文字起こし When ユーザーが「理想クロージング生成」を実行 Then 本人の商材・文脈に沿った理想クロージング台本(テキスト)をClaudeが生成する。
- 受入: 台本は読み上げ可能なプレーン文。例外: 入力不足時は不足を明示。

**FR-DATA-012 商談クロージング評価軸（デフォルト基準）** [Must][EV-RES3][EV-EXP]
- Given クロージング文字起こし、評価基準データなし When 分析実行 Then 世界標準の商談会話評価軸（Pain Articulation・BANT/MEDDIC要素・反論処理・価値提示・次アクション確保・ラポール等）で評価する。
- 受入: 既存のコピー10要素ではなく**商談会話向け評価軸**でスコア/添削が出る。例外: 文字起こしが空なら評価不能を明示。
- 補足: テル先生指摘「何を基準に評価するのか」への回答。コピー評価とは別系統。

**FR-DATA-013 ユーザー基準のアップロード（ハイブリッド精度UP）** [Should][EV-EXP]
- Given ユーザーが理想トークスクリプトor商材マニュアルをアップロード When 分析実行 Then アップ基準と商談を照合し「理想とのズレ」を加味して評価する。
- 受入: 基準あり時は基準準拠の指摘が増える。基準なし時はFR-DATA-012のデフォルト軸にフォールバック（必ず動く）。例外: 基準が長大な場合は要約して使用。

**FR-VOICE-001 本人の声サンプル抽出** [Must][EV-RES2]
- Given アップ済み商談音声 When 声見本生成を開始 Then 音声から本人の声サンプル(10秒以上)を取得する。
- 受入: 10秒以上のサンプルが得られる。例外: 複数話者で本人特定不能なら、ユーザーに区間指定を促す(RISK-005)。

**FR-VOICE-002 声クローンID作成(BYOK)** [Must][EV-RES1][EV-RES2]
- Given 声サンプル＋ユーザーのFish Audioキー When 声クローン作成 Then Fish AudioでvoiceIDを作成しDBにキャッシュする。
- 受入: voiceIDが返りDB保存される。サーバーキーへのフォールバック禁止(EV-RULE)。例外: キー無効は明確なエラー表示。

**FR-VOICE-003 理想クロージング音声見本の生成** [Must][EV-EXP][EV-RES1]
- Given voiceID＋理想クロージング台本(FR-DATA-011) When 音声見本生成 Then 本人の声・自然なトーンで台本を読み上げた音声(mp3等)を生成し返す。
- 受入: 再生可能な音声が返る。出力は音声のみ(動画はDEFER)。例外: 生成失敗時はリトライ後エラー。

**FR-VOICE-004 音声見本のDBキャッシュ** [Must][EV-RULE]
- Given 同一(voiceID＋台本)の再要求 When 生成要求 Then DBキャッシュを返しFish Audio APIを再呼び出ししない(2回目0円)。

**FR-USR-002 Fish AudioキーのBYOK保存** [Must][EV-RULE][EV-CODE]
- Given ログイン中 When キー保存 Then user_api_keysにfish_keyを追加保存し、リクエスト時X-Fish-Keyヘッダーで送信。サーバー非保存利用。

**FR-SYS-001 GCPデプロイ対応** [Must][EV-RES1]
- Given 本番環境 When GCP Compute Engine VM(e2-micro)にデプロイ Then SSE/ファイルアップロード/SQLiteが動作する。
- 受入: VM上でhealthが200、analyze SSEが流れる、SQLite永続化される。例外: ポート/環境変数未設定は起動時に明示エラー。

**FR-SYS-002 設定の環境変数化** [Should][EV-CODE] ポート/ADMIN_EMAIL/SITE_URL/SMTP/DB_PATHを環境変数化しVMで設定可能にする。

## 8. 画面・操作フロー
既存5画面(index/login/signup/verify-email/admin)に、index内へ「理想クロージング音声見本」UI(生成ボタン・音声プレイヤー・Fish Audioキー入力)を追加。画面遷移は既存踏襲。

## 9. データ要件
| DATA-ID | 内容 | ライフサイクル |
|---|---|---|
| DATA-001 users | id/email/password_hash/name/phone/is_admin/is_verified/enabled/created_at | 永続 |
| DATA-002 sessions | トークン・期限 | 期限切れで無効 |
| DATA-003 user_api_keys | anthropic/openai/**fish**_key | ユーザー削除でCASCADE |
| DATA-004 voice_samples(新) | user_id/fish_voice_id/created_at | ユーザー単位キャッシュ |
| DATA-005 audio_cache(新) | key(voiceID+台本hash)/audio_path or blob/created_at | 再利用キャッシュ |
- 保存先: SQLite(GCP VM永続ディスク)。アップ音声/生成音声の一時ファイルは処理後削除(EV-RULE: スクショ/中間ファイル削減)。

## 10. 非機能要件 (ISO 25010・9特性)
| NFR-ID | 特性 | 要件(数値) | 測定 |
|---|---|---|---|
| NFR-FUNC-001 | 機能適合性 | 全Must要件がTC-*でPASS | テスト結果 |
| NFR-PERF-001 | 性能効率性 | analyze初回応答<5秒でSSE開始、声見本生成<60秒 | 計測 |
| NFR-COMPAT-001 | 互換性 | Node.js 18+で動作、主要ブラウザでSSE再生 | 起動/E2E |
| NFR-USE-001 | 使用性 | 声見本生成はクリック1回＋待ち。エラーは日本語表示 | 操作確認 |
| NFR-REL-001 | 信頼性 | 外部API失敗時はリトライ(最大3)後に日本語エラー、サーバーは落ちない | 異常系テスト |
| NFR-SEC-001 | セキュリティ | 全キーBYOK・サーバー非保存/非フォールバック、HTTPS、XSS対策(DOMPurify) | コード/テスト |
| NFR-MAINT-001 | 保守性 | 純粋関数に単体テスト、カバレッジ80%以上 | カバレッジ |
| NFR-PORT-001 | 移植性 | Dockerfile/環境変数でGCP VMに構築可能 | デプロイ |
| NFR-EXT-001 | 拡張性 | 声クローンProvider(Fish/MiniMax)をアダプタで差し替え可能 | 設計確認 |

## 11. セキュリティ・監査
- SEC-001 全APIキーはBYOK。サーバーは保存キーをユーザー操作のフォールバックに使わない(EV-RULE)。
- SEC-002 声クローンは**本人の声のみ**許可。生成前に同意UIを表示(なりすまし防止)。[Must]
- SEC-003 認証必須API(requireAuth)・管理API(requireAdmin)・レート制限(analyze/transcribe/scrape/auth)。
- SEC-004 アップ音声・生成音声は処理後に一時ファイル削除、長期保存はキャッシュ方針に従う。

## 12. 制約条件
- 課金: オーナー/根宜さん負担禁止、全てユーザーBYOK(EV-RULE)。
- 技術: 既存Node+Express+TS+SQLite踏襲。GCP Compute Engine VM(e2-micro/Always Free)。
- 動画身振り解析はGeminiネイティブ非採用(コスト・EV-EXP)。文字起こし＋文章補足で代替。
- 法的: 声クローンの本人同意・利用規約整備。

## 13. トレーサビリティ（要点・全量は requirements_ledger.md）
| FR | EV | ACC | TC | RISK | SDD |
|---|---|---|---|---|---|
| FR-VOICE-002 | EV-RES1 | ACC-FR-VOICE-002 | TC-VOICE-002 | RISK-001/004 | SDD-VOICE |
| FR-VOICE-003 | EV-EXP | ACC-FR-VOICE-003 | TC-VOICE-003 | RISK-002 | SDD-VOICE |
| FR-SYS-001 | EV-RES1 | ACC-FR-SYS-001 | TC-SYS-001 | RISK-006 | SDD-DEPLOY |

## 14. リスク・変更管理（全量は risk_register.md）
主要: RISK-001 声API課金暴走→BYOK＋キャッシュ＋オンデマンド。RISK-002 声品質不足→実商談で要検証。RISK-005 複数話者の本人抽出→区間指定UI。RISK-006 GCP USリージョンのレイテンシ→MVP許容。
- 変更管理: 本SRSをSSOTとし、コード変更時はSRS/TEST_PLAN/risk_registerを更新(黄金ルール#6)。
