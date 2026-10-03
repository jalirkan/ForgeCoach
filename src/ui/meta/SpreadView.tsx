/*
 * ForgeCoach — ui/meta/SpreadView.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The "Power spread" view of the metagame page: how spread out one cube's card
 * win rates are (histogram against the noise-only expectation, strip plot,
 * outliers, the flatness numbers) and a table comparing every cube that has
 * lab data. The statistics live in cube/flatness.ts.
 */
import { useMemo } from 'react';
import {
  ABOVE_MARGIN,
  FLAT_SD,
  VERDICT_LABEL,
  compareCubes,
  cubeSpread,
  histogram,
  readSpread,
  type Outlier,
  type SpreadStats,
} from '../../cube/flatness.ts';
import type { CubeMeta } from '../../cube/meta.ts';
import { pct } from '../../cube/metaView.ts';
import { cx } from '../util.ts';
import { useTip } from '../ledger/Ledger.tsx';
import { useAllMetas } from './useAllMetas.ts';

const pts = (x: number, d = 1) => (x * 100).toFixed(d);
const range = (ci: [number, number]) => `${pts(ci[0])}–${pts(ci[1])}`;

export function SpreadView({ cubeId, meta, reloadKey }: { cubeId: string; meta: CubeMeta; reloadKey: unknown }) {
  const spread = useMemo(() => cubeSpread(meta), [meta]);
  return (
    <div className="sp">
      <CardSpread stats={spread.cards} />
      {spread.archetypes && <ArchetypeSpread stats={spread.archetypes} />}
      <CompareCubes currentId={cubeId} reloadKey={reloadKey} />
    </div>
  );
}

function Num({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="sp-num">
      <span className="mt-stat-label">{label}</span>
      <span className="lg-mono sp-num-v">{value}</span>
      {note && <span className="sp-num-n">{note}</span>}
    </div>
  );
}

function CardSpread({ stats }: { stats: SpreadStats | null }) {
  return (
    <section className="lg-panel sp-panel" aria-label="Card power spread">
      <div className="lg-kicker">Power spread</div>
      <h2 className="sp-h">How spread out are the cards?</h2>
      {!stats ? (
        <p className="lg-muted">{readSpread(null)[0]}</p>
      ) : (
        <>
          <div className="sp-verdict">
            <span className={cx('lg-chip', stats.verdict === 'flat' || stats.verdict === 'uneven' ? 'lg-chip-gold' : '')}>{VERDICT_LABEL[stats.verdict]}</span>
            <span className="muted tiny">
              {stats.n} cards with {stats.minGames}+ games (of {stats.total} with any)
            </span>
          </div>
          {stats.n > 0 && <Histogram stats={stats} />}
          <p className="sp-read">{readSpread(stats).join(' ')}</p>
          <div className="sp-nums">
            <Num label="Observed SD" value={`${pts(stats.sd)} pts`} note={`IQR ${pts(stats.iqr)} pts`} />
            <Num label="Noise alone" value={`${pts(stats.noiseSd)} pts`} note="SD if every card were average" />
            <Num label="True spread" value={`${pts(stats.trueSd)} pts`} note={`95%: ${range(stats.trueSdCi)}`} />
            <Num
              label={`Above mean +${pts(ABOVE_MARGIN, 0)}`}
              value={pct(stats.aboveShare, 0)}
              note={`${stats.aboveCount} cards · noise alone: ${pct(stats.noiseAboveShare, 0)}`}
            />
          </div>
          <Strip stats={stats} />
          <Outliers stats={stats} />
        </>
      )}
    </section>
  );
}

function Histogram({ stats }: { stats: SpreadStats }) {
  const h = useMemo(() => histogram(stats), [stats]);
  const W = 600;
  const H = 120;
  const bw = W / h.bins.length;
  const x = (rate: number) => ((rate - h.lo) / (h.binWidth * h.bins.length)) * W;
  const y = (n: number) => H - (n / h.max) * (H - 6);
  const curve = h.expected.map((n, i) => `${i === 0 ? 'M' : 'L'}${(i + 0.5) * bw},${y(n)}`).join(' ');
  const hi = h.lo + h.binWidth * h.bins.length;
  const ticks: number[] = [];
  for (let t = Math.ceil(h.lo * 20) / 20; t <= hi + 1e-9; t += 0.05) ticks.push(Math.round(t * 100) / 100);
  return (
    <figure className="sp-fig" aria-label="Histogram of card win rates">
      <svg className="sp-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Cards per win-rate band, against what noise alone would give">
        {ticks.map((t) => (
          <line key={t} x1={x(t)} x2={x(t)} y1={0} y2={H} className="sp-grid" vectorEffect="non-scaling-stroke" />
        ))}
        {h.bins.map((n, i) => (
          <rect key={i} x={i * bw + 1} y={y(n)} width={Math.max(0, bw - 2)} height={H - y(n)} className="sp-bar" />
        ))}
        <path d={curve} className="sp-noise" vectorEffect="non-scaling-stroke" fill="none" />
        <line x1={x(stats.meanRate)} x2={x(stats.meanRate)} y1={0} y2={H} className="sp-mean" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="sp-axis" aria-hidden="true">
        {ticks.map((t) => (
          <span key={t} style={{ left: `${(x(t) / W) * 100}%` }}>
            {Math.round(t * 100)}%
          </span>
        ))}
      </div>
      <figcaption className="mt-chart-note">
        Bars: cards by shrunk win rate (2-point bands) · line: what sampling noise alone would give if every card were average · dashed: the mean ({pct(stats.meanRate)}).
        Bars hugging the line mean the spread is noise.
      </figcaption>
    </figure>
  );
}

/** One dot per card on a single rate axis, with the +5-point line. */
function Strip({ stats }: { stats: SpreadStats }) {
  const lo = Math.floor(Math.min(...stats.units.map((u) => u.shrunk)) * 20) / 20;
  const hi = Math.ceil(Math.max(...stats.units.map((u) => u.shrunk)) * 20) / 20;
  const span = hi - lo || 0.1;
  const x = (v: number) => `${((v - lo) / span) * 100}%`;
  const tip = useTip();
  return (
    <div className="sp-strip" aria-label="Every card's shrunk win rate">
      <div className="sp-strip-track">
        <span className="sp-strip-mean" style={{ left: x(stats.meanRate) }} />
        <span className="sp-strip-line" style={{ left: x(stats.meanRate + ABOVE_MARGIN) }} title="mean + 5 points" />
        {stats.units.map((u, i) => (
          <span
            key={u.name}
            className="sp-dot"
            style={{ left: x(u.shrunk), top: `${8 + ((i * 37) % 5) * 7}px` }}
            onPointerMove={(e) =>
              e.pointerType === 'mouse' &&
              tip.show(e, <><b>{u.name}</b><div className="lg-mono">{pct(u.shrunk)} · {u.games} games</div></>)
            }
            onPointerLeave={tip.hide}
          />
        ))}
      </div>
      <div className="mt-chart-note">One dot per card · solid line: mean + {pts(ABOVE_MARGIN, 0)} points · dashed: the mean</div>
      {tip.node}
    </div>
  );
}

function Outliers({ stats }: { stats: SpreadStats }) {
  return (
    <div className="sp-out">
      <h3 className="lg-section-title">Outliers</h3>
      <div className="lg-table-wrap">
        <table className="lg-table">
          <thead>
            <tr>
              <th>Card</th>
              <th className="num">Games</th>
              <th className="num">vs mean</th>
              <th className="num">Win</th>
              <th className="num">95% interval</th>
              <th className="mt-hide-sm">Reading</th>
            </tr>
          </thead>
          <tbody>
            {stats.outliers.map((o) => (
              <OutlierRow key={o.name} o={o} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-chart-note">
        {stats.clearCount} of {stats.n} cards have an interval clear of the mean; about {stats.clearByChance.toFixed(1)} would by chance alone. Many of the biggest
        gaps are the luck of small samples.
      </p>
    </div>
  );
}

function OutlierRow({ o }: { o: Outlier }) {
  return (
    <tr>
      <td>{o.name}</td>
      <td className="num lg-mono">{o.games}</td>
      <td className={cx('num lg-mono', o.dev > 0 ? 'sp-up' : 'sp-down')}>
        {o.dev > 0 ? '+' : '−'}
        {pts(Math.abs(o.dev))}
      </td>
      <td className="num lg-mono">{pct(o.shrunk)}</td>
      <td className="num lg-mono">{o.ci ? `${pct(o.ci[0], 0)}–${pct(o.ci[1], 0)}` : '—'}</td>
      <td className="mt-hide-sm lg-muted">{o.clear ? 'interval clear of the mean' : 'could be luck'}</td>
    </tr>
  );
}

function ArchetypeSpread({ stats }: { stats: SpreadStats }) {
  return (
    <section className="lg-panel sp-panel" aria-label="Archetype power spread">
      <div className="lg-kicker">Archetypes</div>
      <h2 className="sp-h">How spread out are the archetypes?</h2>
      {stats.verdict === 'unreadable' ? (
        <p className="sp-read">{readSpread(stats, 'archetype')[0]}</p>
      ) : (
        <>
          <p className="sp-read">{readSpread(stats, 'archetype').join(' ')}</p>
          <div className="sp-nums">
            <Num label="Observed SD" value={`${pts(stats.sd)} pts`} note={`IQR ${pts(stats.iqr)} pts`} />
            <Num label="Noise alone" value={`${pts(stats.noiseSd)} pts`} />
            <Num label="True spread" value={`${pts(stats.trueSd)} pts`} note={`95%: ${range(stats.trueSdCi)}`} />
          </div>
        </>
      )}
      <p className="mt-chart-note">{stats.n} archetypes with {stats.minGames}+ games.</p>
    </section>
  );
}

function CompareCubes({ currentId, reloadKey }: { currentId: string; reloadKey: unknown }) {
  const { loading, inputs } = useAllMetas(reloadKey);
  const cmp = useMemo(() => compareCubes(inputs), [inputs]);
  return (
    <section className="lg-panel sp-panel" aria-label="Compare cubes">
      <div className="lg-kicker">Compare cubes</div>
      <h2 className="sp-h">Which cube is flattest?</h2>
      {loading ? (
        <div className="mt-loading"><span className="spinner" /></div>
      ) : (
        <>
          <div className="lg-table-wrap">
            <table className="lg-table sp-compare">
              <thead>
                <tr>
                  <th>Cube</th>
                  <th className="num">True spread</th>
                  <th className="mt-hide-sm">Top 3 outliers</th>
                </tr>
              </thead>
              <tbody>
                {cmp.rows.map((r) => (
                  <tr key={r.id} className={cx(r.id === currentId && 'sp-current')}>
                    <td>
                      <a className="sp-cube" href={`#meta/${r.id}/spread`}>{r.title.replace(/ Cube$/, '')}</a>
                      {r.source === 'imported' && <span className="lg-chip lg-chip-gold mt-imported">Imported</span>}
                    </td>
                    {r.spread ? (
                      <>
                        <td className="num lg-mono">
                          {r.spread.verdict === 'unreadable' ? (
                            <span className="lg-muted">too few games</span>
                          ) : (
                            <>
                              {pts(r.spread.trueSd)} pts
                              <div className="sp-ci">95%: {range(r.spread.trueSdCi)}</div>
                            </>
                          )}
                          <div className="sp-ci">{r.spread.n} cards · {VERDICT_LABEL[r.spread.verdict]}</div>
                        </td>
                        <td className="mt-hide-sm sp-top">
                          {r.spread.outliers.slice(0, 3).map((o) => (
                            <div key={o.name}>
                              {o.name} <span className={cx('lg-mono', o.dev > 0 ? 'sp-up' : 'sp-down')}>{o.dev > 0 ? '+' : '−'}{pts(Math.abs(o.dev))}</span>
                              <span className="lg-muted lg-mono"> ({o.ci ? `${pct(o.ci[0], 0)}–${pct(o.ci[1], 0)}` : '—'})</span>
                            </div>
                          ))}
                        </td>
                      </>
                    ) : (
                      <td colSpan={2} className="lg-muted">no lab data yet — run forgecoach overnight</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="sp-reading">
            <h3 className="lg-section-title">Reading</h3>
            {cmp.readings.length > 0 && (
              <ul>
                {cmp.readings.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            )}
            {cmp.caveat && <p>{cmp.caveat}</p>}
            <p className="mt-chart-note">
              “Flatter” is said only when one cube’s 95% interval lies wholly below the other’s. A true spread of {pts(FLAT_SD, 0)} points or less counts as flat. The
              estimate is the observed SD of shrunk win rates with the sampling noise taken out; a card’s games come in clusters of one deck, so noise is, if anything,
              under-counted and real spread over-stated.
            </p>
          </div>
        </>
      )}
    </section>
  );
}
