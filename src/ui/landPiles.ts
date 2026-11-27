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
 * stands alone, and so does a land something on the stack points at or comes
 * from (`apart`: the mark and the arrow then show which one). Untapped piles
 * first, then by name, so the mana you have reads left to right.
 */
export function groupLands(lands: { card: Card; attachments: number }[], apart?: { has(id: number): boolean }): Card[][] {
  const out: Card[][] = [];
  const byKey = new Map<string, Card[]>();
  for (const { card: c, attachments } of lands) {
    const plain = attachments === 0 && !c.attacking && !c.blocking && /\bbasic\b/i.test(c.types) && !!c.name && !c.faceDown && !apart?.has(c.id);
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
 * How many letters of a land's name its tab keeps when a phone's lands bar is full (play/play.css): the whole
 * name of each of the five basic lands (Mountain is the longest, 8), the first 8 of a longer one.
 */
export const TAB_LETTERS = 8;

/**
 * Whether a phone's lands bar is too full to say every name whole, by a rough measure in the tab's own terms
 * (play/play.css: 19 px of tab, about 6.6 px a letter at 12 px bold, 19 px for a pile's count, 4 px between
 * tabs) against the bar of the narrowest phone the board is laid out for (390 px wide: 360 for tabs). It only
 * decides whether `tabLabels` applies; the browser lays the tabs out. A wider phone switches a little early.
 */
export const TAB_ROOM = 360;
export function barIsFull(tabs: readonly { name: string; count: number }[], roomPx = TAB_ROOM): boolean {
  const need = tabs.reduce((w, t) => w + 19 + 6.6 * t.name.length + (t.count > 1 ? 19 : 0), 0) + 4 * Math.max(0, tabs.length - 1);
  return need > roomPx;
}

/**
 * What a phone's lands bar calls each land when its names are cut (a full bar: `barIsFull`). Two different names that start with the
 * same `TAB_LETTERS` letters would be cut to the same text (Snow-Covered Forest and Snow-Covered Island; Temple
 * of Malady and Temple of Mystery), so those drop the words they start with in common and say the rest after an
 * ellipsis: "…Forest", "…Island"; "…Malady", "…Mystery". Every other name is left as it is (absent from the
 * map), and so are names that share no whole first word, or would have nothing left.
 */
export function tabLabels(names: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  const groups = new Map<string, Set<string>>();
  for (const n of names) {
    if (n.length <= TAB_LETTERS) continue;
    const k = n.slice(0, TAB_LETTERS).toLowerCase();
    let g = groups.get(k);
    if (!g) groups.set(k, (g = new Set()));
    g.add(n);
  }
  for (const g of groups.values()) {
    if (g.size < 2) continue;
    const words = [...g].map((n) => n.split(' '));
    let common = 0;
    while (words.every((w) => common < w.length - 1 && w[common]!.toLowerCase() === words[0]![common]!.toLowerCase())) common++;
    if (common === 0) continue;
    for (const n of g) out.set(n, `…${n.split(' ').slice(common).join(' ')}`);
  }
  return out;
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
