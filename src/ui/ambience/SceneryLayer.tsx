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
 * With Settings → Fill each side (spec 1.5, on by default), the strip grows
 * into the player's whole half of the board, and each card row gets a soft
 * dark scrim beneath it (HalfScrim), so the cards read as on the plain board.
 * With Settings → Light follows the game (spec 1.13, off by default), each
 * battlefield's scenery is graded by the game's arc, that player's life and
 * the game's end (ambience/light.ts, lightGrade.ts). A pack with spec 1.14
 * `pieces` gets them over each filled half (ScenePieces: the empty table,
 * landmarks, the end's veil, a colour's front).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GameLog } from '../../log.ts';
import type { Card, GameStateBody } from '../../protocol.ts';
import type { Biome, SlotState } from '../../ambience/model.ts';
import type { PackPieces, ScenePack } from '../../ambience/manifest.ts';
import type { LightOutcome } from '../../ambience/light.ts';
import type { MakeupShowing } from '../../ambience/makeup.ts';
import type { StripEffect } from './SceneryStrip.tsx';
import { isHidden } from '../../protocol.ts';
import { chosenColorSource, chosenColors } from '../../state.ts';
import { dualsOf, SceneryTracker, slotsOf } from '../../ambience/model.ts';
import { bridgePictures } from '../../ambience/bridges.ts';
import { pairPictures } from '../../ambience/pairs.ts';
import { sceneryEvents } from '../../ambience/events.ts';
import { cachedMap, useCardsVersion } from '../cardData.ts';
import { SceneryStrip } from './SceneryStrip.tsx';
import { SceneryOverlay } from './SceneryOverlay.tsx';
import { accentsOn, fillOn, horizonOn, lightOn } from '../../ambience/prefs.ts';
import { gradeFor, lightInputOf, outcomeAt } from '../../ambience/light.ts';
import { elementBiomes, landNamesOf } from '../../ambience/pieces.ts';
import { pickFromSlots, type MakeupPick } from '../../ambience/makeup.ts';
import { ScenePieces } from './ScenePieces.tsx';
import { applyGrade } from './lightGrade.ts';
import { HalfScrim } from './HalfScrim.tsx';
import { halfUrls } from '../../ambience/manifest.ts';
import { effectGate } from '../../ambience/effects.ts';
import { browserLoader, growthPictures, preloadEffects, preloadOverlays, warmPicture } from '../../ambience/pack.ts';
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
  // A Thriving land counts as its two colours once the seat's own choice for it is in the log (state.ts chosenColors);
  // read only while the seat has such a land in play (the log walk is not free in a long game).
  const choosing = useMemo(() => {
    const me = state?.players.find((p) => p.id === seat);
    return (me?.zones.battlefield?.cards ?? []).some((c) => !isHidden(c) && /\bLand\b/.test((c as Card).types) && !!chosenColorSource(c, cards));
  }, [state, seat, cards]);
  const chosen = useMemo(() => (choosing ? chosenColors(log, frameIndex, seat, cards) : undefined), [choosing, log, frameIndex, log.frames.length, seat, cards]); // eslint-disable-line react-hooks/exhaustive-deps
  tracker.current.setChosen(chosen);

  const scenery = tracker.current.at(log, frameIndex);
  // makeup.ts's one rule, per player, with what each half showed last (the tie rules): the strip, the pieces and the
  // accents all get the same pick, so they cannot choose different colours (review fault 1).
  const picks = useRef(new Map<number, MakeupPick>());
  const showingOf = (playerId: number): MakeupPick => {
    const pick = pickFromSlots(slotsOf(scenery, playerId), picks.current.get(playerId) ?? null);
    const prev = picks.current.get(playerId);
    if (!prev || prev.kept.join() !== pick.kept.join() || prev.pair?.join() !== pick.pair?.join()) picks.current.set(playerId, pick);
    return picks.current.get(playerId)!;
  };
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

  // Stage-1 half pictures (spec 1.5) warm the cache when the scenery fills the halves; later stages warm as slots grow (below).
  const fill = fillOn(prefs);
  useEffect(() => {
    if (!fill || !load?.pack) return;
    const urls = halfUrls(load.pack).filter((u) => u.stage === 1);
    if (!urls.length) return;
    const loader = browserLoader();
    void (async () => {
      // A phone-shaped viewport warms the phone pictures, where the pack has them.
      const narrow = window.innerWidth < 700;
      for (const u of urls) await loader(narrow && u.phone ? u.phone : u.url, 'image').catch(() => {});
    })();
  }, [load?.pack, fill]);

  // Spec 1.6: each slot's current and next stage's pictures warm as it grows, so the next stage can fade in from the first land toward it.
  useEffect(() => {
    if (!load?.pack) return;
    const phone = window.innerWidth < 700;
    for (const w of growthPictures(load.pack, scenery.players.flatMap((p) => p.slots), { half: fill, phone })) warmPicture(w);
    // Spec 1.8: a side's bridge warms with its split's pictures (the half board only).
    if (fill) for (const w of bridgePictures(load.pack, scenery.players.map((p) => p.slots), { phone })) warmPicture(w);
    // Spec 1.9: and its pair band's pictures (the stage its lower neighbour maps to, and the next); under `?pairfull=1`
    // the whole-half panoramas and 1.16's painted-in elements too (review fault 4: the panorama was never warmed).
    const full = prefs.pairFull ? { thresholds: load.pack.stageThresholds } : null;
    if (fill) for (const w of pairPictures(load.pack.pairs, scenery.players.map((p) => p.slots), { phone, full })) warmPicture(w);
  }, [scenery, load?.pack, fill, prefs.pairFull]);

  // Spec 1.14: the pieces that can appear at once (fronts, veils, landmarks, the empty table) warm in ScenePieces, at the
  // shape of the half it measures (review fault 3: warming by the window's width picked the wrong frames for a tall half).
  const pieces = fill ? (load?.pack?.pieces ?? null) : null;
  // Spec 1.14 under `?pairfull=1`: a third colour with an element is drawn inside the pair picture, not as a panel.
  const elements = useMemo(() => (prefs.pairFull ? elementBiomes(pieces) : null), [prefs.pairFull, pieces]);
  // The game's end at the board's frame, per player (one walk of the log per frame, and only with pieces).
  const outcomes = useMemo(() => new Map((pieces ? (state?.players ?? []) : []).map((p) => [p.id, outcomeAt(log, frameIndex, p.id)])), [pieces, state, log, frameIndex, log.frames.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const outcomeFor = (playerId: number) => outcomes.get(playerId) ?? null;

  // Spec 1.13: each battlefield graded by the game at the board's frame; off takes the grade away.
  const light = lightOn(prefs) && !!load;
  useLayoutEffect(() => {
    for (const t of targets) {
      const input = light ? lightInputOf(log, frameIndex, state, t.playerId) : null;
      applyGrade(t.el, input ? gradeFor(input) : null);
    }
  }, [targets, light, log, frameIndex, state]);
  useEffect(() => () => targets.forEach((t) => applyGrade(t.el, null)), [targets]);

  useLayoutEffect(() => {
    const next = findTargets(anchor.current, log, seat, state);
    for (const t of next) t.el.classList.add('scn-host');
    setTargets((prev) => (sameTargets(prev, next) ? prev : next));
  });

  return (
    <>
      <span ref={anchor} hidden />
      {load &&
        targets.map((t) => {
          const showing = showingOf(t.playerId);
          return createPortal(
            <HalfScenery
              slots={slotsOf(scenery, t.playerId)}
              pack={load.pack}
              edge={t.top ? 'top' : 'bottom'}
              reduced={reduced}
              pulses={fx.pulses.get(t.playerId)}
              fx={fx.fx.get(t.playerId)}
              fill={fill}
              duals={dualsOf(scenery, t.playerId)}
              horizon={horizonOn(prefs)}
              pairFull={!!prefs.pairFull}
              elements={elements}
              showing={showing}
              scrimHost={t.el}
              version={frameIndex}
              pieces={pieces}
              landNames={landNamesOf(state, t.playerId)}
              outcome={outcomeFor(t.playerId)}
              accents={accents}
            />,
            t.el,
            `scn-${t.playerId}`,
          );
        })}
      {load?.note && import.meta.env.DEV && <span className="scn-devnote">{load.note}</span>}
    </>
  );
}

export interface HalfSceneryProps {
  slots: SlotState[];
  pack: ScenePack | null;
  edge: 'top' | 'bottom';
  reduced: boolean;
  pulses?: Partial<Record<Biome, number>>;
  fx?: readonly StripEffect[];
  /** Settings → Fill each side (spec 1.5). */
  fill: boolean;
  duals: Readonly<Record<string, number>>;
  horizon: boolean;
  pairFull: boolean;
  elements: ReadonlySet<Biome> | null;
  showing: MakeupShowing | null;
  /** The battlefield the card-row scrim measures (null: no scrim, as in a test). */
  scrimHost: HTMLElement | null;
  version: number;
  pieces: PackPieces | null;
  landNames: readonly string[];
  outcome: LightOutcome;
  /** Settings → Board accents. */
  accents: boolean;
  /** Tests (react-dom/server runs no layout effect): the area's width for the accents, and the half's box for the pieces. */
  measured?: { w: number; h: number };
}

/**
 * One player's scenery, in the order it paints (scenery.css): the card-row
 * scrim, the strip (the land pictures at -3 and its effects at -1), spec
 * 1.14's pieces and the accents -- the full-area one at -2, the corner and
 * edge ones at -1 -- and LAST the pieces, at -1 too, so a veil or a front is
 * over every scenery layer and still beneath every card (review fault 2).
 */
export function HalfScenery(p: HalfSceneryProps) {
  return (
    <>
      {p.fill && p.scrimHost && p.slots.length > 0 && <HalfScrim host={p.scrimHost} version={p.version} />}
      <SceneryStrip
        slots={p.slots}
        pack={p.pack}
        edge={p.edge}
        reduced={p.reduced}
        pulses={p.pulses}
        fx={p.fx}
        fill={p.fill ? 'half' : 'strip'}
        duals={p.duals}
        horizon={p.horizon}
        pairFull={p.pairFull}
        elements={p.elements}
        showing={p.showing}
      />
      {p.accents && <SceneryOverlay slots={p.slots} pack={p.pack} edge={p.edge} reduced={p.reduced} half={p.fill} duals={p.duals} showing={p.showing} widthPx={p.measured?.w} />}
      {p.pieces && p.fill && <ScenePieces pack={p.pack} pieces={p.pieces} slots={p.slots} landNames={p.landNames} outcome={p.outcome} edge={p.edge} reduced={p.reduced} horizon={p.horizon} pairFull={p.pairFull} showing={p.showing} initialBox={p.measured} />}
    </>
  );
}
