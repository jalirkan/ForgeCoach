/*
 * ForgeCoach — ui/winchance/useWinChance.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The win chance's hooks (mtg-table D361): whether to show it (Settings →
 * "Show win chance", and a coach helper with a model), the live value while
 * playing, and the whole game's line for a replay or the engine review.
 * Requests go through evalClient.ts only; answers are kept per model and game
 * in memory, never stored.
 */
import { useEffect, useMemo, useState } from 'react';
import { loadSettings, onSettingsChange } from '../../claude.ts';
import { detectHelper, onHelperStatus, peekHelper, type HelperEval } from '../../coachHelper.ts';
import { evalPosition, helperEval } from '../../evalClient.ts';
import type { GameLog } from '../../log.ts';
import { buildRequest, buildRequests, evalGameKey, evalPoints, turnChange, type TurnChange, type WinPoint } from '../../winChance.ts';

function settingOn(): boolean {
  try {
    return loadSettings().winChance === true;
  } catch {
    return false;
  }
}

/**
 * The helper's model when the win chance is to be shown: the setting is on and
 * the helper's /health says `eval: 1`. Null otherwise (the strip and the line
 * are then not drawn at all).
 */
export function useWinChanceModel(): HelperEval | null {
  const [on, setOn] = useState(settingOn);
  const [model, setModel] = useState<HelperEval | null>(() => helperEval(peekHelper()));
  useEffect(() => onSettingsChange(() => setOn(settingOn())), []);
  useEffect(() => {
    if (!on) return;
    const read = () => setModel(helperEval(peekHelper()));
    const off = onHelperStatus(read);
    void detectHelper().then(read);
    // A helper started (or given a model) after this page opened, or a first look that timed out,
    // shows up within seconds (detectHelper keeps a found helper for a minute: this asks only when stale).
    const t = setInterval(() => void detectHelper().then(read), 10_000);
    return () => {
      off();
      clearInterval(t);
    };
  }, [on]);
  return on ? model : null;
}

/** Answers per model and game: a replay opened twice is scored once. */
const cache = new Map<string, WinPoint>();
const keyOf = (model: HelperEval, log: GameLog, frameIndex: number) => `${model.model}|${evalGameKey(log)}|${frameIndex}`;

export interface LiveWinChance {
  change: TurnChange | null;
  busy: boolean;
  error: string | null;
}

/**
 * While playing: score the newest decision row of the viewing seat, debounced
 * (a burst of frames asks once), the previous question stopped when a newer
 * position arrives. The last decision row of the previous turn is scored too
 * (once; usually already known), so the turn-to-turn change shows even when
 * the strip was switched on mid-game.
 */
export function useLiveWinChance(log: GameLog | null, model: HelperEval | null, debounceMs = 350): LiveWinChance {
  const [points, setPoints] = useState<WinPoint[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const game = log ? evalGameKey(log) : null;
  const modelId = model?.model ?? null;
  // A new game (the next one of a match) starts its own line.
  useEffect(() => setPoints([]), [game, modelId]);
  const [target, previous] = useMemo(() => {
    if (!log || !modelId) return [null, null];
    const ps = evalPoints(log);
    const last = ps[ps.length - 1];
    if (!last) return [null, null];
    const prev = [...ps].reverse().find((p) => p.state.turn < last.state.turn);
    return [last.frameIndex, prev?.frameIndex ?? null];
  }, [log, modelId]);

  useEffect(() => {
    if (!log || !model || target === null) return;
    const add = (pt: WinPoint) =>
      setPoints((ps) => (ps.some((p) => p.frameIndex === pt.frameIndex) ? ps : [...ps, pt].sort((a, b) => a.frameIndex - b.frameIndex)));
    const wanted = previous === null ? [target] : [target, previous];
    const todo: number[] = [];
    for (const fi of wanted) {
      const hit = cache.get(keyOf(model, log, fi));
      if (hit) add(hit);
      else todo.push(fi);
    }
    if (todo.length === 0) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      void (async () => {
        setBusy(true);
        for (const fi of todo) {
          const req = buildRequest(log, fi);
          if (!req) continue;
          const a = await evalPosition(req, { signal: ctrl.signal });
          if (ctrl.signal.aborted) return;
          if (!a.ok) {
            setError(a.message);
            break;
          }
          setError(null);
          if (!a.decision || a.model !== model.model) continue;
          const pt: WinPoint = { frameIndex: fi, turn: a.turn, p: a.p };
          cache.set(keyOf(model, log, fi), pt);
          add(pt);
        }
        setBusy(false);
      })();
    }, debounceMs);
    return () => {
      clearTimeout(t);
      ctrl.abort();
      setBusy(false);
    };
    // The log object changes with every frame; the target frames are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, previous, game, modelId, debounceMs]);

  return { change: useMemo(() => turnChange(points), [points]), busy, error };
}

export interface WinSeries {
  points: WinPoint[];
  /** Positions to score in all. */
  total: number;
  done: boolean;
  error: string | null;
}

/** A finished (or loaded) game: every decision row of the viewing seat, scored a few at a time. */
export function useWinSeries(log: GameLog | null, model: HelperEval | null, concurrency = 3): WinSeries {
  const modelId = model?.model ?? null;
  const wanted = useMemo(() => (log && modelId ? evalPoints(log).map((p) => p.frameIndex) : []), [log, modelId]);
  const [points, setPoints] = useState<WinPoint[]>([]);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPoints([]);
    setDone(false);
    setError(null);
    if (!log || !model || wanted.length === 0) {
      setDone(!!log && !!model);
      return;
    }
    const ctrl = new AbortController();
    const got = new Map<number, WinPoint>();
    const todo: number[] = [];
    for (const fi of wanted) {
      const hit = cache.get(keyOf(model, log, fi));
      if (hit) got.set(fi, hit);
      else todo.push(fi);
    }
    const publish = () => setPoints([...got.values()].sort((a, b) => a.frameIndex - b.frameIndex));
    publish();
    if (todo.length === 0) {
      setDone(true);
      return;
    }
    const reqs = buildRequests(log, todo);
    let next = 0;
    let failed = 0;
    let lastPublish = 0;
    const worker = async () => {
      while (!ctrl.signal.aborted && next < todo.length) {
        const fi = todo[next++]!;
        const req = reqs.get(fi);
        if (!req) continue;
        const a = await evalPosition(req, { signal: ctrl.signal, timeoutMs: 20_000 });
        if (ctrl.signal.aborted) return;
        if (!a.ok) {
          failed++;
          setError(a.message);
          if (a.status === 0 || a.status === 503 || failed >= 3) {
            ctrl.abort();
            return;
          }
          continue;
        }
        if (!a.decision || a.model !== model.model) continue;
        const pt: WinPoint = { frameIndex: fi, turn: a.turn, p: a.p };
        cache.set(keyOf(model, log, fi), pt);
        got.set(fi, pt);
        if (Date.now() - lastPublish > 150) {
          lastPublish = Date.now();
          publish();
        }
      }
    };
    void Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker)).then(() => {
      if (ctrl.signal.aborted && got.size < wanted.length) {
        publish();
        return;
      }
      publish();
      setDone(true);
    });
    return () => ctrl.abort();
  }, [log, modelId, wanted, concurrency]); // eslint-disable-line react-hooks/exhaustive-deps

  return { points, total: wanted.length, done, error };
}
