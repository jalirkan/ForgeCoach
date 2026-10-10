/*
 * ForgeCoach — livePlan/mana.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * What the seat's untapped mana can pay, read off the redacted state and the
 * card text. Ported from mtg-table tools/llm-seat (lib/mana.mjs, D419) — its
 * words ("it costs {4}{U} (5 mana) and you have 2 untapped mana sources …")
 * are the ones Sonnet was tested with — plus one thing the seat did not need:
 * a BUDGET that runs through a plan's steps in order, so a second spell is
 * checked against what the first one left (the seat paid as it went; the coach
 * checks before the player does anything).
 *
 * It is a HINT, never the judge: the wire does not predict mana (M61), so
 * anything this cannot read (cost reducers, convoke, delve, alternative costs,
 * X, a land whose text is unknown) is let through, and the engine is the last
 * word when the player carries the step out.
 */
import type { GameStateBody } from '../protocol.ts';
import { hasKeyword, isCreature, isLand, nameOf, playersOf, zoneCards, type LooseCard } from './board.ts';
import { abilityCost } from './parse.ts';
import type { Oracle } from './oracle.ts';

const COLORS = ['W', 'U', 'B', 'R', 'G'] as const;
type Col = 'W' | 'U' | 'B' | 'R' | 'G' | 'C';
const ALL_COLS: readonly Col[] = [...COLORS, 'C'];
const COLOR_WORD: Record<Col, string> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green', C: 'colorless' };
const BASIC_TYPE: Record<string, Col> = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };

export interface Cost {
  mv: number;
  generic: number;
  pips: Record<Col, number>;
  x: number;
  text: string;
}

/** "{2}{U}{U}" -> {mv, generic, pips, x}. Hybrid counts 1 generic; Phyrexian 0 (life can pay). */
export function parseCost(cost: string | null | undefined): Cost {
  const out: Cost = { mv: 0, generic: 0, pips: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, x: 0, text: cost ?? '' };
  for (const m of String(cost ?? '').matchAll(/\{([^}]+)\}/g)) {
    const s = m[1]!.toUpperCase();
    if (/^\d+$/.test(s)) {
      out.generic += Number(s);
      out.mv += Number(s);
    } else if (s === 'X' || s === 'Y') out.x += 1;
    else if (s.includes('/P')) out.mv += 1;
    else if (s.includes('/')) {
      out.generic += 1;
      out.mv += 1;
    } else if (s in out.pips) {
      out.pips[s as Col] += 1;
      out.mv += 1;
    } else if (s === 'S') {
      out.generic += 1;
      out.mv += 1;
    }
  }
  return out;
}

export type Colors = Set<Col> | 'any';

/** The colours an "Add …" clause makes and how much. */
export function addClause(text: string | null): { colors: Colors; amount: number } | null {
  const m = /\bAdd\s+([^.]*)/i.exec(String(text ?? ''));
  if (!m) return null;
  const clause = m[1]!;
  // "Add {W} or one mana of the chosen color" (Thriving lands): the chosen colour is not on the wire
  if (/any colou?r|any type|of any one colou?r|combination of colou?rs|chosen colou?r/i.test(clause)) return { colors: 'any', amount: 1 };
  const first = clause.split(/\s+or\s+/i)[0]!;
  const syms = [...first.matchAll(/\{([WUBRGC])\}/g)].map((x) => x[1]);
  const all = new Set([...clause.matchAll(/\{([WUBRGC])\}/g)].map((x) => x[1] as Col));
  if (all.size === 0) return { colors: 'any', amount: 1 };
  return { colors: all, amount: Math.max(1, syms.length) };
}

const MANA_LINE = /^([^:\n]*\{T\}[^:\n]*):\s*Add\b/i;

/**
 * Does a mana ability's cost need mana ("{1}, {T}: Add one mana of any
 * color", "{W/U}, {T}: Add {W}{W}…")?  A FILTER turns mana into mana: it adds
 * none of its own, and Forge's Auto payment never uses it (mtg-table
 * s2-search-p20-s6: Prophetic Prism, the only white, counted as a seventh mana
 * of any colour; Welcoming Vampire {2}{W} could not be paid).
 */
export const isFilterCost = (cost: string | null | undefined): boolean =>
  (String(cost ?? '').match(/\{[^}]+\}/g) ?? []).some((x) => !/^\{(T|Q|E)\}$/i.test(x));

/** The tap-for-mana lines of an oracle text: the first whose cost needs no mana (or null), and whether any filter line is there. */
export function manaLines(text: string | null): { free: string | null; filter: boolean } {
  const lines = String(text ?? '')
    .split('\n')
    .map((l) => [l, MANA_LINE.exec(l)] as const)
    .filter((x): x is readonly [string, RegExpExecArray] => x[1] !== null);
  return { free: lines.find(([, m]) => !isFilterCost(m[1]))?.[0] ?? null, filter: lines.some(([, m]) => isFilterCost(m[1])) };
}

/** A tap-for-mana line of an oracle text whose cost needs no mana, or null. */
const manaLine = (text: string | null): string | null => manaLines(text).free;

export interface ManaSource {
  id: number;
  name: string;
  colors: Colors;
  amount: number;
}

export interface Available {
  total: number;
  sources: ManaSource[];
  pool: Record<Col, number>;
  poolTotal: number;
  known: boolean;
}

/** A land's or a permanent's mana, from its type line (basics) or its text; null when it makes none. */
export function sourceOf(c: LooseCard, oracle: Oracle | null): { colors: Colors; amount: number; known: boolean } | null {
  const name = nameOf(c);
  const text = name && oracle ? oracle.text(name) : null;
  if (isLand(c)) {
    const basics = Object.entries(BASIC_TYPE)
      .filter(([t]) => new RegExp(`\\b${t}\\b`).test(String(c.types ?? '')))
      .map(([, col]) => col);
    if (basics.length) return { colors: new Set(basics), amount: 1, known: true };
    const line = manaLine(text);
    if (line) return { ...addClause(line)!, known: true };
    if (manaLines(text).filter) return null;   // a filter land with no free line (Sungrass Prairie): no mana of its own
    return { colors: 'any', amount: 1, known: false };
  }
  const line = manaLine(text);
  if (!line) return null;
  return { ...addClause(line)!, known: true };
}

/** The seat's untapped mana sources and pool. */
export function availableMana(state: GameStateBody, me: number, oracle: Oracle | null = null): Available {
  const { mine } = playersOf(state, me);
  const sources: ManaSource[] = [];
  let known = true;
  for (const c of zoneCards(mine, 'battlefield')) {
    if (c.hidden === true || c.controller !== me || c.tapped) continue;
    if (!isLand(c) && isCreature(c) && c.sick && !hasKeyword(c, 'HASTE')) continue;
    const s = sourceOf(c, oracle);
    if (!s) continue;
    if (!s.known) known = false;
    sources.push({ id: c.id, name: nameOf(c) ?? (isLand(c) ? 'a land' : '?'), colors: s.colors, amount: s.amount });
  }
  const pool: Record<Col, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  for (const k of ALL_COLS) pool[k] = Number((mine?.manaPool as Record<string, number> | undefined)?.[k]) || 0;
  const poolTotal = Object.values(pool).reduce((a, b) => a + b, 0);
  const total = sources.reduce((a, s) => a + s.amount, 0) + poolTotal;
  return { total, sources, pool, poolTotal, known };
}

function canMake(avail: Pick<Available, 'sources' | 'pool'>, col: Col): number {
  return avail.sources.filter((s) => s.colors === 'any' || s.colors.has(col)).reduce((a, s) => a + s.amount, 0) + (Number(avail.pool[col]) || 0);
}

/** "U U R" — what the untapped sources make, for the view. */
export function manaWords(avail: Available): { sources: string; pool: string } {
  const parts = avail.sources.map((s) => (s.colors === 'any' ? 'any' : [...s.colors].join('/')) + (s.amount > 1 ? `x${s.amount}` : ''));
  const pool = Object.entries(avail.pool)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k}${n > 1 ? `x${n}` : ''}`);
  return { sources: parts.join(' '), pool: pool.join(' ') };
}

const UNREADABLE =
  /convoke|delve|affinity|improvise|emerge|evoke|dash|prowl|surge|spectacle|madness|blitz|bestow|overload|mutate|plot|costs? \{?[\dX]*\}? ?less|less to cast|without paying|rather than pay|you may pay .* rather/i;

/** Can this card's cost be read? (false: a cost the engine alone can judge.) */
function readable(card: LooseCard, state: GameStateBody, me: number, oracle: Oracle | null): { ok: boolean; delve: boolean } {
  const name = nameOf(card);
  const text = name && oracle ? oracle.text(name) : null;
  const delve = !!text && /\bDelve\b/.test(text) && !UNREADABLE.test(text.replace(/\bDelve\b[^\n]*/g, ''));
  if (text && UNREADABLE.test(text) && !delve) return { ok: false, delve };
  const { mine } = playersOf(state, me);
  for (const p of zoneCards(mine, 'battlefield')) {
    const t = nameOf(p) && oracle ? oracle.text(nameOf(p)!) : null;
    if (t && /cost(s)? .{0,40}less|less to cast/i.test(t)) return { ok: false, delve };
  }
  return { ok: true, delve };
}

function haveWords(avail: Available): string {
  const list = avail.sources.map((s) => s.name).join(', ');
  return `${avail.sources.length} untapped mana source${avail.sources.length === 1 ? '' : 's'}${list ? ` (${list})` : ''}${avail.poolTotal ? ` and ${avail.poolTotal} mana in your pool` : ''}`;
}

/**
 * Why `card` (with a mana cost) cannot be paid for from the untapped mana now,
 * in plain words — or null when it can, or when this cannot tell.
 */
export function payProblem(card: LooseCard | null | undefined, state: GameStateBody, me: number, oracle: Oracle | null = null, avail: Available = availableMana(state, me, oracle)): string | null {
  if (!card?.manaCost) return null;
  const r = readable(card, state, me, oracle);
  if (!r.ok) return null;
  const cost = parseCost(card.manaCost);
  let delveNote = '';
  if (r.delve) {
    const { mine } = playersOf(state, me);
    const gy = Math.max(0, (mine?.zones?.graveyard?.count ?? 0) - (card.zone === 'graveyard' ? 1 : 0));
    const cut = Math.min(cost.generic, gy);
    cost.generic -= cut;
    cost.mv -= cut;
    delveNote = ` even with delve exiling ${cut} card${cut === 1 ? '' : 's'} of your graveyard (${gy} there)`;
  }
  const have = haveWords(avail);
  if (avail.total < cost.mv) return `it costs ${card.manaCost}${r.delve ? `, ${cost.mv} mana${delveNote},` : ` (${cost.mv} mana)`} and you have ${have}`;
  for (const col of ALL_COLS) {
    const need = cost.pips[col];
    if (need > 0 && canMake(avail, col) < need) {
      const can = canMake(avail, col);
      return `it costs ${card.manaCost}, which needs ${need} ${COLOR_WORD[col]} mana, and your untapped mana makes ${can === 0 ? 'no' : `only ${can}`} ${COLOR_WORD[col]} (you have ${have})`;
    }
  }
  if (cost.mv > 0) {
    let colored = 0;
    for (const col of ALL_COLS) colored += cost.pips[col];
    if (colored > avail.total) return `it costs ${card.manaCost} and you have ${have}`;
  }
  return null;
}

/**
 * The mana cost of casting `card` from a zone other than the hand, from its
 * card text: Flashback / Escape / Retrace. null when the text names none.
 */
export function zoneCost(card: LooseCard | null | undefined, zone: string, oracle: Oracle | null = null): { cost: string; how: string } | null {
  if (zone === 'hand' || !card) return null;
  const name = nameOf(card);
  const text = (name && oracle ? oracle.text(name) : '') ?? '';
  if (zone === 'graveyard') {
    const fb = /\bFlashback\s*((?:\{[^}]+\})+)/i.exec(text);
    if (fb) return { cost: fb[1]!, how: 'flashback' };
    const esc = /\bEscape\s*[—-]\s*((?:\{[^}]+\})+)/i.exec(text);
    if (esc) return { cost: esc[1]!, how: 'escape' };
    if (/\bRetrace\b/i.test(text) && card.manaCost) return { cost: card.manaCost, how: 'retrace' };
  }
  return null;
}

/** The mana symbols of an engine ability label's cost ("{2}, Sacrifice this token: …" -> "{2}"), or null. */
export function activationManaCost(label: string): string | null {
  const cost = abilityCost(label) ?? /^[^(]*?\b(?:Equip|Reconfigure|Fortify)\b\s*((?:\{[^}]+\})+)/i.exec(label ?? '')?.[1] ?? null;
  if (!cost) return null;
  const mana = (cost.match(/\{[^}]+\}/g) ?? []).filter((x) => !/^\{(T|Q|E|X)\}$/i.test(x)).join('');
  return mana || null;
}

/**
 * Why an engine-listed activation (M63) cannot be paid from the untapped mana
 * now, from the mana symbols of its label's cost, or null.
 */
export function activationProblem(label: string, card: LooseCard | null | undefined, state: GameStateBody, me: number, oracle: Oracle | null): string | null {
  const mana = activationManaCost(label);
  if (!mana) return null;
  const p = payProblem({ ...(card ?? { id: -1 }), manaCost: mana }, state, me, oracle);
  return p ? `its ability "${String(label).slice(0, 80)}" ${p.replace(/^it costs/, 'costs')}` : null;
}

// ---------------------------------------------------------------------------
// The budget: a plan's costs one after another

interface Unit {
  src: number; // index into sources, or -1 for the pool
  colors: Colors;
}

/** Can `units` pay `need` (pips by colour, then generic)? A small bipartite matching. */
function payable(units: readonly Unit[], pips: readonly Col[], generic: number): boolean {
  if (pips.length + generic > units.length) return false;
  const owner: number[] = new Array(units.length).fill(-1);
  const fits = (u: Unit, col: Col) => u.colors === 'any' || u.colors.has(col);
  const tryPip = (p: number, seen: boolean[]): boolean => {
    for (let u = 0; u < units.length; u++) {
      if (seen[u] || !fits(units[u]!, pips[p]!)) continue;
      seen[u] = true;
      if (owner[u] === -1 || tryPip(owner[u]!, seen)) {
        owner[u] = p;
        return true;
      }
    }
    return false;
  };
  for (let p = 0; p < pips.length; p++) if (!tryPip(p, new Array(units.length).fill(false))) return false;
  return true;
}

export interface Spend {
  /** What it pays for, in words: "step 2 (cast Momentary Blink, {1}{W})". */
  what: string;
  cost: Cost;
}

/**
 * A plan's mana, step by step: each spend is checked against what the earlier
 * ones left (a feasible payment of all of them together), lands the plan plays
 * and mana rocks it casts join as sources, and a cost this cannot read makes
 * the rest of the plan unknown (let through).
 */
export class ManaBudget {
  readonly sources: ManaSource[];
  readonly pool: Record<Col, number>;
  private spends: Spend[] = [];
  private unknown = false;

  constructor(
    private readonly state: GameStateBody,
    private readonly me: number,
    private readonly oracle: Oracle | null,
  ) {
    const a = availableMana(state, me, oracle);
    this.sources = [...a.sources];
    this.pool = { ...a.pool };
  }

  available(): Available {
    const poolTotal = Object.values(this.pool).reduce((x, y) => x + y, 0);
    return { total: this.sources.reduce((x, s) => x + s.amount, 0) + poolTotal, sources: this.sources, pool: this.pool, poolTotal, known: true };
  }

  private units(): Unit[] {
    const out: Unit[] = [];
    this.sources.forEach((s, i) => {
      for (let k = 0; k < s.amount; k++) out.push({ src: i, colors: s.colors });
    });
    for (const col of ALL_COLS) for (let k = 0; k < this.pool[col]; k++) out.push({ src: -1, colors: new Set([col]) });
    return out;
  }

  private fits(spends: readonly Spend[]): boolean {
    const pips: Col[] = [];
    let generic = 0;
    for (const s of spends) {
      for (const col of ALL_COLS) for (let k = 0; k < s.cost.pips[col]; k++) pips.push(col);
      generic += s.cost.generic;
    }
    return payable(this.units(), pips, generic);
  }

  /** A land the plan plays: a source from now on, unless it enters tapped. */
  addLand(card: LooseCard): void {
    const name = nameOf(card);
    const text = name && this.oracle ? this.oracle.text(name) : null;
    if (text && /enters (?:the battlefield )?tapped\.?/i.test(text) && !/enters (?:the battlefield )?tapped unless|enters (?:the battlefield )?tapped if|If .{0,60}enters (?:the battlefield )?tapped/i.test(text)) return;
    const s = sourceOf(card, this.oracle);
    if (s) this.sources.push({ id: card.id, name: name ?? 'a land', colors: s.colors, amount: s.amount });
  }

  /** A permanent the plan casts that taps for mana at once (a mana rock; a creature is summoning sick). */
  addCast(card: LooseCard): void {
    if (isLand(card) || (isCreature(card) && !hasKeyword(card, 'HASTE'))) return;
    const name = nameOf(card);
    const text = name && this.oracle ? this.oracle.text(name) : null;
    if (!text || /enters (?:the battlefield )?tapped/i.test(text)) return;
    const s = sourceOf(card, this.oracle);
    if (s && s.known) this.sources.push({ id: card.id, name: name ?? '?', colors: s.colors, amount: s.amount });
  }

  /** A permanent that is tapped as part of a cost ("{1}, {T}, Sacrifice …"): no longer a source. */
  tap(cardId: number): void {
    const i = this.sources.findIndex((s) => s.id === cardId);
    if (i >= 0) this.sources.splice(i, 1);
  }

  /**
   * Spend `cost` for `what`: null when it can be paid after the earlier spends
   * (or cannot be read), else why not. `card` (when given) is read for delve and
   * the costs this cannot judge.
   */
  spend(manaCost: string | null | undefined, what: string, card: LooseCard | null = null): string | null {
    if (this.unknown || !manaCost) return null;
    if (card && !readable({ ...card, manaCost }, this.state, this.me, this.oracle).ok) {
      this.unknown = true;
      return null;
    }
    const cost = parseCost(manaCost);
    if (card) {
      const r = readable({ ...card, manaCost }, this.state, this.me, this.oracle);
      if (r.delve) {
        const { mine } = playersOf(this.state, this.me);
        const gy = Math.max(0, (mine?.zones?.graveyard?.count ?? 0) - (card.zone === 'graveyard' ? 1 : 0));
        const cut = Math.min(cost.generic, gy);
        cost.generic -= cut;
        cost.mv -= cut;
      }
    }
    if (cost.mv === 0) return null;
    const mine = { what, cost };
    if (this.fits([...this.spends, mine])) {
      this.spends.push(mine);
      return null;
    }
    // On its own: the seat's words. After earlier steps: say what they use.
    const alone = this.fits([mine]);
    const avail = this.available();
    if (!alone || this.spends.length === 0) {
      const p = payProblem({ ...(card ?? { id: -1 }), manaCost }, this.state, this.me, this.oracle, avail);
      if (p) return p;
      return `it costs ${manaCost} and your untapped mana cannot pay it (you have ${haveWords(avail)})`;
    }
    const before = this.spends.map((s) => s.what).join(', ');
    const short = ALL_COLS.find((col) => {
      const need = this.spends.reduce((a, s) => a + s.cost.pips[col], 0) + cost.pips[col];
      return cost.pips[col] > 0 && canMake(avail, col) < need;
    });
    const used = this.spends.reduce((a, s) => a + s.cost.mv, 0);
    if (short) {
      const can = canMake(avail, short);
      return `it costs ${manaCost}, which needs ${cost.pips[short]} ${COLOR_WORD[short]} mana, and after ${before} your untapped mana has ${can - this.spends.reduce((a, s) => a + s.cost.pips[short], 0) <= 0 ? 'no' : 'not enough'} ${COLOR_WORD[short]} left (you have ${haveWords(avail)})`;
    }
    return `it costs ${manaCost} (${cost.mv} mana), and after ${before} (${used} mana) you have ${Math.max(0, avail.total - used)} untapped mana left (you have ${haveWords(avail)})`;
  }
}
