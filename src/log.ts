/*
 * ForgeCoach — log.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Reads an mtg-table frame log (docs/protocol.md §8 in jalirkan/mtg-table):
 * line 0 is the session header, every later line is a frame with `dir`.
 * Accepts plain .jsonl text or gzip bytes. Pure and Node-safe apart from
 * `readLogBytes`, which uses the platform DecompressionStream.
 */
import type {
  AskBody,
  ActBody,
  AnswerBody,
  Frame,
  FrameLog,
  GameStateBody,
  HelloOkBody,
  InputBody,
  OverBody,
  SessionHeader,
} from './protocol.ts';

/** One frame as it sits in the file: the envelope plus the direction. */
export type LoggedFrame = Frame & { dir?: 's2c' | 'c2s' };

export interface GameLog extends FrameLog {
  frames: LoggedFrame[];
  hello: HelloOkBody | null;
  over: OverBody | null;
  /** The viewing seat — every redaction in the file was made for this player id. */
  seat: number;
}

export function parseLog(text: string): GameLog {
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  // A file cut off mid-write (a game still being recorded, an engine that died, a
  // truncated .gz) ends in a partial line: drop it and read every complete one.
  // Only the LAST line, and only when the text does not end with its newline; a
  // broken line anywhere else is still an error.
  if (lines.length > 1 && !/\n\s*$/.test(text)) {
    try {
      JSON.parse(lines[lines.length - 1]!);
    } catch {
      lines.pop();
    }
  }
  if (lines.length === 0) throw new Error('The file is empty.');
  const header = JSON.parse(lines[0]!) as SessionHeader;
  if (header.kind !== 'session') {
    throw new Error('Line 0 is not an mtg-table session header — is this a frames.jsonl from var/games/?');
  }
  const frames: LoggedFrame[] = [];
  let hello: HelloOkBody | null = null;
  let over: OverBody | null = null;
  for (let i = 1; i < lines.length; i++) {
    const f = JSON.parse(lines[i]!) as LoggedFrame;
    frames.push(f);
    if (f.type === 'hello_ok' && !hello) hello = f.body as HelloOkBody;
    if (f.type === 'over') over = f.body as OverBody;
  }
  return { header, frames, hello, over, seat: header.seat };
}

const GZIP_MAGIC = [0x1f, 0x8b];

/** Bytes from a file input or fetch → parsed log; gunzips when the bytes are gzip. */
export async function readLogBytes(bytes: ArrayBuffer): Promise<GameLog> {
  const u8 = new Uint8Array(bytes);
  if (u8[0] === GZIP_MAGIC[0] && u8[1] === GZIP_MAGIC[1]) {
    // Read chunk by chunk: a truncated .gz ends in a decompression error, and what
    // came out before it is the log up to the cut (parseLog drops a partial line).
    const reader = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    const decoder = new TextDecoder();
    let text = '';
    let broken: unknown = null;
    for (;;) {
      let r: ReadableStreamReadResult<Uint8Array>;
      try {
        r = await reader.read();
      } catch (e) {
        broken = e;
        break;
      }
      if (r.done) break;
      text += decoder.decode(r.value, { stream: true });
    }
    text += decoder.decode();
    if (broken !== null && !text.includes('\n')) {
      throw new Error('The .gz file is damaged or cut off before its first complete line.');
    }
    return parseLog(text);
  }
  return parseLog(new TextDecoder().decode(u8));
}

// ---------------------------------------------------------------------------
// Typed narrowing helpers, so callers never cast `body`.

export const isState = (f: LoggedFrame): f is LoggedFrame & { type: 'state'; body: GameStateBody } =>
  f.type === 'state';
export const isInput = (f: LoggedFrame): f is LoggedFrame & { type: 'input'; body: InputBody } =>
  f.type === 'input';
export const isAsk = (f: LoggedFrame): f is LoggedFrame & { type: 'ask'; body: AskBody } => f.type === 'ask';
export const isAct = (f: LoggedFrame): f is LoggedFrame & { type: 'act'; body: ActBody } => f.type === 'act';
export const isAnswer = (f: LoggedFrame): f is LoggedFrame & { type: 'answer'; body: AnswerBody } =>
  f.type === 'answer';
