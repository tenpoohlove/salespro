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
import { db, newId } from './db';
import { createSession, getSessionUser, requireAuth, requireAdmin } from './auth';

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

  db.prepare('INSERT INTO users (id, email, password_hash, name, phone, is_admin) VALUES (?, ?, ?, ?, ?, ?)').run(id, email.toLowerCase(), passwordHash, name.trim(), phone?.trim() || null, isAdmin);
  createSession(id, res);
  res.json({ ok: true, isAdmin: !!isAdmin });
});

// ログイン
app.post('/api/auth/login', authLimiter, async (req, res) => {
  const { email, password } = req.body as { email: string; password: string };
  if (!email || !password) { res.status(400).json({ error: 'メールアドレスとパスワードを入力してください' }); return; }

  const user = db.prepare('SELECT id, password_hash, enabled, is_admin FROM users WHERE email = ?').get(email.toLowerCase()) as any;
  if (!user) { res.status(401).json({ error: 'メールアドレスまたはパスワードが正しくありません' }); return; }
  if (!user.enabled) { res.status(403).json({ error: 'このアカウントは無効化されています。管理者にお問い合わせください' }); return; }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) { res.status(401).json({ error: 'メールアドレスまたはパスワードが正しくありません' }); return; }

  createSession(user.id, res);
  res.json({ ok: true, isAdmin: !!user.is_admin });
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
  res.json({ status: 'ok', provider, model });
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

      for await (const event of analyzeContent(allContents, extraText, validFocus as import('./prompts').FocusMode, anthropicKey)) {
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
