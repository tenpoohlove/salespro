// 動画URL（YouTube/Zoom録画など）の検知と案内。
// 動画の「中身（会話）」は静的HTMLに無く、URL取得では拾えない（YouTubeは字幕がトークン保護、
// Zoom録画はパスワード壁）。自動取得は実現可能でも定期メンテが必要なため採用しない方針。
// よって動画URLを検知したら、無駄な取得を試みず、確実な代替（コピペ／ファイルアップ）を即案内する。

/** 各種YouTube URLから動画IDを取り出す。該当しなければ null（純粋関数） */
export function extractYouTubeVideoId(url: string): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\./, '').toLowerCase();
  const isId = (v: string | null): v is string => !!v && /^[A-Za-z0-9_-]{11}$/.test(v);

  if (host === 'youtu.be') {
    const id = u.pathname.split('/').filter(Boolean)[0] || '';
    return isId(id) ? id : null;
  }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') {
      const v = u.searchParams.get('v');
      return isId(v) ? v : null;
    }
    const m = u.pathname.match(/^\/(?:shorts|live|embed|v)\/([A-Za-z0-9_-]{11})/);
    if (m && isId(m[1])) return m[1];
  }
  return null;
}

/** YouTube動画URLか（純粋関数） */
export function isYouTubeUrl(url: string): boolean {
  return extractYouTubeVideoId(url) !== null;
}

/** Zoomの録画共有URLか（純粋関数） */
export function isZoomRecordingUrl(url: string): boolean {
  if (!url) return false;
  try {
    const u = new URL(url.trim());
    return /(^|\.)zoom\.us$/i.test(u.hostname) && /\/rec\//i.test(u.pathname);
  } catch {
    return false;
  }
}

/**
 * 動画URL（中身を取得できない種類）なら案内文を返す。そうでなければ null。
 * server側はこれが非nullなら、その案内をそのまま利用者に返す。
 */
export function videoUrlGuidance(url: string): string | null {
  if (isYouTubeUrl(url)) {
    return (
      'YouTubeのURLからは動画の中身（会話）を取得できません。' +
      '動画下の「…（その他）→ 文字起こしを表示」から全文をコピーしてテキスト欄に貼り付けるか、' +
      '動画ファイル（.mp4/.mp3等）をダウンロードしてアップロードしてください（自動で文字起こしします）。'
    );
  }
  if (isZoomRecordingUrl(url)) {
    return (
      'Zoomの録画URLからは中身を取得できません（パスワード保護のため）。' +
      'Zoomの録画ファイル（.mp4/.m4a）をアップロードするか（自動で文字起こしします）、' +
      'Zoomが生成した文字起こし（.vtt/.txt）をアップ／貼り付けてください。'
    );
  }
  return null;
}
