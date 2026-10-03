/*
 * ForgeCoach — ui/lab/LadderPage.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The AI leaderboard (#lab/ladder, #lab/ladder?src=sample,
 * #lab/ladder?src=<http(s) URL>): mtg-table's AI ladder ratings on one Elo
 * scale with forge-default fixed at 1500, each with its 95% interval drawn on
 * a shared axis; the latest SPRTs, tuner runs and the league. It claims no
 * order the intervals do not support: ranks are ranges, and tapping a player
 * marks every other as clearly above, clearly below, or not separated from it.
 * Reads ladder.json (lab/ladder.ts); every string is rendered as React text.
 */
import '../ledger/ledger.css';
import './lab.css';
import './ladder.css';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  LADDER_REFRESH_MS,
  LADDER_VERSION,
  anchorSummary,
  axisDomain,
  axisPct,
  ciLabel,
  fetchLadder,
  fmtDelta,
  fmtInterval,
  fmtPct,
  fmtRating,
  hasInterval,
  ladderSource,
  ladderStaleness,
  rankRange,
  rebaseLadder,
  relation,
  setLabel,
  sprtVerdict,
  type Ladder,
  type LadderPlayer,
  type Relation,
  type SprtRow,
  type TuneRow,
} from '../../lab/ladder.ts';
import { LabFetchError, fmtNum, formatClock, formatDuration, formatRelative, type LabSource } from '../../lab/status.ts';
import { LedgerShell } from '../ledger/Ledger.tsx';
import { cx } from '../util.ts';
import { LabTabs } from './LabTabs.tsx';

interface Good {
  ladder: Ladder;
  fetchedAt: Date;
}

const currentSource = (): LabSource => ladderSource(location.hash, import.meta.env.BASE_URL);

function errorText(e: unknown): string {
  return e instanceof LabFetchError ? e.message : 'Something went wrong reading the ladder file.';
}

export default function LadderPage() {
  const [source, setSource] = useState<LabSource>(currentSource);
  const [good, setGood] = useState<Good | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const lastFetch = useRef(0);
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => {
    const on = () => {
      if (!/^#lab\/ladder\b/.test(location.hash)) return;
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
      let ladder = await fetchLadder(source.url, { fetch: (u, i) => fetch(u, i), signal: c.signal });
      const at = new Date();
      if (source.kind === 'sample') ladder = rebaseLadder(ladder, at);
      if (c.signal.aborted) return;
      setGood({ ladder, fetchedAt: at });
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

  // Every five minutes while visible: the ladder changes after runs, not by the minute.
  useEffect(() => {
    const tick = window.setInterval(() => {
      setNow(new Date());
      if (document.visibilityState === 'visible' && Date.now() - lastFetch.current >= LADDER_REFRESH_MS - 500) void load();
    }, 30_000);
    const vis = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastFetch.current >= LADDER_REFRESH_MS) void load();
    };
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('online', load);
    return () => {
      window.clearInterval(tick);
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('online', load);
    };
  }, [load]);

  const l = good?.ladder ?? null;
  const stale = ladderStaleness(l?.generatedAt ?? null, now);

  return (
    <LedgerShell page="lab">
      <div className="lb-col">
        <LabTabs current="ladder" />
        <header className="lb-head">
          <div className="lb-head-text">
            <div className="lg-kicker">The PC lab</div>
            <h1 className="lg-title">AI ladder</h1>
            {l && (
              <div className={cx('lb-updated', 'lg-mono', `is-${error !== null && stale.level === 'fresh' ? 'amber' : stale.level}`)}>
                <span className="lb-dot" aria-hidden="true" />
                {l.generatedAt ? `rated ${formatRelative(l.generatedAt, now)}` : 'no report time'}
                {l.generatedAt && <span className="lg-muted"> · {formatClock(l.generatedAt, now)}</span>}
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

        {source.kind === 'sample' && <p className="lb-note lb-note-sample">Sample data, with its times moved to now. The real page reads the ladder the runner publishes on the lab-status branch.</p>}

        {source.kind === 'invalid' ? (
          <Empty title="That source can’t be used">
            <p>{source.reason}</p>
            <p>
              Use <code>#lab/ladder</code> for the published ladder, <code>#lab/ladder?src=sample</code> for the sample, or <code>#lab/ladder?src=http://…</code> for another
              ladder.json.
            </p>
            <p>
              <a className="lg-btn" href="#lab/ladder">
                Open the published ladder
              </a>
            </p>
          </Empty>
        ) : !l ? (
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
                <b>Couldn’t refresh.</b> {errorText(error)} Showing the ladder fetched {formatClock(good!.fetchedAt, now)}.
              </div>
            )}
            {(stale.level === 'red' || stale.level === 'amber') && (
              <div className={cx('lb-banner', stale.level === 'red' ? 'is-red' : 'is-amber')} role="status">
                <b>No new ratings for {formatDuration(stale.ageS)}.</b> {stale.level === 'red' ? 'The runner may not be running ladder jobs.' : 'The ladder updates after each run.'}
              </div>
            )}
            {stale.level === 'unknown' && <div className="lb-banner is-amber">The ladder file has no report time, so its age is unknown.</div>}
            {l.version !== null && l.version > LADDER_VERSION && (
              <p className="lb-note">
                This ladder file is version {l.version}; the page knows {LADDER_VERSION}. Some fields may be read wrongly.
              </p>
            )}
            <div className={cx('lb-body', stale.level === 'red' && 'is-stale')}>
              <Ratings ladder={l} />
              <Tests rows={l.sprt} now={now} />
              <Tuner rows={l.tune} now={now} />
              <LeagueView ladder={l} now={now} />
              <Totals ladder={l} now={now} />
            </div>
          </>
        )}

        <footer className="lb-foot lg-muted">
          {source.kind === 'default'
            ? 'From the runner’s numbers-only ladder.json on the lab-status branch (mtg-table’s AI ladder, schema 1).'
            : source.kind === 'custom'
              ? `From ${source.url}.`
              : source.kind === 'sample'
                ? 'From the bundled sample.'
                : null}{' '}
          Refreshes every five minutes while this page is open.
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
    <Empty title={notFound ? 'No ladder yet' : 'Couldn’t read the ladder'}>
      {notFound ? (
        <p>The runner hasn’t published a ladder.json yet. Once a ladder run reports to the lab-status branch, the ratings show here.</p>
      ) : (
        <p>{errorText(error)} The network may be down; it tries again every five minutes.</p>
      )}
      <p>
        <button type="button" className="lg-btn" onClick={onRetry}>
          Try again
        </button>{' '}
        <a className="lg-btn" href="#lab/ladder?src=sample">
          See the sample
        </a>
      </p>
    </Empty>
  );
}

// ---------------------------------------------------------------------------
// Ratings

const REL_LABEL: Record<Relation, string> = {
  self: 'the reference',
  above: 'clearly above it',
  below: 'clearly below it',
  overlap: 'not separated from it',
  none: '',
};

function Ratings({ ladder: l }: { ladder: Ladder }) {
  const rated = l.players.filter(hasInterval);
  const unrated = l.players.filter((p) => !hasInterval(p));
  const zero = rated.find((p) => p.isZero) ?? null;
  const [refName, setRefName] = useState<string | null>(null);
  const ref = rated.find((p) => p.name === refName) ?? zero ?? rated[0] ?? null;
  const d = axisDomain(rated, l.anchorRating);
  const anchorX = axisPct(l.anchorRating, d);

  if (!l.players.length) {
    return (
      <Empty title="No players yet">
        <p>The ladder file has no players. Ratings show here after the first ladder run reports.</p>
      </Empty>
    );
  }

  return (
    <Section title="Ratings" count={rated.length}>
      <p className="ld-lede">{anchorSummary(l)}</p>
      <p className="ld-scale lg-muted">
        Elo scale, {l.anchorName} fixed at {fmtRating(l.anchorRating)}; 100 points ≈ 64% to win. Bars are {ciLabel(l.ci)}. Overlapping bars mean the games so far
        don’t tell those players apart, so ranks are given as ranges.
      </p>

      {rated.length > 0 && (
        <div className="ld-board lg-panel">
          <div className="ld-axis lg-mono" aria-hidden="true">
            {d.ticks.map((t) => (
              <span key={t} className={cx('ld-tick', t === l.anchorRating && 'is-anchor')} style={{ left: `${axisPct(t, d)}%` }}>
                {t}
              </span>
            ))}
          </div>
          <ol className="ld-rows">
            {rated.map((p) => {
              const rel = ref ? relation(p, ref) : 'none';
              const rr = rankRange(p, rated);
              return (
                <li key={p.name}>
                  <button
                    type="button"
                    className={cx('ld-row', `is-${rel}`)}
                    aria-pressed={p === ref}
                    onClick={() => setRefName(p.name)}
                    aria-label={`${p.name}: ${fmtRating(p.rating)}, 95% interval ${fmtInterval(p)}${ref && p !== ref ? `; ${REL_LABEL[rel]} (${ref.name})` : ''}. Compare others with it.`}
                  >
                    <span className="ld-row-top">
                      <span className="ld-rank lg-mono" title="Possible ranks given the intervals">
                        {rr ? (rr[0] === rr[1] ? rr[0] : `${rr[0]}–${rr[1]}`) : '—'}
                      </span>
                      <span className="ld-name">
                        <span className="ld-name-t">{p.name}</span>
                        <PlayerChips p={p} />
                      </span>
                      <span className="ld-rating lg-mono">
                        {fmtRating(p.rating)}
                        {!p.isZero && <span className="ld-delta">{fmtDelta(p.rating, l.anchorRating)}</span>}
                      </span>
                    </span>
                    <span className="ld-track" aria-hidden="true">
                      {d.ticks.map((t) => (
                        <span key={t} className="ld-grid" style={{ left: `${axisPct(t, d)}%` }} />
                      ))}
                      {ref && ref.lo !== ref.hi && <span className="ld-refband" style={{ left: `${axisPct(ref.lo!, d)}%`, width: `${axisPct(ref.hi!, d) - axisPct(ref.lo!, d)}%` }} />}
                      <span className="ld-zero" style={{ left: `${anchorX}%` }} />
                      {p.isZero ? (
                        <span className="ld-pin" style={{ left: `${anchorX}%` }} />
                      ) : (
                        <>
                          <span className="ld-ci" style={{ left: `${axisPct(p.lo, d)}%`, width: `${Math.max(0.6, axisPct(p.hi, d) - axisPct(p.lo, d))}%` }} />
                          <span className="ld-pt" style={{ left: `${axisPct(p.rating, d)}%` }} />
                        </>
                      )}
                    </span>
                    <span className="ld-row-foot">
                      <span className="lg-mono">{p.isZero ? 'fixed, no interval' : fmtInterval(p)}</span>
                      <span>
                        {fmtNum(p.games)} games{p.wins !== null && p.losses !== null && ` · ${p.wins}–${p.losses}`}
                        {p.draws ? ` · ${p.draws} drawn` : ''}
                      </span>
                      {p.vsAnchor && (
                        <span className="ld-vs">
                          vs {l.anchorName} {p.vsAnchor.wins}–{p.vsAnchor.losses} ({fmtPct(p.vsAnchor.rate)}
                          {p.vsAnchor.lo !== null && p.vsAnchor.hi !== null && `, ${fmtPct(p.vsAnchor.lo)}–${fmtPct(p.vsAnchor.hi)}`})
                        </span>
                      )}
                      {ref && p !== ref && rel !== 'none' && <span className={cx('ld-rel', `is-${rel}`)}>{REL_LABEL[rel]}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="ld-legend">
            <span>
              <i className="ld-key is-above" /> clearly above
            </span>
            <span>
              <i className="ld-key is-overlap" /> not separated
            </span>
            <span>
              <i className="ld-key is-below" /> clearly below
            </span>
            <span className="ld-legend-ref">{ref ? <>compared with {ref.name} (shaded) · tap a player to compare with it</> : null}</span>
          </div>
        </div>
      )}

      {unrated.length > 0 && (
        <div className="ld-unrated">
          <div className="lb-events-h">Not rated yet</div>
          <ul className="lb-list lg-panel">
            {unrated.map((p) => (
              <li key={p.name} className="lb-row">
                <span className="lb-row-main">
                  <span className="ld-name-t">{p.name}</span> <PlayerChips p={p} />
                </span>
                <span className="lb-row-end">{!p.available ? 'not playable yet' : p.games ? `${p.games} games, no interval` : 'no decisive game'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

function PlayerChips({ p }: { p: LadderPlayer }) {
  return (
    <>
      {p.isZero ? <span className="lg-chip ld-chip-zero">anchor · 1500</span> : p.anchor && <span className="lg-chip ld-chip-stock">stock Forge</span>}
      {!p.registered && <span className="lg-chip ld-chip-old">old config</span>}
      {!p.available && p.registered && <span className="lg-chip ld-chip-old">unavailable</span>}
    </>
  );
}

// ---------------------------------------------------------------------------
// Tests, tuner, league, totals

const RESULT_CHIP: Record<SprtRow['result'], { label: string; tone: string }> = {
  H1: { label: 'H1', tone: 'is-done' },
  H0: { label: 'H0', tone: 'is-failed' },
  inconclusive: { label: 'open', tone: 'is-amber' },
  stopped: { label: 'stopped', tone: 'is-skipped' },
  unknown: { label: '?', tone: 'is-skipped' },
};

function Tests({ rows, now }: { rows: SprtRow[]; now: Date }) {
  if (!rows.length) return null;
  return (
    <Section title="Head-to-head tests" count={rows.length}>
      <p className="ld-scale lg-muted">Sequential tests (SPRT): play until “A beats B by at least the margin” (H1) or “by no more than the null” (H0) is decided, or the game limit.</p>
      <ul className="lb-list lg-panel">
        {rows.slice(0, 8).map((r, i) => {
          const chip = RESULT_CHIP[r.result];
          return (
            <li key={i} className="lb-row lb-fin">
              <span className={cx('lg-chip', 'lb-fin-chip', chip.tone)}>{chip.label}</span>
              <span className="lb-row-main">
                <span className="lb-fin-head">
                  <span className="ld-vsline">
                    {r.a} <span className="lg-muted">vs</span> {r.b}
                  </span>
                </span>
                <span className="lb-headline">{sprtVerdict(r)}</span>
                <span className="ld-meta lg-mono">
                  {fmtNum(r.games)} games{r.pairs !== null && ` · ${fmtNum(r.pairs)} deals`}
                  {r.score !== null && ` · ${r.a} scored ${(r.score * 100).toFixed(1)}%`}
                  {r.elo0 !== null && r.elo1 !== null && ` · H0 ${r.elo0} / H1 ${r.elo1} Elo`}
                  {r.purpose === 'league' && ' · league'}
                </span>
              </span>
              <span className="lb-row-end lg-mono" title={r.at ? r.at.toLocaleString() : undefined}>
                {r.at ? formatRelative(r.at, now) : '—'}
              </span>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function Tuner({ rows, now }: { rows: TuneRow[]; now: Date }) {
  if (!rows.length) return null;
  return (
    <Section title="Tuner" count={rows.length}>
      <p className="ld-scale lg-muted">Tuned on the dev deck set. A winner’s score is optimistic (it won a race on noisy scores); it counts only once an SPRT or the league confirms it.</p>
      <ul className="lb-list lg-panel">
        {rows.slice(0, 5).map((t, i) => (
          <li key={i} className="lb-row ld-tune">
            <span className="lb-row-main">
              <span className="lb-fin-head">
                <span className="ld-name-t">{t.base}</span>
                <span className="lb-fin-title">{t.vary.map((v) => `${v.key} ×${v.values.length}`).join(', ') || 'no parameters listed'}</span>
              </span>
              <span className="lb-headline">
                {t.winner ? <>Winner: {t.winner}</> : 'No winner recorded'}
                {t.registeredAs && <span className="lg-muted"> → {t.registeredAs}</span>}
              </span>
              {t.final.length > 0 && (
                <span className="ld-standings">
                  {t.final.slice(0, 3).map((s, k) => (
                    <span key={k} className="ld-standing">
                      <span className="ld-standing-l">{s.label}</span>
                      <span className="lg-mono">
                        {s.wins ?? '—'}–{s.losses ?? '—'} · {fmtPct(s.score)}
                      </span>
                    </span>
                  ))}
                </span>
              )}
              <span className="ld-meta lg-mono">
                {fmtNum(t.games)} games · {t.rounds} round{t.rounds === 1 ? '' : 's'}
                {t.pool.length > 0 && ` · vs ${t.pool.join(', ')}`}
              </span>
            </span>
            <span className="lb-row-end lg-mono">{t.at ? formatRelative(t.at, now) : '—'}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function LeagueView({ ladder: l, now }: { ladder: Ladder; now: Date }) {
  const g = l.league;
  if (!g) return null;
  return (
    <Section title="League">
      <div className="lg-panel ld-league">
        <dl className="lb-stats lb-stats-3 ld-league-stats">
          <div className="lb-stat">
            <dt>Current best</dt>
            <dd>
              <span className="lb-stat-v">{g.best ?? '—'}</span>
            </dd>
          </div>
          <div className="lb-stat ld-span2">
            <dt>Pool</dt>
            <dd>
              <span className="ld-pool">
                {g.pool.length
                  ? g.pool.map((n) => (
                      <span key={n} className="lg-chip">
                        {n}
                      </span>
                    ))
                  : '—'}
              </span>
            </dd>
          </div>
        </dl>
        {g.promoted.length > 0 && (
          <div className="lb-events">
            <div className="lb-events-h">Promoted</div>
            <ul>
              {g.promoted.slice(-8).reverse().map((p, i) => (
                <li key={i}>
                  <span className="lg-mono lb-events-at">{p.at ? formatClock(p.at, now) : '—'}</span>
                  <span>
                    <b className="ld-name-t">{p.name}</b>
                    {p.reason && <span className="lg-muted"> · {p.reason}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Section>
  );
}

function Totals({ ladder: l, now }: { ladder: Ladder; now: Date }) {
  const t = l.totals;
  return (
    <Section title="Games">
      <div className="lg-panel lb-machine">
        <dl className="lb-stats lb-stats-3 ld-totals">
          <div className="lb-stat">
            <dt>Games</dt>
            <dd>
              <span className="lb-stat-v lg-mono">{fmtNum(t.games)}</span>
              {t.draws ? <span className="lb-stat-sub">{fmtNum(t.draws)} drawn, not rated</span> : null}
            </dd>
          </div>
          <div className="lb-stat">
            <dt>Deck set</dt>
            <dd>
              <span className="lb-stat-v">{setLabel(l.set) ?? '—'}</span>
            </dd>
          </div>
          <div className="lb-stat">
            <dt>Last game</dt>
            <dd>
              <span className="lb-stat-v lg-mono">{t.last ? formatRelative(t.last, now) : '—'}</span>
              {t.first && <span className="lb-stat-sub">first {formatClock(t.first, now)}</span>}
            </dd>
          </div>
        </dl>
      </div>
    </Section>
  );
}
