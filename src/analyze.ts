import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { ExtractedContent } from './extractors';
import {
  SYSTEM_PROMPT,
  buildAnalysisPrompt,
  buildComparePrompt,
  FocusMode,
  CLOSING_SYSTEM_PROMPT,
  buildClosingAnalysisPrompt,
} from './prompts';

export type AnalysisEvent =
  | { type: 'progress'; step: 1 | 2 | 3 }
  | { type: 'content'; text: string }
  | { type: 'review'; text: string };

export type Provider = 'anthropic' | 'groq';

/** 分析モード: copy=従来のセールスコピー評価 / closing=商談クロージング会話評価 */
export type AnalyzeMode = 'copy' | 'closing';

export interface AnalyzeOptions {
  mode?: AnalyzeMode;
  /** 商談の備考・相手情報（音声に含まれない補足。closingモードで考慮） */
  context?: string | null;
  /** 任意: ユーザー提供の理想トークスクリプト/商材マニュアル（ハイブリッド評価） */
  referenceBaseline?: string | null;
}

export function getProvider(): Provider {
  const p = process.env.PROVIDER?.toLowerCase();
  return p === 'groq' ? 'groq' : 'anthropic';
}

export async function* analyzeContent(
  contents: ExtractedContent[],
  extraText: string,
  focus: FocusMode = 'full',
  apiKey = '',
  opts: AnalyzeOptions = {}
): AsyncGenerator<AnalysisEvent> {
  const mode: AnalyzeMode = opts.mode === 'closing' ? 'closing' : 'copy';
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
    yield* analyzeWithGroq(combinedText, hasImages, focus, apiKey, mode, opts);
  } else {
    yield* analyzeWithAnthropic(contents, combinedText, hasImages, imageContents, focus, apiKey, mode, opts);
  }
}

async function* analyzeWithAnthropic(
  _contents: ExtractedContent[],
  combinedText: string,
  hasImages: boolean,
  imageContents: ExtractedContent[],
  focus: FocusMode,
  apiKey = '',
  mode: AnalyzeMode = 'copy',
  opts: AnalyzeOptions = {}
): AsyncGenerator<AnalysisEvent> {
  const client = new Anthropic({ apiKey: apiKey || undefined });

  const isClosing = mode === 'closing';
  const systemPrompt = isClosing ? CLOSING_SYSTEM_PROMPT : SYSTEM_PROMPT;

  const userMessageContent: Anthropic.MessageParam['content'] = [];

  // 商談クロージングモードは文字起こしベース（身振り解析は対象外）。画像は付与しない。
  if (!isClosing) {
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
  }

  userMessageContent.push({
    type: 'text',
    text: isClosing
      ? buildClosingAnalysisPrompt(combinedText, opts.referenceBaseline, opts.context)
      : buildAnalysisPrompt(combinedText, hasImages, focus),
  });

  const stream = await client.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 6000,
    system: systemPrompt,
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
  focus: FocusMode,
  apiKey = '',
  mode: AnalyzeMode = 'copy',
  opts: AnalyzeOptions = {}
): AsyncGenerator<AnalysisEvent> {
  // BYOK: ユーザーキーのみ。サーバーキーをフォールバックに使わない（グローバルルール / SEC-001）
  if (!apiKey) {
    yield { type: 'content', text: '**エラー:** APIキーが設定されていません。設定ページでキーを入力してください。' };
    return;
  }
  const client = new OpenAI({
    apiKey,
    baseURL: 'https://api.groq.com/openai/v1',
  });

  const isClosing = mode === 'closing';

  yield { type: 'progress', step: 2 };

  const stream = await client.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    max_tokens: 6000,
    stream: true,
    messages: [
      { role: 'system', content: isClosing ? CLOSING_SYSTEM_PROMPT : SYSTEM_PROMPT },
      {
        role: 'user',
        content: isClosing
          ? buildClosingAnalysisPrompt(combinedText, opts.referenceBaseline, opts.context)
          : buildAnalysisPrompt(combinedText, hasImages, focus),
      },
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
  afterText: string,
  apiKey = ''
): AsyncGenerator<AnalysisEvent> {
  const provider = getProvider();
  const prompt = buildComparePrompt(beforeText, afterText);

  yield { type: 'progress', step: 1 };

  if (provider === 'groq') {
    if (!apiKey) {
      yield { type: 'content', text: '**エラー:** APIキーが設定されていません。' };
      yield { type: 'progress', step: 3 };
      return;
    }
    const client = new OpenAI({
      apiKey,
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
    const client = new Anthropic({ apiKey: apiKey || undefined });
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
