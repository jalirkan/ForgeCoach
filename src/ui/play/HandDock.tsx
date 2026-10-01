/*
 * ForgeCoach — ui/play/HandDock.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Your hand, along the bottom, big enough to tap. Same tiles as the board.
 */
import type { Card, PlayerState } from '../../protocol.ts';
import { isHidden } from '../../protocol.ts';
import { CardBack, CardTile } from '../CardTile.tsx';
import { cx } from '../util.ts';

export function HandDock({ player, landOpen, collapsed, onToggle }: { player: PlayerState | null; landOpen: boolean | null; collapsed: boolean; onToggle: () => void }) {
  const cards = player?.zones.hand.cards ?? [];
  return (
    <div className={cx('hand-dock', collapsed && 'is-collapsed')}>
      <button className="hand-dock-head" onClick={onToggle} aria-expanded={!collapsed}>
        <span className="bf-label">
          Your hand <span className="bf-count">{player?.zones.hand.count ?? 0}</span>
        </span>
        {landOpen !== null && <span className={cx('tag', landOpen ? 'tag-ok' : 'tag-muted')}>{landOpen ? 'Land drop open' : 'Land played'}</span>}
        <span className="grow" />
        <span className="hand-dock-hint muted tiny">tap to play · hold for details</span>
        <span className="hand-dock-caret" aria-hidden="true">{collapsed ? '▴' : '▾'}</span>
      </button>
      {!collapsed && (
        <div className="hand-dock-row">
          {cards.length === 0 ? (
            <div className="bf-empty">Empty hand</div>
          ) : (
            cards.map((c) => (isHidden(c) ? <CardBack key={c.id} /> : <CardTile key={c.id} card={c as Card} inHand />))
          )}
        </div>
      )}
    </div>
  );
}
