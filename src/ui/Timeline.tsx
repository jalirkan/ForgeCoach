/*
 * ForgeCoach — ui/Timeline.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The decision list (desktop sidebar / phone sheet) and the phone scrubber
 * dock. Items are memoised: moving the selection re-renders two rows.
 */
import { memo, useEffect, useMemo, useRef } from 'react';
import type { Decision } from '../decisions.ts';
import { phaseLabel } from '../decisions.ts';
import { IconChevronLeft, IconChevronRight, IconList, KindIcon } from './Icons.tsx';
import type { StateFrame } from './util.ts';
import { cx } from './util.ts';

export type ScrubMode = 'decisions' | 'frames';

export function stripRound(label: string): string {
  return label.replace(/^R\d+\s*·\s*/, '');
}

export function actionsSummary(d: Decision): string {
  if (d.actions.length === 0) return 'No action recorded';
  return d.actions.join(' · ');
}

interface ListProps {
  mode: ScrubMode;
  onMode: (m: ScrubMode) => void;
  decisions: Decision[];
  frames: StateFrame[];
  index: number;
  onSelect: (i: number) => void;
  answered: (i: number) => boolean;
  seat: number;
}

export function TimelineList(props: ListProps) {
  const { mode, onMode, decisions, frames } = props;
  return (
    <div className="timeline">
      <div className="timeline-head">
        <div className="seg" role="tablist" aria-label="Timeline mode">
          <button role="tab" aria-selected={mode === 'decisions'} className={cx(mode === 'decisions' && 'is-on')} onClick={() => onMode('decisions')}>
            Decisions <span className="seg-n">{decisions.length}</span>
          </button>
          <button role="tab" aria-selected={mode === 'frames'} className={cx(mode === 'frames' && 'is-on')} onClick={() => onMode('frames')}>
            All states <span className="seg-n">{frames.length}</span>
          </button>
        </div>
      </div>
      <div className="timeline-scroll">
        {mode === 'decisions' ? <DecisionList {...props} /> : <FrameList {...props} />}
      </div>
    </div>
  );
}

function groupByRound<T>(items: T[], round: (t: T) => number): { round: number; items: { item: T; i: number }[] }[] {
  const out: { round: number; items: { item: T; i: number }[] }[] = [];
  items.forEach((item, i) => {
    const r = round(item);
    let g = out[out.length - 1];
    if (!g || g.round !== r) {
      g = { round: r, items: [] };
      out.push(g);
    }
    g.items.push({ item, i });
  });
  return out;
}

function DecisionList({ decisions, index, onSelect, answered }: ListProps) {
  const groups = useMemo(() => groupByRound(decisions, (d) => d.state.round || 0), [decisions]);
  if (decisions.length === 0) {
    return <div className="timeline-empty">No decisions in this log yet. Switch to “All states” to browse every frame.</div>;
  }
  return (
    <>
      {groups.map((g) => (
        <section key={g.round} className="tl-group">
          <h3 className="tl-round">{g.round === 0 ? 'Pre-game' : `Round ${g.round}`}</h3>
          <ol className="tl-items">
            {g.items.map(({ item, i }) => (
              <DecisionItem key={i} d={item} i={i} selected={i === index} answered={answered(i)} onSelect={onSelect} />
            ))}
          </ol>
        </section>
      ))}
    </>
  );
}

const DecisionItem = memo(function DecisionItem({
  d,
  i,
  selected,
  answered,
  onSelect,
}: {
  d: Decision;
  i: number;
  selected: boolean;
  answered: boolean;
  onSelect: (i: number) => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  return (
    <li ref={ref}>
      <button className={cx('tl-item', `k-${d.kind}`, selected && 'is-sel')} onClick={() => onSelect(i)} aria-current={selected ? 'step' : undefined}>
        <span className="tl-icon">
          <KindIcon kind={d.kind} size={13} />
        </span>
        <span className="tl-text">
          <span className="tl-label">
            {stripRound(d.label)}
            {answered && <span className="tl-dot" title="Coach answered" />}
          </span>
          <span className="tl-did">{actionsSummary(d)}</span>
        </span>
      </button>
    </li>
  );
});

function FrameList({ frames, index, onSelect, seat }: ListProps) {
  const groups = useMemo(() => groupByRound(frames, (f) => f.state.round || 0), [frames]);
  return (
    <>
      {groups.map((g) => (
        <section key={g.round} className="tl-group">
          <h3 className="tl-round">{g.round === 0 ? 'Pre-game' : `Round ${g.round}`}</h3>
          <ol className="tl-items">
            {g.items.map(({ item, i }) => (
              <FrameItem key={i} f={item} i={i} selected={i === index} onSelect={onSelect} seat={seat} />
            ))}
          </ol>
        </section>
      ))}
    </>
  );
}

const FrameItem = memo(function FrameItem({
  f,
  i,
  selected,
  onSelect,
  seat,
}: {
  f: StateFrame;
  i: number;
  selected: boolean;
  onSelect: (i: number) => void;
  seat: number;
}) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  const s = f.state;
  const whose = s.activePlayer === null ? '' : s.activePlayer === seat ? 'Your' : "Opp's";
  return (
    <li ref={ref}>
      <button className={cx('tl-item tl-frame', selected && 'is-sel')} onClick={() => onSelect(i)}>
        <span className="tl-fnum">#{f.frameIndex}</span>
        <span className="tl-text">
          <span className="tl-label">
            {whose} {phaseLabel(s.phase)}
          </span>
          <span className="tl-did">
            {s.events.length} event{s.events.length === 1 ? '' : 's'}
            {s.stack.length > 0 ? ` · stack ${s.stack.length}` : ''}
          </span>
        </span>
      </button>
    </li>
  );
});

/** Phone: label + you-did, prev/next, slider, and a button for the full list. */
export function ScrubDock({
  mode,
  count,
  index,
  onSelect,
  title,
  subtitle,
  kind,
  onOpenList,
}: {
  mode: ScrubMode;
  count: number;
  index: number;
  onSelect: (i: number) => void;
  title: string;
  subtitle: string;
  kind?: Decision['kind'];
  onOpenList: () => void;
}) {
  return (
    <div className="dock" role="region" aria-label="Timeline scrubber">
      <div className="dock-row">
        <button className="icon-btn dock-nav" onClick={() => onSelect(index - 1)} disabled={index <= 0} aria-label="Previous">
          <IconChevronLeft size={20} />
        </button>
        <button className="dock-label" onClick={onOpenList}>
          <span className="dock-title">
            {kind && (
              <span className={cx('dock-kind', `k-${kind}`)}>
                <KindIcon kind={kind} size={12} />
              </span>
            )}
            <span className="dock-title-text">{title}</span>
            <span className="dock-pos">
              {count === 0 ? '0/0' : `${index + 1}/${count}`}
            </span>
          </span>
          <span className="dock-sub">{subtitle}</span>
        </button>
        <button className="icon-btn dock-nav" onClick={() => onSelect(index + 1)} disabled={index >= count - 1} aria-label="Next">
          <IconChevronRight size={20} />
        </button>
      </div>
      <div className="dock-row">
        <input
          className="scrub"
          type="range"
          min={0}
          max={Math.max(0, count - 1)}
          value={index}
          onChange={(e) => onSelect(Number(e.target.value))}
          aria-label={mode === 'decisions' ? 'Decision' : 'State frame'}
          style={{ ['--p' as string]: count > 1 ? `${(index / (count - 1)) * 100}%` : '0%' }}
        />
        <button className="icon-btn" onClick={onOpenList} aria-label="Open list">
          <IconList size={18} />
        </button>
      </div>
    </div>
  );
}
