/*
 * ForgeCoach — ui/draft/LabNumbers.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The pick screen's "Lab numbers" panel: for each card on offer, what the cube
 * lab's Forge-vs-Forge drafts say (draft/labStats.ts) — how its drafters took
 * it, how often it made the final 40, and its decks' win rate with a 95%
 * interval and the game count, beside the baseline of its colours. Shown only
 * when the cube has a lab meta; a card with no numbers says so. Collapsed by
 * default (remembered), so it never pushes the offer down by surprise.
 */
import { useMemo, useState } from 'react';
import type { CubeContext } from '../../cube/score.ts';
import { baselineLine, colourBaselines, colourNote, colourSkew, fmt, FORGE_CAVEAT, labCardView, pc, smallSampleNote, VERDICT_WORDS, winLine, type LabCardView } from '../../draft/labStats.ts';
import { cx, readLS, writeLS } from '../util.ts';

const OPEN_KEY = 'forgecoach.draft.labNumbers';

export function LabNumbers({ names, ctx }: { names: readonly string[]; ctx: CubeContext }) {
  const meta = ctx.meta?.meta ?? null;
  const [open, setOpen] = useState(() => readLS(OPEN_KEY) === '1');
  const baselines = useMemo(() => colourBaselines(meta), [meta]);
  const rows = useMemo(
    () => names.map((n) => ({ name: n, view: labCardView(meta, n, ctx.facts.get(n)?.colors ?? '', baselines, { land: ctx.facts.get(n)?.land === true }) })),
    [names, meta, ctx, baselines],
  );
  const skew = useMemo(() => colourSkew(baselines), [baselines]);
  if (!meta || !names.length) return null;
  const small = smallSampleNote(rows.map((r) => r.view));
  const sample = meta.sample;
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
          {names.length} card{names.length === 1 ? '' : 's'} · {typeof sample?.drafts === 'number' ? fmt(sample.drafts) : '?'} lab drafts, {typeof sample?.games === 'number' ? fmt(sample.games) : '?'} games
        </span>
      </summary>
      <p className="labn-caveat">{FORGE_CAVEAT}</p>
      {skew && <p className="labn-caveat is-skew">{colourNote(skew)}</p>}
      <ul className="labn-rows">
        {rows.map((r) => (
          <li key={r.name} className="labn-row">
            <div className="labn-name">{r.name}</div>
            {r.view ? <CardNumbers v={r.view} /> : <div className="labn-none">The lab has no numbers for this card.</div>}
          </li>
        ))}
      </ul>
      <p className="labn-foot">
        Win rate = decisive games won by lab decks that ran the card, with a 95% Wilson interval. “Strong” or “weak” only when the whole interval is clear of 50%.{small ? ` ${small}` : ''} Colour
        baselines: {[...baselines.values()][0]?.from === 'lab' ? 'the lab’s own per-colour figures' : 'summed from the lab’s archetypes'}.
      </p>
    </details>
  );
}

function CardNumbers({ v }: { v: LabCardView }) {
  return (
    <dl className="labn-facts">
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
    </dl>
  );
}
