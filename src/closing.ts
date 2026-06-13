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
