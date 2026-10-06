/*
 * ForgeCoach — ui/HumanNumbers.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Human card numbers from 17Lands (cube/human.ts) for the cube 17Lands covers:
 * `useHumanCards` loads a cube's shipped `<file>.human.json` once per page,
 * `HumanCardFacts` shows one card's line (the pick screen's Lab numbers panel,
 * the card info sheet), `HumanSourceNote` the credit and the Arena caveat.
 * Styled apart from the Forge lab's numbers (human.css): a cool rule and the
 * word "Humans", never the lab's gold.
 */
import { useEffect, useState } from 'react';
import { cubeInfo } from '../cube/cubes.ts';
import { ARENA_NOTE, HUMAN_TITLE, humanCardView, humanLine, humanSourceLine, humanVerdictLine, iwdLine, loadHumanCards, type HumanCards } from '../cube/human.ts';
import { cx } from './util.ts';
import './human.css';

const BASE = import.meta.env.BASE_URL;
const cache = new Map<string, Promise<HumanCards | null>>();

/** The cube's human numbers, or null (none ship, still loading, or unreadable). */
export function useHumanCards(cubeId: string | null | undefined): HumanCards | null {
  const [data, setData] = useState<HumanCards | null>(null);
  useEffect(() => {
    setData(null);
    const info = cubeId ? cubeInfo(cubeId) : undefined;
    if (!info?.humanData) return;
    let p = cache.get(info.id);
    if (!p) {
      p = loadHumanCards(info, BASE);
      cache.set(info.id, p);
    }
    let live = true;
    p.then((d) => live && setData(d));
    return () => {
      live = false;
    };
  }, [cubeId]);
  return data;
}

/** One card's human line; a card outside 17Lands' cube (or under the games threshold) says so. */
export function HumanCardFacts({ data, name, compact }: { data: HumanCards; name: string; compact?: boolean }) {
  const v = humanCardView(data, name);
  return (
    <div className={cx('hx', compact && 'is-compact')}>
      <span className="hx-label">Humans</span>
      {v ? (
        <span className="hx-body">
          <span className={cx('hx-rate', `is-${v.verdict}`)}>{humanLine(v)}</span>
          <span className="hx-verdict">{humanVerdictLine(v)}</span>
          {v.iwd && <span className="hx-mute">{iwdLine(v.iwd)}</span>}
        </span>
      ) : (
        <span className="hx-body hx-mute">Not in 17Lands’ Arena cube data (or fewer than {data.minGih.toLocaleString('en-US')} games in hand).</span>
      )}
    </div>
  );
}

/** The credit (visible, linked) and the Arena-version caveat. */
export function HumanSourceNote({ data }: { data: HumanCards }) {
  return (
    <p className="hx-note">
      <b>{HUMAN_TITLE}.</b> Data from{' '}
      <a href={data.source.page} target="_blank" rel="noreferrer">
        17Lands public datasets
      </a>{' '}
      ({humanSourceLine(data)};{' '}
      <a href={data.source.licenceUrl} target="_blank" rel="license noreferrer">
        {data.source.licence}
      </a>
      ), aggregated by ForgeCoach; 17Lands does not endorse it. {ARENA_NOTE} “Win when drawn” = games won when the card was in the opening hand or drawn, with a 95% Wilson interval; strong or weak only when the whole interval is clear of the format’s average.
    </p>
  );
}
