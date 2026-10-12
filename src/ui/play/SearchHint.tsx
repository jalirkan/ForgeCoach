/*
 * ForgeCoach — ui/play/SearchHint.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * "What would the search AI do?" in the decision slot (mtg-table D429,
 * searchHint.ts): a button, never automatic, shown only when the engine on
 * your PC offers hints (its /health says `hint: 1`), in a game against the
 * bot, at a decision the engine can judge (main-phase spells, attacks,
 * blocks, targets). S asks too. While it runs: "Search AI thinking…". Then
 * one line — the pick in board words and how sure it is ("clearly best", or
 * the runner-up and "too close to call") — and the caveat: it knows only what
 * you know. The cards it names glow on the board (`data-search-pick`) until
 * the decision changes.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameStateBody, InputBody } from '../../protocol.ts';
import type { GameLog } from '../../log.ts';
import { pageHelperTarget } from '../../coachHelper.ts';
import { askHint, hintCardIds, hintDecisionKey, hintMoment, hintSupported, hintWords, isRefused, type SearchHint as Hint } from '../../searchHint.ts';
import { opponentFields } from '../review/useReviewRun.ts';
import { IconSpark } from '../Icons.tsx';
import { cx } from '../util.ts';
import './searchHint.css';

export const HINT_BUTTON = 'What would the search AI do?';
export const HINT_THINKING = 'Search AI thinking…';
export const HINT_TITLE = 'The engine on your PC plays this decision out for a few seconds and says what it would do (S)';

type Phase = { key: string; state: 'idle' } | { key: string; state: 'thinking' } | { key: string; state: 'done'; hint: Hint } | { key: string; state: 'error'; message: string };

/** Is the helper offering hints? Asked once, and again every 20 s while it says no (a PC started later). */
function useHintAvailable(on: boolean): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    if (!on) return;
    let live = true;
    const check = () => void hintSupported(pageHelperTarget()).then((v) => live && setOk(v));
    check();
    const t = setInterval(() => {
      if (!ok) check();
    }, 20_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [on, ok]);
  return on && ok;
}

/** Marks the pick's cards on the board; React never sets this attribute, so a re-render keeps it. */
function useBoardMarks(ids: number[], version: unknown) {
  const sig = ids.join(',');
  useEffect(() => {
    if (!sig || typeof document === 'undefined') return;
    const marked: Element[] = [];
    for (const id of sig.split(',')) {
      document.querySelectorAll(`.game [data-card-id="${id}"]`).forEach((el) => {
        el.setAttribute('data-search-pick', '1');
        marked.push(el);
      });
    }
    return () => marked.forEach((el) => el.removeAttribute('data-search-pick'));
  }, [sig, version]);
}

export function SearchHint({
  log,
  state,
  input,
  seat,
  askOpen,
  enabled,
}: {
  log: GameLog | null;
  state: GameStateBody | null;
  input: InputBody | null;
  seat: number | null;
  /** A question is open: S belongs to it. */
  askOpen: boolean;
  /** A game against the bot, still going (never at a table of two). */
  enabled: boolean;
}) {
  const available = useHintAvailable(enabled);
  const key = enabled ? hintDecisionKey(state, input, seat, hintMoment(log)?.stateSeq ?? null) : null;
  const [phase, setPhase] = useState<Phase | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  // A new decision drops the last answer (and stops a question still running).
  useEffect(() => {
    ctrl.current?.abort();
    ctrl.current = null;
    setPhase(key ? { key, state: 'idle' } : null);
  }, [key]);
  useEffect(() => () => ctrl.current?.abort(), []);

  const latest = useRef({ log, seat, key });
  latest.current = { log, seat, key };
  const ask = useCallback(async () => {
    const { log: lg, seat: st, key: k } = latest.current;
    const moment = hintMoment(lg);
    const gameId = lg?.header?.gameId ?? null;
    if (!k || !lg || !moment || !gameId || (st !== 0 && st !== 1)) return;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setPhase({ key: k, state: 'thinking' });
    const opp = await opponentFields(lg);
    if (c.signal.aborted) return;
    const r = await askHint(pageHelperTarget(), { gameId, seat: st, stateSeq: moment.stateSeq, ...(moment.inputSeq ? { inputSeq: moment.inputSeq } : {}), ...opp }, undefined, c.signal);
    if (c.signal.aborted || latest.current.key !== k) return;
    if (isRefused(r)) {
      if (r.code === 'superseded') return; // a newer question for this game is on its way
      setPhase({ key: k, state: 'error', message: r.message });
      return;
    }
    setPhase({ key: k, state: 'done', hint: r });
  }, []);

  const shown = available && !!key && !!phase && phase.key === key;
  // S asks, while the button is there and nothing else wants the key.
  useEffect(() => {
    if (!shown || askOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 's' || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      const t = e.target as HTMLElement | null;
      const tag = (t?.tagName ?? '').toLowerCase();
      if (t?.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (phase?.state === 'thinking') return;
      e.preventDefault();
      void ask();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shown, askOpen, phase?.state, ask]);

  const done = shown && phase.state === 'done' ? phase.hint : null;
  useBoardMarks(hintCardIds(done), state);

  if (!shown) return null;
  if (phase.state === 'idle') {
    return (
      <div className="ds-hint" data-search-hint="idle">
        <button type="button" className="ds-hint-btn" onClick={() => void ask()} title={HINT_TITLE}>
          <IconSpark size={13} />
          <span>{HINT_BUTTON}</span>
          <kbd className="ds-kbd" aria-hidden="true">
            S
          </kbd>
        </button>
      </div>
    );
  }
  if (phase.state === 'thinking') {
    return (
      <div className="ds-hint" data-search-hint="thinking" role="status" aria-live="polite">
        <span className="ds-hint-line is-thinking">
          <span className="spinner spinner-sm" aria-hidden="true" />
          {HINT_THINKING}
        </span>
      </div>
    );
  }
  if (phase.state === 'error') {
    return (
      <div className="ds-hint" data-search-hint="error" role="status">
        <span className="ds-hint-line is-error">{phase.message}</span>
        <button type="button" className="ds-hint-again" onClick={() => void ask()}>
          Try again
        </button>
      </div>
    );
  }
  const w = hintWords(phase.hint, state, seat);
  return (
    <div className="ds-hint" data-search-hint="done" role="status" aria-live="polite">
      <div className="ds-hint-line is-answer" title={`${w.line}${w.strength ? ` — ${w.strength}` : ''}`}>
        <span className="ds-hint-k">Search AI</span> <span className="ds-hint-pick">{w.line}</span>
        {w.strength && (
          <>
            {' — '}
            <span className={cx('ds-hint-strength', `is-${phase.hint.strength}`)}>{w.strength}</span>
          </>
        )}
      </div>
      <div className="ds-hint-caveat" title={w.caveatLong}>
        {w.caveat}
      </div>
    </div>
  );
}
