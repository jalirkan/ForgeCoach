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
 * How a pile draws and what a click on it does:
 * - `open`: the engine is asking you to *choose* among these cards (a target,
 *   a sacrifice) — the pile opens into separate cards, each addressable;
 * - otherwise one stack, and a click goes to `top`: the first card the engine
 *   would act on (the cards are interchangeable — same name and state), else
 *   the first card (a click then opens its details).
 */
export function pilePlan(marks: PlayMark[]): { open: boolean; top: number } {
  if (marks.length <= 1 || marks.includes('select')) return { open: true, top: 0 };
  const act = marks.indexOf('act');
  return { open: false, top: act >= 0 ? act : 0 };
}

/** A pile's width in card widths: the top card plus a fifth per extra card shown (ui/cards.css). */
export const PILE_SHOWN = 4;
export function pileWeight(cards: Card[]): number {
  const first = cards[0];
  if (!first) return 0;
  return (first.tapped ? 1.4 : 1) + 0.2 * (Math.min(cards.length, PILE_SHOWN) - 1);
}
