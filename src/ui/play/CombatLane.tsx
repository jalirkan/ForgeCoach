/*
 * ForgeCoach — ui/play/CombatLane.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The attack lane and the block lane (`combatLayout.ts`): a lighter band on a
 * player's side, nearest the centre line, that exists only while combat has
 * attackers. The attack lane holds that player's attackers, drawn as the
 * board draws them (tapped = lying down), in the engine's order; the block
 * lane holds that player's blockers, each in the column of the attacker it
 * blocks, so the two bands face each other across the centre line and a block
 * is read by where the card sits. Both are built from the same column list
 * and the same widths, so the columns line up.
 *
 * Cards are the board's own `CardTile`s: their clicks, their `data-mark`, their
 * selectable outline and their acts are exactly the rows' (nothing about what
 * a click sends changes here). The only control of the lane's own is the ×
 * on a declared blocker, which asks the play screen to take the block off
 * through the engine's clicks (`PlayInteraction.unblock`).
 *
 * A lane is one row: past its cards' smallest readable width it scrolls
 * sideways instead of wrapping (lane.css). The attack lane and the block lane
 * scroll together, so a blocker stays in its attacker's column; the edge that
 * hides cards fades, and a chip there ("+3 ›") says how many and scrolls to
 * them. In a block declaration the attacker your next click goes to is
 * scrolled into view.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { Card } from '../../protocol.ts';
import { usePlay } from '../cardContext.ts';
import { CardTile, displayName, type TileSide } from '../CardTile.tsx';
import { cx } from '../util.ts';
import { edgeCounts } from '../boardFit.ts';
import './lane.css';
import type { CombatLayout, LaneColumn, LaneTarget } from './combatLayout.ts';

export interface CombatLaneProps {
  layout: CombatLayout;
  kind: 'attack' | 'block';
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

/**
 * The lane's sideways scroll: the counts of columns past each edge, the other lane kept at the same
 * scroll, and the current attacker brought into view.
 */
function useLaneScroll(currentId: number | null) {
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
    // One gesture moves both lanes: their columns are the same list at the same widths.
    const onScroll = () => {
      measure();
      const board = el.closest('.board') ?? el.ownerDocument;
      for (const other of board.querySelectorAll<HTMLElement>('[data-combat-lane] .lane-cols')) {
        if (other !== el && Math.abs(other.scrollLeft - el.scrollLeft) > 0.5) other.scrollLeft = el.scrollLeft;
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(el);
    // A lane that appears (the first block) takes the scroll the other lane already has.
    const board = el.closest('.board') ?? el.ownerDocument;
    const peer = [...board.querySelectorAll<HTMLElement>('[data-combat-lane] .lane-cols')].find((o) => o !== el);
    if (peer && peer.scrollLeft > 0) el.scrollLeft = peer.scrollLeft;
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro?.disconnect();
    };
  }, [measure]);
  // The columns change with every state (a block, a fan): measure again after each render.
  useEffect(measure);
  // The attacker a block click goes to: into view, sideways only (never a jump of the page).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || currentId === null) return;
    const col = el.querySelector<HTMLElement>(`:scope > [data-lane-col="${currentId}"]`);
    if (!col) return;
    const box = el.getBoundingClientRect();
    const r = col.getBoundingClientRect();
    const pad = 24; // clear of the faded edge
    if (r.left < box.left + pad) el.scrollLeft -= box.left + pad - r.left;
    else if (r.right > box.right - pad) el.scrollLeft += r.right - (box.right - pad);
  }, [currentId]);
  const page = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(60, el.clientWidth * 0.8), behavior: 'smooth' });
  };
  return { ref, more, page };
}

export function CombatLane({ layout, kind, playerId, side, byId, attachmentsOf }: CombatLaneProps) {
  const play = usePlay();
  const scroll = useLaneScroll(layout.columns.find((c) => c.current)?.attackerId ?? null);
  const edges = [scroll.more.before > 0 && 'left', scroll.more.after > 0 && 'right'].filter(Boolean).join(' ');
  const att = (c: Card) => attachmentsOf?.(c) ?? [];
  const count =
    kind === 'attack'
      ? layout.columns.filter((c) => c.controller === playerId).length
      : layout.columns.reduce((n, c) => n + c.blockers.filter((b) => b.controller === playerId).length, 0);
  const label = kind === 'attack' ? `Attacking: ${count}` : `Blocking: ${count}`;
  return (
    <div
      className={cx('combat-lane', `is-${kind}`, kind === 'attack' && layout.upright && 'is-upright', layout.laneTarget && 'has-label')}
      data-combat-lane={kind}
      data-lane-scrolls={scroll.more.scrolls || undefined}
      data-lane-more={edges || undefined}
      style={{ '--lane-w': layout.weight.toFixed(2), '--lane-n': layout.columns.length } as CSSProperties}
    >
      {kind === 'attack' && layout.laneTarget && (
        <span className={cx('lane-target', `lane-target-${layout.laneTarget.kind}`)} data-lane-label={playerId}>
          <span aria-hidden="true">→</span> {layout.laneTarget.label}
        </span>
      )}
      <div ref={scroll.ref} className="lane-cols" role="group" aria-label={label}>
        {layout.columns.map((col) => (
          <div key={col.attackerId} className={cx('lane-col', col.current && 'is-current')} data-lane-col={col.attackerId} style={{ '--col-w': col.weight } as CSSProperties}>
            {kind === 'attack' ? <AttackSlot col={col} playerId={playerId} side={side} byId={byId} att={att} /> : <BlockSlot col={col} playerId={playerId} side={side} byId={byId} att={att} unblock={play?.unblock} />}
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

function BlockSlot({
  col,
  playerId,
  side,
  byId,
  att,
  unblock,
}: {
  col: LaneColumn;
  playerId: number;
  side: TileSide;
  byId: ReadonlyMap<number, Card>;
  att: (c: Card) => Card[];
  unblock?: (id: number) => void;
}) {
  const mine = col.blockers.filter((b) => b.controller === playerId);
  if (mine.length === 0) {
    // The attacker your next block click goes to: an empty place in front of it.
    return col.current ? <div className="lane-ghost" aria-hidden="true" /> : null;
  }
  return (
    <div className="lane-fan" style={{ '--fan': mine.length } as CSSProperties}>
      {mine.map((b, i) => {
        const card = byId.get(b.id);
        if (!card) return null;
        return (
          <div key={b.id} className={cx('lane-blocker', b.pending && 'is-pending')} data-blocks={col.attackerId} style={{ '--i': i } as CSSProperties}>
            <CardTile card={card} attachments={att(card)} side={side} />
            {unblock && (
              <button
                type="button"
                className="lane-unblock"
                aria-label={`Take ${displayName(card)} off the block`}
                title="Take off the block"
                onClick={(e) => {
                  e.stopPropagation();
                  unblock(b.id);
                }}
              >
                ×
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
