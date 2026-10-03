/*
 * ForgeCoach — ui/draft/Setup.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The two set-up screens of a draft against the AI, after the board game's
 * table set-up: a gold kicker over an italic serif title, a GAME panel and a
 * RULES panel of small labelled toggles on the left, the seats on the right,
 * a muted red way out and one big gold button.
 *
 *   DraftSetup — variant (Booster, Winston, Grid), the cube, players and bot
 *                seats (Booster), who opens, the pick timer, hints.
 *   MatchSetup — after the build: your deck vs the AI's (name and count only:
 *                its list stays hidden), the cards the AI can't pilot well,
 *                AI profile, Bo1/Bo3, and Begin, which asks mtg-table's match
 *                launcher to deal the match.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CUBES, cubeInfo, type CubeInfo } from '../../cube/cubes.ts';
import type { CubeMeta } from '../../cube/meta.ts';
import { aiFlagsFromDoc, noFlags, withMetaFlags, type AiFlags } from '../../draft/aiFlags.ts';
import { deckCount, mainNames, toMatchDeck, type DeckState } from '../../draft/deck.ts';
import { boosterPackSize, BOOSTER_PACKS, progress, SEAT_OPTIONS, type Draft, type Format } from '../../draft/draft.ts';
import { AI_PROFILES, deckSize, launcherStatus, launchMatch, safeDeckName, type AiProfile, type LaunchResult, type LauncherStatus } from '../../draft/launch.ts';
import type { DraftAfter } from '../../draft/store.ts';
import { colourLabel, wubrg } from '../../cube/colors.ts';
import { prefetchCards, useCardInfo } from '../cardData.ts';
import { IconChevronLeft, IconChevronRight } from '../Icons.tsx';
import { PipRow } from '../Mana.tsx';
import { CubeGuideSheet } from '../guide/CubeGuide.tsx';
import { guideFor } from '../../cube/guides/index.ts';
import { Sheet } from '../Sheet.tsx';
import { cx } from '../util.ts';
import type { StartOptions } from './useDraftGame.ts';

const BASE = import.meta.env.BASE_URL;

/** A signature card per cube, for its art. */
export const CUBE_ART: Record<string, string> = {
  synergy: 'Mayhem Devil',
  'modern-era': 'Snapcaster Mage',
  vintage: 'Black Lotus',
  pauper: 'Ninja of the Deep Hours',
  omega: 'Baneslayer Angel',
  'fair-fight': 'Skyclave Apparition',
};

export function Seg<T extends string | number | boolean>({ value, options, onChange, label }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; label: string }) {
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

export function CubeArt({ cube, className }: { cube: CubeInfo; className?: string }) {
  const info = useCardInfo(CUBE_ART[cube.id]);
  const art = info?.image?.artCrop ?? info?.faces?.[0]?.image?.artCrop;
  return (
    <span className={cx('cube-art2', className)} aria-hidden="true">
      {art && <img src={art} alt="" loading="lazy" draggable={false} />}
      <span className="cube-art2-pips">
        <PipRow colors={[...cube.accent]} />
      </span>
    </span>
  );
}

const VARIANTS: Array<[Format, string, string]> = [
  ['booster', 'Booster', 'Open packs, pick a card, pass the rest.'],
  ['winston', 'Winston', 'Three face-down piles. Take a pile or pass it on.'],
  ['grid', 'Grid', 'Nine cards face up. Take a row or a column.'],
];

const TIMERS: Array<[number, string]> = [
  [0, 'Off'],
  [45, '45 s'],
  [75, '75 s'],
  [120, '120 s'],
];

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
  onBegin: (o: StartOptions) => void;
  onExit: () => void;
  onPaper: () => void;
  hints: boolean;
}) {
  const [cubeId, setCubeId] = useState(CUBES[0]?.id ?? 'synergy');
  const [format, setFormat] = useState<Format>('booster');
  const [players, setPlayers] = useState(2);
  const [first, setFirst] = useState<'you' | 'ai' | 'toss'>('toss');
  const [timer, setTimer] = useState(0);
  const [hintsOn, setHintsOn] = useState(hints);
  const [title, setTitle] = useState('Practice draft');
  const [advanced, setAdvanced] = useState(false);
  const [picker, setPicker] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  useEffect(() => prefetchCards(Object.values(CUBE_ART)), []);
  const cube = cubeInfo(cubeId) ?? CUBES[0]!;
  const seats = format === 'booster' ? players : 2;
  const packSize = boosterPackSize(seats, 180);
  const begin = () => onBegin({ cubeId, format, youFirst: first === 'toss' ? Math.random() < 0.5 : first === 'you', hints: hintsOn, seats, timer, title: title.trim() || 'Practice draft' });
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLInputElement) && !document.querySelector('.sheet-backdrop')) begin();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });
  const variant = VARIANTS.find(([v]) => v === format)!;
  const shape =
    format === 'booster'
      ? `${BOOSTER_PACKS} packs · ${packSize} cards each · 1 card before passing`
      : format === 'winston'
        ? '90 cards · 3 piles · take a pile or pass'
        : '18 grids of 9 · first pick alternates';

  return (
    <div className="fx setup">
      <header className="setup-top">
        <button className="link-back" onClick={onExit}>
          <IconChevronLeft size={14} /> Back to the start
        </button>
        <span />
        <button className="link-back is-right" onClick={onPaper}>
          Paper draft helper
        </button>
      </header>
      <div className="setup-head">
        <div className="fx-label setup-kicker">
          Draft · {seats}/{seats} seated
        </div>
        <label className="setup-title">
          <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Table name" maxLength={48} />
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M4 20h4L19 9l-4-4L4 16v4Zm11-15 4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          </svg>
        </label>
      </div>

      {resume && !resume.done && (
        <div className="resume">
          <div>
            <div className="fx-label">Draft in progress</div>
            <div className="resume-t">
              <i>{cubeInfo(resume.cubeId)?.title}</i> · {resume.format === 'grid' ? 'Grid' : resume.format === 'winston' ? 'Winston' : 'Booster'} · {progress(resume).label} · {resume.picks.you.length} cards
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
        <div className="setup-col">
          <section className="panel">
            <div className="fx-label panel-h">Game</div>
            <div className="opt-tile is-on is-static">
              <span className="opt-t">Draft</span>
              <span className="opt-d">{variant[2]}</span>
            </div>
            <Field label="Variant">
              <Seg label="Variant" value={format} onChange={setFormat} options={VARIANTS.map(([v, l]) => [v, l] as [Format, string])} />
            </Field>
            <div className="src-tiles">
              <button className="src-tile is-on" aria-pressed="true">
                Cube
              </button>
              <button className="src-tile" disabled title="Not yet: cubes only">
                Official set
              </button>
              <button className="src-tile" disabled title="Not yet: cubes only">
                Chaos
              </button>
            </div>
            <button className="cube-pick" onClick={() => setPicker(true)}>
              <span>
                {cube.title} · 180 cards
              </span>
              <IconChevronRight size={16} />
            </button>
            <p className="setup-small">
              Packs and piles are built from this cube, with its lab data.{' '}
              <a className="setup-link" href={`#cube/${cube.id}`}>
                See the list
              </a>
            </p>
            {guideFor(cube.id) && (
              <p className="setup-small cg-teaser">
                {guideFor(cube.id)!.teaser}{' '}
                <button type="button" onClick={() => setGuideOpen(true)}>
                  Read the guide
                </button>
              </p>
            )}
            <p className="setup-shape">{shape}</p>
            <button className={cx('adv-toggle', advanced && 'is-open')} onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>
              Advanced <span aria-hidden="true">⌄</span>
            </button>
            {advanced && (
              <div className="adv">
                {format !== 'booster' && (
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
                )}
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
                <p className="setup-small">Hints give the pick helper’s choice a soft glow. The coach is in the pick screen’s menu either way.</p>
              </div>
            )}
          </section>
          <section className="panel">
            <div className="fx-label panel-h">Rules</div>
            <Field label="Players">
              {format === 'booster' ? (
                <Seg label="Players" value={players} onChange={setPlayers} options={SEAT_OPTIONS.map((n) => [n, String(n)] as [number, string])} />
              ) : (
                <div className="seg2 is-static">
                  <button className="is-on" disabled>
                    2
                  </button>
                </div>
              )}
            </Field>
            <Field label="Pick timer">
              <Seg label="Pick timer" value={timer} onChange={setTimer} options={TIMERS} />
            </Field>
          </section>
        </div>

        <div className="setup-seats">
          <div className="seat-row">
            <span className="avatar sm">
              <span>Y</span>
            </span>
            <span className="seat-row-name">You</span>
            <span className="tag-host">Host</span>
            <span className="seat-dot" aria-label="Ready" />
          </div>
          {Array.from({ length: seats - 1 }, (_, i) => (
            <div key={i} className="seat-row is-bot">
              <span className="bot-glyph" aria-hidden="true">
                <svg viewBox="0 0 16 16" width="15" height="15">
                  <rect x="2.5" y="4.5" width="11" height="8" rx="2" fill="none" stroke="currentColor" />
                  <path d="M8 2v2.5M6 8h.01M10 8h.01" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
                </svg>
              </span>
              <span className="seat-row-name">{i === 0 ? 'Forge AI' : `Bot ${i + 1}`}</span>
              <span className="tag-plain">{i === 0 ? 'Your opponent' : 'Forge AI'}</span>
              {i > 0 && (
                <button className="seat-remove" onClick={() => setPlayers(Math.max(2, players - 2))}>
                  Remove
                </button>
              )}
            </div>
          ))}
          <p className="setup-small">
            {seats > 2 ? 'Every seat is the cube lab’s drafter. You play the match against Forge AI, the seat on your left.' : 'The cube lab’s drafter: lab ratings, the cube’s themes, two colours a third of the way in.'}
          </p>
          <p className="setup-line">Open packs, draft cards, build a 40-card deck.</p>
          <footer className="setup-foot">
            <button className="btn-close" onClick={onExit}>
              Close table
              <small>nothing is lost</small>
            </button>
            <button className="btn-begin" onClick={begin}>
              Begin the draft <kbd>⏎</kbd>
            </button>
          </footer>
        </div>
      </div>

      <CubeGuideSheet open={guideOpen} onClose={() => setGuideOpen(false)} cubeId={cube.id} />
      <Sheet open={picker} onClose={() => setPicker(false)} width={720} className="fx fx-sheet" title={<span className="serif-title">Choose a cube</span>}>
        <div className="ctiles">
          {CUBES.map((c) => (
            <button
              key={c.id}
              className={cx('ctile', cubeId === c.id && 'is-on')}
              onClick={() => {
                setCubeId(c.id);
                setPicker(false);
              }}
              aria-pressed={cubeId === c.id}
            >
              <CubeArt cube={c} className="ctile-art" />
              <span className="ctile-body">
                <span className="ctile-t">{c.title}</span>
                <span className="ctile-d">{c.blurb}</span>
                <span className="ctile-m">180 cards{c.labData === false ? '' : ' · lab data'}</span>
              </span>
            </button>
          ))}
        </div>
      </Sheet>
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
  deck,
  deckColours,
  after,
  known,
  meta,
  cubeNames,
  title,
  onBack,
  onAbandon,
}: {
  draft: Draft;
  deck: DeckState | null;
  /** Your deck's colours (WUBRG letters), for the tile. */
  deckColours: string;
  after: DraftAfter | undefined;
  known: string[];
  meta: CubeMeta | null;
  cubeNames: string[];
  title: string;
  onBack: () => void;
  onAbandon: () => void;
}) {
  const [profile, setProfile] = useState<AiProfile>('Default');
  const [games, setGames] = useState<1 | 3>(3);
  const [status, setStatus] = useState<LauncherStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LaunchResult | null>(null);
  const supported = status === null ? null : status === 'ready' || status === 'asleep';
  const flags = useAiFlags(draft.cubeId, meta, cubeNames);
  const cube = cubeInfo(draft.cubeId);
  const deckName = `${title} — ${deckColours ? colourLabel(wubrg(deckColours)) : 'my deck'}`;
  const yours = useMemo(() => (deck ? toMatchDeck(deckName, deck) : null), [deck, deckName]);
  const ai = after?.aiDeck ?? null;

  useEffect(() => {
    let live = true;
    const check = () => launcherStatus().then((st) => live && setStatus(st));
    void check();
    const t = setInterval(check, 8000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  // Cards the AI can't pilot well: named only when you know it holds them.
  const weak = useMemo(() => {
    const inDeck = new Set((ai?.main ?? []).map(([, n]) => n));
    const flagged = [...flags.all].filter((n) => inDeck.has(n));
    const knownSet = new Set(known);
    return { named: flagged.filter((n) => knownSet.has(n)), unnamed: flagged.filter((n) => !knownSet.has(n)).length };
  }, [ai, flags, known]);
  const weakTotal = weak.named.length + weak.unnamed;

  const ready = !!yours && !!ai && deckSize(yours) >= 40;
  const canBegin = ready && supported === true && !busy;
  const takeSeat = () => {
    // The engine restarted on the new decks: take the seat again; the next hello_ok is this match.
    const q = new URLSearchParams(location.search);
    q.set('play', '1');
    location.href = `${location.pathname}?${q.toString()}`;
  };
  const begin = async () => {
    if (!yours || !ai || !canBegin) return;
    setBusy(true);
    setResult(null);
    const r = await launchMatch({ deck: yours, aiDeck: { ...ai, name: safeDeckName(ai.name, 'AI Drafter') }, aiProfile: profile, games });
    setBusy(false);
    setResult(r);
    if (r.ok && r.warnings.length === 0) setTimeout(takeSeat, 900);
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) void begin();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  const note = busy
    ? 'Starting the engine on both decks… this takes 10–20 seconds, longer on a busy machine.'
    : !ready
      ? 'Your deck needs at least 40 cards.'
      : status === null
        ? 'Looking for the match launcher on this computer…'
        : status === 'ready'
          ? `Best of ${games === 3 ? 'three' : 'one'} against the AI’s draft. Its list stays hidden, as at a real table.`
          : status === 'asleep'
            ? `The engine is sleeping; it starts when you press Begin. Best of ${games === 3 ? 'three' : 'one'} against the AI’s draft, its list hidden.`
          : status === 'down'
            ? 'ForgeCoach’s engine isn’t running (it stops an hour after the last game). Start ForgeCoach again — the app-menu launcher, or ./scripts/play.sh — and Begin unlocks.'
            : 'This engine has no match launcher: update mtg-table and start it again with ./scripts/play.sh.';

  return (
    <div className="fx setup match">
      <header className="setup-top">
        <button className="link-back" onClick={onBack}>
          <IconChevronLeft size={14} /> Back to your deck
        </button>
        <div className="fx-label setup-kicker">Draft match</div>
        <span />
      </header>

      <div className="match-grid">
        <section className="panel match-opts">
          <div className="fx-label panel-h">Game</div>
          <div className="opt-tile is-on is-static">
            <span className="opt-t">Draft match</span>
            <span className="opt-d">
              {cube?.title} · {draft.format === 'grid' ? 'Grid' : draft.format === 'winston' ? 'Winston' : 'Booster'}
            </span>
          </div>
          <Field label="Match">
            <Seg
              label="Match"
              value={games}
              onChange={setGames}
              options={[
                [1, 'Bo1'],
                [3, 'Bo3'],
              ]}
            />
          </Field>
        </section>

        <section className="panel seat">
          <div className="fx-label panel-h center">You</div>
          <span className="avatar lg">
            <span>Y</span>
          </span>
          <div className="seat-name">You</div>
          <span className="tag-host">Host</span>
          <div className={cx('deck-tile', yours && 'is-on')}>
            <div>
              <div className="deck-tile-name">{deckName}</div>
              <div className="deck-tile-meta">{deck ? `${deckCount(deck)} cards · cube draft` : 'build it first'}</div>
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

      {result ? (
        <div className={cx('launch-result', result.ok ? 'is-ok' : 'is-bad')} role="status">
          {result.ok ? (
            <>
              <p className="serif-i">
                The engine is dealing your match: {result.yourDeck.name} ({result.yourDeck.cards}) against the AI’s deck ({result.aiDeck.cards}), best of {result.games}.
              </p>
              {result.warnings.length > 0 && (
                <ul>
                  {result.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
              <button className="btn-gold" onClick={takeSeat}>
                Take your seat
              </button>
            </>
          ) : (
            <>
              <p className="serif-i">{result.message}</p>
              {result.problems && result.problems.length > 0 && (
                <ul>
                  {result.problems.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              )}
              {result.restored && (
                <button className="btn-line" onClick={takeSeat}>
                  Reconnect to the previous match
                </button>
              )}
            </>
          )}
        </div>
      ) : (
        <p className="setup-note">{note}</p>
      )}
      <footer className="setup-foot match-foot">
        <button className="btn-close" onClick={onAbandon}>
          New draft
          <small>this pool stays in Draft &amp; build</small>
        </button>
        <button className="btn-begin" onClick={() => void begin()} disabled={!canBegin} title={supported ? undefined : 'Needs the match launcher (mtg-table)'}>
          {busy ? 'Starting the engine…' : 'Begin the duel'} <kbd>⏎</kbd>
        </button>
      </footer>
    </div>
  );
}

/** Your deck's main colours, from its spells. */
export function deckColoursOf(deck: DeckState | null, colorsOf: (n: string) => string): string {
  if (!deck) return '';
  const counts: Record<string, number> = {};
  for (const n of mainNames(deck)) for (const c of colorsOf(n)) counts[c] = (counts[c] ?? 0) + 1;
  return Object.entries(counts)
    .filter(([, v]) => v >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([c]) => c)
    .join('');
}
