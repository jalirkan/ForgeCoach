/*
 * ForgeCoach — ui/App.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Top level: playing a game against Forge (the seat), or a loaded game
 * (sample, file, live follow) in the replay view, plus the global surfaces
 * (settings, drag-and-drop).
 */
// The base stylesheet first, so feature sheets (play.css, ask.css) layer on top of it.
import './styles.css';
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { GameLog } from '../log.ts';
import { readLogBytes } from '../log.ts';
import { connectLive, type LiveHandle } from '../live.ts';
import { GameView, type LiveInfo } from './GameView.tsx';
import { LoadScreen, SAMPLES } from './LoadScreen.tsx';
import { SettingsDialog } from './SettingsDialog.tsx';
import { IconUpload } from './Icons.tsx';
import { readLS, writeLS } from './util.ts';
import { DEFAULT_SEAT_URL } from '../play/session.ts';
import { usePlaySession } from './play/usePlaySession.ts';
import { PlayView } from './play/PlayView.tsx';

// #ask-gallery: every ask kind rendered from fixtures (a design/QA page); lazy so the fixtures stay out of the main bundle.
const AskGallery = lazy(() => import('./play/AskGallery.tsx'));

const LAST_SAMPLE_KEY = 'forgecoach.lastSample';
const SEAT_URL_KEY = 'forgecoach.seatUrl';

/** `?seat=ws://…/ws` pre-fills (and remembers) the engine URL. */
function initialSeatUrl(): string {
  try {
    const q = new URLSearchParams(location.search).get('seat');
    if (q && /^wss?:\/\//.test(q)) return q;
  } catch {
    /* ignore */
  }
  return readLS(SEAT_URL_KEY) || DEFAULT_SEAT_URL;
}

function friendly(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (e instanceof SyntaxError || /Unexpected token|in JSON at position/i.test(msg)) {
    return 'It doesn’t look like an mtg-table frame log (a frames.jsonl, optionally gzipped). One of its lines isn’t valid JSON.';
  }
  if (/incorrect header|gzip|decompress/i.test(msg)) return 'The file looks gzipped but couldn’t be decompressed — it may be truncated.';
  return msg;
}

function validate(log: GameLog): GameLog {
  if (!log.frames.some((f) => f.type === 'state')) {
    throw new Error('The file has a session header but no game states — was the game recorded past the first turn?');
  }
  return log;
}

function parseHash(): { sample: string | null; d: number | null } {
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  const d = h.get('d');
  return { sample: h.get('sample'), d: d !== null && /^\d+$/.test(d) ? Number(d) : null };
}

export function App() {
  const [gallery, setGallery] = useState(() => location.hash === '#ask-gallery');
  useEffect(() => {
    const on = () => setGallery(location.hash === '#ask-gallery');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  if (gallery) {
    return (
      <Suspense fallback={<div className="live-wait"><span className="spinner spinner-lg" /></div>}>
        <AskGallery />
      </Suspense>
    );
  }
  return <MainApp />;
}

function MainApp() {
  const [log, setLog] = useState<GameLog | null>(null);
  const [title, setTitle] = useState('');
  const [sampleId, setSampleId] = useState<string | null>(null);
  const [initialDecision, setInitialDecision] = useState<number | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<LiveInfo | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [lastSample, setLastSample] = useState<string | null>(() => readLS(LAST_SAMPLE_KEY));
  const liveRef = useRef<LiveHandle | null>(null);
  const loadSeq = useRef(0);

  // ---- Play: one seat connection while playUrl is set.
  const [seatUrl, setSeatUrl] = useState(initialSeatUrl);
  const [playUrl, setPlayUrl] = useState<string | null>(null);
  const [playStarted, setPlayStarted] = useState(false);
  const [review, setReview] = useState<GameLog | null>(null);
  const play = usePlaySession(playUrl);
  const snap = play.snapshot;
  useEffect(() => {
    if (playUrl && snap && (snap.state || snap.hello)) setPlayStarted(true);
  }, [playUrl, snap]);
  const playRef = useRef(play);
  playRef.current = play;
  const startPlay = useCallback((url: string) => {
    // Same engine: retry now on the session we have (its URL is its identity).
    if (playRef.current.session && playRef.current.snapshot?.url === url) {
      playRef.current.session.reconnect();
      return;
    }
    writeLS(SEAT_URL_KEY, url === DEFAULT_SEAT_URL ? null : url);
    setSeatUrl(url);
    setPlayStarted(false);
    setReview(null);
    setPlayUrl(url);
  }, []);
  const stopPlay = useCallback(() => {
    setPlayUrl(null);
    setPlayStarted(false);
    setReview(null);
  }, []);

  const stopLive = useCallback(() => {
    liveRef.current?.close();
    liveRef.current = null;
    setLive(null);
  }, []);

  const open = useCallback((l: GameLog, t: string, sample: string | null, d: number | null = null) => {
    setLog(l);
    setTitle(t);
    setSampleId(sample);
    setInitialDecision(d);
    setError(null);
  }, []);

  const loadSample = useCallback(
    async (id: string, d: number | null = null) => {
      stopLive();
      setPlayUrl(null);
      const seq = ++loadSeq.current;
      setLoading(id);
      setError(null);
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}samples/${id}.jsonl.gz`);
        if (!res.ok) throw new Error(`The sample couldn’t be downloaded (HTTP ${res.status}).`);
        const l = validate(await readLogBytes(await res.arrayBuffer()));
        if (seq !== loadSeq.current) return;
        writeLS(LAST_SAMPLE_KEY, id);
        setLastSample(id);
        open(l, SAMPLES.find((s) => s.id === id)?.title ?? id, id, d);
        history.replaceState(null, '', `#sample=${encodeURIComponent(id)}${d !== null ? `&d=${d}` : ''}`);
      } catch (e) {
        if (seq === loadSeq.current) setError(friendly(e));
      } finally {
        if (seq === loadSeq.current) setLoading(null);
      }
    },
    [open, stopLive],
  );

  const loadFile = useCallback(
    async (f: File) => {
      stopLive();
      setPlayUrl(null);
      const seq = ++loadSeq.current;
      setLoading('file');
      setError(null);
      try {
        if (f.size === 0) throw new Error('The file is empty.');
        const l = validate(await readLogBytes(await f.arrayBuffer()));
        if (seq !== loadSeq.current) return;
        open(l, l.header.gameId || f.name, null);
        history.replaceState(null, '', location.pathname + location.search);
      } catch (e) {
        if (seq === loadSeq.current) {
          setLog(null);
          setError(`${f.name}: ${friendly(e)}`);
        }
      } finally {
        if (seq === loadSeq.current) setLoading(null);
      }
    },
    [open, stopLive],
  );

  const startLive = useCallback(
    (url: string) => {
      stopLive();
      setPlayUrl(null);
      setError(null);
      setLive({ url, status: 'connecting' });
      try {
        liveRef.current = connectLive(url, {
          onLog: (l) => {
            setLog(l);
            setTitle(`${l.header?.gameId ?? 'Live game'}`);
            setSampleId(null);
          },
          onStatus: (status, detail) => setLive({ url, status, detail }),
        });
        setInitialDecision(null);
      } catch (e) {
        setLive(null);
        setError(friendly(e));
      }
    },
    [stopLive],
  );

  const close = useCallback(() => {
    stopLive();
    setLog(null);
    setSampleId(null);
    history.replaceState(null, '', location.pathname + location.search);
  }, [stopLive]);

  // ?play=1 connects to the engine straight away (bookmarkable).
  useEffect(() => {
    try {
      if (new URLSearchParams(location.search).get('play') === '1') startPlay(initialSeatUrl());
    } catch {
      /* ignore */
    }
  }, [startPlay]);

  // Deep link: #sample=<id>&d=<decision>
  useEffect(() => {
    const { sample, d } = parseHash();
    if (sample && SAMPLES.some((s) => s.id === sample)) void loadSample(sample, d);
    return () => liveRef.current?.close();
  }, [loadSample]);

  const onIndexChange = useCallback(
    (i: number) => {
      if (sampleId) history.replaceState(null, '', `#sample=${encodeURIComponent(sampleId)}&d=${i}`);
    },
    [sampleId],
  );

  // Drag and drop anywhere.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const f = e.dataTransfer?.files?.[0];
      if (f) void loadFile(f);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [loadFile]);

  const showGame = log !== null || (live !== null && live.status !== 'error');
  const playing = playUrl !== null && playStarted && play.session && snap;
  let main: ReactNode;
  if (playing && review) {
    main = (
      <GameView
        key={`review:${review.header.gameId}@${review.header.startedAt}`}
        log={review}
        title={`Review · ${review.hello?.gameNumber ? `game ${review.hello.gameNumber}` : review.header.gameId}`}
        live={null}
        initialDecision={null}
        initialTab="review"
        onClose={() => setReview(null)}
        closeLabel="Back to the table"
        onSettings={() => setSettingsOpen(true)}
      />
    );
  } else if (playing) {
    main = <PlayView session={play.session!} snapshot={snap!} onReview={setReview} onLeave={stopPlay} onSettings={() => setSettingsOpen(true)} />;
  } else if (showGame && log) {
    main = (
      <GameView
        key={sampleId ?? title + (live ? ':live' : '')}
        log={log}
        title={title}
        live={live}
        initialDecision={initialDecision}
        onIndexChange={onIndexChange}
        onClose={close}
        onSettings={() => setSettingsOpen(true)}
      />
    );
  } else if (live && live.status !== 'error') {
    main = <LiveWaiting live={live} onCancel={close} />;
  } else {
    main = (
      <LoadScreen
        onSample={(id) => void loadSample(id)}
        onFile={(f) => void loadFile(f)}
        onLive={startLive}
        onPlay={startPlay}
        onCancelPlay={stopPlay}
        seatUrl={seatUrl}
        play={playUrl && snap ? { status: snap.status, detail: snap.detail, attempts: snap.attempts } : playUrl ? { status: 'connecting', detail: null, attempts: 0 } : null}
        onSettings={() => setSettingsOpen(true)}
        lastSample={lastSample}
        loading={loading}
        error={error ?? (live?.status === 'error' ? live.detail ?? 'Couldn’t reach the live game.' : null)}
      />
    );
  }
  return (
    <>
      {main}
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-overlay-inner">
            <IconUpload size={28} />
            <span>Drop a frames.jsonl to open it</span>
          </div>
        </div>
      )}
    </>
  );
}

function LiveWaiting({ live, onCancel }: { live: LiveInfo; onCancel: () => void }) {
  return (
    <div className="live-wait">
      <span className="spinner spinner-lg" />
      <h2>{live.status === 'connecting' ? 'Connecting to the live game…' : 'Waiting for frames…'}</h2>
      <p className="muted">
        <code>{live.url}</code>
      </p>
      {live.detail && <p className="small">{live.detail}</p>}
      <button className="btn btn-quiet" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
