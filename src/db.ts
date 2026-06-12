import Database from 'better-sqlite3';
import path from 'path';
import { randomBytes } from 'crypto';

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data.db');
export const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name          TEXT NOT NULL,
    phone         TEXT,
    is_admin      INTEGER DEFAULT 0,
    is_verified   INTEGER DEFAULT 0,
    enabled       INTEGER DEFAULT 1,
    created_at    TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    token      TEXT UNIQUE NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS email_verifications (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    token      TEXT UNIQUE NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_api_keys (
    user_id       TEXT PRIMARY KEY,
    anthropic_key TEXT,
    openai_key    TEXT,
    updated_at    TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- 声クローン基盤（FR-VOICE-002/004, FR-DATA-013）
  CREATE TABLE IF NOT EXISTS voice_samples (
    user_id       TEXT PRIMARY KEY,
    fish_voice_id TEXT NOT NULL,
    created_at    TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS audio_cache (
    cache_key  TEXT PRIMARY KEY,   -- sha256(voiceId + 台本)
    audio_path TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS reference_baselines (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    kind       TEXT NOT NULL,      -- 'script' | 'manual'
    content    TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// 既存DBへのマイグレーション（カラム追加・エラーは無視）
try { db.exec('ALTER TABLE users ADD COLUMN is_verified INTEGER DEFAULT 1'); } catch {}
try { db.exec('ALTER TABLE user_api_keys ADD COLUMN fish_key TEXT'); } catch {} // FR-USR-002

export function newId() {
  return randomBytes(16).toString('hex');
}
