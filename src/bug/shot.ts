/*
 * ForgeCoach — bug/shot.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A screenshot for a bug report (mtg-table D411), two ways:
 *
 *   1. THE PAGE DRAWS ITSELF (`captureScreen`): html-to-image (MIT, lazy-loaded)
 *      clones the visible DOM with its computed styles into an SVG
 *      <foreignObject>, draws that on a canvas, and the canvas becomes a JPEG.
 *      No permission prompt, works offline, about 1–3 s. Measured on the replay
 *      and the play board in Chromium: close to what is on screen. Its limits:
 *        - an inner scrolled list is drawn scrolled to its top;
 *        - a <canvas> or <video> (none on the board) and a cross-origin image
 *          with no CORS header come out blank (card art is from Scryfall, which
 *          sends `Access-Control-Allow-Origin: *`, so it is drawn when the
 *          browser has it; offline and not cached, a card shows its frame);
 *        - Safari draws <foreignObject> less faithfully, and may leave images
 *          out the first time.
 *      The bug panel itself is left out of the picture.
 *   2. THE PLAYER'S OWN (`imageToShot`): a picture pasted (Ctrl+V after the
 *      system's screenshot key) or chosen from a file. It always works, and
 *      shows exactly what the player saw.
 *
 *   Not used: `getDisplayMedia` (screen sharing) asks for permission every
 *   time, needs a picker click, and does not exist on phones.
 *
 * Both give a JPEG at most SHOT_MAX_W wide (re-encoded smaller until it fits
 * the report's cap) and a thumbnail at most THUMB_MAX_W wide, which is what
 * tools/bugs-sync.mjs pushes to pc-results.
 */
import { MAX_SHOT_BASE64, MAX_THUMB_BASE64, type ShotImage } from './report.ts';

export const SHOT_MAX_W = 1600;
export const THUMB_MAX_W = 640;

export interface Shot {
  shot: ShotImage;
  thumb: Omit<ShotImage, 'how'>;
}

/** A canvas as a JPEG (base64, no data: prefix), scaled to at most `maxW` wide, shrunk until it fits `maxB64`. */
function toJpeg(src: CanvasImageSource & { width: number; height: number }, maxW: number, maxB64: number, quality: number): { data: string; width: number; height: number } | null {
  let scale = Math.min(1, maxW / src.width);
  let q = quality;
  for (let attempt = 0; attempt < 6; attempt++) {
    const w = Math.max(1, Math.round(src.width * scale));
    const h = Math.max(1, Math.round(src.height * scale));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    if (!g) return null;
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    g.drawImage(src, 0, 0, w, h);
    const url = c.toDataURL('image/jpeg', q);
    const data = url.slice(url.indexOf(',') + 1);
    if (url.startsWith('data:image/jpeg') && data.length <= maxB64) return { data, width: w, height: h };
    if (q > 0.55) q -= 0.15;
    else scale *= 0.75;
  }
  return null;
}

function both(canvas: HTMLCanvasElement | ImageBitmap, how: ShotImage['how']): Shot | null {
  const full = toJpeg(canvas, SHOT_MAX_W, MAX_SHOT_BASE64, 0.82);
  const small = toJpeg(canvas, THUMB_MAX_W, MAX_THUMB_BASE64, 0.7);
  if (!full || !small) return null;
  return { shot: { mediaType: 'image/jpeg', ...full, how }, thumb: { mediaType: 'image/jpeg', ...small } };
}

/** A 1x1 transparent GIF: what an image that cannot be drawn becomes. */
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/**
 * The visible page as a picture, leaving out every element `skip` names (the
 * bug panel). Throws when the browser cannot do it.
 */
export async function captureScreen(skip: (el: Element) => boolean): Promise<Shot> {
  const { toCanvas } = await import('html-to-image');
  const w = window.innerWidth;
  const h = window.innerHeight;
  const sx = window.scrollX;
  const sy = window.scrollY;
  const bg = getComputedStyle(document.body).backgroundColor || getComputedStyle(document.documentElement).backgroundColor || '#111';
  const opts = {
    width: w,
    height: h,
    // A scrolled page: the part on screen, not the top of the document.
    style: sx || sy ? { transform: `translate(${-sx}px, ${-sy}px)` } : {},
    pixelRatio: Math.min(window.devicePixelRatio || 1, SHOT_MAX_W / Math.max(1, w), 2),
    backgroundColor: bg,
    cacheBust: false,
    imagePlaceholder: BLANK,
    filter: (n: HTMLElement) => !(n instanceof Element) || !skip(n),
  };
  let canvas: HTMLCanvasElement;
  try {
    canvas = await toCanvas(document.body, opts);
  } catch {
    // Web fonts that cannot be fetched (offline) stop the font step: draw with the fallback fonts.
    canvas = await toCanvas(document.body, { ...opts, skipFonts: true });
  }
  const out = both(canvas, 'dom');
  if (!out) throw new Error('the picture could not be encoded');
  return out;
}

/** A picture the player pasted or chose, as a report's screenshot. */
export async function imageToShot(blob: Blob, how: 'paste' | 'file'): Promise<Shot> {
  if (!/^image\//.test(blob.type)) throw new Error('That is not a picture.');
  if (blob.size > 40 * 1024 * 1024) throw new Error('That picture is too large (over 40 MB).');
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(blob);
  } catch {
    throw new Error('That picture could not be read.');
  }
  try {
    const out = both(bmp, how);
    if (!out) throw new Error('That picture could not be encoded.');
    return out;
  } finally {
    bmp.close?.();
  }
}

/** The first picture on a paste event's clipboard, or null. */
export function pastedImage(e: ClipboardEvent): File | null {
  for (const item of Array.from(e.clipboardData?.items ?? [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) return item.getAsFile();
  }
  return null;
}
