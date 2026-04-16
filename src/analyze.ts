import Anthropic from '@anthropic-ai/sdk';
import { ExtractedContent } from './extractors';
import { SYSTEM_PROMPT, buildAnalysisPrompt } from './prompts';

const client = new Anthropic();

export async function* analyzeContent(
  contents: ExtractedContent[],
  extraText: string
): AsyncGenerator<string> {
  // Build text content from all extracted files
  const textParts: string[] = [];
  const imageContents: ExtractedContent[] = [];

  for (const content of contents) {
    if (content.type === 'text' && content.text) {
      textParts.push(`=== ${content.filename} ===\n${content.text}`);
    } else if (content.type === 'image') {
      imageContents.push(content);
    }
  }

  if (extraText.trim()) {
    textParts.push(`=== 追加テキスト（貼り付け） ===\n${extraText}`);
  }

  const combinedText = textParts.join('\n\n');
  const hasImages = imageContents.length > 0;

  if (!combinedText.trim() && imageContents.length === 0) {
    yield '**エラー:** 分析対象のコンテンツがありません。ファイルをアップロードするか、テキストを貼り付けてください。';
    return;
  }

  // Build messages array with images if present
  const userMessageContent: Anthropic.MessageParam['content'] = [];

  // Add image contents first (slides/screenshots)
  for (const img of imageContents) {
    userMessageContent.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.imageMime as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
        data: img.imageBase64!,
      },
    });
  }

  // Add text content
  userMessageContent.push({
    type: 'text',
    text: buildAnalysisPrompt(combinedText, hasImages),
  });

  // Stage 1: Initial Analysis with Sonnet (fast, cost-effective)
  yield '## 🔄 分析中...\n\n';
  yield '**STAGE 1:** コンテンツを読み込んでいます...\n\n';

  // Use streaming with claude-sonnet-4-6 for main analysis
  const stream = await client.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 6000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessageContent }],
  });

  yield '**STAGE 2:** セールス要素を分析中...\n\n---\n\n';

  for await (const chunk of stream) {
    if (
      chunk.type === 'content_block_delta' &&
      chunk.delta.type === 'text_delta'
    ) {
      yield chunk.delta.text;
    }
  }

  const analysis = await stream.finalMessage();
  const analysisText = analysis.content[0].type === 'text' ? analysis.content[0].text : '';

  // Stage 2: Constitutional Review - verify advice is concrete, not abstract
  yield '\n\n---\n\n**STAGE 3:** Constitutional Review（抽象アドバイス検証中）...\n\n';

  const reviewStream = await client.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    messages: [
      {
        role: 'user',
        content: `以下のセールス分析レポートを審査してください。

審査基準：
1. 「〜が重要です」「〜を意識しましょう」で終わる抽象的なアドバイスはないか
2. スクリプト改善例は実際に使えるレベルか（曖昧ではないか）
3. 各スコアの根拠が素材から具体的に引用されているか
4. TOP3改善ポイントは本当に成約率インパクトが高いものか

審査結果を以下の形式で出力：
## ✅ 品質審査結果
- 具体性スコア: X/10
- 実装可能性: X/10
- 優先度の妥当性: X/10

**改善が必要な箇所（もしあれば）：**
（なければ「審査通過」と記載）

---

分析レポート:
${analysisText}`,
      },
    ],
  });

  for await (const chunk of reviewStream) {
    if (
      chunk.type === 'content_block_delta' &&
      chunk.delta.type === 'text_delta'
    ) {
      yield chunk.delta.text;
    }
  }

  yield '\n\n---\n\n*分析完了。上記のアドバイスを優先度1から実装してください。*';
}
