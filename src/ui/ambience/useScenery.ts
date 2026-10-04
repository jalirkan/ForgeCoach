/*
 * ForgeCoach — ui/ambience/useScenery.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * React glue for the scenery: the page's prefs (live, from Settings and
 * `?scenery=`), the loaded pack (or the procedural fallback and why), the
 * reduced-motion decision, and the effects queue the strips draw.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { slotsOf, type Biome, type Scenery } from '../../ambience/model.ts';
import type { SceneryEvent } from '../../ambience/events.ts';
import { DEFAULT_CONCURRENT_EFFECTS, packEffect, type ScenePack } from '../../ambience/manifest.ts';
import { EffectQueue, effectCues, resolveEffect, type EffectCue, type ResolvedEffect } from '../../ambience/effects.ts';
import { slotCentre } from '../../ambience/layout.ts';
import { browserLoader, resolveSceneryCached, type SceneryLoad } from '../../ambience/pack.ts';
import { currentPrefs, onSceneryPrefs, reducedMotion, type SceneryPrefs } from '../../ambience/prefs.ts';
import { useMediaQuery } from '../hooks.ts';
import type { StripEffect } from './SceneryEffects.tsx';

export function useSceneryPrefs(): SceneryPrefs {
  const [p, setP] = useState(currentPrefs);
  useEffect(() => {
    const on = () => setP(currentPrefs());
    const off = onSceneryPrefs(on);
    window.addEventListener('hashchange', on);
    return () => {
      off();
      window.removeEventListener('hashchange', on);
    };
  }, []);
  return p;
}

/** The loaded scenery for these prefs: undefined while loading, null when off. */
export function useSceneryLoad(prefs: SceneryPrefs): SceneryLoad | null | undefined {
  const [load, setLoad] = useState<SceneryLoad | null | undefined>(undefined);
  const key = `${prefs.mode}|${prefs.packUrl}`;
  useEffect(() => {
    let live = true;
    setLoad(undefined);
    resolveSceneryCached(prefs, { fetch: (u, i) => fetch(u, i), load: browserLoader() }).then(
      (l) => live && setLoad(l),
      () => live && setLoad(null),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return load;
}

export function useReducedMotion(prefs: SceneryPrefs, override?: boolean): boolean {
  const system = useMediaQuery('(prefers-reduced-motion: reduce)');
  return override ?? reducedMotion(prefs.motion, system);
}

interface FxItem {
  durationMs: number;
  player: number;
  fx: Omit<StripEffect, 'key'>;
}

/** Where a cue's card is across its player's strip (0..1), when the board can tell; else null. */
export type PlaceCard = (cue: EffectCue) => number | null;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Per-player land pulses and the one-shot effects queue (ambience/effects.ts),
 * fed scenery events. At most the pack's `effects.maxConcurrent` play at once;
 * `cancel` drops everything (a jump, scrubbing, unmount); a hidden tab pauses
 * the queue's clock along with the CSS. Returns stable functions.
 */
export function useSceneryFx(pack?: ScenePack | null, reduced = false) {
  const [pulses, setPulses] = useState<Map<number, Partial<Record<Biome, number>>>>(new Map());
  const [version, setVersion] = useState(0);
  const queue = useRef(new EffectQueue<FxItem>(DEFAULT_CONCURRENT_EFFECTS));
  const ctx = useRef({ pack, reduced });
  ctx.current = { pack, reduced };
  queue.current.setMax(pack?.effects?.maxConcurrent ?? DEFAULT_CONCURRENT_EFFECTS);
  const bump = () => setVersion((v) => v + 1);

  // Wake when the next effect ends (retire it, start a waiting one).
  useEffect(() => {
    const at = queue.current.nextWake();
    if (at === null) return;
    const t = setTimeout(() => queue.current.advance(now()) && bump(), Math.max(0, at - now()) + 16);
    return () => clearTimeout(t);
  }, [version]);

  // A hidden tab freezes the queue's clock (the CSS pauses with it: SceneryStrip's is-paused).
  useEffect(() => {
    const q = queue.current;
    const on = () => {
      if (document.visibilityState === 'hidden') q.pause(now());
      else {
        q.resume(now());
        bump();
      }
    };
    document.addEventListener('visibilitychange', on);
    return () => {
      document.removeEventListener('visibilitychange', on);
      q.clear();
    };
  }, []);

  const api = useMemo(() => {
    const items = (cues: EffectCue[], scenery: Scenery, place?: PlaceCard): FxItem[] => {
      const out: FxItem[] = [];
      for (const cue of cues) {
        const r: ResolvedEffect | null = resolveEffect(cue, ctx.current.pack, ctx.current.reduced);
        if (!r) continue;
        const slotX = slotCentre(slotsOf(scenery, cue.player), ctx.current.pack ?? null, cue.biome);
        const x = r.effect.at === 'strip' ? 0.5 : r.effect.at === 'card' ? (place?.(cue) ?? slotX ?? 0.5) : (slotX ?? 0.5);
        out.push({ durationMs: r.effect.durationMs, player: cue.player, fx: { event: cue.event, source: r.source, effect: r.effect, color: r.color, x } });
      }
      return out;
    };
    const fire = (cues: EffectCue[], scenery: Scenery, place?: PlaceCard) => {
      if (queue.current.paused) return;
      if (queue.current.push(items(cues, scenery, place), now())) bump();
    };
    const push = (events: SceneryEvent[], scenery: Scenery, place?: PlaceCard) => {
      if (!events.length) return;
      // A land pulses its slot, unless the pack draws its own landfall there.
      const lands = events.filter((e) => e.kind === 'land' && !packEffect(ctx.current.pack, 'landfall', e.biome));
      if (lands.length) {
        setPulses((prev) => {
          const next = new Map(prev);
          for (const e of lands) {
            if (e.kind !== 'land') continue;
            const cur = { ...(next.get(e.player) ?? {}) };
            cur[e.biome] = (cur[e.biome] ?? 0) + 1;
            next.set(e.player, cur);
          }
          return next;
        });
      }
      fire(effectCues(events, scenery), scenery, place);
    };
    const cancel = () => {
      if (queue.current.clear()) bump();
    };
    const reset = () => {
      cancel();
      setPulses(new Map());
    };
    return { push, fire, cancel, reset };
  }, []);

  const fx = useMemo(() => {
    const m = new Map<number, StripEffect[]>();
    for (const a of queue.current.current()) m.set(a.item.player, [...(m.get(a.item.player) ?? []), { ...a.item.fx, key: a.key }]);
    return m;
  }, [version]); // eslint-disable-line react-hooks/exhaustive-deps

  return { pulses, fx, ...api };
}
