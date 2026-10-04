/*
 * ForgeCoach — ui/play/GameOverCard.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The result, and what next: review this game, the next game of the match
 * (act newGame continue), or a fresh match (act newGame restart — protocol
 * §2.2 / M38: only `restart` produces a game once `matchOver` is true).
 */
import type { ReactNode } from 'react';
import type { OverBody } from '../../protocol.ts';
import { IconTrophy } from '../Icons.tsx';
import { cx } from '../util.ts';

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
          <div className="over-row">
            <button className="btn btn-quiet" onClick={onNext} disabled={!connected || over.matchOver || waitingNext} title={over.matchOver ? 'The match is over — start a new match instead' : 'The next game of this match'}>
              {waitingNext ? <span className="spinner spinner-sm" /> : null} Next game
            </button>
            <button className="btn btn-quiet" onClick={onRestart} disabled={!connected || waitingNext} title="A fresh match with the same decks">
              New match
            </button>
          </div>
          {!connected && (
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
            Back to start
          </button>
        </div>
        {filmRoom}
      </div>
    </div>
  );
}
