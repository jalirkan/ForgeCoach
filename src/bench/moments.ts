/*
 * ForgeCoach — bench/moments.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The decisions of a frame log worth handing to the engine grader (mtg-table
 * `tools/coach-grade.sh`), as the bench itself defines a moment: replay
 * decisions (`extractDecisions`: a main phase → `spell`, declare attackers →
 * `attack`, declare blockers → `block`) and, in a human-seat log, every
 * target the player picked (a live moment before the click → `target`). Only
 * decisions with a real choice are listed — a castable spell besides passing,
 * a creature that can attack, a blocker and an attacker, two targets — by the
 * bench's own legality check, so a graded moment is one a case can be built
 * on. The grader then decides legality for real.
 */
import type { GameLog } from '../log.ts';
import type { CardInfo } from '../cards.ts';
import type { InputBody } from '../protocol.ts';
import { extractDecisions, isTargetInput } from '../decisions.ts';
import { buildMoment, choiceSet, type BenchCase, type BenchType } from './coachBench.ts';
import type { MomentLine } from './grade.ts';

export type GradedType = MomentLine['type'];
export const GRADED_TYPES: readonly GradedType[] = ['spell', 'attack', 'block', 'target'];

/** A moment's suggested case id: lower-case, digits and dashes. */
export function momentId(prefix: string, logName: string, type: string, frame: number): string {
  const stem = logName
    .replace(/\.jsonl(\.gz)?$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${prefix}-${type}-${stem}-${frame}`.replace(/-+/g, '-');
}

/** The listed moments of one log (`log` is the path written into each line). */
export function momentsOf(
  game: GameLog,
  log: string,
  cards: Map<string, CardInfo>,
  opts: { types?: readonly GradedType[]; prefix?: string; logName?: string } = {},
): MomentLine[] {
  const types = new Set(opts.types ?? GRADED_TYPES);
  const prefix = opts.prefix ?? 'mined';
  const name = opts.logName ?? log.split('/').pop() ?? log;
  const out: MomentLine[] = [];
  const kindType: Record<string, GradedType | undefined> = { main: 'spell', attack: 'attack', block: 'block' };
  for (const d of extractDecisions(game, { cards })) {
    const type = kindType[d.kind];
    if (!type || !types.has(type)) continue;
    const cs = choiceSet(type as BenchType, game, d, cards);
    const real =
      type === 'spell' ? cs.choices.length >= 2 : type === 'attack' ? (cs.attackers?.length ?? 0) >= 1 : (cs.blockers?.length ?? 0) >= 1 && (cs.attacking?.length ?? 0) >= 1;
    if (!real) continue;
    out.push({ log, frame: d.frameIndex, mode: 'review', kind: d.kind, type, label: d.label, id: momentId(prefix, name, type, d.frameIndex) });
  }
  if (types.has('target')) {
    let input: InputBody | null = null;
    game.frames.forEach((f, i) => {
      if (f.type === 'input') input = f.body as InputBody;
      else if (f.type === 'act' && input && isTargetInput(input) && (input as InputBody).selectable.cardIds.length >= 2) {
        const c: BenchCase = { id: 'x', log, moment: { mode: 'live', frame: i }, seat: game.seat, type: 'target', acceptable: ['x'], unacceptable: [], rationale: 'x', confidence: 'high' };
        try {
          const m = buildMoment(c, game, cards);
          out.push({ log, frame: i, mode: 'live', type: 'target', label: m.decision.label, id: momentId(prefix, name, 'target', i) });
        } catch {
          // a moment the bench cannot rebuild is not listed
        }
        input = null;
      }
    });
  }
  return out.sort((a, b) => a.frame - b.frame);
}

/**
 * A cube-lab recording's decks (D315): `<run>/games/<seed>/g<n>-seat<k>.jsonl.gz`
 * is drafter k's view; `drafts.jsonl`'s line for that seed names both drafters'
 * played decks. Returns the run-relative deck paths, or null when the path or
 * the line does not fit. The opponent's list is what the player may know
 * (D312's ruling for the cubes); its hand and library order never are.
 */
export function labDecks(logPath: string, draftsJsonl: string): { own: string; opp: string } | null {
  const m = /games\/(\d+)\/g\d+-seat([01])\.jsonl(\.gz)?$/.exec(logPath.replace(/\\/g, '/'));
  if (!m) return null;
  const seed = Number(m[1]);
  const seat = Number(m[2]);
  for (const line of draftsJsonl.split('\n')) {
    if (!line.trim()) continue;
    let rec: { seed?: number; drafters?: { played?: string; deckFile?: string | null; forgeDeckFile?: string | null }[] };
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (rec.seed !== seed || !Array.isArray(rec.drafters) || rec.drafters.length !== 2) continue;
    const deckOf = (k: number): string | null => {
      const d = rec.drafters![k]!;
      return (d.played === 'lab' && d.deckFile ? d.deckFile : d.forgeDeckFile) ?? d.deckFile ?? null;
    };
    const own = deckOf(seat);
    const opp = deckOf(1 - seat);
    return own && opp ? { own, opp } : null;
  }
  return null;
}
