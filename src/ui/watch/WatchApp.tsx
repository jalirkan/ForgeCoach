/*
 * ForgeCoach — ui/watch/WatchApp.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Watch two bots (mtg-table D440, docs/watch-bots.md there): two bots
 * grid-draft a cube, then play a best of three that you watch as it is
 * played. Lazy, on #watch (the form) and #watch/<id> (a watch).
 *
 *   - The form: the cube, who drafts and who plays each side (what the
 *     engine's /health offers: watch/choices.ts), best of, pace, a seed.
 *     Watch posts /watch; a 409 offers the running one or to stop it.
 *   - A watch: GET /watch/<id> every 1.5 s. "Drafting…" until draft.json
 *     comes, then the draft replay (DraftReplay), then each game followed
 *     with live.ts's HTTP follower on /watch/<id>/game/<n> — read-only, never
 *     the seat (CLAUDE.md's seat rule) — with the score from match.json. A
 *     game that starts while the replay runs waits: the log keeps.
 *
 * Every game is drafter A's eyes (match.json `view`): drafter B's hand is
 * hidden as at any table, and the board says whose view it is.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import '../deck/deck.css';
import '../forge-theme.css';
import '../draft/draft.css';
import './watch.css';
import { CUBES, cubeShortName, SHIPPED_CUBES } from '../../cube/cubes.ts';
import { connectLive, type LiveStatus } from '../../live.ts';
import type { GameLog } from '../../log.ts';
import { redactSeatUrl } from '../../play/seatUrl.ts';
import { BEST_OF, canStart, capLine, costLine, costlyPicks, defaultForm, drafterBlock, drafterLabel, PACES, playerLabel, seedOf, watchRequest, type SeatOption, type WatchCaps, type WatchForm } from '../../watch/choices.ts';
import { gameLogUrl, getWatch, listWatches, startWatch, stopWatch, waitIdle, watchCaps } from '../../watch/client.ts';
import { gameToFollow, TERMINAL, type WatchListEntry, type WatchMatch, type WatchSide, type WatchState } from '../../watch/data.ts';
import { atDecks, ReplayClock, replayReducer, startReplay, type ReplayAction, type ReplayState } from '../../watch/replay.ts';
import { GameView, type LiveInfo } from '../GameView.tsx';
import { IconChevronLeft } from '../Icons.tsx';
import { SettingsDialog } from '../SettingsDialog.tsx';
import { cx } from '../util.ts';
import { DraftReplay } from './DraftReplay.tsx';
import { nav } from '../nav.ts';

const POLL_MS = 1500;
const NEXT_GAME_MS = 6000;

const idFromHash = (h: string): string | null => {
  const m = /^#watch\/(watch-[A-Za-z0-9._-]{1,120})$/.exec(h);
  return m ? m[1]! : null;
};

export default function WatchApp({ onExit }: { onExit: () => void }) {
  const [hash, setHash] = useState(() => location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const [settings, setSettings] = useState(false);
  const id = idFromHash(hash);
  return (
    <>
      {id ? (
        <WatchRun key={id} id={id} onBack={() => nav().up()} onSettings={() => setSettings(true)} />
      ) : (
        <WatchSetup onExit={onExit} onOpen={(w) => nav().go(`#watch/${w}`)} />
      )}
      <SettingsDialog open={settings} onClose={() => setSettings(false)} />
    </>
  );
}

// ---------------------------------------------------------------------------
// The form

function Chips({ options, value, onPick, label, blocked }: { options: SeatOption[]; value: string; onPick: (id: string) => void; label: string; blocked?: (id: string) => string | null }) {
  const shown = options.find((o) => o.id === value) ?? options[0];
  const why = blocked ? options.map((o) => (o.id === value ? null : blocked(o.id))).find((x) => x) ?? null : null;
  return (
    <div className="wb-field">
      <div className="fx-label sub-h">{label}</div>
      <div className="wb-chips" role="radiogroup" aria-label={label}>
        {options.map((o) => {
          const no = o.id === value ? null : (blocked?.(o.id) ?? null);
          return (
            <button key={o.id} type="button" role="radio" aria-checked={o.id === value} className={cx('wb-chip', o.id === value && 'is-on', o.costly && 'is-costly')} onClick={() => onPick(o.id)} disabled={!!no} title={no ?? undefined} data-unavailable={no ? '' : undefined}>
              {o.label}
              {o.costly && <span className="wb-cost-mark" aria-label="costs money"> $</span>}
            </button>
          );
        })}
      </div>
      {shown && <p className="tiny muted wb-blurb">{shown.blurb}</p>}
      {why && <p className="tiny muted wb-blurb" data-blocked="">{why}</p>}
    </div>
  );
}

/** Why your own cubes can't be watched on an older engine: POST /watch takes a cube of yours only with `/health` `watchCustom: 1` (mtg-table D444). */
const WATCH_CUSTOM_NOTE = 'Your own cubes can’t be watched with this engine: it deals only the cubes in its own folder. Update mtg-table to watch one of yours.';
const WATCH_CUSTOM_ON = 'Your own cube goes to the engine as its list: no lab ratings, so the lab drafter rates its cards by Forge’s draft ranks.';

/** The picked cube's own title and document when it is one of yours, else null. */
function customOf(cube: string): { title: string; doc: string } | null {
  const c = CUBES.find((x) => x.file === cube);
  return c?.custom ? { title: c.title, doc: c.doc ?? '' } : null;
}

function WatchSetup({ onExit, onOpen }: { onExit: () => void; onOpen: (id: string) => void }) {
  const [caps, setCaps] = useState<WatchCaps | null>(null);
  const [recent, setRecent] = useState<{ running: string | null; watches: WatchListEntry[] } | null>(null);
  const [form, setForm] = useState<WatchForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void watchCaps().then((c) => {
      if (!live) return;
      setCaps(c);
      setForm((f) => f ?? defaultForm(CUBES.find((x) => x.id === 'fair-fight')?.file ?? SHIPPED_CUBES[0]!.file, c));
      if (c.watch) void listWatches().then((l) => live && setRecent(l));
    });
    return () => {
      live = false;
    };
  }, []);
  const set = (p: Partial<WatchForm>) => setForm((f) => (f ? { ...f, ...p } : f));
  const setSide = (k: 'drafter' | 'player', s: WatchSide, v: string) => setForm((f) => (f ? { ...f, [k]: { ...f[k], [s]: v }, costOk: false } : f));

  const start = useCallback(async () => {
    if (!form || !caps) return;
    const r = watchRequest(form, caps, customOf(form.cube));
    if ('problem' in r) {
      setProblem(r.problem);
      return;
    }
    setBusy(true);
    setProblem(null);
    const s = await startWatch(r.body);
    setBusy(false);
    if (s.ok) onOpen(s.id);
    else if (s.busy) setRunning(s.busy);
    else setProblem(s.message);
  }, [form, caps, onOpen]);

  const replace = useCallback(async () => {
    if (!running) return;
    setBusy(true);
    setProblem(null);
    const s = await stopWatch(running);
    if (!s.ok) {
      setBusy(false);
      setProblem(s.message);
      return;
    }
    const idle = await waitIdle();
    setBusy(false);
    if (!idle) {
      setProblem('The running watch hasn’t stopped yet. Try again in a moment.');
      return;
    }
    setRunning(null);
    void start();
  }, [running, start]);

  const head = (
    <>
      <header className="setup-top">
        <button className="link-back" onClick={onExit}>
          <IconChevronLeft size={14} /> Back to the start
        </button>
        <span />
        <span />
      </header>
      <div className="setup-head">
        <div className="fx-label setup-kicker">Watch two bots</div>
        <h1 className="wb-title">Two bots draft a cube, then play a best of three</h1>
        <p className="setup-note wb-lede">For seeing how a cube plays. You watch; nobody needs your input.</p>
      </div>
    </>
  );

  if (!caps || !form) {
    return (
      <div className="fx setup wb">
        {head}
        <p className="setup-note">
          <span className="spinner" /> Asking the engine on your PC…
        </p>
      </div>
    );
  }
  if (!caps.watch) {
    return (
      <div className="fx setup wb">
        {head}
        <div className="launch-result is-bad" role="status">
          <p className="serif-i">Watching two bots needs the engine on your PC, with its bridge built (mtg-table from 16 October 2026 or later). Start ForgeCoach on your PC (the app-menu launcher, or ./scripts/play.sh), then come back.</p>
        </div>
      </div>
    );
  }
  const costly = costlyPicks(form, caps);
  const seed = seedOf(form.seed);
  const custom = customOf(form.cube);
  const ok = canStart(form, caps, custom);
  const request = watchRequest(form, caps, custom);
  // A problem the player can't fix from the side panels (a cube too big, an older engine): said under the cube.
  const cubeProblem = custom && 'problem' in request && !/^Tick the box|^Pick who|^One side/.test(request.problem) ? request.problem : null;
  const cap = capLine(caps.llmCap);
  const runningNow = recent?.running ?? caps.running;
  const finished = (recent?.watches ?? []).filter((w) => w.id !== runningNow).slice(0, 6);
  return (
    <div className="fx setup wb">
      {head}
      {runningNow && !running && (
        <div className="resume">
          <div>
            <div className="fx-label">A watch is running</div>
            <div className="resume-t">{watchTitle(recent?.watches.find((w) => w.id === runningNow), runningNow)}</div>
          </div>
          <div className="resume-btns">
            <button className="btn-gold" onClick={() => onOpen(runningNow)}>
              Rejoin it
            </button>
          </div>
        </div>
      )}
      <div className="setup-grid wb-setup">
        <section className="panel">
          <div className="fx-label panel-h">Cube</div>
          <div className="wb-chips is-cubes" role="radiogroup" aria-label="Cube">
            {/* A deck you own (cubes.ts kind: 'deck') is not on mtg-table's side to draft. */}
            {CUBES.filter((c) => !c.custom && c.kind !== 'deck').map((c) => (
              <button key={c.id} type="button" role="radio" aria-checked={form.cube === c.file} className={cx('wb-chip', form.cube === c.file && 'is-on')} onClick={() => set({ cube: c.file })}>
                {cubeShortName(c)}
              </button>
            ))}
            {CUBES.filter((c) => c.custom).map((c) =>
              caps.custom ? (
                <button key={c.id} type="button" role="radio" aria-checked={form.cube === c.file} className={cx('wb-chip', form.cube === c.file && 'is-on')} onClick={() => set({ cube: c.file })} data-custom="">
                  {cubeShortName(c)}
                </button>
              ) : (
                <button key={c.id} type="button" role="radio" aria-checked={false} className="wb-chip" disabled title={WATCH_CUSTOM_NOTE} data-unavailable="">
                  {cubeShortName(c)}
                </button>
              ),
            )}
          </div>
          {CUBES.some((c) => c.custom) && !caps.custom && <p className="tiny muted wb-blurb">{WATCH_CUSTOM_NOTE}</p>}
          {custom && <p className="tiny muted wb-blurb">{WATCH_CUSTOM_ON}</p>}
          {cubeProblem && <p className="tiny wb-bad">{cubeProblem}</p>}
          <p className="tiny muted wb-blurb">{CUBES.find((c) => c.file === form.cube)?.blurb} 18 grids of 9, the first pick alternating.</p>
          <div className="wb-row">
            <div className="wb-field">
              <div className="fx-label sub-h">Best of</div>
              <div className="wb-chips" role="radiogroup" aria-label="Best of">
                {BEST_OF.map((n) => (
                  <button key={n} type="button" role="radio" aria-checked={form.bestOf === n} className={cx('wb-chip', form.bestOf === n && 'is-on')} onClick={() => set({ bestOf: n })}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <label className="wb-field wb-seed">
              <div className="fx-label sub-h">Seed (optional)</div>
              <input inputMode="numeric" value={form.seed} onChange={(e) => set({ seed: e.target.value })} placeholder="random" aria-label="Seed" maxLength={9} />
            </label>
          </div>
          {'problem' in seed && <p className="tiny wb-bad">{seed.problem}</p>}
          <p className="tiny muted wb-blurb">The same cube and seed draft the same picks and decks.</p>
          <div className="wb-field">
            <div className="fx-label sub-h">Pace</div>
            <div className="wb-chips" role="radiogroup" aria-label="Pace">
              {PACES.map((p) => (
                <button key={p.ms} type="button" role="radio" aria-checked={form.paceMs === p.ms} className={cx('wb-chip', form.paceMs === p.ms && 'is-on')} onClick={() => set({ paceMs: p.ms })}>
                  {p.label}
                </button>
              ))}
            </div>
            <p className="tiny muted wb-blurb">{PACES.find((p) => p.ms === form.paceMs)?.blurb}</p>
          </div>
        </section>
        {(['A', 'B'] as const).map((s) => (
          <section key={s} className={cx('panel wb-side', s === 'A' ? 'is-a' : 'is-b')} data-side={s}>
            <div className="fx-label panel-h">
              Drafter {s}
              {s === 'A' && <span className="wb-eyes"> · you watch the games from this side</span>}
            </div>
            {caps.drafters.length > 1 ? (
              <Chips label="Drafts with" options={caps.drafters} value={form.drafter[s]} onPick={(v) => setSide('drafter', s, v)} blocked={(id) => drafterBlock(form, s, id)} />
            ) : (
              <div className="wb-field">
                <div className="fx-label sub-h">Drafts with</div>
                <p className="wb-fixed">{caps.drafters[0]!.label}</p>
                <p className="tiny muted wb-blurb">{caps.drafters[0]!.blurb} The engine on your PC drafts both sides this way.</p>
              </div>
            )}
            <Chips label="Plays with" options={caps.players} value={form.player[s]} onPick={(v) => setSide('player', s, v)} />
          </section>
        ))}
      </div>
      {costly.length > 0 && (
        <div className="wb-costbox" role="note">
          <div className="fx-label">Claude costs money</div>
          <ul>
            {costly.map((o, i) => (
              <li key={`${o.id}-${i}`}>{o.cost}</li>
            ))}
          </ul>
          {cap && <p className="tiny wb-cap">{cap}</p>}
          <label className="wb-confirm">
            <input type="checkbox" checked={form.costOk} onChange={(e) => set({ costOk: e.target.checked })} /> I accept the cost of this watch.
          </label>
        </div>
      )}
      {running && (
        <div className="launch-result is-bad" role="status">
          <p className="serif-i">Another watch is running on your PC: one at a time.</p>
          <div className="wb-btn-row">
            <button className="btn-gold" onClick={() => onOpen(running)} disabled={busy}>
              Watch the one running
            </button>
            <button className="btn-line" onClick={() => void replace()} disabled={busy}>
              {busy ? 'Stopping it…' : 'Stop it and start mine'}
            </button>
          </div>
        </div>
      )}
      {problem && <p className="setup-note is-bad">{problem}</p>}
      <footer className="setup-foot">
        <span className="tiny muted">Leaving this page doesn’t stop a watch; it ends by itself.</span>
        <button className="btn-begin" onClick={() => void start()} disabled={!ok || busy || !!running}>
          {busy && !running ? 'Starting…' : 'Watch'}
        </button>
      </footer>
      {finished.length > 0 && (
        <section className="panel wb-recent">
          <div className="fx-label panel-h">Recent watches</div>
          <ul>
            {finished.map((w) => (
              <li key={w.id}>
                <button className="wb-recent-row" onClick={() => onOpen(w.id)}>
                  <span>{watchTitle(w, w.id)}</span>
                  <span className="muted tiny">{recentLine(w)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function watchTitle(w: WatchListEntry | undefined, id: string): string {
  if (!w) return id.replace(/^watch-/, '').replace(/-(\d+)$/, ', seed $1');
  const cube = w.cubeTitle?.split(' — ')[0] ?? 'A cube';
  return `${cube}${w.players ? `: ${playerLabel(w.players.A)} vs ${playerLabel(w.players.B)}` : ''}`;
}

function recentLine(w: WatchListEntry): string {
  const parts = [w.bestOf ? `best of ${w.bestOf}` : '', w.wins ? `${w.wins.A}–${w.wins.B}` : '', w.status === 'done' ? (w.winner === 'draw' ? 'a draw' : w.winner ? `side ${w.winner} won` : 'done') : (w.status ?? ''), w.seed ? `seed ${w.seed}` : ''];
  return parts.filter(Boolean).join(' · ');
}

// ---------------------------------------------------------------------------
// A watch

function useWatchState(id: string): { state: WatchState | null; error: string | null } {
  const [state, setState] = useState<WatchState | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      const r = await getWatch(id);
      if (!live) return;
      if (r.ok) {
        setState(r.state);
        setError(null);
        // Done, stopped or failed, and the runner has let go: nothing more will change.
        if (r.state.match && TERMINAL.includes(r.state.match.status) && !r.state.running) return;
      } else {
        setError(r.message);
        if (r.status === 404) return;
      }
      timer = setTimeout(() => void poll(), POLL_MS);
    };
    void poll();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [id]);
  return { state, error };
}

function sideNameOf(match: WatchMatch | null, draft: WatchState['draft']): (s: WatchSide) => string {
  return (s) => {
    const p = match?.players?.[s];
    const who = p ? playerLabel(p.player) : null;
    const d = draft ? drafterLabel(draft.drafters[s]) : null;
    return `Drafter ${s}${who ? ` · ${who}` : d ? ` · ${d}` : ''}`;
  };
}

function statusLine(m: WatchMatch | null, hasDraft: boolean): string {
  if (!m) return hasDraft ? '' : 'Starting the watch…';
  switch (m.status) {
    case 'drafting':
      return hasDraft ? 'The draft is done; game 1 is about to start.' : 'Drafting: the engine looks the cards up and builds both decks (about 5–10 seconds, longer the first time for a cube).';
    case 'playing': {
      const g = m.games.find((x) => x.status === 'playing');
      return g ? `Game ${g.n} is being played.` : 'Between games.';
    }
    case 'done':
      return m.winner === 'draw' ? 'Over: a draw.' : m.winner ? `Over: drafter ${m.winner} won the match.` : 'Over.';
    case 'stopped':
      return `Stopped${m.error ? `: ${m.error}` : '.'}`;
    case 'error':
      return `It went wrong${m.error ? `: ${m.error}` : '.'}`;
  }
}

function Scoreboard({ match, sideName, children }: { match: WatchMatch | null; sideName: (s: WatchSide) => string; children?: ReactNode }) {
  const w = match?.wins ?? { A: 0, B: 0, draws: 0 };
  return (
    <div className="wb-score" data-score={`${w.A}-${w.B}`}>
      <span className="wb-score-side is-a">{sideName('A')}</span>
      <span className="wb-score-n mono-n" aria-label={`Score: drafter A ${w.A}, drafter B ${w.B}`}>
        {w.A} – {w.B}
      </span>
      <span className="wb-score-side is-b">{sideName('B')}</span>
      {match?.bestOf && (
        <span className="wb-score-of tiny muted">
          best of {match.bestOf}
          {w.draws ? ` · ${w.draws} drawn` : ''}
        </span>
      )}
      {children}
    </div>
  );
}

function GameNav({ match, at, onPick }: { match: WatchMatch | null; at: number | 'draft'; onPick: (v: number | 'draft') => void }) {
  return (
    <nav className="wb-nav" aria-label="Draft and games">
      <button className={cx('wb-chip', at === 'draft' && 'is-on')} aria-current={at === 'draft' ? 'page' : undefined} onClick={() => onPick('draft')}>
        Draft
      </button>
      {(match?.games ?? []).map((g) => (
        <button key={g.n} className={cx('wb-chip', at === g.n && 'is-on')} aria-current={at === g.n ? 'page' : undefined} onClick={() => onPick(g.n)} title={g.status === 'done' ? `${g.winner === 'draw' ? 'Drawn' : `Drafter ${g.winner} won`}${g.turns ? `, ${g.turns} turns` : ''}` : g.status === 'error' ? 'Cut short' : 'Being played'}>
          Game {g.n}
          {g.status === 'done' && g.winner && <span className="wb-nav-w"> · {g.winner === 'draw' ? '=' : g.winner}</span>}
          {g.status === 'playing' && <span className="live-dot" />}
        </button>
      ))}
    </nav>
  );
}

function WatchRun({ id, onBack, onSettings }: { id: string; onBack: () => void; onSettings: () => void }) {
  const { state, error } = useWatchState(id);
  const match = state?.match ?? null;
  const draft = state?.draft ?? null;
  const [view, setView] = useState<number | 'draft'>('draft');
  const [replay, setReplay] = useState<ReplayState>(() => startReplay());
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const dispatch = useCallback((a: ReplayAction) => setReplay((s) => (draftRef.current ? replayReducer(s, a, draftRef.current) : s)), []);
  // The pick timer restarts only when the step, play/pause or the speed change — not on each poll,
  // which hands in a new draft object every 1.5 s (watch/replay.ts ReplayClock).
  const clock = useMemo(() => new ReplayClock({ set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) }), []);
  useEffect(() => clock.sync(replay, !!draft, () => dispatch({ kind: 'tick' })));
  useEffect(() => () => clock.stop(), [clock]);
  const [stopping, setStopping] = useState<string | null>(null);
  const sideName = useMemo(() => sideNameOf(match, draft), [match, draft]);
  const follow = gameToFollow(match);
  const running = !!state?.running && !!match && !TERMINAL.includes(match.status);

  const stop = async () => {
    setStopping('Stopping…');
    const r = await stopWatch(id);
    setStopping(r.ok ? 'Stopping…' : r.message);
  };

  if (typeof view === 'number' && match && match.games.some((g) => g.n === view)) {
    const next = match.games.find((g) => g.n === view + 1)?.n ?? null;
    return (
      <WatchGame
        key={view}
        id={id}
        n={view}
        next={next}
        match={match}
        sideName={sideName}
        onPick={setView}
        onBack={() => setView('draft')}
        onSettings={onSettings}
        stop={running ? () => void stop() : null}
        stopping={stopping}
      />
    );
  }

  const cube = match?.cubeTitle ?? draft?.cube.title ?? null;
  const decks = draft ? atDecks(replay, draft) : false;
  const gameNote =
    draft && follow !== null ? (
      <div className={cx('wb-next', decks && 'is-ready')} role="status">
        {decks ? (
          <>
            <span>The decks are built{match?.status === 'drafting' ? '' : '; the games are on'}.</span>
            <button className="btn-gold" onClick={() => setView(follow)}>
              Watch game {follow}
            </button>
          </>
        ) : (
          <>
            <span className="tiny">Game {follow} has started. It keeps until you get there.</span>
            <button className="btn-line wb-btn" onClick={() => setView(follow)}>
              Watch it now
            </button>
          </>
        )}
      </div>
    ) : null;

  return (
    <div className="fx setup wb wb-run">
      <header className="setup-top">
        <button className="link-back" onClick={onBack}>
          <IconChevronLeft size={14} /> Watch two bots
        </button>
        <span />
        <span className="wb-top-r">
          {running && (
            <button className="btn-line wb-btn is-danger" onClick={() => void stop()} disabled={!!stopping}>
              {stopping ?? 'Stop'}
            </button>
          )}
        </span>
      </header>
      <div className="wb-runhead">
        <div className="fx-label setup-kicker">Watch two bots{cube ? ` · ${cube.split(' — ')[0]}` : ''}</div>
        <Scoreboard match={match} sideName={sideName} />
        <p className="setup-note wb-status" data-status={match?.status ?? 'starting'}>
          {error ?? statusLine(match, !!draft)}
        </p>
        {match?.cost && (
          <p className="tiny muted wb-spent" data-cost={match.cost.usd ?? ''}>
            {costLine(match.cost, !!draft || TERMINAL.includes(match.status))}
          </p>
        )}
        {state?.draftProblem && <p className="setup-note is-bad">The draft came back unreadable, so it can’t be replayed: {state.draftProblem}</p>}
        <GameNav match={match} at="draft" onPick={setView} />
      </div>
      {draft ? (
        <DraftReplay draft={draft} state={replay} dispatch={dispatch} sideName={sideName} after={gameNote} />
      ) : (
        !error && (
          <div className="wb-drafting">
            <span className="spinner spinner-lg" />
            <p className="serif-i">Drafting…</p>
          </div>
        )
      )}
    </div>
  );
}

function WatchGame({
  id,
  n,
  next,
  match,
  sideName,
  onPick,
  onBack,
  onSettings,
  stop,
  stopping,
}: {
  id: string;
  n: number;
  next: number | null;
  match: WatchMatch;
  sideName: (s: WatchSide) => string;
  onPick: (v: number | 'draft') => void;
  onBack: () => void;
  onSettings: () => void;
  stop: (() => void) | null;
  stopping: string | null;
}) {
  const [log, setLog] = useState<GameLog | null>(null);
  const [live, setLive] = useState<LiveInfo>({ url: '', status: 'connecting' });
  const game = match.games.find((g) => g.n === n);
  const gameRef = useRef(game);
  gameRef.current = game;
  useEffect(() => {
    const url = gameLogUrl(id, n);
    const shown = redactSeatUrl(url);
    setLog(null);
    setLive({ url: shown, status: 'connecting' });
    const h = connectLive(url, {
      onLog: setLog,
      onStatus: (status: LiveStatus, detail?: string) => {
        // The helper answers 404 for the few seconds the recorder boots (docs/watch-bots.md): say so in words.
        const starting = status === 'error' && /404/.test(detail ?? '') && gameRef.current?.status === 'playing';
        setLive({ url: shown, status: starting ? 'connecting' : status, detail: starting ? `Game ${n} is starting…` : detail === 'the game is over' ? `Game ${n} is over.` : detail });
      },
    });
    return () => h.close();
  }, [id, n]);
  const over = !!log?.over || game?.status === 'done' || game?.status === 'error';
  // When the game ends and the next one has started, move on after a beat.
  useEffect(() => {
    if (!over || next === null) return;
    const t = setTimeout(() => onPick(next), NEXT_GAME_MS);
    return () => clearTimeout(t);
  }, [over, next, onPick]);

  const result =
    game?.status === 'done' ? (game.winner === 'draw' ? `Game ${n}: a draw.` : `Game ${n}: drafter ${game.winner} won${game.turns ? ` in ${game.turns} turns` : ''}.`) : game?.status === 'error' ? `Game ${n} was cut short${game.error ? `: ${game.error}` : '.'}` : null;
  const banner = (
    <div className="wb-banner">
      <Scoreboard match={match} sideName={sideName}>
        {stop && (
          <button className="btn-line wb-btn is-danger" onClick={stop} disabled={!!stopping}>
            {stopping ?? 'Stop'}
          </button>
        )}
      </Scoreboard>
      <GameNav match={match} at={n} onPick={onPick} />
      {over && (
        <p className="wb-over tiny" role="status">
          {result}
          {next !== null ? (
            <>
              {' '}
              Game {next} starts in a moment.{' '}
              <button className="btn-line wb-btn" onClick={() => onPick(next)}>
                Watch game {next}
              </button>
            </>
          ) : match.status === 'done' ? (
            ` ${statusLine(match, true)}`
          ) : null}
        </p>
      )}
      {match.cost && TERMINAL.includes(match.status) && <p className="tiny muted wb-spent">{costLine(match.cost, true)}</p>}
    </div>
  );
  const who = <>Drafter A’s view: drafter B’s hand stays hidden</>;
  if (!log) {
    return (
      <div className="wb-wait">
        {banner}
        <div className="live-wait">
          <span className="spinner spinner-lg" />
          <h2>{live.status === 'error' ? `Can’t follow game ${n} yet` : `Game ${n} is starting…`}</h2>
          {live.detail && <p className="small">{live.detail}</p>}
          <button className="btn btn-quiet" onClick={onBack}>
            Back to the draft
          </button>
        </div>
      </div>
    );
  }
  return (
    <GameView
      log={log}
      title={`Game ${n} of ${match.bestOf ?? '?'}`}
      who={who}
      banner={banner}
      live={live}
      initialDecision={null}
      onClose={onBack}
      onSettings={onSettings}
    />
  );
}
