/*
 * ForgeCoach — ui/draft/Panels.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The pieces around the draft board: the DECISION panel (desktop, left
 * column) and the thumb dock (phone, bottom) that carry the one big gold
 * action; the opponent's panel (the AI's public picks in Grid, only what you
 * saw in Winston); the AI's banner; and the quiet pick help.
 */
import type { ReactNode } from 'react';
import type { CubeContext } from '../../cube/score.ts';
import { describeEvent, type Draft, type DraftEvent } from '../../draft/draft.ts';
import { IconSpark } from '../Icons.tsx';
import { cx } from '../util.ts';
import { BackStack } from './DCard.tsx';
import { PoolSummary } from './Pool.tsx';

export interface Action {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Keyboard hint shown on the button (desktop). */
  kbd?: string;
}

export interface DecisionModel {
  kicker: string;
  title: string;
  sub?: string;
  status?: string | null;
  primary?: Action;
  secondary?: Action;
  waiting?: boolean;
}

export function DecisionPanel({ m }: { m: DecisionModel }) {
  return (
    <section className={cx('decision', m.waiting && 'is-waiting')} aria-live="polite">
      <div className="ribbon">
        <span>{m.waiting ? 'Opponent' : 'Decision'}</span>
      </div>
      <div className="decision-body">
        <div className="fx-label decision-kicker">{m.kicker}</div>
        <h2 className="decision-title">{m.title}</h2>
        {m.sub && <p className="decision-sub">{m.sub}</p>}
        {m.status && (
          <p className="decision-status">
            <span className="dot" /> {m.status}
          </p>
        )}
        {(m.primary || m.secondary) && (
          <div className="decision-btns">
            {m.primary && (
              <button className="btn-gold" onClick={m.primary.onClick} disabled={m.primary.disabled}>
                {m.primary.label}
                {m.primary.kbd && <kbd>{m.primary.kbd}</kbd>}
              </button>
            )}
            {m.secondary && (
              <button className="btn-line" onClick={m.secondary.onClick} disabled={m.secondary.disabled}>
                {m.secondary.label}
                {m.secondary.kbd && <kbd>{m.secondary.kbd}</kbd>}
              </button>
            )}
          </div>
        )}
        {m.waiting && (
          <p className="decision-wait">
            <span className="wwait-dot" /> The AI is thinking…
          </p>
        )}
      </div>
    </section>
  );
}

/** Phone: the action at the bottom, under the thumb. */
export function Dock({ m, pool, onPool, extra }: { m: DecisionModel; pool: number; onPool: () => void; extra?: ReactNode }) {
  return (
    <div className="dock">
      <div className="dock-line">
        <span className="dock-title">
          {m.status ? (
            <>
              <span className="dot" /> {m.status}
            </>
          ) : (
            m.title
          )}
        </span>
        {extra}
      </div>
      <div className="dock-row">
        {m.waiting ? (
          <div className="dock-wait">
            <span className="wwait-dot" /> The AI is deciding…
          </div>
        ) : (
          <>
            {m.primary && (
              <button className="btn-gold dock-main" onClick={m.primary.onClick} disabled={m.primary.disabled}>
                {m.primary.label}
              </button>
            )}
            {m.secondary && (
              <button className="btn-line dock-second" onClick={m.secondary.onClick} disabled={m.secondary.disabled}>
                {m.secondary.label}
              </button>
            )}
          </>
        )}
        <button className="dock-pool" onClick={onPool} aria-label={`Your pool, ${pool} cards`}>
          <span className="fx-label">Pool</span>
          <b>{pool}</b>
        </button>
      </div>
    </div>
  );
}

export function AiBanner({ e }: { e: DraftEvent | null }) {
  if (!e || e.who !== 'ai') return null;
  return (
    <div className={cx('aibanner', e.kind !== 'pass' && 'is-take')} role="status" key={e.n}>
      <span className="aibanner-mark">AI</span>
      <span>{describeEvent(e)}</span>
    </div>
  );
}

export function OppPanel({
  d,
  ctx,
  known,
  onInfo,
  onOpen,
  compact,
}: {
  d: Draft;
  ctx: CubeContext;
  known: string[];
  onInfo: (n: string) => void;
  onOpen: () => void;
  compact?: boolean;
}) {
  const total = d.picks.ai.length;
  const unseen = total - known.length;
  const feed = d.log.filter((e) => e.who === 'ai' && (d.format === 'grid' || e.kind !== 'pass')).slice(-4).reverse();
  if (compact) {
    return (
      <button className="opp-strip" onClick={onOpen} aria-label={`The AI: ${total} cards, ${known.length} known`}>
        <span className="avatar is-bot sm">
          <span>AI</span>
        </span>
        <span className="opp-strip-name">Forge AI</span>
        <span className="opp-strip-stat">
          <b>{total}</b> cards
        </span>
        {d.format === 'winston' && (
          <span className="opp-strip-stat">
            <b>{known.length}</b> known
          </span>
        )}
      </button>
    );
  }
  return (
    <section className="opp">
      <div className="opp-head">
        <span className="avatar is-bot">
          <span>AI</span>
        </span>
        <div>
          <div className="fx-label">Opponent · Bot</div>
          <div className="opp-name">Forge AI</div>
        </div>
        <div className="opp-count">
          <b>{total}</b>
          <span className="fx-label">cards</span>
        </div>
      </div>
      {d.format === 'winston' && (
        <div className="opp-known">
          <BackStack n={unseen} className="sm" />
          <p className="small">
            You’ve seen <b>{known.length}</b> of its {total} cards. The rest it took blind or from piles you never looked at.
          </p>
        </div>
      )}
      {feed.length > 0 && (
        <ul className="opp-feed">
          {feed.map((e) => (
            <li key={e.n}>{describeEvent(e)}</li>
          ))}
        </ul>
      )}
      <PoolSummary pool={known} ctx={ctx} onOpen={onOpen} onInfo={onInfo} title={d.format === 'grid' ? 'Its picks' : 'Known cards'} />
    </section>
  );
}

export function PickHelp({ title, lines, onCoach }: { title: string | null; lines: string[]; onCoach: () => void }) {
  return (
    <section className="phelp">
      <div className="phelp-h">
        <span className="fx-label">
          <IconSpark size={12} /> Pick help
        </span>
        <button className="pill is-gold" onClick={onCoach}>
          Ask the coach
        </button>
      </div>
      {title ? (
        <>
          <p className="phelp-call">{title}</p>
          {lines.length > 0 && (
            <details className="phelp-why">
              <summary>Why</summary>
              <ul>
                {lines.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      ) : (
        <p className="quiet-italic">Turn on hints for the pick helper’s call.</p>
      )}
    </section>
  );
}
