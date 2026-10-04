/*
 * ForgeCoach — ui/AdviceFeedback.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * "Was this advice helpful?" under a finished coach answer: thumbs up / down
 * and, once voted, an optional one-line note. Stored in this browser only
 * (feedback.ts); Settings exports it as JSON.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { loadFeedback, MAX_NOTE, rate, ratingOf, saveFeedback, type AdviceFeedback as Entry, type AdviceVote, type FeedbackTarget } from '../feedback.ts';
import type { Answer } from './answers.ts';
import { cx } from './util.ts';

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

let cache: Entry[] | null = null;
const listeners = new Set<() => void>();
function snapshot(): Entry[] {
  return (cache ??= loadFeedback(storage()));
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function setFeedbackList(next: Entry[]): void {
  cache = next;
  saveFeedback(storage(), next);
  for (const l of listeners) l();
}
export function useFeedbackList(): Entry[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

const Thumb = ({ down }: { down?: boolean }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" style={down ? { transform: 'rotate(180deg)' } : undefined}>
    <path d="M7 10v10H4V10zM7 10l4-7c1.5 0 2.5 1 2.2 2.6L12.6 9H19a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.8 20H7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
  </svg>
);

export function AdviceFeedback({ target, answer }: { target: FeedbackTarget | null | undefined; answer: Answer | undefined }) {
  const list = useFeedbackList();
  const source = answer?.source ?? null;
  const model = answer?.model ?? null;
  const entry = target ? ratingOf(list, target, source, model) : null;
  const [note, setNote] = useState(entry?.note ?? '');
  const [savedNote, setSavedNote] = useState(false);
  useEffect(() => setNote(entry?.note ?? ''), [entry?.note]);
  if (!target || !answer || answer.status !== 'done' || !answer.text) return null;

  const vote = (v: AdviceVote) => setFeedbackList(rate(snapshot(), target, { source, model }, { vote: entry?.vote === v ? null : v }));
  const saveNote = () => {
    if (!entry) return;
    setFeedbackList(rate(snapshot(), target, { source, model }, { vote: entry.vote, note }));
    setSavedNote(true);
    setTimeout(() => setSavedNote(false), 1600);
  };
  return (
    <div className="advice-fb" role="group" aria-label="Was this advice helpful?">
      <div className="advice-fb-row">
        <span className="advice-fb-q tiny muted">Was this advice helpful?</span>
        <button type="button" className={cx('advice-fb-btn', entry?.vote === 'up' && 'is-on')} aria-pressed={entry?.vote === 'up'} aria-label="Helpful" title="Helpful" onClick={() => vote('up')}>
          <Thumb />
        </button>
        <button type="button" className={cx('advice-fb-btn', entry?.vote === 'down' && 'is-on is-down')} aria-pressed={entry?.vote === 'down'} aria-label="Not helpful" title="Not helpful" onClick={() => vote('down')}>
          <Thumb down />
        </button>
      </div>
      {entry && (
        <form
          className="advice-fb-note"
          onSubmit={(e) => {
            e.preventDefault();
            saveNote();
          }}
        >
          <input
            type="text"
            value={note}
            maxLength={MAX_NOTE}
            placeholder={entry.vote === 'up' ? 'What helped? (optional)' : 'What was wrong? (optional)'}
            aria-label="A one-line note (optional)"
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => (note.trim() || '') !== (entry.note ?? '') && saveNote()}
          />
          <span className="tiny muted advice-fb-saved" aria-live="polite">
            {savedNote ? 'Saved' : ''}
          </span>
        </form>
      )}
    </div>
  );
}
