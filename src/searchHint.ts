/*
 * ForgeCoach — searchHint.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * "What would the search AI do?" — the client for the coach helper's search
 * hint (mtg-table D429, docs/search-hint.md there):
 *
 *   GET  /health   → {…, hint: 1, hintEngine, hintBudgetMs} when the helper can run it
 *   POST /hint     {gameId, seat, stateSeq, inputSeq?, oppPool?, oppKnown?, budgetMs?}
 *                  → 200 {ok:true, kind:"search-hint", status:"ok"|"trivial"|"unsupported",
 *                         pick?, strength?: "clear"|"close"|"only", runnerUp?, landFirst?,
 *                         options: [{token, label, verdict?, winRate?, …}],
 *                         knowledge: {opponent, opponentModel: "pool"|"basic-lands"|…}, measure, …}
 *                  → 409 {code: "moved-on"|"superseded"|"not-yet"} · 400 / 403 / 404 / 429 / 503 / 504
 *
 * At a table of two (mtg-table D453) the helper's own door refuses the game —
 * a seat's log holds that player's hand — and each seat asks the draft room
 * instead, behind its own room token (play/friendReview.ts's seat handle):
 *
 *   GET  /room/<id>       → the seat's state, with `hint: 1` when the room's computer answers hints
 *   POST /room/<id>/hint  {seat, stateSeq, inputSeq?, budgetMs?, gameId?} → /hint's answer, for
 *                         THIS seat's own log of the room's game; the room models the friend's
 *                         hidden cards from the cube and their picks (no pool is sent)
 *                         → 409 {code: "no-game"|"game"} · 503 {code: "off"} · 404 before D453
 *
 * The engine on the player's PC plays the decision in front of them out for a
 * few seconds, from that seat's own log (the engine reads its own copy: this
 * page sends only which moment — the `seq` of the state and the input the
 * board shows). It knows only what the player knows: the request has no field
 * for the bot's deck; after a Draft vs Bot match the cube list and the bot's
 * picks the player saw go along (draft/reviewInput.ts), otherwise the engine
 * treats the bot's unseen cards as basic lands — and the answer says which.
 *
 * Words: the answer's own (best / tie / close / worse), never stronger than its
 * intervals — "clearly best" only when every other option is worse, else "too
 * close to call" with the runner-up. Card names from the state the board shows,
 * never an engine id. `fetch` is injected for tests; DOM-free.
 */
import type { AnyCard, Card, GameStateBody, InputBody } from './protocol.ts';
import { isHidden } from './protocol.ts';
import type { GameLog } from './log.ts';
import { cardIndex } from './decisions.ts';
import { visibleName } from './review.ts';
import { TOKEN_HEADER, type HelperTarget } from './coachHelper.ts';
import { ROOM_TOKEN_HEADER, seatRoomUrl, type SeatHandle } from './play/friendReview.ts';
import { cleanText, int, num } from './lab/status.ts';

export type HintKind = 'spell' | 'attack' | 'block' | 'target';
export type HintStatus = 'ok' | 'trivial' | 'unsupported';
/** `clear`: every other option is worse (the interval excludes zero); `close`: a tie or a close call; `only`: one legal choice. */
export type HintStrength = 'clear' | 'close' | 'only';
export type HintVerdict = 'best' | 'tie' | 'close' | 'worse' | 'not-graded';
export type HintKnowledge = 'pool' | 'deck' | 'basic-lands';

export interface HintOption {
  token: string;
  label: string;
  verdict: HintVerdict | null;
  winRate: number | null;
  /** Other tokens that are the same choice (another copy of a card). */
  same: string[];
}

export interface SearchHint {
  status: HintStatus;
  type: HintKind | null;
  pick: string | null;
  strength: HintStrength | null;
  runnerUp: string | null;
  /** The land the engine plays first in every option (the land drop is open). */
  landFirst: number | null;
  options: HintOption[];
  knowledge: HintKnowledge;
  measure: 'leaf' | 'wins';
  stateSeq: number;
  /** Why there is no pick (`unsupported`), in the engine's words. */
  message: string | null;
  ms: number | null;
  /** The budget this hint ran under (ms), when the engine says. */
  budgetMs: number | null;
}

export interface HintRequest {
  gameId: string;
  seat: number;
  stateSeq: number;
  inputSeq?: number;
  oppPool?: [number, string][];
  oppKnown?: string[];
  budgetMs?: number;
}

export interface HintRefused {
  ok: false;
  /** HTTP status, or 0 when the helper could not be reached or answered nonsense. */
  status: number;
  /**
   * `superseded`: a newer hint replaced this one (say nothing); `moved-on`: the game went on; `off`: the
   * room's computer gives no hints (a helper from before mtg-table D453, or without the hint) — not an error.
   */
  code: 'superseded' | 'moved-on' | 'not-yet' | 'off' | null;
  message: string;
}

export type HintFetch = (url: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;
const defaultFetch: HintFetch = (u, i) => fetch(u, i);

// ---------------------------------------------------------------------------
// Is there a hint to ask for?

/** Does this /health body say the helper gives search hints (`hint: 1`)? */
export function helperHintAvailable(health: unknown): boolean {
  return typeof health === 'object' && health !== null && (health as { hint?: unknown }).hint === 1;
}

function headers(t: HelperTarget, json: boolean): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h['Content-Type'] = 'application/json';
  if (t.token) h[TOKEN_HEADER] = t.token;
  return h;
}

export interface HintInfo {
  available: boolean;
  /** `/health` `hintEngine`: `idle` / `starting` (the first hint waits ~10 s for it) / `ready`; null when not said. */
  engine: 'idle' | 'starting' | 'ready' | null;
  /** `/health` `hintBudgetMs.default`: how long a hint looks, when said. */
  budgetMs: number | null;
}

/** What /health says about hints (never throws). */
export function hintInfoOf(health: unknown): HintInfo {
  const h = (health && typeof health === 'object' ? health : {}) as Record<string, unknown>;
  const e = h.hintEngine;
  const b = h.hintBudgetMs && typeof h.hintBudgetMs === 'object' ? (h.hintBudgetMs as Record<string, unknown>).default : null;
  return { available: helperHintAvailable(health), engine: e === 'idle' || e === 'starting' || e === 'ready' ? e : null, budgetMs: int(b, 100, 60_000) };
}

/** GET /health and read the hint fields (never throws; not available when the helper is not there). */
export async function hintInfo(target: HelperTarget, f: HintFetch = defaultFetch, timeoutMs = 1500): Promise<HintInfo> {
  const c = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = c ? setTimeout(() => c.abort(), timeoutMs) : null;
  try {
    const res = await f(`${target.baseUrl}/health`, { method: 'GET', headers: headers(target, false), ...(c ? { signal: c.signal } : {}), cache: 'no-store' });
    return hintInfoOf(await res.json());
  } catch {
    return { available: false, engine: null, budgetMs: null };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** At a table of two: the hint is off on the room's computer (or the room is from before mtg-table D453). */
export const HINT_OFF_TABLE = 'The search AI isn’t offered at this table: the engine on the room’s PC doesn’t give hints yet (it needs the latest ForgeCoach there).';

/** What a room's state says about hints (mtg-table D453: `hint: 1`); the room says nothing of its engine's start. */
export function roomHintInfoOf(state: unknown): HintInfo {
  return { available: helperHintAvailable(state), engine: null, budgetMs: null };
}

/** GET /room/<id> with this seat's token and read `hint` (never throws; not available when the room cannot be read). */
export async function roomHintInfo(room: SeatHandle, f: HintFetch = defaultFetch, timeoutMs = 4000): Promise<HintInfo> {
  const c = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = c ? setTimeout(() => c.abort(), timeoutMs) : null;
  try {
    const res = await f(seatRoomUrl(room, ''), { method: 'GET', headers: { [ROOM_TOKEN_HEADER]: room.token }, ...(c ? { signal: c.signal } : {}), cache: 'no-store' });
    if (!res.ok) return { available: false, engine: null, budgetMs: null };
    return roomHintInfoOf(await res.json());
  } catch {
    return { available: false, engine: null, budgetMs: null };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** GET /health and read `hint` (never throws; false when the helper is not there). */
export async function hintSupported(target: HelperTarget, f: HintFetch = defaultFetch, timeoutMs = 1500): Promise<boolean> {
  const c = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = c ? setTimeout(() => c.abort(), timeoutMs) : null;
  try {
    const res = await f(`${target.baseUrl}/health`, { method: 'GET', headers: headers(target, false), ...(c ? { signal: c.signal } : {}), cache: 'no-store' });
    return helperHintAvailable(await res.json());
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const TARGET_LINE = /\btargets?\b/i;

/**
 * The kind of decision the open input asks this seat for, by the engine's own
 * rule (mtg-table Review.kindOf): the attack prompt, the block prompt, a target
 * prompt, or a priority prompt in your own main phase with an empty stack.
 * Null for anything else — the search hint is not offered there.
 */
export function hintKindOf(state: GameStateBody | null, input: InputBody | null, seat: number | null): HintKind | null {
  if (!state || !input || seat === null || !state.phase || !(state.turn > 0)) return null;
  const prompt = String(input.prompt ?? '').trim();
  if (prompt.startsWith('Select creatures to attack')) return 'attack';
  if (prompt.startsWith('Select creatures to block')) return 'block';
  const sel = input.selectable;
  const priority = /^priority:/i.test(prompt);
  if (sel && sel.mode !== 'none' && !(sel.mode === 'cards' && !sel.cardIds.length) && !priority) {
    const lines = prompt.split('\n').filter((l) => l.trim());
    if (TARGET_LINE.test(lines[lines.length - 1] ?? '')) return 'target';
  }
  if (priority && (state.phase === 'MAIN1' || state.phase === 'MAIN2') && state.activePlayer === seat && !(state.stack ?? []).length) return 'spell';
  return null;
}

/** The moment the board shows: the seq of the newest state and of the newest input the engine sent. */
export function hintMoment(log: GameLog | null): { stateSeq: number; inputSeq: number | null } | null {
  if (!log) return null;
  let stateSeq: number | null = null;
  let inputSeq: number | null = null;
  for (let i = log.frames.length - 1; i >= 0 && (stateSeq === null || inputSeq === null); i--) {
    const f = log.frames[i]!;
    if (f.dir === 'c2s') continue;
    if (f.type === 'state' && stateSeq === null) stateSeq = f.seq;
    if (f.type === 'input' && inputSeq === null) inputSeq = f.seq;
  }
  return stateSeq !== null && stateSeq > 0 ? { stateSeq, inputSeq: inputSeq !== null && inputSeq > 0 ? inputSeq : null } : null;
}

/**
 * Which decision a hint answers: the same one while it stays open (clicking
 * attackers or blockers one by one keeps it: the wire says nothing until you
 * confirm), a new one when the kind, turn, phase or target prompt changes —
 * and, in a main phase, whenever the board does (a land played, a spell
 * resolved: `stateSeq`). The answer on screen is dropped when this changes.
 */
export function hintDecisionKey(state: GameStateBody | null, input: InputBody | null, seat: number | null, stateSeq: number | null = null): string | null {
  const kind = hintKindOf(state, input, seat);
  if (!kind || !state) return null;
  const extra = kind === 'target' ? String(input?.prompt ?? '') : kind === 'spell' ? String(stateSeq ?? '') : '';
  return `${state.gameId}|${state.turn}|${state.phase}|${kind}|${extra}`;
}

// ---------------------------------------------------------------------------
// Asking

const GAME_ID = /^[A-Za-z0-9._-]{1,100}$/;
const TOKEN = /^(pass|attack:none|block:none|(cast|land|target):\d+|target:player\d+|attack:\d+(,\d+)*|block:\d+>\d+(,\d+>\d+)*)$/;
const VERDICTS: readonly HintVerdict[] = ['best', 'tie', 'close', 'worse', 'not-graded'];

export class HintError extends Error {}

/** The helper's answer, checked: a pick only in the vocabulary, a strength only from the three words. */
export function parseHint(raw: unknown): SearchHint {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HintError('not an object');
  const b = raw as Record<string, unknown>;
  if (b.ok !== true || b.kind !== 'search-hint') throw new HintError('not a search hint');
  const status = b.status === 'ok' || b.status === 'trivial' || b.status === 'unsupported' ? b.status : null;
  if (!status) throw new HintError(`unknown status ${String(b.status)}`);
  const tok = (v: unknown): string | null => (typeof v === 'string' && TOKEN.test(v) ? v : null);
  const options: HintOption[] = [];
  if (Array.isArray(b.options)) {
    for (const o of b.options.slice(0, 64)) {
      if (!o || typeof o !== 'object') continue;
      const r = o as Record<string, unknown>;
      const token = tok(r.token);
      if (!token) continue;
      options.push({
        token,
        label: cleanText(r.label, 200) ?? token,
        verdict: typeof r.verdict === 'string' && (VERDICTS as readonly string[]).includes(r.verdict) ? (r.verdict as HintVerdict) : null,
        winRate: num(r.winRate, 0, 1),
        same: Array.isArray(r.same) ? r.same.map(tok).filter((x): x is string => !!x).slice(0, 16) : [],
      });
    }
  }
  const pick = tok(b.pick);
  const strength = b.strength === 'clear' || b.strength === 'close' || b.strength === 'only' ? b.strength : null;
  if (status !== 'unsupported' && (!pick || !strength)) throw new HintError('an answer without a pick');
  // A "close" pick names its runner-up; a "clear" or "only" one never does.
  const runnerUp = strength === 'close' ? tok(b.runnerUp) : null;
  const k = (b.knowledge && typeof b.knowledge === 'object' ? (b.knowledge as Record<string, unknown>).opponentModel : null) as unknown;
  const knowledge: HintKnowledge = k === 'pool' ? 'pool' : k === 'deck' ? 'deck' : 'basic-lands';
  const type = b.type === 'spell' || b.type === 'attack' || b.type === 'block' || b.type === 'target' ? b.type : null;
  return {
    status,
    type,
    pick: status === 'unsupported' ? null : pick,
    strength: status === 'unsupported' ? null : strength,
    runnerUp,
    landFirst: int(b.landFirst, 0, 1e9),
    options,
    knowledge,
    measure: b.measure === 'wins' ? 'wins' : 'leaf',
    stateSeq: int(b.stateSeq, 0, 2 ** 31) ?? 0,
    message: cleanText(b.message, 300),
    ms: int(b.wallMs, 0, 600_000),
    budgetMs: int(b.budgetMs, 0, 600_000),
  };
}

const UNREACHABLE = 'Couldn’t reach the engine on your PC: start ForgeCoach again (the app-menu launcher, or ./scripts/play.sh).';
const ROOM_UNREACHABLE = 'Couldn’t reach the room’s PC for a hint — try again in a moment.';
const STATUS_WORDS: Record<number, string> = {
  403: 'The engine on your PC won’t give a hint for this game.',
  404: 'The engine on your PC has no log of this game.',
  429: 'The engine is busy with another hint — try again in a few seconds.',
  503: 'Search hints are off on your PC (the bridge is not built).',
  504: 'The search AI took too long and was stopped — try again.',
};

const ROOM_STATUS_WORDS: Record<number, string> = {
  403: 'This seat’s room link no longer works — open the room again.',
  429: 'Too many hints at once — try again in a few seconds.',
  504: 'The search AI took too long and was stopped — try again.',
};

/** POST /hint. Never throws: a hint, or why not. */
export async function askHint(target: HelperTarget, req: HintRequest, f: HintFetch = defaultFetch, signal?: AbortSignal): Promise<SearchHint | HintRefused> {
  if (!GAME_ID.test(req.gameId) || req.gameId.includes('..')) return { ok: false, status: 0, code: null, message: 'This game has no id the engine can look up.' };
  const body: Record<string, unknown> = { gameId: req.gameId, seat: req.seat, stateSeq: req.stateSeq };
  for (const k of ['inputSeq', 'oppPool', 'oppKnown', 'budgetMs'] as const) if (req[k] !== undefined) body[k] = req[k];
  return postHint(`${target.baseUrl}/hint`, headers(target, true), body, f, signal, false);
}

/** A table's game id the room knows (`friend-m<13 digits>`, or a seat's log of it); anything else is not sent. */
const TABLE_GAME_ID = /^friend-m[0-9]{13}(-seat[01])?$/;

/** POST /room/<id>/hint (mtg-table D453) — at a table of two. */
export interface RoomHintRequest {
  /** Sent only when it is a table's game id: the room checks it is the game it plays now. */
  gameId?: string | null;
  seat: number;
  stateSeq: number;
  inputSeq?: number;
  budgetMs?: number;
}

/**
 * POST /room/<id>/hint: this seat's hint at a table of two, from the room behind this seat's token. No pool,
 * never a deck: the room models the friend's hidden cards itself. Never throws: a hint, or why not — an
 * old room (404) or one without hints (503) is `code: "off"`.
 */
export async function askRoomHint(room: SeatHandle, req: RoomHintRequest, f: HintFetch = defaultFetch, signal?: AbortSignal): Promise<SearchHint | HintRefused> {
  const body: Record<string, unknown> = { seat: req.seat, stateSeq: req.stateSeq };
  if (typeof req.gameId === 'string' && TABLE_GAME_ID.test(req.gameId)) body.gameId = req.gameId;
  for (const k of ['inputSeq', 'budgetMs'] as const) if (req[k] !== undefined) body[k] = req[k];
  return postHint(seatRoomUrl(room, '/hint'), { 'Content-Type': 'application/json', [ROOM_TOKEN_HEADER]: room.token }, body, f, signal, true);
}

async function postHint(url: string, hdrs: Record<string, string>, body: Record<string, unknown>, f: HintFetch, signal: AbortSignal | undefined, room: boolean): Promise<SearchHint | HintRefused> {
  let res: Pick<Response, 'ok' | 'status' | 'json'>;
  try {
    res = await f(url, { method: 'POST', headers: hdrs, body: JSON.stringify(body), ...(signal ? { signal } : {}) });
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    return { ok: false, status: 0, code: aborted ? 'superseded' : null, message: aborted ? 'Cancelled.' : room ? ROOM_UNREACHABLE : UNREACHABLE };
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* no body */
  }
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  if (!res.ok) {
    if (room) {
      // The room's own refusals (D453): an old room has no route (404), one without hints says off (503).
      if (res.status === 404 || res.status === 503 || d.code === 'off') return { ok: false, status: res.status, code: 'off', message: HINT_OFF_TABLE };
      if (d.code === 'game') return { ok: false, status: res.status, code: 'moved-on', message: 'The game moved on before the search AI finished.' };
      if (d.code === 'no-game') return { ok: false, status: res.status, code: null, message: 'No game is being played in the room right now.' };
    }
    const code = d.code === 'superseded' || d.code === 'moved-on' || d.code === 'not-yet' ? d.code : null;
    if (code === 'moved-on' || code === 'not-yet') return { ok: false, status: res.status, code, message: 'The game moved on before the search AI finished.' };
    if (code === 'superseded') return { ok: false, status: res.status, code, message: '' };
    if (room) return { ok: false, status: res.status, code: null, message: ROOM_STATUS_WORDS[res.status] ?? cleanText(d.message, 300) ?? `The room’s PC answered HTTP ${res.status}.` };
    return { ok: false, status: res.status, code: null, message: STATUS_WORDS[res.status] ?? cleanText(d.message, 300) ?? `The engine on your PC answered HTTP ${res.status}.` };
  }
  try {
    return parseHint(data);
  } catch (e) {
    return { ok: false, status: 0, code: null, message: `The engine’s answer could not be read (${e instanceof Error ? e.message : String(e)}).` };
  }
}

export function isRefused(r: SearchHint | HintRefused): r is HintRefused {
  return (r as HintRefused).ok === false;
}

// ---------------------------------------------------------------------------
// Words

/**
 * A name for each card id in the state the board shows — "your" / "their" in
 * front when both sides have a card of that name — or null for one you cannot
 * see. Never an id: identical cards are counted where they are listed.
 */
function namesIn(state: GameStateBody | null, seat: number | null): (id: number) => string | null {
  const ids: Map<number, AnyCard> = state ? cardIndex(state) : new Map();
  const sides = new Map<string, Set<number | null>>();
  for (const c of ids.values()) {
    const n = isHidden(c) ? null : visibleName(c);
    if (!n) continue;
    if (!sides.has(n)) sides.set(n, new Set());
    sides.get(n)!.add((c as Card).controller ?? null);
  }
  return (id) => {
    const c = ids.get(id);
    const n = c && !isHidden(c) ? visibleName(c) : null;
    if (!c || !n) return null;
    const o = (c as Card).controller ?? null;
    return (sides.get(n)?.size ?? 0) > 1 && seat !== null && o !== null ? `${o === seat ? 'your' : 'their'} ${n}` : n;
  };
}

function plural(name: string, n: number): string {
  if (n === 1) return name;
  return `${n} × ${name}`;
}

function joinWords(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** Names of several ids, identical ones counted ("2 × Soldier Token"), never an id. */
function groupNames(ids: number[], name: (id: number) => string | null): string {
  const counts = new Map<string, number>();
  for (const id of ids) {
    const n = name(id) ?? 'a card you can’t see';
    counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  return joinWords([...counts.entries()].map(([n, k]) => plural(n, k)));
}

/**
 * A choice in board words, from the state the board shows: "Cast Shock",
 * "Attack with Grizzly Bears and Hill Giant", "Block Goblin Guide with
 * Memnite", "Target Forge AI", "Cast nothing now". Never an engine id.
 */
export function hintChoiceWords(tok: string, state: GameStateBody | null, seat: number | null): string {
  const name = namesIn(state, seat);
  if (tok === 'pass') return 'Cast nothing now';
  if (tok === 'attack:none') return 'Don’t attack';
  if (tok === 'block:none') return 'Don’t block';
  let m = /^(cast|land):(\d+)$/.exec(tok);
  if (m) return `${m[1] === 'cast' ? 'Cast' : 'Play'} ${name(Number(m[2])) ?? 'a card'}`;
  m = /^target:(player)?(\d+)$/.exec(tok);
  if (m) {
    const id = Number(m[2]);
    const card = m[1] ? null : name(id);
    if (card) return `Target ${card}`;
    const p = state?.players.find((x) => x.id === id);
    if (p) return p.id === seat ? 'Target yourself' : `Target ${p.name}`;
    return 'Target that';
  }
  m = /^attack:(\d+(?:,\d+)*)$/.exec(tok);
  if (m) return `Attack with ${groupNames(m[1]!.split(',').map(Number), name)}`;
  m = /^block:(\d+>\d+(?:,\d+>\d+)*)$/.exec(tok);
  if (m) {
    // Grouped by attacker: "Block Goblin Guide with Memnite and Raging Goblin".
    const by = new Map<number, number[]>();
    for (const pair of m[1]!.split(',')) {
      const [b, a] = pair.split('>').map(Number) as [number, number];
      by.set(a, [...(by.get(a) ?? []), b]);
    }
    return `Block ${[...by.entries()].map(([a, bs]) => `${name(a) ?? 'an attacker'} with ${groupNames(bs, name)}`).join('; ')}`;
  }
  return 'Another choice';
}

/** Lower-case the first letter (after "or"), keeping a card name's capitals. */
function lowerFirst(s: string): string {
  return s.replace(/^(Cast|Play|Attack|Block|Target|Don’t) /, (w) => w.toLowerCase());
}

export const STRENGTH_WORDS: Record<HintStrength, string> = {
  clear: 'clearly best',
  close: 'too close to call',
  only: 'the only choice',
};

export interface HintWords {
  /** "Attack with Grizzly Bears and Hill Giant" / "Cast Shock or cast nothing now". */
  line: string;
  /** "clearly best" / "too close to call" / "the only choice", or null (no pick). */
  strength: string | null;
  /** The one-line caveat: what it knows. */
  caveat: string;
  /** The caveat with how far it looks (a title). */
  caveatLong: string;
}

/**
 * The caveat, one line: it knows only what you know, and what it assumed about
 * the bot's hidden cards. `long` adds how far it looks (the line's title).
 */
export function hintCaveat(h: Pick<SearchHint, 'knowledge' | 'measure'>, long = false): string {
  const short = h.knowledge === 'pool' ? 'hidden cards from the cube' : h.knowledge === 'deck' ? 'the shared deck lists' : 'hidden cards as lands';
  if (!long) return `Knows only what you know (${short}).`;
  const hidden = h.knowledge === 'pool' ? 'the bot’s hidden cards are guessed from the cube' : h.knowledge === 'deck' ? 'it uses the deck lists you both shared' : 'the bot’s hidden cards are treated as lands, so it may be too hopeful';
  const horizon = h.measure === 'leaf' ? 'It plays the decision out to the end of this turn, for a few seconds on your PC' : 'It plays the decision out to the end of the game';
  return `Knows only what you know: ${hidden}. ${horizon}; “too close to call” means it could not tell the choices apart.`;
}

/** The hint in the board's words. */
export function hintWords(h: SearchHint, state: GameStateBody | null, seat: number | null): HintWords {
  const caveat = hintCaveat(h);
  const caveatLong = hintCaveat(h, true);
  if (h.status === 'unsupported' || !h.pick || !h.strength) {
    return { line: 'The search AI can’t judge this decision.', strength: null, caveat, caveatLong };
  }
  let line = hintChoiceWords(h.pick, state, seat);
  if (h.strength === 'close' && h.runnerUp) line = `${line}, or ${lowerFirst(hintChoiceWords(h.runnerUp, state, seat))}`;
  if (h.landFirst !== null && h.type === 'spell') {
    const land = namesIn(state, seat)(h.landFirst);
    if (land) line = `Play ${land} first, then: ${lowerFirst(line)}`;
  }
  return { line, strength: STRENGTH_WORDS[h.strength], caveat, caveatLong };
}

/** Card ids the pick names, for highlighting on the board (your cards and the attackers they meet). */
export function hintCardIds(h: SearchHint | null): number[] {
  if (!h || !h.pick) return [];
  const m = /^(?:cast|land|target|attack|block):([\d,>]+)$/.exec(h.pick);
  const ids = m ? m[1]!.split(/[,>]/).filter(Boolean).map(Number) : [];
  if (h.landFirst !== null) ids.push(h.landFirst);
  return [...new Set(ids)];
}
