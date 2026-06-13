import { describe, it, expect, vi, beforeEach } from 'vitest';

// Anthropic SDK をモックし、analyzeContent が送る system/user プロンプトを捕捉する。
// 目的: 「商談クロージングモード」のルーティング検証（リグレッション RISK-008）。
const streamCalls: any[] = [];

function fakeStream() {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: '...' } };
    },
    async finalMessage() {
      return { content: [{ type: 'text', text: 'dummy analysis' }] };
    },
  };
}

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class FakeAnthropic {
      messages = {
        stream: (args: any) => {
          streamCalls.push(args);
          return Promise.resolve(fakeStream());
        },
      };
    },
  };
});

import { analyzeContent } from '../../src/analyze';
import { SYSTEM_PROMPT, CLOSING_SYSTEM_PROMPT } from '../../src/prompts';

async function drain(gen: AsyncGenerator<any>) {
  for await (const _ of gen) { /* consume */ }
}

describe('analyzeContent モード分岐（copy / closing）', () => {
  beforeEach(() => {
    streamCalls.length = 0;
    process.env.PROVIDER = 'anthropic';
  });

  it('copyモード（既定）は SYSTEM_PROMPT を使い、商談軸を含まない', async () => {
    await drain(analyzeContent([{ type: 'text', filename: 'a.txt', text: 'コピー本文' } as any], '', 'full', 'sk-ant-test'));
    const first = streamCalls[0];
    expect(first.system).toBe(SYSTEM_PROMPT);
    const userText = first.messages[0].content.find((c: any) => c.type === 'text').text;
    expect(userText).not.toContain('MEDDPICC');
  });

  it('closingモードは CLOSING_SYSTEM_PROMPT＋MEDDPICC＋備考/基準を送る', async () => {
    await drain(
      analyzeContent(
        [{ type: 'text', filename: 't.txt', text: '商談の文字起こし本文' } as any],
        '',
        'full',
        'sk-ant-test',
        { mode: 'closing', context: '相手は製造業の役員', referenceBaseline: '理想トーク本文' }
      )
    );
    const first = streamCalls[0];
    expect(first.system).toBe(CLOSING_SYSTEM_PROMPT);
    const userText = first.messages[0].content.find((c: any) => c.type === 'text').text;
    expect(userText).toContain('MEDDPICC');
    expect(userText).toContain('商談の文字起こし本文');
    expect(userText).toContain('相手は製造業の役員'); // context が反映される
    expect(userText).toContain('理想トーク本文'); // referenceBaseline が反映される
  });

  it('closingモードでは画像を添付しない（文字起こしベース）', async () => {
    await drain(
      analyzeContent(
        [
          { type: 'text', filename: 't.txt', text: '商談本文' } as any,
          { type: 'image', filename: 'x.png', imageMime: 'image/png', imageBase64: 'AAAA' } as any,
        ],
        '',
        'full',
        'sk-ant-test',
        { mode: 'closing' }
      )
    );
    const first = streamCalls[0];
    const hasImage = first.messages[0].content.some((c: any) => c.type === 'image');
    expect(hasImage).toBe(false);
  });
});
