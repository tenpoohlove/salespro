import { describe, it, expect } from 'vitest';
import { buildIdealClosingPrompt, prepareVoiceSample, parseClosingDialogue, buildSectionPrompt, CLOSING_SECTIONS, targetCharsForMinutes, IDEAL_CLOSING_BENCHMARKS, SECTION_FOCUS } from '../../src/closing';
import { buildClosingAnalysisPrompt, CLOSING_SYSTEM_PROMPT } from '../../src/prompts';

describe('closing.ts / prompts.ts 評価軸・台本生成', () => {
  // TC-DATA-012: 商談クロージング評価軸（コピー10要素でなく会話向け軸）
  it('CLOSING_SYSTEM_PROMPT は商談会話の評価軸を含む', () => {
    expect(CLOSING_SYSTEM_PROMPT).toContain('Pain Articulation');
    expect(CLOSING_SYSTEM_PROMPT).toContain('MEDDPICC');
    expect(CLOSING_SYSTEM_PROMPT).toContain('Take Control');
    expect(CLOSING_SYSTEM_PROMPT).toContain('反論処理');
  });

  // ディープリサーチ反映: 実証ベンチマーク（相関シグナル）が評価軸に入っている
  it('CLOSING_SYSTEM_PROMPT は実証ベンチマークと相関の但し書きを含む', () => {
    expect(CLOSING_SYSTEM_PROMPT).toContain('43:57');
    expect(CLOSING_SYSTEM_PROMPT).toContain('相関');
  });

  // 重要ポイント・レポート型: 勝負どころを大事な順に絞り、見本セリフ＋音声化の目印を出す
  it('buildClosingAnalysisPrompt は重要ポイント型レポート（点数・お手本セリフ）を含み、英語ジャーゴンを出力に出さない', () => {
    const p = buildClosingAnalysisPrompt('商談本文');
    expect(p).toContain('総合評価');     // 最初に点数
    expect(p).toContain('重要ポイント');  // 勝負どころを大事な順に
    expect(p).toContain('大事な順');
    expect(p).toContain('お手本セリフ');  // 音声化ボタンが拾う固定の目印
    // 出力に専門用語・英語フレームワーク名を出さないルールが明記されている
    expect(p).toContain('専門用語');
    expect(p).toContain('MEDDPICC'); // 「MEDDPICC等は禁止」という禁止指示としてのみ登場
    expect(p).toContain('禁止');
    expect(p).toContain('セリフ例');
  });

  // 具体的な提案形式（「こうしましょう」）で書かせる指示を含む
  it('buildClosingAnalysisPrompt は具体的な提案形式と引用元の文字起こしを含む', () => {
    const p = buildClosingAnalysisPrompt('お客様: 高いですね。営業: ...');
    expect(p).toContain('こうしましょう');
    expect(p).toContain('お客様: 高いですね');
  });

  // TC-DATA-013: 基準あり=照合、基準なし=デフォルトで必ず動く（ハイブリッド）
  it('基準ありのときは基準ブロックを含み、無いときはデフォルトで動く', () => {
    const withRef = buildClosingAnalysisPrompt('商談本文', '理想トークスクリプト本文');
    expect(withRef).toContain('理想トークスクリプト本文');
    expect(withRef).toContain('ズレ');

    const noRef = buildClosingAnalysisPrompt('商談本文', null);
    expect(noRef).toContain('基準提供なし');
    expect(noRef).toContain('商談本文');
  });

  // FR-DATA-011: 理想クロージング台本プロンプト（会話形式）
  it('buildIdealClosingPrompt は会話形式(営業/客)で本文のみを要求する', () => {
    const p = buildIdealClosingPrompt('商談文字起こし');
    expect(p).toContain('理想');
    expect(p).toContain('会話');
    expect(p).toContain('営業:');
    expect(p).toContain('客:');
    expect(p).toContain('商談文字起こし');
  });

  // 評価結果(analysisFindings)を渡すと理想台本に反映される
  it('buildIdealClosingPrompt は添削結果を渡すとその弱点修正を指示する', () => {
    const p = buildIdealClosingPrompt('商談', null, null, '次アクションが弱い。価格を価値に紐付けていない。');
    expect(p).toContain('添削');
    expect(p).toContain('次アクションが弱い');
    // 添削なしのときはそのブロックを含まない
    expect(buildIdealClosingPrompt('商談')).not.toContain('次アクションが弱い');
  });

  // 会話テキストをターン配列に分解できる
  it('parseClosingDialogue は 営業:/客: をターンに分解する', () => {
    const turns = parseClosingDialogue('営業: こんにちは。\n客: よろしく。\nお客様: 高いですね。');
    expect(turns).toHaveLength(3);
    expect(turns[0]).toEqual({ speaker: 'rep', text: 'こんにちは。' });
    expect(turns[1]).toEqual({ speaker: 'customer', text: 'よろしく。' });
    expect(turns[2].speaker).toBe('customer'); // 「お客様:」も客として扱う
  });

  // FR-DATA-014/015: 備考・相手情報(context)を考慮
  it('context を渡すと台本・添削プロンプトに反映される', () => {
    const ctx = '相手は製造業の役員。前回は予算で渋られた。';
    const closing = buildIdealClosingPrompt('商談', null, ctx);
    expect(closing).toContain('製造業の役員');
    expect(closing).toContain('備考');
    const analysis = buildClosingAnalysisPrompt('商談', null, ctx);
    expect(analysis).toContain('製造業の役員');
    // context無しのときは備考ブロックを含まない
    expect(buildIdealClosingPrompt('商談', null, null)).not.toContain('製造業の役員');
  });

  // TC-VOICE-001: 声サンプルの検証（空/極小はエラー、十分なら通る）
  it('prepareVoiceSample は空・極小を弾き、十分なサイズは通す', () => {
    expect(() => prepareVoiceSample(Buffer.alloc(0))).toThrow();
    expect(() => prepareVoiceSample(Buffer.alloc(100))).toThrow();
    const ok = Buffer.alloc(20 * 1024, 1);
    expect(prepareVoiceSample(ok)).toBe(ok);
  });
});

describe('フル尺の理想クロージング（セクション分割生成）', () => {
  // 最初から最後までを網羅する章立てになっている
  it('CLOSING_SECTIONS は導入〜次アクションまでを網羅する', () => {
    expect(CLOSING_SECTIONS.length).toBeGreaterThanOrEqual(5);
    expect(CLOSING_SECTIONS[0]).toContain('導入');
    expect(CLOSING_SECTIONS[CLOSING_SECTIONS.length - 1]).toContain('次アクション');
    expect(CLOSING_SECTIONS.some(s => s.includes('反論') || s.includes('Objection'))).toBe(true);
  });

  // セクションプロンプトは「このパートだけ」「字数」「会話形式」「文字起こし」を含む
  it('buildSectionPrompt は対象パート・目標字数・会話形式・本文のみを指示する', () => {
    const p = buildSectionPrompt(CLOSING_SECTIONS[2], 2, CLOSING_SECTIONS.length, '商談の文字起こし本文', null, null, null, null, 1800);
    expect(p).toContain(CLOSING_SECTIONS[2]);
    expect(p).toContain('パート3');
    expect(p).toContain('1800字');
    expect(p).toContain('営業:');
    expect(p).toContain('客:');
    expect(p).toContain('商談の文字起こし本文');
  });

  // 直前パートの末尾・添削結果を渡すと連続性/修正指示が入る
  it('buildSectionPrompt は直前パートと添削結果を反映する', () => {
    const p = buildSectionPrompt(CLOSING_SECTIONS[3], 3, CLOSING_SECTIONS.length, '商談', null, null, '価格を価値に紐付けていない', '...では次に進みましょう', 1500);
    expect(p).toContain('直前パートの終わり');
    expect(p).toContain('次に進みましょう');
    expect(p).toContain('価格を価値に紐付けていない');
    // 何も渡さなければ該当ブロックは出ない
    const bare = buildSectionPrompt(CLOSING_SECTIONS[0], 0, CLOSING_SECTIONS.length, '商談');
    expect(bare).not.toContain('直前パートの終わり');
    expect(bare).not.toContain('添削で指摘された弱点');
  });

  // ★リサーチ直結: 台本生成プロンプトに実証ベンチマークが明示注入されている
  it('IDEAL_CLOSING_BENCHMARKS は Gong/MEDDPICC/Challenger の実証指標を含む', () => {
    expect(IDEAL_CLOSING_BENCHMARKS).toContain('Gong');
    expect(IDEAL_CLOSING_BENCHMARKS).toContain('MEDDPICC');
    expect(IDEAL_CLOSING_BENCHMARKS).toContain('43：顧客57');
    expect(IDEAL_CLOSING_BENCHMARKS).toContain('Pain Articulation');
    expect(IDEAL_CLOSING_BENCHMARKS).toContain('+53%');
    expect(IDEAL_CLOSING_BENCHMARKS).toContain('相関'); // 因果でない但し書き
  });

  it('buildSectionPrompt と buildIdealClosingPrompt はベンチマークを台本生成に注入する', () => {
    const sec = buildSectionPrompt(CLOSING_SECTIONS[1], 1, CLOSING_SECTIONS.length, '商談');
    expect(sec).toContain('傾聴比'); // ベンチマーク本体
    expect(sec).toContain('このパートで特に意識する点'); // セクション別フォーカス
    expect(sec).toContain(SECTION_FOCUS[1]);
    const short = buildIdealClosingPrompt('商談');
    expect(short).toContain('Pain Articulation');
    expect(short).toContain('next-step');
  });

  it('SECTION_FOCUS は CLOSING_SECTIONS と同じ数だけある', () => {
    expect(SECTION_FOCUS.length).toBe(CLOSING_SECTIONS.length);
  });

  // 分数→1セクション目標字数（元動画に近い長さ）。30/45/60分で増え、上下限に収まる
  it('targetCharsForMinutes は尺に応じて増え、500〜3500字に収まる', () => {
    const c30 = targetCharsForMinutes(30);
    const c45 = targetCharsForMinutes(45);
    const c60 = targetCharsForMinutes(60);
    expect(c30).toBeLessThan(c45);
    expect(c45).toBeLessThan(c60);
    expect(c30).toBeGreaterThanOrEqual(500);
    expect(c60).toBeLessThanOrEqual(3500);
    // 30分=9000字/6セクション=1500字前後
    expect(c30).toBeGreaterThanOrEqual(1400);
    expect(c30).toBeLessThanOrEqual(1600);
  });
});
