/*
 * ForgeCoach — ui/history/HistoryApp.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * "Your record" (#history): every game played against Forge in ForgeCoach,
 * as a player profile — record tiles, recent form, results by deck and by
 * AI profile with a recent-results strip, and the match log. A row whose
 * frame log was kept opens in the review screen. Data: history/record.ts.
 */
import './history.css';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  breakdown,
  formatWhen,
  historyKV,
  loadHistory,
  recentForm,
  summarize,
  type BreakdownKey,
  type GameRecord,
  type GameResult,
} from '../../history/record.ts';
import { cubeInfo } from '../../cube/cubes.ts';
import { parseLog, type GameLog } from '../../log.ts';
import { GameView } from '../GameView.tsx';
import { SettingsDialog } from '../SettingsDialog.tsx';
import { LedgerShell, Segmented } from '../ledger/Ledger.tsx';
import { cx } from '../util.ts';

const PAGE = 20;

const RESULT_LABEL: Record<GameResult, string> = { win: 'Won', loss: 'Lost', draw: 'Draw' };
const RESULT_LETTER: Record<GameResult, string> = { win: 'W', loss: 'L', draw: 'D' };

export default function HistoryApp() {
  const [recs, setRecs] = useState<GameRecord[] | null>(null);
  const [by, setBy] = useState<BreakdownKey>('yourDeck');
  const [page, setPage] = useState(0);
  const [review, setReview] = useState<{ log: GameLog; title: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);

  useEffect(() => {
    let live = true;
    loadHistory().then((r) => live && setRecs(r));
    return () => {
      live = false;
    };
  }, []);

  const sum = useMemo(() => summarize(recs ?? []), [recs]);
  const form = useMemo(() => recentForm(recs ?? [], 10), [recs]);
  const rows = useMemo(() => breakdown(recs ?? [], by, by === 'yourDeck' ? 'Unnamed deck' : 'Not recorded'), [recs, by]);

  const open = async (r: GameRecord) => {
    if (!r.hasLog) return;
    setError(null);
    try {
      const text = await historyKV().getLog(r.id);
      if (!text) throw new Error('The log for this game is no longer stored.');
      setReview({ log: parseLog(text), title: `Review · vs ${r.aiDeck ?? 'Forge'}` });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (review) {
    return (
      <>
        <GameView
          key={review.title}
          log={review.log}
          title={review.title}
          live={null}
          initialDecision={null}
          initialTab="review"
          onClose={() => setReview(null)}
          closeLabel="Back to your record"
          onSettings={() => setSettings(true)}
        />
        <SettingsDialog open={settings} onClose={() => setSettings(false)} />
      </>
    );
  }

  const first = recs?.length ? recs[recs.length - 1]! : null;
  const last = recs?.length ? recs[0]! : null;
  const shown = (recs ?? []).slice(page * PAGE, page * PAGE + PAGE);
  const pages = Math.ceil((recs?.length ?? 0) / PAGE);

  return (
    <LedgerShell page="history">
      <div className="hs-col">
        <header className="hs-head">
          <span className="hs-avatar hs-avatar-lg" aria-hidden="true">
            Y
          </span>
          <div>
            <div className="lg-kicker">Player</div>
            <h1 className="lg-title hs-name">Your record</h1>
            <div className="hs-since lg-mono">
              {first && last
                ? `First game ${formatWhen(first.date).split(' · ')[0]} · last played ${ago(last.date)}`
                : 'Games you play against Forge in ForgeCoach land here.'}
            </div>
          </div>
        </header>

        {recs === null ? (
          <div className="hs-loading">
            <span className="spinner spinner-lg" />
          </div>
        ) : recs.length === 0 ? (
          <section className="hs-empty">
            <p>
              <i>No games on record yet.</i>
            </p>
            <p className="lg-muted">
              Every game you finish with <b>Play vs Forge</b> is recorded here — your deck, the AI’s deck and profile, the result and the turns — with the
              log kept so you can open its review later. Everything stays in this browser.
            </p>
            <a className="lg-btn" href="#">
              Play a game
            </a>
          </section>
        ) : (
          <>
            <Section title="Record">
              <div className="hs-tiles">
                <Tile label="Matches" value={String(sum.matches)} />
                <Tile
                  label="Record"
                  value={
                    <>
                      <span className="hs-w">{sum.wins}</span>–<span className="hs-l">{sum.losses}</span>–<span>{sum.draws}</span>
                    </>
                  }
                />
                <Tile label="Win rate" value={<span className="hs-gold">{sum.winRate === null ? '—' : `${Math.round(sum.winRate * 100)}%`}</span>} />
                <Tile label="Win streak" value={String(sum.streak)} note={`Best ${sum.bestStreak}`} />
              </div>
              <div className="hs-form">
                <span className="hs-form-label">Recent form</span>
                <span className="hs-form-chips" aria-label={`Recent form, oldest first: ${form.map((r) => RESULT_LETTER[r]).join(' ')}`}>
                  {form.map((r, i) => (
                    <span key={i} className={cx('hs-fchip', `hs-fchip-${r}`)}>
                      {RESULT_LETTER[r]}
                    </span>
                  ))}
                </span>
              </div>
            </Section>

            <Section
              title="Breakdown"
              aside={
                <Segmented<BreakdownKey>
                  label="Group by"
                  value={by}
                  onChange={setBy}
                  options={[
                    { value: 'yourDeck', label: 'Your deck' },
                    { value: 'aiProfile', label: 'AI profile' },
                    { value: 'aiDeck', label: 'AI deck' },
                  ]}
                />
              }
            >
              <div className="hs-table-wrap">
                <table className="lg-table hs-table">
                  <thead>
                    <tr>
                      <th className="num hs-rank hs-hide-sm">#</th>
                      <th>{by === 'yourDeck' ? 'Your deck' : by === 'aiProfile' ? 'AI profile' : 'AI deck'}</th>
                      <th className="num hs-hide-sm">Played</th>
                      <th>W–L–D</th>
                      <th className="num hs-hide-sm">Win</th>
                      <th>Recent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={r.key}>
                        <td className="num hs-rank lg-mono hs-hide-sm">{i + 1}</td>
                        <td>
                          <span className="lg-name">
                            <span className="hs-avatar hs-hide-sm" aria-hidden="true">
                              {initial(r.key)}
                            </span>
                            <span className="hs-key">{r.key}</span>
                          </span>
                        </td>
                        <td className="num hs-score hs-hide-sm">{r.matches}</td>
                        <td className="lg-mono hs-wld">
                          {r.wins}–{r.losses}–{r.draws}
                        </td>
                        <td className="num lg-mono hs-hide-sm">{r.winRate === null ? '—' : `${Math.round(r.winRate * 100)}%`}</td>
                        <td>
                          <BarStrip results={r.recent} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>

            <Section title={`Match log · ${shown.length} shown`}>
              {error && (
                <p className="hs-error" role="alert">
                  {error}
                </p>
              )}
              <ol className="hs-log">
                {shown.map((r) => (
                  <MatchRow key={r.id} r={r} onOpen={() => void open(r)} />
                ))}
              </ol>
              <div className="hs-pager">
                <button type="button" className="lg-btn" disabled={page === 0} onClick={() => setPage(page - 1)}>
                  Newer matches
                </button>
                <span className="lg-mono lg-muted">{recs.length} total</span>
                <button type="button" className="lg-btn" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
                  Older matches
                </button>
              </div>
            </Section>
          </>
        )}
      </div>
    </LedgerShell>
  );
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="hs-section">
      <div className="hs-section-head">
        <h2 className="hs-kicker">{title}</h2>
        <span className="hs-rule" />
        {aside}
      </div>
      {children}
    </section>
  );
}

function Tile({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <div className="hs-tile">
      <span className="hs-tile-label">{label}</span>
      <span className="hs-tile-value lg-mono">{value}</span>
      {note && <span className="hs-tile-note">{note}</span>}
    </div>
  );
}

/** Tall green bars for wins, short red for losses, mid grey for draws; oldest first. */
export function BarStrip({ results }: { results: GameResult[] }) {
  return (
    <span className="hs-bars" role="img" aria-label={`Recent, oldest first: ${results.map((r) => RESULT_LETTER[r]).join(' ')}`}>
      {results.map((r, i) => (
        <span key={i} className={cx('hs-bar', `hs-bar-${r}`)} />
      ))}
    </span>
  );
}

function MatchRow({ r, onOpen }: { r: GameRecord; onOpen: () => void }) {
  const cube = r.cubeId ? cubeInfo(r.cubeId) : undefined;
  const body = (
    <>
      <div className="hs-row-top">
        <span className="hs-avatar" aria-hidden="true">
          {initial(r.aiDeck ?? 'F')}
        </span>
        <span className="hs-vs">
          vs <span className="hs-opp">{r.aiDeck ?? 'Forge AI'}</span>
        </span>
        <span className="hs-when lg-mono">{formatWhen(r.date)}</span>
        <span className={cx('lg-chip', r.result === 'win' ? 'lg-chip-win' : r.result === 'loss' ? 'lg-chip-loss' : undefined)}>{RESULT_LABEL[r.result]}</span>
      </div>
      <div className="hs-row-meta lg-mono">
        <span>{r.aiProfile ?? 'Forge AI'}</span>
        {r.turns !== null && <span>{r.turns} turns</span>}
        {r.gameNumber !== null && r.gameCount ? (
          <span>
            Game {r.gameNumber} of {r.gameCount}
          </span>
        ) : null}
        <span>Deck: {r.yourDeck ?? 'unnamed'}</span>
        {cube && <span>{cube.title}</span>}
        {r.reason && <span className="hs-reason">{humanReason(r.reason)}</span>}
        {r.hasLog && <span className="hs-open">Review ›</span>}
      </div>
    </>
  );
  return (
    <li className="hs-row">
      {r.hasLog ? (
        <button type="button" className="hs-row-btn" onClick={onOpen} aria-label={`Review the game vs ${r.aiDeck ?? 'Forge'}, ${RESULT_LABEL[r.result]}`}>
          {body}
        </button>
      ) : (
        <div className="hs-row-btn">{body}</div>
      )}
    </li>
  );
}

function initial(s: string): string {
  return (s.trim().match(/[A-Za-z0-9]/)?.[0] ?? '?').toUpperCase();
}

/** "LifeReachedZero" → "life reached zero". */
function humanReason(reason: string): string {
  return reason
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase();
}

function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const m = Math.round(ms / 60000);
  if (m < 2) return 'just now';
  if (m < 60) return `${m} minutes ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}
