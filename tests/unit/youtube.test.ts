import { describe, it, expect } from 'vitest';
import {
  extractYouTubeVideoId,
  isYouTubeUrl,
  isZoomRecordingUrl,
  videoUrlGuidance,
} from '../../src/youtube';

describe('extractYouTubeVideoId 各種URLから動画ID', () => {
  it('watch?v=', () => {
    expect(extractYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });
  it('追加クエリ付き watch', () => {
    expect(extractYouTubeVideoId('https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=abc')).toBe('dQw4w9WgXcQ');
  });
  it('youtu.be 短縮', () => {
    expect(extractYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ?si=xxx')).toBe('dQw4w9WgXcQ');
  });
  it('shorts / live / embed', () => {
    expect(extractYouTubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractYouTubeVideoId('https://www.youtube.com/live/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractYouTubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });
  it('m.youtube も対応', () => {
    expect(extractYouTubeVideoId('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });
  it('YouTube以外/不正は null', () => {
    expect(extractYouTubeVideoId('https://example.com/lp')).toBeNull();
    expect(extractYouTubeVideoId('https://www.youtube.com/watch?v=short')).toBeNull();
    expect(extractYouTubeVideoId('not a url')).toBeNull();
    expect(extractYouTubeVideoId('')).toBeNull();
  });
});

describe('isYouTubeUrl', () => {
  it('YouTube系はtrue', () => {
    expect(isYouTubeUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(true);
    expect(isYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
  });
  it('それ以外はfalse', () => {
    expect(isYouTubeUrl('https://example.com')).toBe(false);
    expect(isYouTubeUrl('https://company.zoom.us/rec/share/abc')).toBe(false);
  });
});

describe('isZoomRecordingUrl', () => {
  it('Zoom録画URLはtrue', () => {
    expect(isZoomRecordingUrl('https://us02web.zoom.us/rec/share/abcDEF123')).toBe(true);
    expect(isZoomRecordingUrl('https://zoom.us/rec/play/xyz')).toBe(true);
  });
  it('Zoomでも録画以外/別ドメインはfalse', () => {
    expect(isZoomRecordingUrl('https://zoom.us/j/123456')).toBe(false);
    expect(isZoomRecordingUrl('https://notzoom.us/rec/share/x')).toBe(false);
    expect(isZoomRecordingUrl('https://example.com')).toBe(false);
  });
});

describe('videoUrlGuidance 動画URLは案内文・それ以外はnull', () => {
  it('YouTubeは案内文（コピペ/ファイルアップ）', () => {
    const g = videoUrlGuidance('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(g).toContain('YouTube');
    expect(g).toContain('文字起こしを表示');
    expect(g).toContain('アップロード');
  });
  it('Zoom録画はZoom向け案内', () => {
    const g = videoUrlGuidance('https://us02web.zoom.us/rec/share/abc');
    expect(g).toContain('Zoom');
    expect(g).toContain('アップ');
  });
  it('文章ページURLはnull（通常のスクレイプに回す）', () => {
    expect(videoUrlGuidance('https://example.com/lp')).toBeNull();
  });
});
