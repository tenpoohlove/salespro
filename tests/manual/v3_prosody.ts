// V-3 手動検証: 抑揚マーカー付き台本 → Fish合成（プロソディ検証）
// 実行: ANTHROPIC_TEST_KEY=xxx FISH_TEST_KEY=xxx npx tsx tests/manual/v3_prosody.ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { FishAudioProvider } from '../../src/voice';

const VOICE_ID = '936ce6a33b6a4f379517128a82cb7195'; // 先のテストで作成済みの声ID（再利用＝再クローンしない）
const BASE_SCRIPT = `少し整理させてください。今、月20万円の広告費を使っていただいてるんですが、費用対効果が見えなくて不安、というのが一番のお悩みですよね。私どものサービスは、どの広告からどれだけ問い合わせが来ているかを可視化するところから始めます。月5万円のご負担はありますが、今の20万が最適化されれば、むしろトータルは下がる可能性が高いんです。もし気になる点があれば、そこをお答えしてから判断してください。`;

const MARKUP_PROMPT = `あなたはセールス音声演出の専門家です。次のクロージング台本に、Fish Audio S2 の抑揚指示を埋め込んで、説得力のある営業クロージングの「お手本音声」にしてください。

ルール:
- 角括弧で喋り方を指定する。例: [落ち着いて] [ゆっくり] [一拍おく] [力を込めて] [声を少し落として] [温かく] [語りかけるように] [自信を持って]
- 間は「…」で表現する
- 共感→価値の提示→そっと背中を押す、の流れで抑揚の起伏をつける（平坦にしない）
- 文章自体は大きく変えない。喋り方の演出を足す
- 出力は台本本文のみ（説明や前置きは不要）

元の台本:
${BASE_SCRIPT}`;

(async () => {
  const aKey = process.env.ANTHROPIC_TEST_KEY || '';
  const fKey = process.env.FISH_TEST_KEY || '';
  if (!aKey || !fKey) { console.error('NO KEY'); process.exit(1); }

  // 1) Claudeで抑揚マーカー付き台本を生成
  const client = new Anthropic({ apiKey: aKey });
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 1200,
    messages: [{ role: 'user', content: MARKUP_PROMPT }],
  });
  const marked = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : '';
  console.log('=== 抑揚マーカー付き台本 ===');
  console.log(marked);

  // 2) Fishで合成（声IDは再利用）
  const provider = new FishAudioProvider();
  const audio = await provider.synthesize(VOICE_ID, marked, fKey);
  const out = path.join(os.homedir(), 'OneDrive', 'デスクトップ', '声見本テスト_抑揚あり.mp3');
  fs.writeFileSync(out, audio);
  console.log('\n保存:', out, '(', (audio.length / 1024).toFixed(0), 'KB )');
  console.log('=== 完了 ===');
})().catch(e => { console.error('ERROR:', e instanceof Error ? e.message : e); process.exit(1); });
