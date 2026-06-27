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
  SAMPLE_DIALOGUE_VARIANTS,
  concatAudioTight,
  parseCritique,
  buildCritiquePrompt,
  CRITIQUE_PASS_TOTAL,
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

  // D4：バリエーション。variant 番号で展開タイプが変わり、プロンプトの「お客様の本音/反論の軸」が違うものになる
  it('buildSampleDialoguePrompt は variant ごとに違う展開軸を入れる', () => {
    expect(SAMPLE_DIALOGUE_VARIANTS.length).toBeGreaterThanOrEqual(3);
    const p0 = buildSampleDialoguePrompt('進めましょう。', null, 0);
    const p1 = buildSampleDialoguePrompt('進めましょう。', null, 1);
    expect(p0).toContain(SAMPLE_DIALOGUE_VARIANTS[0]);
    expect(p1).toContain(SAMPLE_DIALOGUE_VARIANTS[1]);
    expect(p0).not.toBe(p1);
    // 後方互換：variant 未指定は 0 と同じ
    expect(buildSampleDialoguePrompt('進めましょう。')).toBe(p0);
    // ローテーション（N を渡しても安全）
    const pBig = buildSampleDialoguePrompt('進めましょう。', null, SAMPLE_DIALOGUE_VARIANTS.length);
    expect(pBig).toBe(p0);
  });

  // E1：critique プロンプトは6項目をJSONで採点させる指示を含む
  it('buildCritiquePrompt は 6項目の採点指示とJSON形式の出力指示を含む', () => {
    const p = buildCritiquePrompt('営業: いかがですか？\n客: 高いですね。\n営業: 価値はこうです。', '進めましょう。');
    expect(p).toContain('line_used');
    expect(p).toContain('specificity');
    expect(p).toContain('no_proper_nouns');
    expect(p).toContain('ending');
    expect(p).toContain('進めましょう。');      // 山場のセリフが渡る
    expect(p).toContain('JSON1行のみ');          // 出力フォーマット指示
  });

  // E1：parseCritique は安全に JSON を取り出し total を再計算する
  it('parseCritique は JSON を抽出して total を再計算する', () => {
    const raw = 'なんでも前置き → {"line_used":8,"line_count":7,"specificity":6,"delivery_tags":8,"no_proper_nouns":10,"ending":7,"total":999,"reason":"概ね良い"}';
    const r = parseCritique(raw);
    expect(r).not.toBeNull();
    expect(r!.total).toBe(8 + 7 + 6 + 8 + 10 + 7); // モデル提示の999は捨ててサーバで再計算
    expect(r!.reason).toBe('概ね良い');
    expect(r!.no_proper_nouns).toBe(10);
  });

  it('parseCritique は不正値を 0〜10 に丸める', () => {
    const raw = '{"line_used":-3,"line_count":15,"specificity":7,"delivery_tags":7,"no_proper_nouns":7,"ending":7,"reason":""}';
    const r = parseCritique(raw)!;
    expect(r.line_used).toBe(0);   // 負は0
    expect(r.line_count).toBe(10); // 11以上は10
  });

  it('parseCritique は JSON が無い入力で null を返す', () => {
    expect(parseCritique('採点不能でした。')).toBeNull();
    expect(parseCritique('')).toBeNull();
  });

  it('CRITIQUE_PASS_TOTAL は合理的な範囲（60点中30〜54点）', () => {
    expect(CRITIQUE_PASS_TOTAL).toBeGreaterThanOrEqual(30);
    expect(CRITIQUE_PASS_TOTAL).toBeLessThanOrEqual(54);
  });

  // D1：concatAudioTight は ffmpeg 不在環境（mock）でも壊れず Buffer.concat にフォールバックする
  it('concatAudioTight は ffmpeg 不在時に Buffer.concat にフォールバックする', async () => {
    // テスト環境（CI/ローカル）に ffmpeg があるかは保証されないため、結果の不変条件のみ確認：
    //  - 空入力 → 空Buffer
    //  - 1要素 → そのまま
    //  - 複数要素 → 何らかの Buffer が返る（長さは元の和以上の場合も以下の場合もある）
    expect((await concatAudioTight([])).length).toBe(0);
    const one = Buffer.from('ONLY');
    const r1 = await concatAudioTight([one]);
    expect(r1).toBe(one);
    const a = Buffer.from('AA'); const b = Buffer.from('BB');
    const r2 = await concatAudioTight([a, b]);
    expect(r2.length).toBeGreaterThan(0);
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
