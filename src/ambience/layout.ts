/*
 * ForgeCoach — ambience/layout.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Where each slot sits in a strip and how wide it is. Pure.
 *
 * Order: by arrival (the first land's biome on the left), or — when the pack
 * asks for `strip.order: "preference"` — biomes that prefer the left first and
 * those that prefer the right last, arrival order within each group.
 * Width: a flex weight that grows a little with the stage (a richer scene
 * takes more room) times the pack's per-biome weight; since spec 1.6 it grows
 * with the progress between stages too, so every land widens it a little.
 *
 * Also the placement of a picture inside its layer box: the `anchor` as
 * fractions / CSS object-position, and a sprite frame's rectangle for each
 * `fit` (images get this from CSS object-fit; a sprite sheet cannot, so its
 * frame window is sized here with container-query units of the box).
 *
 * Spec 1.5, the half board: each player's whole half is shared between their
 * biomes in proportion to their lands (no live panel under `minShare`), and
 * each slot shows its art in a *frame* of the art's shape, cover-cropped to
 * the slot about a focal point while keeping a safe rect whole
 * ({@link halfFrame}, and {@link halfFrameCss}, its CSS twin in container
 * units, so the crop follows the slot's size with no script).
 */
import { growthLevel, type SlotState } from './model.ts';
import { BIOME_COLOUR, keptBiomes, pickFromSlots, type MakeupShowing } from './makeup.ts';
import { DEFAULT_HALF_LAYOUT, halfAt, type Anchor, type AreaRect, type Fit, type FocalPoint, type HalfPicture, type PackHalf, type ScenePack } from './manifest.ts';

export interface SlotLayout {
  slot: SlotState;
  /** Stage to draw (the override from the preview page, else the slot's own). */
  stage: number;
  /** Progress toward the next stage, 0..1 (model.ts `stageProgress`); 0 under the preview's stage override. */
  progress: number;
  grow: number;
}

export function slotLayout(slots: SlotState[], pack: ScenePack | null, stageOverride: number | null = null): SlotLayout[] {
  const rank = (s: SlotState) => {
    if (pack?.strip.order !== 'preference') return 0;
    const pref = pack.biomes[s.biome]?.slot.prefer ?? 'any';
    return pref === 'left' ? 0 : pref === 'right' ? 2 : 1;
  };
  const ordered = [...slots].sort((a, b) => rank(a) - rank(b) || a.index - b.index);
  return ordered.map((slot) => {
    const override = stageOverride !== null && slot.stage > 0;
    const stage = override ? stageOverride : slot.stage;
    const progress = override || stage <= 0 ? 0 : Math.min(1, Math.max(0, slot.progress ?? 0));
    const weight = pack?.biomes[slot.biome]?.slot.weight ?? 1;
    // A withered slot (its lands gone) keeps a sliver of room; a live one widens with every land (stage plus progress, spec 1.6).
    const grow = (stage > 0 ? 1 + 0.18 * (growthLevel({ stage, progress }) - 1) : 0.45) * weight;
    return { slot, stage, progress, grow: Math.round(grow * 100) / 100 };
  });
}

/** An anchor as fractions of the free space: x 0 = left … 1 = right, y 0 = top … 1 = bottom. */
export function anchorFractions(anchor: Anchor): { x: number; y: number } {
  const parts = anchor.split('-');
  const x = parts.includes('left') ? 0 : parts.includes('right') ? 1 : 0.5;
  const y = parts.includes('top') ? 0 : parts.includes('bottom') ? 1 : 0.5;
  return { x, y };
}

/** CSS `object-position` / `background-position` for an anchor, e.g. `50% 100%` for `bottom`. */
export function objectPosition(anchor: Anchor): string {
  const { x, y } = anchorFractions(anchor);
  return `${x * 100}% ${y * 100}%`;
}

/** One sprite frame's aspect (width / height) from the sheet's natural size, or null when unknown. */
export function frameAspect(sheetW: number, sheetH: number, cols: number, rows: number): number | null {
  if (!(sheetW > 0 && sheetH > 0 && cols > 0 && rows > 0)) return null;
  const a = sheetW / cols / (sheetH / rows);
  return Number.isFinite(a) && a > 0 ? a : null;
}

/** A frame window in the layer box, as fractions of the box's width and height (left/top from the box's top-left). */
export interface FrameRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Where a picture of `aspect` (w / h) sits in a box of `boxAspect` for a fit and
 * anchor, as fractions of the box (may exceed 0..1 with `cover`). The same math
 * as CSS object-fit / object-position; {@link spriteFrameCss} is its CSS form.
 */
export function fitRect(boxAspect: number, aspect: number | null, fit: Fit, anchor: Anchor): FrameRect {
  if (fit === 'fill' || !aspect || !(boxAspect > 0)) return { left: 0, top: 0, width: 1, height: 1 };
  // Width as a fraction of the box's width when the picture's height fills the box.
  const widthAtFullHeight = aspect / boxAspect;
  const fullHeight = fit === 'contain' ? widthAtFullHeight <= 1 : widthAtFullHeight >= 1;
  const width = fullHeight ? widthAtFullHeight : 1;
  const height = fullHeight ? 1 : boxAspect / aspect;
  const { x, y } = anchorFractions(anchor);
  return { left: (1 - width) * x || 0, top: (1 - height) * y || 0, width, height };
}

/**
 * The CSS for a sprite's frame window inside its box (the box must be a size
 * container: `cqw` / `cqh` are its width and height). With no aspect yet (the
 * sheet has not loaded) or `fill`, the window is the whole box.
 */
export function spriteFrameCss(aspect: number | null, fit: Fit, anchor: Anchor): { left: string; top: string; width: string; height: string } {
  if (fit === 'fill' || !aspect) return { left: '0', top: '0', width: '100%', height: '100%' };
  const a = Math.round(aspect * 10000) / 10000;
  const pick = fit === 'contain' ? 'min' : 'max';
  const width = `${pick}(100cqw, ${a} * 100cqh)`;
  const height = `calc(${width} / ${a})`;
  const { x, y } = anchorFractions(anchor);
  return { left: `calc((100cqw - ${width}) * ${x})`, top: `calc((100cqh - ${height}) * ${y})`, width, height };
}

/**
 * The centre of a biome's slot across the strip, 0..1 (slots share the width
 * by their `grow`), or null when the strip has no such slot.
 */
export function slotCentre(slots: SlotState[], pack: ScenePack | null, biome: string | null, stageOverride: number | null = null): number | null {
  if (!biome) return null;
  const layout = slotLayout(slots, pack, stageOverride);
  const total = layout.reduce((n, l) => n + l.grow, 0);
  if (!(total > 0)) return null;
  let left = 0;
  for (const l of layout) {
    if (l.slot.biome === biome) return (left + l.grow / 2) / total;
    left += l.grow;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The half board (spec 1.5)

/** A slot on the half board: its share of the half's width (the shares sum to 1). */
export interface HalfSlotLayout extends SlotLayout {
  share: number;
}

/**
 * How a player's half is split between their biomes: in proportion to their
 * land weight (5 Islands : 1 Mountain is 5 : 1), every live biome at least
 * `minShare` of the width, a withered one (its lands gone) half that. Same
 * order as the strip ({@link slotLayout}); each slot keeps its own stage.
 * Four or five colours keep three panels ({@link foldPanels}); `showing` is
 * what was on screen before (makeup.ts), for its tie rule.
 */
export function halfLayout(slots: SlotState[], pack: ScenePack | null, stageOverride: number | null = null, showing: MakeupShowing | null = null): HalfSlotLayout[] {
  const layout = foldPanels(slotLayout(slots, pack, stageOverride), showing);
  if (!layout.length) return [];
  const min = (pack?.half ?? DEFAULT_HALF_LAYOUT).minShare;
  const floor = layout.map((l) => (l.stage > 0 && l.slot.weight > 0 ? min : min / 2));
  const raw = layout.map((l) => (l.stage > 0 ? Math.max(0, l.slot.weight) : 0));
  // Water-filling: a slot under its floor is pinned there, the rest share what is left by weight.
  const pinned = layout.map(() => false);
  let shares = layout.map(() => 1 / layout.length);
  for (let pass = 0; pass <= layout.length; pass++) {
    const left = 1 - floor.reduce((n, f, i) => n + (pinned[i] ? f : 0), 0);
    const total = raw.reduce((n, r, i) => n + (pinned[i] ? 0 : r), 0);
    const free = pinned.filter((p) => !p).length;
    shares = layout.map((_, i) => (pinned[i] ? floor[i]! : total > 0 ? (left * raw[i]!) / total : left / free));
    const under = shares.findIndex((v, i) => !pinned[i] && v < floor[i]! - 1e-9);
    if (under < 0) break;
    // Pin every slot under its floor at once.
    shares.forEach((v, i) => {
      if (!pinned[i] && v < floor[i]! - 1e-9) pinned[i] = true;
    });
  }
  return layout.map((l, i) => ({ ...l, grow: Math.round(shares[i]! * 1000) / 1000, share: Math.round(shares[i]! * 1000) / 1000 }));
}

/** Spec 1.10: the most panels a half shows. */
export const MAX_HALF_PANELS = 3;

/**
 * Spec 1.10 as SYSTEM.md A6 has it (spec 1.16's correction): a half shows at
 * most {@link MAX_HALF_PANELS} biomes -- the colours makeup.ts `pickMakeup`
 * keeps (the three heaviest by their own land weight; a tie: a colour already
 * `showing`, then the earlier arrival), then a live biome with no colour,
 * then withered ones if there is room. A biome left out shows nothing and
 * weighs nothing: its land weight is NOT added to a kept panel (until 1.16 it
 * folded into the nearest one, which panned the pair picture by a colour not
 * on screen, review fault 1). Each kept panel keeps its own stage and weight.
 * Order is the row's. A fourth and fifth colour on one side made seven
 * panels and bands in a half (four biomes, three bands, six seams), none
 * wide enough to read.
 */
export function foldPanels<T extends SlotLayout>(layout: T[], showing: MakeupShowing | null = null): T[] {
  if (layout.length <= MAX_HALF_PANELS) return layout;
  const live = (l: SlotLayout) => l.stage > 0 && l.slot.weight > 0;
  const kept = keptBiomes(pickFromSlots(layout.filter(live).map((l) => l.slot), showing));
  const rank = (l: SlotLayout) => (kept.has(l.slot.biome) ? 0 : live(l) && !BIOME_COLOUR[l.slot.biome] ? 1 : live(l) ? 3 : 2);
  const order = layout.map((l, i) => ({ l, i })).sort((a, b) => rank(a.l) - rank(b.l) || b.l.slot.weight - a.l.slot.weight || a.l.slot.index - b.l.slot.index);
  // A dropped colour (rank 3) is never kept, even with room: it shows nothing.
  const keep = new Set(order.filter((x) => rank(x.l) < 3).slice(0, MAX_HALF_PANELS).map((x) => x.i));
  return layout.filter((_, i) => keep.has(i));
}

/** The art frame a slot shows on the half: the art's shape (width / height), its focal point and safe rect. */
export interface HalfArt {
  aspect: number;
  focal: FocalPoint;
  safe: AreaRect | null;
  /** `half` / `phone`: a spec 1.5 half picture (desktop or phone shape); `strip`: an older pack's (or the built-in) strip art, cover-cropped. */
  source: 'half' | 'phone' | 'strip';
  /** The picture to draw (null for strip art: the stage's layers). */
  picture?: HalfPicture | null;
  /**
   * Spec 1.13, one horizon: where in the panel's height the focal point's y
   * lands (0 top, 1 bottom; default 0.5, centred). With the horizon as the
   * focal y and {@link HORIZON_AT} here, every panel puts its horizon at the
   * same height whatever its width -- within what the crop allows.
   */
  focalTo?: number;
}

/** Where the spec puts a desktop half picture's horizon (§5: about 57% up), as a fraction from the top. */
export const DESKTOP_HORIZON = 0.43;
/** One horizon (spec 1.13): every panel puts its picture's horizon this far down. */
export const HORIZON_AT = DESKTOP_HORIZON;

/**
 * A picture's horizon, as a fraction of its height from the top. Packs do not
 * declare one, so it is read from the subject band: the default band [0.35,
 * 0.60] holds the spec's horizon (0.43) 32% of the way down, and a picture's
 * own band holds its horizon at the same place -- for a phone picture with the
 * default band mapped in ([0.425, 0.55]) that is 0.465, the desktop horizon
 * mapped the same way. A pack may declare a picture's `horizon` (spec 1.13),
 * which then wins: the estimate is only as good as the band.
 */
export function horizonOf(p: Pick<HalfPicture, 'subjectBand' | 'horizon'>): number {
  if (p.horizon !== undefined) return p.horizon;
  const [a, b] = p.subjectBand;
  return Math.round((a + ((DESKTOP_HORIZON - 0.35) / 0.25) * (b - a)) * 10000) / 10000;
}

/** Strip art (older packs, the built-in scenery) is 4:1 (the spec's 2048 × 512 backdrops), its horizon ~57% up: anchored there. */
export const STRIP_ART: HalfArt = { aspect: 4, focal: { x: 0.5, y: 0.43 }, safe: null, source: 'strip', picture: null };

/** A screen this wide (CSS px) or narrower is a phone: its halves take the phone pictures (see {@link pickHalfPicture}). */
export const PHONE_VIEWPORT_MAX = 600;

const shape = (p: HalfPicture) => Math.round((p.width / p.height) * 10000) / 10000;

/**
 * Which picture of a stage's `half` a panel of `panelAspect` (width / height)
 * shows: the phone picture when the panel's shape is nearer the phone's than
 * the desktop's (on a log scale: 1:1 is as far from 4:1 as from 1:4), else
 * the desktop picture. Unknown shape: the desktop picture.
 *
 * On a phone-width screen (`narrow`, {@link PHONE_VIEWPORT_MAX}) the phone
 * picture whatever the panel's shape: a phone's half of the board measures
 * about 2.1 : 1 (376 × 176 at 390 × 844), nearer the desktop's 16:5 than the
 * phone's 4:5, so the shape rule alone never showed the phone art on a phone.
 * The phone picture is outpainted into sky and calm ground around its subject
 * band precisely so that a wide crop of its middle still reads.
 */
export function pickHalfPicture(h: PackHalf, panelAspect: number | null, opts?: { narrow?: boolean }): { picture: HalfPicture; phone: boolean } {
  if (h.phone && opts?.narrow === true) return { picture: h.phone, phone: true };
  if (!h.phone || !(panelAspect !== null && panelAspect > 0)) return { picture: h, phone: false };
  const d = (p: HalfPicture) => Math.abs(Math.log(panelAspect / shape(p)));
  return d(h.phone) < d(h) ? { picture: h.phone, phone: true } : { picture: h, phone: false };
}

/** The frame for a picture of a stage's `half`, or the strip art's. */
export function halfArtOf(h: PackHalf | null, panelAspect: number | null = null, opts?: { narrow?: boolean; horizon?: boolean }): HalfArt {
  if (!h) return opts?.horizon ? { ...STRIP_ART, focalTo: HORIZON_AT } : STRIP_ART;
  const { picture, phone } = pickHalfPicture(h, panelAspect, opts);
  const art: HalfArt = { aspect: shape(picture), focal: picture.focal, safe: picture.safe, source: phone ? 'phone' : 'half', picture };
  // Spec 1.13, one horizon: the crop pins the picture's horizon at HORIZON_AT down every panel.
  return opts?.horizon ? { ...art, focal: { x: picture.focal.x, y: horizonOf(picture) }, focalTo: HORIZON_AT } : art;
}

/** The frame for a biome at a stage in a panel of `panelAspect`: its half picture when the pack has one (spec 1.5), else the strip art. */
export function halfArt(pack: ScenePack | null, biome: SlotState['biome'], stage: number, panelAspect: number | null = null): HalfArt {
  return halfArtOf(halfAt(pack?.biomes[biome], Math.max(1, stage)), panelAspect);
}

/**
 * One axis of a cover crop: how far (in the drawn picture's units) the view
 * starts into it. The focal point as near the view's middle as the picture
 * allows; the safe span kept whole when it fits, else centred. `to`: where
 * in the view the focal point goes (0.5, the middle, unless spec 1.13's one
 * horizon says otherwise).
 */
export function cropAxis(shown: number, drawn: number, focal: number, safeStart: number | null, safeSize: number | null, to = 0.5): number {
  const over = Math.max(0, drawn - shown);
  const val = focal * drawn - to * shown;
  let lo = 0;
  let hi = over;
  if (safeStart !== null && safeSize !== null) {
    lo = Math.min(over, Math.max(0, (safeStart + safeSize) * drawn - shown));
    hi = Math.min(over, safeStart * drawn);
  }
  const mid = (lo + hi) / 2;
  return Math.max(Math.min(lo, mid), Math.min(val, Math.max(hi, mid)));
}

/**
 * Where an art frame of `art.aspect` sits in a slot of `box` px, cover-cropped
 * (fractions of the box, as {@link fitRect}; left / top ≤ 0). The same math as
 * {@link halfFrameCss}.
 */
export function halfFrame(box: { w: number; h: number }, art: Pick<HalfArt, 'aspect' | 'focal' | 'safe' | 'focalTo'>): FrameRect {
  if (!(box.w > 0 && box.h > 0 && art.aspect > 0)) return { left: 0, top: 0, width: 1, height: 1 };
  const dw = Math.max(box.w, box.h * art.aspect);
  const dh = dw / art.aspect;
  const s = art.safe;
  const ox = cropAxis(box.w, dw, art.focal.x, s ? s.x : null, s ? s.w : null);
  const oy = cropAxis(box.h, dh, art.focal.y, s ? s.y : null, s ? s.h : null, art.focalTo ?? 0.5);
  const r = (n: number) => Math.round(n * 10000) / 10000;
  return { left: r(-ox / box.w) || 0, top: r(-oy / box.h) || 0, width: r(dw / box.w), height: r(dh / box.h) };
}

const cssNum = (n: number) => String(Math.round(n * 10000) / 10000);

/** {@link cropAxis} as a CSS length expression (`shown` and `drawn` CSS lengths), for the CSS twins of the crops. */
export function cropAxisCss(shown: string, drawn: string, focal: number, start: number | null, size: number | null, to = 0.5): string {
  const f = cssNum;
  const over = `(${drawn} - ${shown})`;
  const val = to === 0.5 ? `(${f(focal)} * ${drawn} - ${shown} / 2)` : `(${f(focal)} * ${drawn} - ${f(to)} * ${shown})`;
  if (start === null || size === null) return `clamp(0px, ${val}, ${over})`;
  const lo = `min(${over}, max(0px, ${f(start + size)} * ${drawn} - ${shown}))`;
  const hi = `min(${over}, ${f(start)} * ${drawn})`;
  const mid = `((${lo} + ${hi}) / 2)`;
  return `clamp(min(${lo}, ${mid}), ${val}, max(${hi}, ${mid}))`;
}

/**
 * {@link halfFrame} as CSS for an element inside a size container (the slot):
 * `cqw` / `cqh` are the slot's width and height, so the crop follows the slot
 * as it grows with no script. CSS `clamp(lo, v, hi)` is `max(lo, min(v, hi))`,
 * the same as cropAxis with its bounds pre-ordered.
 */
export function halfFrameCss(art: Pick<HalfArt, 'aspect' | 'focal' | 'safe' | 'focalTo'>): { left: string; top: string; width: string; height: string } {
  const a = cssNum(art.aspect);
  const dw = `max(100cqw, ${a} * 100cqh)`;
  const dh = `(${dw} / ${a})`;
  const axis = cropAxisCss;
  const s = art.safe;
  return {
    left: `calc(-1 * ${axis('100cqw', dw, art.focal.x, s ? s.x : null, s ? s.w : null)})`,
    top: `calc(-1 * ${axis('100cqh', dh, art.focal.y, s ? s.y : null, s ? s.h : null, art.focalTo ?? 0.5)})`,
    width: dw,
    height: `calc(${dh})`,
  };
}

/**
 * Each slot's pixel span across a half `width` px wide: shares of the width plus the seams they overlap (as the flex row lays them out).
 * `seamRatio` is one seam for every neighbour, or (spec 1.8, a pair's duals widen its own seam) a list: the seam left of each slot, the first unused.
 */
export function halfSpans(layout: HalfSlotLayout[], width: number, seamRatio: number | readonly number[] = DEFAULT_HALF_LAYOUT.seamRatio): { left: number; width: number }[] {
  const seamAt = (i: number) => (i === 0 || layout.length < 2 ? 0 : (typeof seamRatio === 'number' ? seamRatio : (seamRatio[i] ?? DEFAULT_HALF_LAYOUT.seamRatio)) * width);
  const total = width + layout.reduce((n, _, i) => n + seamAt(i), 0);
  const sum = layout.reduce((n, l) => n + l.share, 0) || 1;
  let x = 0;
  return layout.map((l, i) => {
    const w = (l.share / sum) * total;
    const left = i === 0 ? 0 : x - seamAt(i);
    x = left + w;
    return { left: Math.round(left * 10) / 10, width: Math.round(w * 10) / 10 };
  });
}
