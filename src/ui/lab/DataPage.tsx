/*
 * ForgeCoach — ui/lab/DataPage.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The lab warehouse at a glance (#lab/data, #lab/data?src=sample,
 * #lab/data?src=<http(s) URL>): nightly volume (drafts, games, recorded,
 * quarantined, engine errors), table sizes, the archive and the disk, and per
 * cube its colour pairs and its highest and lowest cards, each win rate with
 * its 95% interval on a shared axis. Like the ladder page it claims nothing the
 * intervals do not support: a card whose interval includes 50% is neither
 * strong nor weak. Reads warehouse.json (lab/warehouse.ts) from GitHub's
 * lab-status branch; every string is rendered as React text.
 */
import '../ledger/ledger.css';
import './lab.css';
import './data.css';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  WAREHOUSE_REFRESH_MS,
  archiveSaving,
  cubeViews,
  droppedTotal,
  fetchWarehouse,
  fmtRange,
  fmtRate,
  lossShare,
  nightTotals,
  ratePct,
  rateDomain,
  rebaseWarehouse,
  verdict,
  warehouseSource,
  warehouseStaleness,
  type CubeView,
  type Verdict,
  type Warehouse,
  type WhNight,
  type WhRate,
} from '../../lab/warehouse.ts';
import { LabFetchError, fmtNum, formatBytes, formatClock, formatDuration, formatRelative, type LabSource } from '../../lab/status.ts';
import { originLabel, type Origin } from '../../lab/source.ts';
import { cubeInfo } from '../../cube/cubes.ts';
import { colourLabel } from '../../cube/colors.ts';
import { Dots, LedgerShell } from '../ledger/Ledger.tsx';
import { cx } from '../util.ts';
import { LabTabs } from './LabTabs.tsx';

interface Good {
  wh: Warehouse;
  fetchedAt: Date;
  origin: Origin;
}

const currentSource = (): LabSource => warehouseSource(location.hash, import.meta.env.BASE_URL);

function errorText(e: unknown): string {
  return e instanceof LabFetchError ? e.message : 'Something went wrong reading the warehouse file.';
}

export default function DataPage() {
  const [source, setSource] = useState<LabSource>(currentSource);
  const [good, setGood] = useState<Good | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const lastFetch = useRef(0);
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => {
    const on = () => {
      if (!/^#lab\/data\b/.test(location.hash)) return;
      setSource((prev) => {
        const next = currentSource();
        return next.kind === prev.kind && ('url' in next ? next.url : '') === ('url' in prev ? prev.url : '') ? prev : next;
      });
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const load = useCallback(async () => {
    if (source.kind === 'invalid') return;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    lastFetch.current = Date.now();
    setBusy(true);
    try {
      let wh = await fetchWarehouse(source.url, { fetch: (u, i) => fetch(u, i), signal: c.signal });
      const at = new Date();
      if (source.kind === 'sample') wh = rebaseWarehouse(wh, at);
      if (c.signal.aborted) return;
      setGood({ wh, fetchedAt: at, origin: source.kind === 'default' ? 'github' : source.kind });
      setError(null);
    } catch (e) {
      if (c.signal.aborted) return;
      setError(e);
    } finally {
      if (ctrl.current === c) setBusy(false);
      setNow(new Date());
    }
  }, [source]);

  useEffect(() => {
    setGood(null);
    setError(null);
    void load();
    return () => ctrl.current?.abort();
  }, [load]);

  // Every five minutes while visible: the warehouse is rebuilt nightly.
  useEffect(() => {
    const tick = window.setInterval(() => {
      setNow(new Date());
      if (document.visibilityState === 'visible' && Date.now() - lastFetch.current >= WAREHOUSE_REFRESH_MS - 500) void load();
    }, 30_000);
    const vis = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastFetch.current >= WAREHOUSE_REFRESH_MS) void load();
    };
    const online = () => void load();
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('online', online);
    return () => {
      window.clearInterval(tick);
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('online', online);
    };
  }, [load]);

  const w = good?.wh ?? null;
  const stale = warehouseStaleness(w?.generatedAt ?? null, now);
  const dropped = w ? droppedTotal(w) : 0;

  return (
    <LedgerShell page="lab">
      <div className="lb-col">
        <LabTabs current="data" />
        <header className="lb-head">
          <div className="lb-head-text">
            <div className="lg-kicker">The PC lab</div>
            <h1 className="lg-title">Lab data</h1>
            {w && (
              <div className={cx('lb-updated', 'lg-mono', `is-${error !== null && stale.level === 'fresh' ? 'amber' : stale.level}`)}>
                <span className="lb-dot" aria-hidden="true" />
                {w.generatedAt ? `built ${formatRelative(w.generatedAt, now)}` : 'no build time'}
                {w.generatedAt && <span className="lg-muted"> · {formatClock(w.generatedAt, now)}</span>}
                <span className="lg-muted"> · {originLabel(good!.origin, source.kind === 'custom' ? source.url : undefined)}</span>
              </div>
            )}
          </div>
          <button type="button" className="lg-btn lb-refresh" onClick={() => void load()} disabled={busy || source.kind === 'invalid'} aria-label="Refresh now">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={cx(busy && 'lb-spin')}>
              <path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4" />
            </svg>
            <span>{busy ? 'Refreshing' : 'Refresh'}</span>
          </button>
        </header>

        {source.kind === 'sample' && (
          <p className="lb-note lb-note-sample">Sample data: every number is made up and its build time is moved to now. The real page reads the warehouse summary the runner publishes on the lab-status branch.</p>
        )}

        {source.kind === 'invalid' ? (
          <Empty title="That source can’t be used">
            <p>{source.reason}</p>
            <p>
              Use <code>#lab/data</code> for the published warehouse, <code>#lab/data?src=sample</code> for the sample, or <code>#lab/data?src=http://…</code> for another
              warehouse.json.
            </p>
            <p>
              <a className="lg-btn" href="#lab/data">
                Open the published warehouse
              </a>
            </p>
          </Empty>
        ) : !w ? (
          error !== null ? (
            <FirstError error={error} onRetry={() => void load()} />
          ) : (
            <div className="lb-loading">
              <span className="spinner spinner-lg" />
            </div>
          )
        ) : (
          <>
            {error !== null && (
              <div className="lb-banner is-error" role="status">
                <b>Couldn’t refresh.</b> {errorText(error)} Showing the warehouse fetched {formatClock(good!.fetchedAt, now)}.
              </div>
            )}
            {(stale.level === 'red' || stale.level === 'amber') && (
              <div className={cx('lb-banner', stale.level === 'red' ? 'is-red' : 'is-amber')} role="status">
                <b>Not rebuilt for {formatDuration(stale.ageS)}.</b> {stale.level === 'red' ? 'The nightly warehouse job may not be running.' : 'The warehouse is rebuilt once a night.'}
              </div>
            )}
            {stale.level === 'unknown' && <div className="lb-banner is-amber">The warehouse file has no build time, so its age is unknown.</div>}
            {dropped > 0 && (
              <div className="lb-banner is-amber" role="status">
                <b>
                  {dropped} {dropped === 1 ? 'entry' : 'entries'} left out.
                </b>{' '}
                They failed the page’s checks (a missing field, a number out of range, or an interval that doesn’t hold its rate).
              </div>
            )}
            <p className="dt-caveat">
              These are Forge-vs-Forge games, so a card’s rate measures that card in Forge’s hands, not in yours; and the games of one draft are correlated, so the
              intervals are optimistic.
            </p>
            <div className={cx('lb-body', stale.level === 'red' && 'is-stale')}>
              <Nights nights={w.nights} />
              <Storage wh={w} />
              <Cubes wh={w} />
            </div>
          </>
        )}

        <footer className="lb-foot lg-muted">
          {source.kind === 'default'
            ? 'From the runner’s numbers-only warehouse.json on the lab-status branch (schema 1).'
            : source.kind === 'custom'
              ? `From ${source.url}.`
              : source.kind === 'sample'
                ? 'From the bundled sample.'
                : null}
          {w?.warehouseVer && ` Warehouse ${w.warehouseVer}.`} Refreshes every five minutes while this page is open.
        </footer>
      </div>
    </LedgerShell>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="lb-section">
      <div className="lb-section-head">
        <h2 className="lb-kicker">
          {title}
          {count !== undefined && <span className="lb-count lg-mono">{count}</span>}
        </h2>
        <span className="lb-rule" aria-hidden="true" />
      </div>
      {children}
    </section>
  );
}

function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="lg-empty lb-empty">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function FirstError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const notFound = error instanceof LabFetchError && error.kind === 'notFound';
  return (
    <Empty title={notFound ? 'No warehouse summary yet' : 'Couldn’t read the warehouse'}>
      {notFound ? (
        <p>The runner hasn’t published a warehouse.json yet. Once the nightly warehouse job reports to the lab-status branch, its numbers show here.</p>
      ) : (
        <p>{errorText(error)} The network may be down; it tries again every five minutes.</p>
      )}
      <p>
        <button type="button" className="lg-btn" onClick={onRetry}>
          Try again
        </button>{' '}
        <a className="lg-btn" href="#lab/data?src=sample">
          See the sample
        </a>
      </p>
    </Empty>
  );
}

// ---------------------------------------------------------------------------
// Nightly volume

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-03" → "Oct 3"; a night number → "#12"; other text as it is. */
function nightLabel(n: string): string {
  const d = /^\d{4}-(\d{2})-(\d{2})$/.exec(n);
  if (d && +d[1]! >= 1 && +d[1]! <= 12) return `${MONTHS[+d[1]! - 1]} ${+d[2]!}`;
  return /^\d+$/.test(n) ? `#${n}` : n;
}

function Nights({ nights }: { nights: WhNight[] }) {
  if (!nights.length) {
    return (
      <Section title="Nightly volume">
        <p className="dt-none lg-muted">No nights in the file yet.</p>
      </Section>
    );
  }
  const rows = [...nights].reverse().slice(0, 14);
  const max = Math.max(1, ...rows.map((n) => n.games));
  const t = nightTotals(nights);
  return (
    <Section title="Nightly volume" count={nights.length}>
      <div className="lg-panel dt-panel">
        <table className="dt-nights">
          <thead>
            <tr>
              <th scope="col">Night</th>
              <th scope="col" className="num">
                Drafts
              </th>
              <th scope="col" className="num">
                Games
              </th>
              <th scope="col" className="num">
                Recorded
              </th>
              <th scope="col" className="num" title="Quarantined">
                <span className="dt-wide">Quarantined</span>
                <span className="dt-narrow" aria-hidden="true">
                  Quar.
                </span>
              </th>
              <th scope="col" className="num" title="Engine errors">
                <span className="dt-wide">Engine errors</span>
                <span className="dt-narrow" aria-hidden="true">
                  Err.
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((n) => {
              const share = lossShare(n);
              return (
                <tr key={n.night}>
                  <th scope="row" className="lg-mono" title={n.night}>
                    {nightLabel(n.night)}
                  </th>
                  <td className="num lg-mono">{fmtNum(n.drafts)}</td>
                  <td className="num lg-mono">
                    {fmtNum(n.games)}
                    <span className="dt-vol" aria-hidden="true">
                      <span style={{ width: `${(n.games / max) * 100}%` }} />
                    </span>
                  </td>
                  <td className="num lg-mono">{fmtNum(n.recorded)}</td>
                  <td className={cx('num lg-mono', n.quarantined > 0 && 'is-amber')}>{fmtNum(n.quarantined)}</td>
                  <td className={cx('num lg-mono', n.engineErrors > 0 && (share !== null && share >= 0.01 ? 'is-bad' : 'is-amber'))}>{fmtNum(n.engineErrors)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">{nights.length > rows.length ? `All ${nights.length}` : 'Total'}</th>
              <td className="num lg-mono">{fmtNum(t.drafts)}</td>
              <td className="num lg-mono">{fmtNum(t.games)}</td>
              <td className="num lg-mono">{fmtNum(t.recorded)}</td>
              <td className="num lg-mono">{fmtNum(t.quarantined)}</td>
              <td className="num lg-mono">{fmtNum(t.engineErrors)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="dt-hint lg-muted">Newest first. Quarantined games failed a check and are kept out of the rates; engine errors are games the engine could not finish.</p>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Storage

function Storage({ wh }: { wh: Warehouse }) {
  const maxBytes = Math.max(1, ...wh.tables.map((t) => t.bytes));
  const totalBytes = wh.tables.reduce((s, t) => s + t.bytes, 0);
  const saving = wh.archive ? archiveSaving(wh.archive) : null;
  const disk = wh.disk;
  return (
    <Section title="Storage">
      <div className="lg-panel dt-panel dt-storage">
        <dl className="lb-stats dt-blocks">
          <div className="lb-stat">
            <dt>Tables</dt>
            <dd>
              <span className="lb-stat-v lg-mono">{wh.tables.length ? formatBytes(totalBytes) : '—'}</span>
              <span className="lb-stat-sub">
                {wh.tables.length} table{wh.tables.length === 1 ? '' : 's'}
              </span>
            </dd>
          </div>
          <div className="lb-stat">
            <dt>Archive</dt>
            <dd>
              {wh.archive ? (
                <>
                  <span className="lb-stat-v lg-mono">{formatBytes(wh.archive.zstdBytes)}</span>
                  <span className="lb-stat-sub">
                    zstd, vs {formatBytes(wh.archive.gzipBytes)} gzip
                    {saving !== null && (saving >= 0 ? ` · ${Math.round(saving * 100)}% smaller` : ` · ${Math.round(-saving * 100)}% larger`)}
                  </span>
                </>
              ) : (
                <span className="lb-stat-v lg-muted">not reported</span>
              )}
            </dd>
          </div>
          <div className={cx('lb-stat', disk && disk.usedPct >= 90 ? 'is-bad' : disk && disk.usedPct >= 80 ? 'is-amber' : null)}>
            <dt>Disk</dt>
            <dd>
              {disk ? (
                <>
                  <span className="lb-stat-v lg-mono">{fmtNum(disk.freeGB, disk.freeGB < 10 ? 1 : 0)} GB free</span>
                  <div className={cx('lb-bar dt-disk', disk.usedPct >= 90 ? 'is-red' : disk.usedPct >= 80 ? 'is-amber' : null)} aria-hidden="true">
                    <span className="lb-bar-fill" style={{ width: `${disk.usedPct}%` }} />
                  </div>
                  <span className="lb-stat-sub">{fmtNum(disk.usedPct, 0)}% used</span>
                </>
              ) : (
                <span className="lb-stat-v lg-muted">not reported</span>
              )}
            </dd>
          </div>
        </dl>
        {wh.tables.length > 0 && (
          <ul className="dt-tables">
            {wh.tables.slice(0, 20).map((t) => (
              <li key={t.name}>
                <span className="dt-tname lg-mono">{t.name}</span>
                <span className="dt-trows lg-mono">{fmtNum(t.rows)} rows</span>
                <span className="dt-tbytes lg-mono">{formatBytes(t.bytes)}</span>
                <span className="lb-bar is-muted dt-tbar" aria-hidden="true">
                  <span className="lb-bar-fill" style={{ width: `${(t.bytes / maxBytes) * 100}%` }} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Cubes

const VERDICT_LABEL: Record<Verdict, string> = { strong: 'strong', weak: 'weak', even: 'can’t tell' };

function cubeTitle(id: string): string {
  return cubeInfo(id)?.title ?? id;
}

function pairName(p: string): string {
  return /^[WUBRG]{2,3}$/.test(p) ? colourLabel(p) : p;
}

function Cubes({ wh }: { wh: Warehouse }) {
  const views = cubeViews(wh, 5);
  if (!views.length) {
    return (
      <Section title="Cubes">
        <p className="dt-none lg-muted">No cube has rates yet.</p>
      </Section>
    );
  }
  return (
    <Section title="Cubes" count={views.length}>
      <p className="dt-hint lg-muted">
        Win rates with 95% intervals; the dashed line is 50%. A card or pair is called strong or weak only when its whole interval is on one side of 50%. Highest cards
        are ranked by the bottom of their interval, lowest by the top.
      </p>
      <div className="dt-cubes">
        {views.map((v) => (
          <CubeBlock key={v.cube} v={v} />
        ))}
      </div>
    </Section>
  );
}

function CubeBlock({ v }: { v: CubeView }) {
  const d = rateDomain([...v.pairs, ...v.top, ...v.bottom]);
  const s = v.stats;
  return (
    <article className="lg-panel dt-cube">
      <header className="dt-cube-head">
        <h3 className="dt-cube-title">{cubeTitle(v.cube)}</h3>
        {s && (
          <span className="dt-cube-meta lg-mono">
            {fmtNum(s.drafts)} drafts · {fmtNum(s.games)} games · {fmtNum(s.avgTurns, 1)} turns avg · on the play {fmtRate(s.onPlayWinRate)}
          </span>
        )}
      </header>
      <Axis d={d} />
      {v.pairs.length > 0 && (
        <RateGroup title="Colour pairs">
          {v.pairs.map((p) => (
            <RateRow
              key={p.pair}
              r={p}
              d={d}
              label={
                <>
                  {/^[WUBRG]{2,3}$/.test(p.pair) && <Dots colors={p.pair} />}
                  <span className="dt-name-t">{pairName(p.pair)}</span>
                </>
              }
              aria={pairName(p.pair)}
            />
          ))}
        </RateGroup>
      )}
      {v.top.length > 0 && (
        <RateGroup title="Highest cards">
          {v.top.map((c) => (
            <RateRow key={c.card} r={c} d={d} label={<span className="dt-name-t">{c.card}</span>} aria={c.card} />
          ))}
        </RateGroup>
      )}
      {v.bottom.length > 0 && (
        <RateGroup title="Lowest cards">
          {v.bottom.map((c) => (
            <RateRow key={c.card} r={c} d={d} label={<span className="dt-name-t">{c.card}</span>} aria={c.card} />
          ))}
        </RateGroup>
      )}
      {v.cardCount > v.top.length + v.bottom.length && <p className="dt-more lg-muted">{v.cardCount - v.top.length - v.bottom.length} more cards in the warehouse.</p>}
      {!v.pairs.length && !v.cardCount && <p className="dt-more lg-muted">No pair or card rates for this cube yet.</p>}
    </article>
  );
}

function Axis({ d }: { d: { min: number; max: number; ticks: number[] } }) {
  return (
    <div className="dt-axis-row" aria-hidden="true">
      <span className="dt-axis lg-mono">
        {d.ticks.map((t) => (
          <span key={t} className={cx('dt-tick', Math.abs(t - 0.5) < 1e-9 && 'is-even')} style={{ left: `${ratePct(t, d)}%` }}>
            {Math.round(t * 100)}
          </span>
        ))}
      </span>
    </div>
  );
}

function RateGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="dt-group">
      <div className="dt-group-h">{title}</div>
      <ul className="dt-rows">{children}</ul>
    </div>
  );
}

function RateRow({ r, d, label, aria }: { r: WhRate; d: { min: number; max: number; ticks: number[] }; label: ReactNode; aria: string }) {
  const v = verdict(r);
  return (
    <li className={cx('dt-row', `is-${v}`)} aria-label={`${aria}: ${fmtRate(r.winRate)} over ${r.games} games, 95% interval ${fmtRange(r)}; ${VERDICT_LABEL[v]}`}>
      <span className="dt-name">{label}</span>
      <span className="dt-track" aria-hidden="true">
        {d.ticks.map((t) => (
          <span key={t} className="dt-grid" style={{ left: `${ratePct(t, d)}%` }} />
        ))}
        <span className="dt-even" style={{ left: `${ratePct(0.5, d)}%` }} />
        <span className="dt-ci" style={{ left: `${ratePct(r.lo, d)}%`, width: `${Math.max(0.6, ratePct(r.hi, d) - ratePct(r.lo, d))}%` }} />
        <span className="dt-pt" style={{ left: `${ratePct(r.winRate, d)}%` }} />
      </span>
      <span className="dt-num lg-mono">
        <span className="dt-rate">{fmtRate(r.winRate)}</span>
        <span className="dt-range">
          {fmtRange(r)} · {fmtNum(r.games)} g
        </span>
      </span>
      <span className={cx('dt-verdict', `is-${v}`)}>{VERDICT_LABEL[v]}</span>
    </li>
  );
}
