/*
 * ForgeCoach — ui/ambience/usePictures.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * React glue for ambience/pack.ts's picture store: a component that gates a
 * picture on its load (the whole-half panorama, an element, a front's
 * frames) re-renders when any picture settles, ready or failed.
 */
import { useSyncExternalStore } from 'react';
import { subscribePictures } from '../../ambience/pack.ts';

let version = 0;
const bump = new Set<() => void>();
let unsub: (() => void) | null = null;

function subscribe(onChange: () => void): () => void {
  bump.add(onChange);
  unsub ??= subscribePictures(() => {
    version++;
    for (const f of [...bump]) f();
  });
  return () => {
    bump.delete(onChange);
    if (!bump.size && unsub) {
      unsub();
      unsub = null;
    }
  };
}

const idle = () => () => {};

/**
 * A number that changes whenever a picture settles (pack.ts `markPicture`),
 * while `on`; off, it is 0 and the component is never woken (the default
 * board, with no pair picture and no front waiting, re-renders for nothing).
 */
export function usePicturesVersion(on = true): number {
  return useSyncExternalStore(on ? subscribe : idle, () => (on ? version : 0), () => (on ? version : 0));
}
