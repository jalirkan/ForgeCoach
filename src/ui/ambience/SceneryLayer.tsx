/*
 * ForgeCoach — ui/ambience/SceneryLayer.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The scenery on a board (play and replay), loaded lazily by BoardScenery.
 * It renders an invisible anchor inside the board, finds each player's
 * battlefield from there, and portals that player's strip into it — so the
 * board's own components carry no scenery code at all. Reads only the log's
 * frames up to the board's frame (the viewer's redacted states).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GameLog } from '../../log.ts';
import type { Card, GameStateBody } from '../../protocol.ts';
import { isHidden } from '../../protocol.ts';
import { SceneryTracker, slotsOf } from '../../ambience/model.ts';
import { sceneryEvents } from '../../ambience/events.ts';
import { cachedMap, useCardsVersion } from '../cardData.ts';
import { SceneryStrip } from './SceneryStrip.tsx';
import { useReducedMotion, useSceneryFx, useSceneryLoad, useSceneryPrefs } from './useScenery.ts';

interface Target {
  playerId: number;
  el: HTMLElement;
  top: boolean;
}

function findTargets(anchor: HTMLElement | null, log: GameLog, seat: number, state: GameStateBody | null): Target[] {
  const board = anchor?.closest('.board') ?? anchor?.parentElement ?? null;
  if (!board) return [];
  const out: Target[] = [];
  const others = (state?.players ?? []).map((p) => p.id).filter((id) => id !== seat);
  board.querySelectorAll<HTMLElement>('section.player').forEach((section) => {
    const top = section.classList.contains('player-top');
    const head = section.querySelector<HTMLElement>('[data-phead-player]');
    const fromHead = head ? Number(head.dataset.pheadPlayer) : NaN;
    const playerId = Number.isFinite(fromHead) ? fromHead : top ? others[0] : seat;
    const el = section.querySelector<HTMLElement>(':scope > .battlefield') ?? section.querySelector<HTMLElement>('.battlefield');
    if (playerId === undefined || !el) return;
    out.push({ playerId, el, top });
  });
  void log;
  return out;
}

const sameTargets = (a: Target[], b: Target[]) => a.length === b.length && a.every((t, i) => t.el === b[i]!.el && t.playerId === b[i]!.playerId && t.top === b[i]!.top);

export default function SceneryLayer({ log, frameIndex, seat }: { log: GameLog; frameIndex: number; seat: number }) {
  const prefs = useSceneryPrefs();
  const load = useSceneryLoad(prefs);
  const reduced = useReducedMotion(prefs);
  const anchor = useRef<HTMLSpanElement>(null);
  const [targets, setTargets] = useState<Target[]>([]);
  const cardsVersion = useCardsVersion();

  const state = useMemo(() => {
    for (let i = Math.min(frameIndex, log.frames.length - 1); i >= 0; i--) if (log.frames[i]!.type === 'state') return log.frames[i]!.body as GameStateBody;
    return null;
    // log.frames grows in place during play: frameIndex moves with it.
  }, [log, frameIndex, log.frames.length]);

  // Card data sharpens nonbasic lands (a dual's colours); the tracker restarts when it arrives.
  const tracker = useRef(new SceneryTracker());
  const landNames = useMemo(() => {
    const names = new Set<string>();
    for (const p of state?.players ?? []) for (const c of p.zones.battlefield?.cards ?? []) if (!isHidden(c) && /\bLand\b/.test((c as Card).types)) names.add((c as Card).name);
    return [...names].sort().join('\n');
  }, [state]);
  const cards = useMemo(() => cachedMap(landNames ? landNames.split('\n') : []), [landNames, cardsVersion]);
  const cardsKey = useMemo(() => [...cards.keys()].sort().join('\n'), [cards]);
  useMemo(() => tracker.current.setOptions({ cards, thresholds: load?.pack?.stageThresholds ?? undefined }), [cardsKey, load?.pack?.stageThresholds]); // eslint-disable-line react-hooks/exhaustive-deps

  const scenery = tracker.current.at(log, frameIndex);
  const fx = useSceneryFx();
  const lastIndex = useRef(frameIndex);
  useEffect(() => {
    // Effects only for a board moving forward a little (play, or stepping a replay), never for a jump.
    const prev = tracker.current.previous();
    const forward = frameIndex > lastIndex.current && frameIndex - lastIndex.current < 12;
    lastIndex.current = frameIndex;
    if (forward) fx.push(sceneryEvents(prev.scenery, scenery, tracker.current.current().state));
  }, [scenery]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (load?.note) console.info(`ForgeCoach scenery: ${load.note}`);
  }, [load?.note]);

  useLayoutEffect(() => {
    const next = findTargets(anchor.current, log, seat, state);
    for (const t of next) t.el.classList.add('scn-host');
    setTargets((prev) => (sameTargets(prev, next) ? prev : next));
  });

  return (
    <>
      <span ref={anchor} hidden />
      {load &&
        targets.map((t) =>
          createPortal(
            <SceneryStrip
              slots={slotsOf(scenery, t.playerId)}
              pack={load.pack}
              edge={t.top ? 'top' : 'bottom'}
              reduced={reduced}
              pulses={fx.pulses.get(t.playerId)}
              fx={fx.fx.get(t.playerId)}
            />,
            t.el,
            `scn-${t.playerId}`,
          ),
        )}
      {load?.note && import.meta.env.DEV && <span className="scn-devnote">{load.note}</span>}
    </>
  );
}
