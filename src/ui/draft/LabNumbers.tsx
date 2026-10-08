/*
 * ForgeCoach — ui/draft/LabNumbers.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The pick screen's "Lab numbers" panel: for each card on offer, what the cube
 * lab's Forge-vs-Forge drafts say (draft/labStats.ts) — how its drafters took
 * it, how often it made the final 40, and its decks' win rate with a 95%
 * interval and the game count, beside the baseline of its colours. A cube
 * with no lab meta (and no human data) gets one quiet line saying so; a card
 * with no numbers says so. For the cube
 * 17Lands covers, each card also carries its human line (HumanNumbers.tsx,
 * cube/human.ts), styled apart from the lab's, and each card with lab numbers
 * a "Lab number: …" reliability label (LabTrust.tsx). Collapsed by default
 * (remembered), so it never pushes the offer down by surprise.
 */
import { useMemo, useState } from 'react';
import type { CubeContext } from '../../cube/score.ts';
import { baselineLine, colourBaselines, colourNote, colourSkew, fmt, FORGE_CAVEAT, labCardView, pc, smallSampleNote, VERDICT_WORDS, winLine, type LabCardView } from '../../draft/labStats.ts';
import { cx, readLS, writeLS } from '../util.ts';
import { HumanCardFacts, HumanSourceNote, useHumanCards } from '../HumanNumbers.tsx';
import { LabTrustLine } from '../LabTrust.tsx';
import { labTrust } from '../../cube/labTrust.ts';

const OPEN_KEY = 'forgecoach.draft.labNumbers';

export function LabNumbers({ names, ctx, cubeId }: { names: readonly string[]; ctx: CubeContext; cubeId?: string }) {
  const meta = ctx.meta?.meta ?? null;
  const human = useHumanCards(cubeId);
  const [open, setOpen] = useState(() => readLS(OPEN_KEY) === '1');
  const baselines = useMemo(() => colourBaselines(meta), [meta]);
  const rows = useMemo(
    () => names.map((n) => ({ name: n, view: labCardView(meta, n, ctx.facts.get(n)?.colors ?? '', baselines, { land: ctx.facts.get(n)?.land === true }) })),
    [names, meta, ctx, baselines],
  );
  const skew = useMemo(() => colourSkew(baselines), [baselines]);
  if (!names.length) return null;
  if (!meta && !human) {
    return (
      <div className="labn labn-sum is-empty" role="note">
        <span className="fx-label">Lab numbers</span>
        <span className="labn-sub">none for this cube: the cube lab has not drafted it yet</span>
      </div>
    );
  }
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
        <span className="fx-label">{meta ? 'Lab numbers' : 'Card numbers'}</span>
        <span className="labn-sub">
          {names.length} card{names.length === 1 ? '' : 's'}
          {meta ? ` · ${typeof sample?.drafts === 'number' ? fmt(sample.drafts) : '?'} lab drafts, ${typeof sample?.games === 'number' ? fmt(sample.games) : '?'} games` : ''}
          {human ? ` · 17Lands human data for ${human.cube.matched} of ${human.cube.cards} cards` : ''}
        </span>
      </summary>
      {meta && <p className="labn-caveat">{FORGE_CAVEAT}</p>}
      {skew && <p className="labn-caveat is-skew">{colourNote(skew)}</p>}
      <ul className="labn-rows">
        {rows.map((r) => (
          <li key={r.name} className="labn-row">
            <div className="labn-name">{r.name}</div>
            {r.view ? <CardNumbers v={r.view} /> : meta && <div className="labn-none">The lab has no numbers for this card.</div>}
            {r.view && <LabTrustLine trust={labTrust(ctx.facts.get(r.name))} />}
            {human && <HumanCardFacts data={human} name={r.name} />}
          </li>
        ))}
      </ul>
      {human && <HumanSourceNote data={human} />}
      {meta && (
        <p className="labn-foot">
          Win rate = decisive games won by lab decks that ran the card, with a 95% Wilson interval. “Strong” or “weak” only when the whole interval is clear of 50%.{small ? ` ${small}` : ''} Colour
          baselines: {[...baselines.values()][0]?.from === 'lab' ? 'the lab’s own per-colour figures' : 'summed from the lab’s archetypes'}.
        </p>
      )}
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
