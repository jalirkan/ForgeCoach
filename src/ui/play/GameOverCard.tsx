/*
 * ForgeCoach — ui/play/GameOverCard.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The result, and what next: review this game, the next game of the match
 * (act newGame continue), or a fresh match (act newGame restart — protocol
 * §2.2 / M38: only `restart` produces a game once `matchOver` is true).
 *
 * At a table of two (mtg-table M59) the bridge refuses `newGame`: the room runs
 * the best of three (D406), so the card says where the match stands and the way
 * back to the room (sideboard, or keep the deck, for the next game). The engine
 * review is this player's own, from the room (D407): the card says where it is
 * and opens it when it is done; the helper's own review run is not offered.
 */
import type { ReactNode } from 'react';
import type { OverBody } from '../../protocol.ts';
import { IconTrophy } from '../Icons.tsx';
import { cx } from '../util.ts';
import type { FriendReviewView } from './useFriendReview.ts';

const FRIEND_REVIEW_WORDS: Record<string, string> = {
  waiting: 'Your engine review is waiting to be queued on the room’s computer.',
  queued: 'Your engine review is queued on the room’s computer: it runs when that computer is idle.',
  running: 'Your engine review is running on the room’s computer…',
  failed: 'Your engine review failed',
  off: 'Your seat of this game was not recorded, so there is no engine review of it.',
};

/** D407: this player's own engine review of a game with a friend. */
export function FriendReviewLine({ review }: { review: FriendReviewView }) {
  if (review.state === 'done') {
    return (
      <button className="btn btn-quiet" onClick={review.open ?? undefined} disabled={!review.open || review.opening} title="The engine grades every decision you made — your review only">
        {review.opening ? <span className="spinner spinner-sm" /> : null} Your engine review: grade every decision
      </button>
    );
  }
  const busy = review.state === 'waiting' || review.state === 'queued' || review.state === 'running';
  return (
    <p className="tiny muted over-review" role="status">
      {busy ? <span className="spinner spinner-sm" /> : null} {FRIEND_REVIEW_WORDS[review.state]}
      {review.state === 'failed' && review.why ? `: ${review.why}` : ''}
      {busy ? ' It appears here and in the room when it is done.' : ''}
    </p>
  );
}

const REASONS: Record<string, string> = {
  AllOpponentsLost: 'Every opponent lost.',
  Conceded: 'Conceded.',
  Draw: 'The game was a draw.',
};

export function GameOverCard({
  over,
  seat,
  oppName,
  connected,
  waitingNext,
  onReview,
  onEngineReview,
  onNext,
  onRestart,
  onReconnect,
  onLeave,
  filmRoom = null,
  vsHuman = false,
  leaveLabel = 'Back to the start',
  matchLine = null,
  friendReview = null,
}: {
  over: OverBody;
  seat: number | null;
  oppName: string;
  connected: boolean;
  waitingNext: boolean;
  onReview: () => void;
  /** The engine's grade of every decision (ui/review). */
  onEngineReview?: () => void;
  onNext: () => void;
  onRestart: () => void;
  /**
   * Connect again (the session's `reconnect`), for an engine started again after
   * it closed at the result. The card covers the top bar's Reconnect on a desktop.
   */
  onReconnect?: () => void;
  onLeave: () => void;
  /** The film room (ui/filmroom): the game's turning points, under the actions. */
  filmRoom?: ReactNode;
  /** A game between two people (M59): no next game, no new match. */
  vsHuman?: boolean;
  leaveLabel?: string;
  /** D406: where the best of three stands after this game (a table of two). */
  matchLine?: string | null;
  /** D407: this player's own engine review of a game with a friend. */
  friendReview?: FriendReviewView | null;
}) {
  const won = over.winner !== null && over.winner === seat;
  const draw = over.winner === null;
  const headline = draw ? (over.reason === null ? 'No result' : 'Draw') : won ? 'You won' : 'You lost';
  const sub = draw
    ? over.reason === null
      ? 'The session ended before the engine published an outcome.'
      : 'Nobody won this one.'
    : won
      ? `You beat ${oppName}.`
      : `${oppName} won this game.`;
  return (
    <div className="over-wrap" role="dialog" aria-label="Game over">
      <div className={cx('over-card', won ? 'is-win' : draw ? 'is-draw' : 'is-loss', !!filmRoom && 'has-film')}>
        <div className="over-icon">
          <IconTrophy size={26} />
        </div>
        <h2 className="over-title">{headline}</h2>
        <p className="over-sub">
          {sub} {over.reason && REASONS[over.reason] && over.reason !== 'AllOpponentsLost' ? REASONS[over.reason] : ''}
        </p>
        <div className="over-actions">
          <button className="btn btn-primary over-main" onClick={onReview}>
            Review this game with the coach
          </button>
          {onEngineReview && (
            <button className="btn btn-quiet" onClick={onEngineReview} title="The engine grades every decision you made: what each option was worth">
              Engine review: grade every decision
            </button>
          )}
          {!vsHuman && (
          <div className="over-row">
            <button className="btn btn-quiet" onClick={onNext} disabled={!connected || over.matchOver || waitingNext} title={over.matchOver ? 'The match is over — start a new match instead' : 'The next game of this match'}>
              {waitingNext ? <span className="spinner spinner-sm" /> : null} Next game
            </button>
            <button className="btn btn-quiet" onClick={onRestart} disabled={!connected || waitingNext} title="A fresh match with the same decks">
              New match
            </button>
          </div>
          )}
          {vsHuman && friendReview && <FriendReviewLine review={friendReview} />}
          {vsHuman && matchLine && <p className="over-match" role="status">{matchLine}</p>}
          {vsHuman && !matchLine && <p className="tiny muted">A rematch: both of you hand the room a deck again — the same or changed.</p>}
          {!connected && !vsHuman && (
            <p className="tiny muted">
              The engine has disconnected — start it again to play on.
              {onReconnect && (
                <>
                  {' '}
                  <button className="link-btn over-reconnect" onClick={onReconnect}>
                    Reconnect
                  </button>
                </>
              )}
            </p>
          )}
          <button className="link-btn over-leave" onClick={onLeave}>
            {leaveLabel}
          </button>
        </div>
        {filmRoom}
      </div>
    </div>
  );
}
