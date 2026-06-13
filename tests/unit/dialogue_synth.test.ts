import { describe, it, expect } from 'vitest';
import { synthesizeDialogue, pickCustomerVoiceId } from '../../src/closing';
import { MockVoiceProvider } from '../../src/voice';

describe('synthesizeDialogue 理想クロージングの2声合成', () => {
  it('営業=本人声 / 客=汎用声 で各ターンを合成し連結する', async () => {
    const mock = new MockVoiceProvider();
    const turns = [
      { speaker: 'rep' as const, text: 'こんにちは' },
      { speaker: 'customer' as const, text: '高いですね' },
      { speaker: 'rep' as const, text: '価値はこうです' },
    ];
    const out = await synthesizeDialogue(turns, mock, 'V_REP', 'key', 'V_CUST');
    const s = out.toString('utf8');
    expect(s).toContain('V_REP::こんにちは'); // 営業ターンは本人のクローン声
    expect(s).toContain('V_CUST::高いですね'); // 客ターンは汎用声
    expect(s).toContain('V_REP::価値はこうです');
  });

  it('空の会話はエラーにする', async () => {
    await expect(synthesizeDialogue([], new MockVoiceProvider(), 'V', 'k')).rejects.toThrow();
  });

  it('pickCustomerVoiceId は性別で分岐（環境変数未設定なら空＝Fish既定声）', () => {
    expect(pickCustomerVoiceId('female')).toBe(process.env.CUSTOMER_VOICE_FEMALE || '');
    expect(pickCustomerVoiceId('男性')).toBe(process.env.CUSTOMER_VOICE_MALE || '');
    expect(pickCustomerVoiceId(null)).toBe(process.env.CUSTOMER_VOICE_FEMALE || ''); // 既定は女性
  });
});
