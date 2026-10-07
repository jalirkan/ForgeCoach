/*
 * ForgeCoach — draft/gridBlurb.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The grid pick screen's "why this line" blurb, built from the pick helper's
 * own advice (src/cube/pick.ts `recommendGrid`) without a model call. Pure and
 * DOM-free. It never changes the call: it only explains the line the helper
 * already chose.
 *
 *   title   — "Take the middle column".
 *   cards   — one line per card of the line: its pick value and its one or
 *             two strongest reasons, chosen by a fixed priority:
 *               a warning (off colour, a splash)            9
 *               strong / weak by its numbers                 8
 *               synergy with the pool (theme + a partner)    6 + synergy / 3
 *               making both your colours (a dual / fixer)    6.5
 *               its role (removal 7; card advantage, evasive
 *               threat, counterspell, mana… 6)
 *               on colour 3, colourless 2
 *   leaves  — what the pick leaves the other drafter: its best remaining
 *             line and the margin (your set value against its), or, picking
 *             second, that the rest of the grid is discarded.
 *   close   — when the runner-up line is within CLOSE_MARGIN, "close call
 *             vs …" with the deciding factor (value to you, or denial).
 *
 * HONESTY. A card is called strong or weak only as draft/labStats.ts (the
 * lab's 95% interval clear of 50%) and cube/human.ts (the 17Lands interval
 * clear of the format's average) allow; an interval that includes the line
 * says nothing and the blurb says nothing about it.
 */
import { fitText, pickValue, poolColours, poolProfile, DENIAL, type GridAdvice, type GridOption, type PickParts, type PoolProfile } from '../cube/pick.ts';
import { cardValue, isInteraction, isRemoval, synergyOf, type CubeContext } from '../cube/score.ts';
import { humanCardView } from '../cube/human.ts';
import { colourBaselines, labCardView, type ColourBaseline } from './labStats.ts';

/** Two lines closer than this (total score) are a close call. */
export const CLOSE_MARGIN = 3;

export interface BlurbCard {
  name: string;
  /** Pick value for you (pick.ts `pickValue().total`). */
  value: number;
  /** One or two short reasons, strongest first. */
  reasons: string[];
}

export interface GridBlurb {
  title: string;
  cards: BlurbCard[];
  /** What the pick leaves the other drafter, or null. */
  leaves: string | null;
  /** "Close call vs the top row …", or null when the call is clear. */
  close: string | null;
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const pc = (p: number) => `${Math.round(p * 100)}%`;
const pc1 = (p: number) => `${(p * 100).toFixed(1)}%`;

const DRAW = /\bdraws? (?:a|two|three|\w+) cards?\b|\binvestigate\b|\bclue token\b/i;
const EVASIVE = /\b(flying|menace|trample|can't be blocked|shadow)\b/i;
const TOKENS = /\bcreate[s]? (?:a|an|one|two|three|four|x|\w+) [^.]*?token/i;

/** What the card does, in a word or two; null when nothing stands out. */
export function cardRole(name: string, ctx: CubeContext): { text: string; weight: number } | null {
  const card = ctx.byName.get(name);
  const f = ctx.facts.get(name);
  if (!card || !f) return null;
  if (f.land) return f.produces.length >= 2 ? { text: 'fixing land', weight: 5 } : null;
  if (isRemoval(card, f)) return { text: 'removal', weight: 7 };
  if (f.planeswalker) return { text: 'planeswalker', weight: 6 };
  if (card.tags.includes('counter') || /counter target spell/i.test(f.oracle)) return { text: 'counterspell', weight: 6 };
  if (f.fixer || card.tags.includes('ramp') || (!f.creature && f.produces && f.mv <= 1)) return { text: 'mana', weight: 6 };
  if (isInteraction(card, f) && card.tags.includes('discard')) return { text: 'hand disruption', weight: 6 };
  if (DRAW.test(f.oracle)) return { text: 'card advantage', weight: 6 };
  if (f.creature && EVASIVE.test(f.oracle)) return { text: 'evasive threat', weight: 6 };
  if (TOKENS.test(f.oracle)) return { text: 'makes tokens', weight: 5 };
  if (f.creature && f.power !== null && f.power >= 4 && f.mv <= 4) return { text: 'big body for its cost', weight: 5 };
  return null;
}

/**
 * "strong in the lab: 56% [54–58]" / "strong for humans: 58.5% vs 55.9% avg" / "weak in the lab and for humans: …",
 * only when an interval allows it (labStats `verdictOf`, human.ts `humanVerdict`); null otherwise.
 */
export function strengthText(name: string, ctx: CubeContext, baselines: Map<string, ColourBaseline>): string | null {
  const f = ctx.facts.get(name);
  const meta = ctx.meta?.meta ?? null;
  const lab = meta ? labCardView(meta, name, f?.colors ?? '', baselines, { land: f?.land === true }) : null;
  const labV = lab?.win && lab.verdict !== 'unclear' ? { verdict: lab.verdict, text: `${pc(lab.win.p)} [${Math.round(lab.win.lo * 100)}–${Math.round(lab.win.hi * 100)}]` } : null;
  const human = humanCardView(ctx.human, name);
  const humV = human && human.verdict !== 'unclear' ? { verdict: human.verdict, text: `${pc1(human.gih.p)} vs ${pc1(human.avg)} avg` } : null;
  if (labV && humV && labV.verdict === humV.verdict) return `${labV.verdict} in the lab and for humans: ${labV.text}; ${humV.text}`;
  const bits: string[] = [];
  if (labV) bits.push(`${labV.verdict} in the lab: ${labV.text}`);
  if (humV) bits.push(`${humV.verdict} for humans: ${humV.text}`);
  return bits.length ? bits.join('; ') : null;
}

/** A theme's short name: "Sacrifice (\"aristocrats\")" → "Sacrifice". */
const themeLabel = (code: string, ctx: CubeContext) => (ctx.themeName.get(code) ?? code).replace(/\s*\([^)]*\)/g, '').trim() || code;

/** The pool theme this card shares (its name and the pool's best card in it), or a lab pair partner. */
export function synergyText(name: string, pool: string[], prof: PoolProfile, ctx: CubeContext): string | null {
  const card = ctx.byName.get(name);
  let best: { theme: string; n: number } | null = null;
  for (const t of card?.themes ?? []) {
    if (!prof.top.has(t)) continue;
    const n = prof.counts.get(t) ?? 0;
    if (n > 0 && (!best || n > best.n)) best = { theme: t, n };
  }
  if (best) {
    const mates = [...prof.onColour].filter((p) => p !== name && ctx.byName.get(p)?.themes.includes(best!.theme));
    mates.sort((a, b) => cardValue(b, ctx) - cardValue(a, ctx) || (a < b ? -1 : 1));
    const mate = mates[0];
    if (mate) {
      const theme = themeLabel(best.theme, ctx);
      return `${theme} with ${mate}${mates.length > 1 ? ` (+${mates.length - 1} more)` : ''}`;
    }
  }
  const syn = synergyOf(name, new Set(pool), prof.top, prof.counts, ctx);
  const partner = syn.partners.find((p) => p.lift > 0);
  return partner ? `lab pair with ${partner.name} (+${Math.round(partner.lift * 100)}%)` : null;
}

function cardReasons(name: string, parts: PickParts, pool: string[], prof: PoolProfile, pair: string, ctx: CubeContext, baselines: Map<string, ColourBaseline>): string[] {
  const out: Array<{ text: string; weight: number }> = [];
  const fit = fitText(name, pair, ctx);
  const f = ctx.facts.get(name);
  if (fit === 'off colour' || fit === 'a splash') out.push({ text: fit, weight: 9 });
  else if (fit === 'your dual' || (f?.fixer && [...pair].every((c) => f.produces.includes(c)) && pair.length === 2)) out.push({ text: fit === 'your dual' ? 'makes both your colours' : 'fixes both your colours', weight: 6.5 });
  else if (fit.startsWith('on colour')) out.push({ text: fit, weight: 3 });
  else if (fit === 'colourless') out.push({ text: 'colourless, fits any deck', weight: 2 });
  const strength = strengthText(name, ctx, baselines);
  if (strength) out.push({ text: strength, weight: 8 });
  if (parts.synergy >= 1.5) {
    const s = synergyText(name, pool, prof, ctx);
    if (s) out.push({ text: s, weight: 6 + parts.synergy / 3 });
  }
  const role = cardRole(name, ctx);
  if (role && !(role.text === 'fixing land' && out.some((o) => o.weight === 6.5))) out.push(role);
  // Stable: weight, then the order they were added.
  return out
    .map((o, i) => ({ ...o, i }))
    .sort((a, b) => b.weight - a.weight || a.i - b.i)
    .slice(0, 2)
    .map((o) => o.text);
}

/** The highest-valued card of `a` that is not in `b`. */
function topUnique(a: GridOption, b: GridOption, parts: Map<string, PickParts>): string | null {
  const only = a.cards.filter((c) => !b.cards.includes(c));
  only.sort((x, y) => (parts.get(y)?.total ?? 0) - (parts.get(x)?.total ?? 0) || (x < y ? -1 : 1));
  return only[0] ?? null;
}

/**
 * The blurb for the helper's line. `pool` is your pool (as given to recommendGrid);
 * `them` names the other drafter ("the AI", or a friend's name).
 */
export function gridBlurb(advice: GridAdvice, pool: string[], ctx: CubeContext, them = 'the AI'): GridBlurb | null {
  const best = advice.best;
  if (!best) return null;
  const prof = poolProfile(pool, ctx);
  const pair = poolColours(pool, ctx);
  const baselines = colourBaselines(ctx.meta?.meta ?? null);
  const names = new Set(advice.options.flatMap((o) => o.cards));
  const parts = new Map([...names].map((n) => [n, pickValue(n, pool, ctx, prof)]));
  const cards = [...best.cards]
    .sort((a, b) => (parts.get(b)?.total ?? 0) - (parts.get(a)?.total ?? 0) || (a < b ? -1 : 1))
    .map((n) => ({ name: n, value: parts.get(n)?.total ?? 0, reasons: cardReasons(n, parts.get(n)!, pool, prof, pair, ctx, baselines) }));

  let leaves: string | null = null;
  if (best.reply) {
    const margin = r1(best.mine - best.reply.value);
    leaves = `Leaves ${them} the ${best.reply.line.label.toLowerCase()} (${best.reply.cards.join(', ')}): ${Math.round(best.reply.value)} to ${pronoun(them)} vs ${Math.round(best.mine)} to you (${margin >= 0 ? `+${margin}` : `−${Math.abs(margin)}`} your way).`;
  } else if (!advice.first) leaves = `You pick second: the rest of this grid is discarded, nothing more goes to ${them}.`;

  let close: string | null = null;
  const next = advice.options[1];
  if (next && best.total - next.total <= CLOSE_MARGIN) {
    const gap = r1(best.total - next.total);
    const dMine = best.mine - next.mine;
    const dDeny = DENIAL * ((next.reply?.value ?? 0) - (best.reply?.value ?? 0));
    // best.total ≥ next.total, so dMine + dDeny ≥ 0: whichever is larger decided it.
    let why: string;
    if (dDeny > dMine && best.reply && next.reply) {
      why = `decided by denial: the ${next.line.label.toLowerCase()} would leave ${them} more (${Math.round(next.reply.value)} vs ${Math.round(best.reply.value)})`;
    } else {
      const a = topUnique(best, next, parts);
      const b = topUnique(next, best, parts);
      const pa = a ? parts.get(a)!.total : 0;
      const pb = b ? parts.get(b)!.total : 0;
      why = a && b && pa > pb ? `decided by value to you: ${a} (${Math.round(pa)}) over ${b} (${Math.round(pb)})` : `decided by value to you, +${r1(dMine)} as a set`;
    }
    close = `Close call vs the ${next.line.label.toLowerCase()} (${gap === 0 ? 'level' : `${gap} behind`}): ${why}.`;
  }
  return { title: `Take the ${best.line.label.toLowerCase()}`, cards, leaves, close };
}

const pronoun = (them: string) => (them === 'the AI' ? 'it' : them);

