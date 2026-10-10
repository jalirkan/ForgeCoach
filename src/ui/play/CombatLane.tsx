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
 */
import type { CSSProperties } from 'react';
import type { Card } from '../../protocol.ts';
import { usePlay } from '../cardContext.ts';
import { CardTile, displayName, type TileSide } from '../CardTile.tsx';
import { cx } from '../util.ts';
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

export function CombatLane({ layout, kind, playerId, side, byId, attachmentsOf }: CombatLaneProps) {
  const play = usePlay();
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
      style={{ '--lane-w': layout.weight.toFixed(2), '--lane-n': layout.columns.length } as CSSProperties}
    >
      {kind === 'attack' && layout.laneTarget && (
        <span className={cx('lane-target', `lane-target-${layout.laneTarget.kind}`)} data-lane-label={playerId}>
          <span aria-hidden="true">→</span> {layout.laneTarget.label}
        </span>
      )}
      <div className="lane-cols" role="group" aria-label={label}>
        {layout.columns.map((col) => (
          <div key={col.attackerId} className={cx('lane-col', col.current && 'is-current')} data-lane-col={col.attackerId} style={{ '--col-w': col.weight } as CSSProperties}>
            {kind === 'attack' ? <AttackSlot col={col} playerId={playerId} side={side} byId={byId} att={att} /> : <BlockSlot col={col} playerId={playerId} side={side} byId={byId} att={att} unblock={play?.unblock} />}
          </div>
        ))}
      </div>
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
