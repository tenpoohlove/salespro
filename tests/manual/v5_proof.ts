// V-5: 録音に無い別文章を根宜さんの声で生成（AI生成の証明）。声ID再利用＝再クローンなし
import fs from 'fs'; import os from 'os'; import path from 'path';
import { FishAudioProvider } from '../../src/voice';
const VOICE = '027d5ee7d60b4bc89f4fd203130dfc99';
const TEXT = 'テスト音声です。これはAIが生成しました。今日は2026年6月12日、東京は築地です。りんご、みかん、ぶどう。ゆかたんさん、こんにちは。';
(async () => {
  const p = new FishAudioProvider();
  const a = await p.synthesize(VOICE, TEXT, process.env.FISH_TEST_KEY || '');
  const out = path.join(os.homedir(), 'OneDrive', 'デスクトップ', '根宜さん声_別の文章で証明.mp3');
  fs.writeFileSync(out, a);
  console.log('保存:', out, '(', (a.length / 1024).toFixed(0), 'KB )');
})().catch(e => { console.error('ERR:', e instanceof Error ? e.message : e); process.exit(1); });
