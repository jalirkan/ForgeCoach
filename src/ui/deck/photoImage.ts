/*
 * ForgeCoach — ui/deck/photoImage.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Photos for photo to pool, made small in the browser before they go
 * anywhere: the long side at most 1568 px (what the model reads at full
 * detail; more only costs time and tokens), re-encoded as JPEG, the camera's
 * rotation applied. Kept in memory only: an object URL for the thumbnail and
 * the base64 for the request, both dropped when the sheet closes.
 */
import type { VisionImage } from '../../claude.ts';

export const PHOTO_LONG_SIDE = 1568;
export const PHOTO_QUALITY = 0.85;

/** The size to draw a `w`×`h` image at so its long side is at most `max` (never enlarged). */
export function fitSize(w: number, h: number, max = PHOTO_LONG_SIDE): { width: number; height: number } {
  if (!(w > 0) || !(h > 0)) return { width: 0, height: 0 };
  const k = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

export interface PreparedPhoto {
  id: string;
  /** The file's own name, for the player's eyes only. */
  label: string;
  image: VisionImage;
  /** An object URL of the downscaled JPEG (revoke with `releasePhoto`). */
  previewUrl: string;
  width: number;
  height: number;
  /** Size of the JPEG sent. */
  bytes: number;
}

function blobToBase64(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      resolve(s.slice(s.indexOf(',') + 1));
    };
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.readAsDataURL(b);
  });
}

async function decode(file: Blob): Promise<{ src: CanvasImageSource; w: number; h: number; close(): void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { src: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close() };
    } catch {
      /* fall through to <img> (older Safari) */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { src: img, w: img.naturalWidth, h: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

let seq = 0;

/** Downscales one photo the player chose. Rejects with plain words when the browser cannot read it. */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  let d;
  try {
    d = await decode(file);
  } catch {
    throw new Error(`“${file.name || 'This photo'}” couldn’t be read by this browser. Try a JPEG or PNG (on an iPhone, the camera’s “Most Compatible” format).`);
  }
  try {
    const { width, height } = fitSize(d.w, d.h);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext('2d');
    if (!g) throw new Error('This browser has no canvas to shrink the photo with.');
    g.imageSmoothingQuality = 'high';
    g.drawImage(d.src, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', PHOTO_QUALITY));
    if (!blob) throw new Error('The photo couldn’t be re-encoded.');
    const data = await blobToBase64(blob);
    return {
      id: `ph${++seq}`,
      label: file.name || `Photo ${seq}`,
      image: { mediaType: 'image/jpeg', data },
      previewUrl: URL.createObjectURL(blob),
      width,
      height,
      bytes: blob.size,
    };
  } finally {
    d.close();
  }
}

export function releasePhoto(p: PreparedPhoto): void {
  try {
    URL.revokeObjectURL(p.previewUrl);
  } catch {
    /* already gone */
  }
}
