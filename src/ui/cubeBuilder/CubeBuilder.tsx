/*
 * ForgeCoach — ui/cubeBuilder/CubeBuilder.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The cube builder (#cube/new, #cube/edit/<id>): make your own cube from the
 * card library (cube/library.ts) — start empty, from a cube, or from the
 * balanced generator (cube/generate.ts) — browse and filter the library, add
 * and remove cards, and watch the summary and warnings (cube/cubeSummary.ts).
 * Saved in this browser (cube/custom.ts) and registered beside the shipped
 * cubes (cube/cubes.ts refreshCustomCubes), so Draft vs Bot, Draft & build,
 * Play vs Bot and Draft with a friend list it. Exported as a cube document
 * that opens again here; a .md document or a plain list imports.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import '../deck/deck.css';
import '../forge-theme.css';
import '../draft/draft.css';
import './cubeBuilder.css';
import { CUBES, cubeInfo, cubeShortName, loadCubeDoc, refreshCustomCubes } from '../../cube/cubes.ts';
import { accentOf, cubeMarkdown, customId, deleteCustomCube, getCustomCube, importCubeText, saveCustomCube, slugOf, type CustomCube } from '../../cube/custom.ts';
import { summarizeCube, type CubeSummary } from '../../cube/cubeSummary.ts';
import { generateCube } from '../../cube/generate.ts';
import {
  BUCKETS,
  BUCKET_LABEL,
  browse,
  bucketOf,
  KIND_LABEL,
  KIND_ORDER,
  labPct,
  libraryName,
  LIBRARY_LISTS,
  loadLibrary,
  MV_BINS,
  type CardKind,
  type Library,
  type LibraryCard,
  type LibraryFilter,
  type LibrarySort,
} from '../../cube/library.ts';
import { newSeed } from '../../draft/rng.ts';
import { downloadText } from '../DeckExport.tsx';
import { IconChevronLeft } from '../Icons.tsx';
import { PipRow } from '../Mana.tsx';
import { Sheet } from '../Sheet.tsx';
import { cx } from '../util.ts';
import { DCard } from '../draft/DCard.tsx';

const BASE = import.meta.env.BASE_URL;
const PAGE = 120;
const SIZES: Array<[number | null, string]> = [
  [180, '180'],
  [360, '360'],
  [null, 'Any'],
];
const COLOUR_CHIPS: Array<[string, string]> = [
  ['W', 'White'],
  ['U', 'Blue'],
  ['B', 'Black'],
  ['R', 'Red'],
  ['G', 'Green'],
  ['C', 'Colourless'],
  ['M', 'Multicolour'],
];
const LAB_MIN: Array<[string, string]> = [
  ['', 'Any'],
  ['0.5', '50%+'],
  ['0.55', '55%+'],
  ['0.6', '60%+'],
];
const BAR: Record<string, string> = { W: '#f3ead0', U: '#3d8be0', B: '#8a7fa8', R: '#e0473b', G: '#3fa45d' };

function sourceTitle(id: string): string {
  const c = cubeInfo(id);
  if (c) return cubeShortName(c);
  return LIBRARY_LISTS.find((l) => l.id === id)?.title ?? id;
}

/** "#cube/new", "#cube/new?from=<id>", "#cube/edit/<id>". */
function routeOf(route: string): { edit: string | null; from: string | null } {
  const m = /^edit\/([a-z0-9-]+)/.exec(route);
  if (m?.[1]) return { edit: m[1], from: null };
  const q = new URLSearchParams(route.split('?')[1] ?? '');
  return { edit: null, from: q.get('from') };
}

export default function CubeBuilder({ route, onExit }: { route: string; onExit: () => void }) {
  const r = routeOf(route);
  const [lib, setLib] = useState<Library | null>(null);
  const [libError, setLibError] = useState<string | null>(null);
  const existing = useMemo(() => (r.edit ? getCustomCube(r.edit) : undefined), [r.edit]);
  const createdAt = useRef(existing?.createdAt ?? null);
  const [savedId, setSavedId] = useState<string | null>(existing?.id ?? null);
  const [title, setTitle] = useState(existing?.title ?? 'My cube');
  const [blurb, setBlurb] = useState(existing?.blurb ?? '');
  const [target, setTarget] = useState<number | null>(existing ? existing.target : 180);
  const [cards, setCards] = useState<string[]>(existing?.cards ?? []);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<string | null>(r.edit && !existing ? 'That cube isn’t saved in this browser. Here is a new one.' : null);
  const [pane, setPane] = useState<'library' | 'cube'>('library');
  const [card, setCard] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    loadLibrary(BASE)
      .then((l) => live && setLib(l))
      .catch((e: unknown) => live && setLibError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, []);

  // #cube/new?from=<id>: start from that cube.
  useEffect(() => {
    if (!lib || !r.from || cards.length) return;
    void startFrom(r.from);
  }, [lib]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const inCube = useMemo(() => new Set(cards), [cards]);
  const summary = useMemo(() => (lib ? summarizeCube(cards, lib, target) : null), [cards, lib, target]);

  const change = (next: string[]) => {
    setCards(next);
    setDirty(true);
  };
  const toggle = (name: string) => change(inCube.has(name) ? cards.filter((n) => n !== name) : [...cards, name]);

  async function startFrom(id: string) {
    const info = cubeInfo(id);
    if (!info || !lib) return;
    try {
      const cube = await loadCubeDoc(info, BASE);
      const names = [...new Set(cube.cards.map((c) => libraryName(lib, c.name)).filter((n): n is string => !!n))];
      change(names);
      setTitle(`${cubeShortName(info)}, my version`);
      setBlurb(info.blurb);
      setTarget(info.size === 180 || info.size === 360 ? info.size : null);
      setMsg(`Started from ${info.title}: ${names.length} cards.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }

  const save = () => {
    if (!lib) return;
    const docCards = cards.map((n) => lib.byName.get(n)).filter((c): c is LibraryCard => !!c);
    const id = savedId ?? customId(title, CUBES.map((c) => c.id));
    const now = Date.now();
    const cube: CustomCube = {
      id,
      title: title.trim() || 'My cube',
      blurb: blurb.trim(),
      target,
      cards: docCards.map((c) => c.name),
      doc: cubeMarkdown({ title: title.trim() || 'My cube', blurb, cards: docCards, date: new Date(now).toISOString().slice(0, 10) }),
      accent: accentOf(docCards),
      createdAt: createdAt.current ?? now,
      updatedAt: now,
    };
    if (!saveCustomCube(cube)) {
      setMsg('This browser wouldn’t keep it (a private window, or storage is full): export it as a file instead.');
      return;
    }
    refreshCustomCubes();
    createdAt.current = cube.createdAt;
    setSavedId(id);
    setDirty(false);
    setMsg(`Saved: ${cube.title}, ${cube.cards.length} cards. It is in every cube list now, marked yours.`);
    if (!r.edit) history.replaceState(null, '', `#cube/edit/${id}`);
  };

  const exportDoc = () => {
    if (!lib) return;
    const docCards = cards.map((n) => lib.byName.get(n)).filter((c): c is LibraryCard => !!c);
    downloadText(`${slugOf(title)}-${docCards.length}.md`, cubeMarkdown({ title, blurb, cards: docCards, date: new Date().toISOString().slice(0, 10) }), 'text/markdown');
  };

  const importFile = async (f: File) => {
    if (!lib) return;
    const res = importCubeText(await f.text(), lib);
    const fresh = res.cards.filter((n) => !inCube.has(n));
    change([...cards, ...fresh]);
    if (res.title && !cards.length) setTitle(res.title);
    const parts = [`${f.name}: ${fresh.length} added`];
    if (res.cards.length > fresh.length) parts.push(`${res.cards.length - fresh.length} already in`);
    if (res.unknown.length) parts.push(`${res.unknown.length} not in the library (${res.unknown.slice(0, 4).join(', ')}${res.unknown.length > 4 ? ', …' : ''})`);
    if (res.basics) parts.push(`${res.basics} basic lands left out (they are free)`);
    setMsg(`${parts.join(' · ')}.`);
  };

  const remove = () => {
    if (!savedId || !confirm(`Delete ${title}? Drafts already started keep their cards.`)) return;
    deleteCustomCube(savedId);
    refreshCustomCubes();
    setDirty(false);
    location.hash = '#cube/new';
  };

  if (libError) return <Wait text={libError} onExit={onExit} />;
  if (!lib || !summary) return <Wait text="Opening the card library…" onExit={onExit} />;

  return (
    <div className={cx('fx cb', `is-pane-${pane}`)}>
      <header className="cp-top">
        <button className="link-back" onClick={onExit}>
          <IconChevronLeft size={14} /> Back
        </button>
        <nav className="cp-crumbs fx-label" aria-label="Cubes">
          <span>Cubes</span>
          <a href={`#cube/${CUBES[0]?.id ?? 'synergy'}`}>The cubes</a>
          <span className="cb-crumb-on">{savedId ? 'Edit your cube' : 'New cube'}</span>
        </nav>
      </header>

      <div className="cb-head">
        <div className="cb-names">
          <input className="cb-title" value={title} onChange={(e) => (setTitle(e.target.value), setDirty(true))} aria-label="Cube name" maxLength={60} />
          <input className="cb-blurb" value={blurb} onChange={(e) => (setBlurb(e.target.value), setDirty(true))} aria-label="Short description" placeholder="One line on what it is for" maxLength={160} />
        </div>
        <div className="cb-actions">
          <button className="btn-gold" onClick={save} disabled={!cards.length} data-cb-save="">
            {savedId ? 'Save' : 'Save cube'}
          </button>
          <button className="btn-line" onClick={exportDoc} disabled={!cards.length}>
            Export .md
          </button>
          <button className="btn-line" onClick={() => fileRef.current?.click()}>
            Import
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".md,.txt,.dck,text/plain,text/markdown"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importFile(f);
              e.target.value = '';
            }}
          />
          {savedId && !dirty && (
            <a className="btn-line cb-draft" href={`#draft/setup?cube=${savedId}`}>
              Draft it
            </a>
          )}
          {savedId && (
            <button className="btn-line is-danger" onClick={remove}>
              Delete
            </button>
          )}
        </div>
      </div>
      <p className={cx('cb-msg', !msg && 'is-empty')} role="status">
        {msg ?? (dirty ? 'Not saved yet.' : savedId ? 'Saved in this browser.' : ' ')}
      </p>

      <div className="seg2 cb-panes" role="tablist" aria-label="Show">
        <button role="tab" aria-selected={pane === 'library'} className={cx(pane === 'library' && 'is-on')} onClick={() => setPane('library')}>
          Library
        </button>
        <button role="tab" aria-selected={pane === 'cube'} className={cx(pane === 'cube' && 'is-on')} onClick={() => setPane('cube')}>
          Your cube · {summary.count}
        </button>
      </div>

      <div className="cb-grid">
        <section className="cb-lib" aria-label="The card library">
          {!cards.length && <StartPanel lib={lib} target={target} onCards={(names, note) => (change(names), setMsg(note))} onFrom={(id) => void startFrom(id)} />}
          <LibraryBrowser lib={lib} inCube={inCube} onToggle={toggle} onInfo={setCard} />
        </section>
        <section className="cb-cube" aria-label="Your cube">
          <SizePicker target={target} onChange={(t) => (setTarget(t), setDirty(true))} />
          <SummaryView s={summary} />
          <CubeList lib={lib} cards={cards} onRemove={toggle} onInfo={setCard} onClear={() => confirm('Take every card out?') && change([])} />
        </section>
      </div>

      <CardSheet lib={lib} name={card} inCube={card ? inCube.has(card) : false} onToggle={toggle} onClose={() => setCard(null)} />
    </div>
  );
}

function Wait({ text, onExit }: { text: string; onExit: () => void }) {
  return (
    <div className="fx cb">
      <header className="cp-top">
        <button className="link-back" onClick={onExit}>
          <IconChevronLeft size={14} /> Back
        </button>
      </header>
      <div className="dr-wait">
        <span className="spinner spinner-lg" />
        <p className="serif-i">{text}</p>
      </div>
    </div>
  );
}

function SizePicker({ target, onChange }: { target: number | null; onChange: (t: number | null) => void }) {
  return (
    <div className="cb-size">
      <span className="fx-label">Size</span>
      <div className="seg2" role="radiogroup" aria-label="Size">
        {SIZES.map(([v, l]) => (
          <button key={l} role="radio" aria-checked={target === v} className={cx(target === v && 'is-on')} onClick={() => onChange(v)}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Starting a cube

function StartPanel({ lib, target, onCards, onFrom }: { lib: Library; target: number | null; onCards: (names: string[], note: string) => void; onFrom: (id: string) => void }) {
  const [from, setFrom] = useState(CUBES[0]?.id ?? '');
  const [size, setSize] = useState(String(target ?? 180));
  const [seed, setSeed] = useState(() => String(newSeed() % 100000));
  const [byLab, setByLab] = useState(true);
  const [forgeOnly, setForgeOnly] = useState(true);
  const [avoid, setAvoid] = useState(true);
  const [source, setSource] = useState('');
  useEffect(() => setSize(String(target ?? 180)), [target]);
  const sources = useSources(lib);
  const go = () => {
    const n = Math.max(9, Math.min(1000, Math.floor(Number(size) || 180)));
    const s = Math.floor(Number(seed)) || 1;
    const g = generateCube(lib, { size: n, seed: s, rating: byLab ? 'lab' : 'none', forgeOnly, avoidAiBad: avoid, sources: source ? [source] : [] });
    onCards(g.cards, [`Generated ${g.cards.length} cards (seed ${s}${byLab ? ', by lab rating' : ''}).`, ...g.notes].join(' '));
  };
  return (
    <div className="panel cb-start">
      <div className="fx-label panel-h">Start</div>
      <p className="cb-start-p">Add cards from the library below, or start from a cube you have:</p>
      <div className="cb-row">
        <select value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Start from cube">
          {CUBES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
              {c.custom ? ' (yours)' : ''} · {c.size}
            </option>
          ))}
        </select>
        <button className="btn-line" onClick={() => onFrom(from)}>
          Start from it
        </button>
      </div>
      <details className="cb-gen" open>
        <summary>Generate a balanced cube</summary>
        <p className="tiny muted">Omega’s shape: 24 cards a colour, 2 gold a pair, 18 colourless, 22 lands at 180, on Omega’s curve. The same seed makes the same cube.</p>
        <div className="cb-gen-grid">
          <label>
            <span className="fx-label">Cards</span>
            <input inputMode="numeric" value={size} onChange={(e) => setSize(e.target.value.replace(/\D/g, ''))} aria-label="Cards" />
          </label>
          <label>
            <span className="fx-label">Seed</span>
            <input inputMode="numeric" value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, ''))} aria-label="Seed" />
          </label>
          <label>
            <span className="fx-label">From</span>
            <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Generate from">
              <option value="">The whole library</option>
              {sources.map(([id, t]) => (
                <option key={id} value={id}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="cb-check">
          <input type="checkbox" checked={byLab} onChange={(e) => setByLab(e.target.checked)} /> Prefer the cards the lab rates higher
        </label>
        <label className="cb-check">
          <input type="checkbox" checked={forgeOnly} onChange={(e) => setForgeOnly(e.target.checked)} /> Only cards Forge has
        </label>
        <label className="cb-check">
          <input type="checkbox" checked={avoid} onChange={(e) => setAvoid(e.target.checked)} /> Leave out cards the bot plays badly
        </label>
        <button className="btn-gold" onClick={go} data-cb-generate="">
          Generate
        </button>
      </details>
    </div>
  );
}

function useSources(lib: Library): Array<[string, string]> {
  return useMemo(() => lib.sources.map((s) => [s.id, `${sourceTitle(s.id)} (${s.cards})`] as [string, string]), [lib]);
}

// ---------------------------------------------------------------------------
// The library

function LibraryBrowser({ lib, inCube, onToggle, onInfo }: { lib: Library; inCube: Set<string>; onToggle: (n: string) => void; onInfo: (n: string) => void }) {
  const [f, setF] = useState<LibraryFilter>({ forgeOnly: false });
  const [sort, setSort] = useState<LibrarySort>('name');
  const [shown, setShown] = useState(PAGE);
  const sources = useSources(lib);
  const set = (p: Partial<LibraryFilter>) => {
    setF((x) => ({ ...x, ...p }));
    setShown(PAGE);
  };
  const rows = useMemo(() => browse(lib, f, sort), [lib, f, sort]);
  const colours = f.colors ?? [];
  return (
    <div className="cb-browser">
      <div className="cp-search">
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
          <path d="m16 16 4.5 4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
        <input value={f.q ?? ''} onChange={(e) => set({ q: e.target.value })} placeholder={`Find a card in ${lib.cards.length}…`} aria-label="Find a card" />
      </div>
      <div className="cb-filters">
        <div className="cb-chips" role="group" aria-label="Colour">
          {COLOUR_CHIPS.map(([k, l]) => (
            <button key={k} className={cx('pill', colours.includes(k) && 'is-on')} aria-pressed={colours.includes(k)} title={l} onClick={() => set({ colors: colours.includes(k) ? colours.filter((x) => x !== k) : [...colours, k] })}>
              {k === 'C' || k === 'M' ? l : <PipRow colors={[k]} />}
            </button>
          ))}
        </div>
        <div className="cb-selects">
          <select value={f.kind ?? ''} onChange={(e) => set({ kind: (e.target.value || null) as CardKind | null })} aria-label="Type">
            <option value="">Any type</option>
            {KIND_ORDER.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
          <select value={f.mv ?? ''} onChange={(e) => set({ mv: e.target.value === '' ? null : Number(e.target.value) })} aria-label="Mana value">
            <option value="">Any mana value</option>
            {MV_BINS.map((b, i) => (
              <option key={b} value={i}>
                Mana value {b}
              </option>
            ))}
          </select>
          <select value={f.source ?? ''} onChange={(e) => set({ source: e.target.value || null })} aria-label="From">
            <option value="">From any cube or list</option>
            {sources.map(([id, t]) => (
              <option key={id} value={id}>
                {t}
              </option>
            ))}
          </select>
          <select value={f.minLab === null || f.minLab === undefined ? '' : String(f.minLab)} onChange={(e) => set({ minLab: e.target.value ? Number(e.target.value) : null })} aria-label="Lab win rate">
            {LAB_MIN.map(([v, l]) => (
              <option key={v} value={v}>
                Lab rating {l}
              </option>
            ))}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as LibrarySort)} aria-label="Sort">
            <option value="name">By name</option>
            <option value="lab">By lab rating</option>
            <option value="mv">By mana value</option>
          </select>
        </div>
        <label className="cb-check">
          <input type="checkbox" checked={!!f.forgeOnly} onChange={(e) => set({ forgeOnly: e.target.checked })} /> Only cards Forge has
        </label>
      </div>
      <p className="cb-count tiny muted">
        {rows.length} of {lib.cards.length} cards
      </p>
      <ul className="cb-rows">
        {rows.slice(0, shown).map((c) => (
          <CardRow key={c.name} c={c} on={inCube.has(c.name)} onToggle={onToggle} onInfo={onInfo} />
        ))}
      </ul>
      {rows.length > shown && (
        <button className="btn-wide" onClick={() => setShown(shown + PAGE)}>
          Show {Math.min(PAGE, rows.length - shown)} more
        </button>
      )}
      {!rows.length && <p className="quiet-italic center">No card matches.</p>}
    </div>
  );
}

function Flags({ c }: { c: LibraryCard }) {
  return (
    <>
      {c.forge === false && (
        <span className="cb-flag is-stop" title="Forge has no script for this card">
          not in Forge
        </span>
      )}
      {c.forge === null && (
        <span className="cb-flag" title="Not known whether Forge has this card">
          Forge?
        </span>
      )}
      {c.ai === 'All' && (
        <span className="cb-flag" title="Forge’s AI plays it badly (AI:RemoveDeck:All)">
          bot plays it badly
        </span>
      )}
    </>
  );
}

function CardRow({ c, on, onToggle, onInfo }: { c: LibraryCard; on: boolean; onToggle: (n: string) => void; onInfo: (n: string) => void }) {
  const pct = labPct(c);
  return (
    <li className={cx('cb-card', on && 'is-in')} data-card={c.name}>
      <span className={cx('cb-pips', !c.colors && c.produces && 'is-land')} title={!c.colors && c.produces ? `Makes ${c.produces}` : undefined}>
        {c.colors ? <PipRow colors={[...c.colors]} /> : c.produces ? <PipRow colors={[...c.produces].slice(0, 3)} /> : <span className="cb-nopip" />}
      </span>
      <button className="cb-name" onClick={() => onInfo(c.name)}>
        {c.name}
      </button>
      <span className="cb-type">{(c.type.split(' — ')[0] ?? '').replace(/^Legendary /, '')}</span>
      <span className="cb-mv">{c.type.includes('Land') && c.mv === 0 ? '' : c.mv}</span>
      <span className="cb-lab" title={c.lab ? `${c.lab.games} lab games` : 'No lab games'}>
        {pct === null ? '—' : `${pct.toFixed(1)}%`}
      </span>
      <span className="cb-flags">
        <Flags c={c} />
      </span>
      <button className={cx('cb-add', on && 'is-on')} onClick={() => onToggle(c.name)} aria-label={on ? `Take ${c.name} out` : `Add ${c.name}`}>
        {on ? '✓' : '+'}
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// The cube

function SummaryView({ s }: { s: CubeSummary }) {
  const maxC = Math.max(1, ...Object.values(s.perColour));
  const maxCurve = Math.max(3, ...s.curve);
  return (
    <div className="panel cb-sum" data-cb-summary="">
      <div className="cb-count-big">
        <b data-cb-count="">{s.count}</b>
        {s.target !== null ? <span> of {s.target}</span> : <span> cards</span>}
      </div>
      <div className="cb-sum-grid">
        <div>
          <div className="fx-label sub-h">Each colour can play</div>
          {(['W', 'U', 'B', 'R', 'G'] as const).map((k) => (
            <div key={k} className="cb-bar">
              <PipRow colors={[k]} />
              <span className="cb-bar-track">
                <span style={{ width: `${(s.perColour[k] / maxC) * 100}%`, background: BAR[k] }} />
              </span>
              <b>{s.perColour[k]}</b>
            </div>
          ))}
        </div>
        <div>
          <div className="fx-label sub-h">Curve (nonland)</div>
          <span className="mcurve cb-curve" aria-label={`Curve: ${s.curve.join(', ')}`}>
            {s.curve.map((n, i) => (
              <span key={i} className="mcurve-col">
                <b>{n || ''}</b>
                <span className="mcurve-bar" style={{ height: `${Math.max(1, (n / maxCurve) * 40)}px` }} />
                <span className="mcurve-l">{MV_BINS[i]}</span>
              </span>
            ))}
          </span>
          <div className="cb-facts">
            <span>{s.multicolour} multicolour</span>
            <span>
              {s.lands} lands · {s.fixing} fixing
            </span>
            <span>{s.avgLab === null ? 'no lab numbers' : `lab average ${(s.avgLab * 100).toFixed(1)}% over ${s.rated}`}</span>
          </div>
        </div>
      </div>
      <div className="cb-kinds">
        {KIND_ORDER.filter((k) => s.kinds[k] > 0).map((k) => (
          <span key={k}>
            {s.kinds[k]} {KIND_LABEL[k].toLowerCase()}
          </span>
        ))}
      </div>
      {s.warnings.length > 0 && (
        <ul className="cb-warn" aria-label="Warnings">
          {s.warnings.map((w, i) => (
            <li key={i} className={`is-${w.level}`} data-warning={w.kind}>
              {w.text}
            </li>
          ))}
        </ul>
      )}
      <p className="tiny muted cb-lab-note">Lab ratings are Forge-vs-Forge win rates from the cubes each card was measured in: a card that won in a weaker cube can rate above one that held its own in a stronger one. Your cube has no lab data of its own.</p>
    </div>
  );
}

function CubeList({ lib, cards, onRemove, onInfo, onClear }: { lib: Library; cards: string[]; onRemove: (n: string) => void; onInfo: (n: string) => void; onClear: () => void }) {
  const groups = useMemo(() => {
    const g = new Map<string, LibraryCard[]>();
    for (const n of cards) {
      const c = lib.byName.get(n);
      if (!c) continue;
      const b = bucketOf(c);
      g.set(b, [...(g.get(b) ?? []), c]);
    }
    for (const v of g.values()) v.sort((a, b) => a.mv - b.mv || a.name.localeCompare(b.name));
    return BUCKETS.filter((b) => g.has(b)).map((b) => [b, g.get(b)!] as const);
  }, [lib, cards]);
  if (!cards.length) return <p className="quiet-italic center cb-empty">No cards yet. Add them from the library, or start from a cube.</p>;
  return (
    <div className="cb-list">
      {groups.map(([b, cs]) => (
        <div key={b} className="cb-group">
          <h3 className="de-h">
            {BUCKET_LABEL[b]} <span>{cs.length}</span>
          </h3>
          <ul>
            {cs.map((c) => (
              <li key={c.name} className="cb-in">
                <span className="cb-mv">{b === 'land' ? '' : c.mv}</span>
                <button className="cb-name" onClick={() => onInfo(c.name)}>
                  {c.name}
                </button>
                <Flags c={c} />
                <button className="cb-x" onClick={() => onRemove(c.name)} aria-label={`Take ${c.name} out`}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <button className="btn-line is-danger cb-clear" onClick={onClear}>
        Take every card out
      </button>
    </div>
  );
}

function CardSheet({ lib, name, inCube, onToggle, onClose }: { lib: Library; name: string | null; inCube: boolean; onToggle: (n: string) => void; onClose: () => void }) {
  const c = name ? lib.byName.get(name) : undefined;
  return (
    <Sheet open={!!c} onClose={onClose} width={520} className="fx fx-sheet" title={<span className="serif-title">{c?.name}</span>} subtitle={c?.type}>
      {c && (
        <div className="cb-sheet">
          <DCard name={c.name} big />
          <div className="cb-sheet-facts">
            <p>
              <span className="fx-label">From</span> {c.sources.map(sourceTitle).join(', ')}
            </p>
            <p>
              <span className="fx-label">Lab</span>{' '}
              {c.lab ? `${(c.lab.winRate * 100).toFixed(1)}% over ${c.lab.games} games (${c.lab.cubes.map(sourceTitle).join(', ')})` : 'not played by the lab'}
            </p>
            {c.forge === false && <p className="cb-flag is-stop">Forge has no script for it: the bot never plays it.</p>}
            {c.forge === null && <p className="cb-flag">Not known whether Forge has it.</p>}
            {c.ai && <p className="cb-flag">{c.ai === 'All' ? 'Forge’s AI plays it badly (AI:RemoveDeck:All).' : 'Forge leaves it out of random decks (AI:RemoveDeck:Random).'}</p>}
            <button className={inCube ? 'btn-line is-danger' : 'btn-gold'} onClick={() => onToggle(c.name)}>
              {inCube ? 'Take it out' : 'Add to the cube'}
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
