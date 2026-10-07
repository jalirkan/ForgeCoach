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
 * `fill="half"` (spec 1.5, Settings → Fill each side): the same slots fill
 * the player's whole half of the board instead of a strip, split by land
 * count (layout.ts `halfLayout`), each slot's art in a frame of the art's
 * shape, cover-cropped about its focal point (`halfFrameCss`): the pack's
 * half picture when it has one, else the strip art (older packs, the
 * built-in scenery). Both halves upright; each fades into a mist band along
 * the centre line. The effects keep their strip-sized box at the outer edge.
 */
import { createContext, memo, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Biome, SlotState } from '../../ambience/model.ts';
import { DEFAULT_HALF_LAYOUT, DEFAULT_STRIP, halfAt, layersAt, type PackBiome, type PackHalf, type PackLayer, type PackStrip, type ScenePack } from '../../ambience/manifest.ts';
import { frameAspect, halfArtOf, halfFrameCss, halfLayout, objectPosition, slotLayout, spriteFrameCss, STRIP_ART, type HalfArt } from '../../ambience/layout.ts';
import { proceduralLayers, type DrawLayer } from './procedural.tsx';
import { EffectView, type StripEffect } from './SceneryEffects.tsx';
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
  className?: string;
  style?: CSSProperties;
}

/** Has the strip painted once? Layers mounted after that bloom in. */
const Settled = createContext<{ current: boolean }>({ current: true });

export function usePageVisible(): boolean {
  const [v, setV] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  useEffect(() => {
    const on = () => setV(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return v;
}

export const SceneryStrip = memo(function SceneryStrip({ slots, pack, edge = 'bottom', orient = 'upright', reduced, pulses, fx, stageOverride = null, fill = 'strip', className, style }: SceneryStripProps) {
  const visible = usePageVisible();
  const settled = useRef(false);
  useEffect(() => {
    const t = requestAnimationFrame(() => requestAnimationFrame(() => (settled.current = true)));
    return () => cancelAnimationFrame(t);
  }, []);
  const strip: PackStrip = pack?.strip ?? DEFAULT_STRIP;
  const half = fill === 'half';
  const layout = useMemo(() => (half ? halfLayout(slots, pack, stageOverride) : slotLayout(slots, pack, stageOverride)), [half, slots, pack, stageOverride]);
  if (layout.length === 0 && !fx?.length) return null;
  const rotated = edge === 'top' && orient === 'rotated';
  const halfCfg = pack?.half ?? DEFAULT_HALF_LAYOUT;
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
          className={['scn', `scn-${edge}`, half && 'scn-half', half && `scn-fade-${fadeAt}`, rotated && 'scn-rotated', edge === 'top' && !rotated && !half && 'scn-upright', reduced && 'is-reduced', !visible && 'is-paused', className].filter(Boolean).join(' ')}
          style={half ? halfVars : vars}
          aria-hidden="true"
          data-fill={fill}
        >
          <Settled.Provider value={settled}>
            <div className="scn-row">
              {layout.map(({ slot, stage, grow }, i) => (
                <Slot key={slot.biome} slot={slot} stage={stage} grow={grow} first={i === 0} pack={pack?.biomes[slot.biome]} reduced={reduced} paused={!visible} pulse={pulses?.[slot.biome] ?? 0} half={half} />
              ))}
            </div>
            {half && <div className="scn-mist" />}
          </Settled.Provider>
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

function Slot({ slot, stage, grow, first, pack, reduced, paused, pulse, half = false }: { slot: SlotState; stage: number; grow: number; first: boolean; pack: PackBiome | undefined; reduced: boolean; paused: boolean; pulse: number; half?: boolean }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const settled = useContext(Settled);
  const withered = stage <= 0;
  const drawn = Math.max(1, stage);
  // The half (spec 1.5): the stage's half picture (the phone one in a portrait-ish panel), unless it failed to load (then the strip art, cropped).
  const [failedHalf, setFailedHalf] = useState<string | null>(null);
  const picture: PackHalf | null = half ? halfAt(pack, drawn) : null;
  const ref = useRef<HTMLDivElement>(null);
  const panelAspect = usePanelAspect(ref, !!picture?.phone);
  const chosen = half ? halfArtOf(picture, panelAspect) : null;
  const art: HalfArt | null = !chosen ? null : chosen.picture && failedHalf === chosen.picture.src ? STRIP_ART : chosen;
  const pic = art?.picture ?? null;
  const layers: { id: string; z: number; depth: number; blend?: string; opacity?: number; node: ReactNode }[] = useMemo(() => {
    if (pack) {
      // With a half picture, the stage's still layers give way to it; its loops and sprites play over the desktop picture (none over the phone one: they are cut for the desktop's shape).
      const own = layersAt(pack, drawn).filter((l) => !pic || (l.kind !== 'image' && art?.source !== 'phone'));
      const list: { id: string; z: number; depth: number; blend?: string; opacity?: number; node: ReactNode }[] = own.map((l) => ({ id: l.id, z: l.z, depth: l.depth, blend: l.blend, opacity: l.opacity, node: <PackLayerView layer={l} idle={pack.idle} reduced={reduced} paused={paused} /> }));
      if (pic) {
        const src = pic.src;
        list.unshift({ id: 'half', z: -100, depth: 0, blend: 'normal', opacity: 1, node: <img className="scn-half-img" src={src} srcSet={pic.src2x ? `${src} 1x, ${pic.src2x} 2x` : undefined} alt="" decoding="async" draggable={false} onError={() => setFailedHalf(src)} /> });
      }
      return list;
    }
    return proceduralLayers(slot.biome, drawn, uid).map((l: DrawLayer) => ({ ...l }));
  }, [pack, drawn, slot.biome, uid, reduced, paused, pic, art?.source]);
  const bloom = pack?.bloom ?? PROCEDURAL_BLOOM;
  const sorted = [...layers].sort((a, b) => a.z - b.z);
  const stack = sorted.map((l, i) => (
    <Layer key={l.id} z={l.z} depth={l.depth} blend={l.blend} opacity={l.opacity} bloom={bloom} order={i} reduced={reduced}>
      {l.node}
    </Layer>
  ));
  return (
    <div ref={ref} className={['scn-slot', first && 'is-first', withered && 'is-withered'].filter(Boolean).join(' ')} style={{ flexGrow: grow }} data-biome={slot.biome} data-stage={stage} data-art={art?.source}>
      {art ? (
        <div className="scn-frame" style={halfFrameCss(art)}>
          {stack}
        </div>
      ) : (
        stack
      )}
      {pulse > 0 && settled.current && !reduced && <span key={pulse} className="scn-flash" />}
    </div>
  );
}

function Layer({ z, depth, blend, opacity, bloom, order, reduced, children }: { z: number; depth: number; blend?: string; opacity?: number; bloom: { kind: string; durationMs: number; staggerMs: number }; order: number; reduced: boolean; children: ReactNode }) {
  const settled = useContext(Settled);
  // Decided once, at mount: only layers that arrive after the first paint bloom.
  const [blooms] = useState(() => settled.current && !reduced && bloom.kind !== 'none' && bloom.durationMs > 0);
  const style = {
    zIndex: z + 100,
    mixBlendMode: blend && blend !== 'normal' ? blend : undefined,
    opacity: opacity !== undefined && opacity < 1 ? opacity : undefined,
    '--scn-travel': `${Math.round(8 + 22 * depth)}%`,
    '--scn-bloom-ms': `${bloom.durationMs}ms`,
    '--scn-bloom-delay': `${Math.min(order, 8) * bloom.staggerMs}ms`,
  } as CSSProperties;
  return (
    <div className={['scn-layer', blooms && `scn-in-${bloom.kind}`].filter(Boolean).join(' ')} style={style}>
      {children}
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
