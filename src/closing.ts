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
import type { VoiceProvider } from './voice';

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
${IDEAL_CLOSING_BENCHMARKS}
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
 * フル尺の理想クロージングを構成する6セクション（最初から最後までを網羅）。
 * 元の商談の流れを、理想形で「最初から最後まで」再現するための章立て。
 */
export const CLOSING_SECTIONS = [
  '導入・本題への接続（関係づくりと商談目的の確認）',
  'ヒアリング・課題/ニーズの深掘り（Pain Articulation）',
  '価値提示・提案（課題に対する解決策と効果の提示）',
  '反論・懸念・価格への対応（Objection Handling）',
  'クロージング（決断の後押し・申し込みの確認）',
  '次アクションの確定（具体的な次の約束の取り付け）',
] as const;

/**
 * 理想クロージング台本が必ず満たす実証ベンチマーク（research/closing_evaluation_criteria_report.md 由来）。
 * Gong大規模通話分析・MEDDPICC・Challenger Sale を、日本式の信頼構築・合意形成に調整したもの。
 * 添削(prompts.ts)と同じ根拠を台本生成にも直接注入し、台本をリサーチベースにする。
 */
export const IDEAL_CLOSING_BENCHMARKS = `【この理想クロージングが必ず満たす実証ベンチマーク（Gong大規模通話分析32.6万件超／MEDDPICC／Challenger Sale を、日本式の信頼構築・合意形成に調整）】
- 痛みは顧客自身に語らせ、商談全体で3〜4件発掘する（Pain Articulation：成約と最も相関）
- 営業が話しすぎない：傾聴比は担当43：顧客57を目安に、一度の独り語りは約2分30秒を超えない
- 質問は顧客の課題・ゴール・懸念に焦点（目安11〜14問。決裁者相手は約4問に絞る＝尋問にしない）
- 価格は価値に紐付けて主導し、具体的なコミットメントと次工程の主導権を握る（Challenger 'Take Control'。ただし日本式に合意形成しながら）
- MEDDPICC要素（定量効果Metrics・決裁者・決定基準・決定プロセス・稟議プロセス・競合）を会話の中で自然に確認する
- 最後に必ず具体的な次アクション（日程・関係者・合意）を取り付ける（最速成約ディールはnext-step議論に+53%多く時間を割く）
※これらは大規模データの相関シグナルであり因果則ではない。機械的に詰め込まず、自然な会話の流れの中で満たすこと。`;

/** 各セクションで特に効かせるリサーチ原則（CLOSING_SECTIONS と同じ並び）。 */
export const SECTION_FOCUS = [
  '関係構築と商談目的のすり合わせ（ラポール形成）。本題への自然な接続。',
  '痛みを顧客自身に3〜4件語らせる。課題/ゴール/懸念に焦点を当てた質問で深掘りし、傾聴比は担当43：顧客57を保つ（話しすぎない）。',
  '発掘した痛みに直接紐付けた価値提示。定量効果（Metrics）を具体的に示す。',
  '価格・懸念に対し、価値へ紐付けて主導しつつ、日本式に合意形成する（攻撃的にしない）。',
  'Take Control：具体的なコミットメントを丁寧に迫り、決断を後押しする。決定プロセス・稟議も確認。',
  '具体的な次アクション（日程・関係者・合意）を必ず取り付けて締める。',
] as const;

/**
 * フル尺・理想クロージングの「1セクション」を生成するプロンプト（純粋関数 / FR-DATA-011）。
 * 元動画に近い長さにするため、targetCharsPerSection でこのパートの分量を指示する。
 */
export function buildSectionPrompt(
  sectionLabel: string,
  sectionIndex: number,
  sectionTotal: number,
  transcript: string,
  referenceBaseline?: string | null,
  context?: string | null,
  analysisFindings?: string | null,
  prevTail?: string | null,
  targetCharsPerSection = 1500
): string {
  const refBlock = (referenceBaseline && referenceBaseline.trim())
    ? `\n【理想基準（トーン/型・ここに沿う）】\n${referenceBaseline}\n` : '';
  const ctxBlock = (context && context.trim())
    ? `\n【相手情報・備考（必ず反映）】\n${context}\n` : '';
  const findingsBlock = (analysisFindings && analysisFindings.trim())
    ? `\n【添削で指摘された弱点（必ず具体的に修正する）】\n${analysisFindings}\n` : '';
  const prevBlock = (prevTail && prevTail.trim())
    ? `\n【直前パートの終わり（ここから自然に続ける）】\n...${prevTail}\n` : '';
  const focusBlock = SECTION_FOCUS[sectionIndex]
    ? `\n【このパートで特に意識する点（リサーチ原則）】\n${SECTION_FOCUS[sectionIndex]}\n` : '';
  return `あなたはトップセールスのクロージング指導者です。以下の実際の商談を踏まえ、この商談の「理想的なクロージング」を最初から最後まで作り込みます。今回はそのうち【パート${sectionIndex + 1}/${sectionTotal}：${sectionLabel}】だけを、営業担当(本人)とお客様の自然な会話（掛け合い）として書いてください。
${refBlock}${ctxBlock}${findingsBlock}${prevBlock}
${IDEAL_CLOSING_BENCHMARKS}
${focusBlock}
要件:
- このパート（${sectionLabel}）の内容に集中する。他パートの話に踏み込まない。
- 営業担当(本人)とお客様の対話形式にする（一人語りにしない。お客様の反応・質問・反論も自然に入れる）。
- この商材・この顧客文脈に即した具体的な中身にする（汎用テンプレ禁止）。${(analysisFindings && analysisFindings.trim()) ? '添削の指摘を具体的に修正すること。' : ''}
- このパートの分量は日本語で約${targetCharsPerSection}字。
- 出力は「セリフ本文のみ」。各行を必ず "営業:" または "客:" で始める。見出し・ナレーション・記号・ト書きは入れない。
- 声に出して自然な口語にする（書き言葉にしない）。

---実際の商談（文字起こし）---
${transcript}
---ここまで---

【パート${sectionIndex + 1}：${sectionLabel}】の理想会話（各行を 営業: または 客: で始める。本文のみ）:`;
}

/**
 * フル尺の理想クロージング台本を生成する（FR-DATA-011・BYOK Anthropic）。
 * セクション分割で複数回生成→連結することで、出力上限を回避しつつ品質を安定させ、
 * 元動画に近い長さ（targetCharsPerSection × セクション数）にする。
 * onProgress はセクションごとの進捗（done/total）を通知する。
 */
export async function generateFullIdealClosingScript(
  transcript: string,
  referenceBaseline: string | null,
  apiKey: string,
  context: string | null = null,
  analysisFindings: string | null = null,
  targetCharsPerSection = 1500,
  onProgress?: (done: number, total: number) => void
): Promise<string> {
  if (!apiKey || !apiKey.trim()) {
    throw new Error('Anthropic APIキーが設定されていません。設定ページでキーを入力してください。');
  }
  const client = new Anthropic({ apiKey });
  const total = CLOSING_SECTIONS.length;
  const parts: string[] = [];
  let prevTail = '';
  for (let i = 0; i < total; i++) {
    const prompt = buildSectionPrompt(
      CLOSING_SECTIONS[i], i, total, transcript, referenceBaseline, context, analysisFindings, prevTail, targetCharsPerSection
    );
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: Math.min(8000, Math.max(1500, Math.ceil(targetCharsPerSection * 2.2))),
      messages: [{ role: 'user', content: prompt }],
    });
    const text = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : '';
    if (text) parts.push(text);
    prevTail = text.slice(-300);
    if (onProgress) onProgress(i + 1, total);
  }
  return parts.join('\n');
}

/**
 * 入力商談の長さ（分）から、1セクションあたりの目標文字数を決める（純粋関数）。
 * 元動画に近い長さの音声にするための配分。日本語の話速を約300字/分として、
 * 全体目標字数 = minutes × 300 を CLOSING_SECTIONS 数で割る。安全のため1セクションは150〜3500字に収める。
 * floorを150にしているのは、5分・10分など短尺のテスト生成（コスト最小で品質確認）を正しく反映するため。
 */
export function targetCharsForMinutes(minutes: number, sections = CLOSING_SECTIONS.length): number {
  const totalChars = Math.max(1, minutes) * 300;
  const per = Math.round(totalChars / sections);
  return Math.min(3500, Math.max(150, per));
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

/**
 * お客様役の汎用声(Fish reference_id)を性別から選ぶ。
 * 環境変数 CUSTOMER_VOICE_FEMALE / CUSTOMER_VOICE_MALE に Fish の公開モデルIDを設定可能。
 * 未設定なら空文字＝Fish既定の声で合成（顧客はクローンしない＝同意問題を回避）。
 */
export function pickCustomerVoiceId(gender?: string | null): string {
  const g = (gender || 'female').toString().toLowerCase();
  if (g === 'male' || g === 'm' || g === '男性' || g === '男') {
    return process.env.CUSTOMER_VOICE_MALE || '';
  }
  return process.env.CUSTOMER_VOICE_FEMALE || '';
}

/**
 * 複数のmp3バッファを1本に連結する。ffmpegで均一に再エンコードして結合（声が違ってもグリッチしない）。
 * ffmpeg不在・失敗時は素朴な Buffer.concat にフォールバック（mock/テスト用）。
 */
export async function concatAudio(segments: Buffer[]): Promise<Buffer> {
  if (segments.length === 0) return Buffer.alloc(0);
  if (segments.length === 1) return segments[0];

  const ffmpeg = getFfmpegPath();
  if (!ffmpeg) return Buffer.concat(segments);

  const tmp = os.tmpdir();
  const id = crypto.randomBytes(8).toString('hex');
  const files: string[] = [];
  const listPath = path.join(tmp, `concat_${id}.txt`);
  const outPath = path.join(tmp, `concat_${id}.mp3`);
  try {
    let list = '';
    for (let i = 0; i < segments.length; i++) {
      const f = path.join(tmp, `seg_${id}_${i}.mp3`);
      fs.writeFileSync(f, segments[i]);
      files.push(f);
      list += `file '${f.replace(/'/g, "'\\''")}'\n`;
    }
    fs.writeFileSync(listPath, list);
    // 均一に再エンコードして結合（reference声と既定声でパラメータが違ってもOK）
    await execFileAsync(
      ffmpeg,
      ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c:a', 'libmp3lame', '-ar', '44100', '-b:a', '128k', outPath],
      { timeout: 120_000 }
    );
    const out = fs.readFileSync(outPath);
    if (!out || out.length === 0) return Buffer.concat(segments);
    return out;
  } catch {
    return Buffer.concat(segments);
  } finally {
    for (const f of files) { try { fs.unlinkSync(f); } catch { /* noop */ } }
    try { fs.existsSync(listPath) && fs.unlinkSync(listPath); } catch { /* noop */ }
    try { fs.existsSync(outPath) && fs.unlinkSync(outPath); } catch { /* noop */ }
  }
}

/**
 * 理想クロージングの会話(ターン配列)を音声化する（FR-VOICE-003 / 2声）。
 * 営業(rep)ターン＝本人のクローン声(repVoiceId)、お客様(customer)ターン＝汎用声(customerVoiceId・空ならFish既定)。
 * 各ターンを合成し、1本のmp3に連結して返す。
 */
export async function synthesizeDialogue(
  turns: DialogueTurn[],
  provider: VoiceProvider,
  repVoiceId: string,
  userKey: string,
  customerVoiceId = '',
  onProgress?: (done: number, total: number) => void
): Promise<Buffer> {
  if (!turns || turns.length === 0) {
    throw new Error('理想クロージングの会話が空です。');
  }
  const segments: Buffer[] = [];
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    const vid = t.speaker === 'rep' ? repVoiceId : customerVoiceId;
    segments.push(await provider.synthesize(vid, t.text, userKey));
    if (onProgress) onProgress(i + 1, turns.length);
  }
  return concatAudio(segments);
}
