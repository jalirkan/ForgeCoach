/*
 * ForgeCoach — state.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Derived facts about one state frame that neither the UI nor the prompt
 * should recompute: mana available, land drop, what was cast this turn, and a
 * flat per-permanent view (tapped, sick, counters, damage, attachments by
 * name, P/T).
 *
 * Everything here is pure. Card text comes from Scryfall (`CardInfo`) when the
 * caller has it; without it we fall back to what the wire carries (basic land
 * types in `types`, Forge's `keywords`, `abilities` — the last is `[]` in every
 * recording to date, amendment M5, but is read anyway so a later recording
 * gets better answers for free).
 */
import type { AnyCard, AskBody, Card, GameEvent, GameStateBody, PlayerState, StackItem } from './protocol.ts';
import { isHidden, keywordsOf } from './protocol.ts';
import type { GameLog } from './log.ts';
import type { CardInfo } from './cards.ts';

// ---------------------------------------------------------------------------
// Small card helpers

/** The card as a full `Card` when the viewer may see it, else null. */
export function visibleCard(card: AnyCard | null | undefined): Card | null {
  if (!card || isHidden(card)) return null;
  return card as Card;
}

/** Type line contains this word (case-insensitive, whole word). */
export function hasType(card: AnyCard | null | undefined, type: string): boolean {
  const c = visibleCard(card);
  if (!c) return false;
  return new RegExp(`\\b${type}\\b`, 'i').test(c.types);
}

/** Look up the Scryfall entry for a card by its Forge name (exact, then the front face of a split name). */
export function infoFor(name: string, cards?: Map<string, CardInfo>): CardInfo | undefined {
  if (!cards || !name) return undefined;
  const hit = cards.get(name);
  if (hit) return hit.found ? hit : undefined;
  const front = name.split(' // ')[0]!;
  const alt = cards.get(front);
  return alt?.found ? alt : undefined;
}

/** Every card the viewer can see in this state, by id (stack cards included). */
function cardsById(state: GameStateBody): Map<number, AnyCard> {
  const m = new Map<number, AnyCard>();
  for (const p of state.players) for (const z of Object.values(p.zones)) for (const c of z.cards) m.set(c.id, c);
  for (const c of state.stackCards ?? []) if (!m.has(c.id)) m.set(c.id, c);
  return m;
}

function playerOf(state: GameStateBody, playerId: number): PlayerState | undefined {
  return state.players.find((p) => p.id === playerId);
}

// ---------------------------------------------------------------------------
// Mana

export interface ManaSource {
  cardId: number;
  name: string;
  /** Colour letters it can produce: W U B R G C. Empty if unknown. */
  colors: string[];
  /**
   * A land like Thriving Isle ("choose a color as it enters") whose chosen
   * colour the log does not tell us: `colors` holds only its fixed colour, and
   * this says what else it might make.
   */
  unrecordedChoice?: boolean;
}

const BASIC_TYPE_COLOR: Record<string, string> = {
  Plains: 'W',
  Island: 'U',
  Swamp: 'B',
  Mountain: 'R',
  Forest: 'G',
  Wastes: 'C',
};
const WUBRG = ['W', 'U', 'B', 'R', 'G'];
/** Tokens whose mana ability every player knows without card text. */
const TOKEN_MANA: Record<string, string[]> = {
  Treasure: WUBRG,
  Gold: WUBRG,
  Powerstone: ['C'],
};

/** Colour letters named by "Add …" clauses in a piece of rules text, or null if it never adds mana. */
export function manaColorsInText(text: string): string[] | null {
  if (!/\badd\b/i.test(text)) return null;
  const out = new Set<string>();
  // Only look at the "Add …" sentences so costs ({2}, {T}) don't leak in.
  for (const m of text.matchAll(/\badd\b([^.]*)/gi)) {
    const clause = m[1]!;
    for (const s of clause.matchAll(/\{([WUBRGC])\}/g)) out.add(s[1]!);
    if (/any colou?r|any one colou?r|any combination of colou?rs/i.test(clause)) WUBRG.forEach((c) => out.add(c));
    if (/\{[0-9X]+\}/.test(clause) && !/[WUBRG]/.test(clause.replace(/[^{}WUBRGC]/g, ''))) out.add('C');
  }
  return out.size > 0 ? [...out] : null;
}

/** Does any mana ability in this text need {T}? ("{T}: Add {G}." → true; "Sacrifice X: Add {R}." → false.) */
function manaAbilityNeedsTap(text: string): boolean {
  for (const line of text.split('\n')) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const cost = line.slice(0, i);
    const effect = line.slice(i + 1);
    if (/\badd\b/i.test(effect) && /\{T\}/.test(cost)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Lands that make "one mana of the chosen color" (Thriving lands)

/** The Thriving lands' fixed colour, for when there is no card text. */
const THRIVING_FIXED: Record<string, string> = {
  'Thriving Bluff': 'R',
  'Thriving Grove': 'G',
  'Thriving Heath': 'W',
  'Thriving Isle': 'U',
  'Thriving Moor': 'B',
};

const COLOR_WORD: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
const COLOR_NAME: Record<string, string> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green', C: 'colourless' };

/** "W" → "white". */
export function colorName(letter: string): string {
  return COLOR_NAME[letter] ?? letter;
}

/**
 * A permanent whose mana ability makes "one mana of the chosen color" (a colour
 * chosen as it entered, as on the Thriving lands): its fixed colours, or null
 * when it is not such a card. The chosen colour itself is not in the state
 * (`Card` has no such field); see {@link chosenColors}.
 */
export function chosenColorSource(card: AnyCard | null | undefined, cards?: Map<string, CardInfo>): { fixed: string[] } | null {
  const c = visibleCard(card);
  if (!c) return null;
  const info = infoFor(c.name, cards);
  const text = info?.oracleText ?? c.abilities.map((a) => a.text).join('\n');
  for (const m of text.matchAll(/\badd\b([^.]*)/gi)) {
    const clause = m[1]!;
    if (!/mana of the chosen colou?r/i.test(clause)) continue;
    return { fixed: [...new Set([...clause.matchAll(/\{([WUBRGC])\}/g)].map((x) => x[1]!))] };
  }
  const fixed = THRIVING_FIXED[c.name];
  return fixed ? { fixed: [fixed] } : null;
}

/** Card id → the colour letter chosen for it as it entered the battlefield. */
export type ChosenColors = Map<number, string>;

/**
 * The colours the VIEWING seat chose for its own "choose a color as it
 * enters" permanents, read from its own answers in the log up to `frameIndex`.
 *
 * mtg-table's state does not carry a chosen colour (no `chosenColor` field, no
 * event), so the only record is the seat's answer to Forge's "Choose a color"
 * question (`choose_list` of `color` options). The question names no card; it
 * is tied to the seat's chosen-colour permanent that entered the battlefield in
 * the state frame just before the question, or failing that in the next one.
 * When that is ambiguous (two entered together and no earlier question named
 * one by id) nothing is recorded. The opponent's choices are never in the log,
 * so their lands stay unknown. A permanent that re-enters loses its old choice.
 */
export function chosenColors(log: GameLog, frameIndex: number, seat: number, cards?: Map<string, CardInfo>): ChosenColors {
  const out: ChosenColors = new Map();
  const end = Math.min(frameIndex, log.frames.length - 1);
  /** Candidates that entered in the latest state frame, waiting for a colour. */
  let entered: number[] = [];
  /** A colour answered before its permanent showed up (it then enters in the next state frame). */
  let pending: string | null = null;
  /** Card ids named in asks since the last state frame ("Thriving Isle (9) - As Thriving Isle enters, choose a color …"). */
  let named = new Set<number>();
  let colorAsk: AskBody | null = null;
  const assign = (ids: number[], color: string): boolean => {
    const pick = ids.length === 1 ? ids : ids.filter((id) => named.has(id));
    if (pick.length !== 1) return false;
    out.set(pick[0]!, color);
    return true;
  };
  for (let i = 0; i <= end; i++) {
    const f = log.frames[i]!;
    if (f.type === 'state') {
      const s = f.body as GameStateBody;
      // Built only for a frame where something entered: a long game has thousands of state frames (J109).
      let byId: Map<number, AnyCard> | null = null;
      const now: number[] = [];
      for (const e of s.events as GameEvent[]) {
        if (e.kind !== 'zone' || e.to?.zone !== 'battlefield' || e.from?.zone === 'battlefield') continue;
        out.delete(e.cardId); // a new object: any old choice is gone
        const c = (byId ??= cardsById(s)).get(e.cardId);
        if (e.to.player === seat && chosenColorSource(c, cards)) now.push(e.cardId);
      }
      if (pending !== null && now.length) {
        if (assign(now, pending)) now.splice(0);
      }
      pending = null;
      entered = now;
      named = new Set();
      continue;
    }
    if (f.type === 'ask') {
      const a = f.body as AskBody;
      const labels = ('source' in a ? [...a.source, ...a.dest] : 'options' in a ? (a.options as { label: string }[]) : []).map((o) => o.label);
      for (const l of [('prompt' in a ? String(a.prompt ?? '') : ''), ...labels]) {
        if (!/choose a colou?r/i.test(l)) continue;
        for (const m of l.matchAll(/\((\d+)\)/g)) named.add(Number(m[1]));
      }
      colorAsk = isColorAsk(a) ? a : null;
      continue;
    }
    if (f.type === 'answer' && colorAsk) {
      const ans = f.body as { askId?: string; value?: unknown };
      if (ans.askId !== colorAsk.askId) continue;
      const a = colorAsk;
      colorAsk = null;
      const idx = Array.isArray(ans.value) ? ans.value[0] : ans.value;
      const opt = (a as { options: { id: number; label: string }[] }).options.find((o) => o.id === idx);
      const color = opt ? COLOR_WORD[opt.label.trim().toLowerCase()] : undefined;
      if (!color) continue;
      if (entered.length && assign(entered, color)) entered = entered.filter((id) => !out.has(id));
      else pending = color;
    }
  }
  return out;
}

/** Forge's "Choose a color" question: a choose_list whose options are all colours. */
function isColorAsk(a: AskBody): boolean {
  if (a.kind !== 'choose_list') return false;
  return a.options.length > 0 && a.options.every((o) => o.kind === 'color' || COLOR_WORD[o.label.trim().toLowerCase()] !== undefined);
}

/**
 * What colours this permanent can tap for, or null when it is not (known to
 * be) a mana source. Order of evidence: Scryfall `producedMana`, the oracle
 * text, Forge's ability texts, basic land types, well-known mana tokens.
 * A land we know nothing about returns `[]` (a source of unknown colour).
 *
 * A "chosen colour" land (Thriving Isle) makes its fixed colour plus the
 * colour chosen as it entered. With `chosen` (from {@link chosenColors}) it
 * returns exactly that, or only the fixed colour when the choice is not
 * recorded; without `chosen` (callers that never looked) it stays lenient and
 * returns every colour it could have been given.
 */
export function manaColorsOf(card: AnyCard, cards?: Map<string, CardInfo>, chosen?: ChosenColors): string[] | null {
  const c = visibleCard(card);
  if (!c) return null;
  if (chosen) {
    const cc = chosenColorSource(c, cards);
    if (cc) {
      const pick = chosen.get(c.id);
      return pick && !cc.fixed.includes(pick) ? [...cc.fixed, pick] : [...cc.fixed];
    }
  }
  const info = infoFor(c.name, cards);
  if (info) {
    if (info.producedMana.length > 0) return info.producedMana.filter((x) => /^[WUBRGC]$/.test(x));
    const fromText = manaColorsInText(info.oracleText);
    if (fromText) return fromText;
    if (!hasType(c, 'Land')) return null;
  }
  for (const a of c.abilities ?? []) {
    const fromAb = manaColorsInText(a.text);
    if (fromAb) return fromAb;
  }
  if (hasType(c, 'Land')) {
    const fromTypes = Object.entries(BASIC_TYPE_COLOR)
      .filter(([t]) => new RegExp(`\\b${t}\\b`).test(c.types) || c.name === t)
      .map(([, col]) => col);
    return fromTypes;
  }
  if (c.token && TOKEN_MANA[c.name]) return TOKEN_MANA[c.name]!;
  return null;
}

/** Untapped, usable (not summoning-sick if it needs {T} on a creature) mana sources of a player. */
export function untappedManaSources(state: GameStateBody, playerId: number, cards?: Map<string, CardInfo>, chosen?: ChosenColors): ManaSource[] {
  const p = playerOf(state, playerId);
  if (!p) return [];
  const out: ManaSource[] = [];
  for (const raw of p.zones.battlefield.cards) {
    const c = visibleCard(raw);
    if (!c || c.tapped || c.faceDown) continue;
    if (c.controller !== null && c.controller !== playerId) continue;
    const colors = manaColorsOf(c, cards, chosen);
    if (colors === null) continue;
    if (c.sick && hasType(c, 'Creature')) {
      // A sick creature can still use a mana ability that doesn't need {T}.
      const info = infoFor(c.name, cards);
      const text = info?.oracleText ?? c.abilities.map((a) => a.text).join('\n');
      if (!text || manaAbilityNeedsTap(text)) continue;
    }
    const src: ManaSource = { cardId: c.id, name: c.name, colors };
    if (chosen && !chosen.has(c.id) && chosenColorSource(c, cards)) src.unrecordedChoice = true;
    out.push(src);
  }
  return out;
}

/** One symbol of a mana cost. */
export type ManaSymbol =
  | { kind: 'generic'; amount: number }
  | { kind: 'color'; colors: string[]; /** {W/P}: may be paid with 2 life instead */ phyrexian: boolean }
  | { kind: 'x' };

/** "{2}{W}{W/U}{X}" → symbols. Unknown symbols ({S}, {H…}) count as one generic. */
export function parseManaCost(cost: string | null | undefined): ManaSymbol[] {
  if (!cost) return [];
  const out: ManaSymbol[] = [];
  for (const m of cost.matchAll(/\{([^}]+)\}/g)) {
    const s = m[1]!.toUpperCase();
    if (/^\d+$/.test(s)) out.push({ kind: 'generic', amount: Number(s) });
    else if (s === 'X' || s === 'Y' || s === 'Z') out.push({ kind: 'x' });
    else if (/^[WUBRGC]$/.test(s)) out.push({ kind: 'color', colors: [s], phyrexian: false });
    else if (s.includes('/')) {
      const parts = s.split('/');
      const phyrexian = parts.includes('P');
      const colors = parts.filter((x) => /^[WUBRGC]$/.test(x));
      const twoGeneric = parts.find((x) => /^\d+$/.test(x));
      if (twoGeneric && colors.length === 1) out.push({ kind: 'color', colors: [...colors, `generic:${twoGeneric}`], phyrexian });
      else out.push({ kind: 'color', colors, phyrexian });
    } else out.push({ kind: 'generic', amount: 1 });
  }
  return out;
}

/** Mana value of a cost string (X counts 0). */
export function manaValue(cost: string | null | undefined): number {
  let n = 0;
  for (const s of parseManaCost(cost)) {
    if (s.kind === 'generic') n += s.amount;
    else if (s.kind === 'color') {
      const g = s.colors.find((c) => c.startsWith('generic:'));
      n += g ? Number(g.slice(8)) : 1;
    }
  }
  return n;
}

/**
 * Can these sources (plus floating mana) pay this cost? X is taken as 0.
 * A source whose colours are unknown (`colors: []`) is treated as any colour —
 * the lenient answer, so a coach flags an option rather than hiding it.
 */
export function canPay(cost: string | null | undefined, sources: ManaSource[], pool?: Partial<Record<string, number>>): boolean {
  const syms = parseManaCost(cost);
  // Units of mana: one per source, plus the pool.
  const units: string[][] = sources.map((s) => (s.colors.length ? s.colors : [...WUBRG, 'C']));
  for (const [col, n] of Object.entries(pool ?? {})) for (let i = 0; i < (n ?? 0); i++) units.push([col]);
  const colored = syms.filter((s): s is Extract<ManaSymbol, { kind: 'color' }> => s.kind === 'color');
  let generic = syms.reduce((n, s) => n + (s.kind === 'generic' ? s.amount : 0), 0);
  // Pay the most constrained pips first; a pip with a generic alternative ({2/W}) falls back to generic.
  const used = new Array(units.length).fill(false);
  const pips = [...colored].sort((a, b) => a.colors.length - b.colors.length);
  for (const pip of pips) {
    const want = pip.colors.filter((c) => !c.startsWith('generic:'));
    let best = -1;
    for (let i = 0; i < units.length; i++) {
      if (used[i]) continue;
      if (!units[i]!.some((c) => want.includes(c))) continue;
      if (best < 0 || units[i]!.length < units[best]!.length) best = i;
    }
    if (best >= 0) {
      used[best] = true;
      continue;
    }
    if (pip.phyrexian) continue; // pay life
    const g = pip.colors.find((c) => c.startsWith('generic:'));
    if (g) {
      generic += Number(g.slice(8));
      continue;
    }
    return false;
  }
  const left = used.filter((u) => !u).length;
  return left >= generic;
}

export interface ManaSummary {
  sources: ManaSource[];
  /** Untapped sources + floating mana. */
  total: number;
  /** How many sources can make each colour (a dual counts for both). */
  byColor: Record<'W' | 'U' | 'B' | 'R' | 'G' | 'C', number>;
  /** Sources whose colour we could not determine (no card text). */
  unknown: number;
  pool: GameStateBody['players'][number]['manaPool'];
}

/** Mana a player could spend right now: untapped sources plus floating mana. */
export function manaSummary(state: GameStateBody, playerId: number, cards?: Map<string, CardInfo>, chosen?: ChosenColors): ManaSummary {
  const sources = untappedManaSources(state, playerId, cards, chosen);
  const pool = playerOf(state, playerId)?.manaPool ?? { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  const byColor = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  let unknown = 0;
  for (const s of sources) {
    if (s.colors.length === 0) unknown++;
    for (const c of s.colors) if (c in byColor) byColor[c as keyof typeof byColor]++;
  }
  const floating = Object.values(pool).reduce((a, b) => a + b, 0);
  return { sources, total: sources.length + floating, byColor, unknown, pool };
}

// ---------------------------------------------------------------------------
// Per-permanent view

export interface PermanentView {
  id: number;
  name: string;
  controller: number | null;
  owner: number | null;
  /** Forge's type line, e.g. "Legendary Creature - Human Spy Hero". */
  types: string;
  isCreature: boolean;
  isLand: boolean;
  token: boolean;
  tapped: boolean;
  /**
   * Summoning sick: Forge's own flag. Set only on creatures, cleared at the
   * start of the controller's turn (so it stays true through the opponent's
   * turn, correctly for {T} abilities). It already accounts for haste.
   */
  sick: boolean;
  /** Untapped, not sick, a creature — and so could be declared as an attacker on its controller's turn. */
  canAttack: boolean;
  /** Untapped creature — could block. (Ignores "can't block" text; check the card.) */
  canBlock: boolean;
  /** Current power/toughness as Forge computes it (counters, auras, pumps included). Strings: "*" is real. */
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  /** Damage marked this turn. */
  damage: number;
  counters: Record<string, number>;
  keywords: readonly string[];
  attacking: boolean;
  blocking: boolean;
  faceDown: boolean;
  /** What this is attached to (Aura/Equipment), resolved to a name. */
  attachedTo: { id: number; name: string } | null;
  /** Auras / Equipment on this permanent, resolved to names. */
  attachments: { id: number; name: string }[];
  /** Colours it can tap for if it is a mana source, else null. */
  mana: string[] | null;
}

/** Flat, name-resolved view of one battlefield card. Hidden cards come back as a nameless stub. */
export function permanentView(card: AnyCard, state: GameStateBody, cards?: Map<string, CardInfo>, chosen?: ChosenColors): PermanentView {
  const byId = cardsById(state);
  const nameOf = (id: number) => {
    const x = byId.get(id);
    const v = visibleCard(x);
    return v ? v.name || 'a face-down card' : 'a hidden card';
  };
  const c = visibleCard(card);
  if (!c) {
    const fd = card as Partial<Card>;
    return {
      id: card.id,
      name: 'a face-down card',
      controller: card.controller,
      owner: (card as { owner?: number | null }).owner ?? null,
      types: '',
      isCreature: !!fd.power,
      isLand: false,
      token: false,
      tapped: !!fd.tapped,
      sick: false,
      canAttack: false,
      canBlock: !!fd.power && !fd.tapped,
      power: fd.power ?? null,
      toughness: fd.toughness ?? null,
      loyalty: null,
      damage: fd.damage ?? 0,
      counters: fd.counters ?? {},
      keywords: [],
      attacking: !!fd.attacking,
      blocking: !!fd.blocking,
      faceDown: true,
      attachedTo: null,
      attachments: [],
      mana: null,
    };
  }
  const isCreature = hasType(c, 'Creature');
  return {
    id: c.id,
    name: c.name || (c.faceDown ? (c.alt?.name ? `face-down ${c.alt.name}` : 'a face-down card') : 'a card'),
    controller: c.controller,
    owner: c.owner,
    types: c.types,
    isCreature,
    isLand: hasType(c, 'Land'),
    token: c.token,
    tapped: c.tapped,
    sick: c.sick,
    canAttack: isCreature && !c.tapped && !c.sick,
    canBlock: isCreature && !c.tapped,
    power: c.power,
    toughness: c.toughness,
    loyalty: c.loyalty,
    damage: c.damage,
    counters: c.counters ?? {},
    keywords: keywordsOf(c),
    attacking: c.attacking,
    blocking: c.blocking,
    faceDown: c.faceDown,
    attachedTo: c.attachedToId !== null ? { id: c.attachedToId, name: nameOf(c.attachedToId) } : null,
    attachments: (c.attachmentIds ?? []).map((id) => ({ id, name: nameOf(id) })),
    mana: manaColorsOf(c, cards, chosen),
  };
}

/** Every permanent a player has on the battlefield, as {@link PermanentView}s, lands last. */
export function battlefieldView(state: GameStateBody, playerId: number, cards?: Map<string, CardInfo>): PermanentView[] {
  const p = playerOf(state, playerId);
  if (!p) return [];
  const views = p.zones.battlefield.cards.map((c) => permanentView(c, state, cards));
  return views.sort((a, b) => Number(a.isLand) - Number(b.isLand));
}

/**
 * One line for a prompt or tooltip:
 * "Quake, Agent of S.H.I.E.L.D. 3/3 — tapped, summoning sick, +1/+1×1, 2 damage, equipped: Super Suit".
 */
export function permanentLine(v: PermanentView): string {
  const pt = v.power !== null && v.toughness !== null && v.isCreature ? ` ${v.power}/${v.toughness}` : '';
  const loy = v.loyalty ? ` [loyalty ${v.loyalty}]` : '';
  const bits: string[] = [];
  if (v.token) bits.push('token');
  bits.push(v.tapped ? 'tapped' : 'untapped');
  if (v.sick) bits.push('summoning sick');
  if (v.attacking) bits.push('attacking');
  if (v.blocking) bits.push('blocking');
  for (const [k, n] of Object.entries(v.counters)) if (n) bits.push(`${k}×${n}`);
  if (v.damage) bits.push(`${v.damage} damage`);
  if (v.keywords.length) bits.push(v.keywords.map((k) => k.toLowerCase().replace(/_/g, ' ')).join(', '));
  if (v.attachedTo) bits.push(`attached to ${v.attachedTo.name}`);
  if (v.attachments.length) bits.push(`with ${v.attachments.map((a) => a.name).join(', ')}`);
  return `${v.name}${pt}${loy} — ${bits.join(', ')}`;
}

// ---------------------------------------------------------------------------
// Instant-speed options

export interface InstantOption {
  cardId: number;
  name: string;
  /** "instant" | "flash" (cast from hand) or "ability" (activated, from the battlefield). */
  via: 'instant' | 'flash' | 'ability';
  /** The cost we checked against the untapped mana. */
  cost: string | null;
}

/** Activated (non-mana) abilities in oracle text: `[cost, effect, needsTap]`. Loyalty and sorcery-speed ones excluded. */
export function activatedAbilities(oracleText: string): { cost: string; effect: string; needsTap: boolean }[] {
  const out: { cost: string; effect: string; needsTap: boolean }[] = [];
  for (const line0 of oracleText.split('\n')) {
    const line = line0.replace(/\([^)]*\)/g, '').trim();
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const cost = line.slice(0, i).trim();
    const effect = line.slice(i + 1).trim();
    // A cost is made of mana symbols, {T}/{Q}, and short clauses ("Sacrifice a creature", "Pay 2 life").
    if (!/\{[^}]+\}|^(sacrifice|discard|pay|exile|remove|tap|return)\b/i.test(cost)) continue;
    if (/^[+−-]?\d+$|^[+−-]X$/.test(cost)) continue; // loyalty
    if (/^(equip|reconfigure|crew|level up|fortify)\b/i.test(cost)) continue;
    if (/\badd\b/i.test(effect) && !/\bdraw\b|\bdamage\b/i.test(effect)) continue; // mana ability
    if (/activate only as a sorcery/i.test(effect)) continue;
    out.push({ cost, effect, needsTap: /\{T\}/.test(cost) });
  }
  return out;
}

/**
 * What the player could do at instant speed right now: an instant or flash
 * card in hand they can pay for, or an activated ability of a permanent they
 * control whose mana they have (and whose {T} they can use). Uses card text
 * when `cards` is given; without it, only instants (type line) and FLASH
 * (keywords, M49+ recordings) are found.
 */
export function instantSpeedOptions(state: GameStateBody, playerId: number, cards?: Map<string, CardInfo>, chosen?: ChosenColors): InstantOption[] {
  const p = playerOf(state, playerId);
  if (!p) return [];
  const sources = untappedManaSources(state, playerId, cards, chosen);
  const pool = p.manaPool as unknown as Record<string, number>;
  const out: InstantOption[] = [];
  for (const raw of p.zones.hand.cards) {
    const c = visibleCard(raw);
    if (!c) continue;
    const info = infoFor(c.name, cards);
    const instant = hasType(c, 'Instant');
    const flash = keywordsOf(c).includes('FLASH') || (!!info && /(^|\n)Flash\b/.test(info.oracleText));
    if (!instant && !flash) continue;
    if (hasType(c, 'Land')) continue;
    if (canPay(c.manaCost, sources, pool)) out.push({ cardId: c.id, name: c.name, via: instant ? 'instant' : 'flash', cost: c.manaCost });
  }
  if (cards) {
    for (const raw of p.zones.battlefield.cards) {
      const c = visibleCard(raw);
      if (!c || c.faceDown) continue;
      const info = infoFor(c.name, cards);
      if (!info) continue;
      for (const ab of activatedAbilities(info.oracleText)) {
        if (ab.needsTap && (c.tapped || (c.sick && hasType(c, 'Creature')))) continue;
        // Mana for the ability, not counting this permanent if it taps itself for the cost.
        const srcs = ab.needsTap ? sources.filter((s) => s.cardId !== c.id) : sources;
        const manaPart = (ab.cost.match(/\{(?!T\}|Q\})[^}]+\}/g) ?? []).join('');
        if (!canPay(manaPart, srcs, pool)) continue;
        out.push({ cardId: c.id, name: c.name, via: 'ability', cost: ab.cost });
        break;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Turn facts

export interface TurnFacts {
  /** Did this player already play a land this turn? null when unknowable. */
  landPlayed: boolean | null;
  /** Spells cast this turn, by anyone, in order. */
  cast: { playerId: number; name: string }[];
  /** Names of permanents the player controlled that left the battlefield this turn (revolt). */
  leftBattlefield: string[];
  /** Lands this player played this turn (for extra-land-drop effects). */
  landsPlayed: number;
  /** Activated and triggered abilities put on the stack this turn, by anyone, in order. */
  abilities: { playerId: number; name: string; text: string; triggered: boolean }[];
  /** This player's creatures that went from the battlefield to a graveyard this turn. */
  died: string[];
  /** Permanents that entered the battlefield under this player this turn. */
  entered: string[];
  /** Cards this player put from library into hand this turn (draws, plus tutors like landcycling). */
  drawn: number;
  /** Life this player gained / lost this turn (sums of life events). */
  lifeGained: number;
  lifeLost: number;
  /** Index into `log.frames` of the first state frame of this turn, or -1 when the turn start is not in the log. */
  turnStartFrame: number;
}

/** Index of the last `state` frame at or before `frameIndex`, or -1. */
export function stateIndexAt(log: GameLog, frameIndex: number): number {
  for (let i = Math.min(frameIndex, log.frames.length - 1); i >= 0; i--) if (log.frames[i]!.type === 'state') return i;
  return -1;
}

/** The state in force at `frameIndex` (the last state frame at or before it). */
export function stateAt(log: GameLog, frameIndex: number): GameStateBody | null {
  const i = stateIndexAt(log, frameIndex);
  return i < 0 ? null : (log.frames[i]!.body as GameStateBody);
}

/** A triggered ability's stack text starts with When/Whenever/At (or "Name — When…" for named triggers). */
export function isTriggerText(text: string): boolean {
  return /^(?:[^—]{1,60} — )?(When|Whenever|At)\b/.test(text.trim());
}

/** Is this cast event an ability (activated or triggered) rather than a spell? */
export function castIsAbility(ev: { stackId: number; cardId: number; text: string }, state: GameStateBody, prev: GameStateBody | null): boolean {
  const item: StackItem | undefined = state.stack.find((s) => s.id === ev.stackId);
  if (item && typeof item.isAbility === 'boolean') return item.isAbility;
  if (isTriggerText(ev.text)) return true;
  // A permanent already on the battlefield before the cast is activating, not being cast.
  if (prev) {
    for (const p of prev.players) if (p.zones.battlefield.cards.some((c) => c.id === ev.cardId)) return true;
  }
  return false;
}

/**
 * Facts accumulated from the events of all frames of the current turn up to
 * `frameIndex`. Events are read in order across state frames and the facts
 * reset on each `turn` event (a state frame's batch can straddle the turn
 * boundary, so frame-level turn numbers are not enough).
 */
export function turnFacts(log: GameLog, frameIndex: number, playerId: number): TurnFacts {
  const end = Math.min(frameIndex, log.frames.length - 1);
  if (end < 0) return blankFacts(-1);
  // The board asks this on every frame the seat receives, and the fold reads every state frame from the
  // start (the names of cards long gone): J109's long games spent most of a render here. The fold is kept
  // per log (by its first frame) and player, and goes on from where it stopped while the log only grew.
  const first = log.frames[0]!;
  let folds = turnFolds.get(first);
  if (!folds) turnFolds.set(first, (folds = new Map()));
  let fold = folds.get(playerId);
  if (!fold || fold.upto > end || log.frames[fold.upto] !== fold.at) {
    fold = { upto: -1, at: null, facts: blankFacts(-1), sawTurnStart: false, names: new Map(), prev: null };
    folds.set(playerId, fold);
  }
  for (let i = fold.upto + 1; i <= end; i++) {
    const f = log.frames[i]!;
    if (f.type === 'state') foldTurnState(fold, f.body as GameStateBody, i, playerId);
  }
  fold.upto = end;
  fold.at = log.frames[end]!;
  return copyFacts(fold.facts, fold.sawTurnStart);
}

interface TurnFold {
  /** The last frame index folded in, and that frame (the log it came from must still hold it there). */
  upto: number;
  at: unknown;
  facts: TurnFacts;
  sawTurnStart: boolean;
  names: Map<number, string>;
  prev: GameStateBody | null;
}

/** Folds per log (keyed by its first frame object: a log only ever grows at its end) and player. */
const turnFolds = new WeakMap<object, Map<number, TurnFold>>();

function blankFacts(start: number): TurnFacts {
  return {
    landPlayed: null,
    cast: [],
    leftBattlefield: [],
    landsPlayed: 0,
    abilities: [],
    died: [],
    entered: [],
    drawn: 0,
    lifeGained: 0,
    lifeLost: 0,
    turnStartFrame: start,
  };
}

/** The caller's own copy: the fold's facts go on changing. */
function copyFacts(f: TurnFacts, sawTurnStart: boolean): TurnFacts {
  return {
    ...f,
    landPlayed: sawTurnStart ? f.landPlayed : null,
    cast: f.cast.map((c) => ({ ...c })),
    leftBattlefield: [...f.leftBattlefield],
    abilities: f.abilities.map((a) => ({ ...a })),
    died: [...f.died],
    entered: [...f.entered],
  };
}

/** One state frame (index `i`) into the fold. */
function foldTurnState(fold: TurnFold, s: GameStateBody, i: number, playerId: number): void {
  const names = fold.names;
  const prev = fold.prev;
  let facts = fold.facts;
  // Names from the previous snapshot first (cards that left to a hidden zone), then this one.
  for (const [id, c] of cardsById(s)) {
    const v = visibleCard(c);
    if (v && v.name) names.set(id, v.name);
  }
  const nm = (id: number) => names.get(id) ?? 'a hidden card';
  for (const e of s.events as GameEvent[]) {
    switch (e.kind) {
      case 'turn':
        facts = fold.facts = blankFacts(i);
        facts.landPlayed = false;
        fold.sawTurnStart = true;
        break;
      case 'land':
        if (e.player === playerId) {
          facts.landPlayed = true;
          facts.landsPlayed++;
        }
        break;
      case 'cast': {
        if (castIsAbility(e, s, prev)) {
          facts.abilities.push({ playerId: e.controller, name: nm(e.cardId), text: e.text, triggered: isTriggerText(e.text) });
        } else {
          facts.cast.push({ playerId: e.controller, name: nm(e.cardId) });
        }
        break;
      }
      case 'zone': {
        const from = e.from;
        const to = e.to;
        if (from?.zone === 'battlefield' && from.player === playerId && to?.zone !== 'battlefield') {
          facts.leftBattlefield.push(nm(e.cardId));
          const wasCreature = prev ? hasType(cardsById(prev).get(e.cardId), 'Creature') : false;
          if (to?.zone === 'graveyard' && wasCreature) facts.died.push(nm(e.cardId));
        }
        if (to?.zone === 'battlefield' && to.player === playerId && from?.zone !== 'battlefield') facts.entered.push(nm(e.cardId));
        if (from?.zone === 'library' && to?.zone === 'hand' && to.player === playerId) facts.drawn++;
        break;
      }
      case 'life':
        if (e.player === playerId) {
          if (e.to > e.from) facts.lifeGained += e.to - e.from;
          else facts.lifeLost += e.from - e.to;
        }
        break;
      default:
        break;
    }
  }
  fold.prev = s;
}
