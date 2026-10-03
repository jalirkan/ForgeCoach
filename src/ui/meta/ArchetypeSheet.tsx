/*
 * ForgeCoach — ui/meta/ArchetypeSheet.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * One archetype in detail: its key cards, lands and curve, a sample deck
 * from the lab, and the card pairs in its colours that won more together.
 */
import { useEffect, useMemo, useState } from 'react';
import type { CubeMeta } from '../../cube/meta.ts';
import { cubeCardIndex, groupDeck, pairsFor, pct, signedPct, type ArchetypeRow } from '../../cube/metaView.ts';
import { prefetchCards, useCardInfo } from '../cardData.ts';
import { Sheet } from '../Sheet.tsx';
import { Dots, IntervalStrip } from '../ledger/Ledger.tsx';

export function ArchetypeSheet({ row, meta, onClose }: { row: ArchetypeRow; meta: CubeMeta; onClose: () => void }) {
  const cube = useMemo(() => cubeCardIndex(meta), [meta]);
  const groups = useMemo(() => (row.sampleDeck ? groupDeck(row.sampleDeck, cube) : []), [row, cube]);
  const pairs = useMemo(() => pairsFor(meta, row.colors), [meta, row.colors]);
  useEffect(() => prefetchCards(row.keyCards), [row]);
  const maxCurve = Math.max(1, ...row.avgCurve.map((b) => b.n));
  return (
    <Sheet
      open
      onClose={onClose}
      width={880}
      className="ledger-sheet mt-sheet"
      title={row.name}
      subtitle={
        <span className="mt-sheet-sub">
          <Dots colors={row.colors} /> {row.id} · {row.decks} decks · {row.games} games
        </span>
      }
    >
      <div className="mt-sheet-stats">
        <Stat label="Meta" value={`${pct(row.share)}`} note={`${row.decks} decks`} />
        <Stat label="Win" value={pct(row.win)} note={row.shrunk ? `raw ${pct(row.winRaw)}` : undefined} />
        <Stat label="Interval" value={row.ci ? `${pct(row.ci[0], 0)}–${pct(row.ci[1], 0)}` : '—'} note="95% Wilson" />
        <Stat label="Avg lands" value={row.avgLands !== null ? row.avgLands.toFixed(1) : '—'} />
      </div>
      <IntervalStrip win={row.win} ci={row.ci} className="mt-sheet-strip" />

      <h3 className="mt-h3">Key cards</h3>
      <div className="mt-keygrid">
        {row.keyCards.map((k) => (
          <KeyCard key={k} name={k} />
        ))}
      </div>

      <div className="mt-sheet-cols">
        <section>
          <h3 className="mt-h3">Average curve</h3>
          {row.avgCurve.length ? (
            <div className="mt-curve" role="img" aria-label={row.avgCurve.map((b) => `${b.mv}: ${b.n.toFixed(1)}`).join(', ')}>
              {row.avgCurve.map((b) => (
                <div key={b.mv} className="mt-curve-col">
                  <span className="lg-mono mt-curve-n">{b.n.toFixed(1)}</span>
                  <span className="mt-curve-bar" style={{ height: `${(b.n / maxCurve) * 100}%` }} />
                  <span className="lg-mono mt-curve-mv">{b.mv}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="lg-muted">No curve in the data.</p>
          )}

          <h3 className="mt-h3">Cards that win together</h3>
          {pairs.length ? (
            <ul className="mt-pairs">
              {pairs.map((p) => (
                <li key={`${p.a}|${p.b}`}>
                  <span className="mt-pair-names">
                    {p.a} <span className="lg-muted">+</span> {p.b}
                  </span>
                  <span className="lg-mono mt-pair-lift">{signedPct(p.gain)}</span>
                  <span className="lg-mono lg-muted mt-pair-games">{p.games ?? '—'} g</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="lg-muted">No pair in these colours has enough games together.</p>
          )}
          <p className="mt-fine">Lift: the pair’s win rate together over the mean of the two cards’ own rates.</p>
        </section>

        <section>
          <h3 className="mt-h3">A sample deck</h3>
          {groups.length ? (
            <div className="mt-deck">
              {groups.map((g) => (
                <div key={g.label} className="mt-deck-group">
                  <div className="mt-deck-label">
                    {g.label} <span className="lg-mono lg-muted">{g.count}</span>
                  </div>
                  <ul>
                    {g.entries.map((e) => (
                      <li key={e.name}>
                        <span className="lg-mono mt-deck-n">{e.count}</span> {e.name}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <p className="lg-muted">No sample deck in the data.</p>
          )}
        </section>
      </div>
    </Sheet>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="mt-sheet-stat">
      <span className="mt-stat-label">{label}</span>
      <span className="lg-mono mt-sheet-val">{value}</span>
      {note && <span className="lg-mono mt-sheet-note">{note}</span>}
    </div>
  );
}

function KeyCard({ name }: { name: string }) {
  const info = useCardInfo(name);
  const img = info?.image?.normal ?? info?.image?.small;
  const [broken, setBroken] = useState(false);
  return (
    <figure className="mt-keycard" title={name}>
      {img && !broken ? <img src={img} alt={name} loading="lazy" decoding="async" onError={() => setBroken(true)} /> : <div className="mt-keycard-blank">{name}</div>}
    </figure>
  );
}
