/*
 * ForgeCoach — ui/review/OptionBars.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * One decision's options as horizontal bars: the point (win rate, or the
 * short-horizon score for a leaf measure) with its 95% interval as a whisker,
 * on a fixed 0–100% axis labelled at both ends. The
 * player's choice, the engine's best and Forge's choice are said in words,
 * not only by colour.
 */
import type { GameStateBody } from '../../protocol.ts';
import { fmtInterval, fmtRate, fmtRegret, sameOption, tokenLabel, type ReviewDecision, type ReviewOption } from '../../gameReview.ts';
import { cx } from '../util.ts';

/**
 * The axis: always 0–100%. A zoomed axis would make a few points look like a
 * landslide; with intervals this wide, the full scale is the honest one.
 */
export function axisDomain(_options: ReviewOption[]): [number, number] {
  return [0, 1];
}

export function OptionBars({ d, state, seat }: { d: ReviewDecision; state: GameStateBody | null; seat: number }) {
  const opts = [...d.options].sort((a, b) => (b.winRate ?? -1) - (a.winRate ?? -1));
  const [lo, hi] = axisDomain(opts);
  const pos = (x: number) => `${(((Math.min(hi, Math.max(lo, x)) - lo) / (hi - lo)) * 100).toFixed(2)}%`;
  const m = d.measure;
  const what = m === 'wins' ? 'Win rate' : 'Short-horizon score';
  return (
    <div className="rv-bars">
      <div className="rv-bars-axis" aria-hidden="true">
        <span className="rv-axis-pad" />
        <div className="rv-axis-scale">
          <span>{fmtRate(lo, m)}</span>
          <span className="rv-bars-axis-name">{what} · 95% interval</span>
          <span>{fmtRate(hi, m)}</span>
        </div>
        <span className="rv-axis-pad" />
      </div>
      <ul className="rv-bars-list" aria-label={`${what} of each option`}>
      {opts.map((o) => {
        const played = o.played || sameOption(o, d.playedOption);
        const best = o.best || sameOption(o, d.best);
        const forge = o.forge || sameOption(o, d.forgeChoice);
        const label = tokenLabel(o.token, state, seat, o.label);
        const interval = fmtInterval(o.winLo, o.winHi, m);
        const marks = [played && 'You played', best && 'Engine best', forge && 'Forge’s choice'].filter(Boolean) as string[];
        return (
          <li key={o.token} className={cx('rv-bar', played && 'is-played', best && 'is-best')}>
            <div className="rv-bar-head">
              <span className="rv-bar-label">{label}</span>
              {marks.length > 0 && (
                <span className="rv-bar-marks">
                  {played && <span className="rv-mark rv-mark-played">You played</span>}
                  {best && <span className="rv-mark rv-mark-best">✓ Engine best</span>}
                  {forge && <span className="rv-mark rv-mark-forge">Forge’s choice</span>}
                </span>
              )}
            </div>
            <div
              className="rv-bar-track"
              role="img"
              aria-label={`${label}: ${what.toLowerCase()} ${fmtRate(o.winRate, m)}${interval ? `, interval ${interval}` : ''}${o.regret !== null && !best ? `, regret ${fmtRegret(o.regret, m)}` : ''}${marks.length ? ` (${marks.join(', ')})` : ''}`}
            >
              {o.winRate !== null && <span className="rv-bar-fill" style={{ width: pos(o.winRate) }} />}
              {o.winLo !== null && o.winHi !== null && (
                <span className="rv-bar-whisker" style={{ left: pos(o.winLo), width: `calc(${pos(o.winHi)} - ${pos(o.winLo)})` }} />
              )}
              {o.winRate !== null && <span className="rv-bar-dot" style={{ left: pos(o.winRate) }} />}
            </div>
            <div className="rv-bar-nums" aria-hidden="true">
              <b>{fmtRate(o.winRate, m)}</b>
              {interval && <span className="muted"> ({interval})</span>}
              {!best && o.regret !== null && (
                <span className="rv-bar-regret">
                  {' '}
                  · regret {fmtRegret(o.regret, m)}
                  {o.regretLo !== null && o.regretHi !== null && <span className="muted"> ({fmtInterval(o.regretLo, o.regretHi, m, 'regret')})</span>}
                </span>
              )}
              {o.n !== null && <span className="muted tiny"> · n={o.n}</span>}
            </div>
          </li>
        );
      })}
      </ul>
    </div>
  );
}
