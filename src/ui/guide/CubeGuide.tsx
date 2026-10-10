/*
 * ForgeCoach — ui/guide/CubeGuide.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * "How to draft this cube": a cube's guide (src/cube/guides) laid out in the
 * endstep style — gold kicker, italic serif title, the cube in one paragraph,
 * one or two cube-lab facts read from meta.json at runtime, the archetypes as
 * quiet disclosure rows (the one your colours point to opens first), the
 * draft principles, and what the Forge AI does badly. Used by the cube page,
 * the metagame page and, in a sheet, the draft screens.
 */
import { useEffect, useMemo, useState } from 'react';
import { cubeInfo, loadShippedMeta } from '../../cube/cubes.ts';
import { archetypeColours, guideFor, matchArchetypes, type CubeGuide, type GuideArchetype } from '../../cube/guides/index.ts';
import { archetypeLab, guideLabFacts } from '../../cube/guides/lab.ts';
import type { CubeMeta } from '../../cube/meta.ts';
import { getImportedMeta } from '../../cube/metaStore.ts';
import { PipRow, SymbolText } from '../Mana.tsx';
import { Sheet } from '../Sheet.tsx';
import { cx } from '../util.ts';
import './cubeGuide.css';

const BASE = import.meta.env.BASE_URL;

/** The lab meta for a cube: the one given, else an imported file, else the shipped one (null when none). */
export function useGuideMeta(cubeId: string, given?: CubeMeta | null): CubeMeta | null {
  const [loaded, setLoaded] = useState<CubeMeta | null>(null);
  useEffect(() => {
    if (given !== undefined) return;
    setLoaded(null);
    const info = cubeInfo(cubeId);
    if (!info) return;
    let live = true;
    Promise.all([getImportedMeta(info.id).catch(() => null), loadShippedMeta(info, BASE)]).then(([imp, shipped]) => live && setLoaded(imp ?? shipped));
    return () => {
      live = false;
    };
  }, [cubeId, given]);
  return given !== undefined ? given : loaded;
}

function Text({ s }: { s: string }) {
  return <SymbolText text={s} />;
}

function Archetype({ a, meta, open, onInfo }: { a: GuideArchetype; meta: CubeMeta | null; open: boolean; onInfo?: (name: string) => void }) {
  const lab = useMemo(() => archetypeLab(meta, a), [meta, a]);
  return (
    <details className="cg-arch" open={open}>
      <summary>
        <span className="cg-arch-pips">{a.colors ? <PipRow colors={[...a.colors]} /> : <span className="cg-any">any</span>}</span>
        <span className="cg-arch-name">{a.name}</span>
        <span className="cg-arch-cols">{archetypeColours(a)}</span>
      </summary>
      <div className="cg-arch-body">
        <p className="cg-plan">
          <Text s={a.plan} />
        </p>
        <div className="cg-cards" aria-label="Key cards">
          {a.cards.map((n) =>
            onInfo ? (
              <button key={n} type="button" className="cg-card" onClick={() => onInfo(n)}>
                {n}
              </button>
            ) : (
              <span key={n} className="cg-card">
                {n}
              </span>
            ),
          )}
        </div>
        <dl className="cg-dl">
          <dt>Pick early</dt>
          <dd>
            <Text s={a.pickEarly} />
          </dd>
          <dt>Traps</dt>
          <dd>
            <Text s={a.traps} />
          </dd>
          <dt>Curve</dt>
          <dd>
            <Text s={a.curve} />
          </dd>
        </dl>
        {lab && <p className={cx('cg-lab-line', lab.thin && 'is-thin')}>{lab.text}</p>}
      </div>
    </details>
  );
}

export function CubeGuideView({
  cubeId,
  meta: given,
  colors = '',
  onInfo,
  headless = false,
}: {
  cubeId: string;
  /** The lab meta; undefined to load it here. */
  meta?: CubeMeta | null;
  /** The player's colours: their archetype opens first. */
  colors?: string;
  onInfo?: (name: string) => void;
  /** Leave out the kicker and title (a sheet has its own). */
  headless?: boolean;
}) {
  const guide: CubeGuide | null = guideFor(cubeId);
  const meta = useGuideMeta(cubeId, given);
  const lab = useMemo(() => guideLabFacts(meta), [meta]);
  const yours = useMemo(() => (guide ? (matchArchetypes(guide, colors, 1)[0]?.id ?? null) : null), [guide, colors]);
  if (!guide) return <p className="cg-none">No guide for this cube yet.</p>;
  const title = cubeInfo(cubeId)?.title ?? cubeId;
  return (
    <article className="cg">
      {!headless && (
        <header className="cg-head">
          <div className="cg-kicker">How to draft</div>
          <h2 className="cg-title">The {title}</h2>
        </header>
      )}
      <p className="cg-summary">{guide.summary}</p>

      <aside className="cg-labbox" aria-label="From the cube lab">
        <div className="cg-kicker cg-kicker-sm">From the lab</div>
        {lab ? (
          <>
            {lab.facts.map((f, i) => (
              <p key={i} className="cg-fact">
                {f}
              </p>
            ))}
            <p className="cg-caveat">{lab.caveat}</p>
          </>
        ) : (
          <p className="cg-caveat">No cube lab run for this cube yet, so there are no AI-vs-AI numbers to quote.</p>
        )}
      </aside>

      <section className="cg-sec">
        <h3 className="cg-h">
          Archetypes <span>{guide.archetypes.length}</span>
        </h3>
        <div className="cg-archs">
          {guide.archetypes.map((a) => (
            <Archetype key={a.id} a={a} meta={meta} open={a.id === yours} onInfo={onInfo} />
          ))}
        </div>
      </section>

      <section className="cg-sec">
        <h3 className="cg-h">Draft principles</h3>
        <ul className="cg-list">
          {guide.principles.valuing.map((v, i) => (
            <li key={i}>
              <Text s={v} />
            </li>
          ))}
        </ul>
        <dl className="cg-dl cg-formats">
          <dt>Grid</dt>
          <dd>{guide.principles.formats.grid}</dd>
          <dt>Winston</dt>
          <dd>{guide.principles.formats.winston}</dd>
          <dt>Booster</dt>
          <dd>{guide.principles.formats.booster}</dd>
          <dt>Splashing</dt>
          <dd>{guide.principles.splash}</dd>
        </dl>
      </section>

      <section className="cg-sec">
        <h3 className="cg-h">Playing against the bot</h3>
        <ul className="cg-list">
          {guide.forge.points.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
        {(guide.forge.flagged.all.length > 0 || guide.forge.flagged.random.length > 0) && (
          <div className="cg-flags">
            {guide.forge.flagged.all.length > 0 && (
              <p>
                <span className="cg-flag">AI:RemoveDeck:All</span> {guide.forge.flagged.all.join(' · ')}
              </p>
            )}
            {guide.forge.flagged.random.length > 0 && (
              <p>
                <span className="cg-flag is-soft">Random</span> {guide.forge.flagged.random.join(' · ')}
              </p>
            )}
            <p className="cg-caveat">Flags from Forge 2.0.14’s card scripts. “All”: Forge’s AI plays the card badly. “Random”: left out of Forge’s random decks.</p>
          </div>
        )}
      </section>
    </article>
  );
}

/** The guide in a sheet (the draft screens). */
export function CubeGuideSheet({
  open,
  onClose,
  cubeId,
  meta,
  colors,
  onInfo,
}: {
  open: boolean;
  onClose: () => void;
  cubeId: string;
  meta?: CubeMeta | null;
  colors?: string;
  onInfo?: (name: string) => void;
}) {
  const title = cubeInfo(cubeId)?.title ?? 'this cube';
  return (
    <Sheet open={open} onClose={onClose} width={720} className="fx fx-sheet cg-sheet" title={<span className="serif-title">How to draft</span>} subtitle={`The ${title}`}>
      <CubeGuideView cubeId={cubeId} meta={meta} colors={colors} onInfo={onInfo} headless />
    </Sheet>
  );
}
