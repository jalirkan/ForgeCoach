/*
 * ForgeCoach — ui/ambience/useTween.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * React glue for transition frames (spec 1.7): watches a slot's stage and,
 * when it steps and the pack has frames for that step (ambience/transitions.ts),
 * plays them: the frame on screen, cut at each hold, then the fade into the
 * stage. The start is decided during the render that sees the new stage, so
 * that same render can switch the slot's own cross-fade off (the frames cover
 * the change; the stage beneath is already the new one when they fade out).
 */
import { useEffect, useRef, useState } from 'react';
import { tweenAt, tweenTimeline, type TweenFrame } from '../../ambience/transitions.ts';

export interface TweenState {
  /** The sequence playing, or null. */
  frames: TweenFrame[] | null;
  /** The frame on screen. */
  index: number;
  /** The last frame is fading into the stage. */
  fading: boolean;
  fadeMs: number;
}

const IDLE: TweenState = { frames: null, index: 0, fading: false, fadeMs: 0 };

/**
 * `resolve(from, to)` gives the frames for a change of stage (null: no
 * sequence, the cross-fade plays); it is asked only when `stage` changes after
 * the first render. A new change in the middle of a sequence replaces it.
 */
export function useTween(stage: number, resolve: (from: number, to: number) => TweenFrame[] | null, fadeMs: number): TweenState {
  const st = useRef<{ stage: number | null; id: number; frames: TweenFrame[] | null }>({ stage: null, id: 0, frames: null });
  const [pos, setPos] = useState<{ id: number; index: number; fading: boolean; done: boolean }>({ id: 0, index: 0, fading: false, done: true });
  if (st.current.stage !== stage) {
    const from = st.current.stage;
    const frames = from === null ? null : resolve(from, stage);
    st.current = { stage, id: st.current.id + 1, frames: frames && frames.length ? frames : null };
  }
  const { id, frames } = st.current;
  useEffect(() => {
    if (!frames) return;
    const { starts, holdEnd } = tweenTimeline(frames);
    const marks = [...starts.slice(1), holdEnd, holdEnd + Math.max(0, fadeMs)];
    const timers = marks.map((at) =>
      setTimeout(() => {
        const p = tweenAt(frames, fadeMs, at);
        setPos({ id, ...p });
      }, at),
    );
    return () => timers.forEach(clearTimeout);
  }, [id, frames, fadeMs]);
  if (!frames) return IDLE;
  const p = pos.id === id ? pos : { id, index: 0, fading: false, done: false };
  if (p.done) return IDLE;
  return { frames, index: p.index, fading: p.fading, fadeMs };
}
