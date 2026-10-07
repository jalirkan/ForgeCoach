/*
 * ForgeCoach — ui/ZoneViewer.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A zone opened from its count (endstep-style): "Pacho's Graveyard · 2 cards",
 * a type summary line, sort pills (Recency / Name / CMC / Type), the cards as
 * large images, and a Close button. A bottom sheet on phones, a centred
 * dialog on desktop (Sheet). Only what the redacted state carries: a hidden
 * card is a card back, and a library shows only the cards this seat may see.
 */
import { useMemo, useState } from 'react';
import type { AnyCard, Card, PlayerState } from '../protocol.ts';
import { isHidden } from '../protocol.ts';
import { CardBack, CardTile } from './CardTile.tsx';
import { PlayContext, usePlay, type PlayInteraction } from './cardContext.ts';
import { Sheet } from './Sheet.tsx';
import { cx, readLS, writeLS } from './util.ts';
import { sortZone, typeSummary, ZONE_SORTS, type ZoneSort } from './zoneView.ts';

import './zoneViewer.css';

export type ViewableZone = 'graveyard' | 'exile' | 'command' | 'library';

const SORT_KEY = 'forgecoach.zoneSort';
const ZONE_WORD: Record<ViewableZone, string> = { graveyard: 'Graveyard', exile: 'Exile', command: 'Command zone', library: 'Library' };

export function ZoneViewer({ player, zone, mine, onClose }: { player: PlayerState; zone: ViewableZone | null; mine: boolean; onClose: () => void }) {
  const [sort, setSort] = useState<ZoneSort>(() => {
    const s = readLS(SORT_KEY);
    return ZONE_SORTS.some((z) => z.id === s) ? (s as ZoneSort) : 'recency';
  });
  // In play, a card here the engine may take (a flashback in your graveyard, a target) is a
  // click like a tile on the board; the viewer then closes, so the payment or the next
  // question is not behind it.
  const play = usePlay();
  const closingPlay = useMemo<PlayInteraction | null>(
    () =>
      play
        ? {
            ...play,
            click: (c: AnyCard) => {
              onClose();
              play.click(c);
            },
          }
        : null,
    [play, onClose],
  );
  const raw = zone ? player.zones[zone].cards : [];
  const cards = useMemo(() => sortZone(raw, sort), [raw, sort]);
  const count = zone ? player.zones[zone].count : 0;
  const owner = mine ? 'Your' : `${player.name}’s`;
  const summary = typeSummary(raw);
  const title = zone ? (
    <>
      {owner} {ZONE_WORD[zone]}
      <span className="zv-count">
        {' '}
        · {count} card{count === 1 ? '' : 's'}
      </span>
    </>
  ) : null;
  const sub =
    zone === 'library'
      ? `${raw.length} of ${count} you may look at${summary ? ` · ${summary}` : ''}`
      : summary || (count === 0 ? 'Empty' : '');
  return (
    <Sheet
      open={zone !== null}
      onClose={onClose}
      title={title}
      subtitle={sub}
      width={860}
      className="zone-viewer"
      footer={
        <button type="button" className="btn btn-quiet zv-close" onClick={onClose}>
          Close
        </button>
      }
    >
      {raw.length > 1 && (
        <div className="zv-sorts" role="radiogroup" aria-label="Sort">
          {ZONE_SORTS.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={sort === s.id}
              className={cx('zv-sort', sort === s.id && 'is-on')}
              onClick={() => {
                setSort(s.id);
                writeLS(SORT_KEY, s.id);
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
      {cards.length === 0 ? (
        <p className="muted zv-empty">{zone === 'library' ? 'You can’t see any of these cards.' : 'Nothing here.'}</p>
      ) : (
        <PlayContext.Provider value={closingPlay}>
          <div className="zv-grid">
            {cards.map((c) => (isHidden(c) ? <CardBack key={c.id} /> : <CardTile key={c.id} card={c as Card} inHand />))}
          </div>
        </PlayContext.Provider>
      )}
    </Sheet>
  );
}
