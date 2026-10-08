/*
 * ForgeCoach — ui/HumanPicks.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The human pick signal (cube/humanPicks.ts, docs/human-picks.md) for the
 * cubes that ship a `<file>.picks.json`: `useHumanPicks` loads it once per
 * page, `HumanPickCardLine` is one card's "Humans take this early" line (the
 * pick screen's Lab numbers panel), `HumanPickAdvice` the choice's line under
 * the grid / Winston / booster advice ("Humans with your pool would most
 * often take …"), and `HumanPicksSource` the credit. Styled as the other
 * 17Lands numbers (human.css): the blue rule and the word "Humans", never the
 * lab's gold. A signal beside the advice, never part of its ranking.
 */
import { useEffect, useState } from 'react';
import { cubeInfo } from '../cube/cubes.ts';
import type { CubeContext } from '../cube/score.ts';
import { humanPickLine, humanPickNote, humanPicksSourceLine, humanPickTier, loadHumanPicks, PICKS_NOTE, type HumanPicks } from '../cube/humanPicks.ts';
import { cx } from './util.ts';
import './human.css';

const BASE = import.meta.env.BASE_URL;
const cache = new Map<string, Promise<HumanPicks | null>>();

/** The shipped pick model for a cube, loaded once per page (null when none ships or it is unreadable). */
export function humanPicksFor(info: { id: string; file: string; humanPicks?: boolean }): Promise<HumanPicks | null> {
  let p = cache.get(info.id);
  if (!p) {
    p = loadHumanPicks(info, BASE);
    cache.set(info.id, p);
  }
  return p;
}

/** The cube's human pick model, or null (none ships, still loading, or unreadable). */
export function useHumanPicks(cubeId: string | null | undefined): HumanPicks | null {
  const [data, setData] = useState<HumanPicks | null>(null);
  useEffect(() => {
    setData(null);
    const info = cubeId ? cubeInfo(cubeId) : undefined;
    if (!info?.humanPicks) return;
    let live = true;
    humanPicksFor(info).then((d) => live && setData(d));
    return () => {
      live = false;
    };
  }, [cubeId]);
  return data;
}

/** One card's human pick line, or nothing when the model does not cover the card. */
export function HumanPickCardLine({ data, name }: { data: HumanPicks; name: string }) {
  const line = humanPickLine(data, name);
  if (!line) return null;
  const tier = humanPickTier(data, name);
  return (
    <div className="hx is-compact hx-picks">
      <span className="hx-label">Human picks</span>
      <span className={cx('hx-body', tier === 'early' && 'hx-early')}>{line}</span>
    </div>
  );
}

/** The choice's human pick line under the advice; nothing when fewer than two cards are covered. */
export function HumanPickAdvice({ data, names, pool, ctx }: { data: HumanPicks | null; names: readonly string[]; pool: readonly string[]; ctx: CubeContext }) {
  if (!data) return null;
  const note = humanPickNote(data, names, pool, (n) => ctx.facts.get(n));
  if (!note) return null;
  return (
    <div className="hx hx-picks" role="note">
      <span className="hx-label">Humans</span>
      <span className="hx-body">
        <span>{note}</span>
        <span className="hx-mute">A signal from 17Lands drafters, beside the advice above; it does not change it.</span>
      </span>
    </div>
  );
}

/** The credit (visible, linked) and what the model is and is not. */
export function HumanPicksSource({ data }: { data: HumanPicks }) {
  return (
    <p className="hx-note">
      <b>Human picks (17Lands, Arena cube).</b> Pick model for {data.cube.matched} of this cube’s {data.cube.cards} cards, from{' '}
      <a href={data.source.page} target="_blank" rel="noreferrer">
        17Lands public datasets
      </a>{' '}
      ({humanPicksSourceLine(data)};{' '}
      <a href={data.source.licenceUrl} target="_blank" rel="license noreferrer">
        {data.source.licence}
      </a>
      ), fitted by ForgeCoach; 17Lands does not endorse it. {PICKS_NOTE} On held-out drafts it named the card taken {Math.round(data.test.top1 * 100)}% of the time, against{' '}
      {Math.round(data.test.top1PickValue * 100)}% for this page’s own pick advice.
    </p>
  );
}
