// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LEDGER_SRC,
  LedgerError,
  entriesSince,
  entrySummary,
  entryVerdict,
  fetchLedger,
  fmtMetric,
  followupNow,
  nightSummary,
  nightTally,
  parseLedger,
  parseSince,
  rebaseLedger,
  reportHash,
  reportParams,
  reportPrompt,
  ruleWords,
  sinceParam,
  sinceTime,
  type LedgerEntry,
} from './ledger.ts';
import { LabFetchError, parseLabStatus } from './status.ts';

type Doc = Record<string, unknown> & { entries: Array<Record<string, unknown>> };
const raw = JSON.parse(readFileSync(new URL('../../public/ledger-sample.json', import.meta.url), 'utf8')) as Doc;
const clone = (): Doc => JSON.parse(JSON.stringify(raw)) as Doc;
const entry = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ ...clone().entries[2]!, ...over });
const one = (over: Record<string, unknown> = {}) => parseLedger({ schema: 1, entries: [entry(over)] });

describe('parseLedger: the bundled sample', () => {
  const l = parseLedger(raw);

  it('reads every entry with nothing dropped, oldest first', () => {
    expect(l.schema).toBe(1);
    expect(l.generatedAt?.toISOString()).toBe('2026-10-05T07:05:00.000Z');
    expect(l.entries.map((e) => e.id)).toEqual(['J052', 'J058', 'J061', 'J062', 'J064', 'J065']);
    expect(l.dropped).toBe(0);
  });

  it('says it is made up', () => {
    expect(String(raw.note)).toMatch(/made up/);
  });

  it('reads an entry field by field', () => {
    const e = l.entries.find((x) => x.id === 'J061')!;
    expect(e.title).toBe('Overnight queue, night 3');
    expect(e.decides).toBe('whether night 4 keeps exploration in 15% of drafts');
    expect(e.rule).toBe('D358');
    expect(e.outcome).toBe('done');
    expect(e.cause).toBeNull();
    expect(e.checked).toBe(true);
    expect(e.headline).toEqual([
      { key: 'drafts', value: 1840 },
      { key: 'games', value: 5520 },
      { key: 'q.engine_errors', value: 0.006 },
      { key: 'q.recording_errors', value: 0.002 },
    ]);
    expect(e.followups).toEqual([
      { job: 'J004', template: null, state: 'queued' },
      { job: null, template: 'morning-read', state: 'ready' },
    ]);
  });

  it('covers every verdict', () => {
    expect(l.entries.map((e) => entryVerdict(e).kind)).toEqual(['pass', 'pass', 'pass', 'fail', 'none', 'none']);
  });
});

describe('parseLedger: strictness', () => {
  it('refuses anything but a schema-1 object', () => {
    expect(() => parseLedger(null)).toThrow(LedgerError);
    expect(() => parseLedger([])).toThrow(LedgerError);
    expect(() => parseLedger({ entries: [] })).toThrow(/schema-1/);
    expect(() => parseLedger({ schema: 2, entries: [] })).toThrow(/schema 2/);
    expect(() => parseLedger({ schema: '1', entries: [] })).toThrow(LedgerError);
  });

  it('an empty or missing entries list is an empty ledger', () => {
    expect(parseLedger({ schema: 1 }).entries).toEqual([]);
    expect(parseLedger({ schema: 1, entries: [] }).dropped).toBe(0);
    expect(parseLedger({ schema: 1, entries: 'x' }).dropped).toBe(1);
  });

  it.each([
    ['a bad id', { id: 'j061' }],
    ['an id with a path', { id: 'J061/../x' }],
    ['no finish time', { finished: null }],
    ['a bad finish time', { finished: 'yesterday' }],
    ['an unknown outcome', { outcome: 'passed' }],
    ['a done entry with a cause', { cause: 'check' }],
    ['an unknown cause', { outcome: 'failed', cause: 'bad luck' }],
    ['a rule that is free text', { rule: 'see results/J061/summary.md' }],
    ['a rule with a path', { rule: 'D358 tools/lab/gates.py' }],
    ['a non-string title', { title: 3 }],
    ['a non-object headline', { headline: [1, 2] }],
    ['a non-array followups', { followups: 'J066' }],
  ])('drops an entry with %s', (_, over) => {
    const l = one(over);
    expect(l.entries).toEqual([]);
    expect(l.dropped).toBe(1);
  });

  it('cleans and caps free text', () => {
    const e = one({ title: '  Over\u0000night\n‮queue  ', decides: 'x'.repeat(200) }).entries[0]!;
    expect(e.title).toBe('Over night queue');
    expect(e.decides!.length).toBe(80);
    expect(e.decides!.endsWith('…')).toBe(true);
  });

  it('keeps a good entry but drops its bad headline keys and follow-ups, counted', () => {
    const l = one({
      headline: { games: 10, 'Bad Key': 1, 'cubes/x': 2, str: '3', inf: null, ok_rate: 0.5 },
      followups: [
        { job: 'J066', template: null, state: 'queued' },
        { job: 'jobs/J066-secret.md', template: null, state: 'queued' },
        { job: null, template: 'Morning Read', state: 'ready' },
        { job: 'J067', template: 'morning-read', state: 'ready' },
        { job: 'J068', template: null, state: 'done' },
      ],
    });
    expect(l.entries[0]!.headline.map((m) => m.key)).toEqual(['games', 'ok_rate']);
    expect(l.entries[0]!.followups).toEqual([{ job: 'J066', template: null, state: 'queued' }]);
    expect(l.dropped).toBe(4 + 4);
  });

  it('caps the headline at twelve', () => {
    const headline = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`m${i}`, i]));
    const l = one({ headline });
    expect(l.entries[0]!.headline.length).toBe(12);
    expect(l.dropped).toBe(3);
  });

  it('accepts the rule short forms the runner writes', () => {
    for (const r of ['D358', 'D354, gate 2, REGRET_RULE', 'D354 gate 2, REGRET_RULE', 'EXAM_RULE']) expect(one({ rule: r }).entries[0]!.rule).toBe(r);
  });

  it('a rule implies one was written', () => {
    expect(one({ rule: 'D358', ruleWritten: false }).entries[0]!.ruleWritten).toBe(true);
    expect(one({ rule: null, ruleWritten: undefined }).entries[0]!.ruleWritten).toBe(false);
  });

  it('drops duplicates and sorts oldest first', () => {
    const a = entry({ id: 'J070', finished: '2026-10-05T03:00:00Z' });
    const b = entry({ id: 'J071', finished: '2026-10-05T01:00:00Z' });
    const l = parseLedger({ schema: 1, entries: [a, b, a] });
    expect(l.entries.map((e) => e.id)).toEqual(['J071', 'J070']);
    expect(l.dropped).toBe(1);
  });

  it('ignores unknown fields', () => {
    const e = one({ hypothesis: 'secret', reason: 'check: x', summary: 'results/J061/summary.md', commits: { a: 'b' } }).entries[0]!;
    expect(Object.keys(e).sort()).toEqual(['cause', 'checked', 'decides', 'finished', 'followups', 'headline', 'id', 'outcome', 'rule', 'ruleWritten', 'title'].sort());
  });
});

const base: LedgerEntry = parseLedger({ schema: 1, entries: [entry()] }).entries[0]!;
const make = (over: Partial<LedgerEntry>): LedgerEntry => ({ ...base, ...over });

describe('verdicts: never stronger than the outcome', () => {
  it('pass only when done with pre-registered checks', () => {
    expect(entryVerdict(make({ outcome: 'done', checked: true })).kind).toBe('pass');
    expect(entryVerdict(make({ outcome: 'done', checked: false })).kind).toBe('none');
  });

  it('fail only when a check or the pilot failed', () => {
    expect(entryVerdict(make({ outcome: 'failed', cause: 'check' })).kind).toBe('fail');
    expect(entryVerdict(make({ outcome: 'failed', cause: 'pilot' })).kind).toBe('fail');
    for (const cause of ['timeout', 'step', 'memory', 'other', null] as const) expect(entryVerdict(make({ outcome: 'failed', cause })).kind, String(cause)).toBe('none');
  });

  it('an aborted job has no verdict', () => {
    expect(entryVerdict(make({ outcome: 'aborted', cause: null, checked: true })).kind).toBe('none');
  });

  it('a pass says the rule still decides', () => {
    const s = entrySummary(make({ outcome: 'done', checked: true, rule: 'D358' }));
    expect(s).toMatch(/every check written before the run held/);
    expect(s).toMatch(/Whether that settles the decision is for its rule \(D358\)/);
    expect(entrySummary(make({ rule: null, ruleWritten: true }))).toMatch(/which is not public/);
    expect(entrySummary(make({ rule: null, ruleWritten: false }))).toMatch(/its checks are the whole test/);
  });

  it('rule words', () => {
    expect(ruleWords(make({ rule: 'D358' }))).toBe('D358');
    expect(ruleWords(make({ rule: null, ruleWritten: true }))).toBe('written, not public');
    expect(ruleWords(make({ rule: null, ruleWritten: false }))).toBe('none written');
  });
});

describe('summaries', () => {
  const now = new Date('2026-10-05T07:05:00Z');
  const l = parseLedger(raw);

  it('one job, deterministically, from its fields', () => {
    const e = l.entries.find((x) => x.id === 'J061')!;
    expect(entrySummary(e)).toBe(
      'J061, Overnight queue, night 3 decides: whether night 4 keeps exploration in 15% of drafts. It ran to the end and every check written before the run held. ' +
        'Whether that settles the decision is for its rule (D358), judged in the morning read. ' +
        'Its numbers: drafts 1,840, games 5,520, q.engine_errors 0.006, q.recording_errors 0.002. ' +
        'Next: J004 (queued to start after this job); the morning-read template (ready to post: the cloud session writes it next).',
    );
    expect(entrySummary(l.entries.find((x) => x.id === 'J064')!)).toBe(
      'J064 has no public line saying what it decides. It was stopped early by its own abort line, so the rule was never tested. Its numbers: games 310.',
    );
  });

  it('the night', () => {
    const since = sinceTime(parseSince('24h'), now);
    const es = entriesSince(l, since, now);
    expect(es.map((e) => e.id)).toEqual(['J065', 'J064', 'J062', 'J061', 'J058']);
    expect(nightTally(es)).toEqual({ jobs: 5, pass: 2, fail: 1, none: 2, ready: 2, queued: 2 });
    expect(nightSummary(es, since, now)).toBe(
      '5 jobs ended in the last 24 h: 2 passed their checks, 1 failed a pre-registered check and 2 ended with no verdict. 2 follow-ups queued to start and 2 follow-ups ready to post.',
    );
    expect(nightSummary([], since, now)).toBe('No job ended in the last 24 h.');
  });

  it('formats metrics', () => {
    expect(fmtMetric(5520)).toBe('5,520');
    expect(fmtMetric(0.0061234)).toBe('0.006');
    expect(fmtMetric(123.456)).toBe('123.5');
  });

  it('the coach prompt is deterministic and carries only the fields', () => {
    const since = sinceTime(parseSince('24h'), now);
    const es = entriesSince(l, since, now);
    const a = reportPrompt(es, since, now);
    expect(reportPrompt(es, since, now)).toEqual(a);
    expect(a.system).toMatch(/Never make a verdict stronger/);
    expect(a.user).toMatch(/## J061, Overnight queue, night 3/);
    expect(a.user).toMatch(/- verdict: Fail\. It failed: one of its pre-registered checks failed\./);
    expect(a.user).toMatch(/- rule: written, not public/);
    expect(a.user.indexOf('J058')).toBeLessThan(a.user.indexOf('J065'));
  });
});

describe('the window', () => {
  const now = new Date('2026-10-05T07:00:00Z');
  it('parses presets and times, else 24 h', () => {
    expect(parseSince('48h')).toEqual({ kind: 'preset', preset: '48h' });
    expect(parseSince(null)).toEqual({ kind: 'preset', preset: '24h' });
    expect(parseSince('soon')).toEqual({ kind: 'preset', preset: '24h' });
    const at = parseSince('2026-10-04T06:00:00Z');
    expect(at.kind === 'at' && at.at.toISOString()).toBe('2026-10-04T06:00:00.000Z');
    expect(sinceTime(parseSince('7d'), now).toISOString()).toBe('2026-09-28T07:00:00.000Z');
  });

  it('round-trips a local time through the hash', () => {
    const at = new Date(2026, 9, 4, 6, 30);
    const p = sinceParam({ kind: 'at', at });
    expect(p).toBe('2026-10-04T06:30');
    const back = parseSince(p);
    expect(back.kind === 'at' && back.at.getTime()).toBe(at.getTime());
  });

  it('keeps entries in the window, newest first, none from the future', () => {
    const l = parseLedger({
      schema: 1,
      entries: [entry({ id: 'J001', finished: '2026-10-04T06:59:00Z' }), entry({ id: 'J002', finished: '2026-10-04T07:00:00Z' }), entry({ id: 'J003', finished: '2026-10-05T06:00:00Z' }), entry({ id: 'J004', finished: '2026-10-05T09:00:00Z' })],
    });
    expect(entriesSince(l, sinceTime(parseSince('24h'), now), now).map((e) => e.id)).toEqual(['J003', 'J002']);
  });
});

describe('source and hash', () => {
  const B = '/ForgeCoach/';
  it('reads since and src', () => {
    expect(reportParams('#lab/report', B)).toEqual({ source: { kind: 'default', url: DEFAULT_LEDGER_SRC }, since: { kind: 'preset', preset: '24h' } });
    expect(reportParams('#lab/report?since=48h', B).since).toEqual({ kind: 'preset', preset: '48h' });
    expect(reportParams('#lab/report?since=7d&src=sample', B)).toEqual({ source: { kind: 'sample', url: '/ForgeCoach/ledger-sample.json' }, since: { kind: 'preset', preset: '7d' } });
    // src is the rest of the hash, its own query included.
    expect(reportParams('#lab/report?src=https://x.test/l.json?a=1&since=48h', B)).toEqual({
      source: { kind: 'custom', url: 'https://x.test/l.json?a=1&since=48h' },
      since: { kind: 'preset', preset: '24h' },
    });
    expect(reportParams('#lab/report?src=javascript:alert(1)', B).source.kind).toBe('invalid');
  });

  it('writes the hash back', () => {
    expect(reportHash({ kind: 'preset', preset: '24h' }, null)).toBe('#lab/report');
    expect(reportHash({ kind: 'preset', preset: '48h' }, 'sample')).toBe('#lab/report?since=48h&src=sample');
    expect(reportHash({ kind: 'preset', preset: '24h' }, 'sample')).toBe('#lab/report?src=sample');
    const h = reportHash({ kind: 'at', at: new Date(2026, 9, 4, 6, 30) }, null);
    expect(reportParams(h, B).since).toEqual({ kind: 'at', at: new Date(2026, 9, 4, 6, 30) });
  });
});

describe('the sample, rebased', () => {
  it('moves every time so the newest ended two hours ago, keeping the gaps', () => {
    const now = new Date('2030-01-01T12:00:00Z');
    const l = parseLedger(raw);
    const r = rebaseLedger(l, now);
    expect(r.entries.at(-1)!.finished.toISOString()).toBe('2030-01-01T10:00:00.000Z');
    expect(r.entries[0]!.finished.getTime() - r.entries[1]!.finished.getTime()).toBe(l.entries[0]!.finished.getTime() - l.entries[1]!.finished.getTime());
  });
});

describe('follow-ups now, from status.json', () => {
  const status = parseLabStatus({
    schema: 1,
    updated: '2026-10-05T07:00:00Z',
    state: 'running',
    running: [{ id: 'J066', title: 'x' }],
    queue: [{ id: 'J070' }, { id: 'J063' }],
    waiting: [{ id: 'J067', reason: 'waiting for an earlier job' }],
    finished: [{ id: 'J069', status: 'done' }],
  });
  it('says where each follow-up job is', () => {
    const f = (job: string) => ({ job, template: null, state: 'queued' as const });
    expect(followupNow(f('J066'), status)).toBe('running now');
    expect(followupNow(f('J063'), status)).toBe('in the queue (2nd)');
    expect(followupNow(f('J070'), status)).toBe('next in the queue');
    expect(followupNow(f('J067'), status)).toBe('waiting: waiting for an earlier job');
    expect(followupNow(f('J069'), status)).toBe('finished');
    expect(followupNow(f('J099'), status)).toBeNull();
    expect(followupNow({ job: null, template: 'morning-read', state: 'ready' }, status)).toBeNull();
    expect(followupNow(f('J066'), null)).toBeNull();
  });
});

describe('fetchLedger', () => {
  const ok = (body: string) => async () => ({ ok: true, status: 200, text: async () => body });
  it('parses, and sorts errors by kind', async () => {
    expect((await fetchLedger('https://x.test/l.json', { fetch: ok(JSON.stringify(raw)) })).entries.length).toBe(6);
    await expect(fetchLedger('u', { fetch: ok('{"schema":3}') })).rejects.toMatchObject({ kind: 'parse' });
    await expect(fetchLedger('u', { fetch: async () => ({ ok: false, status: 404, text: async () => '' }) })).rejects.toBeInstanceOf(LabFetchError);
    await expect(fetchLedger('u', { fetch: ok('x'.repeat(600 * 1024)) })).rejects.toMatchObject({ kind: 'tooLarge' });
  });
});

describe('windowWords', () => {
  it('names presets even when the start is rounded to the minute', async () => {
    const { windowWords } = await import('./ledger.ts');
    const now = new Date('2026-10-05T07:00:42Z');
    expect(windowWords(new Date('2026-10-04T07:00:00Z'), now)).toBe('the last 24 h');
    expect(windowWords(new Date('2026-09-28T07:00:00Z'), now)).toBe('the last 7 days');
    expect(windowWords(new Date('2026-10-04T05:30:00Z'), now)).toBe('the last 1 d 1 h');
  });
});
