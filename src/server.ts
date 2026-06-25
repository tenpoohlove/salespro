import 'dotenv/config';
import express from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import path from 'path';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import OpenAI, { toFile } from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { extractContent } from './extractors';
import { analyzeContent, getProvider, compareContent } from './analyze';
import { randomBytes } from 'crypto';
import { db, newId, getSetting, setSetting } from './db';
import { createSession, getSessionUser, requireAuth, requireAdmin } from './auth';
import { sendVerificationEmail, sendTestEmail } from './email';
import { getVoiceProvider, cacheKey, type VoiceProvider } from './voice';
import { videoUrlGuidance } from './youtube';
import { generateIdealClosingScript, generateFullIdealClosingScript, generateSampleDialogue, targetCharsForMinutes, prepareVoiceSample, trimVoiceSample, buildClosingTurns, synthesizeDialogue, pickCustomerVoiceId, type ClosingMode } from './closing';
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
  const { email, password, name, phone, termsAgreed, newsletterConsent } = req.body as { email: string; password: string; name: string; phone: string; termsAgreed?: boolean; newsletterConsent?: boolean };
  if (!email || !password || !name) { res.status(400).json({ error: '名前・メールアドレス・パスワードは必須です' }); return; }
  if (password.length < 8) { res.status(400).json({ error: 'パスワードは8文字以上にしてください' }); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { res.status(400).json({ error: 'メールアドレスの形式が正しくありません' }); return; }
  if (!termsAgreed) { res.status(400).json({ error: '利用規約への同意が必要です' }); return; }
  if (!newsletterConsent) { res.status(400).json({ error: 'お知らせの受け取りへの同意が必要です' }); return; }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) { res.status(400).json({ error: 'このメールアドレスはすでに登録されています' }); return; }

  const passwordHash = await bcrypt.hash(password, 12);
  const id = newId();
  const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase();
  const isAdmin = adminEmail && email.toLowerCase() === adminEmail ? 1 : 0;
  const isVerified = isAdmin ? 1 : 0;

  db.prepare('INSERT INTO users (id, email, password_hash, name, phone, newsletter_consent, is_admin, is_verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, email.toLowerCase(), passwordHash, name.trim(), phone?.trim() || null, newsletterConsent ? 1 : 0, isAdmin, isVerified);

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

// APIキーの有効性テスト（実際に最小コストで叩いて確認。受け取ったキーは保存せずテストのみに使用）
app.post('/api/user/api-keys/test', requireAuth, async (req, res) => {
  const { provider, key } = req.body as { provider?: string; key?: string };
  if (!key || !key.trim()) { res.status(400).json({ ok: false, error: 'キーが入力されていません' }); return; }
  try {
    if (provider === 'anthropic') {
      const client = new Anthropic({ apiKey: key });
      await client.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] });
    } else if (provider === 'openai') {
      const client = new OpenAI({ apiKey: key });
      await client.models.list();
    } else if (provider === 'fish') {
      const base = process.env.FISH_API_BASE || 'https://api.fish.audio';
      const r = await fetch(`${base}/model?page_size=1`, { headers: { Authorization: `Bearer ${key}` } });
      if (!r.ok) { const t = await r.text().catch(() => ''); throw Object.assign(new Error(t || `status ${r.status}`), { status: r.status }); }
    } else {
      res.status(400).json({ ok: false, error: '不明なプロバイダです' }); return;
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: translateKeyError(e) });
  }
});

// APIキーのテスト失敗理由を日本語にする
function translateKeyError(e: any): string {
  const status = e?.status ?? e?.statusCode;
  const msg = String(e?.message || e || '');
  if (status === 401 || /401|invalid[_ ]?api[_ ]?key|authentication|unauthor/i.test(msg)) return 'キーが無効です（認証に失敗しました）。キーをもう一度ご確認ください';
  if (status === 403 || /403|permission|forbidden/i.test(msg)) return 'このキーには必要な権限がありません';
  if (status === 429 || /429|rate.?limit/i.test(msg)) return 'アクセスが集中しています。少し待ってから再度お試しください';
  if (/quota|insufficient|billing|credit|残高/i.test(msg)) return '残高・クレジットが不足している可能性があります。請求設定をご確認ください';
  if (/network|fetch failed|ENOTFOUND|ETIMEDOUT|timeout/i.test(msg)) return 'ネットワークエラーです。接続を確認して再度お試しください';
  return '確認できませんでした: ' + msg.slice(0, 120);
}

// ── SMTP設定（管理者のみ。確認メールの差出人。DB設定が環境変数より優先される）──
app.get('/api/admin/smtp', requireAuth, requireAdmin, (_req, res) => {
  res.json({
    host: getSetting('smtp_host') || '',
    port: getSetting('smtp_port') || '587',
    user: getSetting('smtp_user') || '',
    fromName: getSetting('smtp_from_name') || 'Pitch Navi',
    hasPassword: !!getSetting('smtp_pass'),
  });
});

app.post('/api/admin/smtp', requireAuth, requireAdmin, (req, res) => {
  const { host, port, user, password, fromName } = req.body as { host?: string; port?: string; user?: string; password?: string; fromName?: string };
  setSetting('smtp_host', (host || '').trim());
  setSetting('smtp_port', String(port || '587').trim());
  setSetting('smtp_user', (user || '').trim());
  setSetting('smtp_from_name', (fromName || 'Pitch Navi').trim());
  if (password) setSetting('smtp_pass', password); // 空欄なら既存パスワードを維持
  res.json({ ok: true });
});

app.post('/api/admin/smtp/test', requireAuth, requireAdmin, async (req, res) => {
  const user = (req as any).user;
  try {
    await sendTestEmail(user.email);
    res.json({ ok: true, sentTo: user.email });
  } catch (e) {
    res.status(400).json({ ok: false, error: translateSmtpError(e) });
  }
});

function translateSmtpError(e: any): string {
  const msg = String(e?.message || e || '');
  if (/SMTPが設定/i.test(msg)) return 'SMTPが未設定です。先に保存してから「テスト送信」してください';
  if (/EAUTH|535|Username and Password|authentication|BadCredentials/i.test(msg)) return 'SMTP認証に失敗しました。ユーザー名・パスワード（Gmailは「アプリパスワード」）をご確認ください';
  if (/ECONNECTION|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EDNS|getaddrinfo|connect/i.test(msg)) return 'SMTPサーバーに接続できません。ホスト名・ポートをご確認ください';
  return '送信に失敗しました: ' + msg.slice(0, 140);
}

// ── 管理者ルート ────────────────────────────────────────

// ユーザー一覧
app.get('/api/admin/users', requireAuth, requireAdmin, (_req, res) => {
  const users = db.prepare(`
    SELECT id, name, email, phone, is_admin, enabled, is_verified, newsletter_consent, created_at
    FROM users ORDER BY created_at DESC
  `).all() as any[];
  res.json(users.map(u => ({
    ...u,
    isAdmin: !!u.is_admin,
    enabled: !!u.enabled,
    isVerified: !!u.is_verified,
    newsletterConsent: !!u.newsletter_consent,
  })));
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

// メール認証の手動切替（認証/取消）
app.post('/api/admin/users/:id/verify', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;
  const target = db.prepare('SELECT is_verified FROM users WHERE id = ?').get(id) as any;
  if (!target) { res.status(404).json({ error: 'ユーザーが見つかりません' }); return; }
  const next = target.is_verified ? 0 : 1;
  db.prepare('UPDATE users SET is_verified = ? WHERE id = ?').run(next, id);
  res.json({ ok: true, isVerified: !!next });
});

// ユーザー削除（関連データはFKのON DELETE CASCADEで自動削除）
app.delete('/api/admin/users/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;
  const me = (req as any).user;
  if (id === me.id) { res.status(400).json({ error: '自分自身は削除できません' }); return; }
  const target = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(id) as any;
  if (!target) { res.status(404).json({ error: 'ユーザーが見つかりません' }); return; }
  if (target.is_admin) { res.status(400).json({ error: '管理者は削除できません' }); return; }
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
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

  // 動画URL(YouTube/Zoom録画)は中身を取得できない。無駄な取得を試みず即座に確実な代替を案内する。
  const guidance = videoUrlGuidance(url);
  if (guidance) {
    res.status(400).json({ error: guidance });
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

/**
 * 合成に使う声IDを解決する。
 *  - voiceProfileId 指定 … 保存済みの名前付きプロフィールから取得（アップ・同意不要。所有者チェックあり）
 *  - 未指定 … 従来どおり voice_samples（自動保存声）。無ければアップ音声から作成（同意は呼び出し側で担保）
 * 失敗時は { error, status, code? } を返す。
 */
async function resolveVoiceId(opts: {
  userId: string;
  voiceProfileId?: string | null;
  provider: VoiceProvider;
  fishKey: string;
  audio?: Buffer;
}): Promise<{ voiceId: string } | { error: string; status: number; code?: string }> {
  const { userId, voiceProfileId, provider, fishKey, audio } = opts;
  if (voiceProfileId) {
    const row = db.prepare('SELECT fish_voice_id FROM voice_profiles WHERE id = ? AND user_id = ?').get(voiceProfileId, userId) as any;
    if (!row?.fish_voice_id) return { error: '指定の声プロフィールが見つかりません。', status: 404 };
    return { voiceId: row.fish_voice_id };
  }
  const vs = db.prepare('SELECT fish_voice_id FROM voice_samples WHERE user_id = ?').get(userId) as any;
  if (vs?.fish_voice_id) return { voiceId: vs.fish_voice_id };
  if (!audio) return { error: '初回は本人の声サンプル音声をアップロードしてください。', code: 'VOICE_SAMPLE_REQUIRED', status: 400 };
  try { prepareVoiceSample(audio); } catch (e) { return { error: e instanceof Error ? e.message : '声サンプルが不正です。', status: 400 }; }
  const sample = await trimVoiceSample(audio);
  const voiceId = await provider.createVoiceId(sample, fishKey);
  db.prepare('INSERT OR REPLACE INTO voice_samples (user_id, fish_voice_id) VALUES (?, ?)').run(userId, voiceId);
  return { voiceId };
}

// ── 声プロフィール（名前付きで保存・選択／リネーム・削除）──────────────
// 一度作った本人の声を名前付きで保存し、次回はアップ不要で選ぶだけにする。
// 一覧・削除はDB操作のみ＝0円。保存(POST)のみ Fish の声作成が走る（BYOK）。

// 保存済みの声プロフィール一覧
app.get('/api/voice/profiles', requireAuth, (req, res) => {
  if (!FEATURE_VOICE_CLONE) { res.status(403).json({ error: '声クローン機能は現在無効です。' }); return; }
  const user = (req as any).user;
  const rows = db.prepare('SELECT id, name, created_at FROM voice_profiles WHERE user_id = ? ORDER BY created_at DESC, name').all(user.id) as any[];
  res.json({ profiles: rows.map(r => ({ id: r.id, name: r.name, createdAt: r.created_at })) });
});

// 声サンプル＋名前で新しい声プロフィールを保存（FR-VOICE-002・要同意）
app.post('/api/voice/profiles', requireAuth, voiceLimiter, uploadMedia.single('audio'), async (req, res) => {
  if (!FEATURE_VOICE_CLONE) { res.status(403).json({ error: '声クローン機能は現在無効です。' }); return; }
  const user = (req as any).user;
  const name = (req.body?.name || '').toString().trim();
  const consent = req.body?.consent === 'true' || req.body?.consent === true;
  const fishKey = (req.headers['x-fish-key'] as string) || '';
  const audio = req.file?.buffer;

  if (!consent) { res.status(400).json({ error: '本人の声をクローンすることへの同意が必要です。', code: 'CONSENT_REQUIRED' }); return; }
  if (!name) { res.status(400).json({ error: '声に付ける名前を入力してください。' }); return; }
  if (name.length > 40) { res.status(400).json({ error: '名前は40文字以内にしてください。' }); return; }
  if (!audio) { res.status(400).json({ error: '本人の声サンプル音声をアップロードしてください。' }); return; }
  try { prepareVoiceSample(audio); } catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : '声サンプルが不正です。' }); return; }

  try {
    const provider = getVoiceProvider(fishKey); // キー無し/DRY_RUNなら自動Mock（課金なし）
    const sample = await trimVoiceSample(audio);
    const voiceId = await provider.createVoiceId(sample, fishKey);
    const id = newId();
    db.prepare('INSERT INTO voice_profiles (id, user_id, name, fish_voice_id) VALUES (?, ?, ?, ?)').run(id, user.id, name, voiceId);
    res.json({ id, name, provider: provider.name });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '不明なエラー';
    console.error('[voice profile create error]', msg);
    res.status(500).json({ error: '声の保存に失敗しました: ' + msg });
  }
});

// 声プロフィールのリネーム
app.patch('/api/voice/profiles/:id', requireAuth, (req, res) => {
  if (!FEATURE_VOICE_CLONE) { res.status(403).json({ error: '声クローン機能は現在無効です。' }); return; }
  const user = (req as any).user;
  const name = (req.body?.name || '').toString().trim();
  if (!name) { res.status(400).json({ error: '名前を入力してください。' }); return; }
  if (name.length > 40) { res.status(400).json({ error: '名前は40文字以内にしてください。' }); return; }
  const r = db.prepare('UPDATE voice_profiles SET name = ? WHERE id = ? AND user_id = ?').run(name, req.params.id, user.id);
  if (r.changes === 0) { res.status(404).json({ error: '声プロフィールが見つかりません。' }); return; }
  res.json({ id: req.params.id, name });
});

// 声プロフィールの削除（声本体=Fishモデルは消さず、ローカルの紐づけのみ削除）
app.delete('/api/voice/profiles/:id', requireAuth, (req, res) => {
  if (!FEATURE_VOICE_CLONE) { res.status(403).json({ error: '声クローン機能は現在無効です。' }); return; }
  const user = (req as any).user;
  const r = db.prepare('DELETE FROM voice_profiles WHERE id = ? AND user_id = ?').run(req.params.id, user.id);
  if (r.changes === 0) { res.status(404).json({ error: '声プロフィールが見つかりません。' }); return; }
  res.json({ ok: true });
});

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
  const mode: ClosingMode = (req.body?.mode || 'dialogue').toString() === 'monologue' ? 'monologue' : 'dialogue'; // 対話版/語り版
  const voiceProfileId = (req.body?.voiceProfileId || '').toString() || null; // 保存済みの声を選んだ場合
  const consent = req.body?.consent === 'true' || req.body?.consent === true;
  const anthropicKey = (req.headers['x-anthropic-key'] as string) || '';
  const fishKey = (req.headers['x-fish-key'] as string) || '';
  const audio = req.file?.buffer;

  // SEC-002: 本人同意が無ければ生成しない（なりすまし防止）。保存済みプロフィール利用時は保存時に同意済み。
  if (!voiceProfileId && !consent) {
    res.status(400).json({ error: '本人の声をクローンすることへの同意が必要です。', code: 'CONSENT_REQUIRED' });
    return;
  }
  if (!transcript.trim()) {
    res.status(400).json({ error: '商談の文字起こしがありません。' });
    return;
  }
  // 声サンプルは「保存済みプロフィール未使用」かつ「自動保存声も無い」初回のみ必須
  const hasSavedVoice = !!voiceProfileId || !!(db.prepare('SELECT 1 FROM voice_samples WHERE user_id = ?').get(user.id));
  if (!hasSavedVoice && !audio) {
    res.status(400).json({ error: '声サンプル用の商談音声をアップロードしてください。' });
    return;
  }
  // アップ音声があるときは台本生成（課金）より前に妥当性検証（無効音声で無駄に課金しない）
  if (!hasSavedVoice && audio) {
    try {
      prepareVoiceSample(audio);
    } catch (e: unknown) {
      res.status(400).json({ error: e instanceof Error ? e.message : '声サンプルが不正です。' });
      return;
    }
  }

  try {
    // 1) 理想クロージング台本を生成（FR-DATA-011・BYOK Anthropic）。備考・相手情報＋添削結果を反映
    const script = await generateIdealClosingScript(transcript, referenceBaseline, anthropicKey, context, analysisFindings);

    // 2) 声ID解決：保存済みプロフィール優先（アップ不要）。無ければ従来の自動保存声/アップ音声から作成。
    const provider = getVoiceProvider(fishKey); // キー無し/DRY_RUNなら自動Mock（課金なし）
    const resolved = await resolveVoiceId({ userId: user.id, voiceProfileId, provider, fishKey, audio });
    if ('error' in resolved) { res.status(resolved.status).json({ error: resolved.error, code: resolved.code }); return; }
    const voiceId = resolved.voiceId;

    // 3) 理想クロージングを会話(営業/客/無音)に分解。営業=本人クローン声 / 客=汎用声(性別一致・クローンしない)
    //    monologue（語り版）では客ターンは想定の沈黙に置換される（buildClosingTurns）
    const turns = buildClosingTurns(script, mode);
    const dialogue = turns.length > 0 ? turns : [{ speaker: 'rep' as const, text: script }];
    const customerVoiceId = pickCustomerVoiceId(customerGender);

    // 4) 音声キャッシュ確認（FR-VOICE-004：2回目はAPIを呼ばない＝0円）。営業声＋客声＋モード＋台本で一意化
    const ck = cacheKey(`${voiceId}|${customerVoiceId}|${mode}`, script);
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

// ── 重要ポイントの「お手本セリフ」1行を本人の声で読み上げる（新方式・短文/安価）──
// レポートの各ポイントの「お手本を聞く」ボタンから呼ばれる。Claude台本生成はせず、
// 渡された1行だけを本人クローン声で合成。1行ごとにキャッシュ（FR-VOICE-004：2回目0円）。
app.post('/api/voice/say-line', requireAuth, voiceLimiter, uploadMedia.single('audio'), async (req, res) => {
  if (!FEATURE_VOICE_CLONE) {
    res.status(403).json({ error: '声クローン機能は現在無効です。' });
    return;
  }
  const user = (req as any).user;
  const line = (req.body?.line || '').toString().trim();
  const mode: ClosingMode = (req.body?.mode || 'dialogue').toString() === 'monologue' ? 'monologue' : 'dialogue';
  const voiceProfileId = (req.body?.voiceProfileId || '').toString() || null; // 保存済みの声を選んだ場合
  // 対話版の中身を上げるため、その商談の文脈（添削結果・文字起こし・備考）を受け取る（任意）
  const sampleContext = [
    (req.body?.analysis || '').toString().trim() ? `【添削レポート】\n${(req.body?.analysis || '').toString().trim()}` : '',
    (req.body?.transcript || '').toString().trim() ? `【商談の文字起こし(抜粋)】\n${(req.body?.transcript || '').toString().trim().slice(0, 4000)}` : '',
    (req.body?.context || '').toString().trim() ? `【相手情報・備考】\n${(req.body?.context || '').toString().trim()}` : '',
  ].filter(Boolean).join('\n\n') || null;
  const consent = req.body?.consent === 'true' || req.body?.consent === true;
  const fishKey = (req.headers['x-fish-key'] as string) || '';
  const audio = req.file?.buffer;

  // SEC-002: 本人同意が無ければ生成しない（なりすまし防止）。
  // ただし保存済みプロフィール利用時は保存時に同意済みのため再同意は不要。
  if (!voiceProfileId && !consent) {
    res.status(400).json({ error: '本人の声をクローンすることへの同意が必要です。', code: 'CONSENT_REQUIRED' });
    return;
  }
  if (!line) {
    res.status(400).json({ error: 'お手本セリフがありません。' });
    return;
  }

  try {
    const provider = getVoiceProvider(fishKey); // キー無し/DRY_RUNなら自動Mock（課金なし）

    // 声ID解決：保存済みプロフィール優先（アップ不要）。無ければ従来の自動保存声/アップ音声から作成。
    const resolved = await resolveVoiceId({ userId: user.id, voiceProfileId, provider, fishKey, audio });
    if ('error' in resolved) { res.status(resolved.status).json({ error: resolved.error, code: resolved.code }); return; }
    const voiceId = resolved.voiceId;
    const customerVoiceId = pickCustomerVoiceId('female'); // 対話版のお客様役（汎用声・クローンしない）

    // 1行ごとにキャッシュ（声ID＋モード＋客声＋文脈＋セリフで一意化）。2回目はAPIを呼ばない＝0円
    // 対話版は文脈で中身が変わるため、文脈もキーに含める（同じ商談・同じ行なら同じ→0円維持）
    const ctxKey = mode === 'dialogue' && sampleContext ? sampleContext : '';
    const ck = cacheKey(`line|${voiceId}|${mode}|${customerVoiceId}|${ctxKey}`, line);
    const cached = db.prepare('SELECT audio_path FROM audio_cache WHERE cache_key = ?').get(ck) as any;
    if (cached?.audio_path && fs.existsSync(cached.audio_path)) {
      const buf = fs.readFileSync(cached.audio_path);
      res.json({ audioBase64: buf.toString('base64'), cached: true, provider: provider.name });
      return;
    }

    // 台本ターンを作る。
    //  - 対話版：お手本セリフ1行を中心に「営業→客→営業」の短い掛け合いをAI生成（BYOK Anthropic）して2声で再生
    //  - 語り版：営業1行のみ。行内 [[SILENCE:ms]] は無音として分離（間・抑揚を反映）
    let turns;
    if (mode === 'dialogue') {
      const anthropicKey = (req.headers['x-anthropic-key'] as string) || '';
      if (!anthropicKey) {
        res.status(400).json({ error: '対話版のお手本（掛け合い）生成には Anthropic APIキーが必要です。設定するか、語り版をお使いください。', code: 'ANTHROPIC_KEY_REQUIRED' });
        return;
      }
      const script = await generateSampleDialogue(line, anthropicKey, sampleContext);
      const dlg = buildClosingTurns(script, 'dialogue');
      turns = dlg.length > 0 ? dlg : buildClosingTurns(`営業: ${line}`, 'dialogue');
    } else {
      const mono = buildClosingTurns(`営業: ${line}`, 'monologue');
      turns = mono.length > 0 ? mono : [{ speaker: 'rep' as const, text: line }];
    }
    const audioOut = await synthesizeDialogue(turns, provider, voiceId, fishKey, customerVoiceId);
    fs.mkdirSync(AUDIO_DIR, { recursive: true });
    const outPath = path.join(AUDIO_DIR, `${ck}.mp3`);
    fs.writeFileSync(outPath, audioOut);
    db.prepare('INSERT OR REPLACE INTO audio_cache (cache_key, audio_path) VALUES (?, ?)').run(ck, outPath);

    res.json({ audioBase64: audioOut.toString('base64'), cached: false, provider: provider.name });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '不明なエラー';
    console.error('[voice say-line error]', msg);
    res.status(500).json({ error: 'お手本音声の生成に失敗しました: ' + msg });
  }
});

// ── フル尺・理想クロージング（長尺・バックグラウンド生成）─────────────
interface VoiceJob {
  id: string;
  userId: string;
  status: 'running' | 'done' | 'error';
  phase: 'script' | 'voice' | 'done' | 'error';
  done: number;
  total: number;
  message: string;
  script?: string;
  audioPath?: string;
  error?: string;
  createdAt: number;
}
const voiceJobs = new Map<string, VoiceJob>();

function cleanupVoiceJobs(): void {
  const now = Date.now();
  for (const [id, j] of voiceJobs) {
    if (now - j.createdAt > 2 * 3600 * 1000) voiceJobs.delete(id); // 2時間で破棄（音声はaudio_cacheに残る）
  }
}

app.post('/api/voice/generate-full', requireAuth, voiceLimiter, uploadMedia.single('audio'), (req, res) => {
  if (!FEATURE_VOICE_CLONE) { res.status(403).json({ error: '声クローン機能は現在無効です。' }); return; }
  const user = (req as any).user;
  const transcript = (req.body?.transcript || '').toString();
  const referenceBaseline = (req.body?.referenceBaseline || '').toString() || null;
  const context = (req.body?.context || '').toString() || null;
  const analysisFindings = (req.body?.analysis || '').toString() || null;
  const customerGender = (req.body?.customerGender || 'female').toString();
  const mode: ClosingMode = (req.body?.mode || 'dialogue').toString() === 'monologue' ? 'monologue' : 'dialogue';
  const voiceProfileId = (req.body?.voiceProfileId || '').toString() || null; // 保存済みの声を選んだ場合
  const consent = req.body?.consent === 'true' || req.body?.consent === true;
  const targetMinutes = Math.max(1, Math.min(90, parseInt((req.body?.targetMinutes || '30').toString(), 10) || 30));
  const anthropicKey = (req.headers['x-anthropic-key'] as string) || '';
  const fishKey = (req.headers['x-fish-key'] as string) || '';
  const audio = req.file?.buffer;

  if (!voiceProfileId && !consent) { res.status(400).json({ error: '本人の声をクローンすることへの同意が必要です。', code: 'CONSENT_REQUIRED' }); return; }
  if (!transcript.trim()) { res.status(400).json({ error: '商談の文字起こしがありません。' }); return; }
  if (!anthropicKey) { res.status(400).json({ error: 'Anthropic APIキーが設定されていません。' }); return; }
  // 声サンプルは「保存済み声が無い初回」のみ必須
  const hasSavedVoiceFull = !!voiceProfileId || !!(db.prepare('SELECT 1 FROM voice_samples WHERE user_id = ?').get(user.id));
  if (!hasSavedVoiceFull && !audio) { res.status(400).json({ error: '声サンプル用の商談音声をアップロードしてください。' }); return; }
  if (!hasSavedVoiceFull && audio) { try { prepareVoiceSample(audio); } catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : '声サンプルが不正です。' }); return; } }

  cleanupVoiceJobs();
  const jobId = newId();
  const job: VoiceJob = { id: jobId, userId: user.id, status: 'running', phase: 'script', done: 0, total: 6, message: '理想台本を生成中…', createdAt: Date.now() };
  voiceJobs.set(jobId, job);
  res.json({ jobId });

  // レスポンス後にバックグラウンドで生成（キーはメモリ内のみ・保存しない）
  void (async () => {
    try {
      const perSection = targetCharsForMinutes(targetMinutes);
      job.phase = 'script';
      const script = await generateFullIdealClosingScript(
        transcript, referenceBaseline, anthropicKey, context, analysisFindings, perSection,
        (done, total) => { job.done = done; job.total = total; job.message = `理想台本を生成中… (${done}/${total}章)`; }
      );
      job.script = script;

      const provider = getVoiceProvider(fishKey);
      if (!voiceProfileId && !db.prepare('SELECT 1 FROM voice_samples WHERE user_id = ?').get(user.id)) {
        job.message = 'あなたの声を解析中…';
      }
      const resolved = await resolveVoiceId({ userId: user.id, voiceProfileId, provider, fishKey, audio });
      if ('error' in resolved) throw new Error(resolved.error);
      const voiceId = resolved.voiceId;

      const turns = buildClosingTurns(script, mode);
      const dialogue = turns.length > 0 ? turns : [{ speaker: 'rep' as const, text: script }];
      const customerVoiceId = pickCustomerVoiceId(customerGender);

      const ck = cacheKey(`${voiceId}|${customerVoiceId}|${mode}`, script);
      const cachedRow = db.prepare('SELECT audio_path FROM audio_cache WHERE cache_key = ?').get(ck) as any;
      if (cachedRow?.audio_path && fs.existsSync(cachedRow.audio_path)) {
        job.audioPath = cachedRow.audio_path;
        job.phase = 'done'; job.status = 'done'; job.message = '完了（キャッシュから・0円）';
        return;
      }

      job.phase = 'voice'; job.done = 0; job.total = dialogue.length; job.message = '音声を合成中…';
      const audioOut = await synthesizeDialogue(
        dialogue, provider, voiceId, fishKey, customerVoiceId,
        (done, total) => { job.done = done; job.total = total; job.message = `音声を合成中… (${done}/${total})`; }
      );
      fs.mkdirSync(AUDIO_DIR, { recursive: true });
      const outPath = path.join(AUDIO_DIR, `${ck}.mp3`);
      fs.writeFileSync(outPath, audioOut);
      db.prepare('INSERT OR REPLACE INTO audio_cache (cache_key, audio_path) VALUES (?, ?)').run(ck, outPath);
      job.audioPath = outPath;
      job.phase = 'done'; job.status = 'done'; job.message = '完了';
    } catch (e) {
      job.status = 'error'; job.phase = 'error';
      job.error = e instanceof Error ? e.message : '生成に失敗しました';
      console.error('[voice-full error]', job.error);
    }
  })();
});

// 生成ジョブの進捗・結果を取得
app.get('/api/voice/job/:id', requireAuth, (req, res) => {
  const user = (req as any).user;
  const job = voiceJobs.get(req.params.id);
  if (!job || job.userId !== user.id) { res.status(404).json({ error: 'ジョブが見つかりません。' }); return; }
  res.json({
    status: job.status,
    phase: job.phase,
    done: job.done,
    total: job.total,
    message: job.message,
    script: job.status === 'done' ? job.script : undefined,
    audioUrl: job.status === 'done' && job.audioPath ? `/api/voice/audio/${job.id}` : undefined,
    error: job.error,
  });
});

// 生成済み音声をストリーム配信（base64でJSONに載せると長尺で巨大になるため）
app.get('/api/voice/audio/:id', requireAuth, (req, res) => {
  const user = (req as any).user;
  const job = voiceJobs.get(req.params.id);
  if (!job || job.userId !== user.id || !job.audioPath || !fs.existsSync(job.audioPath)) { res.status(404).end(); return; }
  res.setHeader('Content-Type', 'audio/mpeg');
  fs.createReadStream(job.audioPath).pipe(res);
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

  console.log(`\n🚀 Pitch Navi起動中`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   プロバイダー: ${provider === 'groq' ? 'Groq (llama-3.3-70b)' : 'Anthropic (claude-sonnet-4-6)'}`);
  if (!hasKey) {
    console.log(`\n   ⚠️  APIキーが未設定です`);
    console.log(`   ブラウザで http://localhost:${PORT} を開き、APIキーを入力してください\n`);
  } else {
    console.log(`   ✅ APIキー設定済み\n`);
  }
});
