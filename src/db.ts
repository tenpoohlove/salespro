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
    newsletter_consent INTEGER DEFAULT 0,
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
try { db.exec('ALTER TABLE users ADD COLUMN newsletter_consent INTEGER DEFAULT 0'); } catch {} // お知らせ受け取り同意

// 管理者が設定する運用設定（SMTP等）。key-value・暗号化はvalue側で実施。
db.exec(`
  CREATE TABLE IF NOT EXISTS app_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  );

  -- 名前付きで保存する声プロフィール（FR-VOICE-002拡張）。1ユーザーに複数。
  -- 一度作った本人の声(fish_voice_id)に名前を付けて保存し、次回はアップ不要で選ぶだけにする。
  CREATE TABLE IF NOT EXISTS voice_profiles (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    name          TEXT NOT NULL,
    fish_voice_id TEXT NOT NULL,
    created_at    TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_voice_profiles_user ON voice_profiles(user_id);

  -- 読み取り専用の共有スナップショット（F1）。
  -- payload には markdown 本文と「お手本セリフ→cacheKey一覧」をJSONで格納。
  -- 共有相手はログイン不要で /share/:id から閲覧・音声再生のみ可能。
  -- audio配信は payload に含まれる cacheKey のみに限定（他キャッシュは漏れない）。
  CREATE TABLE IF NOT EXISTS shares (
    id          TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL,
    payload     TEXT NOT NULL,
    expires_at  TEXT NOT NULL,
    created_at  TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_shares_owner ON shares(owner_user_id);
`);

// 既存の自動保存声(voice_samples・1ユーザー1件)を、名前付きプロフィールへ移行する（冪等）。
// まだプロフィールが1件も無いユーザーの旧データだけを「保存した声」として引き継ぐ。
db.exec(`
  INSERT INTO voice_profiles (id, user_id, name, fish_voice_id, created_at)
  SELECT lower(hex(randomblob(16))), vs.user_id, '保存した声', vs.fish_voice_id, vs.created_at
  FROM voice_samples vs
  WHERE NOT EXISTS (SELECT 1 FROM voice_profiles vp WHERE vp.user_id = vs.user_id);
`);

// G3: 公式声(index 0..2)とお客様の声(以前は index 0)が同じ声を引いていた古い設定を一度だけ削除する。
// 次回 resolveCustomerVoiceId 呼び出し時に index=5以降で取り直されるので、本人=公式声①と客=女性が被らなくなる。
// 冪等：一度実行したら customer_voice_migrated_g3=done を立てて再実行しない。
try {
  const migrated = db.prepare("SELECT value FROM app_settings WHERE key = 'customer_voice_migrated_g3'").get() as any;
  if (!migrated) {
    db.prepare("DELETE FROM app_settings WHERE key IN ('customer_voice_female','customer_voice_male')").run();
    db.prepare("INSERT INTO app_settings (key, value) VALUES ('customer_voice_migrated_g3','done')").run();
  }
} catch { /* 起動時マイグレーション失敗はアプリ停止理由にしない */ }

export function newId() {
  return randomBytes(16).toString('hex');
}

// 運用設定(app_settings)の読み書き。管理者が画面から設定するSMTP等に使う。
export function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as any;
  return row ? row.value : null;
}

export function setSetting(key: string, value: string): void {
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now','localtime'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now','localtime')
  `).run(key, value);
}
