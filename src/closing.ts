/**
 * 理想クロージング台本生成 ＋ 本人声サンプル準備（FR-DATA-011 / FR-VOICE-001 / SDD §2）
 */
import Anthropic from '@anthropic-ai/sdk';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

const execFileAsync = promisify(execFile);

/** 理想クロージング会話の1ターン。rep=営業担当(本人) / customer=お客様 */
export interface DialogueTurn {
  speaker: 'rep' | 'customer';
  text: string;
}

/**
 * 理想クロージング台本生成プロンプト（純粋関数 / FR-DATA-011）。
 * 営業担当(本人)とお客様の「会話（掛け合い）」として生成する（一人語りにしない）。
 * analysisFindings を渡すと、その添削で指摘された弱点を必ず修正した理想クロージングにする。
 */
export function buildIdealClosingPrompt(
  transcript: string,
  referenceBaseline?: string | null,
  context?: string | null,
  analysisFindings?: string | null
): string {
  const hasRef = !!(referenceBaseline && referenceBaseline.trim());
  const refBlock = hasRef
    ? `\n【ユーザー提供の理想基準（トークスクリプト/商材マニュアル）】\n以下のトーン・型に沿って作成してください。\n---基準---\n${referenceBaseline}\n---基準ここまで---\n`
    : '';
  const ctxBlock = (context && context.trim())
    ? `\n【商談の備考・相手の情報（音声に含まれない補足。必ず反映すること）】\n${context}\n（↑ この相手の業種・役職・課題・予算感・経緯に最適化した台本にすること）\n`
    : '';
  const hasFindings = !!(analysisFindings && analysisFindings.trim());
  const findingsBlock = hasFindings
    ? `\n【この商談の添削で指摘された弱点（必ずこれらを修正した理想クロージングにすること）】\n${analysisFindings}\n（↑ 特に「反論処理・価値提示・次アクションの確保」で指摘された点を、理想の掛け合いで具体的に修正する）\n`
    : '';
  return `以下のセールス商談の文字起こしを踏まえ、この商談の「理想的なクロージング」を、営業担当(本人)とお客様の自然な会話（掛け合い）として作成してください。${hasFindings ? '上記でなく下記の添削結果を最優先で反映します。' : ''}
${refBlock}${ctxBlock}${findingsBlock}
要件:
- 営業担当(本人)とお客様の対話形式にする。一人語りにしない（お客様の反応・反論も自然に含める）。
- ${hasFindings ? '添削で指摘された弱点を具体的に修正した理想の流れにする。' : '実際にこの商材・この顧客文脈に即した内容にする（汎用テンプレにしない）。'}
- 全体で1〜2分程度（営業担当の発話合計でおおむね300〜500字）。冗長にしない。
- 出力は「セリフ本文のみ」。各行を必ず "営業:" または "客:" で始める。ナレーション・説明・記号・ト書きは一切入れない。
- 声に出して自然な口語にする（書き言葉にしない）。

---商談文字起こし---
${transcript}
---ここまで---

理想クロージングの会話（各行を 営業: または 客: で始める。本文のみ）:`;
}

/**
 * 理想クロージング台本（"営業:"/"客:" 形式のテキスト）を会話ターン配列に分解する（純粋関数）。
 * ラベルの無い行は直前の話者の続きとして連結する（保険）。
 */
export function parseClosingDialogue(script: string): DialogueTurn[] {
  const turns: DialogueTurn[] = [];
  for (const raw of (script || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(営業|客|お客様|顧客)\s*[:：]\s*(.+)$/);
    if (!m) {
      if (turns.length) turns[turns.length - 1].text += ' ' + line;
      continue;
    }
    const speaker: DialogueTurn['speaker'] = m[1] === '営業' ? 'rep' : 'customer';
    const text = m[2].trim();
    if (text) turns.push({ speaker, text });
  }
  return turns;
}

/** Claude で理想クロージング台本を生成する（FR-DATA-011）。apiKeyはBYOK。 */
export async function generateIdealClosingScript(
  transcript: string,
  referenceBaseline: string | null,
  apiKey: string,
  context: string | null = null,
  analysisFindings: string | null = null
): Promise<string> {
  if (!apiKey || !apiKey.trim()) {
    throw new Error('Anthropic APIキーが設定されていません。設定ページでキーを入力してください。');
  }
  const client = new Anthropic({ apiKey });
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1200,
    messages: [{ role: 'user', content: buildIdealClosingPrompt(transcript, referenceBaseline, context, analysisFindings) }],
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

/**
 * ffmpeg 実行ファイルのパスを解決する（一度だけ・メモ化）。
 * 優先順: 環境変数 FFMPEG_PATH → imageio-ffmpeg(python) → PATH上の ffmpeg。
 * 見つからなければ null（呼び出し側は元データのままにフォールバック）。
 */
let _ffmpegPath: string | null | undefined;
export function getFfmpegPath(): string | null {
  if (_ffmpegPath !== undefined) return _ffmpegPath;

  // 1) ffmpeg-static（最優先・クロスプラットフォーム／Win+Linux／文字化けなし）
  //    JS提供のパスなので日本語ユーザー名でも壊れない（python stdout経由だと文字化けでENOENTになる）。
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ffStatic = require('ffmpeg-static') as string | { default?: string } | null;
    const p = typeof ffStatic === 'string' ? ffStatic : ffStatic?.default ?? null;
    if (p && fs.existsSync(p)) {
      _ffmpegPath = p;
      return _ffmpegPath;
    }
  } catch {
    /* 未インストールなら次へ */
  }

  // 2) 明示指定
  const envPath = process.env.FFMPEG_PATH;
  if (envPath && fs.existsSync(envPath)) {
    _ffmpegPath = envPath;
    return _ffmpegPath;
  }

  // 3) imageio-ffmpeg（python）。-X utf8 でstdoutをUTF-8に固定し、日本語パスの文字化けを防ぐ。
  for (const py of ['python', 'python3', 'py']) {
    try {
      const out = execFileSync(py, ['-X', 'utf8', '-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (out && fs.existsSync(out)) {
        _ffmpegPath = out;
        return _ffmpegPath;
      }
    } catch {
      /* 次の候補へ */
    }
  }

  // 4) PATH上の ffmpeg（GCP Linux VMで apt install ffmpeg した場合など）
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    _ffmpegPath = 'ffmpeg';
    return _ffmpegPath;
  } catch {
    /* not found */
  }

  _ffmpegPath = null;
  return _ffmpegPath;
}

/**
 * 声サンプルを Fish Audio が安定して処理できる長さ・形式に整える（FR-VOICE-001 / RISK / 524対策）。
 * - 先頭から maxSeconds 秒（既定50秒）だけ切り出す（長尺=10MB/15分は Fish が524タイムアウトするため）
 * - mono / 22.05kHz / mp3 に再エンコードして軽量化
 * ffmpeg が無い環境では検証のみ行い、元データをそのまま返す（機能を止めない）。
 */
export async function trimVoiceSample(audio: Buffer, maxSeconds = 50): Promise<Buffer> {
  // 空・極小は先にエラー（高コストな台本生成より前に弾く想定）
  prepareVoiceSample(audio);

  const ffmpeg = getFfmpegPath();
  if (!ffmpeg) {
    // ffmpeg不在: トリミングできないが機能は継続（Fish側の制限に委ねる）
    return audio;
  }

  const tmp = os.tmpdir();
  const id = crypto.randomBytes(8).toString('hex');
  const inPath = path.join(tmp, `voice_in_${id}`);
  const outPath = path.join(tmp, `voice_out_${id}.mp3`);
  try {
    fs.writeFileSync(inPath, audio);
    // -t で長さを上限カット。-ac 1 mono / -ar 22050 / mp3 で軽量化。-y 上書き。
    await execFileAsync(
      ffmpeg,
      ['-y', '-i', inPath, '-t', String(maxSeconds), '-ac', '1', '-ar', '22050', '-c:a', 'libmp3lame', '-q:a', '5', outPath],
      { timeout: 60_000 }
    );
    const out = fs.readFileSync(outPath);
    if (!out || out.length === 0) {
      // 変換失敗（無音/破損等）: 元データにフォールバック
      return audio;
    }
    return out;
  } catch {
    // 変換エラー時も機能を止めず元データを使う
    return audio;
  } finally {
    try { fs.existsSync(inPath) && fs.unlinkSync(inPath); } catch { /* noop */ }
    try { fs.existsSync(outPath) && fs.unlinkSync(outPath); } catch { /* noop */ }
  }
}
