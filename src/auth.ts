import { Request, Response, NextFunction } from 'express';
import { randomBytes } from 'crypto';
import { db, newId } from './db';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  enabled: boolean;
}

const SESSION_DAYS = 30;

export function createSession(userId: string, res: Response): void {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)').run(newId(), userId, token, expiresAt);
  res.cookie('sc_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAYS * 86400 * 1000,
  });
}

export function getSessionUser(req: Request): SessionUser | null {
  const token = (req as any).cookies?.sc_session;
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.email, u.name, u.is_admin, u.enabled
    FROM sessions s
    INNER JOIN users u ON s.user_id = u.id
    WHERE s.token = ? AND s.expires_at > datetime('now')
    LIMIT 1
  `).get(token) as any;
  if (!row) return null;
  return { id: row.id, email: row.email, name: row.name, isAdmin: !!row.is_admin, enabled: !!row.enabled };
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const user = getSessionUser(req);
  if (!user) { res.status(401).json({ error: 'ログインが必要です' }); return; }
  if (!user.enabled) { res.status(403).json({ error: 'このアカウントは無効化されています' }); return; }
  (req as any).user = user;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const user = (req as any).user as SessionUser;
  if (!user?.isAdmin) { res.status(403).json({ error: '管理者権限が必要です' }); return; }
  next();
}
