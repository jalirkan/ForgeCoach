// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAB_SRC,
  LabFetchError,
  LabStatusError,
  cleanText,
  fetchLabStatus,
  formatClock,
  formatDuration,
  formatRelative,
  isEmptyStatus,
  jobEta,
  labSource,
  memFraction,
  parseDuration,
  parseLabStatus,
  parseTime,
  pressureLevel,
  rebaseTimes,
  staleness,
  heartbeatStale,
  runState,
  HEARTBEAT_STALE_S,
  IDLE_RED_AFTER_S,
  updatedLine,
  withCacheBuster,
  liveCells,
  parseLive,
  parseCubes,
  formatBytes,
  MAX_LIVE,
  MAX_CUBES,
} from './status.ts';

const sample = JSON.parse(readFileSync(new URL('../../public/lab-sample.json', import.meta.url), 'utf8')) as unknown;
const SPEC_EXAMPLE = {
  updated: '2026-10-03T10:55:00-04:00',
  host: { load1: 6.2, memUsedGb: 14.1, memTotalGb: 30, swapUsedMb: 0, pressure: 0.0 },
  running: {
    id: 'J003',
    title: '...',
    phase: 'night-cube-search (2 of 5)',
    started: '2026-10-03T10:34:00-04:00',
    done: 212,
    total: 400,
    unit: 'games',
    ratePerHour: 310,
    eta: '2026-10-03T12:40:00-04:00',
    workers: 6,
    errors: 0,
  },
  queue: [{ id: 'J004', title: '...', est: '~3 h' }],
  finished: [{ id: 'J002', status: 'done', finished: '...', headline: 'no detectable difference (+0.01)' }],
};

describe('parseLabStatus', () => {
  it('reads the spec example (running as a single object)', () => {
    const s = parseLabStatus(SPEC_EXAMPLE);
    expect(s.updated?.toISOString()).toBe('2026-10-03T14:55:00.000Z');
    expect(s.host).toMatchObject({ load1: 6.2, memUsedGb: 14.1, memTotalGb: 30, swapUsedMb: 0, pressure: 0, cpus: null });
    expect(s.running).toHaveLength(1);
    const j = s.running[0]!;
    expect(j).toMatchObject({ id: 'J003', phase: 'night-cube-search (2 of 5)', done: 212, total: 400, unit: 'games', workers: 6, errors: 0, paused: false });
    expect(j.fraction).toBeCloseTo(0.53);
    // No `elapsed`: updated − started.
    expect(j.elapsedS).toBe(21 * 60);
    expect(s.queue).toEqual([{ id: 'J004', title: '...', est: '~3 h' }]);
    expect(s.finished[0]).toMatchObject({ id: 'J002', kind: 'done', finished: null, headline: 'no detectable difference (+0.01)' });
    expect(s.waiting).toEqual([]);
    expect(s.schema).toBeNull();
  });

  it('reads the bundled sample with the optional fields', () => {
    const s = parseLabStatus(sample);
    expect(s.schema).toBe(1);
    expect(s.running.map((r) => r.id)).toEqual(['J003', 'J005', 'J020']);
    expect(s.running[0]!.elapsedS).toBe(1260);
    expect(s.host?.cpus).toBe(16);
    expect(s.waiting[0]).toMatchObject({ id: 'J007', reason: 'needs 22 GB free; waits for J003' });
    // Newest first.
    expect(s.finished.map((f) => f.id)).toEqual(['J003a', 'J002', 'J001']);
    expect(s.finished.map((f) => f.kind)).toEqual(['failed', 'done', 'skipped']);
    expect(s.pressureEvents.map((e) => e.action)).toEqual(['dropped to 6 workers', 'paused new games for 2 min (some avg10 12.4)']);
    expect(isEmptyStatus(s)).toBe(false);
  });

  it('takes running: null, an empty object list, and a paused runner', () => {
    expect(parseLabStatus({ running: null }).running).toEqual([]);
    const s = parseLabStatus({ paused: true, running: [{ id: 'A', done: 1, total: 2 }, 'junk', null] });
    expect(s.running).toHaveLength(1);
    expect(s.running[0]!.paused).toBe(true);
    expect(isEmptyStatus(parseLabStatus({}))).toBe(true);
  });

  it('rejects what is not an object', () => {
    for (const bad of [null, 42, 'status', [1, 2], true]) expect(() => parseLabStatus(bad)).toThrow(LabStatusError);
  });

  it('survives malformed fields: wrong types, NaN-ish numbers, bad dates, odd lists', () => {
    const s = parseLabStatus({
      updated: 'yesterday',
      schema: 'two',
      host: { load1: -3, memUsedGb: '14.5', memTotalGb: 0, swapUsedMb: 'lots', pressure: 400 },
      running: { id: { x: 1 }, done: 'NaN', total: Infinity, ratePerHour: -5, workers: 6.7, errors: -1, eta: 'soon', elapsed: 'a while', started: 12 },
      queue: 'J004',
      waiting: [{}, 5],
      finished: [{ status: 'exploded', finished: '2026-13-45T99:00:00Z' }, 'x'],
      pressureEvents: [{ at: 'now' }, { at: 'now', action: 'dropped a worker' }],
      extra: { anything: true },
    });
    expect(s.updated).toBeNull();
    expect(s.schema).toBeNull();
    expect(s.host).toEqual({ load1: null, cpus: null, memUsedGb: 14.5, memTotalGb: null, swapUsedMb: null, pressure: null });
    const j = s.running[0]!;
    expect(j).toMatchObject({ id: '—', done: null, total: null, ratePerHour: null, workers: 7, errors: null, eta: null, etaText: 'soon', elapsedS: null, elapsedText: 'a while', started: null, fraction: null });
    expect(s.queue).toEqual([]);
    expect(s.waiting).toEqual([{ id: '—', title: null, reason: null, est: null }]);
    expect(s.finished).toHaveLength(1);
    expect(s.finished[0]).toMatchObject({ kind: 'other', status: 'exploded', finished: null });
    expect(s.pressureEvents).toEqual([{ at: null, atText: 'now', action: 'dropped a worker' }]);
  });

  it('clamps progress past the total and ignores a zero total', () => {
    expect(parseLabStatus({ running: { done: 450, total: 400 } }).running[0]!.fraction).toBe(1);
    expect(parseLabStatus({ running: { done: 0, total: 0 } }).running[0]!.fraction).toBeNull();
  });

  it('caps long lists', () => {
    const s = parseLabStatus({ queue: Array.from({ length: 500 }, (_, i) => ({ id: `J${i}` })) });
    expect(s.queue.length).toBe(50);
  });

  it('reads pressureEvents from host too', () => {
    const s = parseLabStatus({ host: { load1: 1, pressureEvents: [{ at: '2026-10-03T10:00:00Z', action: 'paused' }] } });
    expect(s.pressureEvents).toHaveLength(1);
  });
});

describe('cleanText', () => {
  it('strips control and bidi characters, collapses space, clips', () => {
    expect(cleanText('a\u0000b\nc\u202ed')).toBe('a b c d');
    expect(cleanText('   ')).toBeNull();
    expect(cleanText(7)).toBe('7');
    expect(cleanText({})).toBeNull();
    expect(cleanText('x'.repeat(500), 10)).toBe(`${'x'.repeat(9)}…`);
  });
  it('leaves markup as plain text (React escapes it)', () => {
    expect(cleanText('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('parseTime / parseDuration', () => {
  it('needs a dated timestamp', () => {
    expect(parseTime('2026-10-03T10:55:00-04:00')?.toISOString()).toBe('2026-10-03T14:55:00.000Z');
    expect(parseTime('10:55')).toBeNull();
    expect(parseTime('Sat Oct 3')).toBeNull();
    expect(parseTime(1759503300000)).toBeNull();
    expect(parseTime('1900-01-01T00:00:00Z')).toBeNull();
  });
  it('reads seconds and duration text', () => {
    expect(parseDuration(90)).toBe(90);
    expect(parseDuration('90')).toBe(90);
    expect(parseDuration('1 h 20 min')).toBe(4800);
    expect(parseDuration('1h20m')).toBe(4800);
    expect(parseDuration('~3 h')).toBe(10800);
    expect(parseDuration('2 days, 3 hours')).toBe(183600);
    expect(parseDuration('01:20:00')).toBe(4800);
    expect(parseDuration('PT1H20M')).toBe(4800);
    expect(parseDuration('a while')).toBeNull();
    expect(parseDuration('3 h and then some')).toBeNull();
    expect(parseDuration(-5)).toBeNull();
    expect(parseDuration(NaN)).toBeNull();
  });
});

describe('formatting', () => {
  const now = new Date('2026-10-03T15:00:00Z');
  it('formats durations', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(12 * 60)).toBe('12 min');
    expect(formatDuration(2 * 3600 + 10 * 60)).toBe('2 h 10 min');
    expect(formatDuration(3 * 3600)).toBe('3 h');
    expect(formatDuration(3 * 86400 + 4 * 3600)).toBe('3 d 4 h');
  });
  it('formats relative times', () => {
    expect(formatRelative(new Date(now.getTime() + (2 * 3600 + 10 * 60) * 1000), now)).toBe('in 2 h 10 min');
    expect(formatRelative(new Date(now.getTime() - 180_000), now)).toBe('3 min ago');
    expect(formatRelative(new Date(now.getTime() + 20_000), now)).toBe('just now');
    expect(formatRelative(null, now)).toBe('—');
  });
  it('formats a local clock, with the weekday when not today', () => {
    const later = new Date(now.getTime() + 30 * 60_000);
    expect(formatClock(later, now, 'en-GB')).toBe(later.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
    expect(formatClock(new Date(now.getTime() + 2 * 86_400_000), now, 'en-GB')).toMatch(/^[A-Z][a-z]{2} \d\d:\d\d$/);
    expect(formatClock(null, now)).toBe('—');
  });
  it('grades staleness at 10 and 30 minutes', () => {
    const ago = (min: number) => new Date(now.getTime() - min * 60_000);
    expect(staleness(ago(3), now).level).toBe('fresh');
    expect(staleness(ago(10), now).level).toBe('amber');
    expect(staleness(ago(29), now).level).toBe('amber');
    expect(staleness(ago(30), now).level).toBe('red');
    expect(staleness(null, now)).toEqual({ level: 'unknown', ageS: null });
    // A clock running ahead is fresh, not negative.
    expect(staleness(new Date(now.getTime() + 60_000), now)).toEqual({ level: 'fresh', ageS: 0 });
    expect(updatedLine(ago(3), now)).toBe('updated 3 min ago');
    expect(updatedLine(ago(0.2), now)).toBe('updated just now');
  });
  it('grades pressure and memory', () => {
    expect(pressureLevel(null)).toBeNull();
    expect(pressureLevel(0)).toBe('calm');
    expect(pressureLevel(4)).toBe('elevated');
    expect(pressureLevel(12)).toBe('high');
    expect(memFraction({ load1: null, cpus: null, memUsedGb: 15, memTotalGb: 30, swapUsedMb: null, pressure: null })).toBe(0.5);
    expect(memFraction(null)).toBeNull();
  });
  it('derives an ETA from the rate when the runner gives none', () => {
    const s = parseLabStatus({ updated: '2026-10-03T15:00:00Z', running: { done: 100, total: 400, ratePerHour: 300 } });
    const eta = jobEta(s.running[0]!, s.updated);
    expect(eta).toEqual({ at: new Date('2026-10-03T16:00:00Z'), derived: true });
    const given = parseLabStatus({ running: { eta: '2026-10-03T16:30:00Z' } });
    expect(jobEta(given.running[0]!, null)?.derived).toBe(false);
    const paused = parseLabStatus({ updated: '2026-10-03T15:00:00Z', running: { done: 1, total: 4, ratePerHour: 3, paused: true } });
    expect(jobEta(paused.running[0]!, paused.updated)).toBeNull();
  });
  it('rebases the sample onto now', () => {
    const s = rebaseTimes(parseLabStatus(sample), now, 90);
    expect(s.updated!.getTime()).toBe(now.getTime() - 90_000);
    // 21 min between started and updated is kept.
    expect(s.updated!.getTime() - s.running[0]!.started!.getTime()).toBe(21 * 60_000);
  });
});

describe('labSource', () => {
  const base = '/ForgeCoach/';
  it('defaults to the lab-status branch', () => {
    expect(labSource('#lab', base)).toEqual({ kind: 'default', url: DEFAULT_LAB_SRC });
    expect(labSource('#lab?src=', base)).toEqual({ kind: 'default', url: DEFAULT_LAB_SRC });
  });
  it('loads the bundled sample under the base URL', () => {
    expect(labSource('#lab?src=sample', base)).toEqual({ kind: 'sample', url: '/ForgeCoach/lab-sample.json' });
    expect(labSource('#lab?src=sample', './')).toEqual({ kind: 'sample', url: './lab-sample.json' });
  });
  it('takes http(s) URLs, raw or encoded, with their own query', () => {
    expect(labSource('#lab?src=http://100.64.0.2:8642/lab/status.json', base)).toEqual({ kind: 'custom', url: 'http://100.64.0.2:8642/lab/status.json' });
    expect(labSource('#lab?src=https%3A%2F%2Fexample.org%2Fs.json', base)).toEqual({ kind: 'custom', url: 'https://example.org/s.json' });
    expect(labSource('#lab?src=https://example.org/s.json?a=1&b=2', base)).toEqual({ kind: 'custom', url: 'https://example.org/s.json?a=1&b=2' });
  });
  it('refuses anything else', () => {
    for (const h of ['#lab?src=javascript:alert(1)', '#lab?src=data:application/json,{}', '#lab?src=file:///etc/passwd', '#lab?src=ftp://x/y', '#lab?src=not a url', '#lab?src=https://u:p@example.org/s.json']) {
      expect(labSource(h, base).kind).toBe('invalid');
    }
  });
});

describe('withCacheBuster', () => {
  it('appends a parameter', () => {
    expect(withCacheBuster('https://x/s.json', 5)).toBe('https://x/s.json?_=5');
    expect(withCacheBuster('https://x/s.json?a=1', 5)).toBe('https://x/s.json?a=1&_=5');
    expect(withCacheBuster('https://x/s.json#frag', 5)).toBe('https://x/s.json?_=5');
  });
});

describe('fetchLabStatus', () => {
  const reply = (status: number, body: string) => async () => ({ ok: status >= 200 && status < 300, status, text: async () => body });
  it('fetches with a cache-buster, no store and no credentials', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const s = await fetchLabStatus('https://x/s.json', {
      now: 7,
      fetch: async (url, init) => {
        calls.push({ url, init });
        return { ok: true, status: 200, text: async () => JSON.stringify(SPEC_EXAMPLE) };
      },
    });
    expect(s.running[0]!.id).toBe('J003');
    expect(calls[0]!.url).toBe('https://x/s.json?_=7');
    expect(calls[0]!.init).toMatchObject({ cache: 'no-store', credentials: 'omit' });
  });
  it('sorts the failures', async () => {
    const kind = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof LabFetchError ? e.kind : 'other'));
    expect(await kind(fetchLabStatus('u', { fetch: async () => Promise.reject(new TypeError('Failed to fetch')) }))).toBe('network');
    expect(await kind(fetchLabStatus('u', { fetch: reply(404, 'Not Found') }))).toBe('notFound');
    expect(await kind(fetchLabStatus('u', { fetch: reply(500, '') }))).toBe('http');
    expect(await kind(fetchLabStatus('u', { fetch: reply(200, '{"updated": ') }))).toBe('parse');
    expect(await kind(fetchLabStatus('u', { fetch: reply(200, '[1,2]') }))).toBe('parse');
    expect(await kind(fetchLabStatus('u', { fetch: reply(200, ' '.repeat(600 * 1024)) }))).toBe('tooLarge');
  });
});

describe('RUNNING / IDLE and the heartbeat', () => {
  const now = new Date('2026-10-03T12:00:00Z');
  const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();

  it('reads the runner’s state, idle reason and heartbeat', () => {
    const s = parseLabStatus({ schema: 1, updated: ago(1), heartbeat: ago(0.5), state: 'idle', idleSince: ago(12), idleReason: 'blocked after J012', running: [] });
    expect(s.state).toBe('idle');
    expect(s.idleReason).toBe('blocked after J012');
    expect(s.heartbeat?.toISOString()).toBe(ago(0.5));
    expect(runState(s, now)).toEqual({ state: 'idle', idleS: 12 * 60, reason: 'blocked after J012', red: true });
    expect(heartbeatStale(s, now).stale).toBe(false);
  });

  it('IDLE turns red at ten minutes', () => {
    const at = (min: number) => runState(parseLabStatus({ updated: ago(0), state: 'idle', idleSince: ago(min), idleReason: 'queue empty' }), now);
    expect(at(9.9).red).toBe(false);
    expect(at(IDLE_RED_AFTER_S / 60).red).toBe(true);
    expect(runState(parseLabStatus({ updated: ago(0), state: 'idle' }), now)).toEqual({ state: 'idle', idleS: null, reason: null, red: false });
  });

  it('running ignores idle fields; an older file derives the state from its running list and the heartbeat from updated', () => {
    const r = parseLabStatus({ updated: ago(1), state: 'running', idleSince: ago(30), idleReason: 'queue empty', running: [{ id: 'J001' }] });
    expect(runState(r, now)).toEqual({ state: 'running', idleS: null, reason: null, red: false });
    const old = parseLabStatus({ updated: ago(2), running: [{ id: 'J001' }] });
    expect(old.state).toBe('running');
    expect(old.heartbeat?.toISOString()).toBe(ago(2));
    expect(parseLabStatus({ updated: ago(2), running: [] }).state).toBe('idle');
    expect(parseLabStatus({ updated: ago(2), state: 'bogus' }).state).toBe('idle');
  });

  it('warns when the heartbeat is five minutes old', () => {
    expect(heartbeatStale(parseLabStatus({ updated: ago(1), heartbeat: ago(4.9) }), now).stale).toBe(false);
    expect(heartbeatStale(parseLabStatus({ updated: ago(1), heartbeat: ago(HEARTBEAT_STALE_S / 60) }), now).stale).toBe(true);
    expect(heartbeatStale(parseLabStatus({}), now)).toEqual({ stale: false, ageS: null });
  });

  it('the idle reason is untrusted text: cleaned and clipped', () => {
    const s = parseLabStatus({ state: 'idle', idleReason: `queue\u0000 empty${'x'.repeat(200)}` });
    expect(s.idleReason!.length).toBeLessThanOrEqual(60);
    expect(s.idleReason).toMatch(/^queue empty/);
  });
});

describe('a running job’s live numbers and per-cube progress', () => {
  it('reads the sample’s queue job: workers of max, memory, live metrics headline first, cubes', () => {
    const j = parseLabStatus(sample).running.find((r) => r.id === 'J020')!;
    expect(j).toMatchObject({ workers: 5, workersMax: 6, memGb: 9.42 });
    expect(j.live[0]).toEqual({ key: 'q.night_drafts_done', value: 1180, headline: true });
    expect(j.cubes).toHaveLength(4);
    expect(j.cubes[0]).toEqual({ id: 'cube 1', done: 260, planned: 800, fraction: 0.325 });
    const cells = liveCells(j);
    expect(cells[0]).toMatchObject({ label: 'Memory', value: '9.4 GB' });
    expect(cells.slice(1, 3).map((c) => [c.label, c.value, c.tone])).toEqual([
      ['Drafts tonight', '1,180', undefined],
      ['Engine errors', '2', 'bad'],
    ]);
    const by = (label: string) => cells.find((c) => c.label === label);
    expect(by('Games')?.value).toBe('1,180');
    expect(by('Engine error rate')?.value).toBe('0.2 %');
    expect(by('Timeouts')).toMatchObject({ value: '3', tone: 'amber' });
    expect(by('Recording errors')).toMatchObject({ value: '0', tone: undefined });
    expect(by('Bridge share')?.value).toBe('20 %');
    expect(by('Turns / game')?.value).toBe('9.40');
    expect(by('Disk')?.value).toBe('734.0 MB');
    expect(by('Games / h')?.value).toBe('674');
    // Tonight's draft rate and the all-nights rate have distinct labels.
    expect(by('Drafts tonight / h')?.value).toBe('674');
    expect(by('Drafts / h (all nights)')?.value).toBe('674');
    expect(new Set(cells.map((c) => c.label)).size).toBe(cells.length);
    // An unknown key keeps its raw name, last.
    expect(cells.at(-1)).toMatchObject({ label: 'q.ms_per_turn', known: false, value: '412' });
  });

  it('cleans live: unsafe keys, non-numbers, out-of-range and per-cube keys are dropped; at most MAX_LIVE', () => {
    const live = parseLive(
      {
        'q.games': 10,
        'Bad Key': 1,
        'a/b': 2,
        '__proto__': 3,
        'q.text': '12',
        'q.inf': Infinity,
        'q.nan': NaN,
        'q.huge': 1e20,
        'q.neg': -4,
        'cubes.omega.done': 5,
        'q.cubes.omega.planned': 6,
        'q.obj': { x: 1 },
        'a.b.c.d.e': 1,
        '<script>': 1,
      },
      ['q.games', 'nope', 7],
    );
    expect(live).toEqual([
      { key: 'q.games', value: 10, headline: true },
      { key: 'q.neg', value: -4, headline: false },
    ]);
    expect(parseLive(null)).toEqual([]);
    expect(parseLive([1, 2])).toEqual([]);
    expect(parseLive(Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`m${i}`, i])))).toHaveLength(MAX_LIVE);
    // A running job without the new fields (an older file).
    const j = parseLabStatus({ running: [{ id: 'J001', workers: 2 }] }).running[0]!;
    expect([j.live, j.cubes, j.workersMax, j.memGb]).toEqual([[], [], null, null]);
    expect(liveCells(j)).toEqual([]);
    expect(parseLabStatus({ running: [{ id: 'J1', memGb: -2, workersMax: 'many' }] }).running[0]).toMatchObject({ memGb: null, workersMax: null });
  });

  it('cleans cubes: text ids, whole non-negative counts, at most MAX_CUBES', () => {
    const cubes = parseCubes([
      { id: 'omega', done: 2, planned: 4 },
      { id: 'pauper\u0000\u202e', done: 1, planned: 0 },
      { id: 'x', done: -1, planned: 3 },
      { id: 'y', done: 'many', planned: 3 },
      { done: 1, planned: 2 },
      { id: 'z'.repeat(80), done: 5, planned: 2 },
      'junk',
    ]);
    expect(cubes.map((c) => [c.id.startsWith('zzz') ? 'long' : c.id, c.done, c.planned, c.fraction])).toEqual([
      ['omega', 2, 4, 0.5],
      ['pauper', 1, 0, null],
      ['long', 5, 2, 1],
    ]);
    expect(cubes[2]!.id.length).toBeLessThanOrEqual(40);
    expect(parseCubes(Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, done: 0, planned: 1 })))).toHaveLength(MAX_CUBES);
    expect(parseCubes({ omega: 1 })).toEqual([]);
  });

  it('hides workers and elapsed in the grid when the card already shows them; formats by name', () => {
    const j = parseLabStatus({ running: [{ id: 'J1', workers: 3, elapsed: 60, live: { workers: 3, elapsed_s: 60, 'n.size_bytes': 2048, 'n.wait_s': 45, 'n.hit_rate': 0.5, 'n.x': 1.234 } }] }).running[0]!;
    expect(liveCells(j).map((c) => [c.label, c.value])).toEqual([
      ['n.size_bytes', '2 KB'],
      ['n.wait_s', '45 s'],
      ['n.hit_rate', '50 %'],
      ['n.x', '1.23'],
    ]);
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(3.4e9)).toBe('3.4 GB');
  });
});
