/*
 * ForgeCoach — ui/LoadScreen.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Pick a game: a bundled sample, a frames.jsonl(.gz) from disk, or a live
 * game served over HTTP.
 */
import { useRef, useState } from 'react';
import { DEFAULT_LIVE_URL } from '../live.ts';
import { IconArrowRight, IconBroadcast, IconCheck, IconCopy, IconFile, IconGear, IconUpload } from './Icons.tsx';
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

export function LoadScreen({
  onSample,
  onFile,
  onLive,
  onSettings,
  lastSample,
  loading,
  error,
}: {
  onSample: (id: string) => void;
  onFile: (f: File) => void;
  onLive: (url: string) => void;
  onSettings: () => void;
  lastSample: string | null;
  loading: string | null;
  error: string | null;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState(DEFAULT_LIVE_URL);
  const [copied, setCopied] = useState(false);
  const samples = [...SAMPLES].sort((a, b) => Number(b.id === lastSample) - Number(a.id === lastSample));
  return (
    <div className="load">
      <header className="load-top">
        <Logo />
        <button className="icon-btn" onClick={onSettings} aria-label="Settings">
          <IconGear size={18} />
        </button>
      </header>
      <main className="load-main">
        <section className="hero">
          <h1>
            Exact state. <span className="accent">Honest coaching.</span>
          </h1>
          <p className="hero-sub">
            Load a Forge game recorded by mtg-table and step through every decision you made — with the real board, real card
            text, and a coach that never has to guess what was tapped.
          </p>
        </section>

        {error && (
          <div className="banner banner-bad" role="alert">
            <b>Couldn’t open that.</b> {error}
          </div>
        )}

        <section className="load-section">
          <h2 className="section-h">Try a sample game</h2>
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
            <h2 className="section-h">Your own game</h2>
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
              <IconBroadcast size={15} /> Follow a live game
            </h2>
            <div className="live-box">
              <p className="small muted">Serve the game folder while you play, then connect. ForgeCoach only reads — it never touches your seat.</p>
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
              <form
                className="field-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  onLive(url.trim());
                }}
              >
                <input value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} aria-label="Live frames URL" />
                <button className="btn btn-primary" type="submit" disabled={!url.trim()}>
                  Connect
                </button>
              </form>
              <p className="tiny muted">Chrome may ask for local-network access — allow it. Safari can’t read from localhost over HTTPS, so use Chrome or Firefox.</p>
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
