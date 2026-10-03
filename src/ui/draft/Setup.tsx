/*
 * ForgeCoach — ui/draft/Setup.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The two set-up screens of a draft against the AI, after the board game's
 * match setup: options as small labelled segmented toggles on the left, the
 * two seats facing each other with an italic "vs", and one big gold button.
 *
 *   DraftSetup — choose the cube, Grid or Winston, who opens, hints.
 *   MatchSetup — after the build: your deck vs the AI's (name and count only:
 *                its list stays hidden), the cards the AI can't pilot well,
 *                the AI profile, Bo1/Bo3, and Begin, which asks mtg-table's
 *                match launcher to deal the match.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CUBES, cubeInfo, type CubeInfo } from '../../cube/cubes.ts';
import { colourLabel } from '../../cube/colors.ts';
import type { DeckBuild } from '../../cube/builder.ts';
import type { CubeMeta } from '../../cube/meta.ts';
import { aiFlagsFromDoc, noFlags, withMetaFlags, type AiFlags } from '../../draft/aiFlags.ts';
import { progress, type Draft, type Format } from '../../draft/draft.ts';
import { AI_PROFILES, deckSize, launchMatch, matchDeck, matchSupported, type AiProfile } from '../../draft/launch.ts';
import type { DraftAfter } from '../../draft/store.ts';
import { prefetchCards, useCardInfo } from '../cardData.ts';
import { IconChevronLeft } from '../Icons.tsx';
import { PipRow } from '../Mana.tsx';
import { cx } from '../util.ts';

const BASE = import.meta.env.BASE_URL;

/** A signature card per cube, for the tile's art. */
export const CUBE_ART: Record<string, string> = {
  synergy: 'Mayhem Devil',
  'modern-era': 'Snapcaster Mage',
  vintage: 'Black Lotus',
  pauper: 'Ninja of the Deep Hours',
};

function Seg<T extends string | number | boolean>({ value, options, onChange, label }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg2" role="radiogroup" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={String(v)} role="radio" aria-checked={value === v} className={cx(value === v && 'is-on')} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <div className="fx-label field-l">{label}</div>
      {children}
    </div>
  );
}

function CubeArt({ cube }: { cube: CubeInfo }) {
  const info = useCardInfo(CUBE_ART[cube.id]);
  const art = info?.image?.artCrop ?? info?.faces?.[0]?.image?.artCrop;
  return (
    <span className={cx('ctile-art', `art-${cube.accent}`)} aria-hidden="true">
      {art && <img src={art} alt="" loading="lazy" draggable={false} />}
      <span className="ctile-pips">
        <PipRow colors={[...cube.accent]} />
      </span>
    </span>
  );
}

export function DraftSetup({
  resume,
  onResume,
  onAbandon,
  onBegin,
  onExit,
  onPaper,
  hints,
}: {
  resume: Draft | null;
  onResume: () => void;
  onAbandon: () => void;
  onBegin: (o: { cubeId: string; format: Format; youFirst: boolean; hints: boolean }) => void;
  onExit: () => void;
  onPaper: () => void;
  hints: boolean;
}) {
  const [cubeId, setCubeId] = useState(CUBES[0]?.id ?? 'synergy');
  const [format, setFormat] = useState<Format>('winston');
  const [first, setFirst] = useState<'you' | 'ai' | 'toss'>('toss');
  const [hintsOn, setHintsOn] = useState(hints);
  useEffect(() => prefetchCards(Object.values(CUBE_ART)), []);
  const begin = () => onBegin({ cubeId, format, youFirst: first === 'toss' ? Math.random() < 0.5 : first === 'you', hints: hintsOn });
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLInputElement)) begin();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });
  const cube = cubeInfo(cubeId);
  return (
    <div className="fx setup">
      <header className="setup-top">
        <button className="link-back" onClick={onExit}>
          <IconChevronLeft size={14} /> Home
        </button>
        <div className="fx-label setup-kicker">Draft vs AI</div>
        <button className="link-back is-right" onClick={onPaper}>
          Paper draft helper
        </button>
      </header>
      <h1 className="setup-hero">
        Draft a cube <em>against the AI.</em>
      </h1>
      <p className="setup-sub">Two seats, one cube. The cube lab’s drafter takes the other seat; then you both build forty and play it out.</p>

      {resume && !resume.done && (
        <div className="resume">
          <div>
            <div className="fx-label">Draft in progress</div>
            <div className="resume-t">
              <i>{cubeInfo(resume.cubeId)?.title}</i> · {resume.format === 'grid' ? 'Grid' : 'Winston'} · {progress(resume).label} · {resume.picks.you.length} cards
            </div>
          </div>
          <div className="resume-btns">
            <button className="btn-line is-danger" onClick={onAbandon}>
              Abandon
            </button>
            <button className="btn-gold" onClick={onResume}>
              Resume
            </button>
          </div>
        </div>
      )}

      <div className="setup-grid">
        <aside className="panel setup-opts">
          <div className="fx-label panel-h">Draft</div>
          <Field label="Format">
            <div className="opt-tiles">
              {(
                [
                  ['winston', 'Winston', '90 cards, three face-down piles. Take a pile or pass it on.'],
                  ['grid', 'Grid', '18 grids of nine, face up. Take a row or a column.'],
                ] as Array<[Format, string, string]>
              ).map(([f, t, d]) => (
                <button key={f} className={cx('opt-tile', format === f && 'is-on')} onClick={() => setFormat(f)} aria-pressed={format === f}>
                  <span className="opt-t">{t}</span>
                  <span className="opt-d">{d}</span>
                </button>
              ))}
            </div>
          </Field>
          <Field label="First pick">
            <Seg
              label="First pick"
              value={first}
              onChange={setFirst}
              options={[
                ['you', 'You'],
                ['toss', 'Coin toss'],
                ['ai', 'AI'],
              ]}
            />
          </Field>
          <Field label="Hints">
            <Seg
              label="Hints"
              value={hintsOn}
              onChange={setHintsOn}
              options={[
                [false, 'Off'],
                [true, 'On'],
              ]}
            />
          </Field>
          <p className="quiet-italic small">Hints mark the pick helper’s choice with a soft glow. The coach is one tap away either way.</p>
        </aside>

        <section className="panel setup-cubes">
          <div className="fx-label panel-h">The cube</div>
          <div className="ctiles">
            {CUBES.map((c) => (
              <button key={c.id} className={cx('ctile', cubeId === c.id && 'is-on')} onClick={() => setCubeId(c.id)} aria-pressed={cubeId === c.id}>
                <CubeArt cube={c} />
                <span className="ctile-body">
                  <span className="ctile-t">{c.title}</span>
                  <span className="ctile-d">{c.blurb}</span>
                  <span className="ctile-m">180 cards · lab data</span>
                </span>
              </button>
            ))}
          </div>
        </section>

        <aside className="panel setup-opp">
          <div className="fx-label panel-h center">Opponent · Bot</div>
          <span className="avatar is-bot lg">
            <span>AI</span>
          </span>
          <div className="seat-name">Forge AI</div>
          <p className="setup-oppd">
            The cube lab’s drafter: it rates cards from the lab’s games, follows the cube’s themes, commits to two colours a third of the way in, and splashes only with fixing.
          </p>
          <ul className="setup-facts">
            <li>
              <span className="fx-label">Cube</span> <i>{cube?.title}</i>
            </li>
            <li>
              <span className="fx-label">Format</span> {format === 'grid' ? 'Grid · 18 rounds' : 'Winston · 90 cards'}
            </li>
            <li>
              <span className="fx-label">Opens</span> {first === 'toss' ? 'coin toss' : first === 'you' ? 'you' : 'the AI'}
            </li>
          </ul>
        </aside>
      </div>

      <footer className="setup-foot">
        <button className="btn-close" onClick={onExit}>
          Leave
          <small>back to the start page</small>
        </button>
        <button className="btn-begin" onClick={begin}>
          Begin the draft <kbd>⏎</kbd>
        </button>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------

function useAiFlags(cubeId: string, meta: CubeMeta | null, names: string[]): AiFlags {
  const [flags, setFlags] = useState<AiFlags>(noFlags);
  useEffect(() => {
    const info = cubeInfo(cubeId);
    if (!info) return;
    let live = true;
    fetch(`${BASE}cubes/${info.file}.md`)
      .then((r) => (r.ok ? r.text() : ''))
      .then((t) => live && setFlags(withMetaFlags(aiFlagsFromDoc(t, names), meta)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [cubeId, meta, names]);
  return flags;
}

export function MatchSetup({
  draft,
  build,
  after,
  known,
  meta,
  cubeNames,
  onBack,
  onAbandon,
}: {
  draft: Draft;
  build: DeckBuild | null;
  after: DraftAfter | undefined;
  known: string[];
  meta: CubeMeta | null;
  cubeNames: string[];
  onBack: () => void;
  onAbandon: () => void;
}) {
  const [profile, setProfile] = useState<AiProfile>('Default');
  const [games, setGames] = useState<1 | 3>(3);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const flags = useAiFlags(draft.cubeId, meta, cubeNames);
  const cube = cubeInfo(draft.cubeId);
  const yours = useMemo(() => (build ? matchDeck(`My ${cube?.title ?? 'cube'} draft — ${build.name}`, build, draft.picks.you) : null), [build, draft, cube]);
  const ai = after?.aiDeck ?? null;

  useEffect(() => {
    let live = true;
    const check = () => matchSupported().then((ok) => live && setSupported(ok));
    void check();
    const t = setInterval(check, 8000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  // The AI's cards it can't pilot well: named only when you know it holds them.
  const weak = useMemo(() => {
    const inDeck = new Set((ai?.main ?? []).map(([, n]) => n));
    const flagged = [...flags.all].filter((n) => inDeck.has(n));
    const knownSet = new Set(known);
    return { named: flagged.filter((n) => knownSet.has(n)), unnamed: flagged.filter((n) => !knownSet.has(n)).length };
  }, [ai, flags, known]);
  const weakTotal = weak.named.length + weak.unnamed;

  const ready = !!yours && !!ai && deckSize(yours) === 40;
  const canBegin = ready && supported === true && !busy;
  const begin = async () => {
    if (!yours || !ai) return;
    setBusy(true);
    setMsg(null);
    const r = await launchMatch({ deck: yours, aiDeck: ai, aiProfile: profile, games });
    setBusy(false);
    if (r.ok) {
      setMsg({ ok: true, text: r.detail ?? 'The engine is dealing your match. Taking your seat…' });
      setTimeout(() => {
        location.href = `${location.pathname}?play=1`;
      }, 1200);
    } else setMsg({ ok: false, text: r.message });
  };

  const note = !ready
    ? 'Finish your deck first: the builder needs a legal 40.'
    : supported === null
      ? 'Looking for the match launcher on this computer…'
      : supported
        ? `Best of ${games === 3 ? 'three' : 'one'} against the AI’s draft. Its list stays hidden, as at a real table.`
        : 'The match launcher isn’t running yet: it comes with an mtg-table update (./scripts/play.sh). Your deck exports from the builder meanwhile.';

  return (
    <div className="fx setup match">
      <header className="setup-top">
        <button className="link-back" onClick={onBack}>
          <IconChevronLeft size={14} /> Back to your deck
        </button>
        <div className="fx-label setup-kicker">The match</div>
        <span />
      </header>

      <div className="setup-grid">
        <aside className="panel setup-opts">
          <div className="fx-label panel-h">Match</div>
          <Field label="Games">
            <Seg
              label="Games"
              value={games}
              onChange={setGames}
              options={[
                [1, 'Bo1'],
                [3, 'Bo3'],
              ]}
            />
          </Field>
          <Field label="Draft">
            <div className="opt-tile is-static">
              <span className="opt-t">{cube?.title}</span>
              <span className="opt-d">
                {draft.format === 'grid' ? 'Grid' : 'Winston'} · you {draft.picks.you.length} cards, the AI {draft.picks.ai.length}
              </span>
            </div>
          </Field>
        </aside>

        <section className="panel seat">
          <div className="fx-label panel-h center">You</div>
          <span className="avatar lg">
            <span>Y</span>
          </span>
          <div className="seat-name">You</div>
          <div className={cx('deck-tile', yours && 'is-on')}>
            <div>
              <div className="deck-tile-name">{build ? build.name : 'No deck yet'}</div>
              <div className="deck-tile-meta">
                {yours ? `${deckSize(yours)} cards · ${colourLabel(build?.colors ?? '')}${build?.splash ? ` + ${build.splash}` : ''}` : 'build it first'}
              </div>
              <div className="fx-label deck-tile-k">{yours ? 'Deck selected' : ''}</div>
            </div>
            <button className="deck-tile-swap" onClick={onBack}>
              Edit
            </button>
          </div>
        </section>

        <div className="vs" aria-hidden="true">
          vs
        </div>

        <section className="panel seat">
          <div className="fx-label panel-h center">Opponent · Bot</div>
          <span className="avatar is-bot lg">
            <span>AI</span>
          </span>
          <div className="seat-name">Forge AI</div>
          <div className="fx-label sub-h">The AI’s deck</div>
          <div className={cx('deck-tile', ai && 'is-on')}>
            <div>
              <div className="deck-tile-name">{ai ? 'Its draft' : 'Building…'}</div>
              <div className="deck-tile-meta">{ai ? `${deckSize(ai)} cards · list hidden` : '—'}</div>
              <div className="fx-label deck-tile-k">{ai ? 'Built by the AI' : ''}</div>
            </div>
          </div>
          {weakTotal > 0 && (
            <div className="warn-box">
              <div className="fx-label">
                {weakTotal} card{weakTotal === 1 ? '' : 's'} the AI can’t pilot well
              </div>
              <p>
                {weak.named.join(', ')}
                {weak.unnamed > 0 && `${weak.named.length ? ', and ' : ''}${weak.unnamed} you haven’t seen`}
              </p>
            </div>
          )}
          <div className="fx-label sub-h">AI profile</div>
          <div className="profiles">
            {AI_PROFILES.map((p) => (
              <button key={p.id} className={cx('profile', profile === p.id && 'is-on')} onClick={() => setProfile(p.id)} aria-pressed={profile === p.id}>
                <span className="profile-t">
                  {profile === p.id && <span className="check">✓</span>} {p.id}
                </span>
                <span className="profile-d">{p.blurb}</span>
              </button>
            ))}
          </div>
        </section>
      </div>

      <p className={cx('setup-note', msg && (msg.ok ? 'is-ok' : 'is-bad'))}>{msg?.text ?? note}</p>
      <footer className="setup-foot">
        <button className="btn-close" onClick={onAbandon}>
          New draft
          <small>this one stays in your pools</small>
        </button>
        <button className="btn-begin" onClick={() => void begin()} disabled={!canBegin} title={supported ? undefined : 'Needs the match launcher (mtg-table)'}>
          {busy ? 'Dealing…' : 'Begin the match'} <kbd>⏎</kbd>
        </button>
      </footer>
    </div>
  );
}
