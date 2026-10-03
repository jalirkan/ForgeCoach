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
 * that lists the legal choices and asks for an `ANSWER: <choice>` line — the
 * last line in the classic layout, the first in the answer-first one
 * (`--prompt-format`). Normal prompts never carry that section.
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
import { buildCoachPrompt, coachCardNames, type Prompt, type PromptFormat } from '../prompt.ts';
import { statedOf, STATED_CONFIDENCES, type StatedConfidence } from '../coachAnswer.ts';
import { canPay, chosenColors, infoFor, instantSpeedOptions, manaColorsOf, turnFacts, untappedManaSources, type ManaSource } from '../state.ts';
import { liveDecision } from '../ui/play/liveDecision.ts';
import type { HelperStatus, HelperThinking } from '../coachHelper.ts';
import { bootstrapMean, mean, rng, signTest, wilson, type Interval } from './benchStats.ts';
import { gradeProblems, halfWidth, isLowInfo, LOW_INFO_HALF_WIDTH, type CaseGrade } from './grade.ts';

// ---------------------------------------------------------------------------
// Cases

export const BENCH_TYPES = ['mulligan', 'play_draw', 'spell', 'attack', 'block', 'target', 'pass', 'choice'] as const;
/** dev: every case not held out (the default, the set a prompt is tuned on); holdout: only the held-out cases; all. */
export const BENCH_SPLITS = ['dev', 'holdout', 'all'] as const;
export type BenchSplit = (typeof BENCH_SPLITS)[number];
export const inSplit = (c: Pick<BenchCase, 'holdout'>, split: BenchSplit): boolean => split === 'all' || (split === 'holdout' ? !!c.holdout : !c.holdout);
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
  /**
   * The engine-graded regret table (mtg-table `tools/coach-grade.sh`, imported
   * with `bench:coach -- import-graded`): each option's win rate against Forge
   * Default and its regret. When present, every answer gets a regret.
   */
  grade?: CaseGrade;
  /** Held out: never run while tuning the prompt (`--split holdout` runs only these). */
  holdout?: boolean;
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
  if (o.holdout !== undefined && typeof o.holdout !== 'boolean') errors.push('holdout: true or false');
  if (o.grade !== undefined) errors.push(...gradeProblems(o.grade));
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
export function benchSection(c: Pick<BenchCase, 'type' | 'question'>, cs: ChoiceSet, format: PromptFormat = 'classic'): string {
  const lines = ['# Bench answer', c.question?.trim() || DEFAULT_QUESTION[c.type], ''];
  if (format === 'answer-first') lines.push('Make your FIRST line exactly one line in this form (it stands in for the one-line **Answer:**), then continue in your usual format:');
  else lines.push('Answer in your usual format. Then end with exactly one final line, in this form:');
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
  /** The answer layout the prompt asks for (default classic). */
  format?: PromptFormat;
}

/** Builds a case's prompt exactly as the app would, plus the bench section. */
export function buildCase(c: BenchCase, log: GameLog, cards: Map<string, CardInfo>, opts: { format?: PromptFormat } = {}): BuiltCase {
  const format = opts.format ?? 'classic';
  const moment = buildMoment(c, log, cards);
  const appPrompt = buildCoachPrompt(moment.log, moment.decision, promptCards(moment.log, moment.decision, cards), { format });
  const choices = choiceSet(c.type, moment.log, moment.decision, cards, { lands: c.lands });
  const prompt = { system: appPrompt.system, user: `${appPrompt.user}\n\n${benchSection(c, choices, format)}` };
  return { case: c, moment, choices, prompt, appPrompt, format };
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

/**
 * The answer on an `ANSWER:` line of a coach reply, or null. Either layout
 * parses: `prefer` 'last' (classic: the final line) or 'first' (answer-first),
 * and a line whose value is an answer token beats one that isn't (the
 * answer-first layout's prose **Answer:** line can sit beside the token line).
 */
export function extractAnswer(text: string, prefer: 'first' | 'last' = 'last'): string | null {
  const found: string[] = [];
  for (const line of text.split('\n')) {
    const m = /^[\s>*_`-]*answer\s*:\s*(.+?)\s*$/i.exec(line.replace(/\*\*/g, ''));
    if (m) found.push(m[1]!.replace(/[`*]+/g, '').trim());
  }
  if (!found.length) return null;
  const ordered = prefer === 'first' ? found : [...found].reverse();
  return ordered.find((a) => parseAnswer(a) !== null) ?? ordered[0]!;
}

export type Verdict = 'acceptable' | 'unacceptable' | 'other' | 'illegal' | 'missing';

export interface Scored {
  answer: string | null;
  canonical: string | null;
  verdict: Verdict;
  score: -1 | 0 | 1;
  note?: string;
  /** The answer's regret from the case's table (graded cases, legal answers the table has). */
  regret?: Regret;
}

/**
 * The regret of a parsed, legal answer from the case's table, or null when
 * the case has no table or the table has no option equal to the answer
 * (compared by creature class, like the acceptable lists).
 */
export function gradeRegret(b: Pick<BuiltCase, 'case' | 'choices'>, p: Parsed): Regret | null {
  const g = b.case.grade;
  if (!g) return null;
  const k = matchKey(p, b.choices);
  for (const o of g.options) {
    const q = parseAnswer(o.token);
    if (!q || matchKey(q, b.choices) !== k) continue;
    const r: Regret = { value: o.regret, lo: o.regretLo, hi: o.regretHi, option: o.token };
    if (isLowInfo(o)) r.lowInfo = true;
    return r;
  }
  return null;
}

/** acceptable = 1, blunder = −1, anything else (incl. a missing or illegal answer) = 0. */
export function scoreReply(b: BuiltCase, text: string): Scored {
  const answer = extractAnswer(text, b.format === 'answer-first' ? 'first' : 'last');
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
  const regret = gradeRegret(b, p);
  const withRegret = (x: Scored): Scored => (regret ? { ...x, regret } : x);
  if (b.case.acceptable.some((a) => keyOf(a) === k)) return withRegret({ answer, canonical, verdict: 'acceptable', score: 1 });
  if (b.case.unacceptable.some((a) => keyOf(a) === k)) return withRegret({ answer, canonical, verdict: 'unacceptable', score: -1 });
  return withRegret({ answer, canonical, verdict: 'other', score: 0 });
}

// ---------------------------------------------------------------------------
// Running and reports
//
// The coach is stochastic, so each case is asked `repeat` times and every
// answer is kept. A case's quality score is the mean score of its *valid*
// answers (acceptable +1, blunder −1, any other legal answer 0). Answers that
// are missing, unparsable or illegal are format failures: the coach answered,
// badly. A call that never got an answer (the helper busy, a rate limit, a
// network or server error, after the retries) is a transport error: it says
// nothing about the coach, is counted on its own, and makes a run's scores and
// any comparison with it untrustworthy. Neither enters the quality score.

export interface CoachReply {
  text: string;
  /** The model that answered, when the source says. */
  model?: string;
  /** Time the question waited in the coach helper's queue (D325); not part of its latency. */
  queuedMs?: number;
}
/** Asks the coach. `ctx` names the case, so a caller can pick a model per decision type. */
export type AskCoach = (prompt: Prompt, signal?: AbortSignal, ctx?: { id: string; type: BenchType }) => Promise<CoachReply>;

/**
 * An engine-graded regret for one answer: the win-rate gap between the
 * suggested option and the best option against Forge Default, from playouts
 * (mtg-table's coach grader), 0 = best, with the grader's own paired interval.
 * When samples carry it, it is the comparison's headline and the calibration's
 * measure. `lowInfo` marks an interval wider than ±LOW_INFO_HALF_WIDTH.
 */
export interface Regret {
  value: number;
  lo: number;
  hi: number;
  /** The table's option the answer matched. */
  option?: string;
  lowInfo?: boolean;
}

/** One answer to one case. */
export interface Sample {
  verdict: Verdict | 'error';
  /** 1, 0 or −1; meaningful only when the answer is valid (see `isValid`). */
  score: number;
  answer: string | null;
  canonical: string | null;
  note?: string;
  /** Time to answer, without time spent waiting in a queue or between retries. */
  latencyMs: number;
  model?: string;
  /** The coach's full reply (or the error message). */
  text: string;
  /** A transport error's kind (helper_busy, rate_limit, network, …). */
  errorKind?: string;
  /** Calls made for this answer (1 = no retry). Absent in older files. */
  attempts?: number;
  /** The confidence and rule the reply stated (prompt.ts's **Confidence:** / **Rule:** lines). */
  stated?: { confidence?: StatedConfidence; rule?: string };
  /** Engine-graded regret, when a grader has scored this answer (see `Regret`). */
  regret?: Regret;
}

/** A parsed, legal answer (acceptable, blunder or other): the quality score only looks at these. */
export const isValid = (s: Pick<Sample, 'verdict'>): boolean => s.verdict === 'acceptable' || s.verdict === 'unacceptable' || s.verdict === 'other';
/** A call that got no answer at all (after retries). */
export const isTransportError = (s: Pick<Sample, 'verdict'>): boolean => s.verdict === 'error';

export interface CaseStats {
  /** Calls recorded (answers plus transport errors). */
  n: number;
  /** Answers that were valid (not a format failure). */
  valid: number;
  /** Mean score of the valid answers; null when none was valid. */
  meanScore: number | null;
  /** Counts. `unparsed` is every format failure (missing, illegal); `errors` every transport error. They add up to `n`. */
  acceptable: number;
  unacceptable: number;
  other: number;
  unparsed: number;
  errors: number;
  /** The share of answers (transport errors left out) equal to the most common one (1 = always the same answer). */
  agreement: number;
  /** The distinct answers seen, most common first (format failures as "(missing)" etc.; transport errors are not answers). */
  answers: { answer: string; count: number }[];
  /** Mean regret of the samples that carry one; null when none does. */
  meanRegret: number | null;
  /** Answers with a regret; valid answers of a graded case the table had no option for; low-information regrets. */
  graded: number;
  ungraded: number;
  lowInfo: number;
  /** Mean half-width of the answers' regret intervals (the grading noise), null without regret. */
  regretNoise: number | null;
}

export interface CaseResult {
  id: string;
  type: BenchType;
  confidence: 'high' | 'low';
  /** The case carried a regret table when it was run. */
  graded?: boolean;
  /** The case is in the held-out set. */
  holdout?: boolean;
  samples: Sample[];
  stats: CaseStats;
}

export function caseStats(samples: Sample[], graded = false): CaseStats {
  const counts = { acceptable: 0, unacceptable: 0, other: 0, unparsed: 0, errors: 0 };
  const seen = new Map<string, number>();
  const scores: number[] = [];
  const regrets: number[] = [];
  for (const s of samples) {
    if (s.regret && Number.isFinite(s.regret.value)) regrets.push(s.regret.value);
    if (isTransportError(s)) {
      counts.errors++;
      continue;
    }
    if (s.verdict === 'acceptable') counts.acceptable++;
    else if (s.verdict === 'unacceptable') counts.unacceptable++;
    else if (s.verdict === 'other') counts.other++;
    else counts.unparsed++;
    if (isValid(s)) scores.push(s.score);
    const key = isValid(s) ? (s.canonical ?? s.answer ?? '?') : `(${s.verdict})`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const answered = samples.length - counts.errors;
  const answers = [...seen].map(([answer, count]) => ({ answer, count })).sort((a, b) => b.count - a.count || a.answer.localeCompare(b.answer));
  const withRegret = samples.filter((s) => s.regret && Number.isFinite(s.regret.value));
  return {
    n: samples.length,
    valid: scores.length,
    meanScore: scores.length ? mean(scores) : null,
    ...counts,
    agreement: answered ? answers[0]!.count / answered : 1,
    answers,
    meanRegret: regrets.length ? mean(regrets) : null,
    graded: withRegret.length,
    ungraded: graded ? samples.filter((s) => isValid(s) && !s.regret).length : 0,
    lowInfo: withRegret.filter((s) => s.regret!.lowInfo).length,
    regretNoise: withRegret.length ? mean(withRegret.map((s) => halfWidth({ regretLo: s.regret!.lo, regretHi: s.regret!.hi }))) : null,
  };
}

export type { Interval } from './benchStats.ts';

export interface LatencyStats {
  mean: number;
  median: number;
  p90: number;
  max: number;
}

export interface GroupSummary {
  /** High-confidence cases in the group. */
  cases: number;
  /** Calls recorded for them (answers plus transport errors). */
  samples: number;
  /** Mean over cases of each case's mean valid score, −1…1; bootstrap over cases. */
  score: Interval | null;
  /** Mean over cases of the share of valid answers that were acceptable / blunders. */
  acceptable: Interval | null;
  blunder: Interval | null;
  /** Share of the answers received that were format failures (missing, unparsable, illegal); Wilson interval. */
  formatFailure: Interval | null;
  /** Calls that got no answer after the retries. */
  errors: number;
  /** Share of calls that were transport errors; Wilson interval. */
  transportError: Interval | null;
  /** Cases whose agreement is below UNSTABLE_BELOW. */
  unstable: number;
  /** Latency of the answers received (no queue wait, no retries). */
  latencyMs: LatencyStats;
  /** Models that answered, most common first. */
  models: string[];
  /** Mean over cases of each case's mean regret; bootstrap over cases. Null without regret. */
  regret: Interval | null;
  /** The same over the informative regrets only (low-information ones left out). */
  regretInformative: Interval | null;
  /** Mean half-width of the answers' regret intervals: the grading noise under each regret. */
  regretNoise: number | null;
  /** Cases with a regret table; answers with a regret; valid answers the table had no option for; low-information regrets. */
  gradedCases: number;
  gradedAnswers: number;
  ungradedAnswers: number;
  lowInfoAnswers: number;
}

/** A case is unstable when fewer than two thirds of its answers equal the modal one. */
export const UNSTABLE_BELOW = 0.67;

/** One section of the prompt and its size, averaged over the cases (C3: what a trim would target). */
export interface PromptSection {
  name: string;
  /** Mean characters in the cases that have it. */
  meanChars: number;
  maxChars: number;
  /** Cases whose prompt has it. */
  cases: number;
  /** Share of all prompt characters (system + user) across the cases. */
  share: number;
}

export interface BenchReport {
  bench: 2;
  label: string;
  startedAt: string;
  source: string;
  model: string | null;
  /** Answers asked per case. */
  repeat: number;
  /** The answer layout asked for (absent in older files: classic). */
  promptFormat?: PromptFormat;
  /** Models asked for per decision type (`--model-by-type`); types not listed use `model`. */
  modelByType?: Partial<Record<BenchType, string>>;
  /** `--thinking` as sent to the coach helper (mtg-table D346); absent when none was sent. */
  thinking?: HelperThinking;
  /** Prompt size by section, largest first. */
  promptSections?: PromptSection[];
  /** Which cases ran: the development set (default), the held-out set, or all. */
  split?: BenchSplit;
  cases: CaseResult[];
  summary: {
    byType: Partial<Record<BenchType, GroupSummary>>;
    total: GroupSummary;
    /** Low-confidence cases run but not scored. */
    lowConfidence: number;
    /** Every call, low-confidence cases included. */
    latencyMs: LatencyStats;
    /** Transport errors over every call, low-confidence cases included. */
    errors: number;
    calls: number;
  };
}

/** How transient failures are retried. Only the final failure becomes an error sample. */
export interface RetryOptions {
  /** Retries after helper_busy, rate_limit or overloaded (default 4). */
  busy?: number;
  /** Retries after a network or 5xx error (default 2). */
  network?: number;
  /** First backoff (default 2000 ms), doubled each retry up to `maxMs` (default 30 000 ms). */
  baseMs?: number;
  maxMs?: number;
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
  /** Called before a retry. */
  onRetry?: (r: { id: string; type: BenchType; rep: number; attempt: number; kind: string; waitMs: number }) => void;
  signal?: AbortSignal;
  retry?: RetryOptions;
  /** Waits between retries (injectable for tests); must reject or resolve early when `signal` aborts. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  promptFormat?: PromptFormat;
  modelByType?: Partial<Record<BenchType, string>>;
  split?: BenchSplit;
  /** The "thinking" sent to the coach helper, to record in the report. */
  thinking?: HelperThinking;
}

/** Which retry budget an error falls under, or null when it is final. */
export function transientKind(e: unknown): { kind: string; budget: 'busy' | 'network' } | null {
  const o = (e ?? {}) as { kind?: unknown; status?: unknown };
  const kind = typeof o.kind === 'string' ? o.kind : '';
  const status = typeof o.status === 'number' ? o.status : 0;
  if (kind === 'helper_busy' || kind === 'rate_limit' || kind === 'overloaded' || status === 429 || status === 529) return { kind: kind || String(status), budget: 'busy' };
  if (kind === 'network' || kind === 'server' || status >= 500) return { kind: kind || String(status), budget: 'network' };
  return null;
}

const isAbort = (e: unknown, signal?: AbortSignal) =>
  !!signal?.aborted || (e instanceof Error && e.name === 'AbortError') || (e as { kind?: unknown } | null)?.kind === 'aborted';

export function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

/**
 * One answer to one case, retrying transient failures with backoff. Null when
 * the run was aborted (an interrupted call is not a sample).
 */
async function askOnce(
  b: BuiltCase,
  ask: AskCoach,
  o: RunOptions,
  now: () => number,
  rep: number,
): Promise<Sample | null> {
  const r = o.retry ?? {};
  const budget = { busy: r.busy ?? 4, network: r.network ?? 2 };
  const used = { busy: 0, network: 0 };
  const sleep = o.sleep ?? defaultSleep;
  let attempts = 0;
  for (;;) {
    if (o.signal?.aborted) return null;
    attempts++;
    const t0 = now();
    try {
      const reply = await ask(b.prompt, o.signal, { id: b.case.id, type: b.case.type });
      const s = scoreReply(b, reply.text);
      const out: Sample = { ...s, latencyMs: Math.max(0, now() - t0 - (reply.queuedMs ?? 0)), text: reply.text };
      if (reply.model) out.model = reply.model;
      if (out.note === undefined) delete out.note;
      if (attempts > 1) out.attempts = attempts;
      const stated = statedOf(reply.text);
      if (stated.confidence || stated.rule) out.stated = stated;
      return out;
    } catch (e) {
      if (isAbort(e, o.signal)) return null;
      const msg = e instanceof Error ? e.message : String(e);
      const t = transientKind(e);
      if (t && used[t.budget] < budget[t.budget]) {
        const n = used[t.budget]++;
        const waitMs = Math.min(r.maxMs ?? 30_000, (r.baseMs ?? 2000) * 2 ** n);
        o.onRetry?.({ id: b.case.id, type: b.case.type, rep, attempt: attempts, kind: t.kind, waitMs });
        await sleep(waitMs, o.signal);
        continue;
      }
      const kind = (e as { kind?: unknown } | null)?.kind;
      const out: Sample = { verdict: 'error', score: 0, answer: null, canonical: null, note: msg, latencyMs: now() - t0, text: msg, attempts };
      if (typeof kind === 'string') out.errorKind = kind;
      return out;
    }
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
      const sample = await askOnce(b, ask, o, now, t.rep);
      if (!sample) continue;
      samples[t.bi]![t.rep] = sample;
      o.onResult?.({ id: b.case.id, type: b.case.type, rep: t.rep, sample }, ++done, tasks.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(workers, tasks.length) }, worker));
  const cases: CaseResult[] = [];
  built.forEach((b, i) => {
    const got = samples[i]!.filter((s): s is Sample => !!s);
    if (got.length) {
      const r: CaseResult = { id: b.case.id, type: b.case.type, confidence: b.case.confidence, samples: got, stats: caseStats(got, !!b.case.grade) };
      if (b.case.grade) r.graded = true;
      if (b.case.holdout) r.holdout = true;
      cases.push(r);
    }
  });
  const model = o.model ?? cases.flatMap((c) => c.samples).find((s) => s.model)?.model ?? null;
  const report: BenchReport = { bench: 2, label: o.label, startedAt, source: o.source, model, repeat, cases, summary: summarize(cases) };
  report.promptFormat = o.promptFormat ?? built[0]?.format ?? 'classic';
  if (o.modelByType && Object.keys(o.modelByType).length) report.modelByType = o.modelByType;
  if (o.thinking) report.thinking = o.thinking;
  if (built.length) report.promptSections = promptSections(built.map((b) => b.prompt));
  if (o.split) report.split = o.split;
  return report;
}

function latencyOf(samples: Sample[]): LatencyStats {
  const lat = samples.filter((s) => !isTransportError(s)).map((s) => s.latencyMs).sort((a, b) => a - b);
  const at = (q: number) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(q * lat.length))]! : 0);
  return { mean: Math.round(mean(lat)), median: at(0.5), p90: at(0.9), max: lat.length ? lat[lat.length - 1]! : 0 };
}

function groupSummary(cases: CaseResult[]): GroupSummary {
  const withValid = cases.filter((c) => c.stats.valid > 0);
  const failures = cases.reduce((a, c) => a + c.stats.unparsed, 0);
  const errors = cases.reduce((a, c) => a + c.stats.errors, 0);
  const samples = cases.reduce((a, c) => a + c.stats.n, 0);
  const all = cases.flatMap((c) => c.samples);
  const models = new Map<string, number>();
  for (const s of all) if (s.model) models.set(s.model, (models.get(s.model) ?? 0) + 1);
  return {
    cases: cases.length,
    samples,
    score: bootstrapMean(withValid.map((c) => c.stats.meanScore!)),
    acceptable: bootstrapMean(withValid.map((c) => c.stats.acceptable / c.stats.valid)),
    blunder: bootstrapMean(withValid.map((c) => c.stats.unacceptable / c.stats.valid)),
    formatFailure: wilson(failures, samples - errors),
    errors,
    transportError: wilson(errors, samples),
    unstable: cases.filter((c) => c.stats.n - c.stats.errors > 0 && c.stats.agreement < UNSTABLE_BELOW).length,
    latencyMs: latencyOf(all),
    models: [...models].sort((a, b) => b[1] - a[1]).map(([m]) => m),
    regret: bootstrapMean(cases.filter((c) => c.stats.meanRegret !== null).map((c) => c.stats.meanRegret!)),
    regretInformative: bootstrapMean(
      cases
        .map((c) => c.samples.filter((s) => s.regret && Number.isFinite(s.regret.value) && !s.regret.lowInfo).map((s) => s.regret!.value))
        .filter((xs) => xs.length)
        .map(mean),
    ),
    regretNoise: (() => {
      const ns = cases.map((c) => c.stats.regretNoise).filter((x): x is number => x !== null);
      return ns.length ? mean(ns) : null;
    })(),
    gradedCases: cases.filter((c) => c.graded || c.stats.graded > 0).length,
    gradedAnswers: cases.reduce((a, c) => a + c.stats.graded, 0),
    ungradedAnswers: cases.reduce((a, c) => a + c.stats.ungraded, 0),
    lowInfoAnswers: cases.reduce((a, c) => a + c.stats.lowInfo, 0),
  };
}

export function summarize(cases: CaseResult[]): BenchReport['summary'] {
  const scored = cases.filter((c) => c.confidence !== 'low');
  const byType: Partial<Record<BenchType, GroupSummary>> = {};
  for (const t of BENCH_TYPES) {
    const of = scored.filter((c) => c.type === t);
    if (of.length) byType[t] = groupSummary(of);
  }
  return {
    byType,
    total: groupSummary(scored),
    lowConfidence: cases.length - scored.length,
    latencyMs: latencyOf(cases.flatMap((c) => c.samples)),
    errors: cases.reduce((a, c) => a + c.stats.errors, 0),
    calls: cases.reduce((a, c) => a + c.stats.n, 0),
  };
}

/**
 * Reads a results file of either format. A single-sample file (`bench: 1`, one
 * reply per case) becomes N=1 and carries a warning; stats and the summary are
 * always recomputed from the samples (so an older file's busy errors are
 * counted as transport errors, not format failures).
 */
export function normalizeReport(raw: unknown): { report: BenchReport; warnings: string[] } {
  const o = raw as Omit<Partial<BenchReport>, 'bench' | 'cases'> & { bench?: number; cases?: unknown[] };
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
    cases = (o.cases as CaseResult[]).map((c) => {
      const r: CaseResult = { id: c.id, type: c.type, confidence: c.confidence, samples: c.samples, stats: caseStats(c.samples, !!c.graded) };
      if (c.graded) r.graded = true;
      if (c.holdout) r.holdout = true;
      return r;
    });
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
  if (o.promptFormat) report.promptFormat = o.promptFormat;
  if (o.modelByType) report.modelByType = o.modelByType;
  if (o.thinking === 'off' || o.thinking === 'low' || o.thinking === 'default') report.thinking = o.thinking;
  if (Array.isArray(o.promptSections)) report.promptSections = o.promptSections;
  if (o.split) report.split = o.split;
  return { report, warnings };
}

/**
 * Fills (or refreshes) every valid answer's regret from the current case
 * tables, for a run made before its cases were graded (`bench:coach --
 * regrade`). Answers are matched to options exactly as a live run matches
 * them; a case with no table loses any regret it had.
 */
export function regradeReport(r: BenchReport, built: BuiltCase[]): { report: BenchReport; graded: number; cases: number } {
  const by = new Map(built.map((b) => [b.case.id, b]));
  let graded = 0;
  let nCases = 0;
  const cases = r.cases.map((c) => {
    const b = by.get(c.id);
    const samples = c.samples.map((s) => {
      const { regret: _old, ...rest } = s;
      if (!b?.case.grade || !isValid(s) || !s.canonical) return rest as Sample;
      const p = parseAnswer(s.canonical);
      const reg = p ? gradeRegret(b, p) : null;
      if (!reg) return rest as Sample;
      graded++;
      return { ...rest, regret: reg } as Sample;
    });
    if (b?.case.grade) nCases++;
    const out: CaseResult = { ...c, samples, stats: caseStats(samples, !!b?.case.grade) };
    if (b?.case.grade) out.graded = true;
    else delete out.graded;
    return out;
  });
  return { report: { ...r, cases, summary: summarize(cases) }, graded, cases: nCases };
}

// ---------------------------------------------------------------------------
// Prompt size by section

/** The section a prompt line starts, or null when it continues the one before. */
function sectionOf(line: string): string | null {
  const h = /^(#{1,2})\s+(.+)$/.exec(line);
  if (h) {
    const t = h[2]!;
    if (/^YOU\b/.test(t)) return 'You (state)';
    if (/^OPPONENT\b/.test(t)) return 'Opponent (state)';
    if (/^Cube context\b/.test(t)) return 'Cube context';
    return t.trim();
  }
  if (/^Stack\b/.test(line)) return 'Stack';
  if (/^Combat:/.test(line)) return 'Combat';
  return null;
}

/** Characters per prompt section (system prompt, decision, each player's state, card text, …), largest first. */
export function promptSections(prompts: Prompt[]): PromptSection[] {
  const per = new Map<string, number[]>();
  let total = 0;
  const add = (name: string, n: number) => {
    const xs = per.get(name) ?? [];
    xs.push(n);
    per.set(name, xs);
  };
  for (const p of prompts) {
    total += p.system.length + p.user.length;
    add('System prompt', p.system.length);
    const sizes = new Map<string, number>();
    let cur = '(before the first heading)';
    for (const line of p.user.split('\n')) {
      cur = sectionOf(line) ?? cur;
      sizes.set(cur, (sizes.get(cur) ?? 0) + line.length + 1);
    }
    sizes.set(cur, sizes.get(cur)! - 1); // the last line has no newline after it
    for (const [k, v] of sizes) add(k, v);
  }
  return [...per]
    .map(([name, xs]) => ({
      name,
      meanChars: Math.round(mean(xs)),
      maxChars: Math.max(...xs),
      cases: xs.length,
      share: total ? xs.reduce((a, b) => a + b, 0) / total : 0,
    }))
    .sort((a, b) => b.share - a.share || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Calibration: does the coach's stated confidence track how good its answers are?

export type CalibrationMetric = 'score' | 'regret';

export interface CalibrationRow {
  level: StatedConfidence | 'none';
  /** Answers at this level that have the metric (valid answers for score; graded ones for regret). */
  samples: number;
  /** Cases they come from. */
  cases: number;
  /** Mean of the per-case means at this level, bootstrap over cases. */
  mean: Interval | null;
  /** Score only: share of these answers that were acceptable / blunders. */
  acceptable?: number;
  blunder?: number;
}

export interface Calibration {
  metric: CalibrationMetric;
  rows: CalibrationRow[];
  /** True when fewer than two levels have enough data to compare. */
  thin: boolean;
  /** Highest minus lowest stated level that both have enough data (score: high − low should be > 0; regret: < 0). */
  gap: { from: StatedConfidence; to: StatedConfidence; diff: Interval } | null;
  /** The finding, in plain words. */
  text: string;
}

/** The fewest answers, and cases, a confidence level needs before it is compared. */
export const CALIBRATION_MIN_SAMPLES = 10;
export const CALIBRATION_MIN_CASES = 4;

/**
 * Mean score (or regret) by stated confidence over the scored (high-confidence)
 * cases. Built for either measure: with `metric: 'regret'` it reads each
 * sample's `regret.value` instead of its score, so the same table runs against
 * the engine grader once it exists. Repeats of one case are averaged first and
 * intervals resample cases, as everywhere in the bench.
 */
export function calibration(cases: CaseResult[], metric: CalibrationMetric = 'score'): Calibration {
  const scored = cases.filter((c) => c.confidence !== 'low');
  const value = (s: Sample): number | null => (metric === 'regret' ? (s.regret && Number.isFinite(s.regret.value) ? s.regret.value : null) : isValid(s) ? s.score : null);
  const levels: (StatedConfidence | 'none')[] = [...STATED_CONFIDENCES, 'none'];
  const rows: CalibrationRow[] = [];
  const perCase = new Map<StatedConfidence | 'none', number[]>();
  for (const level of levels) {
    const caseMeans: number[] = [];
    let n = 0;
    let acc = 0;
    let bl = 0;
    for (const c of scored) {
      const vs = c.samples.filter((s) => (s.stated?.confidence ?? 'none') === level).map(value).filter((v): v is number => v !== null);
      if (!vs.length) continue;
      caseMeans.push(mean(vs));
      n += vs.length;
      acc += vs.filter((v) => v === 1).length;
      bl += vs.filter((v) => v === -1).length;
    }
    perCase.set(level, caseMeans);
    if (!n) continue;
    const row: CalibrationRow = { level, samples: n, cases: caseMeans.length, mean: bootstrapMean(caseMeans) };
    if (metric === 'score') {
      row.acceptable = acc / n;
      row.blunder = bl / n;
    }
    rows.push(row);
  }
  const enough = (r: CalibrationRow) => r.level !== 'none' && r.samples >= CALIBRATION_MIN_SAMPLES && r.cases >= CALIBRATION_MIN_CASES;
  const ok = rows.filter(enough) as (CalibrationRow & { level: StatedConfidence })[];
  const what = metric === 'score' ? 'the score' : 'regret';
  const stated = rows.filter((r) => r.level !== 'none').reduce((a, r) => a + r.samples, 0);
  if (ok.length < 2) {
    const text = !stated
      ? `No answer stated a confidence, so calibration cannot be measured (the prompt asks for a **Confidence:** line; older runs did not).`
      : `Too little data to say whether stated confidence tracks ${what}: a level needs ${CALIBRATION_MIN_SAMPLES}+ answers from ${CALIBRATION_MIN_CASES}+ cases, and ${ok.length === 0 ? 'none has' : 'only one has'} that. Run more cases or --repeat.`;
    return { metric, rows, thin: true, gap: null, text };
  }
  const top = ok[0]!;
  const bottom = ok[ok.length - 1]!;
  // Difference of the two levels' case means, by a bootstrap of each side (they are different case sets).
  const a = perCase.get(top.level)!;
  const b = perCase.get(bottom.level)!;
  const diff = diffInterval(a, b);
  const good = metric === 'score' ? diff.lo > 0 : diff.hi < 0;
  const bad = metric === 'score' ? diff.hi < 0 : diff.lo > 0;
  const fmt = (x: number) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(2);
  const text = good
    ? `Stated confidence tracks ${what}: "${top.level}" answers beat "${bottom.level}" ones by ${fmt(diff.mean)} [${fmt(diff.lo)}, ${fmt(diff.hi)}].`
    : bad
      ? `Stated confidence runs backwards: "${top.level}" answers do worse than "${bottom.level}" ones (${fmt(diff.mean)} [${fmt(diff.lo)}, ${fmt(diff.hi)}]). Don't trust it.`
      : `No detectable link between stated confidence and ${what}: "${top.level}" minus "${bottom.level}" is ${fmt(diff.mean)} [${fmt(diff.lo)}, ${fmt(diff.hi)}], an interval that includes zero.`;
  return { metric, rows, thin: false, gap: { from: top.level, to: bottom.level, diff }, text };
}

/** 95% interval for mean(a) − mean(b), resampling each side independently (seeded). */
function diffInterval(a: number[], b: number[]): Interval {
  const B = 2000;
  const rand = rng(777);
  const pick = (xs: number[]) => {
    let s = 0;
    for (let i = 0; i < xs.length; i++) s += xs[Math.floor(rand() * xs.length)]!;
    return s / xs.length;
  };
  const ds: number[] = new Array(B);
  for (let i = 0; i < B; i++) ds[i] = pick(a) - pick(b);
  ds.sort((x, y) => x - y);
  return { mean: mean(a) - mean(b), lo: ds[Math.floor(0.025 * B)]!, hi: ds[Math.min(B - 1, Math.floor(0.975 * B))]! };
}

/** Regret is the calibration measure once any sample carries it. */
export function calibrationMetricFor(cases: CaseResult[]): CalibrationMetric {
  return cases.some((c) => c.samples.some((s) => s.regret)) ? 'regret' : 'score';
}

// ---------------------------------------------------------------------------
// Markdown

const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const num = (x: number) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(2);
const ci = (i: Interval | null, f: (x: number) => string = (x) => x.toFixed(2)) => (i ? `${f(i.mean)} [${f(i.lo)}, ${f(i.hi)}]` : '—');
const esc = (s: string) => s.replace(/\|/g, '\\|');

/** Error kinds of a run's transport errors, most common first ("helper_busy ×12, network ×1"). */
function errorKinds(r: BenchReport): string {
  const m = new Map<string, number>();
  for (const c of r.cases) for (const s of c.samples) if (isTransportError(s)) m.set(s.errorKind ?? 'unknown', (m.get(s.errorKind ?? 'unknown') ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ×${n}`).join(', ');
}

/** The loud line a run with transport errors carries, or null. */
export function transportWarning(r: BenchReport, name = r.label): string | null {
  const s = r.summary;
  if (!s.errors) return null;
  return (
    `TRANSPORT ERRORS: ${s.errors} of ${s.calls} calls in ${name} got no answer after retries (${errorKinds(r)}). ` +
    `Its scores, its stability and any comparison with it are NOT trustworthy — fix the cause (helper busy? usage limit? network?) and run again.`
  );
}

export function reportMarkdown(r: BenchReport): string {
  const s = r.summary;
  const t = s.total;
  const lines = [`# Coach bench — ${r.label}`, ''];
  const warn = transportWarning(r);
  if (warn) lines.push(`> **WARNING — ${warn}**`, '');
  const byType = r.modelByType && Object.keys(r.modelByType).length ? ` · by type: ${Object.entries(r.modelByType).map(([k, v]) => `${k}=${v}`).join(', ')}` : '';
  lines.push(
    `${r.startedAt} · source: ${r.source}${r.model ? ` · model: ${r.model}` : ''}${byType}${r.thinking ? ` · thinking: ${r.thinking}` : ''} · prompt: ${r.promptFormat ?? 'classic'} · ${r.repeat} answer${r.repeat === 1 ? '' : 's'} per case`,
    '',
  );
  if (t.regret) {
    lines.push(
      `**Mean regret ${ci(t.regret)}** — win rate lost against the best option, against Forge Default (0 = always the best option; lower is better; mean over ${t.gradedCases} graded cases, 95% bootstrap over cases) · ` +
        `grading noise ±${t.regretNoise === null ? '—' : t.regretNoise.toFixed(2)} per answer (mean half-width of the grader's intervals)`,
      '',
      `Graded answers: ${t.gradedAnswers}; valid answers the table has no option for: ${t.ungradedAnswers}; ` +
        `low-information (interval wider than ±${LOW_INFO_HALF_WIDTH}): ${t.lowInfoAnswers}` +
        (t.lowInfoAnswers ? ` — mean regret without them ${ci(t.regretInformative)}; treat the headline with care` : ''),
      '',
    );
  }
  lines.push(
    `${t.regret ? 'Quality score' : '**Quality score'} ${ci(t.score)}${t.regret ? '' : '**'} (mean over ${t.cases} cases, −1 to +1, 95% interval by bootstrap over cases) · ` +
      `acceptable ${ci(t.acceptable, pct)} · blunder ${ci(t.blunder, pct)}`,
    '',
    `Format failures (the coach answered, but missing, unparsable or illegal; not in the score): ${ci(t.formatFailure, pct)} of ${t.samples - t.errors} answers (Wilson interval)` +
      (s.lowConfidence ? ` · ${s.lowConfidence} low-confidence case${s.lowConfidence > 1 ? 's' : ''} not scored` : ''),
    '',
    `Transport errors (no answer after retries; not the coach's fault, not in the score): ${s.errors} of ${s.calls} calls${s.errors ? ` (${errorKinds(r)})` : ''}`,
    '',
    `Unstable cases (agreement below ${UNSTABLE_BELOW}, transport errors left out): ${t.unstable} of ${t.cases}`,
    '',
    `Latency per answer (no queue wait, no retries): mean ${secs(s.latencyMs.mean)}, median ${secs(s.latencyMs.median)}, p90 ${secs(s.latencyMs.p90)}, max ${secs(s.latencyMs.max)}`,
    '',
    r.repeat < 2 ? "_One answer per case: intervals only reflect which cases were picked. Use --repeat 3 or more to see the coach's own noise._\n" : '',
    r.split && r.split !== 'dev' ? `_Cases: ${r.split === 'holdout' ? 'the HELD-OUT set only' : 'all, held-out included'}._\n` : '',
    '| type | cases | regret (95%) | score (95%) | acceptable | blunder | format fail | transport err | median latency | p90 latency | model |',
    '|---|---:|---|---|---:|---:|---:|---:|---:|---:|---|',
  );
  for (const ty of BENCH_TYPES) {
    const x = s.byType[ty];
    if (x)
      lines.push(
        `| ${ty} | ${x.cases} | ${ci(x.regret)} | ${ci(x.score)} | ${x.acceptable ? pct(x.acceptable.mean) : '—'} | ${x.blunder ? pct(x.blunder.mean) : '—'} | ${x.formatFailure ? pct(x.formatFailure.mean) : '—'} | ${x.errors} | ${secs(x.latencyMs.median)} | ${secs(x.latencyMs.p90)} | ${esc(x.models.join(', ') || r.modelByType?.[ty] || '—')} |`,
      );
  }
  lines.push('', ...calibrationMarkdown(calibration(r.cases, calibrationMetricFor(r.cases))));
  if (r.promptSections?.length) {
    lines.push('', '## Prompt size by section', '', '_Not trimmed — this only shows where the characters are (largest share first)._', '', '| section | mean chars | max chars | cases | share |', '|---|---:|---:|---:|---:|');
    for (const p of r.promptSections) lines.push(`| ${esc(p.name)} | ${p.meanChars} | ${p.maxChars} | ${p.cases} | ${pct(p.share)} |`);
  }
  lines.push('', '| case | type | mean | regret (noise) | ok / blunder / other / format / transport | agree | answers seen |', '|---|---|---:|---|---|---:|---|');
  for (const c of r.cases) {
    const k = c.stats;
    const low = c.confidence === 'low' ? ' (low, unscored)' : '';
    const answers = k.answers.map((a) => `${a.answer}×${a.count}`).join(', ');
    const reg = k.meanRegret === null ? (c.graded ? 'ungraded answers' : '—') : `${k.meanRegret.toFixed(2)} (±${(k.regretNoise ?? 0).toFixed(2)})${k.lowInfo ? ` · ${k.lowInfo} low-info` : ''}${k.ungraded ? ` · ${k.ungraded} not in table` : ''}`;
    lines.push(`| ${c.id}${low}${c.holdout ? ' (held out)' : ''} | ${c.type} | ${k.meanScore === null ? '—' : num(k.meanScore)} | ${reg} | ${k.acceptable} / ${k.unacceptable} / ${k.other} / ${k.unparsed} / ${k.errors} | ${pct(k.agreement)} | ${esc(answers)} |`);
  }
  if (t.regret)
    lines.push(
      '',
      "_Regret's yardstick is Forge Default: each option's win rate when the coach's seat takes it and Forge's Default AI plays both seats to the end, the hidden cards redealt from what the player could know. It measures play against the opponent ForgeCoach actually seats, not perfect play. Format failures (missing, unparsable, illegal answers) have no regret and are counted above, apart from quality._",
    );
  return lines.join('\n') + '\n';
}

export function calibrationMarkdown(cal: Calibration): string[] {
  const m = cal.metric === 'score' ? 'mean score (−1…+1, higher is better)' : 'mean regret (lower is better)';
  const lines = ['## Calibration: stated confidence vs ' + (cal.metric === 'score' ? 'score' : 'regret'), '', cal.text, ''];
  if (!cal.rows.length) return lines;
  lines.push(`| stated confidence | answers | cases | ${m} |${cal.metric === 'score' ? ' acceptable | blunder |' : ''}`, `|---|---:|---:|---|${cal.metric === 'score' ? '---:|---:|' : ''}`);
  for (const r of cal.rows) {
    const thin = r.level !== 'none' && (r.samples < CALIBRATION_MIN_SAMPLES || r.cases < CALIBRATION_MIN_CASES) ? ' (thin)' : '';
    lines.push(
      `| ${r.level === 'none' ? '(not stated)' : r.level}${thin} | ${r.samples} | ${r.cases} | ${ci(r.mean)} |${cal.metric === 'score' ? ` ${pct(r.acceptable ?? 0)} | ${pct(r.blunder ?? 0)} |` : ''}`,
    );
  }
  lines.push('', '_Repeats of a case are averaged first; intervals resample cases. A run against the engine grader reads regret here instead of the score._');
  return lines;
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
  /** B's mean regret minus A's (negative = B better), or null when either has none. */
  regretDiff: number | null;
  /** Set only when every valid answer of one run beats every valid answer of the other (both runs with 2+ answers). */
  flip: 'better' | 'worse' | null;
  /** Which runs have agreement below UNSTABLE_BELOW on this case. */
  unstable: ('A' | 'B')[];
}

export type Verdict3 = 'better' | 'worse' | 'none';

export interface PairedTest {
  /** Cases that entered the paired test (high confidence in both, a value in both). */
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
}

export interface Comparison {
  cases: CaseDiff[];
  flips: CaseDiff[];
  unstable: CaseDiff[];
  onlyA: string[];
  onlyB: string[];
  /** The score's paired test (the pass rate's view). */
  paired: PairedTest;
  /** The regret's paired test, when both runs carry regret. */
  pairedRegret: PairedTest | null;
  /** What the verdict is about: mean regret when both runs have it, else the score. */
  headline: 'regret' | 'score';
  verdict: Verdict3;
  verdictText: string;
  warnings: string[];
  /** True when either run had transport errors: the verdict is not to be trusted. */
  untrustworthy: boolean;
  /** Total difference in the quality score (kept for callers that want one number). */
  delta: number;
  markdown: string;
}

/** The fewest paired cases for which the verdict will call a difference. */
export const MIN_PAIRED_CASES = 5;

function pairedTest(diffs: number[]): PairedTest {
  const up = diffs.filter((d) => d > 1e-9).length;
  const down = diffs.filter((d) => d < -1e-9).length;
  const m = bootstrapMean(diffs);
  const n = diffs.length;
  return { n, up, down, ties: n - up - down, mean: m, total: m ? { mean: m.mean * n, lo: m.lo * n, hi: m.hi * n } : null, signP: signTest(up, down) };
}

/**
 * Paired comparison of two runs over the cases they share. Each case's
 * difference is its mean in B minus its mean in A; the verdict says B is
 * better or worse only when the 95% bootstrap interval of the mean difference
 * (resampling cases) excludes zero. The headline is mean regret (lower is
 * better) once both runs carry regret; until then it is the quality score, and
 * the pass rate stays as the secondary view either way.
 */
export function compareReports(a: BenchReport, b: BenchReport): Comparison {
  const bi = new Map(b.cases.map((c) => [c.id, c]));
  const ai = new Map(a.cases.map((c) => [c.id, c]));
  const onlyA = a.cases.filter((c) => !bi.has(c.id)).map((c) => c.id);
  const onlyB = b.cases.filter((c) => !ai.has(c.id)).map((c) => c.id);
  const warnings: string[] = [];
  const transport = [transportWarning(a, `A (${a.label})`), transportWarning(b, `B (${b.label})`)].filter((x): x is string => !!x);
  for (const [name, r] of [
    ['A', a],
    ['B', b],
  ] as const) {
    if (Math.max(0, ...r.cases.map((c) => c.stats.n)) < 2) warnings.push(`${name} (${r.label}) has one answer per case: a case difference cannot be told from noise, so no flips are flagged and the interval below is the only guide.`);
  }
  if ((a.split ?? 'dev') !== (b.split ?? 'dev')) warnings.push(`The runs used different case sets (A ${a.split ?? 'dev'}, B ${b.split ?? 'dev'}).`);
  if ((a.thinking ?? 'default') !== (b.thinking ?? 'default')) warnings.push(`The runs cap the coach's thinking differently (A ${a.thinking ?? 'default'}, B ${b.thinking ?? 'default'}): that is the change being measured, or a mistake.`);
  if ((a.promptFormat ?? 'classic') !== (b.promptFormat ?? 'classic')) warnings.push(`The runs ask for different answer layouts (A ${a.promptFormat ?? 'classic'}, B ${b.promptFormat ?? 'classic'}): that is the change being measured, or a mistake.`);
  const cases: CaseDiff[] = [];
  const diffs: number[] = [];
  const rdiffs: number[] = [];
  for (const x of a.cases) {
    const y = bi.get(x.id);
    if (!y) continue;
    const both = x.confidence !== 'low' && y.confidence !== 'low';
    const diff = both && x.stats.meanScore !== null && y.stats.meanScore !== null ? y.stats.meanScore - x.stats.meanScore : null;
    if (diff !== null) diffs.push(diff);
    const regretDiff = both && x.stats.meanRegret !== null && y.stats.meanRegret !== null ? y.stats.meanRegret - x.stats.meanRegret : null;
    if (regretDiff !== null) rdiffs.push(regretDiff);
    const sa = x.samples.filter(isValid).map((s) => s.score);
    const sb = y.samples.filter(isValid).map((s) => s.score);
    let flip: CaseDiff['flip'] = null;
    if (both && sa.length >= 2 && sb.length >= 2) {
      if (Math.min(...sb) > Math.max(...sa)) flip = 'better';
      else if (Math.max(...sb) < Math.min(...sa)) flip = 'worse';
    }
    const unstable: CaseDiff['unstable'] = [];
    if (both && x.stats.n > x.stats.errors && x.stats.agreement < UNSTABLE_BELOW) unstable.push('A');
    if (both && y.stats.n > y.stats.errors && y.stats.agreement < UNSTABLE_BELOW) unstable.push('B');
    cases.push({ id: x.id, type: x.type, a: x.stats, b: y.stats, diff, regretDiff, flip, unstable });
  }
  const paired = pairedTest(diffs);
  const pairedRegret = rdiffs.length ? pairedTest(rdiffs) : null;
  const headline: Comparison['headline'] = pairedRegret ? 'regret' : 'score';
  const test = pairedRegret ?? paired;
  const m = test.mean;
  const n = test.n;
  let verdict: Verdict3 = 'none';
  let why = '';
  if (n < MIN_PAIRED_CASES) why = ` (only ${n} paired case${n === 1 ? '' : 's'}; need ${MIN_PAIRED_CASES})`;
  else if (headline === 'score') {
    if (m && m.lo > 0) verdict = 'better';
    else if (m && m.hi < 0) verdict = 'worse';
  } else {
    if (m && m.hi < 0) verdict = 'better';
    else if (m && m.lo > 0) verdict = 'worse';
  }
  const bName = `B (${b.label})`;
  const what = headline === 'regret' ? 'mean regret' : 'mean score';
  const untrustworthy = transport.length > 0;
  const verdictText =
    (verdict === 'better'
      ? `${bName} is better than A (${a.label}): the 95% interval of the ${what} difference excludes zero.`
      : verdict === 'worse'
        ? `${bName} is worse than A (${a.label}): the 95% interval of the ${what} difference excludes zero.`
        : `No detectable difference between A (${a.label}) and ${bName}${why || `: the 95% interval of the ${what} difference includes zero`}.`) +
    (untrustworthy ? ' (Not trustworthy: transport errors, see above.)' : '');

  const flips = cases.filter((c) => c.flip);
  const unstable = cases.filter((c) => c.unstable.length);
  const lines = [`# Coach bench — A ${a.label} → B ${b.label}`, ''];
  for (const w of transport) lines.push(`> **WARNING — ${w}**`, '');
  if (untrustworthy) lines.push('> **This comparison is not trustworthy: at least one run lost calls to transport errors, so its cases are missing answers or lean on fewer repeats.**', '');
  lines.push(`**Verdict${headline === 'regret' ? ' (mean regret, lower is better)' : ''}: ${verdictText}**`, '');
  for (const w of warnings) lines.push(`> Warning: ${w}`);
  if (warnings.length) lines.push('');
  if (pairedRegret) {
    const r = pairedRegret;
    lines.push(
      `Paired over ${r.n} graded cases. Mean regret difference (B − A, negative = B better) ${ci(r.mean, num)}; ` +
        `cases better ${r.down}, worse ${r.up}, unchanged ${r.ties}; sign test p = ${r.signP.toFixed(3)}.`,
      `Mean regret A ${ci(a.summary.total.regret)} · B ${ci(b.summary.total.regret)} (grading noise ±${(a.summary.total.regretNoise ?? 0).toFixed(2)} / ±${(b.summary.total.regretNoise ?? 0).toFixed(2)} per answer; both runs read the same tables, so where they gave the same answer the table's noise cancels)`,
      '',
      '_Secondary: the pass rate (acceptable / blunder lists)._',
    );
  }
  lines.push(
    `Paired over ${paired.n} cases (${a.repeat} vs ${b.repeat} answers per case). Mean score difference (B − A) ${paired.mean ? ci(paired.mean, num) : '—'}; ` +
      `total ${paired.total ? ci(paired.total, num) : '—'}. Cases better ${paired.up}, worse ${paired.down}, unchanged ${paired.ties}; sign test p = ${paired.signP.toFixed(3)}.`,
    '',
    `Quality score A ${ci(a.summary.total.score)} · B ${ci(b.summary.total.score)}`,
    `Acceptable A ${ci(a.summary.total.acceptable, pct)} · B ${ci(b.summary.total.acceptable, pct)}`,
    `Blunder A ${ci(a.summary.total.blunder, pct)} · B ${ci(b.summary.total.blunder, pct)}`,
    `Format failures A ${ci(a.summary.total.formatFailure, pct)} · B ${ci(b.summary.total.formatFailure, pct)} (the coach answered badly; separate from the score)`,
    `Transport errors A ${a.summary.errors} of ${a.summary.calls} · B ${b.summary.errors} of ${b.summary.calls} calls (no answer at all; separate from both)`,
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
    paired,
    pairedRegret,
    headline,
    verdict,
    verdictText,
    warnings: [...transport, ...warnings],
    untrustworthy,
    delta: paired.total?.mean ?? 0,
    markdown: lines.join('\n') + '\n',
  };
}

// ---------------------------------------------------------------------------
// Options

/**
 * `--model-by-type mulligan=<id>,play_draw=<id>,…`: a model per decision type.
 * `allowed` are the accepted model names (claude.ts's MODELS ids, and the
 * helper's aliases for a helper run). Throws with a plain message.
 */
export function parseModelByType(spec: string, allowed: readonly string[]): Partial<Record<BenchType, string>> {
  const out: Partial<Record<BenchType, string>> = {};
  for (const part of spec.split(',').map((x) => x.trim()).filter(Boolean)) {
    const m = /^([a-z_]+)\s*=\s*(\S+)$/.exec(part);
    if (!m) throw new Error(`--model-by-type: "${part}" is not type=model`);
    const [, type, model] = m as unknown as [string, string, string];
    if (!BENCH_TYPES.includes(type as BenchType)) throw new Error(`--model-by-type: "${type}" is not a decision type (${BENCH_TYPES.join(', ')})`);
    if (!allowed.includes(model)) throw new Error(`--model-by-type: "${model}" is not one of ${allowed.join(', ')}`);
    out[type as BenchType] = model;
  }
  return out;
}

// ---------------------------------------------------------------------------
// --thinking (mtg-table D346)

/**
 * What `--thinking <v>` sends: `send` is the value to put on /coach, only when
 * the helper's /health lists it (an older helper would ignore it, and the
 * report must not claim a cap that never applied); `note` explains a value not
 * sent; `error` is a bad flag. No flag: nothing sent, nothing said.
 */
export function benchThinking(flag: string | undefined, source: string, helper: HelperStatus | null): { send?: HelperThinking; note?: string; error?: string } {
  if (flag === undefined) return {};
  if (flag !== 'off' && flag !== 'low' && flag !== 'default') return { error: '--thinking: off, low or default' };
  if (source !== 'helper') return { error: '--thinking applies to the coach helper only (--source helper)' };
  if (helper?.state !== 'ok' || !helper.thinking?.includes(flag)) {
    return { note: `Note: this coach helper does not offer "thinking" (older than mtg-table D346): --thinking ${flag} is not sent, and the run uses its default.` };
  }
  return { send: flag };
}
