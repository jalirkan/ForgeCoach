/*
 * ForgeCoach — ui/ambience/piecesArt.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Spec 1.14's built-in placeholder pieces, for `#ambience` only (the board
 * never shows them): plain dashed shapes labelled "placeholder", so the
 * placement of landmarks, veils, fronts and the empty table can be judged
 * before any art is painted.
 */
import type { PackFront, PackHalf, PackPiece, PackPieces, PieceColour, PiecePlace } from '../../ambience/manifest.ts';
import { PIECE_COLOURS } from '../../ambience/manifest.ts';

const url = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg.replace(/\s+/g, ' '))}`;
const label = (x: number, y: number, size: number, text: string) => `<text x="${x}" y="${y}" font-family="system-ui, sans-serif" font-size="${size}" text-anchor="middle" fill="#fff" stroke="#000" stroke-width="${size / 8}" paint-order="stroke">${text}</text>`;

const TINT: Record<PieceColour, string> = { W: '#f4e7b8', U: '#7fb6e6', B: '#6b5a7a', R: '#e0704a', G: '#7bbf6a' };

function piece(w: number, h: number, body: string, place: PiecePlace): PackPiece {
  return { src: url(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`), src2x: null, width: w, height: h, phone: null, place, bytes: null };
}

function landmark(name: string, shape: string, x: number): PackPiece {
  const body = `<rect x="4" y="4" width="392" height="192" rx="10" fill="rgba(0,0,0,0.18)" stroke="#fff" stroke-width="3" stroke-dasharray="12 8"/>${shape}${label(200, 40, 22, `${name} · landmark placeholder`)}`;
  return piece(400, 200, body, { sit: 'horizon', x, w: 0.22, lift: 0 });
}

function front(c: PieceColour): PackFront {
  const frames = [0.2, 0.5, 0.8].map((at, i) => ({
    src: url(`<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="640" viewBox="0 0 2048 640"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="${Math.max(0, at - 0.25)}" stop-color="${TINT[c]}" stop-opacity="0"/><stop offset="${at}" stop-color="${TINT[c]}" stop-opacity="0.75"/><stop offset="${Math.min(1, at + 0.25)}" stop-color="${TINT[c]}" stop-opacity="0"/></linearGradient></defs><rect width="2048" height="640" fill="url(#g)"/>${label(1024, 330, 40, `${c} front placeholder · frame ${i + 1}/3`)}</svg>`),
    phone: null,
    holdMs: 220,
  }));
  return { frames, holdMs: 220, fadeMs: 400, bytes: null };
}

const EMPTY: PackHalf = {
  src: url(`<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="640" viewBox="0 0 2048 640"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9ccd6"/><stop offset="0.43" stop-color="#e6e2d6"/><stop offset="0.44" stop-color="#8f8a7c"/><stop offset="1" stop-color="#4c4a44"/></linearGradient></defs><rect width="2048" height="640" fill="url(#s)"/><line x1="0" y1="275" x2="2048" y2="275" stroke="#fff" stroke-dasharray="16 10" stroke-width="2"/>${label(1024, 420, 40, 'the empty table · placeholder')}</svg>`),
  src2x: null,
  width: 2048,
  height: 640,
  subjectBand: [0.35, 0.6],
  focal: { x: 0.5, y: 0.475 },
  safe: { x: 0.25, y: 0.35, w: 0.5, h: 0.25 },
  horizon: 0.43,
  phone: null,
  bytes: null,
};

function veil(won: boolean): PackPiece {
  const c = won ? '#ffd98a' : '#1a1630';
  const body = `<defs><radialGradient id="v" cx="0.5" cy="0.45" r="0.7"><stop offset="0" stop-color="${c}" stop-opacity="${won ? 0.05 : 0.25}"/><stop offset="1" stop-color="${c}" stop-opacity="${won ? 0.45 : 0.7}"/></radialGradient></defs><rect width="2048" height="640" fill="url(#v)"/>${label(1024, 120, 36, `${won ? 'win' : 'loss'} veil · placeholder`)}`;
  return piece(2048, 640, body, { sit: 'fill', x: 0.5, w: 1, lift: 0 });
}

let cache: PackPieces | null = null;

/** The placeholder pieces (made once). */
export function builtinPieces(): PackPieces {
  if (cache) return cache;
  const elements: PackPieces['elements'] = {};
  const fronts: PackPieces['fronts'] = {};
  for (const c of PIECE_COLOURS) {
    elements[c] = piece(600, 300, `<ellipse cx="300" cy="220" rx="280" ry="70" fill="${TINT[c]}" fill-opacity="0.5"/>${label(300, 210, 26, `${c} element placeholder`)}`, { sit: 'ground', x: 0.5, w: 0.6, lift: 0 });
    fronts[c] = front(c);
  }
  cache = {
    elements,
    fronts,
    landmarks: {
      'City of Brass': landmark('City of Brass', '<path d="M120 196 v-50 a40 40 0 0 1 80 0 v50 z M210 196 v-70 a50 50 0 0 1 100 0 v70 z" fill="#c9a24a"/>', 0.72),
      'Seaside Citadel': landmark('Seaside Citadel', '<path d="M140 196 v-90 h30 v-20 h20 v20 h40 v-20 h20 v20 h30 v90 z" fill="#e8e4da"/>', 0.3),
      'Exotic Orchard': landmark('Exotic Orchard', '<circle cx="160" cy="130" r="34" fill="#d0503c"/><circle cx="240" cy="130" r="34" fill="#4a90d0"/><rect x="150" y="160" width="100" height="36" fill="#6a4a2a"/>', 0.55),
    },
    veils: { won: veil(true), lost: veil(false) },
    empty: EMPTY,
  };
  return cache;
}
