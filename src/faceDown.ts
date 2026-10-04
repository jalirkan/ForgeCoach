/*
 * ForgeCoach — faceDown.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Defence in depth for a face-down card's real face (`Card.alt`, mtg-table
 * amendment P3). The bridge emits `alt` only when Forge's own
 * `CardView.canFaceDownBeShownTo(viewer)` says this seat may see it, which is
 *
 *   mayPlayerLook(viewer)                       -- a look permission
 *   || isInZone(Battlefield, Stack, Sideboard)
 *      && getController() == viewer             -- your own morph / manifest
 *
 * (javap on the pinned Forge 2.0.14 jar; mtg-table D371). This module re-checks
 * the half a log can show on every frame the client reads, so a bridge that
 * ever got it wrong could not put an opponent's face-down permanent on the
 * board or into a coach prompt:
 *
 * - **In play** (`battlefield`, `stack`) the face is its CONTROLLER's. A
 *   face-down permanent the viewing seat does not control has its `alt`
 *   dropped -- including one the seat owns but the opponent has stolen.
 * - **Outside play** (exile) a face-down card's face reaches the wire only by
 *   a look permission, which the log cannot show. The bridge's answer is kept:
 *   Gonti, Lord of Luxury and Thief of Sanity exile an OPPONENT's card face
 *   down and let their controller look at (and cast) it, and dropping that
 *   would hide from the player the card the rules let them play.
 *
 * Pure and DOM-free. Copy-on-write: a frame with nothing to drop comes back as
 * the same object, so React sees no change.
 */
import type { LoggedFrame } from './log.ts';

const IN_PLAY = new Set(['battlefield', 'stack']);

interface FaceDownish {
  faceDown?: unknown;
  hidden?: unknown;
  alt?: unknown;
  zone?: unknown;
  controller?: unknown;
}

/**
 * May `seat` keep this card's `alt`? True for anything that is not a full
 * face-down card carrying one; false for a face-down card in play that `seat`
 * does not control.
 */
export function altAllowed(card: FaceDownish, seat: number): boolean {
  if (card.faceDown !== true || card.hidden === true || card.alt === null || card.alt === undefined) return true;
  if (typeof card.zone === 'string' && IN_PLAY.has(card.zone)) return card.controller === seat;
  return true;
}

/**
 * `value` with every disallowed `alt` set to `null`, wherever a card sits in
 * it (state zones, `stackCards`, an ask's options, `input.focusCard`). Returns
 * `value` itself when nothing changed.
 */
export function guardFaceDown<T>(value: T, seat: number): T {
  return walk(value, seat) as T;
}

function walk(v: unknown, seat: number): unknown {
  if (Array.isArray(v)) {
    let out: unknown[] | null = null;
    for (let i = 0; i < v.length; i++) {
      const next = walk(v[i], seat);
      if (next !== v[i]) {
        out ??= v.slice();
        out[i] = next;
      }
    }
    return out ?? v;
  }
  if (v === null || typeof v !== 'object') return v;
  const o = v as Record<string, unknown>;
  let out: Record<string, unknown> | null = null;
  for (const k of Object.keys(o)) {
    if (k === 'alt') continue;
    const next = walk(o[k], seat);
    if (next !== o[k]) {
      out ??= { ...o };
      out[k] = next;
    }
  }
  if (!altAllowed(o, seat)) {
    out ??= { ...o };
    out.alt = null;
  }
  return out ?? v;
}

/** One logged frame through {@link guardFaceDown}; only server frames carry cards. */
export function guardFrame(f: LoggedFrame, seat: number): LoggedFrame {
  if (f.dir === 'c2s') return f;
  const body = guardFaceDown(f.body, seat);
  return body === f.body ? f : ({ ...f, body } as LoggedFrame);
}
