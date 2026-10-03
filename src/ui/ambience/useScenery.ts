/*
 * ForgeCoach — ui/ambience/useScenery.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * React glue for the scenery: the page's prefs (live, from Settings and
 * `?scenery=`), the loaded pack (or the procedural fallback and why), the
 * reduced-motion decision, and the effects queue the strips draw.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Biome } from '../../ambience/model.ts';
import type { SceneryEvent } from '../../ambience/events.ts';
import { browserLoader, resolveSceneryCached, type SceneryLoad } from '../../ambience/pack.ts';
import { currentPrefs, onSceneryPrefs, reducedMotion, type SceneryPrefs } from '../../ambience/prefs.ts';
import { useMediaQuery } from '../hooks.ts';
import type { StripFx } from './SceneryStrip.tsx';

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

const FX_MS = 1800;
const MAX_FX = 8;
const FX_COLOR: Record<string, string> = { W: '#fff3c4', U: '#9fd8ff', B: '#c7a8ff', R: '#ffad7a', G: '#b5f29a' };

/**
 * Per-player land pulses and short-lived effects, fed scenery events. Returns
 * stable objects that change only when something happened.
 */
export function useSceneryFx() {
  const [pulses, setPulses] = useState<Map<number, Partial<Record<Biome, number>>>>(new Map());
  const [fx, setFx] = useState<Map<number, StripFx[]>>(new Map());
  const seq = useRef(1);
  useEffect(() => {
    if (![...fx.values()].some((l) => l.length)) return;
    const t = setTimeout(() => setFx(new Map()), FX_MS);
    return () => clearTimeout(t);
  }, [fx]);
  const push = useMemo(
    () => (events: SceneryEvent[]) => {
      if (!events.length) return;
      const lands = events.filter((e) => e.kind === 'land');
      if (lands.length) {
        setPulses((prev) => {
          const next = new Map(prev);
          for (const e of lands) {
            const cur = { ...(next.get(e.player) ?? {}) };
            cur[e.biome] = (cur[e.biome] ?? 0) + 1;
            next.set(e.player, cur);
          }
          return next;
        });
      }
      const others = events.filter((e) => e.kind !== 'land');
      if (others.length) {
        setFx((prev) => {
          const next = new Map(prev);
          const add = (player: number | null, f: Omit<StripFx, 'key'>) => {
            if (player === null) return;
            next.set(player, [...(next.get(player) ?? []), { ...f, key: seq.current++ }].slice(-MAX_FX));
          };
          for (const e of others) {
            if (e.kind === 'creature') add(e.player, { kind: 'creature', x: 0.15 + ((e.cardId * 37) % 70) / 100, color: FX_COLOR[e.colors[0] ?? ''] });
            else if (e.kind === 'attack') add(e.player, { kind: 'attack' });
            else if (e.kind === 'damage' && e.targetKind === 'player') add(e.player, { kind: 'damage' });
          }
          return next;
        });
      }
    },
    [],
  );
  const reset = useMemo(
    () => () => {
      setPulses(new Map());
      setFx(new Map());
    },
    [],
  );
  return { pulses, fx, push, reset };
}
