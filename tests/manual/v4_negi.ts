// V-4: 根宜さんの実声で声クローン→同一台本を合成（身元確認）
// 実行: FISH_TEST_KEY=xxx npx tsx tests/manual/v4_negi.ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { FishAudioProvider } from '../../src/voice';

const SAMPLE = path.join(os.homedir(), 'OneDrive', 'ドキュメント', 'NATULUCK 築地東銀座 会議室 2.m4a');
// 根宜さんが読んだのと同じ台本（素のテキスト・マーカーなし）
const SCRIPT = `こんにちは、本日はお時間をいただき、ありがとうございます。今日お話しするのは、あなたの成約率を、今よりもっと高めるための仕組みです。正直に言いますね。多くの方が、いい商品を持っているのに、伝え方ひとつで売上を逃しています。もし、その伝え方を変えるだけで結果が変わるとしたら、試してみたくありませんか？大丈夫です。私が最後までサポートします。一緒に、次の一歩を踏み出しましょう。`;

(async () => {
  const key = process.env.FISH_TEST_KEY || '';
  if (!key) { console.error('NO KEY'); process.exit(1); }
  const provider = new FishAudioProvider();
  const sample = fs.readFileSync(SAMPLE);
  console.log('サンプル:', (sample.length/1024).toFixed(0), 'KB');
  console.log('--- 声ID作成中（根宜さんの声） ---');
  const voiceId = await provider.createVoiceId(sample, key);
  console.log('voiceId:', voiceId);
  console.log('--- 同一台本を合成中 ---');
  const audio = await provider.synthesize(voiceId, SCRIPT, key);
  const out = path.join(os.homedir(), 'OneDrive', 'デスクトップ', '根宜さん声クローン_同一台本.mp3');
  fs.writeFileSync(out, audio);
  console.log('保存:', out, '(', (audio.length/1024).toFixed(0), 'KB )');
  console.log('voiceIdをメモ:', voiceId);
})().catch(e => { console.error('ERROR:', e instanceof Error ? e.message : e); process.exit(1); });
