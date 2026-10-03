/*
 * ForgeCoach — ui/LoadScreen.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The start page. The primary actions are playing against Forge (ForgeCoach
 * takes the player's seat on a running mtg-table engine) and Draft & build
 * (the deck assistant for paper cube drafts); reviewing a recorded game
 * (sample or file) and following a live game are secondary.
 */
import { useEffect, useRef, useState } from 'react';
import './play/play.css';
import { DEFAULT_LIVE_URL, FALLBACK_LIVE_URL } from '../live.ts';
import { redactSeatUrl, type SeatStatus } from '../play/session.ts';
import { IconArrowRight, IconBroadcast, IconCheck, IconChevronDown, IconChevronLeft, IconCopy, IconFile, IconGear, IconLayers, IconPlay, IconUpload } from './Icons.tsx';
import { copyText, cx } from './util.ts';
import { Logo } from './Logo.tsx';

export interface SampleInfo {
  id: string;
  title: string;
  blurb: string;
  meta: string[];
}

export const SAMPLES: SampleInfo[] = [
  {
    id: 'human-auto-42',
    title: 'Auto-play, seed 42',
    blurb: 'Pacho’s S.H.I.E.L.D. deck against the Forge AI, every click recorded.',
    meta: ['Human vs Forge AI', '40-card decks', 'Loss'],
  },
  {
    id: 'human-comfort-13',
    title: 'Comfort game, seed 13',
    blurb: 'The same deck played by hand over the web client — upkeep stops and all.',
    meta: ['Human vs Forge AI', '40-card decks', 'Loss'],
  },
];

const LIVE_CMD = 'npx http-server var/games/<gameId> -p 8650 --cors -c-1';
/** Run in an mtg-table checkout: the engine only (mtg-table's own board would take the seat). */
export const ENGINE_CMD = './scripts/play.sh --engine-only';
/**
 * Linux: installs the ForgeCoach launcher (public/forgecoach.sh) and its app-menu
 * entries; the menu icon then finds mtg-table, starts the engine and opens Play.
 */
export const LAUNCHER_CMD = 'curl -fsSL https://jalirkan.github.io/ForgeCoach/forgecoach.sh | bash -s install';

export interface PlayStatus {
  status: SeatStatus;
  detail: string | null;
  attempts: number;
}

function portArg(url: string): string {
  try {
    const p = new URL(url).port;
    return p && p !== '8642' ? ` --port ${p}` : '';
  } catch {
    return '';
  }
}

function CopyCmd({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="cmd">
      <code>{cmd}</code>
      <button
        type="button"
        className="icon-btn"
        aria-label="Copy command"
        onClick={async () => {
          setCopied(await copyText(cmd));
          setTimeout(() => setCopied(false), 1800);
        }}
      >
        {copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
      </button>
    </div>
  );
}

/** What the seat status means, in words (never showing the pairing token). */
function seatStatusText(play: PlayStatus | null, url: string): string | null {
  if (!play) return null;
  if (play.status === 'open') return 'Connected — waiting for the engine to deal…';
  if (play.status === 'connecting' || play.status === 'idle') {
    return play.attempts > 0 ? `Looking for the engine… (attempt ${play.attempts + 1})` : 'Connecting to the engine…';
  }
  if (play.status === 'refused') return 'Another window has the player’s seat.';
  return `Couldn’t reach the engine at ${redactSeatUrl(url)}.`;
}

function SeatStatusBox({ play, url }: { play: PlayStatus | null; url: string }) {
  const text = seatStatusText(play, url);
  if (!play || !text) return null;
  const busy = play.status === 'connecting' || play.status === 'idle' || play.status === 'open';
  const retry = play.detail ? /Retrying in ([\d.]+ s)/.exec(play.detail)?.[1] ?? null : null;
  return (
    <div className={cx('play-status', !busy ? 'is-bad' : play.status === 'open' ? 'is-ok' : 'is-wait')} role="status">
      <b>{text}</b> {retry && <span className="play-status-detail">Retrying in {retry}.</span>}
      {play.detail && play.detail.length > 140 ? (
        <details className="play-status-more">
          <summary>Details</summary>
          <p>{play.detail}</p>
        </details>
      ) : (
        play.detail && <span className="play-status-detail"> {play.detail}</span>
      )}
    </div>
  );
}

function PlayCard({
  seatUrl,
  homeSeatUrl,
  engineServed,
  play,
  onPlay,
  onCancel,
}: {
  seatUrl: string;
  homeSeatUrl: string;
  engineServed: boolean;
  play: PlayStatus | null;
  onPlay: (url: string) => void;
  onCancel: () => void;
}) {
  const [url, setUrl] = useState(seatUrl);
  useEffect(() => setUrl(seatUrl), [seatUrl]);
  const busy = play !== null && (play.status === 'connecting' || play.status === 'idle' || play.status === 'open');
  const failed = play !== null && !busy;
  const [helpOpen, setHelpOpen] = useState(false);
  useEffect(() => {
    if (failed || (play && play.attempts > 0)) setHelpOpen(true);
  }, [failed, play]);
  const cmd = ENGINE_CMD + portArg(url);
  return (
    <section className="play-card" aria-label="Play against Forge">
      <div className="play-card-main">
        <div className="play-card-text">
          <h2 className="play-card-title">Play vs Forge</h2>
          <p className="muted">
            {engineServed
              ? 'A full game against the Forge AI, with the coach one tap away. Forge runs on the computer that served this page.'
              : 'A full game against the Forge AI, with the coach one tap away. Your Forge engine runs on this computer.'}
          </p>
        </div>
        {busy ? (
          <button className="btn btn-quiet play-go" onClick={onCancel}>
            <span className="spinner" /> Cancel
          </button>
        ) : (
          <button className="btn btn-primary play-go" onClick={() => onPlay(engineServed ? homeSeatUrl : url.trim() || homeSeatUrl)}>
            <IconPlay size={16} /> {failed ? 'Try again' : 'Play'}
          </button>
        )}
      </div>
      <SeatStatusBox play={play} url={url} />
      {!engineServed && (
        <details className="play-help" open={helpOpen} onToggle={(e) => setHelpOpen((e.target as HTMLDetailsElement).open)}>
          <summary>
            <span>Start the engine first</span> <IconChevronDown size={14} />
          </summary>
          <div className="play-launcher">
            <p>
              <b>Easiest on Linux:</b> paste this into a terminal once. After that, click <b>ForgeCoach</b> in your app menu:
              it starts the engine and opens this page.
            </p>
            <CopyCmd cmd={LAUNCHER_CMD} />
          </div>
          <p className="play-steps-lead">Or by hand:</p>
          <ol className="play-steps">
            <li>
              In your <b>mtg-table</b> checkout, start the engine:
              <CopyCmd cmd={cmd} />
            </li>
            <li>
              Wait for <i>Engine ready on ws://…</i>. Close any mtg-table board tab first — only one window can hold the player’s seat.
            </li>
            <li>
              Press <b>Play</b>. Chrome may ask to let this page reach devices on your local network — allow it. Safari blocks it; use Chrome or Firefox.
            </li>
          </ol>
          <form
            className="field-row play-url"
            onSubmit={(e) => {
              e.preventDefault();
              onPlay(url.trim() || homeSeatUrl);
            }}
          >
            <label className="tiny muted" htmlFor="seat-url">
              Engine address
            </label>
            <input id="seat-url" value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} aria-label="Engine seat URL" />
            {url !== homeSeatUrl && (
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => setUrl(homeSeatUrl)}>
                Reset
              </button>
            )}
          </form>
        </details>
      )}
    </section>
  );
}

/** The third primary option: the deck assistant for paper cube drafts. */
function DraftCard({ onDraft }: { onDraft: () => void }) {
  return (
    <section className="draft-card" aria-label="Draft and build">
      <div className="draft-card-icon" aria-hidden="true">
        <IconLayers size={22} />
      </div>
      <div className="play-card-text">
        <h2 className="draft-card-title">Draft &amp; build</h2>
        <p className="muted">Two-player cube drafts on paper: track your pool, get Grid and Winston picks called, and the best 40 with its reasons.</p>
      </div>
      <button className="btn btn-quiet draft-go" onClick={onDraft}>
        Open <IconArrowRight size={16} />
      </button>
    </section>
  );
}

/**
 * The page the engine served to a phone: no landing choices, just the
 * connection to this table (with a way to the other options).
 */
function EngineConnect({
  seatUrl,
  play,
  onPlay,
  onCancel,
  onMore,
  onSettings,
}: {
  seatUrl: string;
  play: PlayStatus | null;
  onPlay: (url: string) => void;
  onCancel: () => void;
  onMore: () => void;
  onSettings: () => void;
}) {
  const busy = play !== null && (play.status === 'connecting' || play.status === 'idle' || play.status === 'open');
  const failed = play !== null && !busy;
  return (
    <div className="engine-connect">
      <header className="load-top">
        <Logo />
        <button className="icon-btn" onClick={onSettings} aria-label="Settings">
          <IconGear size={18} />
        </button>
      </header>
      <main className="engine-connect-main">
        <div className="engine-connect-card">
          <div className={cx('engine-connect-icon', busy && 'is-busy', failed && 'is-bad')} aria-hidden="true">
            {busy ? <span className="spinner spinner-lg" /> : <IconPlay size={26} />}
          </div>
          <h1 className="engine-connect-title">{busy ? 'Joining your table…' : failed ? 'Can’t reach the table' : 'Play vs Forge'}</h1>
          <p className="muted engine-connect-sub">
            {failed
              ? 'Is the engine still running on your computer, and is this phone on the same network?'
              : 'The Forge engine on your computer served this page. You play from here; the coach is one tap away.'}
          </p>
          <SeatStatusBox play={play} url={seatUrl} />
          {busy ? (
            <button className="btn btn-quiet engine-connect-go" onClick={onCancel}>
              Cancel
            </button>
          ) : (
            <button className="btn btn-primary engine-connect-go" onClick={() => onPlay(seatUrl)}>
              <IconPlay size={16} /> {failed ? 'Try again' : 'Play'}
            </button>
          )}
          <button className="link-btn engine-connect-more" onClick={onMore}>
            <IconChevronLeft size={14} /> Other options — review a game, settings
          </button>
        </div>
      </main>
    </div>
  );
}

export function LoadScreen({
  onSample,
  onFile,
  onLive,
  onPlay,
  onDraft,
  onCancelPlay,
  seatUrl,
  homeSeatUrl,
  engineServed = false,
  play,
  onSettings,
  lastSample,
  loading,
  error,
}: {
  onSample: (id: string) => void;
  onFile: (f: File) => void;
  onLive: (url: string) => void;
  onPlay: (url: string) => void;
  /** Open the deck assistant (Draft & build). */
  onDraft: () => void;
  onCancelPlay: () => void;
  seatUrl: string;
  /** Where Play connects by default (this origin's seat when the engine served the page). */
  homeSeatUrl: string;
  /** The mtg-table bridge served this page: open straight onto the connection. */
  engineServed?: boolean;
  play: PlayStatus | null;
  onSettings: () => void;
  lastSample: string | null;
  loading: string | null;
  error: string | null;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState(DEFAULT_LIVE_URL);
  const [copied, setCopied] = useState(false);
  const samples = [...SAMPLES].sort((a, b) => Number(b.id === lastSample) - Number(a.id === lastSample));
  const [more, setMore] = useState(false);
  if (engineServed && !more) {
    return <EngineConnect seatUrl={seatUrl} play={play} onPlay={onPlay} onCancel={onCancelPlay} onMore={() => setMore(true)} onSettings={onSettings} />;
  }
  return (
    <div className="load">
      <header className="load-top">
        <Logo />
        <a className="load-link" href="#meta">Metagame</a>
        <a className="load-link" href="#history">Your record</a>
        <button className="icon-btn" onClick={onSettings} aria-label="Settings">
          <IconGear size={18} />
        </button>
      </header>
      <main className="load-main">
        <section className="hero">
          <h1>
            Play Forge. <span className="accent">Get coached.</span>
          </h1>
          <p className="hero-sub">
            A clean, calm table for games against the Forge AI — with a coach that sees the exact board and every card’s real
            text, and a full review when the game is done.
          </p>
        </section>

        <PlayCard seatUrl={seatUrl} homeSeatUrl={homeSeatUrl} engineServed={engineServed} play={play} onPlay={onPlay} onCancel={onCancelPlay} />
        <DraftCard onDraft={onDraft} />

        {error && (
          <div className="banner banner-bad" role="alert">
            <b>Couldn’t open that.</b> {error}
          </div>
        )}

        <section className="load-section">
          <h2 className="section-h">Review a recorded game</h2>
          <div className="sample-grid">
            {samples.map((s) => (
              <button key={s.id} className={cx('sample', s.id === lastSample && 'is-last')} onClick={() => onSample(s.id)} disabled={!!loading}>
                <div className="sample-art" aria-hidden="true">
                  <span className="sample-pips">
                    <span className="mini-pip mp-U" />
                    <span className="mini-pip mp-W" />
                  </span>
                </div>
                <div className="sample-body">
                  <div className="sample-title">
                    {s.title}
                    {s.id === lastSample && <span className="tag tag-accent">Last opened</span>}
                  </div>
                  <p className="sample-blurb">{s.blurb}</p>
                  <div className="sample-meta">
                    {s.meta.map((m) => (
                      <span key={m}>{m}</span>
                    ))}
                  </div>
                </div>
                <span className="sample-go">{loading === s.id ? <span className="spinner" /> : <IconArrowRight size={18} />}</span>
              </button>
            ))}
          </div>
        </section>

        <div className="load-two">
          <section className="load-section">
            <h2 className="section-h">Your own recording</h2>
            <button className={cx('drop', loading === 'file' && 'is-busy')} onClick={() => fileRef.current?.click()} disabled={!!loading}>
              <span className="drop-icon">{loading === 'file' ? <span className="spinner" /> : <IconUpload size={22} />}</span>
              <span className="drop-title">Open frames.jsonl</span>
              <span className="drop-sub">
                or drop it anywhere on this page · <code>.jsonl</code> or <code>.jsonl.gz</code>
              </span>
              <span className="drop-sub muted">
                <IconFile size={12} /> mtg-table writes it to <code>var/games/&lt;gameId&gt;/</code>
              </span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".jsonl,.gz,.json,application/gzip,application/json,text/plain"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
                e.target.value = '';
              }}
            />
          </section>

          <section className="load-section">
            <h2 className="section-h">
              <IconBroadcast size={15} /> Watch a game live
            </h2>
            <div className="live-box">
              <p className="small muted">
                Playing in mtg-table’s own board instead? Follow along here, read-only, from its <code>/observe</code> socket.
              </p>
              <form
                className="field-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  onLive(url.trim());
                }}
              >
                <input value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} aria-label="Live URL" />
                <button className="btn btn-quiet" type="submit" disabled={!url.trim()}>
                  Watch
                </button>
              </form>
              <p className="tiny muted">Chrome may ask for local-network access — allow it. Safari blocks it; use Chrome or Firefox.</p>
              <details className="tiny muted">
                <summary>No /observe yet?</summary>
                <p>
                  If your mtg-table predates the read-only <code>/observe</code> update, serve the game folder and connect to{' '}
                  <code>{FALLBACK_LIVE_URL}</code> instead:
                </p>
                <div className="cmd">
                  <code>{LIVE_CMD}</code>
                  <button
                    className="icon-btn"
                    aria-label="Copy command"
                    onClick={async () => {
                      setCopied(await copyText(LIVE_CMD));
                      setTimeout(() => setCopied(false), 1800);
                    }}
                  >
                    {copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
                  </button>
                </div>
                <button type="button" className="btn" onClick={() => setUrl(FALLBACK_LIVE_URL)}>
                  Use the HTTP URL
                </button>
              </details>
            </div>
          </section>
        </div>
      </main>
      <footer className="load-foot muted tiny">
        Runs entirely in your browser. Card data from Scryfall. Not affiliated with Wizards of the Coast or Forge.
      </footer>
    </div>
  );
}
