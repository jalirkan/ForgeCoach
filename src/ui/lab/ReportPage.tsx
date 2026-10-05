/*
 * ForgeCoach — ui/lab/ReportPage.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The morning report (#lab/report, #lab/report?since=48h,
 * #lab/report?since=2026-10-04T06:00&src=sample): "Overnight", the jobs that
 * ended since a chosen time (the last 24 h by default), each with what it
 * decides, its verdict against its pre-registered rule (never stronger than
 * the outcome: lab/ledger.ts `entryVerdict`), its headline numbers and what it
 * unlocks next. Reads the runner's public, allowlisted ledger.json from the
 * lab-status branch (lab/ledger.ts), and status.json beside it to say where a
 * follow-up job is now. The summaries are built from the fields, never by a
 * model; "Ask the coach to explain this night" sends a deterministic prompt
 * (ledger.ts `reportPrompt`) through answers.ts `startAnswer`. Every string is
 * rendered as React text.
 */
import '../ledger/ledger.css';
import './lab.css';
import './report.css';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  LEDGER_REFRESH_MS,
  SINCE_PRESETS,
  entriesSince,
  entryName,
  entrySummary,
  entryVerdict,
  fetchLedger,
  fmtMetric,
  followupName,
  followupNow,
  followupWords,
  nightSummary,
  nightTally,
  parseSince,
  rebaseLedger,
  reportHash,
  reportParams,
  reportPrompt,
  ruleWords,
  sinceParam,
  sinceTime,
  windowWords,
  type Ledger,
  type LedgerEntry,
  type Since,
  type SincePreset,
} from '../../lab/ledger.ts';
import { DEFAULT_LAB_SRC, LabFetchError, fetchLabStatus, formatClock, formatRelative, rebaseTimes, type LabSource, type LabStatus } from '../../lab/status.ts';
import { originLabel, type Origin } from '../../lab/source.ts';
import { LedgerShell, Segmented } from '../ledger/Ledger.tsx';
import { AnswerBox } from '../CoachPanel.tsx';
import { startAnswer, stopAnswer, useAnswer } from '../answers.ts';
import { SettingsDialog } from '../SettingsDialog.tsx';
import { cx } from '../util.ts';
import { LabTabs } from './LabTabs.tsx';

interface Good {
  ledger: Ledger;
  fetchedAt: Date;
  origin: Origin;
}

const currentParams = () => reportParams(location.hash, import.meta.env.BASE_URL);

/** The raw `src=` of the hash, to keep it when the window changes. */
const currentSrc = (): string | null => /[?&]src=(.*)$/.exec(location.hash)?.[1] ?? null;

function errorText(e: unknown): string {
  return e instanceof LabFetchError ? e.message : 'Something went wrong reading the ledger file.';
}

const sameSource = (a: LabSource, b: LabSource) => a.kind === b.kind && ('url' in a ? a.url : '') === ('url' in b ? b.url : '');

/** Where status.json is for this source: GitHub's beside the default ledger, the bundled sample beside the sample; none for a custom source. */
function statusUrl(source: LabSource): string | null {
  if (source.kind === 'default') return DEFAULT_LAB_SRC;
  if (source.kind === 'sample') return source.url.replace(/ledger-sample\.json$/, 'lab-sample.json');
  return null;
}

/** A date-time-local input's value for a Date, in local time. */
const localInput = (d: Date) => sinceParam({ kind: 'at', at: d });

export default function ReportPage() {
  const [{ source, since }, setParams] = useState(currentParams);
  const [good, setGood] = useState<Good | null>(null);
  const [status, setStatus] = useState<LabStatus | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [settings, setSettings] = useState(false);
  const lastFetch = useRef(0);
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => {
    const on = () => {
      if (!/^#lab\/report\b/.test(location.hash)) return;
      setParams((prev) => {
        const next = currentParams();
        return sameSource(prev.source, next.source) && sinceParam(prev.since) === sinceParam(next.since) ? prev : next;
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
    const get = (u: string, i?: RequestInit) => fetch(u, i);
    const sUrl = statusUrl(source);
    // status.json only names where follow-ups are now: its failure never hides the report.
    const st = sUrl ? fetchLabStatus(sUrl, { fetch: get, signal: c.signal }).catch(() => null) : Promise.resolve(null);
    try {
      let ledger = await fetchLedger(source.url, { fetch: get, signal: c.signal });
      const at = new Date();
      if (source.kind === 'sample') ledger = rebaseLedger(ledger, at);
      let s = await st;
      if (s && source.kind === 'sample') s = rebaseTimes(s, at);
      if (c.signal.aborted) return;
      setGood({ ledger, fetchedAt: at, origin: source.kind === 'default' ? 'github' : source.kind });
      setStatus(s);
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
    setStatus(null);
    setError(null);
    void load();
    return () => ctrl.current?.abort();
  }, [load]);

  // Every five minutes while visible: jobs end a few times a night.
  useEffect(() => {
    const tick = window.setInterval(() => {
      setNow(new Date());
      if (document.visibilityState === 'visible' && Date.now() - lastFetch.current >= LEDGER_REFRESH_MS - 500) void load();
    }, 30_000);
    const vis = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastFetch.current >= LEDGER_REFRESH_MS) void load();
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

  const setSince = (s: Since) => {
    const h = reportHash(s, currentSrc());
    if (h !== location.hash) location.hash = h;
    setParams((p) => ({ ...p, since: s }));
  };

  const l = good?.ledger ?? null;
  const from = sinceTime(since, now);
  // The window's start moves with the clock for a preset: round it to the minute so the list is stable between ticks.
  const fromMin = new Date(Math.floor(from.getTime() / 60_000) * 60_000);
  const entries = useMemo(() => (l ? entriesSince(l, fromMin, now) : []), [l, fromMin.getTime(), now]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <LedgerShell page="lab">
      <div className="lb-col">
        <LabTabs current="report" />
        <header className="lb-head">
          <div className="lb-head-text">
            <div className="lg-kicker">The PC lab</div>
            <h1 className="lg-title">Overnight</h1>
            {l && (
              <div className={cx('lb-updated', 'lg-mono', error !== null ? 'is-amber' : 'is-fresh')}>
                <span className="lb-dot" aria-hidden="true" />
                {l.generatedAt ? `ledger ${formatRelative(l.generatedAt, now)}` : 'no ledger time'}
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
          <p className="lb-note lb-note-sample">Sample data: every job, rule and number in it is made up, and its times are moved so the newest job ended two hours ago. The real page reads the ledger the runner publishes on the lab-status branch.</p>
        )}

        <SinceBar since={since} from={fromMin} now={now} onChange={setSince} />

        {source.kind === 'invalid' ? (
          <Empty title="That source can’t be used">
            <p>{source.reason}</p>
            <p>
              Use <code>#lab/report</code> for the published ledger, <code>#lab/report?src=sample</code> for the sample, or <code>#lab/report?src=http://…</code> for another
              ledger.json.
            </p>
            <p>
              <a className="lg-btn" href="#lab/report">
                Open the published ledger
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
                <b>Couldn’t refresh.</b> {errorText(error)} Showing the ledger fetched {formatClock(good!.fetchedAt, now)}.
              </div>
            )}
            {l.dropped > 0 && (
              <div className="lb-banner is-amber" role="status">
                <b>
                  {l.dropped} {l.dropped === 1 ? 'item' : 'items'} left out.
                </b>{' '}
                They failed the page’s checks (a missing field, an unknown outcome, or text where only a token may be).
              </div>
            )}
            <Night entries={entries} from={fromMin} now={now} />
            {entries.length > 0 && (
              <section className="lb-section" aria-label="Jobs">
                <ol className="rp-jobs">
                  {entries.map((e) => (
                    <JobCard key={`${e.id}@${e.finished.getTime()}`} e={e} now={now} status={status} />
                  ))}
                </ol>
              </section>
            )}
            {entries.length > 0 && <Coach entries={entries} from={fromMin} now={now} onOpenSettings={() => setSettings(true)} />}
            {entries.length === 0 && l.entries.length > 0 && (
              <p className="rp-older lg-muted">
                The last job in the ledger ended {formatRelative(l.entries.at(-1)!.finished, now)}.{' '}
                <button type="button" className="rp-link" onClick={() => setSince({ kind: 'preset', preset: '7d' })}>
                  Show the last 7 days
                </button>
              </p>
            )}
          </>
        )}

        <footer className="lb-foot lg-muted">
          {source.kind === 'default'
            ? 'From the runner’s public, allowlisted ledger.json on the lab-status branch (schema 1). The private ledger never leaves the lab.'
            : source.kind === 'custom'
              ? `From ${source.url}.`
              : source.kind === 'sample'
                ? 'From the bundled sample.'
                : null}{' '}
          The summaries are built from the ledger’s fields, not written by a model. Refreshes every five minutes while this page is open.
        </footer>
      </div>
      <SettingsDialog open={settings} onClose={() => setSettings(false)} />
    </LedgerShell>
  );
}

// ---------------------------------------------------------------------------

const PRESET_LABEL: Record<SincePreset, string> = { '12h': '12 h', '24h': '24 h', '48h': '48 h', '7d': '7 days' };

function SinceBar({ since, from, now, onChange }: { since: Since; from: Date; now: Date; onChange: (s: Since) => void }) {
  const value = since.kind === 'preset' ? since.preset : 'at';
  return (
    <div className="rp-since">
      <span className="rp-since-label">Since</span>
      <Segmented<SincePreset | 'at'>
        label="Since when"
        value={value}
        options={[...(Object.keys(SINCE_PRESETS) as SincePreset[]).map((p) => ({ value: p, label: PRESET_LABEL[p] })), { value: 'at' as const, label: 'a time' }]}
        onChange={(v) => onChange(v === 'at' ? { kind: 'at', at: from } : { kind: 'preset', preset: v })}
      />
      {since.kind === 'at' && (
        <input
          className="lg-input rp-since-at"
          type="datetime-local"
          aria-label="Since this time"
          value={localInput(since.at)}
          max={localInput(now)}
          onChange={(ev) => {
            const s = parseSince(ev.target.value);
            if (s.kind === 'at') onChange(s);
          }}
        />
      )}
    </div>
  );
}

function Night({ entries, from, now }: { entries: LedgerEntry[]; from: Date; now: Date }) {
  const t = nightTally(entries);
  return (
    <section className="lb-section rp-night" aria-label="The night">
      <p className="rp-summary">{nightSummary(entries, from, now)}</p>
      {entries.length > 0 && (
        <dl className="rp-tally">
          <div className="is-pass">
            <dt>Pass</dt>
            <dd className="lg-mono">{t.pass}</dd>
          </div>
          <div className="is-fail">
            <dt>Fail</dt>
            <dd className="lg-mono">{t.fail}</dd>
          </div>
          <div className="is-none">
            <dt>No verdict</dt>
            <dd className="lg-mono">{t.none}</dd>
          </div>
          <div>
            <dt>Ready to post</dt>
            <dd className="lg-mono">{t.ready}</dd>
          </div>
        </dl>
      )}
      <p className="rp-hint lg-muted">
        Pass means the job ran to the end and every check written before the run held; whether that settles the decision is its rule’s call, in the morning read. Fail
        means a pre-registered check failed. Anything else — aborted, timed out, an error, or no checks — is no verdict. Since {formatClock(from, now)} ({windowWords(from, now)}).
      </p>
    </section>
  );
}

function JobCard({ e, now, status }: { e: LedgerEntry; now: Date; status: LabStatus | null }) {
  const v = entryVerdict(e);
  return (
    <li className={cx('rp-job lg-panel', `is-${v.kind}`)}>
      <div className="rp-job-head">
        <span className={cx('lg-chip rp-chip', `is-${v.kind}`)}>{v.label}</span>
        <span className="lb-id lg-mono">{e.id}</span>
        {e.title && <span className="rp-title">{e.title}</span>}
        <span className="rp-when lg-mono" title={e.finished.toLocaleString()}>
          {formatRelative(e.finished, now)}
        </span>
      </div>
      <dl className="rp-facts">
        <div>
          <dt>Decides</dt>
          <dd className={cx(!e.decides && 'lg-muted')}>{e.decides ?? 'not public'}</dd>
        </div>
        <div>
          <dt>Rule</dt>
          <dd className={cx(!e.rule && 'lg-muted', e.rule && 'lg-mono')}>{ruleWords(e)}</dd>
        </div>
        <div>
          <dt>Verdict</dt>
          <dd>{v.why}</dd>
        </div>
      </dl>
      {e.headline.length > 0 && (
        <ul className="rp-nums" aria-label="Headline numbers">
          {e.headline.map((m) => (
            <li key={m.key}>
              <span className="rp-num-v lg-mono">{fmtMetric(m.value)}</span>
              <span className="rp-num-k lg-mono">{m.key}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="rp-next">
        <h3 className="rp-next-h">Unlocks next</h3>
        {e.followups.length ? (
          <ul>
            {e.followups.map((f, i) => {
              const where = followupNow(f, status);
              return (
                <li key={i} className={cx('rp-fu', `is-${f.state}`)}>
                  <span className="rp-fu-name lg-mono">{followupName(f)}</span>
                  <span className="rp-fu-state">{followupWords(f)}</span>
                  {where && <span className="rp-fu-now">now: {where}</span>}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="lg-muted">{e.outcome === 'done' ? 'No follow-up was promised.' : 'Nothing: a job that does not finish unlocks no follow-up.'}</p>
        )}
      </div>
      <p className="rp-plain">{entrySummary(e)}</p>
    </li>
  );
}

function Coach({ entries, from, now, onOpenSettings }: { entries: LedgerEntry[]; from: Date; now: Date; onOpenSettings: () => void }) {
  // One answer per set of jobs: a job more or less is another question (the window moves with the clock).
  const key = `lab-report:${entries.map((e) => `${e.id}@${e.finished.getTime()}`).join(',')}`;
  const answer = useAnswer(key);
  const makePrompt = useCallback(async () => reportPrompt(entries, from, now), [entries, from.getTime(), now]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="lb-section rp-coach" aria-label="Coach">
      <AnswerBox
        answer={answer}
        askLabel="Ask the coach to explain this night"
        idleText={`The coach explains ${entryName(entries[0]!)}${entries.length > 1 ? ` and the other ${entries.length - 1}` : ''} from the ledger’s fields alone, keeping every verdict as it is.`}
        onAsk={() => void startAnswer(key, makePrompt)}
        onStop={() => stopAnswer(key)}
        makePrompt={makePrompt}
        onOpenSettings={onOpenSettings}
      />
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
    <Empty title={notFound ? 'No ledger yet' : 'Couldn’t read the ledger'}>
      {notFound ? (
        <p>The runner hasn’t published a ledger.json yet. Once a job ends and the runner reports to the lab-status branch, the night shows here.</p>
      ) : (
        <p>{errorText(error)} The network may be down; it tries again every five minutes.</p>
      )}
      <p>
        <button type="button" className="lg-btn" onClick={onRetry}>
          Try again
        </button>{' '}
        <a className="lg-btn" href="#lab/report?src=sample">
          See the sample
        </a>
      </p>
    </Empty>
  );
}
