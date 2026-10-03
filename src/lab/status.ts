/*
 * ForgeCoach — lab/status.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The lab progress page's data (#lab): the PC runner's status.json (see
 * mtg-table's RUNNER-SPEC.md, "status.json"), pushed numbers-only to this
 * repo's `lab-status` branch. This module turns unknown JSON into a typed,
 * validated view model and formats it (ETA, durations, staleness). DOM-free;
 * `fetch` is injected.
 *
 * Every string from the file is untrusted: it is clipped, stripped of control
 * characters and only ever rendered as React text, never put into a URL or
 * markup. Every number is checked (finite, in range). Unknown fields are
 * ignored and missing ones become null (shown as "—").
 */

export const DEFAULT_LAB_SRC = 'https://raw.githubusercontent.com/jalirkan/ForgeCoach/lab-status/status.json';
/** Refresh period while the page is visible. */
export const REFRESH_MS = 60_000;
/** Staleness thresholds for `updated`. */
export const AMBER_AFTER_S = 10 * 60;
export const RED_AFTER_S = 30 * 60;
/** Larger than any plausible status.json; refuse bigger bodies. */
export const MAX_BYTES = 512 * 1024;
const MAX_LIST = 50;
const MAX_TEXT = 200;

// ---------------------------------------------------------------------------
// View model

export interface LabHost {
  load1: number | null;
  /** CPU threads, when the runner says (load is read against it). */
  cpus: number | null;
  memUsedGb: number | null;
  memTotalGb: number | null;
  swapUsedMb: number | null;
  /** Memory pressure, /proc/pressure/memory "some avg10" (a percentage, 0–100). */
  pressure: number | null;
}

export interface PressureEvent {
  at: Date | null;
  /** The raw `at` when it is not a timestamp. */
  atText: string | null;
  action: string;
}

export interface RunningJob {
  id: string;
  title: string | null;
  phase: string | null;
  started: Date | null;
  done: number | null;
  total: number | null;
  unit: string | null;
  ratePerHour: number | null;
  eta: Date | null;
  /** The raw `eta` when it is not a timestamp (e.g. "~2 h"). */
  etaText: string | null;
  /** Seconds, as reported or as `updated − started`. */
  elapsedS: number | null;
  /** The raw `elapsed` when it is neither seconds nor a duration we read. */
  elapsedText: string | null;
  workers: number | null;
  errors: number | null;
  paused: boolean;
  /** done / total in 0..1, or null. */
  fraction: number | null;
}

export interface QueuedJob {
  id: string;
  title: string | null;
  est: string | null;
}

export interface WaitingJob {
  id: string;
  title: string | null;
  reason: string | null;
  est: string | null;
}

export type FinishedKind = 'done' | 'failed' | 'skipped' | 'other';

export interface FinishedJob {
  id: string;
  title: string | null;
  kind: FinishedKind;
  /** The status word as the runner wrote it. */
  status: string | null;
  finished: Date | null;
  headline: string | null;
}

export interface LabStatus {
  schema: number | null;
  updated: Date | null;
  /** The whole runner is paused. */
  paused: boolean;
  host: LabHost | null;
  running: RunningJob[];
  queue: QueuedJob[];
  waiting: WaitingJob[];
  /** Newest first. */
  finished: FinishedJob[];
  /** Newest first. */
  pressureEvents: PressureEvent[];
}

// ---------------------------------------------------------------------------
// Primitive validators

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Untrusted text: a string (or a finite number), control characters removed, clipped. */
export function cleanText(v: unknown, max = MAX_TEXT): string | null {
  let s: string;
  if (typeof v === 'string') s = v;
  else if (typeof v === 'number' && Number.isFinite(v)) s = String(v);
  else return null;
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** A finite number in [min, max]; numeric strings are accepted. */
export function num(v: unknown, min = 0, max = 1e9): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v) ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

/** A whole number in [min, max]. */
export function int(v: unknown, min = 0, max = 1e9): number | null {
  const n = num(v, min, max);
  return n === null ? null : Math.round(n);
}

/** An ISO-ish timestamp (it must name a date: "2026-10-03T…"), else null. Years 2000–2200. */
export function parseTime(v: unknown): Date | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(v.trim()) || v.length > 64) return null;
  const t = Date.parse(v.trim());
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const y = d.getUTCFullYear();
  return y >= 2000 && y <= 2200 ? d : null;
}

/**
 * A duration in seconds: a number of seconds, or text like "1 h 20 min",
 * "1h20m", "45 s", "2 d", "01:20:00", "PT1H20M". Null when unreadable.
 */
export function parseDuration(v: unknown): number | null {
  if (typeof v === 'number') return num(v, 0, 1e8);
  if (typeof v !== 'string' || v.length > 40) return null;
  const s = v.trim().toLowerCase();
  if (/^\d+(\.\d+)?$/.test(s)) return num(Number(s), 0, 1e8);
  const hms = /^(\d+):([0-5]\d)(?::([0-5]\d))?$/.exec(s);
  if (hms) return hms[3] !== undefined ? +hms[1]! * 3600 + +hms[2]! * 60 + +hms[3] : +hms[1]! * 3600 + +hms[2]! * 60;
  const iso = /^p(?:(\d+)d)?(?:t(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?)?$/.exec(s);
  if (iso && s !== 'p' && s !== 'pt') return (+(iso[1] ?? 0)) * 86400 + (+(iso[2] ?? 0)) * 3600 + (+(iso[3] ?? 0)) * 60 + +(iso[4] ?? 0);
  const part = String.raw`(\d+(?:\.\d+)?)\s*(d|days?|h|hrs?|hours?|m|mins?|minutes?|s|secs?|seconds?)`;
  if (!new RegExp(String.raw`^~?\s*(?:${part}[\s,]*)+$`).test(s)) return null;
  let total = 0;
  for (const m of s.matchAll(new RegExp(part, 'g'))) {
    const u = m[2]![0];
    total += Number(m[1]) * (u === 'd' ? 86400 : u === 'h' ? 3600 : u === 'm' ? 60 : 1);
  }
  return num(total, 0, 1e8);
}

const bool = (v: unknown): boolean => v === true || v === 'true' || v === 1;

function list(v: unknown): unknown[] {
  return Array.isArray(v) ? v.slice(0, MAX_LIST) : [];
}

// ---------------------------------------------------------------------------
// Parsing

/** Thrown when the body is not a status file at all (not an object). */
export class LabStatusError extends Error {}

function parseHost(v: unknown): LabHost | null {
  if (!isObj(v)) return null;
  const h: LabHost = {
    load1: num(v.load1, 0, 10_000),
    cpus: int(v.cpus ?? v.threads, 1, 4096),
    memUsedGb: num(v.memUsedGb, 0, 100_000),
    memTotalGb: num(v.memTotalGb, 0.01, 100_000),
    swapUsedMb: num(v.swapUsedMb, 0, 1e8),
    pressure: num(v.pressure, 0, 100),
  };
  return Object.values(h).some((x) => x !== null) ? h : null;
}

function parseRunning(v: unknown, updated: Date | null, allPaused: boolean): RunningJob | null {
  if (!isObj(v)) return null;
  const started = parseTime(v.started);
  const eta = parseTime(v.eta);
  let elapsedS = parseDuration(v.elapsed);
  const elapsedText = elapsedS === null ? cleanText(v.elapsed, 40) : null;
  if (elapsedS === null && elapsedText === null && started && updated && updated >= started) {
    elapsedS = (updated.getTime() - started.getTime()) / 1000;
  }
  const done = num(v.done, 0, 1e12);
  const total = num(v.total, 0, 1e12);
  return {
    id: cleanText(v.id, 40) ?? '—',
    title: cleanText(v.title),
    phase: cleanText(v.phase),
    started,
    done,
    total,
    unit: cleanText(v.unit, 30),
    ratePerHour: num(v.ratePerHour, 0, 1e9),
    eta,
    etaText: eta ? null : cleanText(v.eta, 40),
    elapsedS,
    elapsedText,
    workers: int(v.workers, 0, 10_000),
    errors: int(v.errors, 0, 1e9),
    paused: allPaused || bool(v.paused),
    fraction: done !== null && total !== null && total > 0 ? Math.min(1, Math.max(0, done / total)) : null,
  };
}

function finishedKind(s: string | null): FinishedKind {
  const w = (s ?? '').toLowerCase();
  if (/^(done|ok|success|succeeded|passed|complete|completed)$/.test(w)) return 'done';
  if (/^(failed|fail|error|errored|crashed|killed|aborted)$/.test(w)) return 'failed';
  if (/^(skipped|skip|cancelled|canceled)$/.test(w)) return 'skipped';
  return 'other';
}

function newestFirst<T>(items: T[], at: (t: T) => Date | null): T[] {
  // Dated items newest first; undated ones after, the later in the file first
  // (a runner that appends puts its newest last).
  const dated = items.filter((t) => at(t)).sort((a, b) => at(b)!.getTime() - at(a)!.getTime());
  const undated = items.filter((t) => !at(t)).reverse();
  return [...dated, ...undated];
}

function parsePressureEvents(v: unknown): PressureEvent[] {
  const out: PressureEvent[] = [];
  for (const e of list(v)) {
    if (!isObj(e)) continue;
    const action = cleanText(e.action);
    if (!action) continue;
    const at = parseTime(e.at);
    out.push({ at, atText: at ? null : cleanText(e.at, 40), action });
  }
  return newestFirst(out, (e) => e.at);
}

/** Unknown JSON → LabStatus. Throws LabStatusError only when it is not an object. */
export function parseLabStatus(json: unknown): LabStatus {
  if (!isObj(json)) throw new LabStatusError('The status file is not a JSON object.');
  const updated = parseTime(json.updated);
  const paused = bool(json.paused);
  const runningRaw = Array.isArray(json.running) ? list(json.running) : json.running == null ? [] : [json.running];
  const running = runningRaw.map((r) => parseRunning(r, updated, paused)).filter((r): r is RunningJob => r !== null);

  const queue: QueuedJob[] = [];
  for (const q of list(json.queue)) {
    if (!isObj(q)) continue;
    queue.push({ id: cleanText(q.id, 40) ?? '—', title: cleanText(q.title), est: cleanText(q.est, 40) });
  }
  const waiting: WaitingJob[] = [];
  for (const w of list(json.waiting)) {
    if (!isObj(w)) continue;
    waiting.push({ id: cleanText(w.id, 40) ?? '—', title: cleanText(w.title), reason: cleanText(w.reason), est: cleanText(w.est, 40) });
  }
  const finished: FinishedJob[] = [];
  for (const f of list(json.finished)) {
    if (!isObj(f)) continue;
    const status = cleanText(f.status, 30);
    finished.push({
      id: cleanText(f.id, 40) ?? '—',
      title: cleanText(f.title),
      kind: finishedKind(status),
      status,
      finished: parseTime(f.finished),
      headline: cleanText(f.headline, 300),
    });
  }
  const host = parseHost(json.host);
  const events = parsePressureEvents(json.pressureEvents ?? (isObj(json.host) ? json.host.pressureEvents : undefined));

  return {
    schema: int(json.schema, 0, 1e6),
    updated,
    paused,
    host,
    running,
    queue,
    waiting,
    finished: newestFirst(finished, (f) => f.finished),
    pressureEvents: events,
  };
}

/** Nothing to show: no running, queued, waiting or finished jobs. */
export function isEmptyStatus(s: LabStatus): boolean {
  return !s.running.length && !s.queue.length && !s.waiting.length && !s.finished.length;
}

// ---------------------------------------------------------------------------
// Derived values and formatting

/** The ETA: the runner's, else derived from the rate at `updated` (marked estimated). */
export function jobEta(j: RunningJob, updated: Date | null): { at: Date; derived: boolean } | null {
  if (j.eta) return { at: j.eta, derived: false };
  if (!updated || j.done === null || j.total === null || !j.ratePerHour || j.paused) return null;
  const left = j.total - j.done;
  if (left <= 0) return null;
  return { at: new Date(updated.getTime() + (left / j.ratePerHour) * 3_600_000), derived: true };
}

/** "45 s", "12 min", "2 h 10 min", "3 d 4 h". */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '—';
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h < 24) return mm ? `${h} h ${mm} min` : `${h} h`;
  const d = Math.floor(h / 24);
  const hh = h % 24;
  return hh ? `${d} d ${hh} h` : `${d} d`;
}

/** "in 2 h 10 min", "3 min ago", "just now" (within a minute). */
export function formatRelative(at: Date | null, now: Date): string {
  if (!at) return '—';
  const diff = (at.getTime() - now.getTime()) / 1000;
  if (Math.abs(diff) < 60) return 'just now';
  return diff > 0 ? `in ${formatDuration(diff)}` : `${formatDuration(-diff)} ago`;
}

/** Local clock time; with the weekday when not today ("Sat 12:40"), with the date when over a week away. */
export function formatClock(at: Date | null, now: Date, locale?: string): string {
  if (!at) return '—';
  const time = at.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const sameDay = at.toDateString() === now.toDateString();
  if (sameDay) return time;
  const far = Math.abs(at.getTime() - now.getTime()) > 6 * 86_400_000;
  const day = far ? at.toLocaleDateString(locale, { day: 'numeric', month: 'short' }) : at.toLocaleDateString(locale, { weekday: 'short' });
  return `${day} ${time}`;
}

/** A number with a fixed count of decimals, or "—". */
export function fmtNum(n: number | null, digits = 0): string {
  if (n === null) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export type Staleness = 'fresh' | 'amber' | 'red' | 'unknown';

/** How old `updated` is: fresh under 10 min, amber under 30, red after. */
export function staleness(updated: Date | null, now: Date): { level: Staleness; ageS: number | null } {
  if (!updated) return { level: 'unknown', ageS: null };
  const ageS = Math.max(0, (now.getTime() - updated.getTime()) / 1000);
  return { level: ageS >= RED_AFTER_S ? 'red' : ageS >= AMBER_AFTER_S ? 'amber' : 'fresh', ageS };
}

/** "updated 3 min ago" / "updated just now" / "no update time". */
export function updatedLine(updated: Date | null, now: Date): string {
  if (!updated) return 'no update time';
  const ageS = (now.getTime() - updated.getTime()) / 1000;
  return ageS < 60 ? 'updated just now' : `updated ${formatDuration(ageS)} ago`;
}

export type PressureLevel = 'calm' | 'elevated' | 'high';

/** Memory pressure (some avg10, %): calm under 1, elevated under 10, high after. */
export function pressureLevel(p: number | null): PressureLevel | null {
  if (p === null) return null;
  return p >= 10 ? 'high' : p >= 1 ? 'elevated' : 'calm';
}

/** Memory used / total in 0..1. */
export function memFraction(h: LabHost | null): number | null {
  if (!h || h.memUsedGb === null || h.memTotalGb === null) return null;
  return Math.min(1, Math.max(0, h.memUsedGb / h.memTotalGb));
}

/**
 * Shift every timestamp so `updated` is `ageS` seconds before `now`: the
 * bundled sample keeps looking current when previewed (#lab?src=sample).
 */
export function rebaseTimes(s: LabStatus, now: Date, ageS = 90): LabStatus {
  if (!s.updated) return s;
  const shift = now.getTime() - ageS * 1000 - s.updated.getTime();
  const mv = (d: Date | null) => (d ? new Date(d.getTime() + shift) : null);
  return {
    ...s,
    updated: mv(s.updated),
    running: s.running.map((j) => ({ ...j, started: mv(j.started), eta: mv(j.eta) })),
    finished: s.finished.map((f) => ({ ...f, finished: mv(f.finished) })),
    pressureEvents: s.pressureEvents.map((e) => ({ ...e, at: mv(e.at) })),
  };
}

// ---------------------------------------------------------------------------
// Source and fetch

export type LabSource =
  | { kind: 'default'; url: string }
  | { kind: 'sample'; url: string }
  | { kind: 'custom'; url: string }
  | { kind: 'invalid'; reason: string };

/**
 * The source named by the hash: `#lab` (the lab-status branch),
 * `#lab?src=sample` (the bundled sample) or `#lab?src=<http(s) URL>`. The URL
 * is the rest of the hash after `src=`, so it may carry its own query; an
 * encoded one (`https%3A%2F%2F…`) is decoded.
 */
export function labSource(hash: string, baseUrl: string): LabSource {
  const m = /^#lab(?:\/)?\?(?:.*&)?src=(.*)$/.exec(hash);
  if (!m) return { kind: 'default', url: DEFAULT_LAB_SRC };
  let raw = m[1]!.trim();
  if (/^https?%3a/i.test(raw)) {
    try {
      raw = decodeURIComponent(raw);
    } catch {
      return { kind: 'invalid', reason: 'The src URL is not decodable.' };
    }
  }
  if (!raw) return { kind: 'default', url: DEFAULT_LAB_SRC };
  if (raw === 'sample') return { kind: 'sample', url: `${baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`}lab-sample.json` };
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { kind: 'invalid', reason: 'The src is not a URL.' };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { kind: 'invalid', reason: 'The src must be an http or https URL.' };
  if (u.username || u.password) return { kind: 'invalid', reason: 'The src must not carry a user name or password.' };
  return { kind: 'custom', url: u.href };
}

/** The URL with a `_=<ms>` cache-buster (raw.githubusercontent caches for minutes). */
export function withCacheBuster(url: string, now: number): string {
  const hashAt = url.indexOf('#');
  const base = hashAt >= 0 ? url.slice(0, hashAt) : url;
  return `${base}${base.includes('?') ? '&' : '?'}_=${now}`;
}

export type LabFetchErrorKind = 'network' | 'http' | 'notFound' | 'parse' | 'tooLarge';

export class LabFetchError extends Error {
  constructor(
    readonly kind: LabFetchErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'text'>>;

/** Fetch and parse the status file. Errors are LabFetchError, sorted by kind. */
export async function fetchLabStatus(url: string, opts: { fetch: FetchLike; now?: number; signal?: AbortSignal }): Promise<LabStatus> {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await opts.fetch(withCacheBuster(url, opts.now ?? Date.now()), { cache: 'no-store', credentials: 'omit', signal: opts.signal });
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') throw e;
    throw new LabFetchError('network', 'Could not reach the status file.');
  }
  if (res.status === 404) throw new LabFetchError('notFound', 'There is no status file there yet (404).', 404);
  if (!res.ok) throw new LabFetchError('http', `The status file answered HTTP ${res.status}.`, res.status);
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new LabFetchError('tooLarge', 'The status file is too large to be a status file.');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new LabFetchError('parse', 'The status file is not valid JSON.');
  }
  try {
    return parseLabStatus(json);
  } catch (e) {
    throw new LabFetchError('parse', e instanceof Error ? e.message : 'The status file is not a status file.');
  }
}
