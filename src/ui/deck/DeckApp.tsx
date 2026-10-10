/*
 * ForgeCoach — ui/deck/DeckApp.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Draft & build: the deck assistant for two-player paper cube drafts. Pick a
 * cube, enter the pool as you draft (or paste it), get the best 40 with its
 * reasons, ask for Grid and Winston picks, ask the coach. Pools are kept in
 * this browser; cube-lab meta files can be imported (and are kept too).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './deck.css';
import '../forge-theme.css';
import '../draft/draft.css';
import './skin.css';
import { DRAFT_CUBES, OWNED_DECKS, cubeInfo, loadCubeDoc, type CubeInfo } from '../../cube/cubes.ts';
import { deckPool, deletePool, listPools, newPool, savePool, type SavedPool } from '../../cube/pools.ts';
import { parseMeta } from '../../cube/meta.ts';
import { poolColours } from '../../cube/pick.ts';
import { colourLabel } from '../../cube/colors.ts';
import { Logo } from '../Logo.tsx';
import { PipRow } from '../Mana.tsx';
import { Sheet } from '../Sheet.tsx';
import { IconArrowRight, IconChevronLeft, IconGear, IconLayers, IconPlus, IconTrash, IconUpload } from '../Icons.tsx';
import { cx } from '../util.ts';
import { useCubeData, type CubeData } from './useCubeData.ts';
import { PoolView } from './PoolView.tsx';
import { BuildView } from './BuildView.tsx';
import { GridView } from './GridView.tsx';
import { WinstonView } from './WinstonView.tsx';
import { CardInfoSheet } from './sheets.tsx';

type Tab = 'pool' | 'build' | 'grid' | 'winston';
const TABS: Array<[Tab, string]> = [
  ['pool', 'Pool'],
  ['build', 'Build'],
  ['grid', 'Grid'],
  ['winston', 'Winston'],
];

function readHash(): { pool: string | null; tab: Tab } {
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  const tab = h.get('tab') as Tab | null;
  return { pool: h.get('pool'), tab: tab && TABS.some(([t]) => t === tab) ? tab : 'pool' };
}

export default function DeckApp({ onExit, onSettings }: { onExit: () => void; onSettings: () => void }) {
  const [pools, setPools] = useState<SavedPool[]>(() => listPools());
  const [openId, setOpenId] = useState<string | null>(() => readHash().pool);
  const [tab, setTab] = useState<Tab>(() => readHash().tab);
  const open = pools.find((p) => p.id === openId) ?? null;

  useEffect(() => {
    const h = open ? `#deck&pool=${encodeURIComponent(open.id)}&tab=${tab}` : '#deck';
    if (location.hash !== h) history.replaceState(null, '', h);
  }, [open, tab]);

  const update = useCallback((p: SavedPool) => {
    savePool(p);
    setPools(listPools());
  }, []);

  const open_ = (p: SavedPool, t: Tab) => {
    savePool(p);
    setPools(listPools());
    setOpenId(p.id);
    setTab(t);
  };
  const create = (c: CubeInfo) => {
    const d = new Date();
    const name = `${c.title} · ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
    if (c.kind !== 'deck') return open_(newPool(c.id, name), 'pool');
    // A deck you own: the pool is the whole list, so it opens on the builds. If the list can't be
    // fetched, an empty pool still opens (paste or pick the cards there).
    loadCubeDoc(c, import.meta.env.BASE_URL).then(
      (cube) => open_(deckPool(c.id, name, cube.cards.map((x) => x.name)), 'build'),
      () => open_(newPool(c.id, name), 'pool'),
    );
  };

  if (!open) {
    return (
      <DeckHome
        pools={pools}
        onCreate={create}
        onOpen={(id) => {
          setOpenId(id);
          setTab(pools.find((p) => p.id === id)?.cards.length ? 'build' : 'pool');
        }}
        onDelete={(id) => {
          deletePool(id);
          setPools(listPools());
        }}
        onExit={onExit}
        onSettings={onSettings}
      />
    );
  }
  return <Workspace key={open.id} pool={open} tab={tab} onTab={setTab} onChange={update} onBack={() => setOpenId(null)} onSettings={onSettings} />;
}

function DeckHome({
  pools,
  onCreate,
  onOpen,
  onDelete,
  onExit,
  onSettings,
}: {
  pools: SavedPool[];
  onCreate: (c: CubeInfo) => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onExit: () => void;
  onSettings: () => void;
}) {
  const [confirm, setConfirm] = useState<string | null>(null);
  return (
    <div className="load deck-home fx">
      <header className="load-top">
        <button className="logo-btn" onClick={onExit} aria-label="ForgeCoach home">
          <Logo />
        </button>
        <button className="icon-btn" onClick={onSettings} aria-label="Settings">
          <IconGear size={18} />
        </button>
      </header>
      <main className="load-main">
        <section className="hero">
          <button className="link-back" onClick={onExit}>
            <IconChevronLeft size={14} /> Back to the start
          </button>
          <h1>
            Draft &amp; build. <span className="accent">Build the best 40.</span>
          </h1>
          <p className="hero-sub">For a paper Grid or Winston draft of your cube with a friend: track your pool as you draft, get each pick called, then build the strongest 40 with its reasons — and a coach to argue with.</p>
        </section>

        <section className="load-section">
          <h2 className="section-h">Start a draft</h2>
          <div className="cube-grid">
            {DRAFT_CUBES.map((c) => (
              <button key={c.id} className="cube-tile" onClick={() => onCreate(c)}>
                <span className={cx('cube-art', `art-${c.accent}`)} aria-hidden="true">
                  <PipRow colors={[...c.accent]} />
                </span>
                <span className="cube-body">
                  <span className="cube-title">{c.title}</span>
                  <span className="cube-blurb">{c.blurb}</span>
                  <span className="cube-meta">
                    <span>{c.size} cards</span>
                    {c.labData !== false && <span>Lab data</span>}
                  </span>
                </span>
                <span className="sample-go">
                  <IconPlus size={18} />
                </span>
              </button>
            ))}
          </div>
        </section>

        {OWNED_DECKS.length > 0 && (
          <section className="load-section">
            <h2 className="section-h">Build from a deck you own</h2>
            <div className="cube-grid">
              {OWNED_DECKS.map((c) => (
                <button key={c.id} className="cube-tile" onClick={() => onCreate(c)}>
                  <span className={cx('cube-art', `art-${c.accent}`)} aria-hidden="true">
                    <PipRow colors={[...c.accent]} />
                  </span>
                  <span className="cube-body">
                    <span className="cube-title">{c.title}</span>
                    <span className="cube-blurb">{c.blurb}</span>
                    <span className="cube-meta">
                      <span>{c.size} cards</span>
                      <span>The whole list</span>
                    </span>
                  </span>
                  <span className="sample-go">
                    <IconPlus size={18} />
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="load-section">
          <h2 className="section-h">Your pools</h2>
          {pools.length === 0 ? (
            <p className="muted small">No pools yet. Start a draft above — pools stay in this browser.</p>
          ) : (
            <div className="pool-list">
              {pools.map((p) => (
                <div key={p.id} className="pool-row">
                  <button className="pool-open" onClick={() => onOpen(p.id)}>
                    <span className="pool-name">{p.name}</span>
                    <span className="pool-sub muted">
                      {cubeInfo(p.cubeId)?.title ?? p.cubeId} · {p.cards.length} cards{p.format ? ` · ${p.format === 'grid' ? 'Grid' : 'Winston'}` : ''} · {new Date(p.updatedAt).toLocaleDateString()}
                    </span>
                    <IconArrowRight size={16} />
                  </button>
                  {confirm === p.id ? (
                    <button className="btn btn-stop btn-sm" onClick={() => onDelete(p.id)}>
                      Delete
                    </button>
                  ) : (
                    <button className="icon-btn" onClick={() => setConfirm(p.id)} aria-label={`Delete ${p.name}`}>
                      <IconTrash size={15} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
      <footer className="load-foot muted tiny">Pools and imported lab data stay in this browser. Card data and images from Scryfall.</footer>
    </div>
  );
}

function Workspace({
  pool,
  tab,
  onTab,
  onChange,
  onBack,
  onSettings,
}: {
  pool: SavedPool;
  tab: Tab;
  onTab: (t: Tab) => void;
  onChange: (p: SavedPool) => void;
  onBack: () => void;
  onSettings: () => void;
}) {
  const data = useCubeData(pool.cubeId);
  const [info, setInfo] = useState<string | null>(null);
  const [metaOpen, setMetaOpen] = useState(false);
  const [dropMsg, setDropMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const ctx = data.ctx;
  const pair = useMemo(() => (ctx ? poolColours(pool.cards, ctx) : ''), [ctx, pool.cards]);

  // Drop a meta.json anywhere on the page.
  const importFile = useCallback(
    async (f: File) => {
      try {
        const msg = await data.importMeta(parseMeta(JSON.parse(await f.text())));
        setDropMsg(msg ?? `Imported ${f.name}.`);
      } catch (e) {
        setDropMsg(`${f.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
      setMetaOpen(true);
    },
    [data],
  );
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (Array.from(e.dataTransfer?.types ?? []).includes('Files')) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      const f = e.dataTransfer?.files?.[0];
      if (!f) return;
      e.preventDefault();
      void importFile(f);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [importFile]);

  const metaChip = (
    <button className={cx('meta-chip', data.metaSource && 'is-on')} onClick={() => setMetaOpen(true)} title="Cube lab data">
      <IconLayers size={13} />
      {data.metaSource ? `Lab: ${data.meta?.sample?.games ?? '?'} games${data.metaSource === 'imported' ? ' (imported)' : ''}` : 'No lab data'}
    </button>
  );

  return (
    <div className="dw fx">
      <header className="dw-top">
        <button className="icon-btn" onClick={onBack} aria-label="All pools">
          <IconChevronLeft size={18} />
        </button>
        <div className="dw-title">
          {editing ? (
            <input
              autoFocus
              defaultValue={pool.name}
              aria-label="Pool name"
              onBlur={(e) => {
                setEditing(false);
                const v = e.target.value.trim();
                if (v && v !== pool.name) onChange({ ...pool, name: v, updatedAt: Date.now() });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
            />
          ) : (
            <button className="dw-name" onClick={() => setEditing(true)} title="Rename">
              {pool.name}
            </button>
          )}
          <span className="dw-sub muted">
            {data.cube?.title ?? cubeInfo(pool.cubeId)?.title}
            {pair.length === 2 && (
              <>
                {' · '}
                <PipRow colors={[...pair]} /> {colourLabel(pair)}
              </>
            )}
          </span>
        </div>
        <span className="dw-meta-top">{metaChip}</span>
        <button className="icon-btn" onClick={onSettings} aria-label="Settings">
          <IconGear size={18} />
        </button>
      </header>
      <nav className="dw-tabs" role="tablist">
        {TABS.map(([t, label]) => (
          <button key={t} role="tab" aria-selected={tab === t} className={cx('dw-tab', tab === t && 'is-on')} onClick={() => onTab(t)}>
            {label}
            {t === 'pool' && <span className="dw-tab-n">{pool.cards.length}</span>}
          </button>
        ))}
      </nav>
      <main className="dw-main">
        {data.error && <div className="banner banner-bad">{data.error}</div>}
        {!ctx ? (
          <div className="bv-wait">
            <span className="spinner" /> Loading the cube…
          </div>
        ) : (
          <>
            {!data.cardsReady && <div className="dw-note muted small">Fetching card data from Scryfall — mana values and images fill in shortly.</div>}
            {tab === 'pool' && <PoolView ctx={ctx} pool={pool} onChange={onChange} onInfo={setInfo} />}
            {tab === 'build' && <BuildView ctx={ctx} pool={pool} format={pool.format} onInfo={setInfo} onSettings={onSettings} metaChip={metaChip} />}
            {tab === 'grid' && <GridView ctx={ctx} pool={pool} onChange={onChange} onInfo={setInfo} />}
            {tab === 'winston' && <WinstonView ctx={ctx} pool={pool} onChange={onChange} onInfo={setInfo} />}
            <CardInfoSheet name={info} ctx={ctx} pool={pool.cards} onClose={() => setInfo(null)} cubeId={pool.cubeId} />
          </>
        )}
      </main>
      <MetaSheet open={metaOpen} onClose={() => (setMetaOpen(false), setDropMsg(null))} data={data} onFile={importFile} message={dropMsg} />
    </div>
  );
}

function MetaSheet({ open, onClose, data, onFile, message }: { open: boolean; onClose: () => void; data: CubeData; onFile: (f: File) => void; message: string | null }) {
  const ref = useRef<HTMLInputElement>(null);
  const m = data.meta;
  return (
    <Sheet open={open} onClose={onClose} title="Cube lab data" subtitle="What simulated drafts and games say about this cube" width={560}>
      <div className="meta-body">
        {message && <div className="notice-inline">{message}</div>}
        {m ? (
          <>
            <p className="small">
              Using <b>{data.metaSource === 'imported' ? 'your imported file' : 'the data shipped with this page'}</b>: {m.sample?.drafts ?? '?'} drafts and {m.sample?.games ?? '?'} games between Forge AIs
              {m.sample?.aiProfile ? ` (${m.sample.aiProfile})` : ''}, {Object.keys(m.cards).length} cards, {m.archetypes.length} archetypes, {m.pairs.length} card pairs.
            </p>
            <p className="small muted">
              Samples are small, so each number counts by its games: a card’s lab win rate weighs in at games ÷ (games + 80) against the page’s own estimate (a card with no games is the estimate alone), pair lifts at games ÷ (games + 20). Without the file everything still works from card text and the cube’s themes.
            </p>
          </>
        ) : (
          <p className="small">No lab data for this cube: values come from card text, mana value and the cube’s themes.</p>
        )}
        <p className="small muted">
          Import a <code>meta.json</code> from mtg-table’s cube lab (<code>tools/cubelab.sh</code>) — choose it below or drop it on the page. It replaces the shipped data for this cube in this browser.
        </p>
        <div className="meta-btns">
          <button className="btn btn-quiet" onClick={() => ref.current?.click()}>
            <IconUpload size={14} /> Import meta.json
          </button>
          {data.metaSource === 'imported' && (
            <button className="btn btn-quiet" onClick={() => void data.clearImport()}>
              <IconTrash size={14} /> Remove import
            </button>
          )}
        </div>
        <input
          ref={ref}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = '';
          }}
        />
      </div>
    </Sheet>
  );
}
