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
/** The runner's heartbeat reaches the public copy every two minutes; older than this, warn. */
export const HEARTBEAT_STALE_S = 5 * 60;
/** IDLE turns red after this long. */
export const IDLE_RED_AFTER_S = 10 * 60;
/** Larger than any plausible status.json; refuse bigger bodies. */
export const MAX_BYTES = 512 * 1024;
const MAX_LIST = 50;
/** More cores than any lab PC has; larger counts are refused. */
export const MAX_CORES = 4096;
const MAX_TEXT = 200;
/** The runner publishes at most 40 live metrics and 24 cubes. */
export const MAX_LIVE = 40;
export const MAX_CUBES = 24;
/** A live metric key: lowercase segments of letters, digits and _, dot-joined (the runner's METRIC shape). */
const LIVE_KEY = /^[a-z][a-z0-9_]{0,40}(\.[a-z0-9_]{1,40}){0,3}$/;

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
  /** Cores the running jobs keep busy now (their widths summed), when the runner says. */
  coresUsed?: number | null;
  /** The runner's core budget, when the runner says (never 0). */
  coresTotal?: number | null;
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
  /** The most workers the job may use (its sizing). */
  workersMax: number | null;
  /** The job's memory now, GB. */
  memGb: number | null;
  /** The cores the job keeps busy now (its width), when the runner says. */
  cores?: number | null;
  errors: number | null;
  paused: boolean;
  /** done / total in 0..1, or null. */
  fraction: number | null;
  /** The job's metrics as of the runner's last minute read, in the runner's order (headline first). */
  live: LiveMetric[];
  /** A cube-lab queue's per-cube progress ("cube 1", … unless the job named them). */
  cubes: CubeProgress[];
}

export interface LiveMetric {
  /** The key as published, e.g. `q.engine_errors`. */
  key: string;
  value: number;
  /** One of the job's `headline:` metrics. */
  headline: boolean;
}

export interface CubeProgress {
  id: string;
  done: number;
  planned: number;
  /** done / planned in 0..1, or null when nothing is planned. */
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
  /** When the runner's loop last ran (falls back to `updated` in older files). */
  heartbeat: Date | null;
  /** RUNNING or IDLE: the runner's word, else derived from `running`. */
  state: 'running' | 'idle';
  /** Since when nothing has run (idle only). */
  idleSince: Date | null;
  /** Why nothing runs (idle only), e.g. "queue empty", "blocked after J012". */
  idleReason: string | null;
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
  // Newer runners only (D337 amended); absent or out of range, the keys stay off so older pages look the same.
  const coresTotal = int(v.coresTotal, 1, MAX_CORES);
  const coresUsed = int(v.coresUsed, 0, MAX_CORES);
  if (coresTotal !== null) h.coresTotal = coresTotal;
  if (coresUsed !== null) h.coresUsed = coresUsed;
  return Object.values(h).some((x) => x !== null) ? h : null;
}

/** A running job's `cores` as a spread: the key only when it is a whole number in range. */
function coresOf(v: unknown): { cores?: number } {
  const n = int(v, 0, MAX_CORES);
  return n === null ? {} : { cores: n };
}

/**
 * The machine's "cores in use" meter: used of total, the fill in 0..1 (capped), and
 * whether the jobs ask for more than the budget. Null unless both numbers are known.
 */
export function coresMeter(h: LabHost | null): { used: number; total: number; fraction: number; over: boolean } | null {
  const used = h?.coresUsed;
  const total = h?.coresTotal;
  if (used == null || total == null || total <= 0) return null;
  return { used, total, fraction: Math.min(1, used / total), over: used > total };
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
    workersMax: int(v.workersMax, 0, 10_000),
    memGb: num(v.memGb, 0, 100_000),
    ...coresOf(v.cores),
    errors: int(v.errors, 0, 1e9),
    paused: allPaused || bool(v.paused),
    fraction: done !== null && total !== null && total > 0 ? Math.min(1, Math.max(0, done / total)) : null,
    live: parseLive(v.live, v.liveHeadline),
    cubes: parseCubes(v.cubes),
  };
}

/**
 * `live: {key: number}`: keys in the runner's metric shape only, finite numbers in range
 * (|x| ≤ 1e15), at most MAX_LIVE, in the file's order; never a per-cube key (cubes go in `cubes`).
 */
export function parseLive(v: unknown, headline?: unknown): LiveMetric[] {
  if (!isObj(v)) return [];
  const heads = new Set(Array.isArray(headline) ? headline.filter((k): k is string => typeof k === 'string') : []);
  const out: LiveMetric[] = [];
  for (const [key, x] of Object.entries(v)) {
    if (out.length >= MAX_LIVE) break;
    if (!LIVE_KEY.test(key) || /(^|\.)cubes\./.test(key)) continue;
    const value = typeof x === 'number' ? num(x, -1e15, 1e15) : null;
    if (value === null) continue;
    out.push({ key, value, headline: heads.has(key) });
  }
  return out;
}

/** `cubes: [{id, done, planned}]`: id clipped text, counts whole and ≥ 0, done ≤ planned shown as is. */
export function parseCubes(v: unknown): CubeProgress[] {
  const out: CubeProgress[] = [];
  for (const c of Array.isArray(v) ? v.slice(0, MAX_CUBES) : []) {
    if (!isObj(c)) continue;
    const id = cleanText(c.id, 40);
    const done = int(c.done, 0, 1e9);
    const planned = int(c.planned, 0, 1e9);
    if (!id || done === null || planned === null) continue;
    out.push({ id, done, planned, fraction: planned > 0 ? Math.min(1, done / planned) : null });
  }
  return out;
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

  const state = json.state === 'running' || json.state === 'idle' ? json.state : running.length ? 'running' : 'idle';
  return {
    schema: int(json.schema, 0, 1e6),
    updated,
    heartbeat: parseTime(json.heartbeat) ?? updated,
    state,
    idleSince: state === 'idle' ? parseTime(json.idleSince) : null,
    idleReason: state === 'idle' ? cleanText(json.idleReason, 60) : null,
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

/** The heartbeat is older than HEARTBEAT_STALE_S: the runner may be down (a quiet job keeps it fresh). */
export function heartbeatStale(s: LabStatus, now: Date): { stale: boolean; ageS: number | null } {
  if (!s.heartbeat) return { stale: false, ageS: null };
  const ageS = Math.max(0, (now.getTime() - s.heartbeat.getTime()) / 1000);
  return { stale: ageS >= HEARTBEAT_STALE_S, ageS };
}

/** RUNNING / IDLE for the header: how long idle, why, and red after IDLE_RED_AFTER_S. */
export function runState(s: LabStatus, now: Date): { state: 'running' | 'idle'; idleS: number | null; reason: string | null; red: boolean } {
  if (s.state === 'running') return { state: 'running', idleS: null, reason: null, red: false };
  const idleS = s.idleSince ? Math.max(0, (now.getTime() - s.idleSince.getTime()) / 1000) : null;
  return { state: 'idle', idleS, reason: s.idleReason, red: idleS !== null && idleS >= IDLE_RED_AFTER_S };
}

// ---------------------------------------------------------------------------
// Live metrics: friendly labels and formatting

type Fmt = 'count' | 'rate' | 'pct' | 'bytes' | 'gb' | 'secs' | 'dec';

/** Known metric names (the key's last segment): label, format, and when a value is a warning. */
const KNOWN_LIVE: Record<string, { label: string; fmt: Fmt; warn?: 'bad' | 'amber' }> = {
  drafts: { label: 'Drafts', fmt: 'count' },
  night_drafts_done: { label: 'Drafts tonight', fmt: 'count' },
  planned_drafts: { label: 'Drafts planned', fmt: 'count' },
  games: { label: 'Games', fmt: 'count' },
  drafts_per_h: { label: 'Drafts / h (all nights)', fmt: 'rate' },
  night_drafts_done_per_h: { label: 'Drafts tonight / h', fmt: 'rate' },
  games_per_h: { label: 'Games / h', fmt: 'rate' },
  engine_errors: { label: 'Engine errors', fmt: 'count', warn: 'bad' },
  engine_error_rate: { label: 'Engine error rate', fmt: 'pct', warn: 'bad' },
  errors: { label: 'Errors', fmt: 'count', warn: 'bad' },
  timeouts: { label: 'Timeouts', fmt: 'count', warn: 'amber' },
  draws: { label: 'Draws', fmt: 'count' },
  recorded_games: { label: 'Recordings', fmt: 'count' },
  recorded_errors: { label: 'Recording errors', fmt: 'count', warn: 'amber' },
  recorded_bytes_per_game: { label: 'Recording size', fmt: 'bytes' },
  output_bytes: { label: 'Disk', fmt: 'bytes' },
  disk_gb: { label: 'Disk', fmt: 'gb' },
  disk_free_gb: { label: 'Disk free', fmt: 'gb' },
  free_disk_gb: { label: 'Disk free', fmt: 'gb' },
  bridge_drafts: { label: 'Bridge drafts', fmt: 'count' },
  bridge_drafts_done: { label: 'Bridge drafts', fmt: 'count' },
  bridge_drafts_planned: { label: 'Bridge planned', fmt: 'count' },
  bridge_share: { label: 'Bridge share', fmt: 'pct' },
  mean_turns: { label: 'Turns / game', fmt: 'dec' },
  mean_game_s: { label: 'Game length', fmt: 'secs' },
  median_game_s: { label: 'Median game', fmt: 'secs' },
  workers: { label: 'Workers', fmt: 'count' },
  peak_worker_rss_gb: { label: 'Peak worker', fmt: 'gb' },
  mem_gb: { label: 'Memory', fmt: 'gb' },
  memory_gb: { label: 'Memory', fmt: 'gb' },
  pressure_events: { label: 'Pressure events', fmt: 'count', warn: 'amber' },
  elapsed_s: { label: 'Elapsed', fmt: 'secs' },
  runs: { label: 'Runs', fmt: 'count' },
  nights: { label: 'Nights', fmt: 'count' },
};
/** The order known metrics take after the headline ones. */
const KNOWN_ORDER = Object.keys(KNOWN_LIVE);

export interface LiveCell {
  key: string;
  /** A friendly label for a known metric, else the raw key. */
  label: string;
  value: string;
  tone?: 'bad' | 'amber';
  headline: boolean;
  known: boolean;
}

/** "1.2 MB", "840 KB", "3.4 GB". */
export function formatBytes(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e12) return `${fmtNum(n / 1e12, 1)} TB`;
  if (a >= 1e9) return `${fmtNum(n / 1e9, 1)} GB`;
  if (a >= 1e6) return `${fmtNum(n / 1e6, 1)} MB`;
  if (a >= 1e3) return `${fmtNum(n / 1e3, 0)} KB`;
  return `${fmtNum(n)} B`;
}

function fmtByName(name: string, v: number): Fmt {
  if (/_bytes$/.test(name) || name === 'bytes') return 'bytes';
  if (/_gb$/.test(name)) return 'gb';
  if (/_s$/.test(name)) return 'secs';
  if (/_per_h$/.test(name)) return 'rate';
  if (/(_rate|_share)$/.test(name) && v >= 0 && v <= 1) return 'pct';
  return Number.isInteger(v) ? 'count' : 'dec';
}

/** One metric value as text, by its format. */
export function formatLive(v: number, fmt: Fmt): string {
  switch (fmt) {
    case 'count': return fmtNum(v, Number.isInteger(v) ? 0 : 1);
    case 'rate': return `${fmtNum(v, Math.abs(v) < 10 ? 1 : 0)}`;
    case 'pct': return `${fmtNum(v * 100, v * 100 < 10 ? 1 : 0)} %`;
    case 'bytes': return formatBytes(v);
    case 'gb': return `${fmtNum(v, 1)} GB`;
    case 'secs': return formatDuration(v);
    case 'dec': return fmtNum(v, Math.abs(v) < 10 ? 2 : 1);
  }
}

/**
 * The running job's live grid: memory first (from `memGb`), then the headline metrics in the
 * runner's order, then the known ones in a fixed order, then any other key under its raw name.
 * `workers` and `elapsed_s` are left out when the card already shows them; two cells that
 * would share a label (two metric lines) carry their prefix.
 */
export function liveCells(j: RunningJob): LiveCell[] {
  const cells: Array<LiveCell & { rank: number; order: number }> = [];
  j.live.forEach((m, i) => {
    const name = m.key.split('.').at(-1)!;
    if ((name === 'workers' && j.workers !== null) || (name === 'elapsed_s' && j.elapsedS !== null)) return;
    const k = KNOWN_LIVE[name];
    const fmt = k?.fmt ?? fmtByName(name, m.value);
    const tone = k?.warn && m.value > 0 ? k.warn : undefined;
    const known = k !== undefined;
    cells.push({ key: m.key, label: k?.label ?? m.key, value: formatLive(m.value, fmt), tone, headline: m.headline, known, rank: m.headline ? 0 : known ? 1 : 2, order: m.headline ? i : known ? KNOWN_ORDER.indexOf(name) : i });
  });
  cells.sort((a, b) => a.rank - b.rank || a.order - b.order);
  const seen = new Map<string, number>();
  for (const c of cells) seen.set(c.label, (seen.get(c.label) ?? 0) + 1);
  const out: LiveCell[] = cells.map(({ rank: _r, order: _o, ...c }) => (c.known && (seen.get(c.label) ?? 0) > 1 && c.key.includes('.') ? { ...c, label: `${c.label} (${c.key.split('.')[0]})` } : c));
  if (j.memGb !== null) out.unshift({ key: 'memGb', label: 'Memory', value: formatLive(j.memGb, 'gb'), headline: false, known: true });
  return out;
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
    heartbeat: mv(s.heartbeat),
    idleSince: mv(s.idleSince),
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
  return hashSource(/^#lab(?:\/)?\?(?:.*&)?src=(.*)$/.exec(hash)?.[1], DEFAULT_LAB_SRC, 'lab-sample.json', baseUrl);
}

/**
 * The source from the raw `src=` value of a hash (undefined: none): the
 * default URL, the bundled `sampleFile` under `baseUrl`, or an http(s) URL.
 * Shared with the ladder page (lab/ladder.ts).
 */
export function hashSource(src: string | undefined, defaultUrl: string, sampleFile: string, baseUrl: string): LabSource {
  if (src === undefined) return { kind: 'default', url: defaultUrl };
  let raw = src.trim();
  if (/^https?%3a/i.test(raw)) {
    try {
      raw = decodeURIComponent(raw);
    } catch {
      return { kind: 'invalid', reason: 'The src URL is not decodable.' };
    }
  }
  if (!raw) return { kind: 'default', url: defaultUrl };
  if (raw === 'sample') return { kind: 'sample', url: `${baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`}${sampleFile}` };
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

export type FetchLike = (url: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'text'>>;

/**
 * Fetch a JSON file with a cache-buster: the parsed body, unvalidated. Errors
 * are LabFetchError, sorted by kind; `noun` names the file in their messages.
 * Shared with the ladder page (lab/ladder.ts).
 */
export async function fetchLabJson(url: string, opts: { fetch: FetchLike; now?: number; signal?: AbortSignal }, noun = 'status file', maxBytes = MAX_BYTES): Promise<unknown> {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await opts.fetch(withCacheBuster(url, opts.now ?? Date.now()), { cache: 'no-store', credentials: 'omit', signal: opts.signal });
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') throw e;
    throw new LabFetchError('network', `Could not reach the ${noun}.`);
  }
  if (res.status === 404) throw new LabFetchError('notFound', `There is no ${noun} there yet (404).`, 404);
  if (!res.ok) throw new LabFetchError('http', `The ${noun} answered HTTP ${res.status}.`, res.status);
  const text = await res.text();
  if (text.length > maxBytes) throw new LabFetchError('tooLarge', `The ${noun} is too large to be a ${noun}.`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new LabFetchError('parse', `The ${noun} is not valid JSON.`);
  }
}

/** Fetch and parse the status file. Errors are LabFetchError, sorted by kind. */
export async function fetchLabStatus(url: string, opts: { fetch: FetchLike; now?: number; signal?: AbortSignal }): Promise<LabStatus> {
  const json = await fetchLabJson(url, opts);
  try {
    return parseLabStatus(json);
  } catch (e) {
    throw new LabFetchError('parse', e instanceof Error ? e.message : 'The status file is not a status file.');
  }
}
