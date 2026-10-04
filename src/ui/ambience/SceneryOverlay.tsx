/*
 * ForgeCoach — ui/ambience/SceneryOverlay.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Board accents (spec 1.3): corner and edge pieces in one player's area,
 * outside the strip, like a board frame that grows with their mana. Which
 * pieces, where, mirrored and fitted, is ambience/overlay.ts; this draws them.
 *
 * Never over the game: the layer sits in the host's isolated stacking context
 * at z-index -1 (with the strip), so every card, label, count and control in
 * the area paints above it, and it never takes pointer events. It is
 * aria-hidden, contained, and measures its own width to fit (corners only,
 * smaller and still, under 600 px; nothing under 300 px). Motion is CSS
 * (transform / opacity) on still pictures, none with reduced motion, paused
 * with the tab hidden.
 */
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { SlotState } from '../../ambience/model.ts';
import { isOverlayCorner, type OverlayAnchor, type ScenePack } from '../../ambience/manifest.ts';
import { overlayPieces, type PlacedOverlay } from '../../ambience/overlay.ts';
import { builtinOverlaySrc } from './overlayArt.ts';
import { usePageVisible } from './SceneryStrip.tsx';
import './scenery.css';

export interface SceneryOverlayProps {
  slots: SlotState[];
  pack: ScenePack | null;
  /** The side: `bottom` is the viewer's area, `top` the opponent's (pieces mirror there). */
  edge: 'top' | 'bottom';
  reduced: boolean;
  stageOverride?: number | null;
  /** Force a width (tests, the preview); else the layer measures itself. */
  widthPx?: number | null;
}

export const SceneryOverlay = memo(function SceneryOverlay({ slots, pack, edge, reduced, stageOverride = null, widthPx }: SceneryOverlayProps) {
  const root = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<number | null>(null);
  const visible = usePageVisible();
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    setMeasured(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => setMeasured(entries[0]?.contentRect.width ?? el.getBoundingClientRect().width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Pieces that arrive after the first paint fade in; the first set is simply there.
  const settled = useRef(false);
  useEffect(() => {
    const t = requestAnimationFrame(() => requestAnimationFrame(() => (settled.current = true)));
    return () => cancelAnimationFrame(t);
  }, []);
  const width = widthPx ?? measured;
  const pieces = useMemo(() => (width === null ? [] : overlayPieces(slots, pack, { side: edge, widthPx: width, reduced, stageOverride })), [slots, pack, edge, width, reduced, stageOverride]);
  return (
    <div ref={root} className={['scn-ovl', `scn-ovl-${edge}`, reduced && 'is-reduced', !visible && 'is-paused'].filter(Boolean).join(' ')} aria-hidden="true" data-accents={pieces.length}>
      {pieces.map((p) => (
        <Piece key={p.key} p={p} bloom={settled.current && !reduced} />
      ))}
    </div>
  );
});

/** The anchor as drawn inside the (possibly flipped) box: built-in corners are drawn for the left, so right corners flip them across. */
function localAnchor(p: PlacedOverlay): { anchor: OverlayAnchor; flipX: boolean } {
  const a = p.piece.anchor;
  if (p.piece.builtin && isOverlayCorner(a) && a.endsWith('right')) return { anchor: a.replace('right', 'left') as OverlayAnchor, flipX: true };
  return { anchor: a, flipX: false };
}

const POS: Record<OverlayAnchor, string> = {
  'top-left': 'left top',
  'top-right': 'right top',
  'bottom-left': 'left bottom',
  'bottom-right': 'right bottom',
  'top-edge': 'center top',
  'bottom-edge': 'center bottom',
  'left-edge': 'left center',
  'right-edge': 'right center',
};

function Piece({ p, bloom }: { p: PlacedOverlay; bloom: boolean }) {
  const [blooms] = useState(bloom);
  const [failed, setFailed] = useState(false);
  const corner = isOverlayCorner(p.anchor);
  const { anchor: local, flipX } = localAnchor(p);
  const piece = p.piece;
  const src = piece.src ?? (piece.builtin ? builtinOverlaySrc(piece.builtin, corner) : null);
  if (!src || failed) return null;
  const size = `min(${+(piece.size * 100).toFixed(2)}cqw, ${p.maxPx}px)`;
  const transform = [flipX && 'scaleX(-1)', p.flipY && 'scaleY(-1)'].filter(Boolean).join(' ') || undefined;
  const style: CSSProperties = {
    opacity: piece.opacity < 1 ? piece.opacity : undefined,
    mixBlendMode: piece.blend !== 'normal' ? piece.blend : undefined,
    transform,
  };
  if (corner) {
    style.width = size;
    style.height = `min(${+(piece.size * 100).toFixed(2)}cqw, ${p.maxPx}px, 60cqh)`;
  } else if (p.anchor === 'top-edge' || p.anchor === 'bottom-edge') {
    style.height = `min(${+(piece.size * 100).toFixed(2)}cqw, ${p.maxPx}px, 18cqh)`;
  } else {
    style.width = `min(${+(piece.size * 100).toFixed(2)}cqw, ${p.maxPx}px, 12cqw)`;
  }
  const innerStyle = { animationDuration: p.animate ? `${piece.periodMs}ms` : undefined, transformOrigin: POS[local] } as CSSProperties;
  const cls = ['scn-ovl-piece', `scn-ovl-at-${p.anchor}`, blooms && 'scn-ovl-in'].filter(Boolean).join(' ');
  const inner = ['scn-ovl-inner', p.animate && `scn-ovl-${piece.motion}`].filter(Boolean).join(' ');
  if (corner) {
    return (
      <div className={cls} style={style} data-accent={p.key}>
        <div className={inner} style={innerStyle}>
          <img src={src} srcSet={piece.src && piece.src2x ? `${piece.src} 1x, ${piece.src2x} 2x` : undefined} alt="" decoding="async" draggable={false} style={{ objectPosition: POS[local] }} onError={() => setFailed(true)} />
        </div>
      </div>
    );
  }
  // Edges: a background band along the edge, repeated (seamless art) or stretched.
  const side = p.anchor === 'left-edge' || p.anchor === 'right-edge';
  const bg = piece.src && piece.src2x ? `image-set(url("${piece.src}") 1x, url("${piece.src2x}") 2x)` : `url("${src.replace(/"/g, '%22')}")`;
  const tile = piece.tile === 'repeat';
  const innerBg: CSSProperties = {
    ...innerStyle,
    backgroundImage: bg,
    backgroundRepeat: tile ? (side ? 'repeat-y' : 'repeat-x') : 'no-repeat',
    backgroundSize: tile ? (side ? '100% auto' : 'auto 100%') : '100% 100%',
    backgroundPosition: POS[local],
  };
  return (
    <div className={cls} style={style} data-accent={p.key}>
      <div className={inner} style={innerBg} />
    </div>
  );
}
