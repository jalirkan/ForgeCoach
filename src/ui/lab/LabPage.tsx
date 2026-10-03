/*
 * ForgeCoach — ui/lab/LabPage.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The lab progress page (#lab, #lab?src=sample, #lab?src=<http(s) URL>):
 * what the PC runner is doing — running jobs with progress, ETA and workers,
 * the queue, waiting and finished jobs, the machine's load and memory, and
 * how stale it all is. Reads the runner's status.json (lab/status.ts),
 * refreshes every minute while visible and keeps the last good data when a
 * refresh fails. Every string from the file is rendered as React text only.
 */
import '../ledger/ledger.css';
import './lab.css';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  LabFetchError,
  REFRESH_MS,
  fetchLabStatus,
  fmtNum,
  formatClock,
  formatDuration,
  formatRelative,
  isEmptyStatus,
  jobEta,
  labSource,
  memFraction,
  pressureLevel,
  rebaseTimes,
  staleness,
  updatedLine,
  type FinishedJob,
  type LabSource,
  type LabStatus,
  type RunningJob,
} from '../../lab/status.ts';
import { LedgerShell } from '../ledger/Ledger.tsx';
import { cx } from '../util.ts';
import { LabTabs } from './LabTabs.tsx';

/** The schema this page was written for; a newer file still renders, with a note. */
const KNOWN_SCHEMA = 1;

interface Good {
  status: LabStatus;
  fetchedAt: Date;
}

function currentSource(): LabSource {
  return labSource(location.hash, import.meta.env.BASE_URL);
}

function errorText(e: unknown, offline: boolean): string {
  if (offline) return 'You are offline.';
  if (e instanceof LabFetchError) return e.message;
  return 'Something went wrong reading the status file.';
}

export default function LabPage() {
  const [source, setSource] = useState<LabSource>(currentSource);
  const [good, setGood] = useState<Good | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);
  const lastFetch = useRef(0);
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => {
    const on = () => {
      if (!/^#lab\b/.test(location.hash)) return;
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
      let status = await fetchLabStatus(source.url, { fetch: (u, i) => fetch(u, i), signal: c.signal });
      const at = new Date();
      if (source.kind === 'sample') status = rebaseTimes(status, at);
      if (c.signal.aborted) return;
      setGood({ status, fetchedAt: at });
      setError(null);
      setOffline(false);
    } catch (e) {
      if (c.signal.aborted) return;
      setError(e);
      if (typeof navigator !== 'undefined' && navigator.onLine === false) setOffline(true);
    } finally {
      if (ctrl.current === c) setBusy(false);
      setNow(new Date());
    }
  }, [source]);

  // A new source starts clean.
  useEffect(() => {
    setGood(null);
    setError(null);
    void load();
    return () => ctrl.current?.abort();
  }, [load]);

  // Every minute while the page is visible; at once when it comes back after a minute away.
  useEffect(() => {
    const tick = window.setInterval(() => {
      setNow(new Date());
      if (document.visibilityState === 'visible' && Date.now() - lastFetch.current >= REFRESH_MS - 500) void load();
    }, 15_000);
    const vis = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastFetch.current >= REFRESH_MS) void load();
      setNow(new Date());
    };
    const online = () => {
      setOffline(false);
      void load();
    };
    const offlineEv = () => setOffline(true);
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('online', online);
    window.addEventListener('offline', offlineEv);
    return () => {
      window.clearInterval(tick);
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offlineEv);
    };
  }, [load]);

  const s = good?.status ?? null;
  const stale = staleness(s?.updated ?? null, now);
  const failed = error !== null || offline;

  return (
    <LedgerShell page="lab">
      <div className="lb-col">
        <LabTabs current="progress" />
        <header className="lb-head">
          <div className="lb-head-text">
            <div className="lg-kicker">The PC lab</div>
            <h1 className="lg-title">Lab progress</h1>
            {s && (
              <div className={cx('lb-updated', 'lg-mono', `is-${failed ? (stale.level === 'fresh' ? 'amber' : stale.level) : stale.level}`)}>
                <span className="lb-dot" aria-hidden="true" />
                {updatedLine(s.updated, now)}
                {s.updated && <span className="lg-muted"> · {formatClock(s.updated, now)}</span>}
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

        {source.kind === 'sample' && <p className="lb-note lb-note-sample">Sample data, with its times moved to now. The real page reads the runner’s status on the lab-status branch.</p>}

        {source.kind === 'invalid' ? (
          <Empty title="That source can’t be used">
            <p>{source.reason}</p>
            <p>
              Use <code>#lab</code> for the runner’s published status, <code>#lab?src=sample</code> for the sample, or <code>#lab?src=http://…</code> for another
              status.json.
            </p>
            <p>
              <a className="lg-btn" href="#lab">
                Open the runner’s status
              </a>
            </p>
          </Empty>
        ) : !s ? (
          error !== null || offline ? (
            <FirstError error={error} offline={offline} onRetry={() => void load()} />
          ) : (
            <div className="lb-loading">
              <span className="spinner spinner-lg" />
            </div>
          )
        ) : (
          <>
            {failed && (
              <div className="lb-banner is-error" role="status">
                <b>{offline ? 'Offline.' : 'Couldn’t refresh.'}</b> {offline ? 'It will try again when you are back online.' : errorText(error, false)} Showing the last good data,
                fetched {formatClock(good!.fetchedAt, now)}.
              </div>
            )}
            {stale.level === 'red' && (
              <div className="lb-banner is-red" role="status">
                <b>No update for {formatDuration(stale.ageS)}.</b> The runner may be down.
              </div>
            )}
            {stale.level === 'amber' && (
              <div className="lb-banner is-amber" role="status">
                <b>No update for {formatDuration(stale.ageS)}.</b> Later than usual; the runner may be down if this keeps growing.
              </div>
            )}
            {stale.level === 'unknown' && <div className="lb-banner is-amber">The status file has no update time, so its age is unknown.</div>}
            {s.paused && (
              <div className="lb-banner is-paused">
                <b>The runner is paused.</b> It holds after the current game until resumed.
              </div>
            )}
            {s.schema !== null && s.schema > KNOWN_SCHEMA && <p className="lb-note">This status file is schema {s.schema}; the page knows {KNOWN_SCHEMA}. Some new fields may not show.</p>}

            <div className={cx('lb-body', (failed || stale.level === 'red') && 'is-stale')}>
              {isEmptyStatus(s) && (
                <Empty title="The lab is idle">
                  <p>Nothing is running, queued or finished yet. New jobs show here as soon as the runner picks them up.</p>
                </Empty>
              )}

              {s.running.length > 0 && (
                <Section title={s.running.length > 1 ? 'Running' : 'Running now'} count={s.running.length > 1 ? s.running.length : undefined}>
                  {s.running.map((j, i) => (
                    <RunningCard key={`${j.id}-${i}`} job={j} updated={s.updated} now={now} />
                  ))}
                </Section>
              )}

              {s.queue.length > 0 && (
                <Section title="Queue" count={s.queue.length}>
                  <ol className="lb-list lg-panel">
                    {s.queue.map((q, i) => (
                      <li key={`${q.id}-${i}`} className="lb-row">
                        <span className="lb-id lg-mono">{q.id}</span>
                        <span className="lb-row-main">{q.title ?? '—'}</span>
                        <span className="lb-row-end lg-mono">{q.est ?? '—'}</span>
                      </li>
                    ))}
                  </ol>
                </Section>
              )}

              {s.waiting.length > 0 && (
                <Section title="Waiting" count={s.waiting.length}>
                  <ul className="lb-list lg-panel">
                    {s.waiting.map((w, i) => (
                      <li key={`${w.id}-${i}`} className="lb-row">
                        <span className="lb-id lg-mono">{w.id}</span>
                        <span className="lb-row-main">
                          {w.title ?? '—'}
                          <span className="lb-reason">{w.reason ?? 'no reason given'}</span>
                        </span>
                        {w.est && <span className="lb-row-end lg-mono">{w.est}</span>}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {s.finished.length > 0 && (
                <Section title="Finished" count={s.finished.length}>
                  <ul className="lb-list lg-panel">
                    {s.finished.map((f, i) => (
                      <FinishedRow key={`${f.id}-${i}`} job={f} now={now} />
                    ))}
                  </ul>
                </Section>
              )}

              <Machine status={s} now={now} />
            </div>
          </>
        )}

        <footer className="lb-foot lg-muted">
          {source.kind === 'default'
            ? 'From the runner’s numbers-only status on the lab-status branch.'
            : source.kind === 'custom'
              ? `From ${source.url}.`
              : source.kind === 'sample'
                ? 'From the bundled sample.'
                : null}{' '}
          Refreshes every minute while this page is open.
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

function FirstError({ error, offline, onRetry }: { error: unknown; offline: boolean; onRetry: () => void }) {
  const kind = error instanceof LabFetchError ? error.kind : null;
  return (
    <Empty title={offline ? 'You’re offline' : kind === 'notFound' ? 'No status yet' : 'Couldn’t read the lab status'}>
      {offline ? (
        <p>The page will load the lab status when the connection is back.</p>
      ) : kind === 'notFound' ? (
        <p>The runner hasn’t published a status file yet. Once it pushes to the lab-status branch, it shows here.</p>
      ) : (
        <p>{errorText(error, false)} The runner or the network may be down; it will try again every minute.</p>
      )}
      <p>
        <button type="button" className="lg-btn" onClick={onRetry}>
          Try again
        </button>{' '}
        <a className="lg-btn" href="#lab?src=sample">
          See the sample
        </a>
      </p>
    </Empty>
  );
}

function Bar({ fraction, label, tone }: { fraction: number | null; label: string; tone?: 'gold' | 'amber' | 'red' | 'muted' }) {
  const pct = fraction === null ? 0 : Math.round(fraction * 1000) / 10;
  return (
    <div
      className={cx('lb-bar', tone && `is-${tone}`, fraction === null && 'is-unknown')}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={fraction === null ? undefined : pct}
    >
      <span className="lb-bar-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'bad' | 'ok' | 'amber' }) {
  return (
    <div className={cx('lb-stat', tone && `is-${tone}`)}>
      <dt>{label}</dt>
      <dd>
        <span className="lb-stat-v lg-mono">{value}</span>
        {sub && <span className="lb-stat-sub">{sub}</span>}
      </dd>
    </div>
  );
}

function RunningCard({ job: j, updated, now }: { job: RunningJob; updated: Date | null; now: Date }) {
  const eta = jobEta(j, updated);
  const pct = j.fraction === null ? null : `${(j.fraction * 100).toFixed(j.fraction < 0.1 ? 1 : 0)} %`;
  return (
    <article className={cx('lb-job lg-panel', j.paused && 'is-paused')}>
      <div className="lb-job-top">
        <span className="lb-id lg-mono">{j.id}</span>
        {j.paused && <span className="lg-chip lb-chip-paused">Paused</span>}
        {j.phase && <span className="lb-phase">{j.phase}</span>}
      </div>
      <h3 className="lb-job-title">{j.title ?? '—'}</h3>
      <Bar fraction={j.fraction} label={`${j.id} progress`} tone={j.paused ? 'muted' : 'gold'} />
      <div className="lb-progress lg-mono">
        <span>
          <b>{fmtNum(j.done)}</b> / {fmtNum(j.total)} {j.unit ?? ''}
        </span>
        <span>{pct ?? '—'}</span>
      </div>
      <dl className="lb-stats">
        <Stat label="Rate" value={j.ratePerHour === null ? '—' : `${fmtNum(j.ratePerHour, j.ratePerHour < 10 ? 1 : 0)} / h`} />
        <Stat
          label={eta?.derived ? 'ETA (est.)' : 'ETA'}
          value={eta ? formatClock(eta.at, now) : (j.etaText ?? '—')}
          sub={eta ? (eta.at.getTime() < now.getTime() - 60_000 ? `due ${formatRelative(eta.at, now)}` : formatRelative(eta.at, now)) : undefined}
        />
        <Stat label="Elapsed" value={j.elapsedS !== null ? formatDuration(j.elapsedS) : (j.elapsedText ?? '—')} sub={j.started ? `since ${formatClock(j.started, now)}` : undefined} />
        <Stat label="Workers" value={fmtNum(j.workers)} />
        <Stat label="Errors" value={fmtNum(j.errors)} tone={j.errors ? 'bad' : undefined} />
      </dl>
    </article>
  );
}

const KIND_LABEL: Record<FinishedJob['kind'], string> = { done: 'Done', failed: 'Failed', skipped: 'Skipped', other: '' };

function FinishedRow({ job: f, now }: { job: FinishedJob; now: Date }) {
  return (
    <li className="lb-row lb-fin">
      <span className={cx('lg-chip', 'lb-fin-chip', `is-${f.kind}`)}>{KIND_LABEL[f.kind] || f.status || '—'}</span>
      <span className="lb-row-main">
        <span className="lb-fin-head">
          <span className="lb-id lg-mono">{f.id}</span>
          {f.title && <span className="lb-fin-title">{f.title}</span>}
        </span>
        <span className="lb-headline">{f.headline ?? '—'}</span>
      </span>
      <span className="lb-row-end lg-mono" title={f.finished ? f.finished.toLocaleString() : undefined}>
        {f.finished ? formatRelative(f.finished, now) : '—'}
      </span>
    </li>
  );
}

function Machine({ status: s, now }: { status: LabStatus; now: Date }) {
  const h = s.host;
  const mem = memFraction(h);
  const pl = pressureLevel(h?.pressure ?? null);
  const loadTone = h?.load1 != null && h.cpus ? (h.load1 > h.cpus * 1.25 ? 'bad' : h.load1 > h.cpus ? 'amber' : undefined) : undefined;
  return (
    <Section title="Machine">
      <div className="lb-machine lg-panel">
        <div className="lb-mem">
          <div className="lb-mem-head">
            <span className="lb-mem-label">Memory</span>
            <span className="lg-mono">
              {fmtNum(h?.memUsedGb ?? null, 1)} / {fmtNum(h?.memTotalGb ?? null, 0)} GB
              {mem !== null && <span className="lg-muted"> · {Math.round(mem * 100)} %</span>}
            </span>
          </div>
          <Bar fraction={mem} label="Memory used" tone={mem !== null && mem >= 0.9 ? 'red' : mem !== null && mem >= 0.75 ? 'amber' : 'gold'} />
        </div>
        <dl className="lb-stats lb-stats-3">
          <Stat label="Load (1 min)" value={fmtNum(h?.load1 ?? null, 1)} sub={h?.cpus ? `of ${h.cpus} threads` : undefined} tone={loadTone} />
          <Stat label="Swap" value={h?.swapUsedMb == null ? '—' : h.swapUsedMb >= 1024 ? `${fmtNum(h.swapUsedMb / 1024, 1)} GB` : `${fmtNum(h.swapUsedMb)} MB`} tone={h?.swapUsedMb ? 'amber' : undefined} />
          <Stat
            label="Pressure"
            value={h?.pressure == null ? '—' : `${fmtNum(h.pressure, 1)} %`}
            sub={pl ?? undefined}
            tone={pl === 'high' ? 'bad' : pl === 'elevated' ? 'amber' : undefined}
          />
        </dl>
        {s.pressureEvents.length > 0 && (
          <div className="lb-events">
            <div className="lb-events-h">Recent pressure events</div>
            <ul>
              {s.pressureEvents.slice(0, 8).map((e, i) => (
                <li key={i}>
                  <span className="lg-mono lb-events-at">{e.at ? formatClock(e.at, now) : (e.atText ?? '—')}</span>
                  <span>{e.action}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Section>
  );
}
