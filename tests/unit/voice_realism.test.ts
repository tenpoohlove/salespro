import { describe, it, expect } from 'vitest';
import {
  parseClosingDialogue,
  buildClosingTurns,
  buildIdealClosingPrompt,
  buildSectionPrompt,
  CLOSING_SECTIONS,
  DELIVERY_INSTRUCTIONS,
  synthesizeDialogue,
} from '../../src/closing';
import { MockVoiceProvider } from '../../src/voice';

describe('お手本音声のリアル化（間・抑揚・2モード）', () => {
  // §3/§4: デリバリー指示が台本プロンプトに注入される（[pause]/[[SILENCE]] を埋めさせる）
  it('DELIVERY_INSTRUCTIONS は間・抑揚・無音マーカーの指示を含む', () => {
    expect(DELIVERY_INSTRUCTIONS).toContain('[pause]');
    expect(DELIVERY_INSTRUCTIONS).toContain('[[SILENCE:');
    expect(DELIVERY_INSTRUCTIONS).toContain('語尾');
  });

  it('buildIdealClosingPrompt / buildSectionPrompt はデリバリー指示を注入する', () => {
    expect(buildIdealClosingPrompt('商談')).toContain('[[SILENCE:');
    expect(buildSectionPrompt(CLOSING_SECTIONS[4], 4, CLOSING_SECTIONS.length, '商談')).toContain('[pause]');
  });

  // §4: [[SILENCE:ms]] は無音ターンとして分離される（Fishには渡さない）
  it('parseClosingDialogue は [[SILENCE:ms]] を無音ターンに分離する', () => {
    const turns = parseClosingDialogue('営業: 進めましょう。[[SILENCE:2000]] いかがですか？\n客: そうですね。');
    expect(turns).toEqual([
      { speaker: 'rep', text: '進めましょう。' },
      { speaker: 'silence', text: '', silenceMs: 2000 },
      { speaker: 'rep', text: 'いかがですか？' },
      { speaker: 'customer', text: 'そうですね。' },
    ]);
  });

  // マーカーが無い従来入力は従来通り（無音ターンを足さない・余計なキーを足さない）
  it('parseClosingDialogue はマーカー無し入力を従来どおり分解する', () => {
    const turns = parseClosingDialogue('営業: こんにちは。\n客: よろしく。');
    expect(turns).toEqual([
      { speaker: 'rep', text: 'こんにちは。' },
      { speaker: 'customer', text: 'よろしく。' },
    ]);
  });

  // §1/§5B: 語り版(monologue)は客ターンを「想定の沈黙」に置換する
  it('buildClosingTurns(monologue) は客ターンを無音に置換し、営業ターンは残す', () => {
    const turns = buildClosingTurns('営業: いかがですか？\n客: 高いですね。\n営業: 価値はこうです。', 'monologue');
    expect(turns.map(t => t.speaker)).toEqual(['rep', 'silence', 'rep']);
    expect(turns[1].silenceMs).toBeGreaterThan(0);
    // 客の本文は音声化されない（テキストが落ちている）
    expect(turns.find(t => t.text.includes('高いですね'))).toBeUndefined();
  });

  it('buildClosingTurns(dialogue) は掛け合いをそのまま保つ', () => {
    const turns = buildClosingTurns('営業: いかがですか？\n客: 高いですね。', 'dialogue');
    expect(turns.map(t => t.speaker)).toEqual(['rep', 'customer']);
  });

  // 無音ターンは provider.synthesize を呼ばない（mock環境ではffmpeg無音は空でスキップ→他ターンは合成される）
  it('synthesizeDialogue は silence ターンで Fish を呼ばず、テキストターンのみ合成する', async () => {
    const out = await synthesizeDialogue(
      [
        { speaker: 'rep', text: '進めましょう' },
        { speaker: 'silence', text: '', silenceMs: 2000 },
        { speaker: 'rep', text: 'いかがですか' },
      ],
      new MockVoiceProvider(),
      'V_REP',
      'key',
    );
    const s = out.toString('utf8');
    expect(s).toContain('V_REP::進めましょう');
    expect(s).toContain('V_REP::いかがですか');
    expect(s).not.toContain('SILENCE');
  });
});
