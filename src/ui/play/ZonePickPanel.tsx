/*
 * ForgeCoach — ui/play/ZonePickPanel.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The cards the engine wants clicked that the board does not draw — a target
 * in a graveyard, in exile, in a library (zonePick.ts). A floating panel over
 * the board, not a modal: the cards in it are ordinary play tiles, so a click
 * is the same `clickCard` a battlefield tile sends and the engine judges it
 * (mtg-table protocol §4.1). The engine's own OK / Cancel sit under them with
 * their own labels, and the count is the engine's (`input.highlighted`).
 * It can be folded to a pill to look at the board.
 */
import { useState } from 'react';
import type { AnyCard, Card, GameStateBody } from '../../protocol.ts';
import { isHidden } from '../../protocol.ts';
import { usePlay } from '../cardContext.ts';
import { CardTile } from '../CardTile.tsx';
import { IconCheck, IconChevronDown } from '../Icons.tsx';
import { cx } from '../util.ts';
import type { InputView } from './inputView.ts';
import { pickCountWords, zonePickTitle, zoneWords, type ZonePick } from './zonePick.ts';

export function ZonePickPanel({
  pick,
  view,
  state,
  seat,
  onOk,
  onCancel,
}: {
  pick: ZonePick;
  view: InputView;
  state: GameStateBody | null;
  seat: number | null;
  onOk: () => void;
  onCancel: () => void;
}) {
  const [folded, setFolded] = useState(false);
  const play = usePlay();
  const title = zonePickTitle(pick, seat, state);
  const count = pickCountWords(pick.min, pick.max);
  const source = /^(.+?)\s+-\s+/.exec(view.engineText.split('\n')[0] ?? '')?.[1]?.replace(/\s*\(\d+\)\s*$/, '') ?? null;
  if (folded) {
    return (
      <button type="button" className="zpick-pill" onClick={() => setFolded(false)} aria-label={`${title}: show the cards`}>
        <span className="zpick-pill-dot" aria-hidden="true" />
        {title}
        <span className="zpick-pill-cta">Show</span>
      </button>
    );
  }
  return (
    <section className="zpick" role="region" aria-label={title} data-zone-pick="">
      <header className="zpick-head">
        <div className="zpick-titles">
          <div className="zpick-eyebrow">{source ?? 'Your choice'}</div>
          <h2 className="zpick-title">{title}</h2>
          <div className="zpick-sub">
            {view.title && view.title !== title && <span>{view.title}</span>}
            {count && <span className="zpick-count">{count}</span>}
            <span className={cx('zpick-chosen', pick.chosenCount > 0 && 'has-picks')}>
              <span className="zpick-dot" aria-hidden="true" />
              {pick.chosenCount} selected
            </span>
          </div>
        </div>
        <button type="button" className="icon-btn zpick-fold" onClick={() => setFolded(true)} aria-label="Fold to see the board" title="Fold to see the board">
          <IconChevronDown size={18} />
        </button>
      </header>
      <div className="zpick-cards" role="group" aria-label="Cards to choose from">
        {pick.picks.map((p) => (
          <div key={p.id} className={cx('zpick-card', p.chosen && 'is-chosen')}>
            {p.card && !isHidden(p.card) ? (
              <CardTile card={p.card as Card} inHand />
            ) : (
              <button
                type="button"
                className="zpick-back"
                data-card-id={p.id}
                aria-label="A card you can’t see"
                onClick={() => play?.click(p.card ?? ({ id: p.id, hidden: true } as unknown as AnyCard))}
              >
                <span className="card-back" aria-hidden="true" />
              </button>
            )}
            {p.chosen && (
              <span className="zpick-check" aria-label="Selected">
                <IconCheck size={14} />
              </span>
            )}
            <span className="zpick-where">{zoneWords(p.zone, p.owner, seat, state)}</span>
          </div>
        ))}
      </div>
      <footer className="zpick-foot">
        <span className="zpick-hint">Click a card to choose it; click it again to take it back.</span>
        {view.cancel.label && (
          <button type="button" className="btn btn-quiet" disabled={!view.cancel.enabled} onClick={onCancel} data-engine-button="cancel">
            {view.cancel.label}
          </button>
        )}
        {view.ok.label && (
          <button type="button" className="btn btn-primary" disabled={!view.ok.enabled} onClick={onOk} data-engine-button="ok">
            {view.ok.label}
          </button>
        )}
      </footer>
    </section>
  );
}
