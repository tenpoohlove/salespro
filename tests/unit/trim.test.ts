import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { trimVoiceSample, getFfmpegPath } from '../../src/closing';

const ffmpeg = getFfmpegPath();

describe('trimVoiceSample 声サンプル自動トリミング', () => {
  it('空・極小バッファは検証で弾く', async () => {
    await expect(trimVoiceSample(Buffer.alloc(0))).rejects.toThrow();
    await expect(trimVoiceSample(Buffer.alloc(100))).rejects.toThrow();
  });

  it('ffmpeg不在なら検証を通った元データをそのまま返す（機能を止めない）', async () => {
    // ffmpegの有無に関わらず、十分なサイズなら何らかのBufferが返る（落ちない）こと
    const big = Buffer.alloc(20 * 1024, 1);
    const out = await trimVoiceSample(big, 5);
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.length).toBeGreaterThan(0);
  });

  // ffmpegがある環境では、長尺音声を実際に短く切れることを検証
  it.skipIf(!ffmpeg)('長尺音声を maxSeconds に切り詰めて軽量化する', async () => {
    const id = crypto.randomBytes(6).toString('hex');
    const src = path.join(os.tmpdir(), `trimtest_${id}.mp3`);
    try {
      // 60秒のサイン波mp3を生成（入力）
      execFileSync(ffmpeg!, [
        '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=60',
        '-ar', '44100', '-b:a', '128k', src,
      ], { stdio: 'ignore' });
      const input = fs.readFileSync(src);
      expect(input.length).toBeGreaterThan(50 * 1024);

      // 5秒に切り詰め
      const out = await trimVoiceSample(input, 5);
      expect(out.length).toBeGreaterThan(0);
      // 5秒mono22kは60秒128kステレオよりはるかに小さい
      expect(out.length).toBeLessThan(input.length / 2);
    } finally {
      try { fs.existsSync(src) && fs.unlinkSync(src); } catch { /* noop */ }
    }
  });
});
