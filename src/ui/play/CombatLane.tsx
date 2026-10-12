/*
 * ForgeCoach — ui/play/CombatLane.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The attack lane (`combatLayout.ts`): a lighter band on a player's side,
 * nearest the centre line, that exists only while combat has attackers. It
 * holds that player's attackers, drawn as the board draws them (tapped =
 * lying down), in the engine's order. Blockers stay in their own rows; the
 * lines and numbered badges say who blocks whom (`combatLines.ts`).
 *
 * Cards are the board's own `CardTile`s: their clicks, their `data-mark` and
 * their selectable outline are exactly the rows' (nothing about what a click
 * sends changes here).
 *
 * The lane is one row: past its cards' smallest readable width it scrolls
 * sideways instead of wrapping (lane.css); the edge that hides cards fades,
 * and a chip there ("+3 ›") says how many and scrolls to them. A block line
 * follows its attacker as the lane scrolls (CombatArrows listens for the
 * scroll).
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Card } from '../../protocol.ts';
import { CardTile, type TileSide } from '../CardTile.tsx';
import { cx } from '../util.ts';
import { edgeCounts } from '../boardFit.ts';
import './lane.css';
import type { CombatLayout, LaneColumn, LaneTarget } from './combatLayout.ts';

export interface CombatLaneProps {
  layout: CombatLayout;
  /** The player whose side this lane is on. */
  playerId: number;
  side: TileSide;
  byId: ReadonlyMap<number, Card>;
  /** Auras and equipment drawn under a card, as in its row. */
  attachmentsOf?: (card: Card) => Card[];
}

function TargetChip({ target }: { target: LaneTarget }) {
  return (
    <span className={cx('lane-chip', `lane-chip-${target.kind}`)} title={`Attacking ${target.label}`} aria-label={`attacking ${target.label}`}>
      {target.initial}
    </span>
  );
}

/** The lane's sideways scroll: the counts of columns past each edge, and a page either way for the chips. */
function useLaneScroll() {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ scrolls: false, before: 0, after: 0 });
  const measure = useCallback(() => {
    const el = ref.current;
    const lane = el?.parentElement;
    if (!el || !lane) return;
    const box = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    // The gutters a scrolling lane keeps for its chips: a row that would fit without them does not scroll.
    const gutters = parseFloat(st.marginLeft || '0') + parseFloat(st.marginRight || '0') - (parseFloat(getComputedStyle(lane).getPropertyValue('--lane-pad-l')) || 0);
    const scrolls = el.scrollWidth > el.clientWidth + 1 + (lane.hasAttribute('data-lane-scrolls') ? gutters : 0);
    const viewLeft = box.left + parseFloat(st.paddingLeft || '0') * 0.5;
    const viewRight = box.right - parseFloat(st.paddingRight || '0') * 0.5;
    const cols = [...el.querySelectorAll<HTMLElement>(':scope > [data-lane-col]')].map((c) => c.getBoundingClientRect());
    const next = { scrolls, ...(scrolls ? edgeCounts(viewLeft, viewRight, cols) : { before: 0, after: 0 }) };
    setMore((m) => (m.scrolls === next.scrolls && m.before === next.before && m.after === next.after ? m : next));
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener('scroll', measure, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      ro?.disconnect();
    };
  }, [measure]);
  // The columns change with every state (an attacker declared, one removed): measure again after each render.
  useEffect(measure);
  const page = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(60, el.clientWidth * 0.8), behavior: 'smooth' });
  };
  return { ref, more, page };
}

export function CombatLane({ layout, playerId, side, byId, attachmentsOf }: CombatLaneProps) {
  const scroll = useLaneScroll();
  const edges = [scroll.more.before > 0 && 'left', scroll.more.after > 0 && 'right'].filter(Boolean).join(' ');
  const att = (c: Card) => attachmentsOf?.(c) ?? [];
  const count = layout.columns.filter((c) => c.controller === playerId).length;
  return (
    <div
      className={cx('combat-lane', 'is-attack', layout.upright && 'is-upright', layout.laneTarget && 'has-label')}
      data-combat-lane="attack"
      data-lane-scrolls={scroll.more.scrolls || undefined}
      data-lane-more={edges || undefined}
      style={{ '--lane-w': layout.weight.toFixed(2), '--lane-n': layout.columns.length } as CSSProperties}
    >
      {layout.laneTarget && (
        <span className={cx('lane-target', `lane-target-${layout.laneTarget.kind}`)} data-lane-label={playerId}>
          <span aria-hidden="true">→</span> {layout.laneTarget.label}
        </span>
      )}
      <div ref={scroll.ref} className="lane-cols" role="group" aria-label={`Attacking: ${count}`}>
        {layout.columns.map((col) => (
          <div key={col.attackerId} className="lane-col" data-lane-col={col.attackerId} style={{ '--col-w': col.weight } as CSSProperties}>
            <AttackSlot col={col} playerId={playerId} side={side} byId={byId} att={att} />
          </div>
        ))}
      </div>
      {scroll.more.before > 0 && (
        <button type="button" className="lane-more lane-more-left" onClick={() => scroll.page(-1)} aria-label={`${scroll.more.before} more to the left`} title={`${scroll.more.before} more to the left`}>
          <span aria-hidden="true">‹</span> +{scroll.more.before}
        </button>
      )}
      {scroll.more.after > 0 && (
        <button type="button" className="lane-more lane-more-right" onClick={() => scroll.page(1)} aria-label={`${scroll.more.after} more to the right`} title={`${scroll.more.after} more to the right`}>
          +{scroll.more.after} <span aria-hidden="true">›</span>
        </button>
      )}
    </div>
  );
}

function AttackSlot({ col, playerId, side, byId, att }: { col: LaneColumn; playerId: number; side: TileSide; byId: ReadonlyMap<number, Card>; att: (c: Card) => Card[] }) {
  const card = col.controller === playerId ? byId.get(col.attackerId) : undefined;
  if (!card) return null;
  return (
    <div className="lane-slot" data-attacker={col.attackerId}>
      <CardTile card={card} attachments={att(card)} side={side} />
      {col.chip && col.target && <TargetChip target={col.target} />}
    </div>
  );
}
