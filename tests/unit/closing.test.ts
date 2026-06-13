import { describe, it, expect } from 'vitest';
import { buildIdealClosingPrompt, prepareVoiceSample, parseClosingDialogue } from '../../src/closing';
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

  // MEDDPICC 8要素の緑/黄/赤診断テーブルを出力に含む
  it('buildClosingAnalysisPrompt は MEDDPICC 診断と未確認(🔴)の扱いを含む', () => {
    const p = buildClosingAnalysisPrompt('商談本文');
    expect(p).toContain('MEDDPICC');
    expect(p).toContain('Economic Buyer');
    expect(p).toContain('Competition');
    expect(p).toContain('🔴');
  });

  // TC-DATA-010: 非言語観点の文章補足セクションを含む
  it('buildClosingAnalysisPrompt は非言語観点セクションを含む', () => {
    const p = buildClosingAnalysisPrompt('お客様: 高いですね。営業: ...');
    expect(p).toContain('非言語');
    expect(p).toContain('文字起こし');
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
