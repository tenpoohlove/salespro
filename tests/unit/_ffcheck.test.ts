import { test, expect } from "vitest";
import { getFfmpegPath } from "../../src/closing";
test("ffmpeg path debug", () => { const p = getFfmpegPath(); console.log("VITEST_FFMPEG=", p); expect(true).toBe(true); });
