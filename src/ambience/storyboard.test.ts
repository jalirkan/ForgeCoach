/*
 * ForgeCoach — ambience/storyboard.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The scenery's storyboard walk (storyboard.ts): every mana state a side can
 * have, through the board's real rules, with ForgeCoach's own pack
 * (pack-v9.2, the default since spec 1.19 d), the pairs each mode loads (pairs-v3.1 without the flag, the
 * tagged pairs-v7.1 under `?pairfull=1`), at a desktop's shape (1600 px) and
 * a phone's (375 px). It asks one question of each: is every colour with
 * lands on the battlefield on screen?
 *
 * Why: on 2026-11-02 Justin built Island 2, Swamp 2, Mountain 2, Forest 3 on
 * his phone under `?pairfull=1` and the half showed island+forest's seam cell
 * only. The swamp (the third colour: painted into the cell for the desktop,
 * no phone picture) and the mountain (the fourth: "the rest show nothing")
 * were invisible. No test had walked the normal situations through.
 *
 * The states (the owner's scope, 2026-11-02: "assume any and every colour can
 * be on the board, up to 6 lands each; soup decks play every colour"): every
 * vector of 0–6 basics in each of W U B R G (16,806 non-empty), the colours
 * arriving in WUBRG order, in reverse, and heaviest last (the tie rules follow
 * arrival; an order that gives the same arrival is walked once); and each
 * vector of 0–4 a colour plus one dual of any of the ten pairs, arriving in
 * WUBRG order. Every picture is taken as loaded (the load gate's hold is not
 * walked).
 *
 * `every colour with lands is on screen` was an EXPECTED FAILURE (`it.fails`)
 * while the owner decided the hiding rules, with {@link KNOWN_GAPS} the
 * explicit allow-list of the gaps (a fourth or fifth colour dropped
 * everywhere, the third on a phone's seam cell). Spec 1.19 a (2026-11-02:
 * every colour visible, the fold to three gone) and d (pack-v9.2's phone
 * cut-outs the default) closed both, so it is a plain test now and the list
 * is empty: a colour with lands and nothing on screen fails it, and `the gaps
 * are exactly the known ones` still holds the list to what the walk finds,
 * should a gap ever be allowed again. Captions likewise
 * ({@link KNOWN_CAPTION_GAPS}, a plain test: empty).
 *
 * The flip count: the walk's own single-land steps start from a state picked
 * with nothing showing, so under spec 1.19 b (the pair showing stays while
 * both its colours are among the three heaviest) one land can never move a
 * pair colour out of the top three -- the count is 0 by construction (it was
 * 15,745 of 206,555 under the flag before). `alongPlay` counts what a player
 * sees instead: every state with no dual played land by land (in blocks, and
 * round-robin, in its arrival order) with the memory carried, under the old
 * rule and the new.
 *
 * The report: `STORYBOARD_REPORT=<dir> npx vitest run src/ambience/storyboard.test.ts`
 * writes `<dir>/STORYBOARD-WALK.md` and `<dir>/storyboard-walk.json`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PIECE_COLOURS, validateManifest, type PieceColour } from './manifest.ts';
import { makeupOf, pairKeyOrder, pickMakeup, rankColours, type Makeup, type MakeupShowing } from './makeup.ts';
import { validatePairs } from './pairs.ts';
import { FORGECOACH_PACK_URL, FORGECOACH_PAIRS_FULL_URL, FORGECOACH_PAIRS_URL } from './prefs.ts';
import { addLand, colourCount, enumerateStates, landCount, SHAPES, stateLabel, storyboardHalf, weightOf, type GapReason, type HalfStoryboard, type ManaState, type Shape, type StoryboardPacks } from './storyboard.ts';

const json = (f: string) => JSON.parse(readFileSync(new URL(`./testdata/${f}`, import.meta.url), 'utf8'));
const PACKS: StoryboardPacks = {
  pack: validateManifest(json('pack-v9.2.scenery.json'), `${FORGECOACH_PACK_URL}scenery.json`).pack!,
  pairsOff: validatePairs(json('pairs-v3.1.pairs.json'), `${FORGECOACH_PAIRS_URL}pairs.json`).pairs,
  pairsFull: validatePairs(json('pairs-v7.1.tag.pairs.json'), `${FORGECOACH_PAIRS_FULL_URL}pairs.json`).pairs,
};

interface Combo {
  shape: Shape;
  pairfull: boolean;
}
const COMBOS: readonly Combo[] = [
  { shape: 'desktop', pairfull: false },
  { shape: 'phone', pairfull: false },
  { shape: 'desktop', pairfull: true },
  { shape: 'phone', pairfull: true },
];
const comboId = (c: Combo) => `${c.pairfull ? 'pairfull' : 'default'}/${c.shape}`;

/**
 * The allowed gaps, `<flag>/<shape>/<reason>` (storyboard.ts `GapReason`): every rule that may leave a colour with
 * lands with nothing on screen. Empty since spec 1.19 a and d (2026-11-02), which closed the last two: the dropped
 * fourth and fifth colour (`dropped`, everywhere) and the third on a phone's seam cell (`third-on-cell-phone`).
 */
const KNOWN_GAPS: readonly string[] = [];

/** Today's caption faults, `<flag>/<shape>/<names-undrawn|omits-drawn>`; empty, the captions are honest. */
const KNOWN_CAPTION_GAPS: readonly string[] = [];

const RULE_WORDS: Record<GapReason, string> = {
  'no-element': "a colour drawn as a 1.14 cut-out (spec 1.19 a: the third where nothing is painted in, every colour past it) whose element the pack lacks at this shape (on a phone, its phone piece)",
  unexplained: 'no known rule: the walk could not say why',
};
const CAPTION_WORDS: Record<string, string> = {
  'names-undrawn': 'the caption names a colour the half does not draw',
  'omits-drawn': 'the caption (when there is one) leaves out a colour the half draws',
};

// ---------------------------------------------------------------------------
// The walk (once, shared by the tests and the report)

interface Example {
  state: string;
  lands: number;
  colours: number;
  visible: string;
  invisible: string;
  picture: string;
  caption: string | null;
}
const exampleOf = (s: ManaState, h: HalfStoryboard): Example => ({
  state: stateLabel(s),
  lands: landCount(s),
  colours: colourCount(s),
  visible: h.visible.join(''),
  invisible: h.invisible.map((x) => `${x.colour}:${x.reason}`).join(' '),
  picture: h.picture,
  caption: h.caption,
});
/** Smaller is fewer lands, then fewer colours, then the label. */
const smaller = (a: Example, b: Example) => a.lands < b.lands || (a.lands === b.lands && (a.colours < b.colours || (a.colours === b.colours && a.state < b.state)));
const bySize = (a: Example, b: Example) => (smaller(a, b) ? -1 : smaller(b, a) ? 1 : 0);

interface Rule {
  id: string;
  count: number;
  example: Example;
  /** The smallest state with no dual. */
  basic?: Example;
}
interface Tally {
  states: number;
  withGap: number;
}
interface FlipStats {
  transitions: number;
  /** The half's pair picture changed to another pair (both before and after a pair picture). */
  pairFlips: number;
  /**
   * Of those, the flips SYSTEM.md A5's tie rule forbids: the pair drawn before is still kept and still as heavy as
   * the pair drawn after ("on a tie, the pair already showing stays"). Zero, or the walk found a tie-rule fault.
   */
  tieFlips: number;
  /** A colour on screen before the land is on screen no longer after it. */
  lostColour: number;
  flipExamples: (Example & { from: string; added: PieceColour })[];
  lostExamples: (Example & { from: string; added: PieceColour; lost: string })[];
  flipsByColours: Record<number, { transitions: number; flips: number }>;
}
interface FiveColour {
  states: number;
  /** How many of the five show nothing → states. */
  hidden: Record<number, number>;
  /** What the half draws, by kind (`pair cell + painted`, `3 panels`, …) → states. */
  drawn: Record<string, number>;
}

interface Walk {
  states: number;
  basics: number;
  duals: number;
  /** combo → key (`1`–`5` colours, `basics`, `dual`, `all`) → tally. */
  tallies: Record<string, Record<string, Tally>>;
  /** combo → the fewest lands of an invisible colour (`1` … `6`, `0.5` a dual's half) → states. */
  byMinLands: Record<string, Record<string, number>>;
  /** combo → colours → fewest lands of an invisible colour → states. */
  cross: Record<string, Record<string, Record<string, number>>>;
  rules: Map<string, Rule>;
  captions: Map<string, Rule>;
  flips: Record<string, FlipStats>;
  five: Record<string, FiveColour>;
  fiveSamples: { state: string; per: Record<string, Example> }[];
  justin: Record<string, Example>;
  records: unknown[];
}

const addRule = (m: Map<string, Rule>, id: string, ex: Example, dual: boolean) => {
  let r = m.get(id);
  if (!r) m.set(id, (r = { id, count: 0, example: ex }));
  r.count++;
  if (smaller(ex, r.example)) r.example = ex;
  if (!dual && (!r.basic || smaller(ex, r.basic))) r.basic = ex;
};
const bump = (o: Record<string, number>, k: string | number) => (o[k] = (o[k] ?? 0) + 1);

/** What kind of thing a half draws, for the five-colour summary. */
function drawnKind(h: HalfStoryboard): string {
  const kinds = h.drawn.map((d) => d.kind);
  const panels = kinds.filter((k) => k === 'panel').length;
  const pair = h.drawn.find((d) => d.kind === 'pair');
  if (!pair) return `${panels} panel${panels === 1 ? '' : 's'}`;
  const what = / cell /.test(pair.what) ? 'pair cell' : 'pair stage picture';
  return [what, ...(kinds.includes('painted') ? ['painted third'] : []), ...(kinds.includes('cutout') ? ['cut-out'] : []), ...(panels ? [`${panels} panel`] : [])].join(' + ');
}

const JUSTIN: ManaState = { counts: { U: 2, B: 2, R: 2, G: 3 }, duals: [], arrival: ['U', 'B', 'R', 'G'] };
/** Five-colour sides listed in the report (WUBRG arrival): even ones, and skewed ones. */
const FIVE_SAMPLES: Partial<Record<PieceColour, number>>[] = [
  ...[1, 2, 3, 4, 5, 6].map((n) => Object.fromEntries(PIECE_COLOURS.map((c) => [c, n]))),
  { W: 1, U: 2, B: 3, R: 4, G: 5 },
  { W: 6, U: 5, B: 4, R: 3, G: 2 },
  { W: 1, U: 1, B: 1, R: 1, G: 6 },
  { W: 6, U: 6, B: 1, R: 1, G: 1 },
  { W: 6, U: 6, B: 6, R: 1, G: 1 },
  { W: 2, U: 2, B: 2, R: 2, G: 3 },
  { W: 3, U: 3, B: 3, R: 2, G: 2 },
];

let cached: Walk | null = null;
function walk(): Walk {
  if (cached) return cached;
  const all = enumerateStates({ duals: true, dualMax: 4 });
  const w: Walk = { states: all.length, basics: 0, duals: 0, tallies: {}, byMinLands: {}, cross: {}, rules: new Map(), captions: new Map(), flips: {}, five: {}, fiveSamples: [], justin: {}, records: [] };
  for (const c of COMBOS) {
    const id = comboId(c);
    w.tallies[id] = {};
    w.byMinLands[id] = {};
    w.cross[id] = {};
    w.flips[id] = { transitions: 0, pairFlips: 0, tieFlips: 0, lostColour: 0, flipExamples: [], lostExamples: [], flipsByColours: {} };
    w.five[id] = { states: 0, hidden: {}, drawn: {} };
  }
  for (const { state, order } of all) {
    const n = colourCount(state);
    const dual = state.duals.length > 0;
    if (dual) w.duals++;
    else w.basics++;
    const per: unknown[] = [];
    for (const c of COMBOS) {
      const id = comboId(c);
      const h = storyboardHalf(state, c.shape, c.pairfull, PACKS);
      const ex = exampleOf(state, h);
      for (const key of [`${n}`, 'all', dual ? 'dual' : 'basics']) {
        const t = (w.tallies[id]![key] ??= { states: 0, withGap: 0 });
        t.states++;
        if (h.invisible.length) t.withGap++;
      }
      if (h.invisible.length) {
        const min = String(Math.min(...h.invisible.map((x) => weightOf(state, x.colour))));
        bump(w.byMinLands[id]!, min);
        bump((w.cross[id]![n] ??= {}), min);
      }
      for (const reason of new Set(h.invisible.map((x) => x.reason))) addRule(w.rules, `${id}/${reason}`, ex, dual);
      if (h.caption) {
        if (h.captionNames.some((x) => !h.visible.includes(x))) addRule(w.captions, `${id}/names-undrawn`, ex, dual);
        if (h.visible.some((x) => !h.captionNames.includes(x))) addRule(w.captions, `${id}/omits-drawn`, ex, dual);
      }
      if (dual) continue;
      per.push([ex.visible, ex.invisible, ex.picture]);
      if (n === 5) {
        const f = w.five[id]!;
        f.states++;
        bump(f.hidden, h.invisible.length);
        bump(f.drawn, drawnKind(h));
      }
      // One basic land more, with what the half showed as the tie-breaker (MakeupMemory).
      const fl = w.flips[id]!;
      for (const add of PIECE_COLOURS) {
        if ((state.counts[add] ?? 0) >= 6) continue;
        const next = addLand(state, add);
        const h2 = storyboardHalf(next, c.shape, c.pairfull, PACKS, h.pick, { caption: false });
        fl.transitions++;
        const by = (fl.flipsByColours[colourCount(next)] ??= { transitions: 0, flips: 0 });
        by.transitions++;
        if (h.picturePair && h2.picturePair && h.picturePair.join() !== h2.picturePair.join()) {
          fl.pairFlips++;
          by.flips++;
          const was = h.picturePair;
          const kw = h2.pick.weights;
          if (was.every((x) => h2.pick.kept.includes(x)) && Math.abs((kw[was[0]] ?? 0) + (kw[was[1]] ?? 0) - h2.picturePair.reduce((n, x) => n + (kw[x] ?? 0), 0)) < 1e-9) fl.tieFlips++;
          fl.flipExamples.push({ ...exampleOf(next, h2), from: h.picture, added: add });
          if (fl.flipExamples.length > 400) fl.flipExamples = fl.flipExamples.sort(bySize).slice(0, 12);
        }
        const lost = h.visible.filter((x) => !h2.visible.includes(x));
        if (lost.length) {
          fl.lostColour++;
          fl.lostExamples.push({ ...exampleOf(next, h2), from: `${h.visible.join('')} ${h.picture}`, added: add, lost: lost.join('') });
          if (fl.lostExamples.length > 400) fl.lostExamples = fl.lostExamples.sort(bySize).slice(0, 12);
        }
      }
    }
    // Every state with no dual: its label and order, then per mode/shape [visible, invisible, what is drawn].
    if (!dual) w.records.push([stateLabel(state), order, ...per]);
  }
  for (const f of Object.values(w.flips)) {
    f.flipExamples = f.flipExamples.sort(bySize).slice(0, 12);
    f.lostExamples = f.lostExamples.sort(bySize).slice(0, 12);
  }
  for (const c of COMBOS) w.justin[comboId(c)] = exampleOf(JUSTIN, storyboardHalf(JUSTIN, c.shape, c.pairfull, PACKS));
  for (const counts of FIVE_SAMPLES) {
    const s: ManaState = { counts, duals: [], arrival: [...PIECE_COLOURS] };
    w.fiveSamples.push({ state: stateLabel(s), per: Object.fromEntries(COMBOS.map((c) => [comboId(c), exampleOf(s, storyboardHalf(s, c.shape, c.pairfull, PACKS))])) });
  }
  cached = w;
  return w;
}

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : '–');
const ruleLines = (rules: Map<string, Rule>, known: readonly string[]) =>
  [...rules.values()]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((r) => {
      const b = r.basic && r.basic !== r.example ? `; with no dual: ${r.basic.state} -> draws ${r.basic.picture || '(nothing)'}; hidden ${r.basic.invisible || '-'}` : '';
      return `  ${known.includes(r.id) ? 'KNOWN' : 'NEW  '} ${r.id}: ${r.count} state(s); smallest: ${r.example.state} -> draws ${r.example.picture || '(nothing)'}; hidden ${r.example.invisible || '-'}${b}`;
    })
    .join('\n');

// ---------------------------------------------------------------------------

describe('the storyboard walk: every colour with lands, on screen', () => {
  it('walks every vector of 0–6 lands a colour, in three arrival orders, and the duals, at both shapes, with the flag and without', { timeout: 600_000 }, () => {
    const w = walk();
    // 7^5 - 1 vectors; a vector of one colour has one arrival, of two or more WUBRG and its reverse at least.
    expect(new Set(w.records.map((r) => (r as string[])[0]!.replace(/ \(arrived .*/, ''))).size).toBe(16_806);
    expect(w.basics).toBeGreaterThan(2 * 16_806 - 35);
    expect(w.duals).toBeGreaterThan(30_000);
    for (const c of COMBOS) expect(w.tallies[comboId(c)]!.all!.states).toBe(w.states);
  });

  it('reproduces Justin’s phone board of 2026-11-02 (U2 B2 R2 G3 under ?pairfull=1): forest+island’s cell, and now the swamp and the mountain as cut-outs', () => {
    const phone = storyboardHalf(JUSTIN, 'phone', true, PACKS);
    expect(phone.picturePair).toEqual(['G', 'U']);
    expect(phone.picture).toMatch(/^forest\+island cell 2x3 \[s2x3-panorama-phone\] \+ cut-outs BR$/);
    expect(phone.colours).toEqual(['U', 'B', 'R', 'G']);
    // Spec 1.19 a and 1.18.1 with pack-v9.2's phone pieces: the swamp (third, painted only for the desktop) and the
    // mountain (fourth, dropped until 1.19) stand on the forest's ground; the caption names them.
    expect(phone.invisible).toEqual([]);
    expect(phone.drawn.filter((d) => d.kind === 'cutout').map((d) => d.what)).toEqual(['swamp cut-out (heavier ground 1/2, 0.889)', 'mountain cut-out (heavier ground 2/2, 0.889)']);
    expect(phone.caption).toMatch(/island s2 \| forest s3, seam 2x3; swamp and mountain as elements$/);
    const desk = storyboardHalf(JUSTIN, 'desktop', true, PACKS);
    expect(desk.picture).toMatch(/^forest\+island cell 2x3 \+B \[s2x3\+BR-panorama\] \+ cut-outs R$/);
    expect(desk.caption).toMatch(/seam 2x3; B painted in, on forest's ground; mountain as an element$/);
  });

  // Was an EXPECTED failure (vitest `it.fails`) while KNOWN_GAPS listed any gap; spec 1.19 a and d closed the last one,
  // so it is a plain test: a colour with lands and nothing on screen fails it.
  it('every colour with lands is on screen (the log lists any rule that hides one)', { timeout: 600_000 }, () => {
    const w = walk();
    const table = COMBOS.map((c) => {
      const t = w.tallies[comboId(c)]!;
      return `  ${comboId(c).padEnd(17)} ${[1, 2, 3, 4, 5].map((n) => `${n}c ${t[n]?.withGap ?? 0}/${t[n]?.states ?? 0}`).join('  ')}  all ${t.all!.withGap}/${t.all!.states} (${pct(t.all!.withGap, t.all!.states)})`;
    }).join('\n');
    const message = `states with a colour that has lands and nothing on screen, by colours:\n${table}\nthe rules (KNOWN = on the allow-list, KNOWN_GAPS):\n${ruleLines(w.rules, KNOWN_GAPS)}\n`;
    if (w.rules.size) console.log(message);
    expect([...w.rules.keys()].sort(), message).toEqual([]);
  });

  it('the gaps are exactly the known ones: no new rule hides a colour, and none on the list has been fixed without deleting its line', { timeout: 600_000 }, () => {
    const found = [...walk().rules.keys()].sort();
    expect(found.filter((id) => !KNOWN_GAPS.includes(id)), 'a NEW gap: a rule hides a colour that KNOWN_GAPS does not list').toEqual([]);
    expect(KNOWN_GAPS.filter((id) => !found.includes(id)), 'FIXED: delete these lines from KNOWN_GAPS').toEqual([]);
  });

  it('no gap is unexplained (every hidden colour is one the pack has no cut-out for)', { timeout: 600_000 }, () => {
    expect([...walk().rules.keys()].filter((id) => id.endsWith('/unexplained'))).toEqual([]);
  });

  it('the caption names what the half draws and leaves none of it out (FAILS while KNOWN_CAPTION_GAPS lists any)', { timeout: 600_000 }, () => {
    const w = walk();
    const message = `caption faults (KNOWN = on KNOWN_CAPTION_GAPS):\n${ruleLines(w.captions, KNOWN_CAPTION_GAPS)}\n`;
    if (w.captions.size) console.log(message);
    expect([...w.captions.keys()].sort(), message).toEqual([]);
    expect(KNOWN_CAPTION_GAPS.filter((id) => !w.captions.has(id)), 'FIXED: delete these lines from KNOWN_CAPTION_GAPS').toEqual([]);
  });

  it('counts the single-land steps that flip the half’s pair picture (reported, not judged)', { timeout: 600_000 }, () => {
    const w = walk();
    const lines = COMBOS.map((c) => {
      const f = w.flips[comboId(c)]!;
      return `  ${comboId(c).padEnd(17)} ${f.transitions} steps: pair picture flips ${f.pairFlips} (${pct(f.pairFlips, f.transitions)}), of which on a tie ${f.tieFlips}, a colour on screen lost ${f.lostColour} (${pct(f.lostColour, f.transitions)})`;
    });
    console.log(`one basic land more:\n${lines.join('\n')}`);
    // SYSTEM.md A5: on a tie the pair already showing stays, so no step flips away from a pair that still ties the heaviest.
    for (const c of COMBOS) expect(w.flips[comboId(c)]!.tieFlips, `${comboId(c)}: a land flipped the pair on a tie`).toBe(0);
    // The flag off never draws a pair picture, so it never flips one.
    expect(w.flips['default/desktop']!.pairFlips).toBe(0);
    expect(w.flips['pairfull/desktop']!.transitions).toBe(206_555);
    // Spec 1.19 b: from a state picked with nothing showing, a pair colour has at most one colour above it, so one land
    // cannot move it out of the top three (15,745 flips under the flag before 1.19 b). And no colour leaves the screen.
    for (const c of COMBOS) expect([w.flips[comboId(c)]!.pairFlips, w.flips[comboId(c)]!.lostColour]).toEqual([0, 0]);
  });

  it('counts the pair changes a player sees, land by land with the memory carried: the old rule against spec 1.19 b (reported)', { timeout: 600_000 }, () => {
    const a = alongPlay();
    const line = (name: string, x: PlayCount) => `  ${name.padEnd(22)} ${x.steps} steps: the pair changes ${x.oldFlips} times under the old rule (${pct(x.oldFlips, x.steps)}), ${x.newFlips} under 1.19 b (${pct(x.newFlips, x.steps)})`;
    console.log(`every state with no dual, played land by land in its arrival order:\n${line('in blocks', a.blocks)}\n${line('round-robin', a.robin)}`);
    for (const x of [a.blocks, a.robin]) {
      expect(x.steps).toBeGreaterThan(100_000);
      // The base changes far less often; a change still happens when a pair colour leaves the top three.
      expect(x.newFlips).toBeLessThan(x.oldFlips / 2);
      expect(x.newFlips).toBeGreaterThan(0);
      // Every change under 1.19 b is a pair colour leaving the top three (or the pair forming at the second colour, not counted).
      expect(x.newNotLeaving).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Along play: what a player sees, the memory carried

interface PlayCount {
  steps: number;
  oldFlips: number;
  newFlips: number;
  /** Changes under 1.19 b where both colours of the pair before were still among the three heaviest (must be none). */
  newNotLeaving: number;
}

/** makeup.ts's pick before spec 1.19 b: the three heaviest kept (a tie: showing, then arrival), the pair their two heaviest. */
function oldPick(m: Makeup, showing: MakeupShowing | null): MakeupShowing {
  const keptSet = rankColours(m, showing?.kept ?? showing?.pair ?? null).slice(0, 3);
  const kept = rankColours(m, showing?.pair ?? null, keptSet);
  return { kept, pair: kept.length >= 2 ? pairKeyOrder(kept[0]!, kept[1]!) : null };
}

/** Every state with no dual, its lands played one at a time (each colour's in a block, or one of each in turn), counting the steps that change the pair. */
function alongPlay(): { blocks: PlayCount; robin: PlayCount } {
  const out = { blocks: { steps: 0, oldFlips: 0, newFlips: 0, newNotLeaving: 0 }, robin: { steps: 0, oldFlips: 0, newFlips: 0, newNotLeaving: 0 } };
  for (const { state } of enumerateStates({ duals: false })) {
    const order = state.arrival.filter((c) => (state.counts[c] ?? 0) > 0);
    const blocks = order.flatMap((c) => Array<PieceColour>(state.counts[c]!).fill(c));
    const robin: PieceColour[] = [];
    for (let k = 0; robin.length < blocks.length; k++) for (const c of order) if ((state.counts[c] ?? 0) > k) robin.push(c);
    for (const [name, seq] of [['blocks', blocks], ['robin', robin]] as const) {
      const n = out[name];
      const w: Partial<Record<PieceColour, number>> = {};
      const arrived: PieceColour[] = [];
      let oldShow: MakeupShowing | null = null;
      let newShow: MakeupShowing | null = null;
      for (const c of seq) {
        w[c] = (w[c] ?? 0) + 1;
        if (!arrived.includes(c)) arrived.push(c);
        const m = makeupOf(w, arrived);
        const o = oldPick(m, oldShow);
        const p = pickMakeup(m, newShow);
        if (oldShow?.pair && o.pair) {
          n.steps++;
          if (o.pair.join() !== oldShow.pair.join()) n.oldFlips++;
        }
        if (newShow?.pair && p.pair && p.pair.join() !== newShow.pair.join()) {
          n.newFlips++;
          const above = (x: PieceColour) => m.colours.filter((y) => (m.weights[y] ?? 0) > (m.weights[x] ?? 0) + 1e-9).length;
          if (newShow.pair.every((x) => above(x) < 3)) n.newNotLeaving++;
        }
        oldShow = o;
        newShow = p;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The report (only when asked: STORYBOARD_REPORT=<dir>)

afterAll(() => {
  const dir = process.env.STORYBOARD_REPORT;
  if (!dir || !cached) return;
  mkdirSync(dir, { recursive: true });
  const w = cached;
  writeFileSync(join(dir, 'STORYBOARD-WALK.md'), reportMarkdown(w));
  writeFileSync(
    join(dir, 'storyboard-walk.json'),
    JSON.stringify({
      generated: new Date().toISOString(),
      packs: { pack: FORGECOACH_PACK_URL, pairsOff: FORGECOACH_PAIRS_URL, pairsFull: FORGECOACH_PAIRS_FULL_URL },
      shapes: SHAPES,
      modes: COMBOS.map(comboId),
      knownGaps: KNOWN_GAPS,
      states: w.states,
      basics: w.basics,
      duals: w.duals,
      tallies: w.tallies,
      byMinLands: w.byMinLands,
      cross: w.cross,
      rules: [...w.rules.values()],
      captions: [...w.captions.values()],
      flips: w.flips,
      five: w.five,
      fiveSamples: w.fiveSamples,
      justin: w.justin,
      recordsFormat: '[state, arrival order, ...per mode in `modes` order: [visible colours, invisible "colour:reason", what is drawn]]; every state with no dual',
      records: w.records,
    }),
  );
});

const esc = (s: string | null) => (s ?? '–').replace(/\|/g, '\\|');

function reportMarkdown(w: Walk): string {
  const out: string[] = [];
  const ids = COMBOS.map(comboId);
  const head = (cols: string[]) => out.push(`| ${cols.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`);
  out.push('# The scenery storyboard walk', '');
  out.push(`Generated ${new Date().toISOString()} by \`src/ambience/storyboard.test.ts\` (ForgeCoach branch \`pc/storyboard\`): \`STORYBOARD_REPORT=<dir> npx vitest run src/ambience/storyboard.test.ts\`. The JSON beside this file has every state with no dual.`, '');
  out.push(`**What was walked.** ${w.states.toLocaleString('en')} mana states: every vector of 0–6 basics in each of W U B R G (16,806), in three arrival orders -- WUBRG, its reverse, and heaviest last (an order giving the same arrival walked once: ${w.basics.toLocaleString('en')} states) -- and each vector of 0–4 a colour plus one dual of any of the ten pairs, arriving WUBRG (${w.duals.toLocaleString('en')}). Each through the board's own functions (makeup.ts, layout.ts \`halfLayout\`, pairfull.ts \`pairFullPlan\` / \`pairFullCandidates\` / \`pairFullChoice\`, the cut-out rule, pairs.ts \`pairBands\`, bridges.ts) with pack-v9.2, pairs-v3.1 without the flag and the tagged pairs-v7.1 under \`?pairfull=1\`; at a desktop (1600 px, half ≈ 5 : 1) and a phone (375 px: phone-width, half ≈ 2.1 : 1). Every picture is taken as loaded (the load gate's hold is not walked). The caption is \`#ambience\`'s (AmbiencePage \`bandCaption\`); the board itself prints none.`, '');
  out.push('**Visible** means something on the half is of that colour: a panel, the pair picture (a seam cell or a stage picture: both its colours), a painted-in third colour, a cut-out, a band, a motif or a bridge. **Invisible**: the colour has lands and none of these.', '');

  out.push('## States with an invisible colour, by colours', '');
  head(['colours', ...ids]);
  for (const key of ['1', '2', '3', '4', '5', 'basics', 'dual', 'all']) {
    const name = key === 'basics' ? 'no dual' : key === 'dual' ? 'one dual' : key === 'all' ? '**all**' : key;
    out.push(`| ${name} | ${ids.map((id) => {
      const t = w.tallies[id]![key];
      return t ? `${t.withGap.toLocaleString('en')} / ${t.states.toLocaleString('en')} (${pct(t.withGap, t.states)})` : '–';
    }).join(' | ')} |`);
  }
  out.push('');

  out.push('## …by the land count of the colour that shows nothing', '');
  out.push('For each state with an invisible colour, the fewest lands any invisible colour has (a dual counts ½): a one-land splash that shows nothing, against a four-land colour that shows nothing.', '');
  const mins = [...new Set(ids.flatMap((id) => Object.keys(w.byMinLands[id]!)))].sort((a, b) => Number(a) - Number(b));
  head(['fewest lands hidden', ...ids]);
  for (const m of mins) out.push(`| ${m} | ${ids.map((id) => (w.byMinLands[id]![m] ?? 0).toLocaleString('en')).join(' | ')} |`);
  out.push('');
  for (const id of ids) {
    out.push(`**${id}**, colours × fewest lands hidden:`, '');
    head(['colours', ...mins]);
    for (const n of ['1', '2', '3', '4', '5']) out.push(`| ${n} | ${mins.map((m) => (w.cross[id]![n]?.[m] ?? 0).toLocaleString('en')).join(' | ')} |`);
    out.push('');
  }

  out.push('## The rules that hide a colour', '');
  head(['rule', 'states', 'smallest state', 'what the half draws there', 'hidden', 'smallest with no dual', 'drawn there', 'hidden there']);
  for (const r of [...w.rules.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const b = r.basic;
    out.push(`| \`${r.id}\` | ${r.count.toLocaleString('en')} | ${r.example.state} | ${esc(r.example.picture)} | ${r.example.invisible} | ${b?.state ?? '–'} | ${esc(b?.picture ?? null)} | ${b?.invisible ?? '–'} |`);
  }
  out.push('');
  for (const reason of [...new Set([...w.rules.keys()].map((id) => id.split('/')[2] as GapReason))]) out.push(`- \`${reason}\`: ${RULE_WORDS[reason]}.`);
  out.push('');
  out.push(`The test's allow-list today (\`KNOWN_GAPS\`): ${KNOWN_GAPS.map((x) => `\`${x}\``).join(', ')}.`, '');

  out.push('## Five colours: a side with 1–6 of every colour', '');
  out.push(`Every vector with all five colours on 1–6 lands (${(w.five['default/desktop']!.states).toLocaleString('en')} states with the orders).`, '');
  head(['mode', 'colours showing nothing', 'what the half draws']);
  for (const id of ids) {
    const f = w.five[id]!;
    out.push(`| ${id} | ${Object.entries(f.hidden).map(([k, v]) => `${k}: ${v.toLocaleString('en')}`).join(', ')} | ${Object.entries(f.drawn).map(([k, v]) => `${k}: ${v.toLocaleString('en')}`).join('; ')} |`);
  }
  out.push('');
  out.push('Some five-colour sides, arriving WUBRG:', '');
  head(['side', ...ids.map((id) => `${id}: drawn / hidden`)]);
  for (const s of w.fiveSamples) out.push(`| ${s.state.replace(/ \(arrived.*/, '')} | ${ids.map((id) => `${esc(s.per[id]!.picture)} / **${s.per[id]!.invisible || 'none'}**`).join(' | ')} |`);
  out.push('');

  out.push('## Justin’s board: Island 2, Swamp 2, Mountain 2, Forest 3 (arrived U B R G)', '');
  head(['mode', 'visible', 'invisible', 'drawn', 'caption']);
  for (const id of ids) {
    const e = w.justin[id]!;
    out.push(`| ${id} | ${e.visible} | ${e.invisible || '–'} | ${esc(e.picture)} | ${esc(e.caption)} |`);
  }
  out.push('');

  out.push('## One land more: does the half switch picture?', '');
  out.push('Every state with no dual, plus one basic land of each colour that has fewer than six, with what the half showed before as the tie-breaker (MakeupMemory). A **pair flip** is the whole half switching from one pair picture to another; **a colour lost** is a colour on screen before the land and not after it.', '');
  head(['mode', 'steps', 'pair flips', 'of which on a tie (A5 forbids)', 'a colour lost']);
  for (const id of ids) {
    const f = w.flips[id]!;
    out.push(`| ${id} | ${f.transitions.toLocaleString('en')} | ${f.pairFlips.toLocaleString('en')} (${pct(f.pairFlips, f.transitions)}) | ${f.tieFlips.toLocaleString('en')} | ${f.lostColour.toLocaleString('en')} (${pct(f.lostColour, f.transitions)}) |`);
  }
  out.push('');
  for (const id of ids.filter((x) => x.startsWith('pairfull'))) {
    const f = w.flips[id]!;
    out.push(`**${id}, flips by colours after the land:** ${Object.entries(f.flipsByColours).map(([n, v]) => `${n} colours ${v.flips.toLocaleString('en')}/${v.transitions.toLocaleString('en')} (${pct(v.flips, v.transitions)})`).join('; ')}.`, '');
    if (f.flipExamples.length) {
      out.push(`Smallest flips (${id}):`, '');
      head(['after the land', 'added', 'before', 'after']);
      for (const e of f.flipExamples.slice(0, 8)) out.push(`| ${e.state} | ${e.added} | ${esc(e.from)} | ${esc(e.picture)} |`);
      out.push('');
    }
  }
  for (const id of ids) {
    const f = w.flips[id]!;
    if (!f.lostExamples.length) continue;
    out.push(`Smallest steps that take a colour off screen (${id}):`, '');
    head(['after the land', 'added', 'lost', 'before', 'after']);
    for (const e of f.lostExamples.slice(0, 6)) out.push(`| ${e.state} | ${e.added} | ${e.lost} | ${esc(e.from)} | ${esc(e.picture)} |`);
    out.push('');
  }

  out.push('## Captions', '');
  if (!w.captions.size) out.push('No state has a caption that names a colour the half does not draw, or (where there is a caption) leaves out one it draws.', '');
  else {
    head(['fault', 'states', 'smallest state', 'caption', 'drawn']);
    for (const r of [...w.captions.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) out.push(`| \`${r.id}\` (${CAPTION_WORDS[r.id.split('/')[2]!]}) | ${r.count.toLocaleString('en')} | ${r.example.state} | ${esc(r.example.caption)} | ${r.example.visible} |`);
    out.push('');
  }
  out.push('A side with no caption (one colour, or no band) is not counted as leaving anything out: the caption describes bands and pair pictures only.', '');
  return out.join('\n');
}
