/*
 * ForgeCoach — draft/draft.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The two two-player drafts, one decision at a time, so a person can sit in
 * one seat and the cube lab's drafting AI in the other. The rules and the AI
 * are ported from mtg-table's cube lab (tools/cubelab/draft.ts,
 * GPL-3.0-or-later, Copyright (C) 2026 mtg-table contributors; see NOTICE);
 * the lab runs a whole draft in one call, this module steps it so the page can
 * show each pick, save after each one and resume after a refresh.
 *
 * GRID: shuffle the cube, deal 162 cards into 18 grids of 3x3, face up. For
 * each grid the first drafter takes a row or a column, the second takes a
 * remaining row or column (3 cards if parallel to the first, 2 if it crosses
 * it), and the rest is discarded. The first pick alternates grid by grid.
 *
 * WINSTON: shuffle the cube and take 90 cards as a face-down stack; deal three
 * one-card piles. On a turn the drafter looks at pile 1 and takes it or passes
 * it; passing adds the stack's top card to that pile, and the drafter looks at
 * pile 2, then pile 3. A taken pile is replaced by one card from the stack.
 * Passing all three takes the stack's top card blind. When the stack is empty
 * the last non-empty pile looked at must be taken (and if every pile was
 * passed once the stack ran out mid-turn, the biggest is taken).
 *
 * BOOSTER: three packs of 15 per seat from the shuffled cube (smaller packs
 * when the cube can't fill them for 6 or 8 seats); everyone takes one card
 * at once and passes the rest, left for packs 1 and 3, right for pack 2. You
 * sit at seat 0, the AI you will play at seat 1, and any extra seats are more
 * of the same AI. The lab has no booster mode; its pick scorer works per pick,
 * so each bot takes the card it scores highest.
 *
 * State is plain JSON (card names, not objects) so it can live in
 * localStorage. It holds everything, the AI's picks included; what the PLAYER
 * may see is the page's job: `knownAiCards` is the hidden-information rule.
 */
import { rng, shuffle } from './rng.ts';
import type { LabCard } from './cards.ts';
import { scoreCard, setValue, type DrafterState } from './pick.ts';
import { DEFAULT_WEIGHTS, type Weights } from './weights.ts';

export type Side = 'you' | 'ai';
export type Format = 'grid' | 'winston' | 'booster';

export const GRID_ROUNDS = 18;
export const WINSTON_CARDS = 90;
export const BOOSTER_PACKS = 3;
export const BOOSTER_SIZE = 15;
export const SEAT_OPTIONS = [2, 4, 6, 8] as const;

/** Cards per pack for `seats` drafters from a cube of `cubeSize` (15, or fewer when the cube runs short). */
export function boosterPackSize(seats: number, cubeSize: number, packs = BOOSTER_PACKS, size = BOOSTER_SIZE): number {
  return Math.max(1, Math.min(size, Math.floor(cubeSize / (seats * packs))));
}

/** Rows 0-2, columns 3-5 (the lab's numbering); src/cube/pick.ts GRID_LINES uses the same order. */
export const LINES: number[][] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
];
export const lineName = (l: number): string => (l < 3 ? ['top row', 'middle row', 'bottom row'][l]! : ['left column', 'middle column', 'right column'][l - 3]!);

export interface DraftEvent {
  /** 1-based, over the whole draft. */
  n: number;
  who: Side;
  kind: 'line' | 'take' | 'pass' | 'blind' | 'forced' | 'pick';
  /** Grid: which grid (1-based). Winston: which pile (1-3), 0 for the blind card. Booster: the pick number (1-based, whole draft). */
  at: number;
  /** Grid: the line taken (0-5). */
  line?: number;
  /** Cards taken (empty for a pass). The AI's Winston takes are secret: read `known`. */
  cards: string[];
  /** For an AI take: the cards of it the player had seen (in a pile they looked at). */
  known?: string[];
  /** Winston pass: the pile's size after the stack's card was added. */
  size?: number;
}

interface Base {
  v: 1;
  id: string;
  cubeId: string;
  seed: number;
  /** The player opens (picks first in grid 1, takes the first Winston turn). */
  youFirst: boolean;
  /** Every card in play (dealt to grids, or the Winston stack). */
  dealt: string[];
  picks: Record<Side, string[]>;
  /** Cards each drafter has looked at. */
  seen: Record<Side, string[]>;
  log: DraftEvent[];
  done: boolean;
  startedAt: number;
  updatedAt: number;
}

export interface GridDraft extends Base {
  format: 'grid';
  grids: number;
  /** The grid being drafted, 0-based. */
  g: number;
  slots: Array<string | null>;
  /** The line the first drafter took in this grid, once taken. */
  firstLine: number | null;
}

export interface WinstonDraft extends Base {
  format: 'winston';
  /** Face down; the last element is the top. */
  stack: string[];
  piles: [string[], string[], string[]];
  turn: Side;
  /** The pile being looked at (0-2). */
  look: number;
  /** The AI's expectation of a blind card, fixed at the start of its turn (as in the lab). */
  aiBlind: number | null;
}

export interface BoosterDraft extends Base {
  format: 'booster';
  seats: number;
  packs: number;
  packSize: number;
  /** The pack being drafted (0-based) and the pick within it (0-based). */
  round: number;
  pick: number;
  /** The pack in front of each seat (seat 0 is you, seat 1 the AI). */
  table: string[][];
  /** Picks of seats 2 and up (more bots); seats 0 and 1 are `picks.you` / `picks.ai`. */
  bots: string[][];
}

export type Draft = GridDraft | WinstonDraft | BoosterDraft;

export type DraftAction = { kind: 'line'; line: number } | { kind: 'take' } | { kind: 'pass' } | { kind: 'pick'; card: string };

export interface NewDraft {
  cubeId: string;
  format: Format;
  /** The cube's card names, in document order. */
  cube: string[];
  seed: number;
  youFirst: boolean;
  /** Grid rounds (18) or Winston stack size (90). */
  size?: number;
  /** Booster: drafters at the table (2, 4, 6 or 8). */
  seats?: number;
  now?: number;
}

const other = (s: Side): Side => (s === 'you' ? 'ai' : 'you');

export function newDraft(o: NewDraft): Draft {
  const names = [...new Set(o.cube)];
  const r = rng(o.seed, o.format);
  const deck = shuffle(names, r);
  const now = o.now ?? Date.now();
  const base = {
    v: 1 as const,
    id: `draft-${o.seed.toString(36)}-${now.toString(36)}`,
    cubeId: o.cubeId,
    seed: o.seed,
    youFirst: o.youFirst,
    picks: { you: [], ai: [] },
    seen: { you: [], ai: [] },
    log: [],
    done: false,
    startedAt: now,
    updatedAt: now,
  };
  if (o.format === 'booster') {
    const seats = Math.max(2, Math.min(8, o.seats ?? 2));
    const packSize = boosterPackSize(seats, deck.length);
    const dealt = deck.slice(0, seats * BOOSTER_PACKS * packSize);
    const d: BoosterDraft = { ...base, format: 'booster', dealt, seats, packs: BOOSTER_PACKS, packSize, round: 0, pick: 0, table: [], bots: Array.from({ length: seats - 2 }, () => []) };
    d.table = dealRound(d, 0);
    return d;
  }
  if (o.format === 'grid') {
    const grids = Math.min(o.size ?? GRID_ROUNDS, Math.floor(deck.length / 9));
    const dealt = deck.slice(0, grids * 9);
    return { ...base, format: 'grid', dealt, grids, g: 0, slots: dealt.slice(0, 9), firstLine: null, done: grids === 0 };
  }
  const dealt = deck.slice(0, Math.min(o.size ?? WINSTON_CARDS, deck.length));
  const stack = [...dealt].reverse();
  const piles: [string[], string[], string[]] = [[], [], []];
  for (const p of piles) {
    const c = stack.pop();
    if (c) p.push(c);
  }
  const d: WinstonDraft = { ...base, format: 'winston', dealt, stack, piles, turn: o.youFirst ? 'you' : 'ai', look: 0, aiBlind: null };
  return settleWinston(d);
}

// ---------------------------------------------------------------------------
// Whose move, what is legal

export function gridFirst(d: GridDraft): Side {
  return (d.g % 2 === 0) === d.youFirst ? 'you' : 'ai';
}

function dealRound(d: BoosterDraft, round: number): string[][] {
  const per = d.packSize;
  const start = round * d.seats * per;
  return Array.from({ length: d.seats }, (_, s) => d.dealt.slice(start + s * per, start + (s + 1) * per));
}

/** Booster: the pack in front of you. */
export const yourPack = (d: BoosterDraft): string[] => d.table[0] ?? [];

/** Who decides next (null when the draft is over). Booster: always you (the bots pick with you). */
export function toAct(d: Draft): Side | null {
  if (d.done) return null;
  if (d.format === 'booster') return 'you';
  if (d.format === 'grid') return d.firstLine === null ? gridFirst(d) : other(gridFirst(d));
  return d.turn;
}

export function lineCards(slots: Array<string | null>, l: number): string[] {
  return (LINES[l] ?? []).map((i) => slots[i]).filter((c): c is string => c != null);
}

/** Grid lines that may be taken now. */
export function legalLines(d: GridDraft): number[] {
  const out: number[] = [];
  for (let l = 0; l < 6; l++) if (l !== d.firstLine && lineCards(d.slots, l).length > 0) out.push(l);
  return out;
}

/** Winston: may the drafter pass the pile in front of them? Not when the stack is empty and no later pile has cards. */
export function canPass(d: WinstonDraft): boolean {
  if (d.done) return false;
  const laterEmpty = d.piles.slice(d.look + 1).every((p) => p.length === 0);
  return !(d.stack.length === 0 && laterEmpty);
}

export function isLegal(d: Draft, a: DraftAction): boolean {
  if (d.done) return false;
  if (d.format === 'grid') return a.kind === 'line' && legalLines(d).includes(a.line);
  if (d.format === 'booster') return a.kind === 'pick' && yourPack(d).includes(a.card);
  if (a.kind === 'take') return (d.piles[d.look]?.length ?? 0) > 0;
  if (a.kind === 'pass') return canPass(d);
  return false;
}

// ---------------------------------------------------------------------------
// Applying a decision

function clone(d: Draft): Draft {
  return JSON.parse(JSON.stringify(d)) as Draft;
}

function addSeen(d: Draft, who: Side, cards: string[]) {
  const s = new Set(d.seen[who]);
  for (const c of cards) if (!s.has(c)) d.seen[who].push(c);
}

function push(d: Draft, e: Omit<DraftEvent, 'n'>) {
  d.log.push({ n: d.log.length + 1, ...e });
}

/**
 * The draft after `a` by whoever is to act. Throws on an illegal action.
 * Booster needs `botCards` (the AI's view of the cube): the bots pick with you.
 */
export function apply(d0: Draft, a: DraftAction, now = Date.now(), botCards?: Map<string, LabCard>, w: Weights = DEFAULT_WEIGHTS): Draft {
  if (d0.format === 'booster' && !botCards) throw new Error('a booster pick needs the AI’s card data');
  bw = w;
  if (!isLegal(d0, a)) throw new Error(`illegal ${a.kind}${a.kind === 'line' ? ` ${a.line}` : ''} in this ${d0.format} draft`);
  const d = clone(d0);
  d.updatedAt = now;
  const who = toAct(d) as Side;
  if (d.format === 'grid' && a.kind === 'line') {
    addSeen(d, who, d.slots.filter((c): c is string => c != null));
    const cards = lineCards(d.slots, a.line);
    d.picks[who].push(...cards);
    for (const i of LINES[a.line] ?? []) d.slots[i] = null;
    push(d, { who, kind: 'line', at: d.g + 1, line: a.line, cards });
    if (d.firstLine === null) d.firstLine = a.line;
    else {
      d.g++;
      d.firstLine = null;
      if (d.g >= d.grids) {
        d.done = true;
        d.slots = Array(9).fill(null);
      } else d.slots = d.dealt.slice(d.g * 9, d.g * 9 + 9);
    }
    return d;
  }
  if (d.format === 'booster' && a.kind === 'pick') return boosterPick(d, a.card, botCards);
  if (d.format !== 'winston') return d;
  const i = d.look;
  const pile = d.piles[i] as string[];
  addSeen(d, who, pile);
  if (a.kind === 'take') {
    takePile(d, who, i, 'take');
    return endTurn(d);
  }
  // pass
  const c = d.stack.pop();
  if (c) pile.push(c);
  push(d, { who, kind: 'pass', at: i + 1, cards: [], size: pile.length });
  const next = d.piles.findIndex((p, k) => k > i && p.length > 0);
  if (next >= 0) {
    d.look = next;
    return d;
  }
  // Every pile passed.
  const top = d.stack.pop();
  if (top) {
    addSeen(d, who, [top]);
    d.picks[who].push(top);
    push(d, { who, kind: 'blind', at: 0, cards: [top], known: who === 'ai' ? [] : undefined });
  } else {
    let bi = i;
    for (let k = 0; k < 3; k++) if ((d.piles[k]?.length ?? 0) > (d.piles[bi]?.length ?? 0)) bi = k;
    if ((d.piles[bi]?.length ?? 0) > 0) takePile(d, who, bi, 'forced');
  }
  return endTurn(d);
}

let bw: Weights = DEFAULT_WEIGHTS;

/** The card a bot takes from `pack`: the one the lab's scorer rates highest for its picks. */
export function botPick(pack: string[], picks: string[], expected: number, cards: Map<string, LabCard>, w: Weights = DEFAULT_WEIGHTS): string {
  const st: DrafterState = { picks: picks.map((n) => cards.get(n)).filter((c): c is LabCard => !!c), expected };
  let best = pack[0] as string;
  let bv = -Infinity;
  for (const n of pack) {
    const c = cards.get(n);
    const v = c ? scoreCard(c, st, w).total : -Infinity;
    if (v > bv || (v === bv && n < best)) {
      bv = v;
      best = n;
    }
  }
  return best;
}

function boosterPick(d: BoosterDraft, card: string, cards: Map<string, LabCard> | undefined): BoosterDraft {
  const n = d.round * d.packSize + d.pick + 1;
  const expected = d.packs * d.packSize;
  const pack0 = d.table[0] as string[];
  addSeen(d, 'you', pack0);
  const youSaw = new Set(d.seen.you);
  // Everyone picks at once.
  for (let s = 0; s < d.seats; s++) {
    const pack = d.table[s] as string[];
    if (!pack.length) continue;
    let c: string;
    if (s === 0) c = card;
    else {
      const picks = s === 1 ? d.picks.ai : (d.bots[s - 2] as string[]);
      c = botPick(pack, picks, expected, cards as Map<string, LabCard>, bw);
      if (s === 1) addSeen(d, 'ai', pack);
    }
    pack.splice(pack.indexOf(c), 1);
    if (s === 0) {
      d.picks.you.push(c);
      push(d, { who: 'you', kind: 'pick', at: n, cards: [c] });
    } else if (s === 1) {
      d.picks.ai.push(c);
      push(d, { who: 'ai', kind: 'pick', at: n, cards: [c], known: youSaw.has(c) ? [c] : [] });
    } else (d.bots[s - 2] as string[]).push(c);
  }
  // Pass: left (to the next seat) in packs 1 and 3, right in pack 2.
  const left = d.round % 2 === 0;
  const next: string[][] = Array.from({ length: d.seats }, () => []);
  for (let s = 0; s < d.seats; s++) next[left ? (s + 1) % d.seats : (s - 1 + d.seats) % d.seats] = d.table[s] as string[];
  d.table = next;
  d.pick++;
  if (d.table.every((p) => p.length === 0)) {
    d.round++;
    d.pick = 0;
    if (d.round >= d.packs) d.done = true;
    else d.table = dealRound(d, d.round);
  }
  return d;
}

function takePile(d: WinstonDraft, who: Side, i: number, kind: 'take' | 'forced') {
  const pile = d.piles[i] as string[];
  const youSaw = new Set(d.seen.you);
  d.picks[who].push(...pile);
  push(d, { who, kind, at: i + 1, cards: [...pile], known: who === 'ai' ? pile.filter((c) => youSaw.has(c)) : undefined });
  const c = d.stack.pop();
  d.piles[i] = c ? [c] : [];
}

function endTurn(d: WinstonDraft): WinstonDraft {
  d.turn = other(d.turn);
  d.aiBlind = null;
  return settleWinston(d);
}

/** Point `look` at the first pile with cards; finish the draft, or take a blind card when no pile has any. */
function settleWinston(d: WinstonDraft): WinstonDraft {
  for (let guard = 0; guard < 4; guard++) {
    if (d.stack.length === 0 && d.piles.every((p) => p.length === 0)) {
      d.done = true;
      return d;
    }
    const first = d.piles.findIndex((p) => p.length > 0);
    if (first >= 0) {
      d.look = first;
      return d;
    }
    // No pile to look at: the turn is the blind top card.
    const top = d.stack.pop() as string;
    addSeen(d, d.turn, [top]);
    d.picks[d.turn].push(top);
    push(d, { who: d.turn, kind: 'blind', at: 0, cards: [top], known: d.turn === 'ai' ? [] : undefined });
    d.turn = other(d.turn);
  }
  return d;
}

// ---------------------------------------------------------------------------
// The AI

export function expectedPicks(d: Draft): number {
  if (d.format === 'booster') return d.packs * d.packSize;
  return d.format === 'grid' ? d.grids * 2.5 : d.dealt.length / 2;
}

export function drafterState(d: Draft, side: Side, cards: Map<string, LabCard>): DrafterState {
  return { picks: d.picks[side].map((n) => cards.get(n)).filter((c): c is LabCard => !!c), expected: expectedPicks(d) };
}

/** The drafter's expected value of a blind card: the mean score of the dealt cards it has not seen. */
export function blindExpectation(d: Draft, side: Side, cards: Map<string, LabCard>, w: Weights = DEFAULT_WEIGHTS): number {
  const seen = new Set(d.seen[side]);
  const st = drafterState(d, side, cards);
  let sum = 0;
  let n = 0;
  for (const name of d.dealt) {
    if (seen.has(name)) continue;
    const c = cards.get(name);
    if (!c) continue;
    sum += Math.max(0, scoreCard(c, st, w).total);
    n++;
  }
  return n === 0 ? 0 : sum / n;
}

const lc = (names: string[], cards: Map<string, LabCard>) => names.map((n) => cards.get(n)).filter((c): c is LabCard => !!c);

/** The lab's chooser for whoever is to act (normally the AI; the tests run it for both seats). */
export function aiAction(d: Draft, cards: Map<string, LabCard>, w: Weights = DEFAULT_WEIGHTS): DraftAction {
  const who = toAct(d);
  if (!who) throw new Error('the draft is over');
  const st = drafterState(d, who, cards);
  if (d.format === 'grid') {
    let best = -1;
    let bv = -Infinity;
    for (const l of legalLines(d)) {
      const v = setValue(lc(lineCards(d.slots, l), cards), st, w);
      if (v > bv) {
        bv = v;
        best = l;
      }
    }
    return { kind: 'line', line: best };
  }
  if (d.format === 'booster') return { kind: 'pick', card: botPick(yourPack(d), d.picks.you, expectedPicks(d), cards, w) };
  if (!canPass(d)) return { kind: 'take' };
  const blind = d.aiBlind ?? blindExpectation(d, who, cards, w);
  const margin = [w.winstonMargin1, w.winstonMargin2, w.winstonMargin3][d.look] ?? 0;
  return setValue(lc(d.piles[d.look] ?? [], cards), st, w) >= blind + margin ? { kind: 'take' } : { kind: 'pass' };
}

/**
 * One AI decision, applied. Winston's blind-card value is fixed when the AI's
 * turn starts (the lab computes it once per turn), so it is stored on the
 * state before the first look.
 */
export function aiStep(d: Draft, cards: Map<string, LabCard>, w: Weights = DEFAULT_WEIGHTS, now = Date.now()): Draft {
  let cur = d;
  if (cur.format === 'winston' && cur.aiBlind === null) cur = { ...cur, aiBlind: blindExpectation(cur, cur.turn, cards, w) };
  const next = apply(cur, aiAction(cur, cards, w), now, cards, w);
  return next;
}

/** Run a whole draft with the lab's AI in both seats (the lab's own mode; tests and self-checks). */
export function selfPlay(d: Draft, cards: Map<string, LabCard>, w: Weights = DEFAULT_WEIGHTS): Draft {
  let cur = d;
  for (let guard = 0; !cur.done; guard++) {
    if (guard > 10_000) throw new Error('draft: no progress');
    cur = aiStep(cur, cards, w, cur.updatedAt);
  }
  return cur;
}

// ---------------------------------------------------------------------------
// What the player may know

/**
 * The AI's cards the player knows about: every Grid pick (public); Winston
 * takes and Booster picks only as far as the player had seen the card.
 */
export function knownAiCards(d: Draft): string[] {
  if (d.format === 'grid') return [...d.picks.ai];
  const out: string[] = [];
  for (const e of d.log) if (e.who === 'ai' && e.known) out.push(...e.known);
  return out;
}

/** How many cards the AI holds (always public: you watch it take piles). */
export const aiCount = (d: Draft) => d.picks.ai.length;

/** Progress for headers: "Grid 4 of 18", "Pack 1 · Pick 3", or the cards left in the Winston stack. */
export function progress(d: Draft): { step: number; of: number; label: string } {
  if (d.format === 'booster') {
    const of = d.packs * d.packSize;
    const step = Math.min(of, d.round * d.packSize + d.pick + 1);
    return { step, of, label: d.done ? 'Draft complete' : `Pack ${d.round + 1} · Pick ${d.pick + 1}` };
  }
  if (d.format === 'grid') {
    const step = Math.min(d.grids, d.g + 1);
    return { step, of: d.grids, label: `Grid ${step} of ${d.grids}` };
  }
  const left = d.stack.length;
  return { step: d.dealt.length - left, of: d.dealt.length, label: `${left} card${left === 1 ? '' : 's'} in the stack` };
}

/** The AI events since event number `after`, for the page to play back one beat at a time. */
export function eventsAfter(d: Draft, after: number): DraftEvent[] {
  return d.log.filter((e) => e.n > after);
}

/**
 * One event in words, as the player may know it: the AI's Winston takes say
 * how many cards and only name the ones the player had seen.
 */
export function describeEvent(e: DraftEvent): string {
  const who = e.who === 'you' ? 'You' : 'AI';
  const n = e.cards.length;
  const cards = `${n} card${n === 1 ? '' : 's'}`;
  switch (e.kind) {
    case 'line':
      return `${who} took the ${lineName(e.line ?? 0)} (${cards})`;
    case 'pick':
      return e.who === 'you' ? `You picked ${e.cards[0] ?? ''}` : e.known?.length ? `AI picked ${e.known[0]}` : 'AI picked a card you haven’t seen';
    case 'pass':
      return `${who} passed pile ${e.at}`;
    case 'blind':
      return e.who === 'you' ? `You took the top card blind: ${e.cards[0] ?? ''}` : 'AI took the top card blind';
    case 'take':
    case 'forced': {
      const verb = e.kind === 'forced' ? 'had to take' : 'took';
      if (e.who === 'you') return `You ${verb} pile ${e.at} (${cards})`;
      const known = e.known ?? [];
      return `AI ${verb} pile ${e.at} (${cards})${known.length ? ` — you saw ${known.join(', ')}` : ''}`;
    }
  }
}
