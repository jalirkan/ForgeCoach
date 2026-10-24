/*
 * ForgeCoach — ui/ambience/SceneryStrip.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * One player's scenery strip: the slots their lands have claimed, left to
 * right, each a stack of absolutely positioned layers (a pack's images,
 * sprite sheets and loops, or the procedural art), blended at the seams and
 * faded into the board. Purely decorative: aria-hidden, pointer-events none,
 * drawn behind the battlefield's cards (scenery.css).
 *
 * Motion is transform / opacity only. Layers that appear after the strip
 * first painted bloom in; a land arriving flashes its slot. With reduced
 * motion everything is still; with the tab hidden everything pauses.
 *
 * Growth between stages (spec 1.6): between two thresholds each slot draws
 * its next stage's still pictures (the half picture, or the strip's image
 * layers by id; the built-in scene's new layers) over its own at the eased
 * progress (ambience/growth.ts), so every land grows the scene a little; a
 * land's change fades over the pack's `growth.seconds` (CSS opacity
 * transitions; at once with reduced motion), and a stage-up keeps the old
 * picture beneath until the new one is whole. At most two pictures per slot
 * once a fade settles; the next stage's moving layers wait for the stage.
 *
 * Transition frames (spec 1.7): when a land steps a slot's half picture to
 * the next stage and the pack has that step's in-betweens (warmed while the
 * slot sat at its stage, and decoded), they play over the slot with hard cuts
 * at their holds — limited animation, not a morph — while the picture beneath
 * switches at once to the new stage; the last frame then fades into it. No
 * frames (or not loaded yet), the strip art, or reduced motion: the 1.6
 * cross-fade (or the instant change) as before.
 *
 * Bridges across the seam (spec 1.8): on the half board, where two live
 * biomes meet and the pack has a bridge for the pair, the bridge piece is
 * drawn over their seam (ambience/bridges.ts: the anchor, the mirror, the
 * phone piece for a phone-shaped half), above both panels and under the
 * centre line's mist; it fades in with the second biome's arrival (its bloom)
 * and out when either leaves, at once with reduced motion. Each of the pair's
 * dual lands widens their seam (`dualsWiden`), the bridge with it.
 *
 * Pair bands (spec 1.9): on the half board, where two live biomes meet and
 * the pack's pairs (a second manifest, `pairs.json`) have the pair, the seam
 * becomes a third panel, the pair's own place, between the two (ambience/
 * pairs.ts `halfRow`): as wide as `band` says for the side's duals, half of it
 * from each neighbour, cover-cropped about its centre (a narrow band shows the
 * heart of the picture), mirrored when the board has the pair the other way
 * round, at the pair stage `stageMap` gives the lower neighbour's stage. Its
 * stage steps play the pair's transition frames, or cross-fade. It opens once
 * its picture has loaded (until then, and without pairs, the seam is today's)
 * and fades in over the later biome's bloom; it fades out and gives its width
 * back when either biome loses its lands; at once with reduced motion. Since
 * 1.10 a seam with a band draws no bridge.
 *
 * Motifs (spec 1.12): a motif pair (pairs.ts `PairKind`) takes no width: its
 * seam stays the plain seam and the pair's motif, a transparent picture
 * painted for the band's narrow full-height shape, is drawn over it, centred
 * on the seam, `motifWidth` of the half wide, stretched to that box, mirrored
 * as a band is; its stage steps play the pair's motif frames or cross-fade,
 * and it arrives, leaves and loads as a band does. A band pair's motif is
 * drawn over the band's own picture, in the band's box.
 *
  * Whole-half pair pictures (spec 1.15, `?pairfull=1`): the pair is
 * makeup.ts's one rule (the pieces' too, with the same `showing`); the
 * picture is drawn once one of its pictures has loaded -- the stage's
 * painted-in element panorama (1.16), its panorama, its 1.9 half, best first
 * (pairfull.ts `pairFullCandidates` / `pairFullChoice`) -- and until then, or
 * if all fail, the half is drawn as without the flag, never blank.
 *
 * `fill="half"` (spec 1.5, Settings → Fill each side): the same slots fill
 * the player's whole half of the board instead of a strip, split by land
 * count (layout.ts `halfLayout`), each slot's art in a frame of the art's
 * shape, cover-cropped about its focal point (`halfFrameCss`): the pack's
 * half picture when it has one, else the strip art (older packs, the
 * built-in scenery). Both halves upright; each fades into a mist band along
 * the centre line. The effects keep their strip-sized box at the outer edge.
 */
import { createContext, memo, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Biome, SlotState } from '../../ambience/model.ts';
import { DEFAULT_HALF_LAYOUT, DEFAULT_STRIP, growthOf, halfAt, layersAt, type PackBiome, type PackGrowth, type PackHalf, type PackLayer, type PackStrip, type ScenePack } from '../../ambience/manifest.ts';
import { growthMs, slotStageFade, type FadeEntry, type FadeWant } from '../../ambience/growth.ts';
import { nextStepFrames, transitionFrames, tweenAllowed, type TransitionShape } from '../../ambience/transitions.ts';
import { markPicture, pictureReady, pictureStatus, warmPicture } from '../../ambience/pack.ts';
import { frameAspect, halfArtOf, halfFrameCss, halfLayout, objectPosition, PHONE_VIEWPORT_MAX, slotLayout, spriteFrameCss, STRIP_ART, type HalfArt, type HalfSlotLayout } from '../../ambience/layout.ts';
import { bridgePlacements, halfSeams, phoneHalf, seamCentreCss, type BridgePlacement } from '../../ambience/bridges.ts';
import { bandedSeams, halfRow, motifBands, motifWidth, pairBands, pairHalfAt, pairMotifAt, pairPanoramaAt, panelBands, rowCentreCss, type PairBandPlacement, type PairMotif, type RowItem } from '../../ambience/pairs.ts';
import { proceduralLayers, type DrawLayer } from './procedural.tsx';
import { EffectView, type StripEffect } from './SceneryEffects.tsx';
import { useFadeIn, useFadeStack } from './useFade.ts';
import { useTween } from './useTween.ts';
import { pairFullCandidates, pairFullChoice, pairFullFrameCss, pairFullPanelAspect, pairFullPlan, type PairFullCandidate, type PairFullPair } from '../../ambience/pairfull.ts';
import type { MakeupShowing } from '../../ambience/makeup.ts';
import { usePicturesVersion } from './usePictures.ts';
import './scenery.css';

export type { StripEffect } from './SceneryEffects.tsx';

export interface SceneryStripProps {
  slots: SlotState[];
  pack: ScenePack | null;
  /** Which edge of the host it hugs. */
  edge?: 'bottom' | 'top';
  /** On the top edge: `upright`, a distant vista fading at both ends (default); `rotated`, turned 180° like the opponent's cards across a real table. */
  orient?: 'upright' | 'rotated';
  reduced: boolean;
  /** Land arrivals per biome; a change flashes that slot. */
  pulses?: Partial<Record<Biome, number>>;
  /** One-shot effects playing on this strip (useSceneryFx). */
  fx?: readonly StripEffect[];
  /** Draw every claimed slot at this stage (the preview page's slider). */
  stageOverride?: number | null;
  /** `strip` (default): along the outer edge; `half` (spec 1.5): the player's whole half of the board. */
  fill?: 'strip' | 'half';
  /** Spec 1.8: the player's dual lands per biome pair (model.ts `dualsOf`); they widen a bridged pair's seam. */
  duals?: Readonly<Record<string, number>>;
  /** Spec 1.13, one horizon: every panel pins its picture's horizon at the same height (layout.ts `HORIZON_AT`). */
  horizon?: boolean;
  /** Spec 1.15 (`?pairfull=1`): a half of two colours with a pair picture shows it across the whole half (pairfull.ts). */
  pairFull?: boolean;
  /** Spec 1.14 under `pairFull`: the biomes the pieces have an element for; a third such biome is drawn as an element (ScenePieces), not a panel. */
  elements?: ReadonlySet<Biome> | null;
  /** What was showing before (makeup.ts; SceneryLayer's previous pick): the tie rules, shared with the pieces. */
  showing?: MakeupShowing | null;
  className?: string;
  style?: CSSProperties;
}

/** Has the strip painted once? Layers mounted after that bloom in. */
const Settled = createContext<{ current: boolean }>({ current: true });
/** Spec 1.13: one horizon across the strip's panels (SceneryStripProps `horizon`). */
const OneHorizon = createContext(false);

export function usePageVisible(): boolean {
  const [v, setV] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  useEffect(() => {
    const on = () => setV(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return v;
}

const NO_DUALS: Readonly<Record<string, number>> = {};

export const SceneryStrip = memo(function SceneryStrip({ slots, pack, edge = 'bottom', orient = 'upright', reduced, pulses, fx, stageOverride = null, fill = 'strip', duals = NO_DUALS, horizon = false, pairFull = false, elements = null, showing = null, className, style }: SceneryStripProps) {
  const visible = usePageVisible();
  const settled = useRef(false);
  useEffect(() => {
    const t = requestAnimationFrame(() => requestAnimationFrame(() => (settled.current = true)));
    return () => cancelAnimationFrame(t);
  }, []);
  const strip: PackStrip = pack?.strip ?? DEFAULT_STRIP;
  const half = fill === 'half';
  const layout = useMemo(() => (half ? halfLayout(slots, pack, stageOverride, showing) : slotLayout(slots, pack, stageOverride)), [half, slots, pack, stageOverride, showing]);
  // Spec 1.8: each seam's width (a bridged pair's widened by its duals), and the bridges, at the half's shape.
  const hostRef = useRef<HTMLDivElement>(null);
  const bridged = half && !!pack?.bridges;
  // Spec 1.9: the pair bands between neighbouring biomes.
  const pairsPack = half ? (pack?.pairs ?? null) : null;
  const bands = useMemo(() => (pairsPack ? pairBands(layout as HalfSlotLayout[], pairsPack, duals) : []), [pairsPack, layout, duals]);
  const bandLife = useBandLife(bands, layout as HalfSlotLayout[], pack, reduced);
  // Spec 1.15: the pair picture as the whole half (null: the half as today).
  const plannedFull = useMemo(() => (pairFull && pairsPack ? pairFullPlan(layout as HalfSlotLayout[], pairsPack, { thresholds: pack?.stageThresholds, stageOverride, elements, showing }) : null), [pairFull, pairsPack, layout, pack?.stageThresholds, stageOverride, elements, showing]);
  const narrow = useNarrowScreen();
  const halfAspect = usePanelAspect(hostRef, !!plannedFull || (bridged && layout.length > 0 && Object.values(pack!.bridges!).some((b) => !!b?.phone)) || bandLife.shown.some((b) => b.pair.stages.some((st) => !!st.half?.phone || !!st.motif?.phone)));
  // Spec 1.15's load gate (review fault 4): the pair picture is drawn once a picture of it has loaded; until then, or if
  // every one fails, the half is drawn as without the flag (its panels and band), never blank. 1.16: a painted-in element first.
  const pictures = usePicturesVersion(!!plannedFull);
  const fullGate = useMemo(() => {
    const p = plannedFull?.find((x): x is PairFullPair => x.kind === 'pair') ?? null;
    if (!p) return null;
    const cands = pairFullCandidates(p, pairFullPanelAspect(halfAspect, p.share), narrow, horizon);
    return { p, ...pairFullChoice(cands, pictureStatus) };
  }, [plannedFull, halfAspect, narrow, horizon, pictures]); // eslint-disable-line react-hooks/exhaustive-deps
  const wantPic = fullGate?.want && fullGate.want !== fullGate.show ? fullGate.want.art.picture! : null;
  useEffect(() => {
    if (wantPic) warmPicture(wantPic);
  }, [wantPic?.src]); // eslint-disable-line react-hooks/exhaustive-deps
  const fullPlan = fullGate?.show ? plannedFull : null;
  // Spec 1.10: a seam with a band (wanted, or fading out) draws no bridge and keeps the base seam.
  const banded = useMemo(() => bandedSeams(bandLife.shown), [bandLife.shown]);
  const seams = useMemo(() => (half ? halfSeams(layout as HalfSlotLayout[], pack, duals, banded) : null), [half, layout, pack, duals, banded]);
  const placements = useMemo(() => (bridged ? bridgePlacements(layout as HalfSlotLayout[], pack, duals, { phone: phoneHalf(halfAspect, { narrow }), banded }) : []), [bridged, layout, pack, duals, halfAspect, banded]);
  const row: RowItem[] | null = useMemo(() => (seams ? halfRow(layout as HalfSlotLayout[], seams, panelBands(bandLife.shown), bandLife.isOpen) : null), [seams, layout, bandLife]);
  if (layout.length === 0 && !fx?.length) return null;
  const rotated = edge === 'top' && orient === 'rotated';
  const halfCfg = pack?.half ?? DEFAULT_HALF_LAYOUT;
  const growth = growthOf(pack);
  const vars = {
    '--scn-h': `clamp(${strip.minHeightPx}px, ${strip.heightRatio * 100}%, ${strip.maxHeightPx}px)`,
    '--scn-seam': `${strip.seamPx}px`,
    '--scn-solid': `${Math.round((1 - strip.fadeRatio) * 100)}%`,
    ...style,
  } as CSSProperties;
  // The half: seams a share of its width, and how far from the centre line it fades into the mist.
  const halfVars = { ...vars, '--scn-seam': `${+(halfCfg.seamRatio * 100).toFixed(2)}cqw`, '--scn-mist': `${+(halfCfg.mist * 100).toFixed(2)}%` } as CSSProperties;
  // The centre line: the top of your half, the bottom of the opponent's (upright); turned 180°, the opponent's is its own top too.
  const fadeAt = edge === 'bottom' || rotated ? 'top' : 'bottom';
  return (
    <>
      {layout.length > 0 && (
        <div
          ref={hostRef}
          className={['scn', `scn-${edge}`, half && 'scn-half', half && `scn-fade-${fadeAt}`, rotated && 'scn-rotated', edge === 'top' && !rotated && !half && 'scn-upright', reduced && 'is-reduced', !visible && 'is-paused', className].filter(Boolean).join(' ')}
          style={half ? halfVars : vars}
          aria-hidden="true"
          data-fill={fill}
        >
          <OneHorizon.Provider value={horizon}>
          <Settled.Provider value={settled}>
            <div className="scn-row">
              {fullPlan
                ? fullPlan.map((it, k) => {
                    if (it.kind === 'pair') return <PairFullPanel key={`pairfull:${it.key}`} p={it} shown={fullGate!.show!} first={k === 0} growth={growth} reduced={reduced} />;
                    const l = (layout as HalfSlotLayout[])[it.index]!;
                    return <Slot key={l.slot.biome} slot={l.slot} stage={l.stage} progress={l.progress} grow={it.share} first={k === 0} pack={pack?.biomes[l.slot.biome]} growth={growth} reduced={reduced} paused={!visible} pulse={pulses?.[l.slot.biome] ?? 0} half={half} />;
                  })
                : row
                ? row.map((it, k) => {
                    const seam = k > 0 && it.seam !== halfCfg.seamRatio ? `${+(it.seam * 100).toFixed(2)}cqw` : undefined;
                    if (it.kind === 'band') {
                      const b = it.band!;
                      return <Band key={`band:${b.key}`} b={b} share={it.share} seam={seam} open={bandLife.isOpen(b.key)} leaving={bandLife.leaving.has(b.key)} ms={bandLife.msOf(b)} phone={phoneHalf(halfAspect, { narrow })} growth={growth} reduced={reduced} onReady={bandLife.ready} />;
                    }
                    const l = (layout as HalfSlotLayout[])[it.index]!;
                    return <Slot key={l.slot.biome} slot={l.slot} stage={l.stage} progress={l.progress} grow={it.share} first={k === 0} afterBand={row[k - 1]?.kind === 'band'} pack={pack?.biomes[l.slot.biome]} growth={growth} reduced={reduced} paused={!visible} pulse={pulses?.[l.slot.biome] ?? 0} half={half} seam={seam} />;
                  })
                : layout.map(({ slot, stage, progress, grow }, i) => (
                    <Slot key={slot.biome} slot={slot} stage={stage} progress={progress} grow={grow} first={i === 0} pack={pack?.biomes[slot.biome]} growth={growth} reduced={reduced} paused={!visible} pulse={pulses?.[slot.biome] ?? 0} half={half} />
                  ))}
              {!fullPlan && row && bridged && <Bridges placements={placements} layout={layout as HalfSlotLayout[]} row={row} pack={pack} reduced={reduced} />}
              {!fullPlan &&
                row &&
                motifBands(bandLife.shown).map((b) => {
                  const l = (layout as HalfSlotLayout[])[b.index - 1];
                  const r = (layout as HalfSlotLayout[])[b.index];
                  if (!l || !r) return null;
                  return <MotifView key={`motif:${b.key}`} b={b} left={bridgeLeftCss(row, b.index)} width={motifWidth(b.width, l.share, r.share)} open={bandLife.isOpen(b.key)} leaving={bandLife.leaving.has(b.key)} ms={bandLife.msOf(b)} phone={phoneHalf(halfAspect, { narrow })} growth={growth} reduced={reduced} onReady={bandLife.ready} />;
                })}
            </div>
            {half && <div className="scn-mist" />}
          </Settled.Provider>
          </OneHorizon.Provider>
        </div>
      )}
      {/* Effects: the strip's twin box, without its deep fade (an effect on the far strip would vanish in it); still behind the cards. */}
      {fx && fx.length > 0 && (
        <div className={['scn-fxs', `scn-${edge}`, rotated && 'scn-rotated', edge === 'top' && !rotated && 'is-upright', reduced && 'is-reduced', !visible && 'is-paused'].filter(Boolean).join(' ')} style={vars} aria-hidden="true">
          {fx.map((f) => (
            <EffectView key={f.key} fx={f} edge={edge} rotated={rotated} reduced={reduced} paused={!visible} />
          ))}
        </div>
      )}
    </>
  );
});

/** Is the screen phone-width (layout.ts `PHONE_VIEWPORT_MAX`)? Its halves then take the phone pictures. Follows rotation and resizes. */
export function useNarrowScreen(): boolean {
  const query = `(max-width: ${PHONE_VIEWPORT_MAX}px)`;
  const [narrow, setNarrow] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const m = matchMedia(query);
    const on = () => setNarrow(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return narrow;
}

/** A panel's shape (width / height), measured only when a choice hangs on it (a stage with a phone picture); null otherwise. Rounded, so a flex transition re-renders rarely. */
function usePanelAspect(ref: React.RefObject<HTMLDivElement | null>, on: boolean): number | null {
  const [aspect, setAspect] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!on || !el) return setAspect(null);
    const read = (w: number, h: number) => setAspect(w > 0 && h > 0 ? Math.round((w / h) * 20) / 20 : null);
    const r = el.getBoundingClientRect();
    read(r.width, r.height);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((e) => {
      const c = e[0]?.contentRect;
      if (c) read(c.width, c.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, on]);
  return aspect;
}

const PROCEDURAL_BLOOM = { kind: 'rise' as const, durationMs: 1400, staggerMs: 140 };
const NO_BLOOM = { kind: 'none' as const, durationMs: 0, staggerMs: 0 };
/** The built-in scenery's last stage (procedural.tsx draws 1–4). */
const PROCEDURAL_STAGES = 4;

/** A pack layer's identity across stages: the same id with the same file and box is the same picture. */
const layerKey = (l: PackLayer) => `${l.id}|${l.src}|${l.x},${l.y},${l.w},${l.h}|${l.opacity}|${l.fit}|${l.anchor}`;

/** Ids in first-seen order. */
const uniqueIds = (lists: { id: string }[][]) => [...new Set(lists.flat().map((l) => l.id))];

function Slot({
  slot,
  stage,
  progress,
  grow,
  first,
  pack,
  growth,
  reduced,
  paused,
  pulse,
  half = false,
  seam,
  afterBand = false,
}: {
  slot: SlotState;
  stage: number;
  progress: number;
  grow: number;
  first: boolean;
  pack: PackBiome | undefined;
  growth: PackGrowth;
  reduced: boolean;
  paused: boolean;
  pulse: number;
  half?: boolean;
  /** Spec 1.8: this slot's own seam (a bridged pair's, widened by its duals), as CSS; else the half's. */
  seam?: string;
  /** Spec 1.10: the item left of it is a pair band (no seam mist here: the band is the transition). */
  afterBand?: boolean;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const settled = useContext(Settled);
  const withered = stage <= 0;
  const drawn = Math.max(1, stage);
  // Spec 1.6: how long a land's fade takes (none with reduced motion).
  const ms = growthMs(growth, reduced);
  // Pictures that failed to load (a half picture falls back to the strip art; a next one is simply not drawn).
  const [failed, setFailed] = useState<readonly string[]>([]);
  const fail = useCallback((src: string) => setFailed((f) => (f.includes(src) ? f : [...f, src])), []);
  const hasNextStage = !withered && (pack ? drawn < pack.stages.length : drawn < PROCEDURAL_STAGES);
  // The half (spec 1.5): the stage's half picture (the phone one in a portrait-ish panel), unless it failed to load (then the strip art, cropped).
  const picture: PackHalf | null = half ? halfAt(pack, drawn) : null;
  const nextPicture: PackHalf | null = half && hasNextStage ? halfAt(pack, drawn + 1) : null;
  const ref = useRef<HTMLDivElement>(null);
  const panelAspect = usePanelAspect(ref, !!(picture?.phone || nextPicture?.phone));
  const narrow = useNarrowScreen();
  const horizon = useContext(OneHorizon);
  const chosen = half ? halfArtOf(picture, panelAspect, { narrow, horizon }) : null;
  const art: HalfArt | null = !chosen ? null : chosen.picture && failed.includes(chosen.picture.src) ? STRIP_ART : chosen;
  const pic = art?.picture ?? null;
  // Spec 1.6: the next stage's half picture, cross-faded over this one by the progress.
  const nextChosen = pic && nextPicture ? halfArtOf(nextPicture, panelAspect, { narrow, horizon }) : null;
  const nextArt = nextChosen?.picture && nextChosen.picture.src !== pic!.src && !failed.includes(nextChosen.picture.src) ? nextChosen : null;

  // Spec 1.7: the in-between frames of a stage step, played over the half picture when they are warmed and decoded.
  const shape: TransitionShape = art?.source === 'phone' ? 'phone' : 'desktop';
  const tweenable = !!pic && art?.source !== 'strip' && !withered;
  const tweenCtx = useRef({ pack, shape, tweenable, reduced });
  tweenCtx.current = { pack, shape, tweenable, reduced };
  const tween = useTween(
    drawn,
    useCallback((from: number, to: number) => {
      const c = tweenCtx.current;
      if (!c.tweenable || !tweenAllowed(c.pack?.transitions, c.reduced, from)) return null;
      const frames = transitionFrames(c.pack, from, to, c.shape);
      return frames && frames.every((f) => pictureReady(f.src)) ? frames : null;
    }, []),
    pack?.transitions?.fadeMs ?? 0,
  );
  // The next step's frames warm while the slot sits at its stage, so the cuts are never loads.
  useEffect(() => {
    if (!tweenable || reduced || !pack?.transitions) return;
    for (const src of nextStepFrames(pack, drawn, shape)) warmPicture({ src, src2x: null });
  }, [pack, drawn, shape, tweenable, reduced]);
  // While frames play they cover the change: the picture beneath switches at once.
  const groupMs = tween.frames ? 0 : ms;

  // A pack's layers: its still images cross-fade by id toward the next stage's; moving layers are the stage's own.
  const curLayers = pack ? layersAt(pack, drawn) : [];
  const nextLayers = pack && hasNextStage ? layersAt(pack, drawn + 1) : [];
  const stills = pic ? [] : curLayers.filter((l) => l.kind === 'image');
  const nextStills = pic ? [] : nextLayers.filter((l) => l.kind === 'image' && !stills.some((c) => layerKey(c) === layerKey(l)));
  // With a half picture, the stage's still layers give way to it; its loops and sprites play over the desktop picture (none over the phone one: they are cut for the desktop's shape).
  const moving = curLayers.filter((l) => l.kind !== 'image' && !(pic && art?.source === 'phone'));
  // The built-in scene: the next stage's new layers.
  const proc = useMemo(() => (pack ? [] : proceduralLayers(slot.biome, drawn, uid)), [pack, slot.biome, drawn, uid]);
  const procNext = useMemo(() => (pack || !hasNextStage ? [] : proceduralLayers(slot.biome, drawn + 1, uid).filter((l) => !proc.some((c) => c.id === l.id))), [pack, hasNextStage, slot.biome, drawn, uid, proc]);
  const hasNext = pack ? (pic ? !!nextArt : nextStills.length > 0) : procNext.length > 0;
  // Spec 1.10: a half picture is never drawn half over another (two horizons); strip layers still cross-fade by the progress.
  const fade = slotStageFade(progress, hasNext, growth, !!pic);

  const bloom = pack?.bloom ?? PROCEDURAL_BLOOM;
  let order = 0;
  const groups: ReactNode[] = [];
  if (pic) {
    groups.push(
      <FadeGroup
        key="half"
        cur={{ key: pic.src, payload: art! }}
        next={nextArt && fade > 0 ? { key: nextArt.picture!.src, payload: nextArt } : null}
        fade={fade}
        ms={groupMs}
        render={(e) => (
          <Layer key={e.key} z={-100} depth={0} fade={e.opacity} from={e.from} ms={groupMs} bloom={e.role === 'cur' ? bloom : NO_BLOOM} order={0} reduced={reduced}>
            <HalfPictureView art={e.payload} onFail={fail} />
          </Layer>
        )}
      />,
    );
    if (tween.frames) {
      // Every frame is mounted for the sequence (they are decoded already); only the one on screen is drawn: hard cuts.
      groups.push(
        <Layer key="tween" z={-99} depth={0} fade={tween.fading ? 0 : 1} from={1} ms={tween.fading ? tween.fadeMs : 0} bloom={NO_BLOOM} order={0} reduced={reduced}>
          {tween.frames.map((f, i) => (
            <HalfPictureView key={f.src} art={{ ...art!, picture: { ...art!.picture!, src: f.src, src2x: null } }} onFail={() => {}} hidden={i !== tween.index} />
          ))}
        </Layer>,
      );
    }
  } else if (pack) {
    for (const id of uniqueIds([stills, fade > 0 ? nextStills : []])) {
      const c = stills.find((l) => l.id === id) ?? null;
      const n = fade > 0 ? (nextStills.find((l) => l.id === id) ?? null) : null;
      const at = order++;
      groups.push(
        <FadeGroup
          key={`still:${id}`}
          cur={c ? { key: layerKey(c), payload: c } : null}
          next={n ? { key: layerKey(n), payload: n } : null}
          fade={fade}
          ms={ms}
          render={(e) => (
            <Layer key={e.key} z={e.payload.z} depth={e.payload.depth} blend={e.payload.blend} opacity={e.payload.opacity} fade={e.opacity} from={e.from} ms={ms} bloom={e.role === 'cur' ? bloom : NO_BLOOM} order={at} reduced={reduced}>
              <PackLayerView layer={e.payload} idle={pack.idle} reduced={reduced} paused={paused} />
            </Layer>
          )}
        />,
      );
    }
  }
  const others: { id: string; z: number; depth: number; blend?: string; opacity?: number; fade: number; node: ReactNode }[] = pack
    ? moving.map((l) => ({ id: l.id, z: l.z, depth: l.depth, blend: l.blend, opacity: l.opacity, fade: 1, node: <PackLayerView layer={l} idle={pack.idle} reduced={reduced} paused={paused} /> }))
    : [...proc.map((l: DrawLayer) => ({ ...l, fade: 1 })), ...(fade > 0 ? procNext.map((l: DrawLayer) => ({ ...l, fade })) : [])];
  const rest = [...others]
    .sort((a, b) => a.z - b.z)
    .map((l) => (
      // A layer that appears after the first paint at a fade starts from nothing.
      <Layer key={l.id} z={l.z} depth={l.depth} blend={l.blend} opacity={l.opacity} fade={l.fade} from={l.fade < 1 && settled.current ? 0 : l.fade} ms={ms} bloom={bloom} order={order++} reduced={reduced}>
        {l.node}
      </Layer>
    ));
  return (
    <div
      ref={ref}
      className={['scn-slot', first && 'is-first', withered && 'is-withered', afterBand && 'is-after-band'].filter(Boolean).join(' ')}
      style={seam ? ({ flexGrow: grow, '--scn-seam': seam } as CSSProperties) : { flexGrow: grow }}
      data-biome={slot.biome}
      data-stage={stage}
      data-progress={progress || undefined}
      data-fade={fade || undefined}
      data-art={art?.source}
      data-tween={tween.frames ? `${tween.index + 1}/${tween.frames.length}${tween.fading ? ' fading' : ''}` : undefined}
    >
      {pic ? (
        <>
          {groups}
          <div className="scn-frame" style={halfFrameCss(art!)}>
            {rest}
          </div>
        </>
      ) : art ? (
        <div className="scn-frame" style={halfFrameCss(art)}>
          {groups}
          {rest}
        </div>
      ) : (
        <>
          {groups}
          {rest}
        </>
      )}
      {pulse > 0 && settled.current && !reduced && <span key={pulse} className="scn-flash" />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pair bands (spec 1.9)

/** How long a band fades: the bloom of the biome that arrived second (the later slot), as a bridge does. */
function laterBloomMs(index: number, layout: readonly HalfSlotLayout[], pack: ScenePack | null): number {
  const l = layout[index - 1]?.slot;
  const r = layout[index]?.slot;
  if (!l || !r) return PROCEDURAL_BLOOM.durationMs;
  const later = l.index > r.index ? l : r;
  return pack?.biomes[later.biome]?.bloom.durationMs ?? PROCEDURAL_BLOOM.durationMs;
}

/**
 * A side's bands across renders: the ones wanted now, plus, for one fade, the
 * ones no longer wanted (fading out, giving their width back); which have
 * their picture (a band takes its width only then: until it has, the seam is
 * today's). With reduced motion a band leaves at once.
 */
function useBandLife(bands: PairBandPlacement[], layout: readonly HalfSlotLayout[], pack: ScenePack | null, reduced: boolean) {
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(() => new Set());
  const [gone, setGone] = useState<{ b: PairBandPlacement; ms: number }[]>([]);
  const prev = useRef<PairBandPlacement[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const keys = bands.map((b) => b.key).join('|');
  const msOf = useCallback((b: PairBandPlacement) => (reduced ? 0 : laterBloomMs(b.index, layout, pack)), [reduced, layout, pack]);
  useEffect(() => {
    const left = prev.current.filter((x) => !bands.some((b) => b.key === x.key));
    prev.current = bands;
    if (!left.length) return;
    const items = left.map((b) => ({ b, ms: msOf(b) }));
    const drop = (ks: string[]) => {
      setGone((g) => g.filter((x) => !ks.includes(x.b.key) || bands.some((b) => b.key === x.b.key)));
      // A band that comes back later loads (and fades) in again.
      setLoaded((s) => (ks.some((k) => s.has(k)) ? new Set([...s].filter((k) => !ks.includes(k))) : s));
    };
    const slow = items.filter((x) => x.ms > 0);
    if (items.length > slow.length) drop(items.filter((x) => x.ms <= 0).map((x) => x.b.key));
    if (!slow.length) return;
    setGone((g) => [...g.filter((x) => !slow.some((y) => y.b.key === x.b.key)), ...slow]);
    timers.current.push(setTimeout(() => drop(slow.map((x) => x.b.key)), Math.max(...slow.map((x) => x.ms)) + 80));
  }, [keys]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const leavingList = gone.filter((x) => !bands.some((b) => b.key === x.b.key) && x.b.index < layout.length).map((x) => x.b);
  const leaving = useMemo(() => new Set(leavingList.map((b) => b.key)), [leavingList.map((b) => b.key).join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => [...bands, ...leavingList], [bands, leavingList.map((b) => b.key).join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const ready = useCallback((key: string) => setLoaded((s) => (s.has(key) ? s : new Set([...s, key]))), []);
  const isOpen = useCallback((key: string) => loaded.has(key) && !leaving.has(key), [loaded, leaving]);
  return useMemo(() => ({ shown, leaving, isOpen, ready, msOf }), [shown, leaving, isOpen, ready, msOf]);
}

/**
 * One pair band: a panel of the half's row between its two biomes, the pair's
 * picture at its stage, cover-cropped about its focal point (its centre), the
 * phone picture on a phone-shaped half, mirrored when the board has the pair
 * reversed. Stage steps play the pair's frames (spec 1.7) or cross-fade (1.6's
 * `growth.seconds`). It reports when its picture has loaded (`onReady`); until
 * then it has no width and no opacity.
 */
function Band({ b, share, seam, open, leaving, ms, phone, growth, reduced, onReady }: { b: PairBandPlacement; share: number; seam?: string; open: boolean; leaving: boolean; ms: number; phone: boolean; growth: PackGrowth; reduced: boolean; onReady: (key: string) => void }) {
  const settled = useContext(Settled);
  const h = pairHalfAt(b.pair, b.stage);
  const motif = motifPicOf(pairMotifAt(b.pair, b.stage), phone && !!h?.phone);
  const horizon = useContext(OneHorizon);
  const art = h ? halfArtOf(h, phone && h.phone ? h.phone.width / h.phone.height : null, { horizon }) : null;
  const shape: TransitionShape = art?.source === 'phone' ? 'phone' : 'desktop';
  const tweenCtx = useRef({ pair: b.pair, shape, reduced });
  tweenCtx.current = { pair: b.pair, shape, reduced };
  const tween = useTween(
    b.stage,
    useCallback((from: number, to: number) => {
      const c = tweenCtx.current;
      if (!tweenAllowed(c.pair.transitions, c.reduced, from)) return null;
      const frames = transitionFrames(c.pair, from, to, c.shape);
      return frames && frames.every((f) => pictureReady(f.src)) ? frames : null;
    }, []),
    b.pair.transitions?.fadeMs ?? 0,
  );
  useEffect(() => {
    if (reduced || !b.pair.transitions) return;
    for (const src of nextStepFrames(b.pair, b.stage, shape)) warmPicture({ src, src2x: null });
  }, [b.pair, b.stage, shape, reduced]);
  // Open on the next frame once the picture is here, so the width and the opacity transition from nothing; on the strip's first paint at once.
  const pic = art?.picture ?? null;
  const loaded = useCallback(
    (src: string) => {
      if (src !== pic?.src) return;
      if (!settled.current) onReady(b.key);
      else requestAnimationFrame(() => onReady(b.key));
    },
    [pic?.src, b.key, onReady, settled],
  );
  const groupMs = tween.frames ? 0 : growthMs(growth, reduced);
  const shown = open && !leaving;
  const style = {
    flexGrow: share,
    ...(seam ? { '--scn-seam': seam } : {}),
    opacity: shown ? 1 : 0,
    transition: `flex-grow 900ms ease${ms > 0 ? `, opacity ${ms}ms ease` : ''}`,
  } as CSSProperties;
  return (
    <div
      className={['scn-slot', 'scn-band', b.mirror && 'is-mirrored'].filter(Boolean).join(' ')}
      style={style}
      data-band={b.key}
      data-band-share={share}
      data-band-width={b.width}
      data-band-duals={b.duals || undefined}
      data-band-stage={b.stage}
      data-band-open={open ? 'yes' : 'no'}
      data-band-dual={b.pair.dual ?? undefined}
      data-art={art?.source}
      data-tween={tween.frames ? `${tween.index + 1}/${tween.frames.length}${tween.fading ? ' fading' : ''}` : undefined}
    >
      {pic && (
        <div className="scn-band-art">
          <FadeGroup
            cur={{ key: pic.src, payload: art! }}
            next={null}
            fade={0}
            ms={groupMs}
            render={(e) => (
              <Layer key={e.key} z={-100} depth={0} fade={e.opacity} from={e.from} ms={groupMs} bloom={NO_BLOOM} order={0} reduced={reduced}>
                <HalfPictureView art={e.payload} onFail={() => {}} onLoad={e.role === 'cur' ? loaded : undefined} />
              </Layer>
            )}
          />
          {tween.frames && (
            <Layer key="tween" z={-99} depth={0} fade={tween.fading ? 0 : 1} from={1} ms={tween.fading ? tween.fadeMs : 0} bloom={NO_BLOOM} order={0} reduced={reduced}>
              {tween.frames.map((f, i) => (
                <HalfPictureView key={f.src} art={{ ...art!, picture: { ...art!.picture!, src: f.src, src2x: null } }} onFail={() => {}} hidden={i !== tween.index} />
              ))}
            </Layer>
          )}
          {motif && (
            <FadeGroup
              cur={{ key: motif.src, payload: motif }}
              next={null}
              fade={0}
              ms={growthMs(growth, reduced)}
              render={(e) => (
                <Layer key={`motif:${e.key}`} z={-90} depth={0} fade={e.opacity} from={e.from} ms={growthMs(growth, reduced)} bloom={NO_BLOOM} order={0} reduced={reduced}>
                  <MotifPicture pic={e.payload} />
                </Layer>
              )}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Spec 1.15: the pair picture as the whole half (`?pairfull=1`)

/**
 * The pair picture across its panel (the whole half, or all of it but a third
 * biome's panel): the stage's `panorama` (pairs-v4), else its `half` picture
 * (the phone one on a phone or a phone-shaped panel; pairfull.ts
 * `pairFullArt`), drawn pairfull.ts `pairFullFrameCss` wide and panned so
 * the picture's transition sits at the land share; mirrored when the board has
 * the pair the other way round. A land moves the frame over 900 ms, as the
 * panels move; a stage step cross-fades over `growth.seconds`.
 */
/**
 * Spec 1.15: the pair picture across the half (or all of it but the third
 * biome's panel). `shown` is the load gate's choice (SceneryStrip,
 * pairfull.ts `pairFullChoice`): a picture that has loaded -- the stage's
 * painted-in element panorama (1.16), its panorama, or its 1.9 half -- so a
 * change (a stage, a third colour's painted panorama) cross-fades from one
 * loaded picture to the next. Its <img> reports its own load and error to the
 * picture store, so a picture that fails while drawn gives way to the next.
 */
function PairFullPanel({ p, shown, first, growth, reduced }: { p: PairFullPair; shown: PairFullCandidate; first: boolean; growth: PackGrowth; reduced: boolean }) {
  const pano = pairPanoramaAt(p.pair, p.stage);
  const art = shown.art;
  // The frame is computed in the picture's own order; the mirror flips it back.
  const split = p.mirror ? 1 - p.split : p.split;
  const ms = growthMs(growth, reduced);
  const pic = art.picture!;
  return (
    <div
      className={['scn-slot', 'scn-pairfull', first && 'is-first', p.mirror && 'is-mirrored'].filter(Boolean).join(' ')}
      style={{ flexGrow: p.share }}
      data-pairfull={p.key}
      data-pairfull-split={p.split}
      data-pairfull-stage={p.stage}
      data-pairfull-dual={p.pair.dual ?? undefined}
      data-pairfull-panorama={pano && (pic.src === pano.src || pic.src === pano.phone?.src) ? 'yes' : undefined}
      data-pairfull-element={p.element ?? undefined}
      data-pairfull-painted={shown.painted ?? undefined}
      data-art={art.source}
    >
      <div className="scn-pairfull-art">
        <FadeGroup
          cur={{ key: pic.src, payload: art }}
          next={null}
          fade={0}
          ms={ms}
          render={(e) => (
            <Layer key={e.key} z={-100} depth={0} fade={e.opacity} from={e.from} ms={ms} bloom={NO_BLOOM} order={0} reduced={reduced}>
              <PairFullPicture art={e.payload} split={split} />
            </Layer>
          )}
        />
      </div>
    </div>
  );
}

function PairFullPicture({ art, split }: { art: HalfArt; split: number }) {
  const pic = art.picture!;
  return (
    <div className="scn-frame scn-pairfull-frame" style={pairFullFrameCss(art, split)}>
      <img className="scn-half-img" src={pic.src} srcSet={pic.src2x ? `${pic.src} 1x, ${pic.src2x} 2x` : undefined} alt="" decoding="async" draggable={false} onLoad={() => markPicture(pic.src, true)} onError={() => markPicture(pic.src, false)} />
    </div>
  );
}

/** Spec 1.12: the motif picture a box shows (the phone one on a phone-shaped half), or null. */
function motifPicOf(m: PairMotif | null, phone: boolean): { src: string; src2x: string | null } | null {
  if (!m) return null;
  return phone && m.phone ? m.phone : m;
}

/** Spec 1.12: a motif picture stretched to its box (painted for that shape; never cropped, so its soft edges stay whole). */
function MotifPicture({ pic, onLoad, hidden = false }: { pic: { src: string; src2x: string | null }; onLoad?: (src: string) => void; hidden?: boolean }) {
  const img = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const el = img.current;
    if (onLoad && el?.complete && el.naturalWidth > 0) onLoad(pic.src);
  }, [pic.src]); // eslint-disable-line react-hooks/exhaustive-deps
  return <img ref={img} className="scn-motif-img" style={hidden ? { opacity: 0 } : undefined} src={pic.src} srcSet={pic.src2x ? `${pic.src} 1x, ${pic.src2x} 2x` : undefined} alt="" decoding="async" draggable={false} onLoad={onLoad ? () => onLoad(pic.src) : undefined} />;
}

/**
 * Spec 1.12: a motif pair over its plain seam: the pair's motif at its stage,
 * centred on the seam (`left`, in the half's container units), `width` of the
 * half wide and the half's full height, mirrored when the board has the pair
 * reversed; its stage steps play the pair's motif frames (1.7's rules) or
 * cross-fade over `growth.seconds`. It reports when its picture has loaded
 * (`onReady`) and is invisible until then; it fades out when it leaves.
 */
function MotifView({ b, left, width, open, leaving, ms, phone, growth, reduced, onReady }: { b: PairBandPlacement; left: string; width: number; open: boolean; leaving: boolean; ms: number; phone: boolean; growth: PackGrowth; reduced: boolean; onReady: (key: string) => void }) {
  const settled = useContext(Settled);
  const m = pairMotifAt(b.pair, b.stage);
  const pic = motifPicOf(m, phone);
  const shape: TransitionShape = phone && m?.phone ? 'phone' : 'desktop';
  const tweenCtx = useRef({ pair: b.pair, shape, reduced });
  tweenCtx.current = { pair: b.pair, shape, reduced };
  const tween = useTween(
    b.stage,
    useCallback((from: number, to: number) => {
      const c = tweenCtx.current;
      if (!tweenAllowed(c.pair.transitions, c.reduced, from)) return null;
      const frames = transitionFrames(c.pair, from, to, c.shape);
      return frames && frames.every((f) => pictureReady(f.src)) ? frames : null;
    }, []),
    b.pair.transitions?.fadeMs ?? 0,
  );
  useEffect(() => {
    if (reduced || !b.pair.transitions) return;
    for (const src of nextStepFrames(b.pair, b.stage, shape)) warmPicture({ src, src2x: null });
  }, [b.pair, b.stage, shape, reduced]);
  const loaded = useCallback(
    (src: string) => {
      if (src !== pic?.src) return;
      if (!settled.current) onReady(b.key);
      else requestAnimationFrame(() => onReady(b.key));
    },
    [pic?.src, b.key, onReady, settled],
  );
  const groupMs = tween.frames ? 0 : growthMs(growth, reduced);
  const shown = open && !leaving;
  const style = {
    left,
    width: `${+(width * 100).toFixed(3)}cqw`,
    opacity: shown ? 1 : 0,
    transition: `width 900ms ease, left 900ms ease${ms > 0 ? `, opacity ${ms}ms ease` : ''}`,
  } as CSSProperties;
  return (
    <div
      className={['scn-motif', b.mirror && 'is-mirrored'].filter(Boolean).join(' ')}
      style={style}
      data-motif={b.key}
      data-band={b.key}
      data-band-width={b.width}
      data-band-duals={b.duals || undefined}
      data-band-stage={b.stage}
      data-band-open={open ? 'yes' : 'no'}
      data-band-dual={b.pair.dual ?? undefined}
      data-art={shape}
      data-tween={tween.frames ? `${tween.index + 1}/${tween.frames.length}${tween.fading ? ' fading' : ''}` : undefined}
    >
      {pic && (
        <div className="scn-motif-art">
          <FadeGroup
            cur={{ key: pic.src, payload: pic }}
            next={null}
            fade={0}
            ms={groupMs}
            render={(e) => (
              <Layer key={e.key} z={-100} depth={0} fade={e.opacity} from={e.from} ms={groupMs} bloom={NO_BLOOM} order={0} reduced={reduced}>
                <MotifPicture pic={e.payload} onLoad={e.role === 'cur' ? loaded : undefined} />
              </Layer>
            )}
          />
          {tween.frames && (
            <Layer key="tween" z={-99} depth={0} fade={tween.fading ? 0 : 1} from={1} ms={tween.fading ? tween.fadeMs : 0} bloom={NO_BLOOM} order={0} reduced={reduced}>
              {tween.frames.map((f, i) => (
                <MotifPicture key={f.src} pic={{ src: f.src, src2x: null }} hidden={i !== tween.index} />
              ))}
            </Layer>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bridges across the seam (spec 1.8)

/** How long a bridge fades: the bloom of the biome that arrived second (the later slot). */
function bridgeMs(p: BridgePlacement, layout: readonly HalfSlotLayout[], pack: ScenePack | null): number {
  const l = layout[p.index - 1]!.slot;
  const r = layout[p.index]!.slot;
  const later = l.index > r.index ? l : r;
  return pack?.biomes[later.biome]?.bloom.durationMs ?? PROCEDURAL_BLOOM.durationMs;
}

/**
 * The side's bridges: each drawn while its pair is live, and kept for one
 * fade after it is not (either biome withered), fading out. With reduced
 * motion, there and gone at once.
 */
function Bridges({ placements, layout, row, pack, reduced }: { placements: BridgePlacement[]; layout: HalfSlotLayout[]; row: RowItem[]; pack: ScenePack | null; reduced: boolean }) {
  const settled = useContext(Settled);
  const [gone, setGone] = useState<{ p: BridgePlacement; ms: number }[]>([]);
  const prev = useRef<{ p: BridgePlacement; ms: number }[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const now = placements.map((p) => ({ p, ms: reduced ? 0 : bridgeMs(p, layout, pack) }));
  const keys = placements.map((p) => p.key).join('|');
  useEffect(() => {
    const left = prev.current.filter((x) => !placements.some((p) => p.key === x.p.key) && x.ms > 0);
    prev.current = now;
    if (!left.length) return;
    setGone((g) => [...g.filter((x) => !left.some((y) => y.p.key === x.p.key)), ...left]);
    timers.current.push(setTimeout(() => setGone((g) => g.filter((x) => !left.includes(x))), Math.max(...left.map((x) => x.ms)) + 80));
  }, [keys]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const leaving = gone.filter((x) => !placements.some((p) => p.key === x.p.key) && x.p.index < layout.length);
  // One list, so a bridge that stops being wanted keeps its element (and its loaded picture) while it fades out.
  return (
    <>
      {[...now.map((x) => ({ ...x, leaving: false })), ...leaving.map((x) => ({ ...x, leaving: true }))].map((x) => (
        <BridgeView key={x.p.key} p={x.p} left={bridgeLeftCss(row, x.p.index)} ms={x.ms} leaving={x.leaving} fadeIn={settled.current && !reduced} />
      ))}
    </>
  );
}

/**
 * Where a bridge's centre sits across the half: on the pair band's centre when
 * the seam has one (spec 1.9: the bridge is drawn over the band), else on the
 * seam's middle — the same point while the band has no width.
 */
function bridgeLeftCss(row: RowItem[], index: number): string {
  const band = row.findIndex((it) => it.kind === 'band' && it.index === index);
  if (band >= 0) return rowCentreCss(row, band);
  const slot = row.findIndex((it) => it.kind === 'slot' && it.index === index);
  return seamCentreCss(row, row.map((it) => it.seam), Math.max(0, slot));
}

/** One bridge piece: centred on its seam at the anchor's height, as wide as the anchor (and the duals) say, mirrored when the board's order is the art's reverse. */
function BridgeView({ p, left, ms, leaving, fadeIn }: { p: BridgePlacement; left: string; ms: number; leaving: boolean; fadeIn: boolean }) {
  const img = useRef<HTMLImageElement>(null);
  // Drawn once its file is here (warmed with the split's pictures), so the fade never starts on an empty box.
  const [loaded, setLoaded] = useState(false);
  const [fades] = useState(fadeIn);
  useEffect(() => {
    const el = img.current;
    if (el?.complete && el.naturalWidth > 0) setLoaded(true);
  }, [p.picture.src]);
  const shown = loaded && !leaving;
  const fadeMs = fades || leaving ? ms : 0;
  const style = {
    left,
    top: `${+(p.y * 100).toFixed(2)}%`,
    width: `${+(p.width * 100).toFixed(2)}cqw`,
    opacity: shown ? 1 : 0,
    transition: [`left 900ms ease`, `width 900ms ease`, fadeMs > 0 ? `opacity ${fadeMs}ms ease` : null].filter(Boolean).join(', '),
  } as CSSProperties;
  return (
    <div className={['scn-bridge', p.mirror && 'is-mirrored'].filter(Boolean).join(' ')} style={style} data-bridge={p.key} data-bridge-shape={p.phone ? 'phone' : 'desktop'} data-bridge-scale={p.scale !== 1 ? p.scale : undefined}>
      <img ref={img} src={p.picture.src} srcSet={p.picture.src2x ? `${p.picture.src} 1x, ${p.picture.src2x} 2x` : undefined} alt="" decoding="async" draggable={false} onLoad={() => setLoaded(true)} />
    </div>
  );
}

/** One picture slot's fade stack (spec 1.6), each entry drawn by `render`. */
function FadeGroup<T>({ cur, next, fade, ms, render }: { cur: FadeWant<T> | null; next: FadeWant<T> | null; fade: number; ms: number; render: (e: FadeEntry<T>) => ReactNode }) {
  const stack = useFadeStack(cur, next, fade, ms);
  return <>{stack.map(render)}</>;
}

/** A half picture in its own frame (each stage's picture keeps its own crop). */
function HalfPictureView({ art, onFail, onLoad, hidden = false }: { art: HalfArt; onFail: (src: string) => void; onLoad?: (src: string) => void; hidden?: boolean }) {
  const pic = art.picture!;
  const img = useRef<HTMLImageElement>(null);
  // A cached picture may have loaded before React attached onLoad.
  useEffect(() => {
    const el = img.current;
    if (onLoad && el?.complete && el.naturalWidth > 0) onLoad(pic.src);
  }, [pic.src]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="scn-frame" style={hidden ? { ...halfFrameCss(art), opacity: 0 } : halfFrameCss(art)}>
      <img ref={img} className="scn-half-img" src={pic.src} srcSet={pic.src2x ? `${pic.src} 1x, ${pic.src2x} 2x` : undefined} alt="" decoding="async" draggable={false} onError={() => onFail(pic.src)} onLoad={onLoad ? () => onLoad(pic.src) : undefined} />
    </div>
  );
}

function Layer({
  z,
  depth,
  blend,
  opacity,
  fade = 1,
  from,
  ms = 0,
  bloom,
  order,
  reduced,
  children,
}: {
  z: number;
  depth: number;
  blend?: string;
  opacity?: number;
  /** Spec 1.6: drawn at this fraction of its opacity (the next stage's, fading in with the progress). */
  fade?: number;
  /** The fraction on its first paint (0: it fades in). */
  from?: number;
  /** How long a change of `fade` takes. */
  ms?: number;
  bloom: { kind: string; durationMs: number; staggerMs: number };
  order: number;
  reduced: boolean;
  children: ReactNode;
}) {
  const settled = useContext(Settled);
  const ref = useRef<HTMLDivElement>(null);
  // Decided once, at mount: only layers that arrive after the first paint bloom (and a layer keeps its bloom as its role in a fade changes).
  const [b] = useState(() => (settled.current && !reduced && bloom.kind !== 'none' && bloom.durationMs > 0 ? bloom : null));
  const shown = useFadeIn(ref, fade, from ?? fade, ms);
  const o = Math.round((opacity ?? 1) * shown * 1000) / 1000;
  const style = {
    zIndex: z + 100,
    mixBlendMode: blend && blend !== 'normal' ? blend : undefined,
    '--scn-travel': `${Math.round(8 + 22 * depth)}%`,
    '--scn-bloom-ms': b ? `${b.durationMs}ms` : undefined,
    '--scn-bloom-delay': b ? `${Math.min(order, 8) * b.staggerMs}ms` : undefined,
  } as CSSProperties;
  // The bloom animates the layer; its opacity (and the growth fade's transition) sit on the inner box, so neither cancels the other.
  const inner: CSSProperties = { opacity: o < 1 ? o : undefined, transition: ms > 0 ? `opacity ${ms}ms cubic-bezier(0.4, 0, 0.2, 1)` : undefined };
  return (
    <div className={['scn-layer', b && `scn-in-${b.kind}`].filter(Boolean).join(' ')} style={style}>
      <div ref={ref} className="scn-fade" style={inner}>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pack layers

function PackLayerView({ layer: l, idle, reduced, paused }: { layer: PackLayer; idle: PackBiome['idle']; reduced: boolean; paused: boolean }) {
  const amp = idle.kind !== 'none' && l.idle ? idle.amplitude * l.depth : 0;
  const fitStyle = fitCss(l);
  const style = {
    left: `${l.x * 100}%`,
    bottom: `${l.y * 100}%`,
    width: `${l.w * 100}%`,
    height: `${l.h * 100}%`,
    '--scn-amp': amp.toFixed(3),
    animationDuration: amp ? `${idle.periodMs}ms` : undefined,
  } as CSSProperties;
  return (
    <div className={['scn-box', amp > 0 && `scn-idle-${idle.kind}`].filter(Boolean).join(' ')} style={style}>
      {l.kind === 'image' ? (
        <img src={l.src} srcSet={l.src2x ? `${l.src} 1x, ${l.src2x} 2x` : undefined} alt="" decoding="async" draggable={false} style={fitStyle} />
      ) : l.kind === 'sprite' ? (
        reduced && l.poster ? (
          <img src={l.poster} alt="" decoding="async" draggable={false} style={fitStyle} />
        ) : (
          <Sprite layer={l} />
        )
      ) : reduced && l.poster ? (
        <img src={l.poster} alt="" decoding="async" draggable={false} style={fitStyle} />
      ) : (
        <Loop layer={l} reduced={reduced} paused={paused} />
      )}
    </div>
  );
}

/**
 * A sprite sheet stepped with two composited transforms: the inner strip
 * steps across a row (cols frames), the outer one down the rows. The frame
 * window keeps the frame's natural aspect and honours `fit` and `anchor`
 * (layout.ts `spriteFrameCss`, sized in the box's container-query units);
 * the sheet inside it is cols × rows windows, so stepping stays exact.
 */
function Sprite({ layer: l }: { layer: PackLayer }) {
  const [aspect, setAspect] = useState<number | null>(null);
  const img = useRef<HTMLImageElement>(null);
  const measure = () => {
    const el = img.current;
    if (el && el.naturalWidth) setAspect(frameAspect(el.naturalWidth, el.naturalHeight, l.cols, l.rows));
  };
  // A cached sheet may have loaded before React attached onLoad.
  useEffect(measure, [l.src, l.cols, l.rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const frameS = 1 / l.fps;
  // Until the sheet's size is known, a contain / cover window would be a guess: keep it hidden.
  const waiting = l.fit !== 'fill' && aspect === null;
  const style = {
    ...spriteFrameCss(aspect, l.fit, l.anchor),
    visibility: waiting ? 'hidden' : undefined,
    '--scn-cols': l.cols,
    '--scn-rows': l.rows,
    '--scn-row-s': `${l.cols * frameS}s`,
    '--scn-sheet-s': `${l.cols * l.rows * frameS}s`,
  } as CSSProperties;
  return (
    <div className="scn-sprite-box">
      <div className="scn-sprite" style={style}>
        <div className="scn-sprite-y" style={{ height: `${l.rows * 100}%` }}>
          <div className="scn-sprite-x" style={{ width: `${l.cols * 100}%`, height: `${100 / l.rows}%` }}>
            <img ref={img} src={l.src} alt="" decoding="async" draggable={false} style={{ height: `${l.rows * 100}%` }} onLoad={measure} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** object-fit / object-position for an image, poster or video. */
function fitCss(l: PackLayer): CSSProperties {
  return { objectFit: l.fit, objectPosition: l.anchor === 'center' ? undefined : objectPosition(l.anchor) };
}

function Loop({ layer: l, reduced, paused }: { layer: PackLayer; reduced: boolean; paused: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (reduced || paused) v.pause();
    else void v.play().catch(() => {});
  }, [reduced, paused]);
  return (
    <video ref={ref} muted loop playsInline autoPlay={!reduced} preload={reduced ? 'metadata' : 'auto'} poster={l.poster ?? undefined} style={fitCss(l)} disablePictureInPicture>
      <source src={l.src} type={/\.mp4$/i.test(l.src) ? 'video/mp4' : 'video/webm'} />
      {l.fallback && <source src={l.fallback} type="video/mp4" />}
    </video>
  );
}
