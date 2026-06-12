// V-1 手動検証: 実Anthropicキーで理想クロージング台本生成（FR-DATA-011）
// 実行: ANTHROPIC_TEST_KEY=xxx npx tsx tests/manual/v1_script.ts
import { generateIdealClosingScript } from '../../src/closing';

const sample = `営業: 本日はお時間ありがとうございます。御社の集客の課題、もう少し詳しく聞かせてください。
お客様: 広告は出してるんですが、なかなか問い合わせに繋がらなくて。
営業: なるほど。今は月いくらくらい広告に使ってますか？
お客様: 20万くらいです。でも費用対効果が見えなくて不安で。
営業: わかりました。うちのサービスを使うと改善できると思います。料金は月5万円です。いかがですか？
お客様: うーん、ちょっと検討します。`;

(async () => {
  const key = process.env.ANTHROPIC_TEST_KEY || '';
  if (!key) { console.error('NO KEY'); process.exit(1); }
  try {
    const script = await generateIdealClosingScript(sample, null, key);
    console.log('=== 理想クロージング台本 ===');
    console.log(script);
    console.log('=== 文字数:', script.length, '===');
  } catch (e) {
    console.error('ERROR:', e instanceof Error ? e.message : e);
    process.exit(1);
  }
})();
