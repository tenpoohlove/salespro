import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { ExtractedContent } from './extractors';
import { SYSTEM_PROMPT, buildAnalysisPrompt, buildComparePrompt, FocusMode } from './prompts';

export type AnalysisEvent =
  | { type: 'progress'; step: 1 | 2 | 3 }
  | { type: 'content'; text: string }
  | { type: 'review'; text: string };

export type Provider = 'anthropic' | 'groq';

export function getProvider(): Provider {
  const p = process.env.PROVIDER?.toLowerCase();
  return p === 'groq' ? 'groq' : 'anthropic';
}

export async function* analyzeContent(
  contents: ExtractedContent[],
  extraText: string,
  focus: FocusMode = 'full'
): AsyncGenerator<AnalysisEvent> {
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
    yield { type: 'content', text: '**エラー:** 分析対象のコンテンツがありません。' };
    return;
  }

  const provider = getProvider();

  yield { type: 'progress', step: 1 };

  if (provider === 'groq') {
    yield* analyzeWithGroq(combinedText, hasImages, focus);
  } else {
    yield* analyzeWithAnthropic(contents, combinedText, hasImages, imageContents, focus);
  }
}

async function* analyzeWithAnthropic(
  _contents: ExtractedContent[],
  combinedText: string,
  hasImages: boolean,
  imageContents: ExtractedContent[],
  focus: FocusMode
): AsyncGenerator<AnalysisEvent> {
  const client = new Anthropic();

  const userMessageContent: Anthropic.MessageParam['content'] = [];

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

  userMessageContent.push({
    type: 'text',
    text: buildAnalysisPrompt(combinedText, hasImages, focus),
  });

  const stream = await client.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 6000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessageContent }],
  });

  yield { type: 'progress', step: 2 };

  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
      yield { type: 'content', text: chunk.delta.text };
    }
  }

  const analysis = await stream.finalMessage();
  const analysisText = analysis.content[0].type === 'text' ? analysis.content[0].text : '';

  yield { type: 'progress', step: 3 };

  const reviewStream = await client.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    messages: [{ role: 'user', content: buildReviewPrompt(analysisText) }],
  });

  for await (const chunk of reviewStream) {
    if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
      yield { type: 'review', text: chunk.delta.text };
    }
  }
}

async function* analyzeWithGroq(
  combinedText: string,
  hasImages: boolean,
  focus: FocusMode
): AsyncGenerator<AnalysisEvent> {
  const client = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1',
  });

  yield { type: 'progress', step: 2 };

  const stream = await client.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    max_tokens: 6000,
    stream: true,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildAnalysisPrompt(combinedText, hasImages, focus) },
    ],
  });

  let analysisText = '';
  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content ?? '';
    if (text) {
      analysisText += text;
      yield { type: 'content', text };
    }
  }

  yield { type: 'progress', step: 3 };

  const reviewStream = await client.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    max_tokens: 1000,
    stream: true,
    messages: [{ role: 'user', content: buildReviewPrompt(analysisText) }],
  });

  for await (const chunk of reviewStream) {
    const text = chunk.choices[0]?.delta?.content ?? '';
    if (text) yield { type: 'review', text };
  }
}

export async function* compareContent(
  beforeText: string,
  afterText: string
): AsyncGenerator<AnalysisEvent> {
  const provider = getProvider();
  const prompt = buildComparePrompt(beforeText, afterText);

  yield { type: 'progress', step: 1 };

  if (provider === 'groq') {
    const client = new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1',
    });
    yield { type: 'progress', step: 2 };
    const stream = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 6000,
      stream: true,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
    });
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content ?? '';
      if (text) yield { type: 'content', text };
    }
  } else {
    const client = new Anthropic();
    const stream = await client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 6000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });
    yield { type: 'progress', step: 2 };
    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        yield { type: 'content', text: chunk.delta.text };
      }
    }
  }

  yield { type: 'progress', step: 3 };
}

function buildReviewPrompt(analysisText: string): string {
  return `以下のセールス分析レポートを審査してください。

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
${analysisText}`;
}
