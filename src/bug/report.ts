/*
 * ForgeCoach — bug/report.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A bug report from the page (mtg-table D411): what the player typed (a title,
 * what happened, a severity) plus what the page knows at that moment, built
 * here so the player never has to copy it by hand:
 *
 *   - the game: id, this seat, turn, phase, who is active and who has priority;
 *   - the open ask (its kind and options) and the engine's prompt;
 *   - the last MAX_FRAMES frames of the GameLog, as the page already holds them
 *     (each reader has redacted them for this seat: never anything the seat
 *     could not see);
 *   - recent console errors (bug/consoleRing.ts);
 *   - the build, the skin, the settings that matter, the viewport, the browser.
 *
 * Secrets never go: the API key, the seat token, every room token and every
 * table URL's token are collected (`collectSecrets`) and scrubbed out of the
 * finished report's text, with anything shaped like an Anthropic key or a
 * `token=` / `t=` / `seat=` URL value, and any string under a key named like a
 * token or a key (`scrubReport`). mtg-table's bug store scrubs again.
 *
 * DOM-free: storage and location are passed in.
 */
import type { GameLog } from '../log.ts';
import type { AskBody, GameStateBody, InputBody } from '../protocol.ts';
import { SETTINGS_KEY } from '../claude.ts';
import { SEAT_TOKEN_KEY, tokenFromSearch } from '../play/seatUrl.ts';
import { FRIEND_ROOMS_KEY, FRIEND_TABLE_KEY } from '../play/friendTable.ts';

export const BUG_KIND = 'forgecoach-bug';
export const BUG_SCHEMA = 1;
/** The frames a report carries at most, newest last. */
export const MAX_FRAMES = 300;
/** ...and their JSON at most this many bytes (older frames are dropped first). */
export const MAX_FRAMES_BYTES = 1_500_000;
export const MAX_TITLE = 120;
export const MAX_DETAILS = 8000;
/** An ask, an input or the screen's extra context, as JSON, at most this many bytes each. */
export const MAX_PART_BYTES = 64 * 1024;
export const MAX_CONSOLE = 50;
export const MAX_CONSOLE_TEXT = 600;
/** The whole report without images (mtg-table refuses more than 4 MB). */
export const MAX_REPORT_BYTES = 3_000_000;
/** The screenshot and its thumbnail as base64 (mtg-table's caps are 2 MB and 320 KB). */
export const MAX_SHOT_BASE64 = 1_900_000;
export const MAX_THUMB_BASE64 = 300 * 1024;

export type Severity = 'blocker' | 'major' | 'minor';
export const SEVERITIES: readonly Severity[] = ['minor', 'major', 'blocker'];
/** Where the report was made. */
export type Surface = 'play' | 'table' | 'replay' | 'review' | 'draft' | 'room' | 'deck' | 'other';

export interface GameFacts {
  gameId: string | null;
  /** The viewing seat's player id. */
  seat: number | null;
  turn: number | null;
  round: number | null;
  phase: string | null;
  activePlayer: number | null;
  priority: number | null;
  /** Whose priority, in words: "you", "opponent", or null before the game. */
  priorityIs: 'you' | 'opponent' | null;
  over: boolean;
  /** The seat socket's status (play), or null (a replay). */
  status?: string | null;
  /** The replay's position: the frame shown (an index into log.frames). */
  frameIndex?: number | null;
  /** Game n of a match, when the handshake says. */
  gameNumber?: number | null;
  /** A table of two (mtg-table M59). */
  vsHuman?: boolean;
}

export interface ConsoleEntry {
  t: number;
  level: 'error' | 'warn' | 'unhandled';
  text: string;
}

export interface ShotImage {
  mediaType: 'image/jpeg' | 'image/png';
  data: string;
  width: number;
  height: number;
  /** How it was made: the page drew itself, or the player pasted or chose a picture. */
  how: 'dom' | 'paste' | 'file';
}

export interface ClientFacts {
  build: string;
  skin: string | null;
  settings: Record<string, unknown>;
  viewport: { w: number; h: number; dpr: number };
  userAgent: string;
  language: string | null;
  online: boolean | null;
  standalone: boolean;
  /** Where the page came from: GitHub Pages, the engine (phone/LAN), the room, a tunnel, a dev server. */
  servedBy: string;
}

export interface BugLogPart {
  header: unknown;
  hello: unknown;
  seat: number;
  /** Frames in the log; `from` is the index of the first one here. */
  total: number;
  from: number;
  frames: unknown[];
}

export interface BugReport {
  kind: typeof BUG_KIND;
  schema: typeof BUG_SCHEMA;
  /** The page's own id for this report (the download's file name; the server gives the real one). */
  clientId: string;
  createdAt: string;
  title: string;
  details: string;
  severity: Severity | null;
  surface: Surface;
  /** The page's route (its #hash, scrubbed). */
  route: string;
  game: GameFacts | null;
  ask: unknown;
  input: unknown;
  log: BugLogPart | null;
  /** What the screen adds (a draft's pick, a room's state…). */
  extra: unknown;
  console: ConsoleEntry[];
  client: ClientFacts;
  screenshot?: ShotImage;
  thumbnail?: Omit<ShotImage, 'how'>;
}

/** What a screen knows (bug/context.ts): everything but what the player types and the client facts. */
export interface BugSnapshot {
  surface: Surface;
  game: GameFacts | null;
  ask: AskBody | null;
  input: InputBody | null;
  log: GameLog | null;
  extra: unknown;
  /** The room this page holds a seat in (where a friend's report goes); never its token. */
  room: { id: string; seat: 0 | 1 } | null;
}

export const EMPTY_SNAPSHOT: BugSnapshot = { surface: 'other', game: null, ask: null, input: null, log: null, extra: null, room: null };

// ---------------------------------------------------------------------------
// The pieces

/** A game's facts from its latest state, as `seat` sees it. */
export function gameFacts(state: GameStateBody | null, seat: number | null, more: Partial<GameFacts> = {}): GameFacts | null {
  if (!state && !more.gameId) return null;
  const priority = state?.priority ?? null;
  return {
    gameId: state?.gameId ?? more.gameId ?? null,
    seat,
    turn: state?.turn ?? null,
    round: state?.round ?? null,
    phase: state?.phase ?? null,
    activePlayer: state?.activePlayer ?? null,
    priority,
    priorityIs: priority === null || seat === null ? null : priority === seat ? 'you' : 'opponent',
    over: !!state?.gameOver,
    ...more,
  };
}

const bytes = (s: string): number => new TextEncoder().encode(s).length;

/** A value whose JSON is at most `max` bytes, else a stub that says what it was. */
export function capPart(v: unknown, max = MAX_PART_BYTES): unknown {
  if (v === undefined || v === null) return null;
  let text: string;
  try {
    text = JSON.stringify(v);
  } catch {
    return { unserialisable: true };
  }
  if (bytes(text) <= max) return v;
  const o = v as Record<string, unknown>;
  return { truncated: true, bytes: bytes(text), kind: typeof o?.kind === 'string' ? o.kind : null, prompt: typeof o?.prompt === 'string' ? o.prompt.slice(0, 500) : null };
}

/** The last frames of a log: at most `maxFrames`, and at most `maxBytes` of JSON (oldest dropped first). */
export function logTail(log: GameLog | null, maxFrames = MAX_FRAMES, maxBytes = MAX_FRAMES_BYTES): BugLogPart | null {
  if (!log) return null;
  const all = log.frames;
  let from = Math.max(0, all.length - maxFrames);
  const sizes = all.slice(from).map((f) => bytes(JSON.stringify(f)) + 1);
  let total = sizes.reduce((a, b) => a + b, 0);
  let i = 0;
  while (total > maxBytes && i < sizes.length) total -= sizes[i++]!;
  from += i;
  return { header: log.header ?? null, hello: log.hello ?? null, seat: log.seat, total: all.length, from, frames: all.slice(from) };
}

/** One clean line: control characters out, spaces folded, cut to `max`. */
export function cleanLine(s: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  return [...s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, max).join('');
}

// ---------------------------------------------------------------------------
// Secrets

type KV = Pick<Storage, 'getItem'>;

const TOKENISH = /^[A-Za-z0-9_%.~-]{8,}$/;

function addToken(out: Set<string>, v: unknown): void {
  if (typeof v !== 'string') return;
  const t = v.trim();
  if (t.length >= 8 && TOKENISH.test(t)) out.add(t);
}

function tokensInUrl(out: Set<string>, url: unknown): void {
  if (typeof url !== 'string') return;
  for (const m of url.matchAll(/[?&#](?:token|t|seat)=([^&#\s]+)/gi)) {
    addToken(out, m[1]);
    try {
      addToken(out, decodeURIComponent(m[1]!));
    } catch {
      /* not encoded */
    }
  }
}

/**
 * Every secret this browser holds that a report must never carry: the API key,
 * the engine's pairing token (stored and in the URL), each room's seat token and
 * the friend links' tokens, the table's seat token.
 */
export function collectSecrets(storage: KV | null, loc: { search: string; hash: string } | null): string[] {
  const out = new Set<string>();
  const read = (k: string): string | null => {
    try {
      return storage?.getItem(k) ?? null;
    } catch {
      return null;
    }
  };
  try {
    const s = JSON.parse(read(SETTINGS_KEY) ?? 'null') as { apiKey?: unknown } | null;
    if (s && typeof s.apiKey === 'string' && s.apiKey.length >= 8) out.add(s.apiKey.trim());
  } catch {
    /* not JSON */
  }
  addToken(out, read(SEAT_TOKEN_KEY));
  try {
    const rooms = JSON.parse(read(FRIEND_ROOMS_KEY) ?? '[]') as unknown;
    if (Array.isArray(rooms)) {
      for (const r of rooms) {
        if (!r || typeof r !== 'object') continue;
        const o = r as { token?: unknown; friendLinks?: unknown };
        addToken(out, o.token);
        if (Array.isArray(o.friendLinks)) for (const l of o.friendLinks) tokensInUrl(out, (l as { url?: unknown })?.url);
      }
    }
  } catch {
    /* not JSON */
  }
  try {
    const t = JSON.parse(read(FRIEND_TABLE_KEY) ?? 'null') as { url?: unknown } | null;
    tokensInUrl(out, t?.url);
  } catch {
    /* not JSON */
  }
  if (loc) {
    addToken(out, tokenFromSearch(loc.search));
    tokensInUrl(out, loc.search);
    tokensInUrl(out, loc.hash);
  }
  return [...out];
}

const KEY_NAMES = /^(?:[a-z_-]*token|api[_-]?key|apikey|x-api-key|authorization|password|secret|cookie)$/i;

/** Deep: a string under a key named like a token or a key becomes "[redacted]" (a card's `token: true` stays). */
export function scrubKeys(v: unknown, depth = 0): unknown {
  if (depth > 64 || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => scrubKeys(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = typeof x === 'string' && KEY_NAMES.test(k) ? '[redacted]' : scrubKeys(x, depth + 1);
  return out;
}

/** Text with every secret, anything shaped like an Anthropic key, and every token-like URL value replaced. */
export function scrubText(text: string, secrets: readonly string[]): string {
  let t = text;
  for (const s of secrets) {
    if (s.length < 8) continue;
    t = t.split(s).join('[redacted]');
    const enc = encodeURIComponent(s);
    if (enc !== s) t = t.split(enc).join('[redacted]');
  }
  t = t.replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, '[redacted-key]');
  t = t.replace(/([?&#;](?:token|t|seat|key)=)[^&#"'\s\\]{6,}/gi, '$1[redacted]');
  return t;
}

/** The report with every secret gone (images untouched: they are pixels, and base64 never matches a token by chance worth keeping). */
export function scrubReport(r: BugReport, secrets: readonly string[]): BugReport {
  const { screenshot, thumbnail, ...rest } = r;
  const clean = JSON.parse(scrubText(JSON.stringify(scrubKeys(rest)), secrets)) as BugReport;
  if (screenshot) clean.screenshot = screenshot;
  if (thumbnail) clean.thumbnail = thumbnail;
  return clean;
}

// ---------------------------------------------------------------------------
// The report

export interface BuildInput {
  title: string;
  details: string;
  severity: Severity | null;
  snapshot: BugSnapshot;
  console: ConsoleEntry[];
  client: ClientFacts;
  route: string;
  secrets: readonly string[];
  screenshot?: ShotImage | null;
  thumbnail?: Omit<ShotImage, 'how'> | null;
  now?: number;
  random?: () => number;
}

/** A short id the page shows before (or without) the server's: `fc-<yyyymmdd-hhmmss>-<4>`. */
export function clientId(now: number, random: () => number = Math.random): string {
  const iso = new Date(now).toISOString();
  const tail = Array.from({ length: 4 }, () => 'abcdefghijkmnpqrstuvwxyz23456789'[Math.floor(random() * 32)]).join('');
  return `fc-${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 19).replace(/:/g, '')}-${tail}`;
}

/** The whole report, capped and scrubbed. Throws when the title is empty. */
export function buildReport(i: BuildInput): BugReport {
  const title = cleanLine(i.title, MAX_TITLE);
  if (!title) throw new Error('A bug report needs a title.');
  const now = i.now ?? Date.now();
  const s = i.snapshot;
  const report: BugReport = {
    kind: BUG_KIND,
    schema: BUG_SCHEMA,
    clientId: clientId(now, i.random),
    createdAt: new Date(now).toISOString(),
    title,
    // eslint-disable-next-line no-control-regex
    details: [...i.details.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')].slice(0, MAX_DETAILS).join(''),
    severity: i.severity,
    surface: s.surface,
    route: i.route.slice(0, 300),
    game: s.game,
    ask: capPart(s.ask),
    input: capPart(s.input),
    log: logTail(s.log),
    extra: capPart(s.extra),
    console: i.console.slice(-MAX_CONSOLE).map((c) => ({ t: c.t, level: c.level, text: c.text.slice(0, MAX_CONSOLE_TEXT) })),
    client: i.client,
  };
  // A report too large without its images (frames of an unusually large game): fewer frames until it fits.
  let out = scrubReport(report, i.secrets);
  while (out.log && out.log.frames.length > 0 && bytes(JSON.stringify(out)) > MAX_REPORT_BYTES) {
    const cut = Math.max(1, Math.ceil(out.log.frames.length / 4));
    out = { ...out, log: { ...out.log, from: out.log.from + cut, frames: out.log.frames.slice(cut) } };
  }
  if (i.screenshot && i.screenshot.data.length <= MAX_SHOT_BASE64) out.screenshot = i.screenshot;
  if (i.thumbnail && i.thumbnail.data.length <= MAX_THUMB_BASE64) out.thumbnail = i.thumbnail;
  return out;
}

/** A one-line summary of what the report adds by itself, for the panel. */
export function attachedSummary(s: BugSnapshot, consoleCount: number): string[] {
  const out: string[] = [];
  const g = s.game;
  if (g) {
    const where = [g.gameId ? `game ${g.gameId}` : null, g.seat !== null ? `seat ${g.seat}` : null, g.turn ? `turn ${g.turn}` : null, g.phase ? g.phase.toLowerCase().replace(/_/g, ' ') : null, g.priorityIs ? `${g.priorityIs === 'you' ? 'your' : 'their'} priority` : null].filter(Boolean);
    if (where.length) out.push(where.join(' · '));
  }
  if (s.ask) out.push(`the open question (${s.ask.kind})`);
  if (s.log) out.push(`the last ${Math.min(MAX_FRAMES, s.log.frames.length)} frames of your log (only what your seat sees)`);
  if (s.extra) out.push(s.surface === 'room' ? 'the room’s state' : s.surface === 'draft' ? 'the draft’s state' : 'this screen’s state');
  out.push(consoleCount ? `${consoleCount} recent console message${consoleCount === 1 ? '' : 's'}` : 'no console errors');
  out.push('the site’s build, look and settings (never your API key or a token)');
  return out;
}
