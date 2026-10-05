/*
 * ForgeCoach — lab/ledger.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The morning report (#lab/report): the PC lab runner's decision ledger
 * (mtg-table D366) in its public, allowlisted form, `ledger.json` (schema 1),
 * published numbers-only next to status.json, ladder.json and warehouse.json
 * on this repo's `lab-status` branch. The private ledger (ledger.jsonl,
 * LEDGER.md on mtg-table's pc-results) never comes here: the runner rebuilds
 * each entry from an allowlist (mtg-table tools/runner, the public ledger).
 *
 *   {
 *     "schema": 1,
 *     "generatedAt": ISO,
 *     "entries": [                       oldest first, the newest 100 at most
 *       { "id": "J061",
 *         "title": text | null,          the job's opted-in public title
 *         "decides": text | null,        the job's opted-in public_decides: line
 *         "rule": "D354 gate 2, REGRET_RULE" | null,   the rule's short form
 *         "ruleWritten": bool,           the job wrote a rule: line at all
 *         "outcome": "done" | "failed" | "aborted",
 *         "cause": null | "check" | "pilot" | "timeout" | "step" | "memory" | "other",
 *         "checked": bool,               the job file had check: lines
 *         "headline": { metric: number },
 *         "finished": ISO,
 *         "followups": [{ "job": "J066" | null, "template": "morning-read" | null,
 *                         "state": "queued" | "posted" | "ready" | "not-due" }] } ] }
 *
 * Unknown JSON in, a typed, validated view model out, as lab/warehouse.ts.
 * Strict: the file must say `schema: 1`. Every string is untrusted: ids,
 * metric keys and template names must match token patterns, free text is
 * cleaned with `cleanText` and capped, and everything is rendered as React
 * text. A bad entry is dropped and counted, never repaired; unknown fields
 * are ignored.
 *
 * Honesty: the page's verdict is never stronger than the outcome. `pass` only
 * when the job ran to the end AND had pre-registered check: lines (so they all
 * held); `fail` only when one of those checks (or the pilot's) failed; every
 * other ending — aborted, timed out, a step error, a memory stop, done with no
 * checks — is "no verdict". Whether a pass settles what the job `decides` is
 * still the rule's call, judged in the PC session's summary, and the page says
 * so. The summaries and the coach prompt are built from the fields alone,
 * deterministically. DOM-free; `fetch` is injected.
 */
import type { Prompt } from '../prompt.ts';
import { cleanText, fetchLabJson, formatDuration, hashSource, parseTime, type FetchLike, type LabSource, type LabStatus, LabFetchError } from './status.ts';

export const DEFAULT_LEDGER_SRC = 'https://raw.githubusercontent.com/jalirkan/ForgeCoach/lab-status/ledger.json';
export const LEDGER_SCHEMA = 1;
export const LEDGER_MAX_BYTES = 512 * 1024;
export const LEDGER_REFRESH_MS = 5 * 60_000;
/** At least the runner's own cap (100). */
const MAX_ENTRIES = 500;
const MAX_FOLLOWUPS = 10;
const MAX_HEADLINE = 12;

const ID = /^J\d{3,5}$/;
const METRIC = /^[a-z][a-z0-9_]{0,40}(\.[a-z0-9_]{1,40}){0,2}$/;
const TEMPLATE = /^[a-z][a-z0-9-]{0,39}$/;
/** The rule's short form: D-numbers, "gate N" and *_RULE names, comma-separated. */
const RULE = /^(D\d{2,4}|gate \d{1,2}|[A-Z][A-Z0-9_]{1,40}_RULE)(,? (D\d{2,4}|gate \d{1,2}|[A-Z][A-Z0-9_]{1,40}_RULE)){0,3}$/;
const LEN = { title: 80, decides: 80 } as const;

// ---------------------------------------------------------------------------
// View model

export type LedgerOutcome = 'done' | 'failed' | 'aborted';
export type LedgerCause = 'check' | 'pilot' | 'timeout' | 'step' | 'memory' | 'other';
export type FollowupState = 'queued' | 'posted' | 'ready' | 'not-due';

export interface LedgerFollowup {
  /** A follow-up job (its id only) … */
  job: string | null;
  /** … or a named template (`morning-read`). */
  template: string | null;
  state: FollowupState;
}

export interface LedgerMetric {
  key: string;
  value: number;
}

export interface LedgerEntry {
  id: string;
  title: string | null;
  decides: string | null;
  rule: string | null;
  ruleWritten: boolean;
  outcome: LedgerOutcome;
  /** Null when done. */
  cause: LedgerCause | null;
  checked: boolean;
  /** In the file's order. */
  headline: LedgerMetric[];
  finished: Date;
  followups: LedgerFollowup[];
}

export interface Ledger {
  schema: 1;
  generatedAt: Date | null;
  /** Oldest first. */
  entries: LedgerEntry[];
  /** Entries (and follow-up or headline items) that failed the checks. */
  dropped: number;
}

// ---------------------------------------------------------------------------
// Parsing

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const own = (o: Obj, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
const tok = (v: unknown, re: RegExp): string | null => (typeof v === 'string' && re.test(v) ? v : null);

const OUTCOMES = new Set<LedgerOutcome>(['done', 'failed', 'aborted']);
const CAUSES = new Set<LedgerCause>(['check', 'pilot', 'timeout', 'step', 'memory', 'other']);
const STATES = new Set<FollowupState>(['queued', 'posted', 'ready', 'not-due']);

/** Thrown when the body is not a schema-1 ledger file. */
export class LedgerError extends Error {}

/** Optional free text: absent or null → null; a string → cleaned and capped; anything else → undefined (bad). */
function optText(v: unknown, max: number): string | null | undefined {
  if (v === undefined || v === null) return null;
  return typeof v === 'string' ? cleanText(v, max) : undefined;
}

function parseFollowup(v: unknown): LedgerFollowup | null {
  if (!isObj(v)) return null;
  const state = own(v, 'state');
  if (typeof state !== 'string' || !STATES.has(state as FollowupState)) return null;
  const job = tok(own(v, 'job'), ID);
  const template = tok(own(v, 'template'), TEMPLATE);
  // Exactly one of the two.
  if ((job === null) === (template === null)) return null;
  return { job, template, state: state as FollowupState };
}

function parseEntry(o: Obj): { entry: LedgerEntry; bad: number } | null {
  const id = tok(own(o, 'id'), ID);
  const outcome = own(o, 'outcome');
  const finished = parseTime(own(o, 'finished'));
  if (!id || typeof outcome !== 'string' || !OUTCOMES.has(outcome as LedgerOutcome) || !finished) return null;
  const rawCause = own(o, 'cause');
  let cause: LedgerCause | null = null;
  if (outcome === 'done') {
    if (rawCause !== null && rawCause !== undefined) return null;
  } else if (rawCause !== null && rawCause !== undefined) {
    if (typeof rawCause !== 'string' || !CAUSES.has(rawCause as LedgerCause)) return null;
    cause = rawCause as LedgerCause;
  }
  const title = optText(own(o, 'title'), LEN.title);
  const decides = optText(own(o, 'decides'), LEN.decides);
  if (title === undefined || decides === undefined) return null;
  const rawRule = own(o, 'rule');
  const rule = rawRule === null || rawRule === undefined ? null : tok(rawRule, RULE);
  if (rawRule !== null && rawRule !== undefined && rule === null) return null;
  let bad = 0;
  const headline: LedgerMetric[] = [];
  const h = own(o, 'headline');
  if (h !== undefined && h !== null && !isObj(h)) return null;
  if (isObj(h)) {
    const keys = Object.keys(h);
    bad += Math.max(0, keys.length - MAX_HEADLINE);
    for (const key of keys.slice(0, MAX_HEADLINE)) {
      const value = h[key];
      if (METRIC.test(key) && typeof value === 'number' && Number.isFinite(value)) headline.push({ key, value });
      else bad++;
    }
  }
  const followups: LedgerFollowup[] = [];
  const f = own(o, 'followups');
  if (Array.isArray(f)) {
    bad += Math.max(0, f.length - MAX_FOLLOWUPS);
    for (const x of f.slice(0, MAX_FOLLOWUPS)) {
      const p = parseFollowup(x);
      if (p) followups.push(p);
      else bad++;
    }
  } else if (f !== undefined && f !== null) return null;
  return {
    entry: {
      id,
      title,
      decides,
      rule,
      ruleWritten: own(o, 'ruleWritten') === true || rule !== null,
      outcome: outcome as LedgerOutcome,
      cause,
      checked: own(o, 'checked') === true,
      headline,
      finished,
      followups,
    },
    bad,
  };
}

/** Unknown JSON → Ledger. Throws LedgerError when it is not an object or not schema 1. */
export function parseLedger(json: unknown): Ledger {
  if (!isObj(json)) throw new LedgerError('The ledger file is not a JSON object.');
  const schema = own(json, 'schema');
  if (schema !== LEDGER_SCHEMA) {
    const shown = typeof schema === 'number' && Number.isFinite(schema) ? ` (it says schema ${schema})` : '';
    throw new LedgerError(`This is not a schema-1 ledger file${shown}.`);
  }
  const raw = own(json, 'entries');
  let dropped = 0;
  const entries: LedgerEntry[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw)) {
    // The newest MAX_ENTRIES: the file is oldest first.
    dropped += Math.max(0, raw.length - MAX_ENTRIES);
    for (const x of raw.slice(-MAX_ENTRIES)) {
      const r = isObj(x) ? parseEntry(x) : null;
      if (!r) {
        dropped++;
        continue;
      }
      const key = `${r.entry.id}@${r.entry.finished.getTime()}`;
      if (seen.has(key)) {
        dropped++;
        continue;
      }
      seen.add(key);
      dropped += r.bad;
      entries.push(r.entry);
    }
  } else if (raw !== undefined && raw !== null) dropped++;
  entries.sort((a, b) => a.finished.getTime() - b.finished.getTime());
  return { schema: LEDGER_SCHEMA, generatedAt: parseTime(own(json, 'generatedAt')), entries, dropped };
}

// ---------------------------------------------------------------------------
// The window: since when

export type SincePreset = '12h' | '24h' | '48h' | '7d';
export const SINCE_PRESETS: Record<SincePreset, number> = { '12h': 12 * 3600, '24h': 24 * 3600, '48h': 48 * 3600, '7d': 7 * 86_400 };
export const DEFAULT_SINCE: SincePreset = '24h';

export type Since = { kind: 'preset'; preset: SincePreset } | { kind: 'at'; at: Date };

/** `24h`, `7d`, … or a date-time (`2026-10-04T06:00`, local when it has no zone); else the default. */
export function parseSince(v: string | null | undefined): Since {
  const s = (v ?? '').trim();
  if (s in SINCE_PRESETS) return { kind: 'preset', preset: s as SincePreset };
  const at = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?/.test(s) ? parseTime(s) : null;
  return at ? { kind: 'at', at } : { kind: 'preset', preset: DEFAULT_SINCE };
}

export function sinceTime(s: Since, now: Date): Date {
  return s.kind === 'at' ? s.at : new Date(now.getTime() - SINCE_PRESETS[s.preset] * 1000);
}

/** The hash value for a Since (`24h`, or a local `YYYY-MM-DDTHH:MM`). */
export function sinceParam(s: Since): string {
  if (s.kind === 'preset') return s.preset;
  const d = s.at;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** The entries that finished at or after `since` (and not after `now` by more than a minute), newest first. */
export function entriesSince(l: Ledger, since: Date, now: Date): LedgerEntry[] {
  const lo = since.getTime();
  const hi = now.getTime() + 60_000;
  return l.entries.filter((e) => e.finished.getTime() >= lo && e.finished.getTime() <= hi).reverse();
}

// ---------------------------------------------------------------------------
// Verdict and words

export type VerdictKind = 'pass' | 'fail' | 'none';

export interface EntryVerdict {
  kind: VerdictKind;
  /** The chip: "Pass", "Fail", "No verdict". */
  label: string;
  /** One sentence: why that verdict, and no stronger. */
  why: string;
}

const CAUSE_WORDS: Record<LedgerCause, string> = {
  check: 'one of its pre-registered checks failed',
  pilot: 'a check in its pilot failed, so the full run never started',
  timeout: 'it ran out of time',
  step: 'one of its steps exited with an error',
  memory: 'it was stopped for memory too many times',
  other: 'it stopped with an error',
};

/** pass / fail / none, never stronger than the outcome (see the header). */
export function entryVerdict(e: LedgerEntry): EntryVerdict {
  if (e.outcome === 'done') {
    return e.checked
      ? { kind: 'pass', label: 'Pass', why: 'It ran to the end and every check written before the run held.' }
      : { kind: 'none', label: 'No verdict', why: 'It ran to the end, but it had no pre-registered checks to pass or fail.' };
  }
  if (e.outcome === 'aborted') return { kind: 'none', label: 'No verdict', why: 'It was stopped early by its own abort line, so the rule was never tested.' };
  if (e.cause === 'check' || e.cause === 'pilot') return { kind: 'fail', label: 'Fail', why: `It failed: ${CAUSE_WORDS[e.cause]}.` };
  return { kind: 'none', label: 'No verdict', why: `It did not finish (${CAUSE_WORDS[e.cause ?? 'other']}), so it says nothing about the rule.` };
}

/** "the job's checks" rule line: "Rule: D354 gate 2, REGRET_RULE." / "a rule was written (not public)" / "no rule written". */
export function ruleWords(e: LedgerEntry): string {
  if (e.rule) return e.rule;
  return e.ruleWritten ? 'written, not public' : 'none written';
}

/** A headline value: whole numbers with separators, others to at most three decimals. */
export function fmtMetric(v: number): string {
  if (Number.isInteger(v)) return v.toLocaleString('en-US');
  return v.toLocaleString('en-US', { maximumFractionDigits: Math.abs(v) >= 100 ? 1 : 3 });
}

const FOLLOWUP_WORDS: Record<FollowupState, string> = {
  queued: 'queued to start after this job',
  posted: 'already on the job queue',
  ready: 'ready to post: the cloud session writes it next',
  'not-due': 'not due, because this job did not finish',
};

export function followupName(f: LedgerFollowup): string {
  return f.job ?? `the ${f.template} template`;
}

export function followupWords(f: LedgerFollowup): string {
  return FOLLOWUP_WORDS[f.state];
}

/** What a follow-up job is doing now, from the runner's public status.json (null: not in it). */
export function followupNow(f: LedgerFollowup, status: LabStatus | null): string | null {
  if (!status || !f.job) return null;
  if (status.running.some((j) => j.id === f.job)) return 'running now';
  const w = status.waiting.find((j) => j.id === f.job);
  if (w) return w.reason ? `waiting: ${w.reason}` : 'waiting';
  const qi = status.queue.findIndex((j) => j.id === f.job);
  if (qi >= 0) return qi === 0 ? 'next in the queue' : `in the queue (${qi + 1}${ordinal(qi + 1)})`;
  const done = status.finished.find((j) => j.id === f.job);
  if (done) return done.kind === 'done' ? 'finished' : done.kind === 'failed' ? 'finished: failed' : done.kind === 'skipped' ? 'skipped' : 'finished';
  return null;
}

function ordinal(n: number): string {
  const t = n % 100;
  if (t >= 11 && t <= 13) return 'th';
  return n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
}

/** The job as a name: "J061, Overnight queue night 3" or "J061". */
export function entryName(e: LedgerEntry): string {
  return e.title ? `${e.id}, ${e.title}` : e.id;
}

/**
 * One job in plain English, from its fields alone (no model): what it decides,
 * how it ended, the verdict and its limits, the numbers and what comes next.
 */
export function entrySummary(e: LedgerEntry): string {
  const v = entryVerdict(e);
  const parts: string[] = [];
  parts.push(e.decides ? `${entryName(e)} decides: ${e.decides}.` : `${entryName(e)} has no public line saying what it decides.`);
  parts.push(v.why);
  if (v.kind === 'pass') {
    parts.push(
      e.rule
        ? `Whether that settles the decision is for its rule (${e.rule}), judged in the morning read.`
        : e.ruleWritten
          ? 'Whether that settles the decision is for its rule, which is not public, judged in the morning read.'
          : 'It wrote no separate rule, so its checks are the whole test.',
    );
  } else if (v.kind === 'fail' && (e.rule || e.ruleWritten)) {
    parts.push('A failed check is not by itself a verdict on the hypothesis; the morning read says what it means for the decision.');
  }
  if (e.headline.length) parts.push(`Its numbers: ${e.headline.map((m) => `${m.key} ${fmtMetric(m.value)}`).join(', ')}.`);
  if (e.followups.length) parts.push(`Next: ${e.followups.map((f) => `${followupName(f)} (${followupWords(f)})`).join('; ')}.`);
  else if (e.outcome === 'done') parts.push('It promised no follow-up.');
  return parts.join(' ');
}

export interface NightTally {
  jobs: number;
  pass: number;
  fail: number;
  none: number;
  /** Follow-ups that are ready to post. */
  ready: number;
  /** Follow-ups queued behind a done job. */
  queued: number;
}

export function nightTally(es: LedgerEntry[]): NightTally {
  const t: NightTally = { jobs: es.length, pass: 0, fail: 0, none: 0, ready: 0, queued: 0 };
  for (const e of es) {
    t[entryVerdict(e).kind]++;
    for (const f of e.followups) {
      if (f.state === 'ready') t.ready++;
      if (f.state === 'queued') t.queued++;
    }
  }
  return t;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The night in a sentence or two (no model). */
export function nightSummary(es: LedgerEntry[], since: Date, now: Date): string {
  const span = windowWords(since, now);
  if (!es.length) return `No job ended in ${span}.`;
  const t = nightTally(es);
  const bits: string[] = [];
  if (t.pass) bits.push(`${t.pass} passed ${t.pass === 1 ? 'its' : 'their'} checks`);
  if (t.fail) bits.push(`${t.fail} failed a pre-registered check`);
  if (t.none) bits.push(`${t.none} ended with no verdict`);
  let s = `${plural(t.jobs, 'job')} ended in ${span}: ${joinWords(bits)}.`;
  const next: string[] = [];
  if (t.queued) next.push(`${plural(t.queued, 'follow-up')} queued to start`);
  if (t.ready) next.push(`${plural(t.ready, 'follow-up')} ready to post`);
  if (next.length) s += ` ${capital(joinWords(next))}.`;
  return s;
}

/** "the last 24 h", "the last 7 days", "the last 1 d 3 h". */
export function windowWords(since: Date, now: Date): string {
  let s = Math.max(0, Math.round((now.getTime() - since.getTime()) / 1000));
  // A preset's start is rounded to the minute: within a minute of whole hours counts as whole.
  const hours = Math.round(s / 3600);
  if (hours > 0 && Math.abs(s - hours * 3600) < 60) s = hours * 3600;
  if (s % 86_400 === 0 && s > 3 * 86_400) return `the last ${s / 86_400} days`;
  if (s % 3600 === 0 && s <= 3 * 86_400) return `the last ${s / 3600} h`;
  return `the last ${formatDuration(s)}`;
}

function joinWords(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? '';
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

const capital = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

// ---------------------------------------------------------------------------
// The coach prompt (deterministic)

const REPORT_SYSTEM = `You explain a night of automated experiments from a Magic: The Gathering AI lab to the person who runs it, over breakfast.
Each job was registered in advance with the decision it informs, a pass/fail rule and checks. You get only the public ledger: ids, titles, what each job decides, the rule's short name, how it ended, its verdict, its headline numbers and its follow-ups.
Rules:
- Never make a verdict stronger than the one given. "No verdict" stays no verdict; a pass means only that the job's own checks held, not that the decision is settled.
- Do not guess what a metric measures beyond its name, and do not invent numbers, thresholds or jobs.
- Say plainly what is unknown.
Answer in plain English, at most about 200 words: first the night in two sentences, then one short line per job, then what to look at first this morning.`;

/** The coach's prompt for one night: the deterministic summaries and a table of the fields. */
export function reportPrompt(es: LedgerEntry[], since: Date, now: Date): Prompt {
  const lines: string[] = [];
  lines.push(`Window: ${since.toISOString()} to ${now.toISOString()}.`);
  lines.push(`Summary: ${nightSummary(es, since, now)}`);
  lines.push('');
  for (const e of [...es].reverse()) {
    const v = entryVerdict(e);
    lines.push(`## ${entryName(e)}`);
    lines.push(`- finished: ${e.finished.toISOString()}`);
    lines.push(`- decides: ${e.decides ?? '(not public)'}`);
    lines.push(`- rule: ${ruleWords(e)}`);
    lines.push(`- outcome: ${e.outcome}${e.cause ? ` (${e.cause})` : ''}; had pre-registered checks: ${e.checked ? 'yes' : 'no'}`);
    lines.push(`- verdict: ${v.label}. ${v.why}`);
    lines.push(`- headline: ${e.headline.length ? e.headline.map((m) => `${m.key} = ${fmtMetric(m.value)}`).join(', ') : '(none)'}`);
    lines.push(`- follow-ups: ${e.followups.length ? e.followups.map((f) => `${followupName(f)}: ${followupWords(f)}`).join('; ') : '(none)'}`);
    lines.push('');
  }
  lines.push('Explain this night.');
  return { system: REPORT_SYSTEM, user: lines.join('\n') };
}

// ---------------------------------------------------------------------------
// Sample, source, fetch

/** Move every time so the newest entry finished `ageS` before `now` (the bundled sample keeps looking current). */
export function rebaseLedger(l: Ledger, now: Date, ageS = 2 * 3600): Ledger {
  const newest = l.entries.at(-1);
  if (!newest) return l;
  const shift = now.getTime() - ageS * 1000 - newest.finished.getTime();
  const at = (d: Date) => new Date(d.getTime() + shift);
  return { ...l, generatedAt: l.generatedAt ? at(l.generatedAt) : null, entries: l.entries.map((e) => ({ ...e, finished: at(e.finished) })) };
}

/**
 * `#lab/report`, `#lab/report?since=48h`, `#lab/report?since=2026-10-04T06:00&src=sample`.
 * `src=` is the rest of the hash (lab/status.ts `hashSource`), so it comes last.
 */
export function reportParams(hash: string, baseUrl: string): { source: LabSource; since: Since } {
  const q = /^#lab\/report\/?\?(.*)$/.exec(hash)?.[1] ?? '';
  const srcAt = q.search(/(^|&)src=/);
  const head = srcAt >= 0 ? q.slice(0, srcAt) : q;
  const src = srcAt >= 0 ? q.slice(srcAt).replace(/^&?src=/, '') : undefined;
  let since: string | null = null;
  for (const kv of head.split('&')) {
    const m = /^since=(.*)$/.exec(kv);
    if (m) {
      try {
        since = decodeURIComponent(m[1]!);
      } catch {
        since = null;
      }
    }
  }
  return { source: hashSource(src, DEFAULT_LEDGER_SRC, 'ledger-sample.json', baseUrl), since: parseSince(since) };
}

/** The hash for a window and source. */
export function reportHash(since: Since, src: string | null): string {
  const p = sinceParam(since);
  const q = [p !== DEFAULT_SINCE ? `since=${encodeURIComponent(p)}` : '', src ? `src=${src}` : ''].filter(Boolean);
  return q.length ? `#lab/report?${q.join('&')}` : '#lab/report';
}

/** Fetch and parse ledger.json. Errors are LabFetchError, sorted by kind. */
export async function fetchLedger(url: string, opts: { fetch: FetchLike; now?: number; signal?: AbortSignal }): Promise<Ledger> {
  const json = await fetchLabJson(url, opts, 'ledger file', LEDGER_MAX_BYTES);
  try {
    return parseLedger(json);
  } catch (e) {
    throw new LabFetchError('parse', e instanceof Error ? e.message : 'The ledger file is not a ledger file.');
  }
}
