import { describe, it, expect } from 'vitest';
import {
  parseClosingDialogue,
  buildClosingTurns,
  buildIdealClosingPrompt,
  buildSectionPrompt,
  buildSampleDialoguePrompt,
  tidyDialogueScript,
  CLOSING_SECTIONS,
  DELIVERY_INSTRUCTIONS,
  synthesizeDialogue,
} from '../../src/closing';
import { MockVoiceProvider, splitForSynthesis, FISH_CHUNK_MAX_CHARS } from '../../src/voice';

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

  // 対話版お手本：1行を山場に置いた掛け合いを作らせるプロンプト（文脈・間・行数）
  it('buildSampleDialoguePrompt はお手本セリフ中心の掛け合いを指示し、文脈を反映する', () => {
    const p = buildSampleDialoguePrompt('これが一番合っています。進めましょう。');
    expect(p).toContain('これが一番合っています。進めましょう。');
    expect(p).toContain('営業:');
    expect(p).toContain('客:');
    expect(p).toContain('6〜10行');          // 短すぎ対策（行数増）
    expect(p).toContain('[[SILENCE:');        // 間の指示（デリバリー指示の注入）
    expect(p).toContain('Pain Articulation'); // リサーチベンチマーク注入で中身を厚く

    // 文脈（添削結果等）を渡すと会話に織り込ませ、無いときはそのブロックを出さない
    const withCtx = buildSampleDialoguePrompt('進めましょう。', '次アクションが弱い。価格を価値に紐付けていない。');
    expect(withCtx).toContain('次アクションが弱い');
    expect(withCtx).toContain('商談の文脈');
    expect(buildSampleDialoguePrompt('進めましょう。')).not.toContain('次アクションが弱い');
  });

  // 誤読対策：固有名詞を出さない指示が入っている
  it('buildSampleDialoguePrompt は固有名詞を出さない指示を含む', () => {
    const p = buildSampleDialoguePrompt('進めましょう。');
    expect(p).toContain('固有名詞を出さない');
    expect(p).toContain('御社');
  });

  // 変な終わり方対策：途中切れ（言い切りで終わっていない）の末尾行を落とす
  it('tidyDialogueScript は途中切れの末尾行を落とす', () => {
    const s = '営業: いかがですか？\n客: いいですね。\n営業: では、来週の火曜に';
    expect(tidyDialogueScript(s)).toBe('営業: いかがですか？\n客: いいですね。');
  });
  it('tidyDialogueScript は言い切りで終わる台本はそのまま返す（客の締めも可）', () => {
    const repEnd = '営業: いかがですか？\n客: いいですね。\n営業: では進めましょう。';
    expect(tidyDialogueScript(repEnd)).toBe(repEnd);
    const custEnd = '営業: 進めましょう。\n客: ぜひお願いします。';
    expect(tidyDialogueScript(custEnd)).toBe(custEnd);
  });

  // 長文崩壊対策：Fishへの1チャンク上限・文単位分割
  it('splitForSynthesis は短文を1チャンクで返す（旧挙動と互換）', () => {
    expect(splitForSynthesis('進めましょう。')).toEqual(['進めましょう。']);
    expect(splitForSynthesis('')).toEqual([]);
  });

  it('splitForSynthesis は長文を句点で分割して maxChars に収める', () => {
    const long = ('御社の課題は明確です。'.repeat(30));
    const chunks = splitForSynthesis(long);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(FISH_CHUNK_MAX_CHARS);
    }
    // 句点が末尾にあること（=途中で文を切らない）
    for (const c of chunks) {
      expect(/[。．！？!?]\s*$/.test(c)).toBe(true);
    }
    // 連結すると元と一致する（句読点・意味を壊さない）
    expect(chunks.join('')).toBe(long.trim());
  });

  it('splitForSynthesis は句点なしの長文を読点で分割する', () => {
    const long = 'あれはこうで、これはああで、それはそうで、'.repeat(10);
    const chunks = splitForSynthesis(long);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(FISH_CHUNK_MAX_CHARS);
  });

  // synthesizeDialogue は長文ターンを内部で複数チャンクに割って合成する（mockでも複数回呼ばれ各チャンク内容が含まれる）
  it('synthesizeDialogue は長文ターンをチャンク分割して合成する', async () => {
    const long = '御社の課題は明確です。'.repeat(30);
    const out = await synthesizeDialogue(
      [{ speaker: 'rep', text: long }],
      new MockVoiceProvider(),
      'V_REP',
      'key',
    );
    const s = out.toString('utf8');
    // 最初と最後の句がどちらも含まれる＝分割後の全チャンクが合成されている
    expect(s).toContain('V_REP::');
    // mock出力は MOCK_AUDIO::voiceID::text の繰り返しを単純連結したもの→複数回現れる
    const occurrences = (s.match(/MOCK_AUDIO::V_REP::/g) || []).length;
    expect(occurrences).toBeGreaterThan(1);
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
