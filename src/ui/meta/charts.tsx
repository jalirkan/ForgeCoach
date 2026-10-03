/*
 * ForgeCoach — ui/meta/charts.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The metagame page's side charts. The cube lab has no time series, so
 * instead of meta share over time these show what the data does hold: each
 * archetype's (shrunk) win rate with its 95 % interval against the mean, and
 * meta share by colour pair.
 */
import { colourLabel } from '../../cube/colors.ts';
import { axisTicks, intervalDomain, pct, type ArchetypeRow } from '../../cube/metaView.ts';
import { Dots, useTip } from '../ledger/Ledger.tsx';

const CHART_ROWS = 12;

export function WinChart({ rows, mean, onOpen }: { rows: ArchetypeRow[]; mean: number | null; onOpen: (r: ArchetypeRow) => void }) {
  const tip = useTip();
  const top = [...rows].sort((a, b) => b.decks - a.decks || b.games - a.games).slice(0, CHART_ROWS);
  top.sort((a, b) => (b.win ?? 0) - (a.win ?? 0));
  const [lo, hi] = intervalDomain(top);
  const span = hi - lo || 1;
  const x = (v: number) => `${((Math.max(lo, Math.min(hi, v)) - lo) / span) * 100}%`;
  const ticks = axisTicks([lo, hi]);
  const m = mean ?? 0.5;
  return (
    <section className="mt-chart" aria-label="Win rate by archetype">
      <h2 className="lg-section-title">Win rate by archetype</h2>
      <p className="mt-chart-note">
        The {top.length} most-drafted archetypes · dot: shrunk win rate · whiskers: 95% interval · line: the mean
      </p>
      <div className="mt-forest">
        <div className="mt-forest-axis" aria-hidden="true">
          <span />
          <div className="mt-forest-track">
            {ticks.map((t) => (
              <span key={t} className="mt-forest-tick" style={{ left: x(t) }}>
                {Math.round(t * 100)}%
              </span>
            ))}
          </div>
        </div>
        {top.map((r) => (
          <button
            type="button"
            key={r.id}
            className="mt-forest-row"
            onClick={() => onOpen(r)}
            onPointerMove={(e) =>
              e.pointerType === 'mouse' &&
              tip.show(
                e,
                <>
                  <b>{r.name}</b>
                  <div className="lg-mono">
                    Win {pct(r.win)} · raw {pct(r.winRaw)}
                  </div>
                  {r.ci && (
                    <div className="lg-mono">
                      95%: {pct(r.ci[0], 0)}–{pct(r.ci[1], 0)}
                    </div>
                  )}
                  <div className="lg-mono">
                    {r.decks} decks · {r.games} games
                  </div>
                </>,
              )
            }
            onPointerLeave={tip.hide}
            aria-label={`${r.name}: win ${pct(r.win)}`}
          >
            <span className="mt-forest-label">
              <Dots colors={r.colors} />
              <span>{r.name}</span>
            </span>
            <span className="mt-forest-track">
              {ticks.map((t) => (
                <span key={t} className="mt-forest-grid" style={{ left: x(t) }} />
              ))}
              <span className="mt-forest-mean" style={{ left: x(m) }} />
              {r.ci && <span className="mt-forest-ci" style={{ left: x(r.ci[0]), right: `calc(100% - ${x(r.ci[1])})` }} />}
              {r.win !== null && <span className="mt-forest-dot" style={{ left: x(r.win) }} />}
            </span>
          </button>
        ))}
      </div>
      {tip.node}
    </section>
  );
}

export function ColourShareChart({ rows }: { rows: ArchetypeRow[] }) {
  const by = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    by.set(r.colors, (by.get(r.colors) ?? 0) + r.decks);
    total += r.decks;
  }
  const list = [...by.entries()].sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...list.map(([, n]) => n));
  return (
    <section className="mt-chart" aria-label="Meta share by colours">
      <h2 className="lg-section-title">Meta share by colours</h2>
      <div className="mt-bars">
        {list.map(([colors, n]) => (
          <div key={colors} className="mt-bar-row">
            <span className="mt-forest-label">
              <Dots colors={colors} />
              <span>{colourLabel(colors)}</span>
            </span>
            <span className="mt-bar-track">
              <span className="mt-bar" style={{ width: `${(n / max) * 100}%` }} />
            </span>
            <span className="lg-mono mt-bar-val">{pct(total ? n / total : 0, 0)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
