/*
 * ForgeCoach — ui/winchance/WinChance.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The win chance on screen (mtg-table D361): a slim strip while playing, and a
 * line over a replay's or an engine review's timeline with markers where the
 * estimate fell after one of the player's decisions. Both say what the number
 * is — a local model's estimate, trained on Forge-vs-Forge games — and neither
 * is drawn when the setting is off or the helper has no model (the callers
 * check `useWinChanceModel`). Colours are the skins' tokens (winchance.css).
 *
 * mtg-table D368: when the helper averages several models, the strip says
 * "62% ± 6" and the line carries a faint band of ± one sd; when it explains,
 * each drop marker says why it fell ("your board −9, cards in hand −4"), and
 * `WinDropWhy` is that line on its own for any screen that wants it.
 */
import './winchance.css';
import type { CSSProperties } from 'react';
import { band, bandWords, dropKey, pct, pctBand, points as signedPoints, whyWords, type TurnChange, type WhyItem, type WinDrop, type WinPoint } from '../../winChance.ts';
import { cx } from '../util.ts';

export const WC_LABEL = 'Win chance';
/** How many falls the line lists with their "why" (the largest; every marker's title says its own). */
export const WHY_LIST = 3;
export const WC_SOURCE = '(local model, Forge-vs-Forge trained)';
export const WC_TIP =
  'An estimate, not a fact. A model trained on your PC on games Forge’s AI played against itself scores the position your board shows: ' +
  'your hand, both battlefields, graveyards and exile, life, and how many cards are in the hidden zones. It never sees the opponent’s hand or ' +
  'either library, and positions unlike Forge’s own games can fool it.';

function Label({ compact }: { compact?: boolean }) {
  return (
    <span className="wc-label" title={WC_TIP}>
      <span className="wc-name">{WC_LABEL}</span>{' '}
      <span className={cx('wc-source', compact && 'is-compact')}>
        {WC_SOURCE}
        <span className="wc-info" aria-hidden="true">
          i
        </span>
      </span>
      <span className="wc-sr">. {WC_TIP}</span>
    </span>
  );
}

/**
 * Why the estimate fell, in a line: "Why: your board −9, cards in hand −4".
 * Nothing when there is nothing to say. For the drop list here, and for any
 * screen (the film room) that holds a drop's `WhyItem`s (useDropWhy).
 */
export function WinDropWhy({ items, className }: { items: readonly WhyItem[] | undefined; className?: string }) {
  const words = items ? whyWords(items) : '';
  if (!words) return null;
  return (
    <span className={cx('wc-why', className)} title="The parts of the position that moved the estimate most between the two positions around this fall, in points (the model’s own account of its number, not a rule of the game).">
      <span className="wc-why-k">Why:</span> {words}
    </span>
  );
}

/** While playing: the newest estimate, a meter, and the change since the previous turn. */
export function WinChanceStrip({ change, busy, error, compact, models = 1 }: { change: TurnChange | null; busy: boolean; error: string | null; compact?: boolean; models?: number }) {
  const p = change?.now.p ?? null;
  const sd = change?.now.sd;
  const delta = change?.delta ?? null;
  const style = { '--wc-p': p === null ? 0 : Math.max(0.01, p) } as CSSProperties;
  return (
    <div className={cx('wc wc-strip', compact && 'is-compact', busy && 'is-busy')} role="group" aria-label={`${WC_LABEL} ${WC_SOURCE}`}>
      <Label compact={compact} />
      <div className="wc-strip-row">
        <div
          className="wc-meter"
          role="meter"
          aria-label={WC_LABEL}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={p === null ? undefined : Math.round(p * 100)}
          aria-valuetext={p === null ? 'not scored yet' : `${pctBand(p, sd)}, an estimate`}
          style={style}
        >
          {p !== null && <span className="wc-fill" />}
          <span className="wc-mid" aria-hidden="true" />
        </div>
        <span className="wc-num" title={sd === undefined ? WC_TIP : `${WC_TIP} ${bandWords(sd, models)}`}>
          {p === null ? '—' : pct(p)}
          {p !== null && sd !== undefined && <span className="wc-band-n"> {band(sd)}</span>}
        </span>
        {delta !== null && change?.before && (
          <span
            className={cx('wc-delta', Math.round(delta * 100) > 0 ? 'is-up' : Math.round(delta * 100) < 0 ? 'is-down' : 'is-flat')}
            title={`Change since turn ${change.before.turn} (${pct(change.before.p)} then)`}
          >
            {signedPoints(delta)}
          </span>
        )}
      </div>
      {error && p === null && <span className="wc-error tiny">{error}</span>}
    </div>
  );
}

export interface ChartPosition {
  frameIndex: number;
  turn: number;
}

/**
 * The whole game: x is the order of the scored positions (the viewing seat's
 * decision rows), y the estimate, 50% dashed. `drops` are marked; a marker is a
 * button that calls `onMarker` with the drop's id.
 */
export function WinChanceChart({
  positions,
  points,
  drops,
  current,
  done,
  error,
  onMarker,
  threshold,
  why,
}: {
  positions: readonly ChartPosition[];
  points: readonly WinPoint[];
  drops: readonly WinDrop[];
  /** The frame on the board now (the cursor sits at the newest position at or before it). */
  current: number | null;
  done: boolean;
  error: string | null;
  onMarker: (id: number) => void;
  /** The marker threshold, in points, for the legend. */
  threshold: number;
  /** mtg-table D368: why each drop fell, by `dropKey` (useDropWhy); absent when the helper does not explain. */
  why?: ReadonlyMap<string, readonly WhyItem[]>;
}) {
  const n = positions.length;
  const xOf = new Map<number, number>();
  positions.forEach((p, i) => xOf.set(p.frameIndex, n > 1 ? (i / (n - 1)) * 100 : 50));
  const H = 40;
  const yOf = (p: number) => (1 - p) * H;
  // The line, broken where a position is not scored (yet).
  const byFrame = new Map(points.map((p) => [p.frameIndex, p]));
  const runs: string[] = [];
  let run: string[] = [];
  for (const pos of positions) {
    const pt = byFrame.get(pos.frameIndex);
    if (pt) run.push(`${xOf.get(pos.frameIndex)!.toFixed(2)},${yOf(pt.p).toFixed(2)}`);
    else if (run.length) {
      runs.push(run.join(' '));
      run = [];
    }
  }
  if (run.length) runs.push(run.join(' '));
  // D368: ± one sd of the models, a faint band under the line, where the answers carry one.
  const bands: string[] = [];
  let up: string[] = [];
  let down: string[] = [];
  const flush = () => {
    if (up.length > 1) bands.push([...up, ...down.reverse()].join(' '));
    up = [];
    down = [];
  };
  for (const pos of positions) {
    const pt = byFrame.get(pos.frameIndex);
    if (pt && pt.sd !== undefined) {
      const x = xOf.get(pos.frameIndex)!.toFixed(2);
      up.push(`${x},${yOf(Math.min(1, pt.p + pt.sd)).toFixed(2)}`);
      down.push(`${x},${yOf(Math.max(0, pt.p - pt.sd)).toFixed(2)}`);
    } else flush();
  }
  flush();
  const turnTicks: { x: number; turn: number }[] = [];
  positions.forEach((p, i) => {
    if (i > 0 && p.turn !== positions[i - 1]!.turn) turnTicks.push({ x: ((xOf.get(p.frameIndex)! + xOf.get(positions[i - 1]!.frameIndex)!) / 2), turn: p.turn });
  });
  let cursor: number | null = null;
  if (current !== null) for (const p of positions) if (p.frameIndex <= current) cursor = xOf.get(p.frameIndex)!;
  const scored = points.length;
  const curPoint = current === null ? null : [...points].filter((p) => p.frameIndex <= current).pop() ?? null;

  return (
    <section className="wc wc-chart" aria-label={`${WC_LABEL} ${WC_SOURCE}`}>
      <div className="wc-chart-head">
        <Label compact />
        <span className="wc-chart-now">
          {curPoint ? (
            <>
              <b className="wc-num">{pct(curPoint.p)}</b>
              {curPoint.sd !== undefined && <span className="wc-band-n tiny"> {band(curPoint.sd)}</span>} <span className="muted tiny">turn {curPoint.turn}</span>
            </>
          ) : null}
        </span>
      </div>
      {n === 0 ? (
        <p className="wc-empty tiny muted">No position of yours to score in this game yet.</p>
      ) : (
        <div className="wc-plot">
          <svg className="wc-svg" viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" aria-hidden="true">
            <line className="wc-half" x1="0" x2="100" y1={H / 2} y2={H / 2} />
            {turnTicks.map((t) => (
              <line key={`${t.x}-${t.turn}`} className="wc-turn" x1={t.x} x2={t.x} y1="0" y2={H} />
            ))}
            {bands.map((b, i) => (
              <polygon key={`b${i}`} className="wc-band" points={b} />
            ))}
            {runs.map((r, i) => (
              <polyline key={i} className="wc-area" points={`${r.split(' ')[0]!.split(',')[0]},${H} ${r} ${r.split(' ').slice(-1)[0]!.split(',')[0]},${H}`} />
            ))}
            {runs.map((r, i) => (
              <polyline key={`l${i}`} className="wc-line" points={r} />
            ))}
            {cursor !== null && <line className="wc-cursor" x1={cursor} x2={cursor} y1="0" y2={H} />}
          </svg>
          <span className="wc-axis wc-axis-top tiny" aria-hidden="true">
            100%
          </span>
          <span className="wc-axis wc-axis-mid tiny" aria-hidden="true">
            50%
          </span>
          {drops.map((d) => {
            const x0 = xOf.get(d.before.frameIndex);
            const x1 = xOf.get(d.after.frameIndex);
            if (x0 === undefined || x1 === undefined) return null;
            const because = why ? whyWords(why.get(dropKey(d)) ?? []) : '';
            const words = `Fell ${Math.round(d.drop * 100)} points after your decision on turn ${d.before.turn}: ${pct(d.before.p)} → ${pct(d.after.p)}.${because ? ` Why: ${because}.` : ''} Go to it.`;
            return (
              <button
                key={`${d.id}-${d.after.frameIndex}`}
                type="button"
                className="wc-marker"
                style={{ left: `${(x0 + x1) / 2}%`, top: `${(yOf(d.after.p) / H) * 100}%` }}
                title={`${words} The opponent’s moves in between count too.`}
                aria-label={words}
                onClick={() => onMarker(d.id)}
              >
                <span className="wc-marker-n">{signedPoints(-d.drop)}</span>
              </button>
            );
          })}
        </div>
      )}
      {why && why.size > 0 && (
        <ul className="wc-whys tiny" aria-label="Why the estimate fell most">
          {[...drops].sort((a, b) => b.drop - a.drop || a.after.frameIndex - b.after.frameIndex).filter((d) => whyWords(why.get(dropKey(d)) ?? []) !== '').slice(0, WHY_LIST).map((d) => {
            const items = why.get(dropKey(d));
            if (!items || !whyWords(items)) return null;
            return (
              <li key={dropKey(d)}>
                <button type="button" className="wc-why-go" onClick={() => onMarker(d.id)} title="Go to this decision">
                  <span className="wc-why-drop">{signedPoints(-d.drop)}</span> turn {d.before.turn}
                </button>{' '}
                <WinDropWhy items={items} />
              </li>
            );
          })}
        </ul>
      )}
      <p className="wc-legend tiny muted">
        {!done && n > 0 ? `Scoring your positions… ${scored}/${n}. ` : ''}
        {drops.length > 0
          ? `Markers: the estimate fell ${threshold} points or more after one of your decisions (the opponent’s moves in between count too). Click one to go there.`
          : done && n > 0
            ? `No fall of ${threshold} points or more after one of your decisions.`
            : ''}
        {error && !done ? ` ${error}` : ''}
      </p>
    </section>
  );
}
