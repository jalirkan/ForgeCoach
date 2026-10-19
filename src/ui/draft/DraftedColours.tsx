/*
 * ForgeCoach — ui/draft/DraftedColours.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The cube page's "Drafted colours (real drafts)" panel: of the decks people
 * actually built after drafting this cube — drafts with a friend in the draft
 * room whose seat agreed to recording, and the player's own drafts against the
 * bot — what share play each colour, how they split by exact colours (mono,
 * pairs, triples once there are enough decks, 4+), and month by month. Every
 * number carries its count and a 95% interval (cube/draftShares.ts). Read from
 * the engine on this PC (mtg-table D455's GET /draft-decks): colour counts
 * only, never a deck list. A count, not a verdict; the lab's bot-drafted
 * shares will sit beside it.
 */
import { useEffect, useMemo, useState } from 'react';
import { COLOUR_NAME, GUILD, type Colour } from '../../cube/colors.ts';
import { draftShares, fetchDraftDecks, MAIN_MIN_SPELLS, sharesByMonth, TRIPLE_MIN_DECKS, type DraftDecksResult, type ShareRow } from '../../cube/draftShares.ts';
import { cx } from '../util.ts';

const pc = (x: number) => `${Math.round(x * 100)}%`;

function rowLabel(key: string): string {
  if (key === '4+') return 'Four or five colours';
  if (key === '3') return 'Three colours';
  if (key === '') return 'No main colour';
  if (key.length === 1) return `Mono-${COLOUR_NAME[key as Colour]}`;
  return `${GUILD[key] ?? key} (${key})`;
}

function ShareBar({ r, label, pips }: { r: ShareRow; label: string; pips?: string }) {
  return (
    <li className="dshare-row" title={`${label}: ${r.k} of ${r.n} decks, ${pc(r.share)}; 95% interval ${pc(r.lo)}–${pc(r.hi)}`}>
      <span className="dshare-name">
        {pips && (
          <span className="dshare-pips" aria-hidden="true">
            {[...pips].map((c, i) => (
              <i key={i} className={`dshare-pip is-${c}`} />
            ))}
          </span>
        )}
        {label}
      </span>
      <span className="dshare-bar" aria-hidden="true">
        <i className="dshare-fill" style={{ width: pc(r.share) }} />
        <b className="dshare-ci" style={{ left: pc(r.lo), width: pc(Math.max(0, r.hi - r.lo)) }} />
      </span>
      <span className="dshare-num">
        <b>{pc(r.share)}</b> {r.k} of {r.n} · {Math.round(r.lo * 100)}–{pc(r.hi)}
      </span>
    </li>
  );
}

export function DraftedColours({ cubeId }: { cubeId: string }) {
  const [res, setRes] = useState<DraftDecksResult | null>(null);
  useEffect(() => {
    let live = true;
    setRes(null);
    void fetchDraftDecks(cubeId).then((r) => live && setRes(r));
    return () => {
      live = false;
    };
  }, [cubeId]);
  return <DraftedColoursView res={res} />;
}

/** The panel for one answer (null: still reading). */
export function DraftedColoursView({ res }: { res: DraftDecksResult | null }) {
  const decks = res?.state === 'ok' ? res.data.decks : null;
  const table = useMemo(() => (decks ? draftShares(decks) : null), [decks]);
  const months = useMemo(() => (decks ? sharesByMonth(decks) : []), [decks]);

  const head = (
    <h2 className="de-h">
      Drafted colours (real drafts) <span>{table ? `${table.n} deck${table.n === 1 ? '' : 's'}` : ''}</span>
    </h2>
  );
  if (!res) {
    return (
      <section className="dshare" aria-busy="true">
        {head}
        <p className="dshare-note">Reading the drafts your PC recorded…</p>
      </section>
    );
  }
  if (res.state !== 'ok' || !table) {
    return (
      <section className="dshare">
        {head}
        <p className="dshare-note">{res.state === 'ok' ? '' : res.message}</p>
      </section>
    );
  }
  if (table.n === 0) {
    return (
      <section className="dshare is-empty">
        {head}
        <p className="dshare-note">
          None yet. A draft with a friend counts once a player hands in their deck with recording on (their own choice in the room); a draft against the bot counts when you start its match.
        </p>
      </section>
    );
  }
  const shown = table.makeups.filter((r) => r.k > 0);
  const never = table.makeups.filter((r) => r.k === 0 && r.key !== '');
  return (
    <section className="dshare">
      {head}
      <p className="dshare-sub">
        {table.bySource.room > 0 && `${table.bySource.room} from drafts with a friend`}
        {table.bySource.room > 0 && table.bySource.solo > 0 && ' · '}
        {table.bySource.solo > 0 && `${table.bySource.solo} against the bot`}
        {table.first && ` · ${table.first === table.last ? table.first : `${table.first} to ${table.last}`}`}
      </p>
      <p className="dshare-note">
        The decks people built after drafting this cube. A deck’s main colours are those with {MAIN_MIN_SPELLS} or more of its spells; a splash is not one. A count, not a verdict: each bar’s band is its 95% interval, wide while the decks are few.
      </p>
      <div className="dshare-cols">
        <div>
          <div className="fx-label dshare-h">Decks playing each colour</div>
          <ul className="dshare-list">
            {table.colours.map((r) => (
              <ShareBar key={r.key} r={r} label={COLOUR_NAME[r.key as Colour]} pips={r.key} />
            ))}
          </ul>
        </div>
        <div>
          <div className="fx-label dshare-h">By their exact colours</div>
          <ul className="dshare-list">
            {shown.map((r) => (
              <ShareBar key={r.key || 'none'} r={r} label={rowLabel(r.key)} pips={r.key === '3' || r.key === '4+' ? undefined : r.key} />
            ))}
          </ul>
          {never.length > 0 && (
            <p className="dshare-never">
              None yet: {never.map((r) => (r.key === '3' || r.key === '4+' ? rowLabel(r.key).toLowerCase() : r.key)).join(', ')}.
            </p>
          )}
          {!table.triples && <p className="dshare-never">Three-colour decks are one row until {TRIPLE_MIN_DECKS} decks; then each triple has its own.</p>}
        </div>
      </div>
      {months.length > 1 && (
        <div className="dshare-time">
          <div className="fx-label dshare-h">Over time</div>
          <table className="dshare-table">
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col">Decks</th>
                {table.colours.map((r) => (
                  <th key={r.key} scope="col">
                    <i className={`dshare-pip is-${r.key}`} aria-hidden="true" /> {r.key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.month}>
                  <th scope="row">{m.month}</th>
                  <td>{m.n}</td>
                  {m.colours.map((r) => (
                    <td key={r.key} className={cx(r.k === 0 && 'is-zero')} title={`${r.k} of ${r.n}; 95% ${pc(r.lo)}–${pc(r.hi)}`}>
                      {pc(r.share)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(table.unreadCards > 0 || !res.data.scripts) && (
        <p className="dshare-never">
          {res.data.scripts
            ? `${table.unreadCards} card${table.unreadCards === 1 ? '' : 's'} in ${table.unreadDecks} deck${table.unreadDecks === 1 ? '' : 's'} had no Forge card script, so ${table.unreadCards === 1 ? 'it is' : 'they are'} left out of the colours.`
            : 'The engine on your PC could not read card colours (no Forge card scripts there), so these counts are empty: run ./tools/make-forge-home.sh in mtg-table.'}
        </p>
      )}
    </section>
  );
}
