// ForgeCoach — bug/report.test.ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseLog, isState } from '../log.ts';
import { SETTINGS_KEY } from '../claude.ts';
import { SEAT_TOKEN_KEY } from '../play/seatUrl.ts';
import { FRIEND_ROOMS_KEY, FRIEND_TABLE_KEY } from '../play/friendTable.ts';
import {
  attachedSummary,
  buildReport,
  capPart,
  clientId,
  collectSecrets,
  EMPTY_SNAPSHOT,
  gameFacts,
  logTail,
  MAX_FRAMES,
  MAX_PART_BYTES,
  MAX_REPORT_BYTES,
  MAX_SHOT_BASE64,
  scrubKeys,
  scrubReport,
  scrubText,
  type BugSnapshot,
  type ClientFacts,
} from './report.ts';

const log = parseLog(gunzipSync(readFileSync(new URL('../../public/samples/human-auto-42.jsonl.gz', import.meta.url))).toString('utf8'));
const lastState = [...log.frames].reverse().find(isState)!.body;

const KEY = 'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-abcdef';
const PAIRING = 'PairingToken_0123456789abcdef';
const ROOM_TOKEN = 'RoomSeatToken0123456789AB';
const FRIEND_TOKEN = 'FriendLinkToken987654321ZY';
const TABLE_TOKEN = 'TableSeatTokenAAAABBBBCCCC';

function mem(entries: Record<string, string>): Storage {
  const m = new Map(Object.entries(entries));
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

const storage = mem({
  [SETTINGS_KEY]: JSON.stringify({ apiKey: KEY, model: 'claude-opus-5-5' }),
  [SEAT_TOKEN_KEY]: PAIRING,
  [FRIEND_ROOMS_KEY]: JSON.stringify([
    { id: 'rAbcd1234', base: 'https://pc.tail1.ts.net', token: ROOM_TOKEN, seat: 0, friendLinks: [{ label: 'x', url: `https://pc.tail1.ts.net/#draft/friend/join?room=rAbcd1234&t=${FRIEND_TOKEN}` }] },
  ]),
  [FRIEND_TABLE_KEY]: JSON.stringify({ room: 'rAbcd1234', seat: 0, game: 1, url: `wss://pc.tail1.ts.net/ws?seat=${TABLE_TOKEN}` }),
});

const client: ClientFacts = {
  build: 'abc1234 2026-10-07',
  skin: 'classic',
  settings: { model: 'claude-opus-5-5', apiKeySet: true },
  viewport: { w: 1440, h: 900, dpr: 1 },
  userAgent: 'test',
  language: 'en',
  online: true,
  standalone: false,
  servedBy: 'pages',
};

function snapshot(over: Partial<BugSnapshot> = {}): BugSnapshot {
  return { ...EMPTY_SNAPSHOT, surface: 'play', game: gameFacts(lastState, log.seat), log, ...over };
}

describe('secrets', () => {
  it('collects the API key, the pairing token, room and friend-link tokens, the table token and URL tokens', () => {
    const s = collectSecrets(storage, { search: '?token=UrlPairingToken_xyz123', hash: '#draft/friend/join?room=rAbcd1234&t=HashTokenValue123456' });
    expect(s).toEqual(expect.arrayContaining([KEY, PAIRING, ROOM_TOKEN, FRIEND_TOKEN, TABLE_TOKEN, 'UrlPairingToken_xyz123', 'HashTokenValue123456']));
  });

  it('survives missing or broken storage', () => {
    expect(collectSecrets(null, null)).toEqual([]);
    expect(collectSecrets(mem({ [SETTINGS_KEY]: '{not json', [FRIEND_ROOMS_KEY]: '7' }), null)).toEqual([]);
  });

  it('scrubText removes each secret (plain and URL-encoded), Anthropic-shaped keys and token URL values', () => {
    const text = JSON.stringify({ a: `x ${ROOM_TOKEN} y`, b: encodeURIComponent(`${PAIRING}+/`), c: 'sk-ant-api03-zzzzzzzzzzzz', d: 'ws://h/ws?seat=Abcdefghij&x=1', e: '#join?room=r1&t=Zyxwvutsrq' });
    const out = scrubText(text, [ROOM_TOKEN, `${PAIRING}+/`]);
    expect(out).not.toContain(ROOM_TOKEN);
    expect(out).not.toContain(PAIRING);
    expect(out).not.toContain('sk-ant-api03');
    expect(out).toContain('seat=[redacted]');
    expect(out).toContain('t=[redacted]');
  });

  it('scrubKeys redacts token-named strings but keeps a card’s token flag', () => {
    expect(scrubKeys({ token: 'abc', isToken: true, card: { token: true, name: 'Goblin Token' }, apiKey: 'k', 'X-Room-Token': 'r' })).toEqual({
      token: '[redacted]',
      isToken: true,
      card: { token: true, name: 'Goblin Token' },
      apiKey: '[redacted]',
      'X-Room-Token': '[redacted]',
    });
  });

  it('a whole report never carries a secret, wherever the page put it', () => {
    const secrets = collectSecrets(storage, { search: '', hash: '' });
    const r = buildReport({
      title: `Broke with ${KEY}`,
      details: `my link https://pc.tail1.ts.net/#draft/friend/join?room=rAbcd1234&t=${FRIEND_TOKEN} and seat ${TABLE_TOKEN}`,
      severity: 'major',
      snapshot: snapshot({ extra: { url: `ws://192.168.1.5:8642/ws?token=${PAIRING}`, game: { token: ROOM_TOKEN } } }),
      console: [{ t: 1, level: 'error', text: `fetch failed with X-Room-Token ${ROOM_TOKEN}` }],
      client,
      route: `#draft/friend/join?room=rAbcd1234&t=${FRIEND_TOKEN}`,
      secrets,
    });
    const text = JSON.stringify(r);
    for (const s of [KEY, PAIRING, ROOM_TOKEN, FRIEND_TOKEN, TABLE_TOKEN]) expect(text).not.toContain(s);
    expect(r.title).toContain('[redacted');
  });

  it('scrubReport leaves the images alone', () => {
    const r = buildReport({ title: 't', details: '', severity: null, snapshot: snapshot(), console: [], client, route: '#', secrets: [], screenshot: { mediaType: 'image/jpeg', data: 'QUJD', width: 1, height: 1, how: 'dom' } });
    expect(scrubReport(r, ['QUJD']).screenshot?.data).toBe('QUJD');
  });
});

describe('caps', () => {
  it('logTail keeps the newest MAX_FRAMES frames', () => {
    const t = logTail(log)!;
    expect(t.frames.length).toBe(Math.min(MAX_FRAMES, log.frames.length));
    expect(t.frames.at(-1)).toEqual(log.frames.at(-1));
    expect(t.from + t.frames.length).toBe(log.frames.length);
    expect(t.total).toBe(log.frames.length);
    expect(t.seat).toBe(log.seat);
  });

  it('logTail drops older frames to stay under its byte cap', () => {
    const t = logTail(log, MAX_FRAMES, 50_000)!;
    expect(new TextEncoder().encode(t.frames.map((f) => JSON.stringify(f)).join('\n')).length).toBeLessThanOrEqual(50_000);
    expect(t.frames.at(-1)).toEqual(log.frames.at(-1));
  });

  it('capPart stubs an oversized part', () => {
    const big = { kind: 'chooseList', prompt: 'Choose', options: Array.from({ length: 5000 }, (_, i) => ({ id: i, label: 'x'.repeat(40) })) };
    const c = capPart(big) as Record<string, unknown>;
    expect(c.truncated).toBe(true);
    expect(c.kind).toBe('chooseList');
    expect(JSON.stringify(c).length).toBeLessThan(MAX_PART_BYTES);
    expect(capPart({ kind: 'confirm' })).toEqual({ kind: 'confirm' });
  });

  it('title and details are cleaned and capped; a report without a title is refused', () => {
    const r = buildReport({ title: `  line\none\t ${'x'.repeat(300)}`, details: 'd'.repeat(20_000), severity: null, snapshot: snapshot(), console: [], client, route: '#', secrets: [] });
    expect(r.title.startsWith('line one x')).toBe(true);
    expect([...r.title].length).toBe(120);
    expect(r.details.length).toBe(8000);
    expect(() => buildReport({ title: '   ', details: '', severity: null, snapshot: snapshot(), console: [], client, route: '#', secrets: [] })).toThrow();
  });

  it('the console is at most 50 entries of 600 characters', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ t: i, level: 'error' as const, text: 'e'.repeat(1000) }));
    const r = buildReport({ title: 't', details: '', severity: null, snapshot: snapshot(), console: many, client, route: '#', secrets: [] });
    expect(r.console.length).toBe(50);
    expect(r.console[0]!.t).toBe(30);
    expect(r.console.every((c) => c.text.length === 600)).toBe(true);
  });

  it('a report without images stays under MAX_REPORT_BYTES even with huge frames', () => {
    const fat = { ...log, frames: Array.from({ length: 300 }, (_, i) => ({ type: 'notice', seq: i, t: i, body: { level: 'info', title: 'x', text: 'y'.repeat(20_000) } })) } as unknown as typeof log;
    const r = buildReport({ title: 't', details: '', severity: null, snapshot: snapshot({ log: fat }), console: [], client, route: '#', secrets: [] });
    expect(new TextEncoder().encode(JSON.stringify(r)).length).toBeLessThanOrEqual(MAX_REPORT_BYTES);
    expect(r.log!.frames.length).toBeGreaterThan(0);
  });

  it('an over-cap screenshot is left out; a fitting one is kept', () => {
    const shot = (n: number) => ({ mediaType: 'image/jpeg' as const, data: 'A'.repeat(n), width: 10, height: 10, how: 'dom' as const });
    const base = { title: 't', details: '', severity: null, snapshot: snapshot(), console: [], client, route: '#', secrets: [] };
    expect(buildReport({ ...base, screenshot: shot(MAX_SHOT_BASE64 + 4) }).screenshot).toBeUndefined();
    expect(buildReport({ ...base, screenshot: shot(1000) }).screenshot?.data.length).toBe(1000);
  });
});

describe('the report', () => {
  it('carries the game, its kind and schema, and the client facts', () => {
    const r = buildReport({ title: 'Pass did nothing', details: 'x', severity: 'blocker', snapshot: snapshot(), console: [], client, route: '#play', secrets: [], now: Date.parse('2026-10-07T15:30:12Z'), random: () => 0 });
    expect(r.kind).toBe('forgecoach-bug');
    expect(r.schema).toBe(1);
    expect(r.clientId).toBe('fc-20261007-153012-aaaa');
    expect(r.game).toMatchObject({ gameId: lastState.gameId, seat: log.seat, turn: lastState.turn, phase: lastState.phase });
    expect(r.client.build).toBe('abc1234 2026-10-07');
    expect(r.severity).toBe('blocker');
  });

  it('gameFacts says whose priority it is', () => {
    const st = { ...lastState, priority: 1, activePlayer: 1 };
    expect(gameFacts(st, 1)!.priorityIs).toBe('you');
    expect(gameFacts(st, 0)!.priorityIs).toBe('opponent');
    expect(gameFacts({ ...st, priority: null }, 0)!.priorityIs).toBeNull();
    expect(gameFacts(null, 0)).toBeNull();
  });

  it('the summary lists what is added', () => {
    const lines = attachedSummary(snapshot(), 2);
    expect(lines.join('\n')).toContain(`game ${lastState.gameId}`);
    expect(lines.join('\n')).toContain('2 recent console messages');
    expect(lines.join('\n')).toContain('never your API key');
  });

  it('client ids are distinct and file-safe', () => {
    expect(clientId(0)).toMatch(/^fc-\d{8}-\d{6}-[a-z2-9]{4}$/);
  });
});
