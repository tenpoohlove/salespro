import 'dotenv/config';
import express from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import path from 'path';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import OpenAI, { toFile } from 'openai';
import { extractContent } from './extractors';
import { analyzeContent, getProvider, compareContent } from './analyze';
import { randomBytes } from 'crypto';
import { db, newId } from './db';
import { createSession, getSessionUser, requireAuth, requireAdmin } from './auth';
import { sendVerificationEmail } from './email';
import { getVoiceProvider, cacheKey } from './voice';
import { generateIdealClosingScript, prepareVoiceSample, trimVoiceSample, parseClosingDialogue, synthesizeDialogue, pickCustomerVoiceId } from './closing';
import fs from 'fs';

// 声クローン機能のfeature flag（既定off。検証まで有効化しない: CONSTRAINTS §5）
const FEATURE_VOICE_CLONE = process.env.FEATURE_VOICE_CLONE === 'true';
const AUDIO_DIR = process.env.AUDIO_DIR || path.join(process.cwd(), 'audio');

const analyzeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'リクエストが多すぎます。1分後に再試行してください。' },
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      '.pdf', '.docx', '.doc', '.pptx', '.ppt',
      '.txt', '.md', '.srt', '.vtt',
      '.png', '.jpg', '.jpeg', '.webp', '.gif',
    ];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`対応していないファイル形式です: ${ext}`));
    }
  },
});

const uploadMedia = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.mp3', '.mp4', '.m4a', '.wav', '.ogg', '.flac', '.webm', '.mov'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error(`音声・動画ファイルのみ対応: ${ext}`));
  },
});

const GROQ_WHISPER_LIMIT = 25 * 1024 * 1024;

const app = express();

// 本番ではリバースプロキシ(Caddy等)の背後で動くため、最初のプロキシを信頼する。
// これがないと express-rate-limit が全リクエストをプロキシIPで同一視し、レート制限が全ユーザー共通になってしまう。
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

app.use(express.json());
app.use(cookieParser());

app.use(express.static('public'));

// ── 認証ルート ──────────────────────────────────────────

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });

// サインアップ
app.post('/api/auth/register', authLimiter, async (req, res) => {
  const { email, password, name, phone } = req.body as { email: string; password: string; name: string; phone: string };
  if (!email || !password || !name) { res.status(400).json({ error: '名前・メールアドレス・パスワードは必須です' }); return; }
  if (password.length < 8) { res.status(400).json({ error: 'パスワードは8文字以上にしてください' }); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { res.status(400).json({ error: 'メールアドレスの形式が正しくありません' }); return; }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) { res.status(400).json({ error: 'このメールアドレスはすでに登録されています' }); return; }

  const passwordHash = await bcrypt.hash(password, 12);
  const id = newId();
  const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase();
  const isAdmin = adminEmail && email.toLowerCase() === adminEmail ? 1 : 0;
  const isVerified = isAdmin ? 1 : 0;

  db.prepare('INSERT INTO users (id, email, password_hash, name, phone, is_admin, is_verified) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, email.toLowerCase(), passwordHash, name.trim(), phone?.trim() || null, isAdmin, isVerified);

  if (isVerified) {
    createSession(id, res);
    res.json({ ok: true, isAdmin: true });
  } else {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    db.prepare('INSERT INTO email_verifications (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)').run(newId(), id, token, expiresAt);
    await sendVerificationEmail(email.toLowerCase(), name.trim(), token, id);
    res.json({ ok: true, needsVerification: true });
  }
});

// ログイン
app.post('/api/auth/login', authLimiter, async (req, res) => {
  const { email, password } = req.body as { email: string; password: string };
  if (!email || !password) { res.status(400).json({ error: 'メールアドレスとパスワードを入力してください' }); return; }

  const user = db.prepare('SELECT id, password_hash, enabled, is_admin, is_verified FROM users WHERE email = ?').get(email.toLowerCase()) as any;
  if (!user) { res.status(401).json({ error: 'メールアドレスまたはパスワードが正しくありません' }); return; }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) { res.status(401).json({ error: 'メールアドレスまたはパスワードが正しくありません' }); return; }

  if (!user.is_verified) { res.status(403).json({ error: 'メールアドレスの確認が完了していません。登録時に送信したメールのリンクをクリックしてください。', code: 'EMAIL_NOT_VERIFIED', email: email.toLowerCase() }); return; }
  if (!user.enabled) { res.status(403).json({ error: 'このアカウントは無効化されています。管理者にお問い合わせください' }); return; }

  createSession(user.id, res);
  res.json({ ok: true, isAdmin: !!user.is_admin });
});

// メールアドレス確認
app.get('/api/auth/verify-email', (req, res) => {
  const { token, userId } = req.query as { token: string; userId: string };
  if (!token || !userId) { res.status(400).json({ error: 'パラメータが不正です' }); return; }

  const record = db.prepare("SELECT id FROM email_verifications WHERE token = ? AND user_id = ? AND expires_at > datetime('now')").get(token, userId);
  if (!record) { res.status(400).json({ error: 'リンクが無効または期限切れです' }); return; }

  db.prepare('UPDATE users SET is_verified = 1 WHERE id = ?').run(userId);
  db.prepare('DELETE FROM email_verifications WHERE token = ?').run(token);
  res.json({ ok: true });
});

// 確認メール再送
app.post('/api/auth/resend-verification', authLimiter, async (req, res) => {
  const { email } = req.body as { email: string };
  if (!email) { res.status(400).json({ error: 'メールアドレスが必要です' }); return; }

  const user = db.prepare('SELECT id, name, is_verified FROM users WHERE email = ?').get(email.toLowerCase()) as any;
  if (!user || user.is_verified) { res.json({ ok: true }); return; }

  db.prepare('DELETE FROM email_verifications WHERE user_id = ?').run(user.id);
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  db.prepare('INSERT INTO email_verifications (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)').run(newId(), user.id, token, expiresAt);
  await sendVerificationEmail(email.toLowerCase(), user.name, token, user.id);
  res.json({ ok: true });
});

// ログアウト
app.post('/api/auth/logout', (req, res) => {
  const token = (req as any).cookies?.sc_session;
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.clearCookie('sc_session');
  res.json({ ok: true });
});

// 現在のユーザー情報
app.get('/api/auth/me', (req, res) => {
  const user = getSessionUser(req);
  if (!user) { res.status(401).json({ error: 'unauthorized' }); return; }
  res.json({ id: user.id, email: user.email, name: user.name, isAdmin: user.isAdmin });
});

// ── APIキー（ユーザーごとDB保存）──────────────────────────

app.get('/api/user/api-keys', requireAuth, (req, res) => {
  const user = (req as any).user;
  const row = db.prepare('SELECT anthropic_key, openai_key, fish_key FROM user_api_keys WHERE user_id = ?').get(user.id) as any;
  res.json({ anthropicKey: row?.anthropic_key || '', openaiKey: row?.openai_key || '', fishKey: row?.fish_key || '' });
});

app.post('/api/user/api-keys', requireAuth, (req, res) => {
  const user = (req as any).user;
  const { anthropicKey, openaiKey, fishKey } = req.body as { anthropicKey?: string; openaiKey?: string; fishKey?: string };

  const existing = db.prepare('SELECT user_id FROM user_api_keys WHERE user_id = ?').get(user.id);
  if (existing) {
    db.prepare(`UPDATE user_api_keys SET anthropic_key = COALESCE(?, anthropic_key), openai_key = COALESCE(?, openai_key), fish_key = COALESCE(?, fish_key), updated_at = datetime('now','localtime') WHERE user_id = ?`)
      .run(anthropicKey ?? null, openaiKey ?? null, fishKey ?? null, user.id);
  } else {
    db.prepare('INSERT INTO user_api_keys (user_id, anthropic_key, openai_key, fish_key) VALUES (?, ?, ?, ?)')
      .run(user.id, anthropicKey || null, openaiKey || null, fishKey || null);
  }
  res.json({ ok: true });
});

// ── 管理者ルート ────────────────────────────────────────

// ユーザー一覧
app.get('/api/admin/users', requireAuth, requireAdmin, (_req, res) => {
  const users = db.prepare(`
    SELECT id, name, email, phone, is_admin, enabled, created_at
    FROM users ORDER BY created_at DESC
  `).all() as any[];
  res.json(users.map(u => ({ ...u, isAdmin: !!u.is_admin, enabled: !!u.enabled })));
});

// 有効化/無効化
app.post('/api/admin/users/:id/toggle', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;
  const me = (req as any).user;
  if (id === me.id) { res.status(400).json({ error: '自分自身は変更できません' }); return; }
  const target = db.prepare('SELECT is_admin, enabled FROM users WHERE id = ?').get(id) as any;
  if (!target) { res.status(404).json({ error: 'ユーザーが見つかりません' }); return; }
  if (target.is_admin) { res.status(400).json({ error: '管理者は無効化できません' }); return; }
  db.prepare('UPDATE users SET enabled = ? WHERE id = ?').run(target.enabled ? 0 : 1, id);
  res.json({ ok: true, enabled: !target.enabled });
});

// CSV出力
app.get('/api/admin/export-csv', requireAuth, requireAdmin, (_req, res) => {
  const users = db.prepare('SELECT name, email, phone, enabled, created_at FROM users ORDER BY created_at DESC').all() as any[];
  const header = ['名前', 'メールアドレス', '電話番号', '有効', '登録日'];
  const rows = users.map(u => [
    `"${u.name}"`,
    `"${u.email}"`,
    `"=""${u.phone || ''}\""`,
    `"${u.enabled ? '有効' : '無効'}"`,
    `"${u.created_at?.slice(0, 10) || ''}"`,
  ].join(','));
  const csv = [header.map(h => `"${h}"`).join(','), ...rows].join('\n');
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="users_${date}.csv"`);
  res.send('﻿' + csv); // BOM付きでExcelが文字化けしない
});

// Health check
app.get('/api/health', (_req, res) => {
  const provider = getProvider();
  const model = provider === 'groq' ? 'llama-3.3-70b (Groq)' : 'claude-sonnet-4-6';
  res.json({ status: 'ok', provider, model, featureVoiceClone: FEATURE_VOICE_CLONE });
});

// Scrape URL and extract text
const scrapeLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });

app.post('/api/scrape', scrapeLimiter, async (req, res) => {
  const { url } = req.body as { url: string };

  if (!url || !/^https?:\/\/.+/.test(url)) {
    res.status(400).json({ error: 'URLの形式が正しくありません' });
    return;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ja,en;q=0.9',
      },
    });
    clearTimeout(timer);

    if (!response.ok) {
      res.status(400).json({ error: `ページの取得に失敗しました（HTTP ${response.status}）` });
      return;
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      res.status(400).json({ error: 'HTMLページのみ対応しています' });
      return;
    }

    const html = await response.text();
    const text = extractTextFromHtml(html);

    if (text.length < 50) {
      res.status(400).json({ error: 'ページからテキストを取得できませんでした' });
      return;
    }

    res.json({ text, charCount: text.length, url });
  } catch (e: unknown) {
    const isAbort = e instanceof Error && e.name === 'AbortError';
    console.error('[scrape error]', e);
    res.status(400).json({ error: isAbort ? 'タイムアウトしました（10秒）' : 'ページの取得に失敗しました' });
  }
});

function extractTextFromHtml(html: string): string {
  // スクリプト・スタイルを削除
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ');

  // ブロック要素に改行を挿入してから全タグ削除
  text = text
    .replace(/<\/(p|div|h[1-6]|li|br|tr|section|article)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  // HTMLエンティティのデコード
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

  // 空白・改行を整理
  text = text
    .split('\n')
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(l => l.length > 0)
    .join('\n');

  const LIMIT = 40000;
  if (text.length > LIMIT) {
    text = text.slice(0, LIMIT) + `\n\n---\n⚠️ ページが大きすぎるため冒頭 ${LIMIT.toLocaleString()}文字のみ取得しました。`;
  }

  return text;
}


// Transcribe audio/video via Groq Whisper
const transcribeLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false });

app.post('/api/transcribe', requireAuth, transcribeLimiter, uploadMedia.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: 'ファイルが必要です' });
    return;
  }

  const openaiKey = (req.headers['x-openai-key'] as string) || '';
  if (!openaiKey.startsWith('sk-') || openaiKey.length <= 20) {
    res.status(400).json({ error: '文字起こし機能にはOpenAI APIキーが必要です。設定画面でOpenAI APIキーを入力してください。' });
    return;
  }

  if (file.size > GROQ_WHISPER_LIMIT) {
    const sizeMB = (file.size / 1024 / 1024).toFixed(1);
    res.status(400).json({
      error: `ファイルが大きすぎます（${sizeMB}MB）。Whisperの上限は25MBです。動画から音声（.mp3/.m4a）に書き出してから再アップロードしてください。`,
    });
    return;
  }

  const ext = path.extname(file.originalname).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.m4a': 'audio/mp4',
    '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
    '.webm': 'audio/webm', '.mov': 'video/quicktime',
  };
  const mime = mimeMap[ext] || 'audio/mpeg';
  const filename = Buffer.from(file.originalname, 'latin1').toString('utf8');

  try {
    const openai = new OpenAI({ apiKey: openaiKey });
    const transcription = await openai.audio.transcriptions.create({
      file: await toFile(file.buffer, filename, { type: mime }),
      model: 'whisper-1',
      language: 'ja',
    });
    res.json({ text: transcription.text, filename });
  } catch (e: unknown) {
    console.error('[transcribe error]', e);
    const msg = e instanceof Error ? e.message : '不明なエラー';
    res.status(500).json({ error: '文字起こしに失敗しました: ' + msg });
  }
});

// Main analysis endpoint - uses SSE for streaming
app.post(
  '/api/analyze',
  requireAuth,
  analyzeLimiter,
  upload.array('files', 10),
  async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendEvent = (data: object) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const sendDone = () => {
      res.write('data: [DONE]\n\n');
      res.end();
    };

    try {
      const files = req.files as Express.Multer.File[] | undefined;
      const extraText = (req.body.text as string) || '';
      const focus = (req.body.focus as string) || 'full';
      const validFocus = ['full', 'hook', 'cta', 'trust'].includes(focus) ? focus : 'full';
      const mode = req.body.mode === 'closing' ? 'closing' : 'copy';
      const context = (req.body.context as string) || '';
      const referenceBaseline = (req.body.referenceBaseline as string) || '';
      const anthropicKey = (req.headers['x-anthropic-key'] as string) || '';

      if (!anthropicKey.startsWith('sk-ant') || anthropicKey.length < 20) {
        sendEvent({ type: 'content', text: '**エラー:** Anthropic APIキーが設定されていません。画面上部のバナーでキーを入力してください。' });
        sendDone();
        return;
      }

      if ((!files || files.length === 0) && !extraText.trim()) {
        sendEvent({ type: 'content', text: '**エラー:** ファイルまたはテキストが必要です。' });
        sendDone();
        return;
      }

      const allContents = [];
      for (const file of files || []) {
        const bufferName = Buffer.from(file.originalname, 'latin1').toString('utf8');
        const contents = await extractContent(file.buffer, bufferName);
        allContents.push(...contents);
      }

      for await (const event of analyzeContent(
        allContents,
        extraText,
        validFocus as import('./prompts').FocusMode,
        anthropicKey,
        { mode, context, referenceBaseline }
      )) {
        sendEvent(event);
      }

      sendDone();
    } catch (error) {
      console.error('[analyze error]', error);
      sendEvent({ type: 'content', text: '\n\n**エラーが発生しました。** ファイルの形式や内容を確認して再試行してください。' });
      sendDone();
    }
  }
);

// Compare two materials
app.post(
  '/api/compare',
  requireAuth,
  analyzeLimiter,
  upload.fields([{ name: 'filesBefore', maxCount: 5 }, { name: 'filesAfter', maxCount: 5 }]),
  async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendEvent = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    const sendDone = () => { res.write('data: [DONE]\n\n'); res.end(); };

    try {
      const anthropicKey = (req.headers['x-anthropic-key'] as string) || '';
      if (!anthropicKey.startsWith('sk-ant') || anthropicKey.length < 20) {
        sendEvent({ type: 'content', text: '**エラー:** Anthropic APIキーが設定されていません。画面上部のバナーでキーを入力してください。' });
        sendDone();
        return;
      }

      const files = req.files as { filesBefore?: Express.Multer.File[]; filesAfter?: Express.Multer.File[] };
      const textBefore = (req.body.textBefore as string) || '';
      const textAfter  = (req.body.textAfter  as string) || '';

      const extractAll = async (fileList: Express.Multer.File[] = []) => {
        const results = [];
        for (const f of fileList) {
          const name = Buffer.from(f.originalname, 'latin1').toString('utf8');
          results.push(...await extractContent(f.buffer, name));
        }
        return results;
      };

      const [contentsBefore, contentsAfter] = await Promise.all([
        extractAll(files.filesBefore),
        extractAll(files.filesAfter),
      ]);

      const beforeText = [
        ...contentsBefore.filter(c => c.type === 'text').map(c => c.text || ''),
        textBefore,
      ].join('\n\n').trim();

      const afterText = [
        ...contentsAfter.filter(c => c.type === 'text').map(c => c.text || ''),
        textAfter,
      ].join('\n\n').trim();

      if (!beforeText || !afterText) {
        sendEvent({ type: 'content', text: '**エラー:** 改善前・改善後の両方が必要です。' });
        sendDone();
        return;
      }

      for await (const event of compareContent(beforeText, afterText, anthropicKey)) {
        sendEvent(event);
      }

      sendDone();
    } catch (error) {
      console.error('[compare error]', error);
      sendEvent({ type: 'content', text: '\n\n**エラーが発生しました。** 再試行してください。' });
      sendDone();
    }
  }
);

// ── 声クローン：理想クロージング音声見本の生成（FR-VOICE-002/003/004 / FR-DATA-011）──
const voiceLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false });

app.post('/api/voice/generate-sample', requireAuth, voiceLimiter, uploadMedia.single('audio'), async (req, res) => {
  if (!FEATURE_VOICE_CLONE) {
    res.status(403).json({ error: '声クローン機能は現在無効です。' });
    return;
  }
  const user = (req as any).user;
  const transcript = (req.body?.transcript || '').toString();
  const referenceBaseline = (req.body?.referenceBaseline || '').toString() || null;
  const context = (req.body?.context || '').toString() || null; // 備考・相手情報（FR-DATA-014/015）
  const analysisFindings = (req.body?.analysis || '').toString() || null; // 直前の添削結果。理想クロージングをこれに基づいて作る
  const customerGender = (req.body?.customerGender || 'female').toString(); // お客様役の汎用声の性別
  const consent = req.body?.consent === 'true' || req.body?.consent === true;
  const anthropicKey = (req.headers['x-anthropic-key'] as string) || '';
  const fishKey = (req.headers['x-fish-key'] as string) || '';
  const audio = req.file?.buffer;

  // SEC-002: 本人同意が無ければ生成しない（なりすまし防止）
  if (!consent) {
    res.status(400).json({ error: '本人の声をクローンすることへの同意が必要です。', code: 'CONSENT_REQUIRED' });
    return;
  }
  if (!transcript.trim()) {
    res.status(400).json({ error: '商談の文字起こしがありません。' });
    return;
  }
  if (!audio) {
    res.status(400).json({ error: '声サンプル用の商談音声をアップロードしてください。' });
    return;
  }

  // 声サンプルの妥当性は台本生成（課金）より前に検証する（無効音声で無駄に課金しない）
  try {
    prepareVoiceSample(audio);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : '声サンプルが不正です。' });
    return;
  }

  try {
    // 1) 理想クロージング台本を生成（FR-DATA-011・BYOK Anthropic）。備考・相手情報＋添削結果を反映
    const script = await generateIdealClosingScript(transcript, referenceBaseline, anthropicKey, context, analysisFindings);

    // 2) voiceID（ユーザー単位でキャッシュ。無ければ作成）FR-VOICE-002
    const provider = getVoiceProvider(fishKey); // キー無し/DRY_RUNなら自動Mock（課金なし）
    let voiceRow = db.prepare('SELECT fish_voice_id FROM voice_samples WHERE user_id = ?').get(user.id) as any;
    let voiceId: string;
    if (voiceRow?.fish_voice_id) {
      voiceId = voiceRow.fish_voice_id;
    } else {
      // 声サンプルを40〜50秒に自動トリミング＆軽量化（長尺=Fish 524タイムアウト対策）。voiceID作成時のみ実行
      const sample = await trimVoiceSample(audio);
      voiceId = await provider.createVoiceId(sample, fishKey);
      db.prepare('INSERT OR REPLACE INTO voice_samples (user_id, fish_voice_id) VALUES (?, ?)').run(user.id, voiceId);
    }

    // 3) 理想クロージングを会話(営業/客)に分解。営業=本人クローン声 / 客=汎用声(性別一致・クローンしない)
    const turns = parseClosingDialogue(script);
    const dialogue = turns.length > 0 ? turns : [{ speaker: 'rep' as const, text: script }];
    const customerVoiceId = pickCustomerVoiceId(customerGender);

    // 4) 音声キャッシュ確認（FR-VOICE-004：2回目はAPIを呼ばない＝0円）。営業声＋客声＋台本で一意化
    const ck = cacheKey(`${voiceId}|${customerVoiceId}`, script);
    const cached = db.prepare('SELECT audio_path FROM audio_cache WHERE cache_key = ?').get(ck) as any;
    if (cached?.audio_path && fs.existsSync(cached.audio_path)) {
      const buf = fs.readFileSync(cached.audio_path);
      res.json({ script, audioBase64: buf.toString('base64'), cached: true, provider: provider.name });
      return;
    }

    // 5) 音声合成（FR-VOICE-003）。各ターンを合成し1本に連結
    const audioOut = await synthesizeDialogue(dialogue, provider, voiceId, fishKey, customerVoiceId);
    fs.mkdirSync(AUDIO_DIR, { recursive: true });
    const outPath = path.join(AUDIO_DIR, `${ck}.mp3`);
    fs.writeFileSync(outPath, audioOut);
    db.prepare('INSERT OR REPLACE INTO audio_cache (cache_key, audio_path) VALUES (?, ?)').run(ck, outPath);

    res.json({ script, audioBase64: audioOut.toString('base64'), cached: false, provider: provider.name });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '不明なエラー';
    console.error('[voice error]', msg);
    res.status(500).json({ error: '音声見本の生成に失敗しました: ' + msg });
  }
});

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[request error]', err.message);
  if (!res.headersSent) {
    res.status(400).json({ error: 'リクエストの処理中にエラーが発生しました。' });
  }
});

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
app.listen(PORT, () => {
  const provider = getProvider();
  const key = provider === 'groq'
    ? process.env.GROQ_API_KEY || ''
    : process.env.ANTHROPIC_API_KEY || '';
  const hasKey = key.length > 20;

  console.log(`\n🚀 セールスアドバイザー起動中`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   プロバイダー: ${provider === 'groq' ? 'Groq (llama-3.3-70b)' : 'Anthropic (claude-sonnet-4-6)'}`);
  if (!hasKey) {
    console.log(`\n   ⚠️  APIキーが未設定です`);
    console.log(`   ブラウザで http://localhost:${PORT} を開き、APIキーを入力してください\n`);
  } else {
    console.log(`   ✅ APIキー設定済み\n`);
  }
});
