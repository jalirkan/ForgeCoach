/*
 * ForgeCoach — ui/draft/LabNumbers.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The pick screen's "Lab numbers" panel: for each card on offer, what the cube
 * lab's Forge-vs-Forge drafts say (draft/labStats.ts) — how its drafters took
 * it, how often it made the final 40, and its decks' win rate with a 95%
 * interval and the game count, beside the baseline of its colours — and its
 * lab strength from the matchup model (card-power.json): points per copy with a
 * 95% interval, "not rated" for a card Forge's AI never builds. Shown when the
 * cube has a lab meta or the card-power file covers it; a card with no numbers
 * says so. Collapsed by
 * default (remembered), so it never pushes the offer down by surprise.
 */
import { useMemo, useState } from 'react';
import type { CubeContext } from '../../cube/score.ts';
import { nightsLabel } from '../../cube/cardPower.ts';
import {
  baselineLine, colourBaselines, colourNote, colourSkew, fmt, FORGE_CAVEAT, labCardView, pc, pointsLine, POWER_VERDICT_WORDS, powerNote, powerRow, RANDOM_WORDS,
  smallSampleNote, UNRATED_WORDS, VERDICT_WORDS, winLine, type LabCardView, type PowerRow,
} from '../../draft/labStats.ts';
import { cx, readLS, writeLS } from '../util.ts';

const OPEN_KEY = 'forgecoach.draft.labNumbers';

export function LabNumbers({ names, ctx }: { names: readonly string[]; ctx: CubeContext }) {
  const meta = ctx.meta?.meta ?? null;
  const power = ctx.power;
  const [open, setOpen] = useState(() => readLS(OPEN_KEY) === '1');
  const baselines = useMemo(() => colourBaselines(meta), [meta]);
  const rows = useMemo(
    () =>
      names.map((n) => {
        const land = ctx.facts.get(n)?.land === true;
        return { name: n, view: labCardView(meta, n, ctx.facts.get(n)?.colors ?? '', baselines, { land }), power: powerRow(power, n, land) };
      }),
    [names, meta, power, ctx, baselines],
  );
  const skew = useMemo(() => colourSkew(baselines), [baselines]);
  if ((!meta && !power) || !names.length) return null;
  const small = smallSampleNote(rows.map((r) => r.view));
  const sample = meta?.sample;
  return (
    <details
      className="labn"
      open={open}
      onToggle={(e) => {
        const o = (e.currentTarget as HTMLDetailsElement).open;
        setOpen(o);
        writeLS(OPEN_KEY, o ? '1' : null);
      }}
    >
      <summary className="labn-sum">
        <span className="fx-label">Lab numbers</span>
        <span className="labn-sub">
          {names.length} card{names.length === 1 ? '' : 's'} ·{' '}
          {meta
            ? `${typeof sample?.drafts === 'number' ? fmt(sample.drafts) : '?'} lab drafts, ${typeof sample?.games === 'number' ? fmt(sample.games) : '?'} games`
            : `matchup model, ${power ? nightsLabel(power) : ''}`}
        </span>
      </summary>
      <p className="labn-caveat">{FORGE_CAVEAT}</p>
      {skew && <p className="labn-caveat is-skew">{colourNote(skew)}</p>}
      <ul className="labn-rows">
        {rows.map((r) => (
          <li key={r.name} className="labn-row">
            <div className="labn-name">{r.name}</div>
            {r.view || r.power ? (
              <dl className="labn-facts">
                {r.power && <PowerNumbers p={r.power} nights={power ? nightsLabel(power) : ''} />}
                {r.view && <CardNumbers v={r.view} />}
              </dl>
            ) : (
              <div className="labn-none">The lab has no numbers for this card.</div>
            )}
          </li>
        ))}
      </ul>
      {power && <p className="labn-foot">{powerNote(power)} “Stronger” or “weaker” only when the whole interval is clear of 0.</p>}
      {meta && (
        <p className="labn-foot">
          Win rate = decisive games won by lab decks that ran the card, with a 95% Wilson interval. “Strong” or “weak” only when the whole interval is clear of 50%.{small ? ` ${small}` : ''} Colour
          baselines: {[...baselines.values()][0]?.from === 'lab' ? 'the lab’s own per-colour figures' : 'summed from the lab’s archetypes'}.
        </p>
      )}
    </details>
  );
}

function PowerNumbers({ p, nights }: { p: NonNullable<PowerRow>; nights: string }) {
  if (p.kind === 'unrated')
    return (
      <div>
        <dt>Lab strength</dt>
        <dd className="labn-mute">{UNRATED_WORDS}</dd>
      </div>
    );
  const v = p.view;
  return (
    <div>
      <dt>Lab strength</dt>
      <dd>
        <span className={cx('labn-win', `is-${v.verdict}`)}>{pointsLine(v)}</span> <span className="labn-mute">per copy · matchup model, {nights}, {fmt(v.games)} games</span>
        <span className="labn-verdict">{POWER_VERDICT_WORDS[v.verdict]}</span>
        {v.random && <span className="labn-verdict">{RANDOM_WORDS}</span>}
      </dd>
    </div>
  );
}

function CardNumbers({ v }: { v: LabCardView }) {
  return (
    <>
      {v.early ? (
        <div>
          <dt>Picked early</dt>
          <dd>
            {pc(v.early.p)} <span className="labn-mute">({fmt(v.early.k)} of {fmt(v.early.n)}, {v.early.window})</span>
          </dd>
        </div>
      ) : (
        (v.taken || v.avgPick !== null) && (
          <div>
            <dt>Drafted</dt>
            <dd>
              {v.taken ? (
                <>
                  taken {pc(v.taken.p)} of times seen <span className="labn-mute">({fmt(v.taken.picked)}/{fmt(v.taken.seen)})</span>
                </>
              ) : null}
              {v.taken && v.avgPick !== null ? ' · ' : ''}
              {v.avgPick !== null ? <>avg pick {v.avgPick.toFixed(1)}</> : null}
            </dd>
          </div>
        )
      )}
      {v.inDeck && (
        <div>
          <dt>Made the 40</dt>
          <dd>
            {pc(v.inDeck.p)} <span className="labn-mute">({fmt(v.inDeck.inDecks)} of {fmt(v.inDeck.picked)} times picked)</span>
          </dd>
        </div>
      )}
      {v.hidden ? (
        <div>
          <dt>In decks</dt>
          <dd className="labn-mute">{v.hidden}</dd>
        </div>
      ) : (
        <div>
          <dt>Deck win rate</dt>
          <dd>
            {v.win ? (
              <>
                <span className={cx('labn-win', `is-${v.verdict}`)}>{winLine(v.win)}</span>
                <span className="labn-verdict">{VERDICT_WORDS[v.verdict]}</span>
              </>
            ) : (
              <span className="labn-mute">no decisive games yet</span>
            )}
          </dd>
        </div>
      )}
      {v.baselines.length > 0 && (
        <div>
          <dt>Colour baseline</dt>
          <dd className="labn-mute">{v.baselines.map(baselineLine).join(' · ')}</dd>
        </div>
      )}
    </>
  );
}
