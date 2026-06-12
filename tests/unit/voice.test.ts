import { describe, it, expect, afterEach } from 'vitest';
import {
  cacheKey,
  isDryRun,
  getVoiceProvider,
  MockVoiceProvider,
  FishAudioProvider,
} from '../../src/voice';

describe('voice.ts 声クローン基盤', () => {
  afterEach(() => {
    delete process.env.DRY_RUN;
  });

  // TC-VOICE-004: キャッシュキーは voiceId+台本 で決定論的
  it('cacheKey は同じ入力で同じ・違う入力で異なる', () => {
    const a = cacheKey('v1', '台本A');
    const b = cacheKey('v1', '台本A');
    const c = cacheKey('v1', '台本B');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toHaveLength(64); // sha256 hex
  });

  // SEC-001/CONSTRAINTS: キー無し or DRY_RUN は Mock（外部送信・課金しない）
  it('キー無し・DRY_RUN では isDryRun=true で Mock を選ぶ', () => {
    expect(isDryRun('')).toBe(true);
    expect(isDryRun(null)).toBe(true);
    expect(isDryRun(undefined)).toBe(true);
    process.env.DRY_RUN = 'true';
    expect(isDryRun('real-key')).toBe(true);
    delete process.env.DRY_RUN;
    expect(isDryRun('real-key')).toBe(false);
  });

  it('getVoiceProvider はキー無しで Mock、キー有りで Fish を返す', () => {
    expect(getVoiceProvider('').name).toBe('mock');
    expect(getVoiceProvider(null).name).toBe('mock');
    expect(getVoiceProvider('sk-fish-xxx').name).toBe('fish-audio');
  });

  // TC-VOICE-002/003: Mock は外部送信なしで決定論的に動く
  it('MockVoiceProvider は決定論的な voiceID とダミー音声を返す', async () => {
    const p = new MockVoiceProvider();
    const sample = Buffer.from('dummy-audio-sample');
    const id1 = await p.createVoiceId(sample, '');
    const id2 = await p.createVoiceId(sample, '');
    expect(id1).toBe(id2);
    expect(id1).toMatch(/^mock-voice-/);
    const audio = await p.synthesize(id1, 'これはテスト台本です', '');
    expect(audio.toString('utf8')).toContain('MOCK_AUDIO');
    expect(audio.toString('utf8')).toContain('これはテスト台本です');
  });

  it('FishAudioProvider のインスタンスが生成できる(name=fish-audio)', () => {
    expect(new FishAudioProvider().name).toBe('fish-audio');
  });
});
