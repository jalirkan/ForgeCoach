/*
 * ForgeCoach — ui/play/laneMotion.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Cards slide into and out of the combat lanes instead of jumping: when a
 * card's place changes (row → attack lane, row → in front of an attacker,
 * one attacker → another, back to the row when combat ends), its tile is
 * animated from where it was drawn to where it is now (a FLIP: the DOM has
 * already moved; a short transform plays the move back). Nothing else moves,
 * and nothing moves at all under `prefers-reduced-motion`.
 *
 * `placementKeys` and `movedIds` are pure (tested); the hook measures.
 */
import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { CombatLayout } from './combatLayout.ts';

/** Where each placed card is drawn: `a:<attacker>` (attack lane) or `b:<attacker>` (in front of it). Absent: its row. */
export function placementKeys(layout: CombatLayout): Map<number, string> {
  const m = new Map<number, string>();
  for (const c of layout.columns) {
    m.set(c.attackerId, `a:${c.attackerId}`);
    for (const b of c.blockers) m.set(b.id, `b:${c.attackerId}`);
  }
  return m;
}

/** The cards whose place changed between two layouts (entered a lane, left one, or changed columns). */
export function movedIds(prev: ReadonlyMap<number, string>, next: ReadonlyMap<number, string>): number[] {
  const out = new Set<number>();
  for (const [id, k] of next) if (prev.get(id) !== k) out.add(id);
  for (const id of prev.keys()) if (!next.has(id)) out.add(id);
  return [...out].sort((a, b) => a - b);
}

const SLIDE_MS = 240;

function reducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function useLaneMotion(boardRef: RefObject<HTMLElement | null>, layout: CombatLayout) {
  const keys = useRef<Map<number, string>>(new Map());
  const rects = useRef<Map<number, DOMRect>>(new Map());
  useLayoutEffect(() => {
    const board = boardRef.current;
    const next = placementKeys(layout);
    const prev = keys.current;
    keys.current = next;
    if (!board) return;
    // Where every permanent is now (a card can only slide from a place it was measured at).
    const now = new Map<number, DOMRect>();
    for (const el of board.querySelectorAll<HTMLElement>('.battlefield .tile[data-card-id]')) {
      const id = Number(el.dataset.cardId);
      if (Number.isFinite(id)) now.set(id, el.getBoundingClientRect());
    }
    if (!reducedMotion() && typeof Element !== 'undefined' && 'animate' in Element.prototype) {
      for (const id of movedIds(prev, next)) {
        const from = rects.current.get(id);
        const to = now.get(id);
        if (!from || !to) continue;
        const dx = from.left + from.width / 2 - (to.left + to.width / 2);
        const dy = from.top + from.height / 2 - (to.top + to.height / 2);
        if (Math.abs(dx) < 2 && Math.abs(dy) < 2) continue;
        const el = board.querySelector<HTMLElement>(`.battlefield .tile[data-card-id="${id}"]`);
        el?.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: SLIDE_MS, easing: 'cubic-bezier(.2,.7,.3,1)' });
      }
    }
    rects.current = now;
  });
}
