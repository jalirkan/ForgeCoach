/*
 * ForgeCoach — ui/bug/BugReport.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * "Report a bug" (mtg-table D411): a small panel over any screen. The player
 * types a title and what happened; the page adds the rest (bug/report.ts) and
 * sends it to mtg-table — the room this page holds a seat in, else the coach
 * helper on this computer (bug/deliver.ts) — or offers it as a file.
 *
 *   <BugReportHost />   once, in App: Shift+B, and the panel itself
 *   <BugButton />       the top bar's icon button (play board, replay)
 *   <BugMenuItem />     the phone menu's item
 *   <BugFab />          a small corner button (the draft and room screens)
 *   useBugContext(get)  what a screen knows, read only when a report is made
 *
 * The panel never changes the game: it opens over it and closes.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Sheet } from '../Sheet.tsx';
import { cx } from '../util.ts';
import { loadSettings } from '../../claude.ts';
import { pageHelperTarget } from '../../coachHelper.ts';
import { currentPrefs } from '../../ambience/prefs.ts';
import { savedRoomBases } from '../../play/friendTable.ts';
import { attachedSummary, buildReport, collectSecrets, MAX_DETAILS, MAX_TITLE, SEVERITIES, type BugReport, type BugSnapshot, type Severity } from '../../bug/report.ts';
import { currentBugSnapshot, onOpenBugReport, openBugReport, pushBugContext } from '../../bug/context.ts';
import { chooseRoute, downloadName, downloadText, routeWords, savedRoomSeats, sendReport, type BugRoute, type SendResult } from '../../bug/deliver.ts';
import { clientFacts } from '../../bug/client.ts';
import { pageConsole } from '../../bug/consoleRing.ts';
import { BUG_HOTKEY_LABEL, isBugHotkey } from '../../bug/hotkey.ts';
import { captureScreen, imageToShot, pastedImage, type Shot } from '../../bug/shot.ts';
import './bug.css';

const PANEL_ATTR = 'data-bug-panel';

export function IconBug({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 9a4 4 0 0 1 8 0v5a4 4 0 0 1-8 0z" />
      <path d="M9.5 5.5 8 4M14.5 5.5 16 4M12 9v9M8 11H4M16 11h4M8 15l-3.5 2M16 15l3.5 2M8 7.5 5 6M16 7.5 19 6" />
    </svg>
  );
}

/** Registers what this screen knows for a report; `get` is read only when a report is made. */
export function useBugContext(get: () => BugSnapshot): void {
  const ref = useRef(get);
  ref.current = get;
  useEffect(() => pushBugContext(() => ref.current()), []);
}

const TITLE = `Report a bug (${BUG_HOTKEY_LABEL})`;

export function BugButton({ className }: { className?: string }) {
  return (
    <button type="button" className={cx('icon-btn', 'bug-btn', className)} onClick={openBugReport} aria-label="Report a bug" title={TITLE}>
      <IconBug size={17} />
    </button>
  );
}

export function BugMenuItem({ onPick }: { onPick?: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        onPick?.();
        openBugReport();
      }}
    >
      <IconBug size={16} /> Report a bug
    </button>
  );
}

export function BugFab() {
  return (
    <button type="button" className="bug-fab" onClick={openBugReport} aria-label="Report a bug" title={TITLE}>
      <IconBug size={16} />
    </button>
  );
}

function readStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function routeFor(snapshot: BugSnapshot): BugRoute | null {
  return chooseRoute(snapshot.room, savedRoomSeats(readStorage()), pageHelperTarget());
}

function skinNow(): string | null {
  try {
    return document.documentElement.getAttribute('data-skin');
  } catch {
    return null;
  }
}

function makeReport(snapshot: BugSnapshot, f: { title: string; details: string; severity: Severity | null; shot: Shot | null }): BugReport {
  const st = readStorage();
  const helper = pageHelperTarget();
  const secrets = collectSecrets(st, { search: location.search, hash: location.hash });
  if (helper.token) secrets.push(helper.token);
  let standalone = false;
  try {
    standalone = window.matchMedia?.('(display-mode: standalone)').matches ?? false;
  } catch {
    /* no matchMedia */
  }
  const client = clientFacts({
    settings: loadSettings(),
    scenery: (() => {
      try {
        return currentPrefs();
      } catch {
        return null;
      }
    })(),
    skin: skinNow(),
    location,
    roomBases: savedRoomBases(),
    viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 },
    userAgent: navigator.userAgent,
    language: navigator.language ?? null,
    online: typeof navigator.onLine === 'boolean' ? navigator.onLine : null,
    standalone,
    dev: import.meta.env.DEV,
  });
  return buildReport({
    title: f.title,
    details: f.details,
    severity: f.severity,
    snapshot,
    console: pageConsole.entries(),
    client,
    route: location.hash || '#',
    secrets,
    screenshot: f.shot?.shot ?? null,
    thumbnail: f.shot?.thumb ?? null,
  });
}

function saveFile(report: BugReport): void {
  const blob = new Blob([downloadText(report)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = downloadName(report);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Once, in App: the key and the panel. */
export function BugReportHost() {
  const [open, setOpen] = useState<{ snapshot: BugSnapshot; at: number } | null>(null);
  const openNow = useCallback(() => setOpen((o) => o ?? { snapshot: currentBugSnapshot(), at: Date.now() }), []);
  useEffect(() => onOpenBugReport(openNow), [openNow]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (!isBugHotkey({ key: e.key, code: e.code, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, isComposing: e.isComposing, repeat: e.repeat, targetTag: t?.tagName, targetEditable: !!t?.isContentEditable })) return;
      // Before the board's own listener reads it as B (pass until before my turn).
      e.preventDefault();
      e.stopPropagation();
      openNow();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [openNow]);
  if (!open) return null;
  return <BugPanel key={open.at} snapshot={open.snapshot} onClose={() => setOpen(null)} />;
}

type ShotState = { kind: 'capturing' } | { kind: 'ready'; shot: Shot } | { kind: 'failed'; why: string };

function BugPanel({ snapshot, onClose }: { snapshot: BugSnapshot; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [severity, setSeverity] = useState<Severity | null>(null);
  const [attach, setAttach] = useState(true);
  const [shot, setShot] = useState<ShotState>({ kind: 'capturing' });
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const route = useRef(routeFor(snapshot)).current;
  const friend = route?.kind === 'room' && route.seat === 1;
  const wrap = useRef<HTMLDivElement>(null);

  // The screen as it was when the panel opened (the panel itself left out).
  useEffect(() => {
    let live = true;
    void captureScreen((el) => el.hasAttribute(PANEL_ATTR) || el.classList.contains('sheet-backdrop')).then(
      (s) => live && setShot((cur) => (cur.kind === 'capturing' ? { kind: 'ready', shot: s } : cur)),
      (e: unknown) => live && setShot((cur) => (cur.kind === 'capturing' ? { kind: 'failed', why: e instanceof Error ? e.message : String(e) } : cur)),
    );
    return () => {
      live = false;
    };
  }, []);

  // Keys typed in the panel stay in the panel (the board's hotkeys must not act on them).
  useEffect(() => {
    const el = wrap.current?.closest('.sheet') ?? wrap.current;
    if (!el) return;
    const stop = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') e.stopPropagation();
    };
    el.addEventListener('keydown', stop as EventListener);
    return () => el.removeEventListener('keydown', stop as EventListener);
  }, []);

  const takeImage = useCallback(async (blob: Blob, how: 'paste' | 'file') => {
    try {
      const s = await imageToShot(blob, how);
      setShot({ kind: 'ready', shot: s });
      setAttach(true);
      setProblem(null);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = pastedImage(e);
      if (!f) return;
      e.preventDefault();
      void takeImage(f, 'paste');
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [takeImage]);

  const report = (): BugReport | null => {
    try {
      return makeReport(snapshot, { title, details, severity, shot: attach && shot.kind === 'ready' ? shot.shot : null });
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
      return null;
    }
  };
  const send = async () => {
    setProblem(null);
    if (!route) return;
    const r = report();
    if (!r) return;
    setSending(true);
    setResult(await sendReport(r, route));
    setSending(false);
  };
  const download = () => {
    setProblem(null);
    const r = report();
    if (r) saveFile(r);
  };

  const summary = attachedSummary(snapshot, pageConsole.entries().length);
  const sent = result?.ok ? result : null;
  const canSend = !!route && title.trim() !== '' && !sending && !sent;

  let footer: ReactNode;
  if (sent) {
    footer = (
      <button type="button" className="btn btn-primary" onClick={onClose}>
        Done
      </button>
    );
  } else {
    footer = (
      <>
        <button type="button" className="btn btn-quiet" onClick={download} disabled={title.trim() === ''} title="Save the report as a file">
          Download report
        </button>
        {route && (
          <button type="button" className="btn btn-primary" onClick={() => void send()} disabled={!canSend}>
            {sending ? 'Sending…' : 'Send'}
          </button>
        )}
      </>
    );
  }

  return (
    <Sheet open onClose={onClose} title="Report a bug" subtitle={sent ? undefined : 'What went wrong? The page adds the game and its details itself.'} width={540} className="bug-sheet" footer={footer}>
      <div ref={wrap} {...{ [PANEL_ATTR]: '' }} className="bug-panel">
        {sent ? (
          <div className="bug-sent" role="status">
            <p className="bug-sent-head">Sent — thank you.</p>
            <p>
              Report <code className="bug-id">{sent.id}</code>
              {sent.screenshot ? ' (with a screenshot)' : ''} is saved {sent.via === 'room' ? 'on the room’s computer' : 'by the coach helper on this computer'}, in mtg-table’s <code>var/bugs/</code>.
            </p>
            <p className="muted small">It reaches the coordinator when play.sh exits, or with <code>node tools/bugs-sync.mjs --push</code>.</p>
          </div>
        ) : (
          <>
            <label className="bug-field">
              <span className="bug-label">Title</span>
              <input type="text" value={title} maxLength={MAX_TITLE} autoFocus placeholder="e.g. Pass did nothing after I cast a spell" onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && canSend && void send()} />
            </label>
            <label className="bug-field">
              <span className="bug-label">What happened, and what did you expect?</span>
              <textarea value={details} maxLength={MAX_DETAILS} rows={4} onChange={(e) => setDetails(e.target.value)} />
            </label>
            <div className="bug-field" role="radiogroup" aria-label="Severity">
              <span className="bug-label">Severity (optional)</span>
              <div className="bug-sev">
                {[null, ...SEVERITIES].map((s) => (
                  <button key={s ?? 'none'} type="button" role="radio" aria-checked={severity === s} className={cx('bug-sev-opt', severity === s && 'is-on')} onClick={() => setSeverity(s)}>
                    {s ? s[0]!.toUpperCase() + s.slice(1) : 'Not sure'}
                  </button>
                ))}
              </div>
            </div>
            <div className="bug-shot">
              <label className="bug-check">
                <input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} disabled={shot.kind !== 'ready'} />
                <span>
                  Attach a screenshot of this screen
                  {shot.kind === 'capturing' && <span className="muted"> — taking it…</span>}
                  {shot.kind === 'failed' && <span className="muted"> — this browser could not take one; paste or choose your own</span>}
                </span>
              </label>
              {shot.kind === 'ready' && attach && <img className="bug-thumb" src={`data:${shot.shot.thumb.mediaType};base64,${shot.shot.thumb.data}`} alt="The screenshot that will be attached" />}
              <p className="muted tiny">
                Wrong picture? Paste your own (Ctrl+V after your system’s screenshot key) or{' '}
                <label className="bug-file">
                  choose a file
                  <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && void takeImage(e.target.files[0], 'file')} />
                </label>
                .
              </p>
            </div>
            <details className="bug-adds">
              <summary>Added automatically</summary>
              <ul>
                {summary.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </details>
            <p className={cx('bug-route', friend && 'is-friend')}>{routeWords(route, friend)}</p>
            {result && !result.ok && (
              <p className="bug-error" role="alert">
                {result.message} {route ? 'You can still download the report.' : ''}
              </p>
            )}
            {problem && (
              <p className="bug-error" role="alert">
                {problem}
              </p>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
