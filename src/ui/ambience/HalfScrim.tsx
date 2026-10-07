/*
 * ForgeCoach — ui/ambience/HalfScrim.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The card-row scrim of the half board (spec 1.5, art direction §5): a soft
 * dark band under each card row of a player's half, so the cards and the
 * little text on the board read as well as on the plain board while the sky
 * and the edges keep their colour. The board's own components know nothing
 * of it: it measures their rows (`.bf-cards`, `.bf-empty`) inside the host
 * and draws a band under each (ambience/scrim.ts `scrimRects`), at z-index -1
 * in the host's isolated context: above the art, beneath every card.
 * Measured again when the host or a row resizes, a row scrolls, or a card
 * comes or goes (a tap, a new permanent), at most once a frame.
 */
import { memo, useLayoutEffect, useRef, useState } from 'react';
import { SCRIM_EDGE_ALPHA, SCRIM_FEATHER_PX, scrimRects, type Box } from '../../ambience/scrim.ts';

/** The board's rows: their cards (or the "No permanents" note). */
export const BOARD_ROWS = '.bf-cards, .bf-empty';

const boxOf = (r: DOMRect): Box => ({ left: r.left, top: r.top, width: r.width, height: r.height });

function measure(host: HTMLElement, selector: string): Box[] {
  const rows = [...host.querySelectorAll<HTMLElement>(selector)].map((row) => {
    const kids = row.children.length ? [...row.children] : [row];
    return { box: boxOf(row.getBoundingClientRect()), items: kids.map((k) => boxOf(k.getBoundingClientRect())) };
  });
  return scrimRects(boxOf(host.getBoundingClientRect()), rows);
}

const same = (a: Box[], b: Box[]) => a.length === b.length && a.every((x, i) => x.left === b[i]!.left && x.top === b[i]!.top && x.width === b[i]!.width && x.height === b[i]!.height);

export const HalfScrim = memo(function HalfScrim({ host, selector = BOARD_ROWS, version }: { host: HTMLElement; selector?: string; version?: unknown }) {
  const [rects, setRects] = useState<Box[]>([]);
  const frame = useRef(0);
  const update = useRef(() => {});
  update.current = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const next = measure(host, selector);
      setRects((prev) => (same(prev, next) ? prev : next));
    });
  };
  useLayoutEffect(() => {
    const next = measure(host, selector);
    setRects((prev) => (same(prev, next) ? prev : next));
  }, [host, selector, version]);
  useLayoutEffect(() => {
    const on = () => update.current();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(on);
    const watchRows = () => {
      ro?.disconnect();
      ro?.observe(host);
      host.querySelectorAll(selector).forEach((el) => ro?.observe(el));
    };
    watchRows();
    // Cards come and go, tap and untap: the rows change under us.
    const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => {
      watchRows();
      on();
    });
    mo?.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    host.addEventListener('scroll', on, { capture: true, passive: true });
    window.addEventListener('resize', on);
    return () => {
      ro?.disconnect();
      mo?.disconnect();
      host.removeEventListener('scroll', on, { capture: true });
      window.removeEventListener('resize', on);
      cancelAnimationFrame(frame.current);
    };
  }, [host, selector]);
  if (!rects.length) return null;
  return (
    <div className="scn-scrims" aria-hidden="true" style={{ ['--scn-feather' as string]: `${SCRIM_FEATHER_PX}px`, ['--scn-edge' as string]: String(SCRIM_EDGE_ALPHA) }}>
      {/* The band grown by the feather; two nested masks (across, then down) fade its edges and round its corners. */}
      {rects.map((r, i) => (
        <div key={i} className="scn-scrim" style={{ left: r.left - SCRIM_FEATHER_PX, top: r.top - SCRIM_FEATHER_PX, width: r.width + 2 * SCRIM_FEATHER_PX, height: r.height + 2 * SCRIM_FEATHER_PX }}>
          <div className="scn-scrim-in" />
        </div>
      ))}
    </div>
  );
});
