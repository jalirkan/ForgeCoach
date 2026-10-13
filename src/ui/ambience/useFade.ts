/*
 * ForgeCoach — ui/ambience/useFade.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * React glue for growth between stages (spec 1.6): a slot's fade stack
 * (ambience/growth.ts `fadeStack`) kept across renders, settled once a fade
 * has run, and the one-line trick that lets a picture appearing fade in from
 * nothing with a plain CSS transition.
 */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { fadeBusy, fadeStack, settleFades, type FadeEntry, type FadeWant } from '../../ambience/growth.ts';

/**
 * The pictures to draw for one picture slot, bottom to top: `cur` at full,
 * `next` over it at `fade`, plus, for one fade's length (`ms`), the picture a
 * stage-up replaced (beneath) and pictures no longer wanted (fading out). The
 * first render, and `ms` 0, are instant. Payloads are always the latest given.
 */
export function useFadeStack<T>(cur: FadeWant<T> | null, next: FadeWant<T> | null, fade: number, ms: number): FadeEntry<T>[] {
  const sig = `${cur?.key ?? ''}\n${next?.key ?? ''}\n${fade}`;
  const st = useRef<{ sig: string | null; stack: FadeEntry<T>[] }>({ sig: null, stack: [] });
  const [, bump] = useState(0);
  if (st.current.sig !== sig) st.current = { sig, stack: fadeStack(st.current.stack, cur, next, fade, st.current.sig === null || ms <= 0) };
  const stack = st.current.stack;
  const busy = fadeBusy(stack);
  useEffect(() => {
    if (!busy) return;
    const t = setTimeout(() => {
      st.current = { ...st.current, stack: settleFades(st.current.stack) };
      bump((n) => n + 1);
    }, ms + 80);
    return () => clearTimeout(t);
  }, [stack, busy, ms]);
  return stack.map((e) => (cur && e.key === cur.key ? { ...e, payload: cur.payload } : next && e.key === next.key ? { ...e, payload: next.payload } : e));
}

/**
 * The opacity to draw an element at: `from` on its first paint, then
 * `opacity`, so a CSS transition on opacity carries it (the element's style
 * is flushed at `from` before the change). With `ms` 0, `opacity` at once.
 */
export function useFadeIn(ref: RefObject<HTMLElement | null>, opacity: number, from: number, ms: number): number {
  const [armed, setArmed] = useState(() => ms <= 0 || from === opacity);
  useLayoutEffect(() => {
    if (armed) return;
    ref.current?.getBoundingClientRect();
    setArmed(true);
  }, [armed, ref]);
  return armed ? opacity : from;
}
