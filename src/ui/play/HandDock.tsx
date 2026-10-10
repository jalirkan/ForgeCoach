/*
 * ForgeCoach — ui/play/HandDock.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Your hand, along the bottom. Same tiles as the board. On a desktop the
 * cards sit like a held hand — overlapping when there are many, the bottom
 * edge tucked under the screen, raised on hover (play.css). On a phone it
 * folds to a peek strip (the tops of the cards) while it is not what you need;
 * a tap on the strip opens it.
 */
import type { CSSProperties } from 'react';
import type { Card, PlayerState } from '../../protocol.ts';
import { isHidden } from '../../protocol.ts';
import { CardBack, CardFace, CardTile } from '../CardTile.tsx';
import { useCardInfo } from '../cardData.ts';
import { handAnswers } from './handAffordance.ts';
import { usePlayBoard } from './playBoard.ts';
import { colorClass, cardColors, cx, typeKind } from '../util.ts';

export function HandDock({ player, landOpen, collapsed, onToggle }: { player: PlayerState | null; landOpen: boolean | null; collapsed: boolean; onToggle: () => void }) {
  const cards = player?.zones.hand.cards ?? [];
  const n = player?.zones.hand.count ?? 0;
  // What the engine says is a legal answer now; null (no board, or the engine says nothing) dims nothing.
  const board = usePlayBoard();
  const answers = board ? handAnswers(board) : null;
  return (
    <div
      className={cx('hand-dock', collapsed && 'is-collapsed')}
      data-answers={answers ? answers.size : undefined}
      style={{ '--n': Math.max(1, cards.length), '--n1': Math.max(1, cards.length - 1) } as CSSProperties}
    >
      <button className="hand-dock-head" onClick={onToggle} aria-expanded={!collapsed}>
        <span className="bf-label">
          <span className="hand-dock-word">Your hand</span> <span className="bf-count">{n}</span>
        </span>
        {landOpen !== null && <span className={cx('tag', landOpen ? 'tag-ok' : 'tag-muted')}>{landOpen ? 'Land drop open' : 'Land played'}</span>}
        <span className="grow" />
        <span className="hand-dock-hint muted tiny">tap to play · hold for details</span>
        <span className="hand-dock-caret" aria-hidden="true">{collapsed ? '▴' : '▾'}</span>
      </button>
      {collapsed ? (
        cards.length > 0 && (
          // The tops of the cards; a tap anywhere on the strip opens the hand.
          <div className="hand-dock-peek" onClick={onToggle} aria-hidden="true" title="Show your hand">
            {cards.map((c) =>
              isHidden(c) ? (
                <CardBack key={c.id} />
              ) : (
                <PeekCard key={c.id} card={c as Card} dim={!!answers && !answers.has(c.id)} />
              ),
            )}
          </div>
        )
      ) : (
        <div className="hand-dock-row">
          {cards.length === 0 ? (
            <div className="bf-empty">Empty hand</div>
          ) : (
            cards.map((c) => (isHidden(c) ? <CardBack key={c.id} /> : <CardTile key={c.id} card={c as Card} inHand dim={!!answers && !answers.has(c.id)} />))
          )}
        </div>
      )}
    </div>
  );
}

/** The top of a hand card in the folded strip: just the face, no click handling of its own. */
function PeekCard({ card, dim }: { card: Card; dim?: boolean }) {
  const info = useCardInfo(card.name || null);
  return (
    <span className={cx('peek-card', dim && 'is-dim', colorClass(cardColors(card, info?.producedMana, info?.colors)))}>
      <CardFace card={card} info={info} kind={typeKind(card.types || info?.typeLine)} eager />
    </span>
  );
}
