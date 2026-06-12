// V-2 手動検証: 実Fish Audioで声クローン→音声合成（FR-VOICE-002/003）
// 実行: FISH_TEST_KEY=xxx npx tsx tests/manual/v2_voice.ts
import fs from 'fs';
import { FishAudioProvider } from '../../src/voice';

const SAMPLE = 'C:\\Users\\長沼有香\\Downloads\\voice_sample_40s.mp3';
const SCRIPT = '少し整理させてください。今、月20万円の広告費を使っていただいてるんですが、費用対効果が見えなくて不安、というのが一番のお悩みですよね。私どものサービスは、どの広告からどれだけ問い合わせが来ているかを可視化するところから始めます。';

(async () => {
  const key = process.env.FISH_TEST_KEY || '';
  if (!key) { console.error('NO KEY'); process.exit(1); }
  const provider = new FishAudioProvider();
  try {
    const sample = fs.readFileSync(SAMPLE);
    console.log('サンプルサイズ:', (sample.length / 1024 / 1024).toFixed(1), 'MB');
    console.log('--- 声ID作成中 ---');
    const voiceId = await provider.createVoiceId(sample, key);
    console.log('voiceId:', voiceId);
    console.log('--- 音声合成中 ---');
    const audio = await provider.synthesize(voiceId, SCRIPT, key);
    const out = 'C:\\Users\\長沼有香\\Downloads\\v2_声見本テスト.mp3';
    fs.writeFileSync(out, audio);
    console.log('音声を保存:', out, '(', (audio.length / 1024).toFixed(0), 'KB )');
    console.log('=== V-2 成功 ===');
  } catch (e) {
    console.error('ERROR:', e instanceof Error ? e.message : e);
    process.exit(1);
  }
})();
