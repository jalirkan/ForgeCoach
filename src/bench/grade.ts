/*
 * ForgeCoach — bench/grade.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The engine-graded coach bench's data (mtg-table's `tools/coach-grade.sh`,
 * its D332–D334): a case's precomputed regret table, how a run decides that a
 * table is low-information, how the turning-point miner picks decisions worth
 * grading from a cheap first pass, and how a graded decision becomes a case.
 *
 * The yardstick is "best against Forge Default": an option's value is how often
 * the viewing seat wins when it takes that option and Forge's Default AI then
 * plays both seats to the end, the hidden cards redealt from what the viewer
 * could know. That is a fixed, reproducible opponent — the one the player meets
 * in ForgeCoach — not perfect play: an answer that is right against a strong
 * human but wrong against Forge Default scores as wrong here. Regret is the
 * best option's win rate minus the chosen one's (0 = the best line), in win-rate
 * points (0–1), with the grader's paired interval.
 *
 * Pure: no file or network access (bench/coach/cli.ts does that).
 */

/** One option's line of a regret table. */
export interface GradeOption {
  /** The bench's answer token (cast:12, attack:21,22, block:33>55, target:64, pass). */
  token: string;
  label?: string;
  /** Playouts of this option. */
  n: number;
  winRate: number;
  winLo: number;
  winHi: number;
  /** Best win rate minus this option's (≥ 0), with its paired 95% interval. */
  regret: number;
  regretLo: number;
  regretHi: number;
  best?: boolean;
  /** Forge Default's own choice here. */
  forge?: boolean;
  /** The grader retired it after repeated playout failures: its numbers are not trusted. */
  failed?: boolean;
  /** The same choice as this option (another copy of the same card): graded once, listed under each token. */
  alias?: string;
}

/** A case's precomputed regret table (`grade` in a case file). */
export interface CaseGrade {
  v: 1;
  yardstick: 'forge-default';
  /** Where and how it was graded ("mtg-table coach-grade <commit>"). */
  grader?: string;
  gradedAt?: string;
  /** What the hidden cards were drawn from: "deck:<path>" or "pool:<path>". */
  opponent?: string;
  /** Playouts in all, and the most any option got. */
  playouts: number;
  /** Turns after this one that a playout runs before the evaluator (−1 = to the game's end). */
  horizon?: number;
  /** Median regret half-width over the options: the table's noise. */
  noise: number;
  /** What the rebuild of the position could not reproduce. */
  fidelity?: string[];
  notes?: string[];
  options: GradeOption[];
}

/** A regret interval wider than ± this many win-rate points is low-information. */
export const LOW_INFO_HALF_WIDTH = 0.08;

/** Problems with a case's `grade` (empty when it is well formed). */
export function gradeProblems(raw: unknown): string[] {
  const g = raw as Partial<CaseGrade> | null;
  const out: string[] = [];
  if (!g || typeof g !== 'object') return ['grade: an object'];
  if (g.v !== 1) out.push('grade.v: 1');
  if (g.yardstick !== 'forge-default') out.push('grade.yardstick: "forge-default"');
  if (typeof g.playouts !== 'number') out.push('grade.playouts: a number');
  if (typeof g.noise !== 'number') out.push('grade.noise: a number');
  if (!Array.isArray(g.options) || g.options.length < 2) out.push('grade.options: two or more options');
  else
    for (const o of g.options) {
      const bad = ['n', 'winRate', 'winLo', 'winHi', 'regret', 'regretLo', 'regretHi'].filter((k) => typeof (o as unknown as Record<string, unknown>)[k] !== 'number');
      if (typeof o.token !== 'string' || bad.length) out.push(`grade.options: ${o.token ?? '?'} lacks ${bad.join(', ') || 'a token'}`);
    }
  return out;
}

/** Half the width of an option's regret interval. */
export const halfWidth = (o: Pick<GradeOption, 'regretLo' | 'regretHi'>): number => (o.regretHi - o.regretLo) / 2;

/** Is this option's regret too uncertain to count as evidence on its own? */
export const isLowInfo = (o: Pick<GradeOption, 'regretLo' | 'regretHi' | 'failed'>): boolean => !!o.failed || halfWidth(o) > LOW_INFO_HALF_WIDTH;

// ---------------------------------------------------------------------------
// The grader's output (one line of `coach-grade.sh batch`)

/** A moment to grade (`bench:coach -- moments`): one line of moments.jsonl. */
export interface MomentLine {
  log: string;
  frame: number;
  mode: 'live' | 'review';
  type: 'spell' | 'attack' | 'block' | 'target';
  /** A review moment's decision kind. */
  kind?: string;
  id?: string;
  label?: string;
  source?: string;
  extra?: string[];
  deck?: string;
  oppDeck?: string;
  oppPool?: string;
}

/** The grader's result for one moment (the `grade` field of a batch line). */
export interface GraderResult {
  status: 'ok' | 'trivial' | 'unsupported' | 'error';
  error?: string;
  key?: string;
  opponent?: string;
  rounds?: number;
  playouts?: number;
  best?: string;
  spread?: number;
  noise?: number;
  forgeChoice?: string;
  fidelity?: string[];
  notes?: string[];
  options?: GradeOption[];
  config?: { horizon?: number; target?: number; seed?: number };
  ms?: number;
}

export interface GradedLine extends MomentLine {
  momentKey: string;
  grade: GraderResult;
}

/** A batch line as a case's `grade`, or null when it graded nothing usable. */
export function caseGradeOf(r: GraderResult, meta: { grader?: string; gradedAt?: string } = {}): CaseGrade | null {
  if (r.status !== 'ok' || !r.options || r.options.length < 2) return null;
  const options = r.options.map((o) => {
    const x: GradeOption = { token: o.token, n: o.n, winRate: o.winRate, winLo: o.winLo, winHi: o.winHi, regret: o.regret, regretLo: o.regretLo, regretHi: o.regretHi };
    if (o.label) x.label = o.label;
    if (o.best) x.best = true;
    if (o.forge) x.forge = true;
    if (o.failed) x.failed = true;
    if (o.alias) x.alias = o.alias;
    return x;
  });
  if (options.some((o) => [o.winRate, o.regret, o.regretLo, o.regretHi].some((v) => typeof v !== 'number' || !Number.isFinite(v)))) return null;
  const g: CaseGrade = {
    v: 1,
    yardstick: 'forge-default',
    playouts: r.playouts ?? options.reduce((a, o) => a + o.n, 0),
    noise: typeof r.noise === 'number' && Number.isFinite(r.noise) ? r.noise : Math.max(...options.map(halfWidth)),
    options,
  };
  if (meta.grader) g.grader = meta.grader;
  if (meta.gradedAt) g.gradedAt = meta.gradedAt;
  if (r.opponent) g.opponent = r.opponent;
  if (typeof r.config?.horizon === 'number') g.horizon = r.config.horizon;
  if (r.fidelity?.length) g.fidelity = r.fidelity;
  if (r.notes?.length) g.notes = r.notes;
  return g;
}

// ---------------------------------------------------------------------------
// The turning-point miner's selection

/** Fidelity notes that do not change the position the coach saw (they are about hidden cards). */
const BENIGN_FIDELITY = [/is a guess from the hidden cards/, /a random subset is used each round/, /trigger\(s\) the loader fired again were removed/];

/** Fidelity warnings that do change the position (a lost effect, a missing card, a wrong P/T). */
export function seriousFidelity(f: string[] | undefined): string[] {
  return (f ?? []).filter((x) => !BENIGN_FIDELITY.some((re) => re.test(x)));
}

export interface SelectOptions {
  /** Keep at most this many decisions. */
  keep: number;
  /** The smallest best-minus-worst win-rate spread worth grading properly (default 0.15). */
  minSpread?: number;
  /** Serious fidelity warnings tolerated (default 0). */
  maxFidelity?: number;
  /** At most this share of the kept decisions from one log (default 0.25, at least 1). */
  perLogShare?: number;
}

export interface Selected {
  line: GradedLine;
  /** The selection score: the spread, less the first pass's noise. */
  score: number;
  spread: number;
  why: string;
}

/**
 * The turning points of a cheap first pass: decisions whose options' win rates
 * differ most, after the first pass's own noise is taken off (a spread a few
 * playouts cannot tell from zero is not a turning point). Ties go to the
 * fewer-option decision (cheaper to grade well); at most a share of the kept
 * decisions come from one log, and each decision type keeps a place while
 * one is left, so one long game or one kind of decision does not fill the set.
 */
export function selectTurningPoints(lines: GradedLine[], o: SelectOptions): { kept: Selected[]; rejected: { key: string; why: string }[] } {
  const minSpread = o.minSpread ?? 0.15;
  const maxFid = o.maxFidelity ?? 0;
  const rejected: { key: string; why: string }[] = [];
  const pool: Selected[] = [];
  for (const line of lines) {
    const g = line.grade;
    if (g.status !== 'ok' || !g.options || g.options.length < 2) {
      rejected.push({ key: line.momentKey, why: `${g.status}${g.error ? `: ${g.error}` : ''}` });
      continue;
    }
    const serious = seriousFidelity(g.fidelity);
    if (serious.length > maxFid) {
      rejected.push({ key: line.momentKey, why: `fidelity: ${serious.join('; ')}` });
      continue;
    }
    const rates = g.options.filter((x) => !x.failed && !x.alias && x.n > 0).map((x) => x.winRate);
    if (rates.length < 2) {
      rejected.push({ key: line.momentKey, why: 'fewer than two options played' });
      continue;
    }
    const spread = Math.max(...rates) - Math.min(...rates);
    const noise = typeof g.noise === 'number' && Number.isFinite(g.noise) ? g.noise : 0;
    const score = spread - noise / 2;
    if (spread < minSpread) {
      rejected.push({ key: line.momentKey, why: `spread ${spread.toFixed(2)} < ${minSpread}` });
      continue;
    }
    pool.push({ line, score, spread, why: `spread ${spread.toFixed(2)}, first-pass noise ±${noise.toFixed(2)}` });
  }
  pool.sort((a, b) => b.score - a.score || (a.line.grade.options!.length - b.line.grade.options!.length) || a.line.momentKey.localeCompare(b.line.momentKey));
  const perLog = Math.max(1, Math.floor((o.perLogShare ?? 0.25) * o.keep));
  const kept: Selected[] = [];
  const fromLog = new Map<string, number>();
  const types = [...new Set(pool.map((p) => p.line.type))];
  const take = (p: Selected) => {
    kept.push(p);
    fromLog.set(p.line.log, (fromLog.get(p.line.log) ?? 0) + 1);
  };
  const ok = (p: Selected) => !kept.includes(p) && (fromLog.get(p.line.log) ?? 0) < perLog;
  // One of each type first (the best of its type), then by score.
  for (const t of types) {
    const p = pool.find((x) => x.line.type === t && ok(x));
    if (p && kept.length < o.keep) take(p);
  }
  for (const p of pool) {
    if (kept.length >= o.keep) break;
    if (ok(p)) take(p);
  }
  kept.sort((a, b) => b.score - a.score);
  for (const p of pool) if (!kept.includes(p)) rejected.push({ key: p.line.momentKey, why: `not kept (score ${p.score.toFixed(2)}${(fromLog.get(p.line.log) ?? 0) >= perLog ? ', log share full' : ''})` });
  return { kept, rejected };
}

// ---------------------------------------------------------------------------
// From a graded decision to a case's answer lists

/** A clear blunder: at least this regret, with an interval that excludes zero. */
export const BLUNDER_REGRET = 0.1;

/**
 * The acceptable and unacceptable answers a regret table implies: acceptable
 * are the best option and every option not distinguishable from it (its regret
 * interval reaches 0), best first, at most three; unacceptable are the options
 * whose regret is at least BLUNDER_REGRET with an interval clear of 0. `legal`
 * filters to answers the bench's own legality check accepts.
 */
export function answerLists(g: CaseGrade, legal: (token: string) => boolean = () => true): { acceptable: string[]; unacceptable: string[] } {
  const live = g.options.filter((o) => !o.failed && legal(o.token));
  const acceptable = live
    .filter((o) => o.best || o.regretLo <= 1e-9)
    .sort((a, b) => Number(!!a.alias) - Number(!!b.alias) || a.regret - b.regret || b.winRate - a.winRate)
    .slice(0, 3)
    .map((o) => o.token);
  const unacceptable = live
    .filter((o) => !acceptable.includes(o.token) && o.regret >= BLUNDER_REGRET && o.regretLo > 0)
    .sort((a, b) => Number(!!a.alias) - Number(!!b.alias) || b.regret - a.regret)
    .slice(0, 12)
    .map((o) => o.token);
  return { acceptable, unacceptable };
}

/** A plain-words rationale from the table (no rules reasoning: the engine's numbers). */
export function gradeRationale(g: CaseGrade): string {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const sorted = g.options.filter((o) => !o.alias).sort((a, b) => b.winRate - a.winRate);
  const best = sorted[0]!;
  const worst = sorted[sorted.length - 1]!;
  const forge = g.options.find((o) => o.forge);
  return (
    `Engine-graded against Forge Default (${g.playouts} playouts, noise ±${pct(g.noise)}): ` +
    `${best.label ?? best.token} wins ${pct(best.winRate)} [${pct(best.winLo)}, ${pct(best.winHi)}]; ` +
    `${worst.label ?? worst.token} wins ${pct(worst.winRate)}.` +
    (forge ? ` Forge Default itself chose ${forge.label ?? forge.token} (regret ${pct(forge.regret)}).` : '')
  );
}

// ---------------------------------------------------------------------------
// The held-out set

/** A stable 32-bit hash (FNV-1a) of a string. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Which `n` of these graded cases to hold out: spread over the decision types
 * (round robin, types in a fixed order), within a type by a hash of the id —
 * a fixed choice that no prompt result can influence. Cases already held out
 * count towards `n`; nothing already chosen moves.
 */
export function chooseHoldout(cases: { id: string; type: string; holdout?: boolean }[], n: number): string[] {
  const already = cases.filter((c) => c.holdout).map((c) => c.id);
  const need = Math.max(0, n - already.length);
  const byType = new Map<string, string[]>();
  for (const c of cases.filter((x) => !x.holdout).sort((a, b) => hash32(a.id) - hash32(b.id) || a.id.localeCompare(b.id))) {
    const l = byType.get(c.type) ?? [];
    l.push(c.id);
    byType.set(c.type, l);
  }
  const types = [...byType.keys()].sort();
  const out: string[] = [];
  for (let round = 0; out.length < need; round++) {
    let any = false;
    for (const t of types) {
      const id = byType.get(t)![round];
      if (id && out.length < need) {
        out.push(id);
        any = true;
      }
    }
    if (!any) break;
  }
  return [...already, ...out];
}
