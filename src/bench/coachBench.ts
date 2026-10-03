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

export interface CoachReply {
  text: string;
  /** The model that answered, when the source says. */
  model?: string;
}
export type AskCoach = (prompt: Prompt, signal?: AbortSignal) => Promise<CoachReply>;

export interface CaseResult {
  id: string;
  type: BenchType;
  confidence: 'high' | 'low';
  verdict: Verdict | 'error';
  score: number;
  answer: string | null;
  canonical: string | null;
  note?: string;
  latencyMs: number;
  model?: string;
  /** The coach's full reply (or the error message). */
  text: string;
}

export interface TypeSummary {
  n: number;
  score: number;
  acceptable: number;
  unacceptable: number;
  other: number;
  /** Missing, illegal and errored answers. */
  invalid: number;
}

export interface BenchReport {
  bench: 1;
  label: string;
  startedAt: string;
  source: string;
  model: string | null;
  cases: CaseResult[];
  summary: {
    byType: Partial<Record<BenchType, TypeSummary>>;
    total: TypeSummary;
    /** Low-confidence cases run but not scored. */
    lowConfidence: number;
    latencyMs: { mean: number; median: number; p90: number; max: number };
  };
}

export interface RunOptions {
  label: string;
  source: string;
  model?: string | null;
  now?: () => number;
  /** Called after each case. */
  onResult?: (r: CaseResult, i: number, n: number) => void;
  signal?: AbortSignal;
}

/** Asks the coach every case, one at a time, and scores the replies. */
export async function runBench(built: BuiltCase[], ask: AskCoach, o: RunOptions): Promise<BenchReport> {
  const now = o.now ?? Date.now;
  const startedAt = new Date(now()).toISOString();
  const results: CaseResult[] = [];
  for (let i = 0; i < built.length; i++) {
    if (o.signal?.aborted) break;
    const b = built[i]!;
    const t0 = now();
    let r: CaseResult;
    try {
      const reply = await ask(b.prompt, o.signal);
      const s = scoreReply(b, reply.text);
      r = { id: b.case.id, type: b.case.type, confidence: b.case.confidence, ...s, latencyMs: now() - t0, text: reply.text };
      if (reply.model) r.model = reply.model;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      r = { id: b.case.id, type: b.case.type, confidence: b.case.confidence, verdict: 'error', score: 0, answer: null, canonical: null, note: msg, latencyMs: now() - t0, text: msg };
    }
    if (r.note === undefined) delete r.note;
    results.push(r);
    o.onResult?.(r, i, built.length);
  }
  return { bench: 1, label: o.label, startedAt, source: o.source, model: o.model ?? results.find((r) => r.model)?.model ?? null, cases: results, summary: summarize(results) };
}

function blank(): TypeSummary {
  return { n: 0, score: 0, acceptable: 0, unacceptable: 0, other: 0, invalid: 0 };
}

export function summarize(results: CaseResult[]): BenchReport['summary'] {
  const byType: Partial<Record<BenchType, TypeSummary>> = {};
  const total = blank();
  let low = 0;
  for (const r of results) {
    if (r.confidence === 'low') {
      low++;
      continue;
    }
    const t = (byType[r.type] ??= blank());
    for (const s of [t, total]) {
      s.n++;
      s.score += r.score;
      if (r.verdict === 'acceptable') s.acceptable++;
      else if (r.verdict === 'unacceptable') s.unacceptable++;
      else if (r.verdict === 'other') s.other++;
      else s.invalid++;
    }
  }
  const lat = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const at = (q: number) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(q * lat.length))]! : 0);
  return {
    byType,
    total,
    lowConfidence: low,
    latencyMs: {
      mean: lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : 0,
      median: at(0.5),
      p90: at(0.9),
      max: lat.length ? lat[lat.length - 1]! : 0,
    },
  };
}

const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

export function reportMarkdown(r: BenchReport): string {
  const s = r.summary;
  const lines = [
    `# Coach bench — ${r.label}`,
    '',
    `${r.startedAt} · source: ${r.source}${r.model ? ` · model: ${r.model}` : ''}`,
    '',
    `**Score ${s.total.score} / ${s.total.n}** (acceptable ${s.total.acceptable}, blunder ${s.total.unacceptable}, other ${s.total.other}, missing/illegal/error ${s.total.invalid})` +
      (s.lowConfidence ? ` · ${s.lowConfidence} low-confidence case${s.lowConfidence > 1 ? 's' : ''} not scored` : ''),
    '',
    `Latency: mean ${secs(s.latencyMs.mean)}, median ${secs(s.latencyMs.median)}, p90 ${secs(s.latencyMs.p90)}, max ${secs(s.latencyMs.max)}`,
    '',
    '| type | cases | score | acceptable | blunder | other | invalid |',
    '|---|---:|---:|---:|---:|---:|---:|',
  ];
  for (const t of BENCH_TYPES) {
    const x = s.byType[t];
    if (x) lines.push(`| ${t} | ${x.n} | ${x.score} | ${x.acceptable} | ${x.unacceptable} | ${x.other} | ${x.invalid} |`);
  }
  lines.push('', '| case | type | verdict | answer | latency |', '|---|---|---|---|---:|');
  for (const c of r.cases) {
    const v = c.confidence === 'low' ? `${c.verdict} (low, unscored)` : c.verdict;
    lines.push(`| ${c.id} | ${c.type} | ${v} | ${(c.canonical ?? c.answer ?? '—').replace(/\|/g, '\\|')}${c.note ? ` — ${c.note.replace(/\|/g, '\\|').slice(0, 80)}` : ''} | ${secs(c.latencyMs)} |`);
  }
  return lines.join('\n') + '\n';
}

export interface Flip {
  id: string;
  type: BenchType;
  from: { verdict: string; score: number; answer: string | null };
  to: { verdict: string; score: number; answer: string | null };
}

/** Cases whose verdict changed between two runs, plus the score change. */
export function compareReports(a: BenchReport, b: BenchReport): { flips: Flip[]; onlyA: string[]; onlyB: string[]; delta: number; markdown: string } {
  const bi = new Map(b.cases.map((c) => [c.id, c]));
  const ai = new Map(a.cases.map((c) => [c.id, c]));
  const flips: Flip[] = [];
  for (const x of a.cases) {
    const y = bi.get(x.id);
    if (!y || (x.verdict === y.verdict && x.canonical === y.canonical)) continue;
    flips.push({
      id: x.id,
      type: x.type,
      from: { verdict: x.verdict, score: x.score, answer: x.canonical ?? x.answer },
      to: { verdict: y.verdict, score: y.score, answer: y.canonical ?? y.answer },
    });
  }
  const onlyA = a.cases.filter((c) => !bi.has(c.id)).map((c) => c.id);
  const onlyB = b.cases.filter((c) => !ai.has(c.id)).map((c) => c.id);
  const delta = b.summary.total.score - a.summary.total.score;
  const lines = [
    `# Coach bench — ${a.label} → ${b.label}`,
    '',
    `Score ${a.summary.total.score}/${a.summary.total.n} → ${b.summary.total.score}/${b.summary.total.n} (${delta >= 0 ? '+' : ''}${delta})`,
    `Median latency ${secs(a.summary.latencyMs.median)} → ${secs(b.summary.latencyMs.median)}`,
    '',
  ];
  const better = flips.filter((f) => f.to.score > f.from.score);
  const worse = flips.filter((f) => f.to.score < f.from.score);
  const same = flips.filter((f) => f.to.score === f.from.score);
  const row = (f: Flip) => `- ${f.id} (${f.type}): ${f.from.verdict} \`${f.from.answer ?? '—'}\` → ${f.to.verdict} \`${f.to.answer ?? '—'}\``;
  lines.push(`## Better (${better.length})`, ...better.map(row), '', `## Worse (${worse.length})`, ...worse.map(row), '');
  if (same.length) lines.push(`## Changed answer, same score (${same.length})`, ...same.map(row), '');
  if (onlyA.length) lines.push(`Only in ${a.label}: ${onlyA.join(', ')}`);
  if (onlyB.length) lines.push(`Only in ${b.label}: ${onlyB.join(', ')}`);
  return { flips, onlyA, onlyB, delta, markdown: lines.join('\n') + '\n' };
}
