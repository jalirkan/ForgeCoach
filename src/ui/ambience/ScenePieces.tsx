/*
 * ForgeCoach — ui/ambience/ScenePieces.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Spec 1.14's pieces over one player's half (the half board only): the empty
 * table while the half has no colour (it dissolves when the first colour
 * arrives), each landmark standing on the horizon drawn under it (or where
 * its `place` says), the game's end veil fading in over the half, and a
 * colour's front played over the half when the makeup changes (hard cuts at
 * each hold, then a fade; backwards when a colour leaves). The plan is
 * ambience/pieces.ts's; nothing here decides what shows.
 *
 * The third colour's element is drawn only under `?pairfull=1` (spec 1.15),
 * where the pair picture fills the half (pairfull.ts `pairFullPlan` with the
 * pieces' `elements`): in the heavier pair colour's ground stopping short of
 * the transition (`pairFullElementRegion`, never mirrored), placed by its
 * `place` on that picture's horizon or ground, at the plan's opacity, loaded
 * when shown. With the flag off a third colour keeps its own panel and no
 * element is drawn.
 *
 * A pack without `pieces` draws nothing (SceneryLayer does not mount this).
 * Reduced motion: no fronts, and the empty table, landmarks and veils appear
 * and go at once. Purely decorative: aria-hidden, no pointer events, beneath
 * the cards at the half's own z-index (scenery.css `.scn-pieces`).
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { BIOME_COLOUR, elementBiomes, frontFor, horizonAt, makeupFromSlots, piecePlacement, planHalf, WHOLE, type Front, type HalfPlan } from '../../ambience/pieces.ts';
import { pairFullArt, pairFullElementRegion, pairFullHeavierSide, pairFullPlan, pairFullView, type PairFullPair } from '../../ambience/pairfull.ts';
import { pairHalfAt, pairPanoramaAt } from '../../ambience/pairs.ts';
import { DEFAULT_HALF_SIZE, DEFAULT_PHONE_SIZE, type PackPiece, type PackPieces, type ScenePack } from '../../ambience/manifest.ts';
import { halfArtOf, halfFrameCss, halfLayout, type FrameRect } from '../../ambience/layout.ts';
import type { SlotState } from '../../ambience/model.ts';
import type { LightOutcome } from '../../ambience/light.ts';
import type { TweenFrame } from '../../ambience/transitions.ts';
import { pictureReady } from '../../ambience/pack.ts';
import { useNarrowScreen } from './SceneryStrip.tsx';
import { useTween } from './useTween.ts';

export interface ScenePiecesProps {
  pack: ScenePack | null;
  /** The pieces to draw: the pack's (or `#ambience`'s placeholders). */
  pieces: PackPieces;
  slots: SlotState[];
  /** This half's visible land names, earliest first (pieces.ts `landNamesOf`). */
  landNames: readonly string[];
  outcome: LightOutcome;
  edge: 'top' | 'bottom';
  reduced: boolean;
  /** Settings → One horizon (spec 1.13): the horizon a landmark stands on is the pinned one. */
  horizon?: boolean;
  /** Spec 1.15 (`?pairfull=1`): the pair picture fills the half, and a third colour's element is drawn in it. */
  pairFull?: boolean;
}

const pct = (n: number) => `${+(n * 100).toFixed(3)}%`;
const rectCss = (f: FrameRect): CSSProperties => ({ left: pct(f.left), top: pct(f.top), width: pct(f.width), height: pct(f.height) });

/** The front's frames at the half's shape, in play order, or null (no front, no frames, not decoded yet, reduced motion). */
function frontFrames(pieces: PackPieces, front: Front | null, phone: boolean, reduced: boolean): { frames: TweenFrame[]; fadeMs: number } | null {
  if (!front || reduced || 'dissolve' in front) return null;
  const f = pieces.fronts[front.colour];
  if (!f) return null;
  const frames = f.frames.map((x) => ({ src: phone && x.phone ? x.phone : x.src, holdMs: x.holdMs }));
  if (!frames.every((x) => pictureReady(x.src))) return null;
  return { frames: front.reverse ? frames.reverse() : frames, fadeMs: f.fadeMs };
}

export function ScenePieces({ pack, pieces, slots, landNames, outcome, edge, reduced, horizon = false, pairFull = false }: ScenePiecesProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      setBox((b) => (Math.abs(b.w - r.width) < 1 && Math.abs(b.h - r.height) < 1 ? b : { w: Math.round(r.width), h: Math.round(r.height) }));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const narrow = useNarrowScreen();

  // The plan, and the front a change of makeup plays (decided in the render that sees the change, as useTween does).
  const makeup = useMemo(() => makeupFromSlots(slots), [slots]);
  const memo = useRef<{ key: string | null; gen: number; front: Front | null; plan: HalfPlan | null }>({ key: null, gen: 0, front: null, plan: null });
  const landmarkNames = useMemo(() => Object.keys(pieces.landmarks), [pieces]);
  // Under pairfull the pair on screen is pairfull.ts's, which has no memory: the plan keeps none either, so the two agree on a tie.
  const plan = useMemo(() => planHalf({ makeup, landNames, landmarks: landmarkNames, outcome, prevPair: pairFull ? null : (memo.current.plan?.pair ?? null) }), [makeup, landNames, landmarkNames, outcome, pairFull]);
  const key = `${plan.makeup.colours.join('')}|${plan.pair?.join('') ?? ''}|${plan.element?.colour ?? ''}`;
  if (memo.current.key !== key) memo.current = { key, gen: memo.current.gen + 1, front: memo.current.key === null ? null : frontFor(memo.current.plan, plan), plan };
  else memo.current.plan = plan;
  const phone = narrow || (box.h > 0 && box.w / box.h < 1.6);
  const ctx = useRef({ pieces, phone, reduced });
  ctx.current = { pieces, phone, reduced };
  const pending = frontFrames(pieces, memo.current.front, phone, reduced);
  const tween = useTween(
    memo.current.gen,
    useCallback(() => {
      const c = ctx.current;
      return frontFrames(c.pieces, memo.current.front, c.phone, c.reduced)?.frames ?? null;
    }, []),
    pending?.fadeMs ?? 0,
  );

  const layout = useMemo(() => halfLayout(slots, pack), [slots, pack]);
  // Spec 1.14 on the whole-half pair picture: the same plan SceneryStrip draws (same layout, pairs and elements).
  const elements = useMemo(() => (pairFull ? elementBiomes(pieces) : null), [pairFull, pieces]);
  const full = useMemo(() => (pairFull && pack?.pairs && elements ? pairFullPlan(layout, pack.pairs, { thresholds: pack.stageThresholds, elements }) : null), [pairFull, pack, layout, elements]);
  const fullPair = full?.find((x): x is PairFullPair => x.kind === 'pair' && !!x.element) ?? null;
  const at = (p: PackPiece) => (phone && p.phone ? p.phone : p);
  const fadeAt = edge === 'bottom' ? 'top' : 'bottom';
  const ms = reduced ? 0 : 1600;
  const veil = plan.veil ? pieces.veils[plan.veil] : undefined;
  const halfShape = phone ? DEFAULT_PHONE_SIZE.width / DEFAULT_PHONE_SIZE.height : DEFAULT_HALF_SIZE.width / DEFAULT_HALF_SIZE.height;

  return (
    <div ref={ref} className={`scn-pieces scn-fade-${fadeAt}${reduced ? ' is-reduced' : ''}`} aria-hidden="true" data-pieces-colours={plan.makeup.colours.join('') || 'none'}>
      {pieces.empty && (
        <div className="scn-pc-empty" style={{ opacity: plan.empty ? 1 : 0, transition: `opacity ${ms}ms ease` }} data-pc="empty">
          {(() => {
            const art = halfArtOf(pieces.empty, box.h > 0 ? box.w / box.h : null, { narrow, horizon });
            const pic = art.picture ?? pieces.empty;
            return (
              <div className="scn-frame" style={halfFrameCss(art)}>
                <img className="scn-half-img" src={pic.src} srcSet={pic.src2x ? `${pic.src} 1x, ${pic.src2x} 2x` : undefined} alt="" decoding="async" draggable={false} />
              </div>
            );
          })()}
        </div>
      )}
      {fullPair && box.w > 0 && plan.element && (() => {
        const p = fullPair;
        const colour = BIOME_COLOUR[p.element!];
        const piece = colour ? pieces.elements[colour] : undefined;
        // The plan and the picture are one rule (pieces.ts `rankColours`); if they ever disagree, draw nothing rather than the wrong colour.
        if (!piece || plan.element.colour !== colour) return null;
        const art = pairFullArt(pairHalfAt(p.pair, p.stage), pairPanoramaAt(p.pair, p.stage), box.w / box.h, narrow, horizon);
        const view = pairFullView(full, box, art);
        if (!view) return null;
        const indexOf = (b: string) => slots.find((x) => x.biome === b)?.index ?? 0;
        const region = pairFullElementRegion(view, pairFullHeavierSide(p, indexOf));
        const pic = at(piece);
        const f = piecePlacement(piece.place, pic.width / pic.height, region, box, view.horizonY);
        return (
          <div key={`element:${colour}`} className="scn-pc-element" style={{ opacity: plan.element.opacity, transition: `opacity ${ms}ms ease` }} data-pc="element" data-pc-colour={colour} data-pc-side={pairFullHeavierSide(p, indexOf)}>
            <img className={`scn-pc${reduced ? '' : ' scn-pc-in'}`} style={rectCss(f)} src={pic.src} srcSet={pic.src2x ? `${pic.src} 1x, ${pic.src2x} 2x` : undefined} alt="" decoding="async" draggable={false} />
          </div>
        );
      })()}
      {box.w > 0 &&
        plan.landmarks.map((name) => {
          const p = pieces.landmarks[name]!;
          const pic = at(p);
          const hz = horizonAt(pack, layout, p.place.x, box, { narrow, horizon, empty: plan.empty ? pieces.empty : null });
          const f = piecePlacement(p.place, pic.width / pic.height, WHOLE, box, hz);
          return <img key={name} className={`scn-pc${reduced ? '' : ' scn-pc-in'}`} style={rectCss(f)} src={pic.src} srcSet={pic.src2x ? `${pic.src} 1x, ${pic.src2x} 2x` : undefined} alt="" decoding="async" draggable={false} data-pc="landmark" data-pc-name={name} />;
        })}
      {veil && box.w > 0 && (
        <img
          className={`scn-pc scn-pc-veil${reduced ? '' : ' scn-pc-in'}`}
          style={rectCss(piecePlacement(veil.place, at(veil).width / at(veil).height, WHOLE, box, 0.43))}
          src={at(veil).src}
          alt=""
          decoding="async"
          draggable={false}
          data-pc="veil"
        />
      )}
      {tween.frames && (
        <div className="scn-pc-front" style={{ opacity: tween.fading ? 0 : 1, transition: tween.fading ? `opacity ${tween.fadeMs}ms ease` : 'none' }} data-pc="front">
          {tween.frames.map((f, i) => (
            <div key={`${f.src}:${i}`} className="scn-frame" style={{ ...halfFrameCss({ aspect: halfShape, focal: { x: 0.5, y: 0.5 }, safe: null }), opacity: i === tween.index ? 1 : 0 }}>
              <img className="scn-half-img" src={f.src} alt="" decoding="async" draggable={false} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
