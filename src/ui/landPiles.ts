/*
 * ForgeCoach — ui/landPiles.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Which lands share a pile on the table, and what a click on a pile does.
 * DOM-free so it is tested in node (landPiles.test.ts).
 */
import type { Card } from '../protocol.ts';
import type { PlayMark } from './cardContext.ts';

/**
 * Basic lands with nothing special about them (same name, tapped state,
 * counters, damage; no attachments; not in combat) pile up. Every other land
 * stands alone. Untapped piles first, then by name, so the mana you have
 * reads left to right.
 */
export function groupLands(lands: { card: Card; attachments: number }[]): Card[][] {
  const out: Card[][] = [];
  const byKey = new Map<string, Card[]>();
  for (const { card: c, attachments } of lands) {
    const plain = attachments === 0 && !c.attacking && !c.blocking && /\bbasic\b/i.test(c.types) && !!c.name && !c.faceDown;
    const key = plain ? `${c.name}|${c.tapped}|${JSON.stringify(c.counters)}|${c.damage}` : `#${c.id}`;
    let g = byKey.get(key);
    if (!g) {
      g = [];
      byKey.set(key, g);
      out.push(g);
    }
    g.push(c);
  }
  return out.sort((a, b) => Number(a[0]!.tapped) - Number(b[0]!.tapped) || a[0]!.name.localeCompare(b[0]!.name));
}

/**
 * What a click on a pile does. Lands in a pile are interchangeable (same name,
 * same tapped state, nothing on them), so the pile never has to open up:
 * - the engine is asking you to *choose* lands (a sacrifice, a target, a cost):
 *   each click selects one more selectable land from the pile — the first one
 *   this pile has not sent yet. `tried` is the ids this pile already clicked
 *   while the selectable set stayed the same; once every selectable land has
 *   been sent, it starts over (a second click on a land the engine still
 *   offers is how you take it back);
 * - otherwise a click goes to the first land the engine would act on (paying
 *   mana: an untapped one), else to the first land, whose details then open.
 * `restart`: every selectable land was already sent, so `tried` starts over.
 * `select` is true while the engine is choosing among the pile's lands.
 */
export function pilePlan(ids: number[], marks: PlayMark[], tried: ReadonlySet<number> = new Set()): { top: number; select: boolean; selectable: number; restart: boolean } {
  const sel = marks.flatMap((m, i) => (m === 'select' ? [i] : []));
  if (sel.length > 0) {
    const fresh = sel.find((i) => !tried.has(ids[i]!));
    return { top: fresh ?? sel[0]!, select: true, selectable: sel.length, restart: fresh === undefined };
  }
  const act = marks.indexOf('act');
  return { top: act >= 0 ? act : 0, select: false, selectable: 0, restart: false };
}

/** A pile's width in card widths: the top card plus a fifth per extra card shown (ui/cards.css). */
export const PILE_SHOWN = 4;
export function pileWeight(cards: Card[]): number {
  const first = cards[0];
  if (!first) return 0;
  return (first.tapped ? 1.4 : 1) + 0.2 * (Math.min(cards.length, PILE_SHOWN) - 1);
}
