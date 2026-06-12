/**
 * 理想クロージング台本生成 ＋ 本人声サンプル準備（FR-DATA-011 / FR-VOICE-001 / SDD §2）
 */
import Anthropic from '@anthropic-ai/sdk';

/** 理想クロージング台本生成プロンプト（純粋関数 / FR-DATA-011） */
export function buildIdealClosingPrompt(
  transcript: string,
  referenceBaseline?: string | null,
  context?: string | null
): string {
  const hasRef = !!(referenceBaseline && referenceBaseline.trim());
  const refBlock = hasRef
    ? `\n【ユーザー提供の理想基準（トークスクリプト/商材マニュアル）】\n以下のトーン・型に沿って作成してください。\n---基準---\n${referenceBaseline}\n---基準ここまで---\n`
    : '';
  const ctxBlock = (context && context.trim())
    ? `\n【商談の備考・相手の情報（音声に含まれない補足。必ず反映すること）】\n${context}\n（↑ この相手の業種・役職・課題・予算感・経緯に最適化した台本にすること）\n`
    : '';
  return `以下のセールス商談の文字起こしを踏まえ、この商談の「理想的なクロージング」を、本人がそのまま声に出して読める自然な話し言葉の台本として作成してください。
${refBlock}${ctxBlock}
要件:
- 実際にこの商材・この顧客文脈に即した内容にする（汎用テンプレにしない）
- 1〜2分で読み上げられる長さ（おおむね300〜600字）
- ナレーション記号や説明文は入れず、そのまま読み上げる本文のみを出力する
- 声に出して自然な口語にする（書き言葉にしない）

---商談文字起こし---
${transcript}
---ここまで---

理想クロージング台本（本文のみ）:`;
}

/** Claude で理想クロージング台本を生成する（FR-DATA-011）。apiKeyはBYOK。 */
export async function generateIdealClosingScript(
  transcript: string,
  referenceBaseline: string | null,
  apiKey: string,
  context: string | null = null
): Promise<string> {
  if (!apiKey || !apiKey.trim()) {
    throw new Error('Anthropic APIキーが設定されていません。設定ページでキーを入力してください。');
  }
  const client = new Anthropic({ apiKey });
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1200,
    messages: [{ role: 'user', content: buildIdealClosingPrompt(transcript, referenceBaseline, context) }],
  });
  const text = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
  return text.trim();
}

/**
 * 本人の声サンプルを準備する（FR-VOICE-001）。
 * MVP: アップ済み商談音声をそのまま声サンプルとして使う（Fish Audioは10秒〜5分を許容）。
 * 複数話者の本人特定（話者分離）はDEFER。空・極端に小さい場合はエラー（RISK-005）。
 */
export function prepareVoiceSample(audio: Buffer): Buffer {
  if (!audio || audio.length === 0) {
    throw new Error('声サンプルが空です。商談音声をアップロードしてください。');
  }
  // ざっくりの下限チェック（極小ファイル=実音声でない可能性）。約8KB未満は弾く。
  if (audio.length < 8 * 1024) {
    throw new Error('声サンプルが短すぎます。10秒以上の音声が必要です。');
  }
  return audio;
}
