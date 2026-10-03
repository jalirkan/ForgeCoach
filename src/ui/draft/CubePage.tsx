/*
 * ForgeCoach — ui/draft/CubePage.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A cube's own page (#cube/<id>), after the board game's cube gallery: an
 * italic serif title over "180 CARDS", a search, the shared layout bar
 * (Stacks / Gallery / List, grouped by CMC, type, colour or rarity), the
 * summary line with colour dots and a curve sparkline, and the cube's
 * themes and archetypes as quiet chips, and a "How to draft" tab
 * (#cube/<id>/guide) with the cube's guide. Read-only: the cube documents
 * are Justin's, edited in the repository.
 */
import { useEffect, useMemo, useState } from 'react';
import '../deck/deck.css';
import '../forge-theme.css';
import './draft.css';
import { CUBES, cubeInfo } from '../../cube/cubes.ts';
import { colourLabel } from '../../cube/colors.ts';
import { kindCounts } from '../../draft/poolView.ts';
import { prefetchCards } from '../cardData.ts';
import { IconChevronLeft } from '../Icons.tsx';
import { cx } from '../util.ts';
import { CardInfoSheet } from '../deck/sheets.tsx';
import { useCubeData } from '../deck/useCubeData.ts';
import { CubeGuideView } from '../guide/CubeGuide.tsx';
import { Collection, usePrefs, ViewBar } from './Collection.tsx';
import { ColourDots, MiniCurve } from './Pool.tsx';
import { useCubeMeta } from './useCubeMeta.ts';

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'");

export default function CubePage({ id: route, onExit }: { id: string; onExit: () => void }) {
  const [id = '', sub] = route.split('/');
  const view = sub === 'guide' ? 'guide' : 'cards';
  const info = cubeInfo(id) ?? CUBES[0]!;
  const data = useCubeData(info.id);
  const ctx = data.ctx;
  const meta = useCubeMeta(ctx);
  const [prefs, setPrefs] = usePrefs('cube-page', { layout: 'stacks', group: 'cmc', size: 96 });
  const [q, setQ] = useState('');
  const [theme, setTheme] = useState<string | null>(null);
  const [card, setCard] = useState<string | null>(null);
  const all = useMemo(() => ctx?.cube.cards.map((c) => c.name) ?? [], [ctx]);
  useEffect(() => prefetchCards(all), [all]);
  const shown = useMemo(() => {
    const nq = norm(q.trim());
    return (ctx?.cube.cards ?? []).filter((c) => (!nq || norm(c.name).includes(nq)) && (!theme || c.themes.includes(theme))).map((c) => c.name);
  }, [ctx, q, theme]);
  const kinds = meta ? kindCounts(all, meta) : null;

  return (
    <div className="fx cube-page">
      <header className="cp-top">
        <button className="link-back" onClick={onExit}>
          <IconChevronLeft size={14} /> Back
        </button>
        <nav className="cp-crumbs fx-label">
          <span>Cubes</span>
          {CUBES.map((c) => (
            <a key={c.id} href={`#cube/${c.id}${view === 'guide' ? '/guide' : ''}`} className={cx(c.id === info.id && 'is-on')}>
              {c.title.replace(/ Cube$/, '')}
            </a>
          ))}
        </nav>
      </header>
      <div className="cp-head">
        <div>
          <h1 className="cp-title">{info.title}</h1>
          <div className="fx-label cp-count">
            <b>{all.length || 180}</b> cards
          </div>
          <p className="cp-blurb">{info.blurb}</p>
        </div>
        <div className="cp-side">
          {meta && <MiniCurve names={all} meta={meta} />}
          <a className="btn-gold cp-draft" href="#draft/setup">
            Draft this cube
          </a>
        </div>
      </div>

      <nav className="cg-tabs" aria-label="Cube page">
        <a href={`#cube/${info.id}`} aria-current={view === 'cards' ? 'page' : undefined}>
          Cards
        </a>
        <a href={`#cube/${info.id}/guide`} aria-current={view === 'guide' ? 'page' : undefined}>
          How to draft
        </a>
      </nav>

      {view === 'guide' ? (
        <>
          <CubeGuideView cubeId={info.id} onInfo={setCard} headless />
          {ctx && <CardInfoSheet name={card} ctx={ctx} pool={[]} onClose={() => setCard(null)} />}
        </>
      ) : !ctx || !meta ? (
        <div className="dr-wait">
          <span className="spinner spinner-lg" />
          <p className="serif-i">{data.error ?? 'Opening the cube…'}</p>
        </div>
      ) : (
        <>
          <div className="cp-search">
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
              <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
              <path d="m16 16 4.5 4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a card by name…" aria-label="Find a card" />
          </div>
          <ViewBar prefs={prefs} onChange={setPrefs} />
          <div className="cp-sum">
            {kinds && (
              <span className="cp-kinds">
                <span>{kinds.creatures} creatures</span>
                <span>{kinds.spells} spells</span>
                <span>{kinds.lands} lands</span>
              </span>
            )}
            <ColourDots names={all} meta={meta} />
            {shown.length !== all.length && <span className="cp-showing">showing {shown.length}</span>}
          </div>
          {ctx.cube.themes.length > 0 && (
            <div className="cp-themes" role="group" aria-label="Themes">
              {ctx.cube.themes.map((t) => (
                <button key={t.code} className={cx('pill', theme === t.code && 'is-on')} onClick={() => setTheme(theme === t.code ? null : t.code)} title={t.idea}>
                  {t.name}
                </button>
              ))}
            </div>
          )}
          <Collection names={shown} meta={meta} prefs={prefs} onInfo={setCard} empty={<p className="quiet-italic center">No card matches.</p>} />
          {ctx.cube.archetypes.length > 0 && (
            <section className="cp-arch">
              <h2 className="de-h">
                Archetypes <span>{ctx.cube.archetypes.length}</span>
              </h2>
              <div className="cp-arch-list">
                {ctx.cube.archetypes.map((a, i) => (
                  <div key={i} className="cp-arch-row">
                    <span className="cp-arch-name">{a.name || colourLabel(a.colors)}</span>
                    <span className="cp-arch-plan">{a.plan}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
          <CardInfoSheet name={card} ctx={ctx} pool={[]} onClose={() => setCard(null)} />
        </>
      )}
    </div>
  );
}
