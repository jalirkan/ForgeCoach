/*
 * ForgeCoach — log.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseLog, readLogBytes } from './log.ts';

const GZ = readFileSync(new URL('../public/samples/human-auto-42.jsonl.gz', import.meta.url));
const TEXT = gunzipSync(GZ).toString('utf8');
const FULL = parseLog(TEXT);
const ab = (b: Uint8Array): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

describe('a frame log cut off mid-write (a game still being written, an engine that died)', () => {
  it('a .jsonl whose last line is incomplete reads every complete line', () => {
    const cut = TEXT.lastIndexOf('\n', TEXT.length - 2) + 25; // 25 characters into the last line
    const log = parseLog(TEXT.slice(0, cut));
    expect(log.frames).toHaveLength(FULL.frames.length - 1);
    expect(log.frames).toEqual(FULL.frames.slice(0, -1));
    expect(log.header).toEqual(FULL.header);
  });

  it('a broken line in the middle is still an error, not skipped', () => {
    const lines = TEXT.split('\n');
    lines[5] = lines[5]!.slice(0, 20);
    expect(() => parseLog(lines.join('\n'))).toThrow();
  });

  it('a truncated .jsonl.gz reads what was written before the cut', async () => {
    const log = await readLogBytes(ab(GZ.subarray(0, Math.floor(GZ.length * 0.6))));
    expect(log.header).toEqual(FULL.header);
    expect(log.frames.length).toBeGreaterThan(10);
    expect(log.frames.length).toBeLessThan(FULL.frames.length);
    expect(log.frames).toEqual(FULL.frames.slice(0, log.frames.length));
  });

  it('a whole .jsonl.gz and its text read the same', async () => {
    expect(await readLogBytes(ab(GZ))).toEqual(FULL);
    expect(await readLogBytes(ab(new TextEncoder().encode(TEXT)))).toEqual(FULL);
  });

  it('gzip bytes that hold no complete line are an error', async () => {
    await expect(readLogBytes(ab(GZ.subarray(0, 12)))).rejects.toThrow();
  });
});
