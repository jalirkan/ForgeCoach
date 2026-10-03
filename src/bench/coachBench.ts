/*
 * ForgeCoach — bench/coachBench.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The coach benchmark: a fixed set of real decisions from recorded games, each
 * with answers a strong player would accept and clear blunders, used to score
 * a coach prompt change before it ships (`npm run bench:coach`, bench/coach/).
 *
 * A case points at a frame log and a moment in it. The moment is rebuilt the
 * way the app builds it — `extractDecisions` for a replay decision, or
 * `liveDecision` for the moment a player was at while playing — and the prompt
 * is the app's own `buildCoachPrompt`, plus one bench-only section at the end
 * that lists the legal choices and asks for a final `ANSWER: <choice>` line.
 * Normal prompts never carry that section.
 *
 * Choices are machine tokens over the ids in the viewer's redacted state:
 *   mulligan   keep | mulligan
 *   play_draw  play | draw
 *   spell      cast:<id> | land:<id> | pass
 *   pass       cast:<id> | activate:<id> | pass
 *   attack     attack:none | attack:<id>,<id>…
 *   block      block:none | block:<blocker>><attacker>,…
 *   target     target:<id>
 *   choice     option:<id> | yes | no
 * Legality is checked from the state and card text: who can attack or block
 * (untapped, not summoning sick, flying / reach), what the engine offers to
 * target or choose, and what the mana could pay for (a lenient heuristic).
 * Attack and block answers are compared by creature *class* (name, P/T,
 * keywords, counters, damage, attachments), so two identical 3/2s are
 * interchangeable and a case need not list every equivalent assignment.
 *
 * Pure apart from what callers inject (logs, card text, the coach).
 */
import type { AnyCard, AskBody, Card, GameStateBody, InputBody } from '../protocol.ts';
import { isHidden, keywordsOf } from '../protocol.ts';
import type { GameLog } from '../log.ts';
import type { CardInfo } from '../cards.ts';
import { extractDecisions, type Decision, type DecisionKind } from '../decisions.ts';
import { buildCoachPrompt, coachCardNames, type Prompt } from '../prompt.ts';
import { canPay, chosenColors, infoFor, instantSpeedOptions, manaColorsOf, turnFacts, untappedManaSources, type ManaSource } from '../state.ts';
import { liveDecision } from '../ui/play/liveDecision.ts';
import { bootstrapMean, mean, signTest, wilson, type Interval } from './benchStats.ts';

// ---------------------------------------------------------------------------
// Cases

export const BENCH_TYPES = ['mulligan', 'play_draw', 'spell', 'attack', 'block', 'target', 'pass', 'choice'] as const;
export type BenchType = (typeof BENCH_TYPES)[number];

/**
 * Where in the log the decision is.
 * - `live`: the moment just before frame `frame` (the player's act or answer
 *   there), rebuilt as the play screen's coach sees it (`liveDecision`).
 * - `review`: the replay decision whose state frame is `frame` and whose kind
 *   is `kind` (`extractDecisions`), as the review screen's coach sees it.
 */
export type BenchMoment = { mode: 'live'; frame: number } | { mode: 'review'; frame: number; kind: DecisionKind };

export interface BenchCase {
  id: string;
  /** Path of the frame log (.jsonl or .jsonl.gz), relative to the repository root. */
  log: string;
  /** Where the log came from (credit / provenance). */
  source?: string;
  moment: BenchMoment;
  /** The viewing seat; must be the log's seat (only its redacted view is used). */
  seat: number;
  type: BenchType;
  /** The decision's label in the app ("R4 · Your blocks"), checked so a moved moment is caught. */
  label?: string;
  /** The bench question; defaults to one per type. */
  question?: string;
  /** spell only: offer the land drop (land:<id>) among the choices. */
  lands?: boolean;
  /** 1–3 answers a strong player accepts. */
  acceptable: string[];
  /** Clear blunders. */
  unacceptable: string[];
  /** Why, in rules terms. */
  rationale: string;
  /** "low" cases run but stay out of the score. */
  confidence: 'high' | 'low';
  tags?: string[];
}

const DECISION_KINDS: readonly DecisionKind[] = ['main', 'attack', 'block', 'priority', 'choice'];

/** Checks a parsed case file; returns the case or the problems found. */
export function validateCase(raw: unknown): { ok: true; value: BenchCase } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const o = (raw ?? {}) as Record<string, unknown>;
  const str = (k: string) => typeof o[k] === 'string' && (o[k] as string).trim() !== '';
  if (!str('id')) errors.push('id: a non-empty string');
  else if (!/^[a-z0-9][a-z0-9-]*$/.test(o.id as string)) errors.push('id: lower-case letters, digits and dashes');
  if (!str('log')) errors.push('log: the path of a frame log');
  if (!str('rationale')) errors.push('rationale: why, in rules terms');
  if (!BENCH_TYPES.includes(o.type as BenchType)) errors.push(`type: one of ${BENCH_TYPES.join(', ')}`);
  if (typeof o.seat !== 'number') errors.push('seat: the viewing seat (a number)');
  if (o.confidence !== 'high' && o.confidence !== 'low') errors.push('confidence: "high" or "low"');
  const m = o.moment as Record<string, unknown> | undefined;
  if (!m || typeof m.frame !== 'number' || (m.mode !== 'live' && m.mode !== 'review')) errors.push('moment: {mode: "live"|"review", frame}');
  else if (m.mode === 'review' && !DECISION_KINDS.includes(m.kind as DecisionKind)) errors.push(`moment.kind: one of ${DECISION_KINDS.join(', ')}`);
  const list = (k: string, min: number, max: number) => {
    const v = o[k];
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string') || v.length < min || v.length > max) errors.push(`${k}: ${min}–${max} answer strings`);
  };
  list('acceptable', 1, 3);
  list('unacceptable', 0, 12);
  for (const k of ['question', 'label', 'source'] as const) if (o[k] !== undefined && typeof o[k] !== 'string') errors.push(`${k}: a string`);
  if (o.lands !== undefined && typeof o.lands !== 'boolean') errors.push('lands: true or false');
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: o as unknown as BenchCase };
}

// ---------------------------------------------------------------------------
// The moment

/** The log as the play screen held it just before frame `frame`, and the open input / ask then. */
export function liveMoment(log: GameLog, frame: number): { log: GameLog; state: GameStateBody | null; input: InputBody | null; ask: AskBody | null } {
  const frames = log.frames.slice(0, frame);
  let state: GameStateBody | null = null;
  let input: InputBody | null = null;
  let ask: AskBody | null = null;
  for (const f of frames) {
    if (f.type === 'state') state = f.body as GameStateBody;
    else if (f.type === 'input') input = f.body as InputBody;
    else if (f.type === 'ask') ask = f.body as AskBody;
    else if (f.type === 'answer' && ask && (f.body as { askId?: string }).askId === ask.askId) ask = null;
    else if (f.type === 'over') ask = null;
  }
  return { log: { ...log, frames }, state, input, ask };
}

export interface BuiltMoment {
  /** The log the prompt is built from (truncated for a live moment). */
  log: GameLog;
  decision: Decision;
}

/** Rebuilds the case's decision; throws with a reason when the log doesn't have it. */
export function buildMoment(c: BenchCase, log: GameLog, cards: Map<string, CardInfo>): BuiltMoment {
  if (log.seat !== c.seat) throw new Error(`${c.id}: the log's viewing seat is ${log.seat}, the case says ${c.seat}`);
  if (c.moment.mode === 'live') {
    const { frame } = c.moment;
    if (frame <= 0 || frame > log.frames.length) throw new Error(`${c.id}: frame ${frame} is outside the log (0–${log.frames.length})`);
    const m = liveMoment(log, frame);
    const d = liveDecision({ log: m.log, state: m.state, input: m.input, ask: m.ask, seat: log.seat }, cards);
    if (!d) throw new Error(`${c.id}: no state before frame ${frame}`);
    return { log: m.log, decision: d };
  }
  const { frame, kind } = c.moment;
  const d = extractDecisions(log, { cards }).find((x) => x.frameIndex === frame && x.kind === kind);
  if (!d) throw new Error(`${c.id}: no ${kind} decision at frame ${frame}`);
  return { log, decision: d };
}

/** The card map the app would hand the prompt builder: the coach's names only. */
export function promptCards(log: GameLog, d: Decision, all: Map<string, CardInfo>): Map<string, CardInfo> {
  const out = new Map<string, CardInfo>();
  for (const n of coachCardNames(log, d)) {
    const info = all.get(n);
    if (info) out.set(n, info);
  }
  return out;
}

/** Names the prompt needs that the card snapshot lacks (the snapshot must cover every case). */
export function missingCards(log: GameLog, d: Decision, all: Map<string, CardInfo>): string[] {
  return coachCardNames(log, d).filter((n) => !all.has(n));
}

// ---------------------------------------------------------------------------
// Choices

export interface Choice {
  token: string;
  label: string;
}

/** What the bench offers and checks for one case. */
export interface ChoiceSet {
  type: BenchType;
  /** Fixed tokens (keep, cast:12, target:5, …). For attack / block, the atoms the answer is built from. */
  choices: Choice[];
  /** attack: who may attack. */
  attackers?: Card[];
  /** block: who may block, and the attackers. */
  blockers?: Card[];
  attacking?: Card[];
  /** Every visible card by id, for class keys. */
  byId: Map<number, Card>;
  /** block: ids with flying, and ids that can block fliers (flying or reach). */
  fliers?: Set<number>;
  reach?: Set<number>;
}

/** Does the card have this keyword (the state's keyword list, else a keyword line of its oracle text)? */
export function hasKeyword(c: Card, word: string, cards: Map<string, CardInfo>): boolean {
  if (keywordsOf(c).includes(word.toUpperCase())) return true;
  const text = infoFor(c.name, cards)?.oracleText ?? '';
  return text.split('\n').some((line) => line.replace(/\([^)]*\)/g, '').split(/,\s*/).some((k) => k.trim().toLowerCase() === word.toLowerCase()));
}

function visibleCards(s: GameStateBody): Map<number, Card> {
  const m = new Map<number, Card>();
  for (const p of s.players) for (const z of Object.values(p.zones)) for (const c of z.cards as AnyCard[]) if (!isHidden(c)) m.set(c.id, c as Card);
  for (const c of s.stackCards ?? []) if (!isHidden(c) && !m.has(c.id)) m.set(c.id, c as Card);
  return m;
}

const isCreature = (c: Card) => /\bCreature\b/.test(c.types);
const isLand = (c: Card) => /\bLand\b/.test(c.types);
const pt = (c: Card) => (c.power != null && c.toughness != null ? ` ${c.power}/${c.toughness}` : '');
const cardLabel = (c: Card) => `${c.name || 'face-down card'} #${c.id}${pt(c)}`;

/** A land that enters untapped adds one source this turn (lenient: unknown text counts as untapped). */
function landSource(c: Card, cards: Map<string, CardInfo>): ManaSource | null {
  const text = infoFor(c.name, cards)?.oracleText ?? '';
  if (/\benters (the battlefield )?tapped\b(?! unless)/i.test(text)) return null;
  const colors = manaColorsOf({ ...c, tapped: false, sick: false } as Card, cards);
  return colors === null ? null : { cardId: c.id, name: c.name, colors };
}

/** The legal choices for a case's decision. Heuristic for castability (mana only; targets and timing are not checked). */
export function choiceSet(type: BenchType, log: GameLog, d: Decision, cards: Map<string, CardInfo>, opts: { lands?: boolean } = {}): ChoiceSet {
  const s = d.state;
  const seat = log.seat;
  const byId = visibleCards(s);
  const me = s.players.find((p) => p.id === seat);
  const hand = (me?.zones.hand.cards ?? []).filter((c) => !isHidden(c)) as Card[];
  const mine = (me?.zones.battlefield.cards ?? []).filter((c) => !isHidden(c)) as Card[];
  const out: ChoiceSet = { type, choices: [], byId };
  const input = d.input;
  // The colours the seat chose for its Thriving-style lands, as the prompt states them.
  const chosen = chosenColors(log, d.frameIndex, seat, cards);
  switch (type) {
    case 'mulligan':
      out.choices = [
        { token: 'keep', label: 'keep this hand' },
        { token: 'mulligan', label: 'mulligan' },
      ];
      break;
    case 'play_draw':
      out.choices = [
        { token: 'play', label: 'play first' },
        { token: 'draw', label: 'draw first' },
      ];
      break;
    case 'spell': {
      const sources = untappedManaSources(s, seat, cards, chosen);
      const pool = (me?.manaPool ?? {}) as unknown as Record<string, number>;
      const myMain = s.activePlayer === seat && (s.phase === 'MAIN1' || s.phase === 'MAIN2') && s.stack.length === 0;
      const landOpen = myMain && turnFacts(log, d.frameIndex, seat).landPlayed === false;
      const extra = landOpen ? hand.filter(isLand).map((l) => landSource(l, cards)).filter((x): x is ManaSource => x !== null) : [];
      for (const c of hand) {
        if (isLand(c)) continue;
        const payable = canPay(c.manaCost, sources, pool) || extra.some((l) => canPay(c.manaCost, [...sources, l], pool));
        if (payable) out.choices.push({ token: `cast:${c.id}`, label: `cast ${c.name}${c.manaCost ? ` ${c.manaCost}` : ''}` });
      }
      if (opts.lands && landOpen) for (const c of hand.filter(isLand)) out.choices.push({ token: `land:${c.id}`, label: `play ${c.name}` });
      out.choices.push({ token: 'pass', label: opts.lands ? 'play nothing' : 'cast nothing' });
      break;
    }
    case 'pass': {
      for (const o of instantSpeedOptions(s, seat, cards, chosen)) {
        out.choices.push(
          o.via === 'ability'
            ? { token: `activate:${o.cardId}`, label: `activate ${o.name} (${o.cost})` }
            : { token: `cast:${o.cardId}`, label: `cast ${o.name}${o.cost ? ` ${o.cost}` : ''}` },
        );
      }
      out.choices.push({ token: 'pass', label: 'pass (do nothing now)' });
      break;
    }
    case 'attack': {
      // The engine's selectable set is not the clickable set (M8): it is often empty here, so fall back to the rules.
      const sel = input && /^Select creatures to attack/i.test(input.prompt) && input.selectable.cardIds.length ? new Set(input.selectable.cardIds) : null;
      out.attackers = mine.filter((c) =>
        sel ? sel.has(c.id) : isCreature(c) && !c.tapped && (!c.sick || keywordsOf(c).includes('HASTE')),
      );
      out.choices = out.attackers.map((c) => ({ token: String(c.id), label: cardLabel(c) }));
      break;
    }
    case 'block': {
      const sel = input && /^Select creatures to block/i.test(input.prompt) && input.selectable.cardIds.length ? new Set(input.selectable.cardIds) : null;
      const attackingIds = new Set<number>();
      for (const b of s.combat?.bands ?? []) {
        const at = b.defender;
        const atMe = at?.kind === 'player' ? at.id === seat : at ? mine.some((c) => c.id === at.id) : true;
        if (atMe) b.attackerIds.forEach((id) => attackingIds.add(id));
      }
      out.attacking = [...attackingIds].map((id) => byId.get(id)).filter((c): c is Card => !!c);
      out.blockers = mine.filter((c) => (sel ? sel.has(c.id) : isCreature(c) && !c.tapped));
      out.fliers = new Set(out.attacking.filter((c) => hasKeyword(c, 'Flying', cards)).map((c) => c.id));
      out.reach = new Set(out.blockers.filter((c) => hasKeyword(c, 'Flying', cards) || hasKeyword(c, 'Reach', cards)).map((c) => c.id));
      out.choices = [
        ...out.blockers.map((c) => ({ token: `blocker ${c.id}`, label: cardLabel(c) })),
        ...out.attacking.map((c) => ({ token: `attacker ${c.id}`, label: cardLabel(c) })),
      ];
      break;
    }
    case 'target': {
      const ids = input && input.selectable.mode !== 'none' ? input.selectable.cardIds : [];
      for (const id of ids) {
        const c = byId.get(id);
        const owner = s.players.find((p) => Object.values(p.zones).some((z) => (z.cards as AnyCard[]).some((x) => x.id === id)));
        const whose = owner ? (owner.id === seat ? 'yours' : "opponent's") : '';
        out.choices.push({ token: `target:${id}`, label: c ? `${cardLabel(c)}${whose ? ` (${whose})` : ''}` : `#${id}` });
      }
      break;
    }
    case 'choice': {
      const ask = d.ask;
      if (ask?.kind === 'confirm') {
        out.choices = [
          { token: 'yes', label: ask.yesLabel || 'yes' },
          { token: 'no', label: ask.noLabel || 'no' },
        ];
      } else if (ask && 'options' in ask && Array.isArray(ask.options)) {
        for (const o of ask.options as { id: number; label: string }[]) out.choices.push({ token: `option:${o.id}`, label: o.label });
      }
      break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Answers

export type Parsed =
  | { kind: 'word'; word: string }
  | { kind: 'id'; verb: 'cast' | 'land' | 'activate' | 'target' | 'option'; id: number }
  | { kind: 'attack'; ids: number[] }
  | { kind: 'block'; pairs: [number, number][] };

const WORDS = new Set(['keep', 'mulligan', 'play', 'draw', 'pass', 'yes', 'no']);

/** Parses one answer token ("attack: #21, #26", "block:12>34", "cast:5", "keep"). Null when it isn't one. */
export function parseAnswer(raw: string): Parsed | null {
  let t = raw.trim().replace(/[`*_]/g, '').replace(/[.;]+$/, '').trim().toLowerCase();
  t = t.replace(/\s*:\s*/, ':');
  if (WORDS.has(t)) return { kind: 'word', word: t };
  let m = /^(cast|land|activate|target|option):#?(\d+)$/.exec(t.replace(/\s+/g, ''));
  if (m) return { kind: 'id', verb: m[1] as 'cast', id: Number(m[2]) };
  m = /^attack:(.*)$/.exec(t);
  if (m) {
    const rest = m[1]!.trim();
    if (/^(none|no attack(ers)?|nothing)$/.test(rest)) return { kind: 'attack', ids: [] };
    const parts = rest.split(/[,\s]+/).filter(Boolean);
    if (!parts.length || parts.some((p) => !/^#?\d+$/.test(p))) return null;
    return { kind: 'attack', ids: [...new Set(parts.map((p) => Number(p.replace('#', ''))))].sort((a, b) => a - b) };
  }
  m = /^block:(.*)$/.exec(t);
  if (m) {
    const rest = m[1]!.trim();
    if (/^(none|no block(s|ers)?|nothing)$/.test(rest)) return { kind: 'block', pairs: [] };
    const pairs: [number, number][] = [];
    for (const part of rest.split(/\s*,\s*/).filter(Boolean)) {
      const p = /^#?(\d+)\s*(?:->|>|→)\s*#?(\d+)$/.exec(part.trim());
      if (!p) return null;
      pairs.push([Number(p[1]), Number(p[2])]);
    }
    if (!pairs.length) return null;
    return { kind: 'block', pairs: pairs.sort((a, b) => a[1] - b[1] || a[0] - b[0]) };
  }
  return null;
}

/** The one canonical spelling of a parsed answer. */
export function formatAnswer(p: Parsed): string {
  switch (p.kind) {
    case 'word':
      return p.word;
    case 'id':
      return `${p.verb}:${p.id}`;
    case 'attack':
      return p.ids.length ? `attack:${p.ids.join(',')}` : 'attack:none';
    case 'block':
      return p.pairs.length ? `block:${p.pairs.map(([b, a]) => `${b}>${a}`).join(',')}` : 'block:none';
  }
}

/** Why `p` is not a legal answer here, or null when it is. */
export function illegalReason(p: Parsed, cs: ChoiceSet): string | null {
  const tokens = new Set(cs.choices.map((c) => c.token));
  switch (cs.type) {
    case 'attack': {
      if (p.kind !== 'attack') return 'expected attack:none or attack:<ids>';
      const ok = new Set((cs.attackers ?? []).map((c) => c.id));
      const bad = p.ids.filter((id) => !ok.has(id));
      return bad.length ? `can't attack with ${bad.map((x) => `#${x}`).join(', ')}` : null;
    }
    case 'block': {
      if (p.kind !== 'block') return 'expected block:none or block:<blocker>><attacker>,…';
      const bl = new Set((cs.blockers ?? []).map((c) => c.id));
      const at = new Set((cs.attacking ?? []).map((c) => c.id));
      const seen = new Set<number>();
      for (const [b, a] of p.pairs) {
        if (!bl.has(b)) return `#${b} can't block`;
        if (!at.has(a)) return `#${a} isn't attacking you`;
        if (cs.fliers?.has(a) && !cs.reach?.has(b)) return `#${b} can't block #${a} (flying)`;
        if (seen.has(b)) return `#${b} blocks twice`;
        seen.add(b);
      }
      return null;
    }
    default: {
      if (p.kind === 'attack' || p.kind === 'block') return `expected one of: ${[...tokens].join(', ')}`;
      const f = formatAnswer(p);
      return tokens.has(f) ? null : `${f} is not one of: ${[...tokens].join(', ')}`;
    }
  }
}

/** What makes two creatures interchangeable in combat (the viewer's view of them). */
function classKey(c: Card | undefined, id: number): string {
  if (!c || !c.name) return `#${id}`;
  const kw = [...keywordsOf(c)].sort().join('+');
  const ctr = Object.entries(c.counters ?? {})
    .filter(([, n]) => n)
    .sort()
    .map(([k, n]) => `${k}${n}`)
    .join('+');
  return [c.name, c.power, c.toughness, kw, ctr, c.damage, c.attachmentIds.length, c.sick ? 'sick' : ''].join('|');
}

/** The answer with creatures replaced by their class, for matching (identical creatures are interchangeable). */
export function matchKey(p: Parsed, cs: ChoiceSet): string {
  const k = (id: number) => classKey(cs.byId.get(id), id);
  if (p.kind === 'attack') return `attack:${p.ids.map(k).sort().join(',')}`;
  if (p.kind === 'block') {
    const blockKey = (id: number) => k(id).replace(/\|sick$/, '|');
    return `block:${p.pairs.map(([b, a]) => `${blockKey(b)}>${k(a)}`).sort().join(',')}`;
  }
  return formatAnswer(p);
}

// ---------------------------------------------------------------------------
// The bench prompt

const DEFAULT_QUESTION: Record<BenchType, string> = {
  mulligan: 'Keep this opening hand, or mulligan?',
  play_draw: 'You choose who goes first: play first or draw first?',
  spell: 'Which spell should you cast first now — or none?',
  pass: 'You have priority now. Cast or activate something now, or pass?',
  attack: 'Which creatures should attack?',
  block: 'How should you block?',
  target: 'Which target should you choose?',
  choice: 'Which option should you choose?',
};

function formatHelp(type: BenchType): string[] {
  switch (type) {
    case 'attack':
      return ['ANSWER: attack:<id>,<id>,…   (every creature that attacks, by #id), or', 'ANSWER: attack:none'];
    case 'block':
      return [
        'ANSWER: block:<blocker id>><attacker id>,…   (one pair per blocker; two pairs on one attacker is a double block), or',
        'ANSWER: block:none',
      ];
    default:
      return ['ANSWER: <one choice token below, exactly>'];
  }
}

/** The bench-only section appended to the app's prompt. */
export function benchSection(c: Pick<BenchCase, 'type' | 'question'>, cs: ChoiceSet): string {
  const lines = ['# Bench answer', c.question?.trim() || DEFAULT_QUESTION[c.type], ''];
  lines.push('Answer in your usual format. Then end with exactly one final line, in this form:');
  lines.push(...formatHelp(c.type));
  if (c.type === 'attack') {
    lines.push('', 'Creatures that can attack:');
    lines.push(...(cs.attackers ?? []).map((x) => `- #${x.id} ${cardLabel(x)}`));
  } else if (c.type === 'block') {
    lines.push('', 'Creatures that can block:');
    lines.push(...(cs.blockers ?? []).map((x) => `- #${x.id} ${cardLabel(x)}`));
    lines.push('Attacking you:');
    lines.push(...(cs.attacking ?? []).map((x) => `- #${x.id} ${cardLabel(x)}`));
  } else {
    lines.push('', 'Choices:');
    lines.push(...cs.choices.map((x) => `- ${x.token} — ${x.label}`));
  }
  return lines.join('\n');
}

export interface BuiltCase {
  case: BenchCase;
  moment: BuiltMoment;
  choices: ChoiceSet;
  prompt: Prompt;
  /** The app's prompt without the bench section (what a player would have been sent). */
  appPrompt: Prompt;
}

/** Builds a case's prompt exactly as the app would, plus the bench section. */
export function buildCase(c: BenchCase, log: GameLog, cards: Map<string, CardInfo>): BuiltCase {
  const moment = buildMoment(c, log, cards);
  const appPrompt = buildCoachPrompt(moment.log, moment.decision, promptCards(moment.log, moment.decision, cards));
  const choices = choiceSet(c.type, moment.log, moment.decision, cards, { lands: c.lands });
  const prompt = { system: appPrompt.system, user: `${appPrompt.user}\n\n${benchSection(c, choices)}` };
  return { case: c, moment, choices, prompt, appPrompt };
}

/** Problems with a built case's answer lists: unparsable or illegal answers, overlaps, a moved moment. */
export function caseProblems(b: BuiltCase): string[] {
  const out: string[] = [];
  const c = b.case;
  if (c.label && b.moment.decision.label !== c.label) out.push(`label is "${b.moment.decision.label}", the case says "${c.label}"`);
  const keys = new Map<string, string>();
  for (const [list, answers] of [
    ['acceptable', c.acceptable],
    ['unacceptable', c.unacceptable],
  ] as const) {
    for (const a of answers) {
      const p = parseAnswer(a);
      if (!p) {
        out.push(`${list}: "${a}" is not an answer token`);
        continue;
      }
      const why = illegalReason(p, b.choices);
      if (why) out.push(`${list}: "${a}" is not legal here (${why})`);
      const k = matchKey(p, b.choices);
      const prev = keys.get(k);
      if (prev && prev !== list) out.push(`"${a}" is both acceptable and unacceptable`);
      keys.set(k, list);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scoring

/** The answer on the last `ANSWER:` line of a coach reply, or null. */
export function extractAnswer(text: string): string | null {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^[\s>*_`-]*answer\s*:\s*(.+?)\s*$/i.exec(lines[i]!.replace(/\*\*/g, ''));
    if (m) return m[1]!.replace(/[`*]+/g, '').trim();
  }
  return null;
}

export type Verdict = 'acceptable' | 'unacceptable' | 'other' | 'illegal' | 'missing';

export interface Scored {
  answer: string | null;
  canonical: string | null;
  verdict: Verdict;
  score: -1 | 0 | 1;
  note?: string;
}

/** acceptable = 1, blunder = −1, anything else (incl. a missing or illegal answer) = 0. */
export function scoreReply(b: BuiltCase, text: string): Scored {
  const answer = extractAnswer(text);
  if (answer === null) return { answer, canonical: null, verdict: 'missing', score: 0, note: 'no ANSWER: line' };
  const p = parseAnswer(answer);
  if (!p) return { answer, canonical: null, verdict: 'illegal', score: 0, note: 'not an answer token' };
  const canonical = formatAnswer(p);
  const why = illegalReason(p, b.choices);
  if (why) return { answer, canonical, verdict: 'illegal', score: 0, note: why };
  const k = matchKey(p, b.choices);
  const keyOf = (a: string) => {
    const q = parseAnswer(a);
    return q ? matchKey(q, b.choices) : null;
  };
  if (b.case.acceptable.some((a) => keyOf(a) === k)) return { answer, canonical, verdict: 'acceptable', score: 1 };
  if (b.case.unacceptable.some((a) => keyOf(a) === k)) return { answer, canonical, verdict: 'unacceptable', score: -1 };
  return { answer, canonical, verdict: 'other', score: 0 };
}

// ---------------------------------------------------------------------------
// Running and reports
//
// The coach is stochastic, so each case is asked `repeat` times and every
// answer is kept. A case's quality score is the mean score of its *valid*
// answers (acceptable +1, blunder −1, any other legal answer 0). Answers that
// are missing, unparsable, illegal or errored are format failures: they are
// counted on their own and never enter the quality score.

export interface CoachReply {
  text: string;
  /** The model that answered, when the source says. */
  model?: string;
}
export type AskCoach = (prompt: Prompt, signal?: AbortSignal) => Promise<CoachReply>;

/** One answer to one case. */
export interface Sample {
  verdict: Verdict | 'error';
  /** 1, 0 or −1; meaningful only when the answer is valid (see `isValid`). */
  score: number;
  answer: string | null;
  canonical: string | null;
  note?: string;
  latencyMs: number;
  model?: string;
  /** The coach's full reply (or the error message). */
  text: string;
}

/** A parsed, legal answer (acceptable, blunder or other): the quality score only looks at these. */
export const isValid = (s: Pick<Sample, 'verdict'>): boolean => s.verdict === 'acceptable' || s.verdict === 'unacceptable' || s.verdict === 'other';

export interface CaseStats {
  /** Answers recorded. */
  n: number;
  /** Answers that were valid (not a format failure). */
  valid: number;
  /** Mean score of the valid answers; null when none was valid. */
  meanScore: number | null;
  /** Counts; `unparsed` is every format failure (missing, illegal, error). They add up to `n`. */
  acceptable: number;
  unacceptable: number;
  other: number;
  unparsed: number;
  /** The share of answers equal to the most common one (1 = always the same answer). */
  agreement: number;
  /** The distinct answers seen, most common first (format failures as "(missing)" etc.). */
  answers: { answer: string; count: number }[];
}

export interface CaseResult {
  id: string;
  type: BenchType;
  confidence: 'high' | 'low';
  samples: Sample[];
  stats: CaseStats;
}

export function caseStats(samples: Sample[]): CaseStats {
  const counts = { acceptable: 0, unacceptable: 0, other: 0, unparsed: 0 };
  const seen = new Map<string, number>();
  const scores: number[] = [];
  for (const s of samples) {
    if (s.verdict === 'acceptable') counts.acceptable++;
    else if (s.verdict === 'unacceptable') counts.unacceptable++;
    else if (s.verdict === 'other') counts.other++;
    else counts.unparsed++;
    if (isValid(s)) scores.push(s.score);
    const key = isValid(s) ? (s.canonical ?? s.answer ?? '?') : `(${s.verdict})`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const answers = [...seen].map(([answer, count]) => ({ answer, count })).sort((a, b) => b.count - a.count || a.answer.localeCompare(b.answer));
  return {
    n: samples.length,
    valid: scores.length,
    meanScore: scores.length ? mean(scores) : null,
    ...counts,
    agreement: samples.length ? answers[0]!.count / samples.length : 1,
    answers,
  };
}

export type { Interval } from './benchStats.ts';

export interface GroupSummary {
  /** High-confidence cases in the group. */
  cases: number;
  /** Answers recorded for them. */
  samples: number;
  /** Mean over cases of each case's mean valid score, −1…1; bootstrap over cases. */
  score: Interval | null;
  /** Mean over cases of the share of valid answers that were acceptable / blunders. */
  acceptable: Interval | null;
  blunder: Interval | null;
  /** Share of all answers that were format failures; Wilson interval over answers. */
  formatFailure: Interval | null;
  /** Cases whose agreement is below UNSTABLE_BELOW. */
  unstable: number;
}

/** A case is unstable when fewer than two thirds of its answers equal the modal one. */
export const UNSTABLE_BELOW = 0.67;

export interface BenchReport {
  bench: 2;
  label: string;
  startedAt: string;
  source: string;
  model: string | null;
  /** Answers asked per case. */
  repeat: number;
  cases: CaseResult[];
  summary: {
    byType: Partial<Record<BenchType, GroupSummary>>;
    total: GroupSummary;
    /** Low-confidence cases run but not scored. */
    lowConfidence: number;
    latencyMs: { mean: number; median: number; p90: number; max: number };
  };
}

export interface RunOptions {
  label: string;
  source: string;
  model?: string | null;
  /** Answers per case (default 1). */
  repeat?: number;
  /** Calls in flight at once (default 1). */
  concurrency?: number;
  now?: () => number;
  /** Called after each answer; `done` of `total` answers are in. */
  onResult?: (r: { id: string; type: BenchType; rep: number; sample: Sample }, done: number, total: number) => void;
  signal?: AbortSignal;
}

async function askOnce(b: BuiltCase, ask: AskCoach, now: () => number, signal?: AbortSignal): Promise<Sample> {
  const t0 = now();
  try {
    const reply = await ask(b.prompt, signal);
    const s = scoreReply(b, reply.text);
    const out: Sample = { ...s, latencyMs: now() - t0, text: reply.text };
    if (reply.model) out.model = reply.model;
    if (out.note === undefined) delete out.note;
    return out;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { verdict: 'error', score: 0, answer: null, canonical: null, note: msg, latencyMs: now() - t0, text: msg };
  }
}

/** Asks the coach every case `repeat` times (`concurrency` calls at once) and scores the replies. */
export async function runBench(built: BuiltCase[], ask: AskCoach, o: RunOptions): Promise<BenchReport> {
  const now = o.now ?? Date.now;
  const startedAt = new Date(now()).toISOString();
  const repeat = Math.max(1, Math.floor(o.repeat ?? 1));
  const workers = Math.max(1, Math.floor(o.concurrency ?? 1));
  // One pass over all cases, then the next: an interrupted run still has a sample of every case.
  const tasks: { bi: number; rep: number }[] = [];
  for (let rep = 0; rep < repeat; rep++) for (let bi = 0; bi < built.length; bi++) tasks.push({ bi, rep });
  const samples: (Sample | undefined)[][] = built.map(() => new Array(repeat).fill(undefined));
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < tasks.length && !o.signal?.aborted) {
      const t = tasks[next++]!;
      const b = built[t.bi]!;
      const sample = await askOnce(b, ask, now, o.signal);
      samples[t.bi]![t.rep] = sample;
      o.onResult?.({ id: b.case.id, type: b.case.type, rep: t.rep, sample }, ++done, tasks.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(workers, tasks.length) }, worker));
  const cases: CaseResult[] = [];
  built.forEach((b, i) => {
    const got = samples[i]!.filter((s): s is Sample => !!s);
    if (got.length) cases.push({ id: b.case.id, type: b.case.type, confidence: b.case.confidence, samples: got, stats: caseStats(got) });
  });
  const model = o.model ?? cases.flatMap((c) => c.samples).find((s) => s.model)?.model ?? null;
  return { bench: 2, label: o.label, startedAt, source: o.source, model, repeat, cases, summary: summarize(cases) };
}

function groupSummary(cases: CaseResult[]): GroupSummary {
  const withValid = cases.filter((c) => c.stats.valid > 0);
  const failures = cases.reduce((a, c) => a + c.stats.unparsed, 0);
  const samples = cases.reduce((a, c) => a + c.stats.n, 0);
  return {
    cases: cases.length,
    samples,
    score: bootstrapMean(withValid.map((c) => c.stats.meanScore!)),
    acceptable: bootstrapMean(withValid.map((c) => c.stats.acceptable / c.stats.valid)),
    blunder: bootstrapMean(withValid.map((c) => c.stats.unacceptable / c.stats.valid)),
    formatFailure: wilson(failures, samples),
    unstable: cases.filter((c) => c.stats.agreement < UNSTABLE_BELOW).length,
  };
}

export function summarize(cases: CaseResult[]): BenchReport['summary'] {
  const scored = cases.filter((c) => c.confidence !== 'low');
  const byType: Partial<Record<BenchType, GroupSummary>> = {};
  for (const t of BENCH_TYPES) {
    const of = scored.filter((c) => c.type === t);
    if (of.length) byType[t] = groupSummary(of);
  }
  const lat = cases.flatMap((c) => c.samples.map((s) => s.latencyMs)).sort((a, b) => a - b);
  const at = (q: number) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(q * lat.length))]! : 0);
  return {
    byType,
    total: groupSummary(scored),
    lowConfidence: cases.length - scored.length,
    latencyMs: { mean: Math.round(mean(lat)), median: at(0.5), p90: at(0.9), max: lat.length ? lat[lat.length - 1]! : 0 },
  };
}

/**
 * Reads a results file of either format. A single-sample file (`bench: 1`, one
 * reply per case) becomes N=1 and carries a warning; stats and the summary are
 * always recomputed from the samples.
 */
export function normalizeReport(raw: unknown): { report: BenchReport; warnings: string[] } {
  const o = raw as { bench?: number; cases?: unknown[]; label?: string; startedAt?: string; source?: string; model?: string | null; repeat?: number };
  if (!o || (o.bench !== 1 && o.bench !== 2) || !Array.isArray(o.cases)) throw new Error('not a coach bench results file');
  const warnings: string[] = [];
  let cases: CaseResult[];
  if (o.bench === 1) {
    warnings.push(`${o.label ?? 'results'}: an old single-sample file; treated as N=1 (no repeats, so its noise cannot be measured).`);
    cases = (o.cases as (Sample & { id: string; type: BenchType; confidence: 'high' | 'low' })[]).map((c) => {
      const { id, type, confidence, ...sample } = c;
      return { id, type, confidence, samples: [sample], stats: caseStats([sample]) };
    });
  } else {
    cases = (o.cases as CaseResult[]).map((c) => ({ id: c.id, type: c.type, confidence: c.confidence, samples: c.samples, stats: caseStats(c.samples) }));
  }
  const report: BenchReport = {
    bench: 2,
    label: o.label ?? '?',
    startedAt: o.startedAt ?? '',
    source: o.source ?? '',
    model: o.model ?? null,
    repeat: o.bench === 1 ? 1 : (o.repeat ?? Math.max(1, ...cases.map((c) => c.stats.n))),
    cases,
    summary: summarize(cases),
  };
  return { report, warnings };
}

// ---------------------------------------------------------------------------
// Markdown

const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const num = (x: number) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(2);
const ci = (i: Interval | null, f: (x: number) => string = (x) => x.toFixed(2)) => (i ? `${f(i.mean)} [${f(i.lo)}, ${f(i.hi)}]` : '—');
const esc = (s: string) => s.replace(/\|/g, '\\|');

export function reportMarkdown(r: BenchReport): string {
  const s = r.summary;
  const t = s.total;
  const lines = [
    `# Coach bench — ${r.label}`,
    '',
    `${r.startedAt} · source: ${r.source}${r.model ? ` · model: ${r.model}` : ''} · ${r.repeat} answer${r.repeat === 1 ? '' : 's'} per case`,
    '',
    `**Quality score ${ci(t.score)}** (mean over ${t.cases} cases, −1 to +1, 95% interval by bootstrap over cases) · ` +
      `acceptable ${ci(t.acceptable, pct)} · blunder ${ci(t.blunder, pct)}`,
    '',
    `Format failures (missing, illegal or errored answers; not in the score): ${ci(t.formatFailure, pct)} of ${t.samples} answers (Wilson interval)` +
      (s.lowConfidence ? ` · ${s.lowConfidence} low-confidence case${s.lowConfidence > 1 ? 's' : ''} not scored` : ''),
    '',
    `Unstable cases (agreement below ${UNSTABLE_BELOW}): ${t.unstable} of ${t.cases}`,
    '',
    `Latency per answer: mean ${secs(s.latencyMs.mean)}, median ${secs(s.latencyMs.median)}, p90 ${secs(s.latencyMs.p90)}, max ${secs(s.latencyMs.max)}`,
    '',
    r.repeat < 2 ? '_One answer per case: intervals only reflect which cases were picked. Use --repeat 3 or more to see the coach\'s own noise._\n' : '',
    '| type | cases | score (95%) | acceptable | blunder | format fail | unstable |',
    '|---|---:|---|---:|---:|---:|---:|',
  ];
  for (const ty of BENCH_TYPES) {
    const x = s.byType[ty];
    if (x) lines.push(`| ${ty} | ${x.cases} | ${ci(x.score)} | ${x.acceptable ? pct(x.acceptable.mean) : '—'} | ${x.blunder ? pct(x.blunder.mean) : '—'} | ${x.formatFailure ? pct(x.formatFailure.mean) : '—'} | ${x.unstable} |`);
  }
  lines.push('', '| case | type | mean | ok / blunder / other / format | agree | answers seen |', '|---|---|---:|---|---:|---|');
  for (const c of r.cases) {
    const k = c.stats;
    const low = c.confidence === 'low' ? ' (low, unscored)' : '';
    const answers = k.answers.map((a) => `${a.answer}×${a.count}`).join(', ');
    lines.push(`| ${c.id}${low} | ${c.type} | ${k.meanScore === null ? '—' : num(k.meanScore)} | ${k.acceptable} / ${k.unacceptable} / ${k.other} / ${k.unparsed} | ${pct(k.agreement)} | ${esc(answers)} |`);
  }
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Comparing two runs

export interface CaseDiff {
  id: string;
  type: BenchType;
  a: CaseStats;
  b: CaseStats;
  /** B's mean score minus A's, or null when either had no valid answer. */
  diff: number | null;
  /** Set only when every valid answer of one run beats every valid answer of the other (both runs with 2+ answers). */
  flip: 'better' | 'worse' | null;
  /** Which runs have agreement below UNSTABLE_BELOW on this case. */
  unstable: ('A' | 'B')[];
}

export type Verdict3 = 'better' | 'worse' | 'none';

export interface Comparison {
  cases: CaseDiff[];
  flips: CaseDiff[];
  unstable: CaseDiff[];
  onlyA: string[];
  onlyB: string[];
  paired: {
    /** Cases that entered the paired test (high confidence in both, valid answers in both). */
    n: number;
    up: number;
    down: number;
    ties: number;
    /** Mean of per-case differences (B − A) with a 95% paired-bootstrap interval. */
    mean: Interval | null;
    /** Sum of the differences, with the interval scaled to match. */
    total: Interval | null;
    /** Exact two-sided sign test p-value. */
    signP: number;
  };
  verdict: Verdict3;
  verdictText: string;
  warnings: string[];
  /** Total difference in the quality score (kept for callers that want one number). */
  delta: number;
  markdown: string;
}

/** The fewest paired cases for which the verdict will call a difference. */
export const MIN_PAIRED_CASES = 5;

/**
 * Paired comparison of two runs over the cases they share. Each case's
 * difference is its mean score in B minus its mean score in A; the verdict
 * says B is better or worse only when the 95% bootstrap interval of the mean
 * difference (resampling cases) excludes zero.
 */
export function compareReports(a: BenchReport, b: BenchReport): Comparison {
  const bi = new Map(b.cases.map((c) => [c.id, c]));
  const ai = new Map(a.cases.map((c) => [c.id, c]));
  const onlyA = a.cases.filter((c) => !bi.has(c.id)).map((c) => c.id);
  const onlyB = b.cases.filter((c) => !ai.has(c.id)).map((c) => c.id);
  const warnings: string[] = [];
  for (const [name, r] of [['A', a], ['B', b]] as const) {
    if (Math.max(0, ...r.cases.map((c) => c.stats.n)) < 2) warnings.push(`${name} (${r.label}) has one answer per case: a case difference cannot be told from noise, so no flips are flagged and the interval below is the only guide.`);
  }
  const cases: CaseDiff[] = [];
  const diffs: number[] = [];
  for (const x of a.cases) {
    const y = bi.get(x.id);
    if (!y) continue;
    const both = x.confidence !== 'low' && y.confidence !== 'low';
    const diff = both && x.stats.meanScore !== null && y.stats.meanScore !== null ? y.stats.meanScore - x.stats.meanScore : null;
    if (diff !== null) diffs.push(diff);
    const sa = x.samples.filter(isValid).map((s) => s.score);
    const sb = y.samples.filter(isValid).map((s) => s.score);
    let flip: CaseDiff['flip'] = null;
    if (both && sa.length >= 2 && sb.length >= 2) {
      if (Math.min(...sb) > Math.max(...sa)) flip = 'better';
      else if (Math.max(...sb) < Math.min(...sa)) flip = 'worse';
    }
    const unstable: CaseDiff['unstable'] = [];
    if (both && x.stats.agreement < UNSTABLE_BELOW) unstable.push('A');
    if (both && y.stats.agreement < UNSTABLE_BELOW) unstable.push('B');
    cases.push({ id: x.id, type: x.type, a: x.stats, b: y.stats, diff, flip, unstable });
  }
  const up = diffs.filter((d) => d > 1e-9).length;
  const down = diffs.filter((d) => d < -1e-9).length;
  const m = bootstrapMean(diffs);
  const n = diffs.length;
  const total = m ? { mean: m.mean * n, lo: m.lo * n, hi: m.hi * n } : null;
  const signP = signTest(up, down);
  let verdict: Verdict3 = 'none';
  let why = '';
  if (n < MIN_PAIRED_CASES) why = ` (only ${n} paired case${n === 1 ? '' : 's'}; need ${MIN_PAIRED_CASES})`;
  else if (m && m.lo > 0) verdict = 'better';
  else if (m && m.hi < 0) verdict = 'worse';
  const bName = `B (${b.label})`;
  const verdictText =
    verdict === 'better'
      ? `${bName} is better than A (${a.label}): the 95% interval of the mean difference excludes zero.`
      : verdict === 'worse'
        ? `${bName} is worse than A (${a.label}): the 95% interval of the mean difference excludes zero.`
        : `No detectable difference between A (${a.label}) and ${bName}${why || ': the 95% interval of the mean difference includes zero'}.`;

  const flips = cases.filter((c) => c.flip);
  const unstable = cases.filter((c) => c.unstable.length);
  const lines = [`# Coach bench — A ${a.label} → B ${b.label}`, '', `**Verdict: ${verdictText}**`, ''];
  for (const w of warnings) lines.push(`> Warning: ${w}`);
  if (warnings.length) lines.push('');
  lines.push(
    `Paired over ${n} cases (${a.repeat} vs ${b.repeat} answers per case). Mean score difference (B − A) ${m ? ci(m, num) : '—'}; ` +
      `total ${total ? ci(total, num) : '—'}. Cases better ${up}, worse ${down}, unchanged ${n - up - down}; sign test p = ${signP.toFixed(3)}.`,
    '',
    `Quality score A ${ci(a.summary.total.score)} · B ${ci(b.summary.total.score)}`,
    `Acceptable A ${ci(a.summary.total.acceptable, pct)} · B ${ci(b.summary.total.acceptable, pct)}`,
    `Blunder A ${ci(a.summary.total.blunder, pct)} · B ${ci(b.summary.total.blunder, pct)}`,
    `Format failures A ${ci(a.summary.total.formatFailure, pct)} · B ${ci(b.summary.total.formatFailure, pct)} (separate from the score)`,
    `Median latency per answer ${secs(a.summary.latencyMs.median)} → ${secs(b.summary.latencyMs.median)}`,
    '',
  );
  const row = (c: CaseDiff) =>
    `- ${c.id} (${c.type}): ${c.a.meanScore === null ? '—' : num(c.a.meanScore)} → ${c.b.meanScore === null ? '—' : num(c.b.meanScore)}` +
    ` · A: ${c.a.answers.map((x) => `${x.answer}×${x.count}`).join(', ')} · B: ${c.b.answers.map((x) => `${x.answer}×${x.count}`).join(', ')}`;
  const fb = flips.filter((c) => c.flip === 'better');
  const fw = flips.filter((c) => c.flip === 'worse');
  lines.push(`## Flips beyond noise: better (${fb.length})`, ...fb.map(row), '', `## Flips beyond noise: worse (${fw.length})`, ...fw.map(row), '');
  lines.push(`_A flip is flagged only when every valid answer of one run scores above every valid answer of the other, with 2+ answers in each._`, '');
  lines.push(`## Unstable cases (agreement below ${UNSTABLE_BELOW}) (${unstable.length})`);
  for (const c of unstable) lines.push(`- ${c.id} (${c.type}): ${c.unstable.map((u) => `${u} ${pct((u === 'A' ? c.a : c.b).agreement)}`).join(', ')}`);
  lines.push('', '## Per-case difference (B − A), cases that differ', '', '| case | type | A mean | B mean | diff |', '|---|---|---:|---:|---:|');
  for (const c of cases.filter((x) => x.diff !== null && Math.abs(x.diff) > 1e-9).sort((p, q) => q.diff! - p.diff!)) {
    lines.push(`| ${c.id}${c.flip ? ` (flip ${c.flip})` : ''} | ${c.type} | ${num(c.a.meanScore!)} | ${num(c.b.meanScore!)} | ${num(c.diff!)} |`);
  }
  if (onlyA.length) lines.push('', `Only in A (${a.label}): ${onlyA.join(', ')}`);
  if (onlyB.length) lines.push('', `Only in B (${b.label}): ${onlyB.join(', ')}`);
  return {
    cases,
    flips,
    unstable,
    onlyA,
    onlyB,
    paired: { n, up, down, ties: n - up - down, mean: m, total, signP },
    verdict,
    verdictText,
    warnings,
    delta: total?.mean ?? 0,
    markdown: lines.join('\n') + '\n',
  };
}
