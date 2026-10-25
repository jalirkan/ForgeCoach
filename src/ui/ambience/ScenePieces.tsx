/*
 * ForgeCoach — ui/ambience/ScenePieces.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Spec 1.14's pieces over one player's half (the half board only): the empty
 * table while the half has no colour (it dissolves when the first colour
 * arrives), each landmark standing on the horizon drawn under it (or where
 * its `place` says), the game's end veil fading in over the half (and out
 * again on a replay scrub back), and a colour's front played over the half
 * when the makeup changes (hard cuts at each hold, then a fade; backwards
 * when a colour leaves). The plan is ambience/pieces.ts's; nothing here
 * decides what shows.
 *
 * The third colour's element is drawn only under `?pairfull=1` (spec 1.15),
 * where the pair picture fills the half (pairfull.ts `pairFullPlan` with the
 * pieces' `elements`): in the heavier pair colour's ground stopping short of
 * the transition (`pairFullElementRegion`, never mirrored), placed by its
 * `place` on that picture's horizon or ground, at the plan's opacity, once
 * its picture has loaded (warmed with the half's colours). Not when the
 * half has the colour painted in (spec 1.16): the strip's load gate
 * (pairfull.ts `pairFullChoice`) is asked here too, and the cut-out is drawn
 * only when no painted picture is shown or wanted (`pairFullCutOutAllowed`,
 * spec 1.16.1: never a sticker for the moment a painted one loads).
 * With the flag off a third colour keeps its own panel and no element is
 * drawn. The pair and the element come from makeup.ts's one rule, with the
 * strip's `showing`, so the two can never pick different pairs.
 *
 * Fronts (review fault 3): the frames are warmed and picked at one shape,
 * pieces.ts `piecesPhone` on the half this measures; a front plays as soon as
 * its frames have decoded (pieces.ts `FrontGate`), not only if they already
 * had at the moment of the change.
 *
 * A pack without `pieces` draws nothing (SceneryLayer does not mount this).
 * Reduced motion: no fronts, and the empty table, landmarks and veils appear
 * and go at once. Purely decorative: aria-hidden, no pointer events, over every
 * scenery layer -- the land pictures, the accents, the card-row scrim and the
 * effects -- and beneath every card, label and control (scenery.css
 * `.scn-pieces`, last in SceneryLayer's `HalfScenery`); faded into the centre
 * line's mist by the pack's own `half.mist`.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { BIOME_COLOUR, elementBiomes, elementUrls, frontFor, frontFrameList, FrontGate, horizonAt, makeupFromSlots, piecePlacement, piecesPhone, planHalf, veilState, WHOLE, type HalfPlan } from '../../ambience/pieces.ts';
import { pairFullCandidates, pairFullChoice, pairFullCutOutAllowed, pairFullElementRegion, pairFullHeavierSide, pairFullPanelAspect, pairFullPlan, pairFullView, type PairFullPair } from '../../ambience/pairfull.ts';
import { DEFAULT_HALF_LAYOUT, DEFAULT_HALF_SIZE, DEFAULT_PHONE_SIZE, pieceUrls, type PackPiece, type PackPieces, type ScenePack, type VeilOutcome } from '../../ambience/manifest.ts';
import { halfArtOf, halfFrameCss, halfLayout, type FrameRect } from '../../ambience/layout.ts';
import type { MakeupShowing } from '../../ambience/makeup.ts';
import type { SlotState } from '../../ambience/model.ts';
import type { LightOutcome } from '../../ambience/light.ts';
import { pictureStatus, warmPicture } from '../../ambience/pack.ts';
import { useNarrowScreen } from './SceneryStrip.tsx';
import { usePicturesVersion } from './usePictures.ts';
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
  /** What was showing before (makeup.ts; SceneryLayer's previous pick, the one the strip gets too): the tie rules. */
  showing?: MakeupShowing | null;
  /** Tests (renderToStaticMarkup runs no layout effect): the half's size before it is measured. */
  initialBox?: { w: number; h: number };
}

const pct = (n: number) => `${+(n * 100).toFixed(3)}%`;
const rectCss = (f: FrameRect): CSSProperties => ({ left: pct(f.left), top: pct(f.top), width: pct(f.width), height: pct(f.height) });
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function ScenePieces({ pack, pieces, slots, landNames, outcome, edge, reduced, horizon = false, pairFull = false, showing = null, initialBox }: ScenePiecesProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState(initialBox ?? { w: 0, h: 0 });
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
  // The one shape rule (pieces.ts `piecesPhone`), for warming and for picking.
  const phone = piecesPhone(box, narrow);
  const measured = box.w > 0 && box.h > 0;

  // The plan, and the front a change of makeup plays (decided in the render that sees the change).
  const makeup = useMemo(() => makeupFromSlots(slots), [slots]);
  const landmarkNames = useMemo(() => Object.keys(pieces.landmarks), [pieces]);
  const plan = useMemo(() => planHalf({ makeup, landNames, landmarks: landmarkNames, outcome, showing }), [makeup, landNames, landmarkNames, outcome, showing]);
  const memo = useRef<{ key: string | null; plan: HalfPlan | null }>({ key: null, plan: null });
  const gate = useRef(new FrontGate()).current;
  const key = `${plan.makeup.colours.join('')}|${plan.pair?.join('') ?? ''}|${plan.element?.colour ?? ''}`;
  if (memo.current.key !== key) {
    gate.change(memo.current.key === null || reduced ? null : frontFor(memo.current.plan, plan), now());
    memo.current = { key, plan };
  } else memo.current.plan = plan;

  // Warm every piece that can appear at once at this half's shape (the empty table, landmarks, veils, fronts).
  useEffect(() => {
    if (!measured) return;
    for (const src of pieceUrls(pieces, { phone })) warmPicture({ src, src2x: null });
  }, [pieces, phone, measured]);

  // A front plays once its frames have all decoded (warmed above; a cold one warms now and plays when it lands).
  const waiting = gate.waiting(now());
  // Woken when a picture settles only while something here waits on one: a front's frames, or (the flag on) an element.
  const pictures = usePicturesVersion(!!waiting || (pairFull && makeup.colours.length >= 3));
  const waitingFrames = waiting ? frontFrameList(pieces, waiting, phone) : null;
  const framesReady = !!waitingFrames && waitingFrames.frames.every((f) => pictureStatus(f.src) === 'ready');
  useEffect(() => {
    if (waitingFrames && !framesReady) for (const f of waitingFrames.frames) warmPicture({ src: f.src, src2x: null });
  });
  const token = gate.token(framesReady, now());
  const ctx = useRef({ pieces, phone });
  ctx.current = { pieces, phone };
  const tween = useTween(token, () => frontFrameList(ctx.current.pieces, gate.frontOf(token), ctx.current.phone)?.frames ?? null, frontFrameList(pieces, gate.frontOf(token), phone)?.fadeMs ?? 0);

  const layout = useMemo(() => halfLayout(slots, pack, null, showing), [slots, pack, showing]);
  // Spec 1.14 on the whole-half pair picture: the same plan and the same load gate SceneryStrip draws.
  const elements = useMemo(() => (pairFull ? elementBiomes(pieces) : null), [pairFull, pieces]);
  const full = useMemo(() => (pairFull && pack?.pairs ? pairFullPlan(layout, pack.pairs, { thresholds: pack.stageThresholds, elements, showing, slots }) : null), [pairFull, pack, layout, elements, showing, slots]);
  const fullPair = full?.find((x): x is PairFullPair => x.kind === 'pair' && !!x.element) ?? null;
  const choice = useMemo(() => {
    if (!fullPair || !measured) return null;
    return pairFullChoice(pairFullCandidates(fullPair, pairFullPanelAspect(Math.round((box.w / box.h) * 20) / 20, fullPair.share), narrow, horizon), pictureStatus);
  }, [fullPair, measured, box, narrow, horizon, pictures]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = choice?.show ?? null;
  // Spec 1.16.1: no cut-out while a painted picture is shown, loading or held by the strip (the review of #199).
  const cutOut = pairFullCutOutAllowed(choice);
  const at = (p: PackPiece) => (phone && p.phone ? p.phone : p);
  // Elements warm with the half's colours under the flag (review fault 4: they were never warmed and popped in late).
  useEffect(() => {
    if (!pairFull || !measured) return;
    for (const w of elementUrls(pieces, makeup.colours, phone)) warmPicture(w);
  }, [pairFull, measured, makeup, pieces, phone]);

  // The veil fades out on a scrub back rather than vanishing (review fault 10).
  const ms = reduced ? 0 : 1600;
  const lastVeil = useRef<VeilOutcome | null>(null);
  const [, setVeilTick] = useState(0);
  if (plan.veil) lastVeil.current = plan.veil;
  useEffect(() => {
    if (plan.veil || !lastVeil.current) return;
    const t = setTimeout(() => {
      lastVeil.current = null;
      setVeilTick((n) => n + 1);
    }, ms);
    return () => clearTimeout(t);
  }, [plan.veil, ms]);
  const vs = veilState(plan.veil, lastVeil.current);
  const veil = vs ? pieces.veils[vs.veil] : undefined;

  const fadeAt = edge === 'bottom' ? 'top' : 'bottom';
  const halfShape = phone ? DEFAULT_PHONE_SIZE.width / DEFAULT_PHONE_SIZE.height : DEFAULT_HALF_SIZE.width / DEFAULT_HALF_SIZE.height;
  // The centre line's mist at the pack's own depth (review fault 8: `--scn-mist` was set on the strip, a sibling).
  const style = { '--scn-mist': pct((pack?.half ?? DEFAULT_HALF_LAYOUT).mist) } as CSSProperties;

  return (
    <div
      ref={ref}
      className={`scn-pieces scn-fade-${fadeAt}${reduced ? ' is-reduced' : ''}`}
      style={style}
      aria-hidden="true"
      data-pieces-colours={plan.makeup.colours.join('') || 'none'}
      data-pieces-pair={plan.pair?.join('') || undefined}
      data-pieces-element={plan.element?.colour}
    >
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
      {fullPair && shown && cutOut && measured && plan.element && (() => {
        const p = fullPair;
        const colour = BIOME_COLOUR[p.element!];
        const piece = colour ? pieces.elements[colour] : undefined;
        // One rule (makeup.ts) for the plan and the picture; a guard all the same: never the wrong colour.
        if (!piece || plan.element.colour !== colour) return null;
        const pic = at(piece);
        // Drawn once loaded, so it fades in rather than popping in after the fade.
        if (pictureStatus(pic.src) !== 'ready') return null;
        const view = pairFullView(full, box, shown.art, shown.mirror);
        if (!view) return null;
        const indexOf = (b: string) => slots.find((x) => x.biome === b)?.index ?? 0;
        const side = pairFullHeavierSide(p, indexOf);
        const region = pairFullElementRegion(view, side);
        const f = piecePlacement(piece.place, pic.width / pic.height, region, box, view.horizonY);
        return (
          <div key={`element:${colour}`} className="scn-pc-element" style={{ opacity: plan.element.opacity, transition: `opacity ${ms}ms ease` }} data-pc="element" data-pc-colour={colour} data-pc-side={side}>
            <img className={`scn-pc${reduced ? '' : ' scn-pc-in'}`} style={rectCss(f)} src={pic.src} srcSet={pic.src2x ? `${pic.src} 1x, ${pic.src2x} 2x` : undefined} alt="" decoding="async" draggable={false} />
          </div>
        );
      })()}
      {measured &&
        plan.landmarks.map((name) => {
          const p = pieces.landmarks[name]!;
          const pic = at(p);
          const hz = horizonAt(pack, layout, p.place.x, box, { narrow, horizon, empty: plan.empty ? pieces.empty : null });
          const f = piecePlacement(p.place, pic.width / pic.height, WHOLE, box, hz);
          return <img key={name} className={`scn-pc${reduced ? '' : ' scn-pc-in'}`} style={rectCss(f)} src={pic.src} srcSet={pic.src2x ? `${pic.src} 1x, ${pic.src2x} 2x` : undefined} alt="" decoding="async" draggable={false} data-pc="landmark" data-pc-name={name} />;
        })}
      {veil && measured && (
        <div className="scn-pc-veil-wrap" style={{ opacity: vs!.leaving ? 0 : 1, transition: `opacity ${ms}ms ease` }} data-pc="veil" data-pc-veil={vs!.veil} data-pc-leaving={vs!.leaving ? 'yes' : undefined}>
          <img className={`scn-pc scn-pc-veil${reduced ? '' : ' scn-pc-in'}`} style={rectCss(piecePlacement(veil.place, at(veil).width / at(veil).height, WHOLE, box, 0.43))} src={at(veil).src} alt="" decoding="async" draggable={false} />
        </div>
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
