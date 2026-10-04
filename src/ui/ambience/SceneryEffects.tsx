/*
 * ForgeCoach — ui/ambience/SceneryEffects.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Drawing one-shot scenery effects (spec 1.2) inside a strip: a pack's sprite
 * sheet (played once) or clip (webm with alpha, mp4 fallback), a particle
 * preset, or with reduced motion a still glow or the effect's poster. Each
 * sits in a box at its anchor (`x` across the strip), `scale` of the strip's
 * height tall and `aspect` wide, and is removed by the queue when its time is
 * up (useScenery.ts). Decorative only: the strip is aria-hidden.
 */
import { memo, useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import type { EffectEvent, PackEffect } from '../../ambience/manifest.ts';
import { frameAspect, spriteFrameCss } from '../../ambience/layout.ts';
import { proceduralEffect } from './procedural.tsx';

/** One effect playing on a strip. */
export interface StripEffect {
  key: number;
  event: EffectEvent;
  source: 'pack' | 'builtin';
  effect: PackEffect;
  color: string;
  /** Centre of the box across the strip, 0..1. */
  x: number;
}

export const EffectView = memo(function EffectView({ fx, edge, rotated, reduced, paused }: { fx: StripEffect; edge: 'top' | 'bottom'; rotated: boolean; reduced: boolean; paused: boolean }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const e = fx.effect;
  // On the far strip drawn upright, art that points "up" (at the other side) is turned to point down.
  const mirror = e.mirror && edge === 'top' && !rotated;
  const style = {
    left: `${fx.x * 100}%`,
    '--fx-y': `${e.y * 100}%`,
    height: `${e.scale * 100}%`,
    aspectRatio: String(e.aspect),
    mixBlendMode: e.blend !== 'normal' ? e.blend : undefined,
    '--fx-color': fx.color,
    '--fx-ms': `${e.durationMs}ms`,
  } as CSSProperties;
  let body;
  if (reduced) {
    body = e.reduced === 'poster' && e.poster ? <img className="scn-fx-poster" src={e.poster} alt="" draggable={false} /> : <span className="scn-fx-glow" />;
  } else if (e.kind === 'particles' && e.preset) {
    body = proceduralEffect(e.preset, uid);
  } else if (e.kind === 'sprite') {
    body = <OneShotSprite effect={e} />;
  } else if (e.kind === 'video') {
    body = <OneShotClip effect={e} paused={paused} />;
  } else {
    body = <span className="scn-fx-glow" />;
  }
  return (
    <div className={['scn-fx', `scn-fx-${fx.event}`, e.preset && !reduced && `scn-fx-p-${e.preset}`, mirror && 'is-mirrored'].filter(Boolean).join(' ')} style={style} data-fx={fx.event} data-fx-source={fx.source}>
      <div className="scn-fx-inner">{body}</div>
    </div>
  );
});

/** A sprite sheet played once: rows × (cols steps), then held on nothing (the queue removes it). */
function OneShotSprite({ effect: e }: { effect: PackEffect }) {
  const [aspect, setAspect] = useState<number | null>(null);
  const img = useRef<HTMLImageElement>(null);
  const measure = () => {
    const el = img.current;
    if (el && el.naturalWidth) setAspect(frameAspect(el.naturalWidth, el.naturalHeight, e.cols, e.rows));
  };
  useEffect(measure, [e.src, e.cols, e.rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const frameS = 1 / e.fps;
  const style = {
    ...spriteFrameCss(aspect, 'contain', 'bottom'),
    visibility: aspect === null ? 'hidden' : undefined,
    '--scn-cols': e.cols,
    '--scn-rows': e.rows,
    '--scn-row-s': `${e.cols * frameS}s`,
    '--scn-sheet-s': `${e.cols * e.rows * frameS}s`,
  } as CSSProperties;
  return (
    <div className="scn-sprite-box">
      <div className="scn-sprite scn-sprite-once" style={style}>
        <div className="scn-sprite-y" style={{ height: `${e.rows * 100}%` }}>
          <div className="scn-sprite-x" style={{ width: `${e.cols * 100}%`, height: `${100 / e.rows}%` }}>
            <img ref={img} src={e.src!} srcSet={e.src2x ? `${e.src} 1x, ${e.src2x} 2x` : undefined} alt="" decoding="async" draggable={false} style={{ height: `${e.rows * 100}%` }} onLoad={measure} />
          </div>
        </div>
      </div>
    </div>
  );
}

function OneShotClip({ effect: e, paused }: { effect: PackEffect; paused: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (paused) v.pause();
    else void v.play().catch(() => {});
  }, [paused]);
  return (
    <video ref={ref} muted playsInline autoPlay preload="auto" poster={e.poster ?? undefined} disablePictureInPicture>
      <source src={e.src!} type={/\.mp4$/i.test(e.src!) ? 'video/mp4' : 'video/webm'} />
      {e.fallback && <source src={e.fallback} type="video/mp4" />}
    </video>
  );
}
