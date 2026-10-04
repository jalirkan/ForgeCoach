/*
 * ForgeCoach — ui/ambience/SceneryLayer.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The scenery on a board (play and replay), loaded lazily by BoardScenery.
 * It renders an invisible anchor inside the board, finds each player's
 * battlefield from there, and portals that player's strip into it — so the
 * board's own components carry no scenery code at all. Reads only the log's
 * frames up to the board's frame (the viewer's redacted states). With the
 * board accents on (spec 1.3, Settings → Board accents), each battlefield also
 * gets its accent layer (SceneryOverlay), beneath the cards like the strip.
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
import { SceneryOverlay } from './SceneryOverlay.tsx';
import { accentsOn } from '../../ambience/prefs.ts';
import { effectGate } from '../../ambience/effects.ts';
import { browserLoader, preloadEffects, preloadOverlays } from '../../ambience/pack.ts';
import { useReducedMotion, useSceneryFx, useSceneryLoad, useSceneryPrefs, type PlaceCard } from './useScenery.ts';

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

/** Is `frameIndex` the log's last state frame (the board follows the end)? */
function atLastState(log: GameLog, frameIndex: number): boolean {
  for (let i = log.frames.length - 1; i > frameIndex; i--) if (log.frames[i]!.type === 'state') return false;
  return true;
}

/** Where a card sits across its player's battlefield (the strip spans it), from the board's own tiles. */
function placeCard(targets: Target[]): PlaceCard {
  return (cue) => {
    if (cue.cardId === null) return null;
    const t = targets.find((x) => x.playerId === cue.player);
    if (!t) return null;
    const tile = t.el.querySelector<HTMLElement>(`[data-card-id="${cue.cardId}"]`);
    if (!tile) return null;
    const host = t.el.getBoundingClientRect();
    const r = tile.getBoundingClientRect();
    if (!(host.width > 0) || !(r.width > 0)) return null;
    return Math.min(0.97, Math.max(0.03, (r.left + r.width / 2 - host.left) / host.width));
  };
}

const sameTargets =(a: Target[], b: Target[]) => a.length === b.length && a.every((t, i) => t.el === b[i]!.el && t.playerId === b[i]!.playerId && t.top === b[i]!.top);

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
  const fx = useSceneryFx(load?.pack ?? null, reduced);
  const lastIndex = useRef(frameIndex);
  const lastLen = useRef(log.frames.length);
  const lastLog = useRef(log);
  const lastMoveAt = useRef<number | null>(null);
  useEffect(() => {
    // Effects for live play and normal replay steps; a jump back or ahead, or scrubbing, cancels them (effects.ts effectGate).
    const from = lastLog.current === log ? lastIndex.current : frameIndex;
    const grew = log.frames.length > lastLen.current;
    const fresh = tracker.current.steps().filter((s) => s.frameIndex > from && s.frameIndex <= frameIndex);
    const t = performance.now();
    const verdict = effectGate({ from, to: frameIndex, stateSteps: fresh.length, live: grew && atLastState(log, frameIndex), now: t, lastMoveAt: lastMoveAt.current });
    if (verdict !== 'idle') lastMoveAt.current = t;
    lastIndex.current = frameIndex;
    lastLen.current = log.frames.length;
    lastLog.current = log;
    if (verdict === 'cancel') fx.cancel();
    if (verdict !== 'fire') return;
    const place = placeCard(targets);
    for (const s of fresh) fx.push(sceneryEvents(s.prev, s.next, s.state), s.next, place);
  }, [scenery, frameIndex, log.frames.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (load?.note) console.info(`ForgeCoach scenery: ${load.note}`);
  }, [load?.note]);

  // A pack's effect files warm the cache in the background; the board never waits for them.
  useEffect(() => {
    if (!load?.pack?.effects) return;
    void preloadEffects(load.pack, browserLoader()).then((failed) => {
      if (failed.length) console.info(`ForgeCoach scenery: ${failed.length} effect file(s) did not load; those effects may not show.`);
    });
  }, [load?.pack]);

  // Accent files warm the cache in the background too.
  const accents = accentsOn(prefs);
  useEffect(() => {
    if (!accents || !load?.pack?.overlays) return;
    void preloadOverlays(load.pack, browserLoader()).then((failed) => {
      if (failed.length) console.info(`ForgeCoach scenery: ${failed.length} accent file(s) did not load; those pieces are not drawn.`);
    });
  }, [load?.pack, accents]);

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
            <>
              <SceneryStrip
                slots={slotsOf(scenery, t.playerId)}
                pack={load.pack}
                edge={t.top ? 'top' : 'bottom'}
                reduced={reduced}
                pulses={fx.pulses.get(t.playerId)}
                fx={fx.fx.get(t.playerId)}
              />
              {accents && <SceneryOverlay slots={slotsOf(scenery, t.playerId)} pack={load.pack} edge={t.top ? 'top' : 'bottom'} reduced={reduced} />}
            </>,
            t.el,
            `scn-${t.playerId}`,
          ),
        )}
      {load?.note && import.meta.env.DEV && <span className="scn-devnote">{load.note}</span>}
    </>
  );
}
