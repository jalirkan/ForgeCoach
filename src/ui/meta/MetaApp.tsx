/*
 * ForgeCoach — ui/meta/MetaApp.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The Cube metagame page (#meta, #meta/<cube>): what the cube lab's AI-vs-AI
 * drafts say about each cube's archetypes and cards, laid out like a
 * metagame page — archetype cards with art, a table view, the per-card table
 * and a win-rate chart with its intervals. Data shaping is in
 * cube/metaView.ts; this file only lays it out.
 */
import './meta.css';
import { useEffect, useMemo, useState } from 'react';
import { CUBES, cubeInfo } from '../../cube/cubes.ts';
import {
  archetypeRows,
  cardRows,
  metaSubtitle,
  pct,
  searchArchetypes,
  searchCards,
  shrinkage,
  sortArchetypes,
  sortCards,
  type ArchetypeRow,
  type ArchetypeSort,
  type CardRow,
  type CardSort,
} from '../../cube/metaView.ts';
import { prefetchCards, useCardInfo } from '../cardData.ts';
import { cx } from '../util.ts';
import { Dots, IntervalStrip, LedgerShell, SearchIcon, Segmented, SortTh, useTip } from '../ledger/Ledger.tsx';
import { useMeta } from './useMeta.ts';
import { ArchetypeSheet } from './ArchetypeSheet.tsx';
import { ColourShareChart, WinChart } from './charts.tsx';

const PAGE = 12;
const CARD_PAGE = 40;

/** The cube named by the hash (#meta/<id>), else the first. */
export function cubeFromHash(hash: string): string {
  const id = /^#meta\/([\w-]+)/.exec(hash)?.[1];
  return id && cubeInfo(id) ? id : CUBES[0]!.id;
}

type View = 'archetypes' | 'cards';
type Layout = 'grid' | 'table';
type ColourFilter = 'all' | 'W' | 'U' | 'B' | 'R' | 'G';
type MinGames = '0' | '5' | '10';

export default function MetaApp() {
  const [cubeId, setCubeId] = useState(() => cubeFromHash(location.hash));
  useEffect(() => {
    const on = () => {
      if (location.hash.startsWith('#meta')) setCubeId(cubeFromHash(location.hash));
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const pick = (id: string) => {
    setCubeId(id);
    history.replaceState(null, '', `#meta/${id}`);
  };
  const info = cubeInfo(cubeId)!;
  const { loading, meta, source, themes } = useMeta(cubeId);

  const [view, setView] = useState<View>('archetypes');
  const [layout, setLayout] = useState<Layout>('grid');
  const [sort, setSort] = useState<ArchetypeSort>('share');
  const [desc, setDesc] = useState(true);
  const [cardSort, setCardSort] = useState<CardSort>('shrunk');
  const [cardDesc, setCardDesc] = useState(true);
  const [query, setQuery] = useState('');
  const [colour, setColour] = useState<ColourFilter>('all');
  const [minGames, setMinGames] = useState<MinGames>('0');
  const [shown, setShown] = useState(PAGE);
  const [cardsShown, setCardsShown] = useState(CARD_PAGE);
  const [open, setOpen] = useState<ArchetypeRow | null>(null);

  useEffect(() => {
    setShown(PAGE);
    setCardsShown(CARD_PAGE);
    setOpen(null);
  }, [cubeId, view]);

  const rows = useMemo(() => (meta ? archetypeRows(meta, themes) : []), [meta, themes]);
  const cards = useMemo(() => (meta ? cardRows(meta) : []), [meta]);
  const min = Number(minGames);

  useEffect(() => {
    // The art for every archetype card, and the key cards for the sheets.
    prefetchCards(rows.map((r) => r.keyCards[0]).filter((n): n is string => !!n));
  }, [rows]);

  const visible = useMemo(() => {
    const filtered = searchArchetypes(rows, query).filter((r) => (colour === 'all' || r.colors.includes(colour)) && r.games >= min);
    return sortArchetypes(filtered, sort, desc);
  }, [rows, query, colour, min, sort, desc]);
  const visibleCards = useMemo(() => {
    const filtered = searchCards(cards, query).filter((c) => (colour === 'all' || c.colors.includes(colour)) && c.games >= min);
    return sortCards(filtered, cardSort, cardDesc);
  }, [cards, query, colour, min, cardSort, cardDesc]);

  const prior = meta ? shrinkage(meta) : { strength: 20, mean: null };
  const sample = meta?.sample;

  const onSortArch = (k: ArchetypeSort) => {
    if (k === sort) setDesc(!desc);
    else {
      setSort(k);
      setDesc(k !== 'name');
    }
  };
  const onSortCard = (k: CardSort) => {
    if (k === cardSort) setCardDesc(!cardDesc);
    else {
      setCardSort(k);
      setCardDesc(k !== 'name');
    }
  };

  return (
    <LedgerShell page="meta">
      <div className="lg-kicker">Metagame</div>
      <h1 className="lg-title">The {info.title} Metagame</h1>
      <div className="lg-sub">
        {meta ? metaSubtitle(meta) : loading ? 'Loading the cube lab’s numbers…' : 'No cube lab run for this cube yet'}
        {source === 'imported' && <span className="lg-chip lg-chip-gold mt-imported">Imported</span>}
      </div>

      <div className="lg-tabs" role="tablist" aria-label="Cubes">
        {CUBES.map((c) => (
          <button key={c.id} type="button" role="tab" className="lg-tab" aria-selected={c.id === cubeId} onClick={() => pick(c.id)}>
            {c.title.replace(/ Cube$/, '')}
          </button>
        ))}
      </div>

      {meta && (
        <details className="lg-about">
          <summary>About these numbers</summary>
          <div className="lg-about-body">
            <p>
              Every game here is the Forge AI against itself: {sample?.drafts ?? 'the'} two-player drafts of this cube, each drafter building a deck and
              playing it out{sample?.aiProfile ? ` with Forge’s ${sample.aiProfile} AI profile` : ''}. They show how the cube’s archetypes and cards fare
              in Forge’s hands, which is close to — but not the same as — how they fare in yours.
            </p>
            <p>
              Samples are small, so win rates are shrunk toward the mean{prior.mean !== null ? ` (${pct(prior.mean)})` : ''} by a {prior.strength}-game
              prior: (wins + {prior.strength} × mean) ÷ (games + {prior.strength}). An archetype seen in three games sits near the mean until it earns its
              way off it. The whiskers are 95% Wilson intervals on the raw rate; where they cross 50%, the sample can’t tell the archetype from a coin flip.
            </p>
            <p>Meta share is an archetype’s decks over all decks the lab built; games are the games those decks played.</p>
          </div>
        </details>
      )}

      {loading ? (
        <div className="mt-loading">
          <span className="spinner spinner-lg" />
        </div>
      ) : !meta ? (
        <EmptyMeta file={info.file} title={info.title} />
      ) : (
        <>
          <section className="lg-panel lg-filters" aria-label="Filters">
            <div>
              <span className="lg-field-label">Show</span>
              <Segmented<View>
                label="Show"
                value={view}
                onChange={setView}
                options={[
                  { value: 'archetypes', label: 'Archetypes' },
                  { value: 'cards', label: 'Cards' },
                ]}
              />
            </div>
            <div>
              <span className="lg-field-label">Colour</span>
              <Segmented<ColourFilter>
                label="Colour"
                value={colour}
                onChange={setColour}
                options={[
                  { value: 'all', label: 'All' },
                  ...(['W', 'U', 'B', 'R', 'G'] as const).map((c) => ({
                    value: c,
                    title: { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' }[c],
                    label: <span className={cx('lg-seg-dot', `lg-dot-${c}`)} aria-label={c} />,
                  })),
                ]}
              />
            </div>
            <div>
              <span className="lg-field-label">Minimum games</span>
              <Segmented<MinGames>
                label="Minimum games"
                value={minGames}
                onChange={setMinGames}
                options={[
                  { value: '0', label: 'Any' },
                  { value: '5', label: '5+' },
                  { value: '10', label: '10+' },
                ]}
              />
              <div className="lg-field-note">
                {sample?.games ?? '—'} games{sample?.seedRange && Array.isArray(sample.seedRange) ? ` · seeds ${(sample.seedRange as number[]).join('–')}` : ''}
                {(sample as { format?: string } | undefined)?.format ? ` · ${(sample as { format?: string }).format} draft` : ''}
              </div>
            </div>
          </section>

          <div className="lg-toolbar">
            <label className="lg-search">
              <SearchIcon />
              <input
                className="lg-input"
                type="search"
                placeholder={view === 'archetypes' ? 'Search archetypes or cards' : 'Search cards'}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search"
              />
            </label>
            {view === 'archetypes' ? (
              <>
                <span className="lg-label-inline">Sort by</span>
                <select className="lg-select" value={sort} onChange={(e) => onSortArch(e.target.value as ArchetypeSort)} aria-label="Sort by">
                  <option value="share">Meta share</option>
                  <option value="win">Win rate</option>
                  <option value="games">Games</option>
                  <option value="name">Name</option>
                </select>
                <select className="lg-select" value={desc ? 'desc' : 'asc'} onChange={(e) => setDesc(e.target.value === 'desc')} aria-label="Order">
                  <option value="desc">{sort === 'name' ? 'Z to A' : 'Highest first'}</option>
                  <option value="asc">{sort === 'name' ? 'A to Z' : 'Lowest first'}</option>
                </select>
                <Segmented<Layout>
                  label="Layout"
                  value={layout}
                  onChange={setLayout}
                  options={[
                    { value: 'grid', label: 'Grid' },
                    { value: 'table', label: 'Table' },
                  ]}
                />
                <span className="lg-count">
                  Showing {Math.min(shown, visible.length)} of {visible.length} archetypes
                </span>
              </>
            ) : (
              <>
                <span className="lg-label-inline">Sort by</span>
                <select className="lg-select" value={cardSort} onChange={(e) => onSortCard(e.target.value as CardSort)} aria-label="Sort by">
                  <option value="shrunk">Win rate (shrunk)</option>
                  <option value="games">Games</option>
                  <option value="pickRate">Pick rate</option>
                  <option value="inclusion">Made the deck</option>
                  <option value="name">Name</option>
                </select>
                <span className="lg-count">
                  Showing {Math.min(cardsShown, visibleCards.length)} of {visibleCards.length} cards
                </span>
              </>
            )}
          </div>

          {view === 'archetypes' ? (
            <div className="mt-main">
              <div className="mt-content">
                {visible.length === 0 ? (
                  <p className="lg-muted mt-none">No archetype matches.</p>
                ) : layout === 'grid' ? (
                  <div className="mt-grid">
                    {visible.slice(0, shown).map((r) => (
                      <ArchetypeCard key={r.id} row={r} onOpen={() => setOpen(r)} />
                    ))}
                  </div>
                ) : (
                  <ArchetypeTable rows={visible.slice(0, shown)} sort={sort} desc={desc} onSort={onSortArch} onOpen={setOpen} />
                )}
                {visible.length > shown && (
                  <div className="lg-more">
                    <button type="button" className="lg-btn" onClick={() => setShown(shown + PAGE)}>
                      Show {Math.min(PAGE, visible.length - shown)} more
                    </button>
                  </div>
                )}
              </div>
              <aside className="mt-aside">
                <WinChart rows={rows} mean={prior.mean} onOpen={setOpen} />
                <ColourShareChart rows={rows} />
              </aside>
            </div>
          ) : (
            <CardTable rows={visibleCards} shown={cardsShown} sort={cardSort} desc={cardDesc} onSort={onSortCard} onMore={() => setCardsShown(cardsShown + CARD_PAGE)} />
          )}
        </>
      )}
      {meta && open && <ArchetypeSheet row={open} meta={meta} onClose={() => setOpen(null)} />}
    </LedgerShell>
  );
}

function ArchetypeCard({ row, onOpen }: { row: ArchetypeRow; onOpen: () => void }) {
  const art = useCardInfo(row.keyCards[0])?.image?.artCrop;
  const [broken, setBroken] = useState<string | null>(null);
  const thin = row.games < 5;
  return (
    <button type="button" className="mt-card" onClick={onOpen} aria-label={`${row.name}: details`}>
      <div className="mt-art">
        {art && broken !== art ? <img src={art} alt="" loading="lazy" decoding="async" onError={() => setBroken(art)} /> : <div className={cx('mt-art-blank', `mt-wash-${row.colors.slice(0, 2) || 'C'}`)} />}
        <span className={cx('mt-pill', thin && 'mt-pill-thin')}>
          {!thin && <span className={cx('lg-dot', `lg-dot-${row.colors[0] ?? 'C'}`)} />}
          {thin ? 'Thin sample' : row.id}
        </span>
      </div>
      <div className="mt-card-body">
        <div className="mt-card-name">{row.name}</div>
        <Dots colors={row.colors} />
        <ul className="mt-keys">
          {row.keyCards.slice(0, 3).map((k) => (
            <li key={k}>{k}</li>
          ))}
        </ul>
        <div className="mt-stats">
          <div>
            <span className="mt-stat-label">Meta</span>
            <span className="lg-mono mt-stat">
              {pct(row.share)} ({row.decks})
            </span>
          </div>
          <div className="mt-right">
            <span className="mt-stat-label">Games</span>
            <span className="lg-mono mt-stat">{row.games}</span>
          </div>
          <div>
            <span className="mt-stat-label">Win</span>
            <span className="lg-mono mt-stat">{pct(row.win)}</span>
          </div>
        </div>
        <IntervalStrip win={row.win} ci={row.ci} className="mt-card-strip" />
      </div>
    </button>
  );
}

function ArchetypeTable({
  rows,
  sort,
  desc,
  onSort,
  onOpen,
}: {
  rows: ArchetypeRow[];
  sort: ArchetypeSort;
  desc: boolean;
  onSort: (k: ArchetypeSort) => void;
  onOpen: (r: ArchetypeRow) => void;
}) {
  return (
    <div className="lg-table-wrap">
      <table className="lg-table">
        <thead>
          <tr>
            <SortTh k="name" sort={sort} desc={desc} onSort={onSort}>
              Archetype
            </SortTh>
            <SortTh k="share" sort={sort} desc={desc} onSort={onSort} num>
              Meta
            </SortTh>
            <SortTh k="games" sort={sort} desc={desc} onSort={onSort} num>
              Games
            </SortTh>
            <SortTh k="win" sort={sort} desc={desc} onSort={onSort} num title="Shrunk toward the mean by a 20-game prior">
              Win
            </SortTh>
            <th className="mt-col-strip mt-hide-sm">Interval</th>
            <th className="mt-hide-sm">Key cards</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="lg-row-click" onClick={() => onOpen(r)}>
              <td>
                <span className="lg-name">
                  <Dots colors={r.colors} />
                  <span className="lg-serif">{r.name}</span>
                </span>
              </td>
              <td className="num lg-mono">
                {pct(r.share)} <span className="lg-muted">({r.decks})</span>
              </td>
              <td className="num lg-mono">{r.games}</td>
              <td className="num lg-mono">{pct(r.win)}</td>
              <td className="mt-col-strip mt-hide-sm">
                <IntervalStrip win={r.win} ci={r.ci} />
              </td>
              <td className="mt-keys-cell mt-hide-sm">{r.keyCards.slice(0, 3).join(' · ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CardTable({
  rows,
  shown,
  sort,
  desc,
  onSort,
  onMore,
}: {
  rows: CardRow[];
  shown: number;
  sort: CardSort;
  desc: boolean;
  onSort: (k: CardSort) => void;
  onMore: () => void;
}) {
  const tip = useTip();
  const anyAi = rows.some((r) => r.aiLimited);
  return (
    <>
      {anyAi && (
        <p className="mt-ai-note">
          <span className="lg-chip lg-chip-gold">AI?</span> Forge marks these cards AI:RemAIDeck: its AI pilots them poorly, so a low win rate may say
          more about the pilot than the card.
        </p>
      )}
      <div className="lg-table-wrap">
        <table className="lg-table mt-cards">
          <thead>
            <tr>
              <SortTh k="name" sort={sort} desc={desc} onSort={onSort}>
                Card
              </SortTh>
              <th className="num mt-hide-sm">MV</th>
              <SortTh k="pickRate" sort={sort} desc={desc} onSort={onSort} num title="Picked when seen">
                Pick rate
              </SortTh>
              <th className="num mt-hide-sm" title="Average pick number when taken">
                Avg pick
              </th>
              <SortTh k="inclusion" sort={sort} desc={desc} onSort={onSort} num title="Made the deck when picked" className="mt-hide-sm">
                In deck
              </SortTh>
              <SortTh k="games" sort={sort} desc={desc} onSort={onSort} num>
                Games
              </SortTh>
              <th className="num mt-hide-sm">Raw win</th>
              <SortTh k="shrunk" sort={sort} desc={desc} onSort={onSort} num title="Shrunk toward the mean by a 20-game prior">
                Win
              </SortTh>
              <th className="mt-col-strip mt-hide-sm">Interval</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, shown).map((r) => (
              <tr
                key={r.name}
                onPointerMove={(e) =>
                  e.pointerType === 'mouse' &&
                  tip.show(
                    e,
                    <>
                      <b>{r.name}</b>
                      <div className="lg-mono">
                        {r.picked} picked of {r.seen} seen · {r.games} games
                      </div>
                      {r.ci && (
                        <div className="lg-mono">
                          Wilson 95%: {pct(r.ci[0], 0)}–{pct(r.ci[1], 0)}
                        </div>
                      )}
                    </>,
                  )
                }
                onPointerLeave={tip.hide}
              >
                <td>
                  <span className="lg-name">
                    <Dots colors={r.colors} />
                    <span>{r.name}</span>
                    {r.aiLimited && (
                      <span className="lg-chip lg-chip-gold" title="Forge’s AI pilots this card poorly: low numbers may not mean a bad card">
                        AI?
                      </span>
                    )}
                  </span>
                </td>
                <td className="num lg-mono mt-hide-sm">{r.mv ?? '—'}</td>
                <td className="num lg-mono">{pct(r.pickRate, 0)}</td>
                <td className="num lg-mono mt-hide-sm">{r.avgPickIndex !== null && r.picked ? r.avgPickIndex.toFixed(1) : '—'}</td>
                <td className="num lg-mono mt-hide-sm">{r.picked ? pct(r.inclusionRate, 0) : '—'}</td>
                <td className="num lg-mono">{r.games}</td>
                <td className="num lg-mono lg-muted mt-hide-sm">{pct(r.winRate)}</td>
                <td className={cx('num lg-mono', 'mt-win')}>{r.games ? pct(r.shrunk) : '—'}</td>
                <td className="mt-col-strip mt-hide-sm">{r.games > 0 && <IntervalStrip win={r.shrunk} ci={r.ci} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > shown && (
        <div className="lg-more">
          <button type="button" className="lg-btn" onClick={onMore}>
            Show {Math.min(CARD_PAGE, rows.length - shown)} more
          </button>
        </div>
      )}
      {tip.node}
    </>
  );
}

function EmptyMeta({ file, title }: { file: string; title: string }) {
  return (
    <section className="lg-panel lg-empty">
      <div className="lg-kicker">No cube lab run yet</div>
      <h2>Nothing to chart for the {title}</h2>
      <p>The metagame comes from mtg-table’s cube lab: Forge drafts the cube against itself, builds both decks and plays them out. Run it in mtg-table:</p>
      <pre>
        {`tools/cubelab.sh run cubes/${file}.md --format grid --drafts 40 --jobs 4 \\\n    --out var/cubelab/runs/${file} \\\n  && tools/cubelab.sh report var/cubelab/runs/${file}`}
      </pre>
      <p>
        The report writes a <code>meta.json</code> beside the run. Import it from <a href="#deck">Draft &amp; build</a> (the meta chip in the deck
        assistant’s header) and this page picks it up.
      </p>
    </section>
  );
}
