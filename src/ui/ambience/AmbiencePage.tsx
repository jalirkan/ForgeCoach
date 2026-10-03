/*
 * ForgeCoach — ui/ambience/AmbiencePage.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * #ambience: the scenery preview. Two player strips over a mock table, buttons
 * that "play" lands (and fake creature / attack effects) for either side, undo
 * and reset, a stage slider, reduced motion, and a pack URL with its
 * validation listed — how an art pack is tried with no engine running.
 *
 * Everything here is made up in the page (ambience/sim.ts). It never opens a
 * socket to the engine.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { BIOME_LABEL, sceneryFromLog, slotsOf, type Biome } from '../../ambience/model.ts';
import { sceneryEvents, type SceneryEvent } from '../../ambience/events.ts';
import { SIM_PLAYERS, simLog, type SimLandName, type SimPlay } from '../../ambience/sim.ts';
import { browserLoader, fetchManifest, manifestUrlFor, preloadPack, withoutBiomes } from '../../ambience/pack.ts';
import { validateManifest, MAX_LAYERS, type ScenePack } from '../../ambience/manifest.ts';
import { currentPrefs, loadSceneryPrefs, saveSceneryPrefs } from '../../ambience/prefs.ts';
import { useMediaQuery } from '../hooks.ts';
import { SceneryStrip } from './SceneryStrip.tsx';
import { useSceneryFx } from './useScenery.ts';
import './ambience-page.css';

const LANDS: { name: SimLandName; short: string; tone: string }[] = [
  { name: 'Island', short: 'Island', tone: 'U' },
  { name: 'Swamp', short: 'Swamp', tone: 'B' },
  { name: 'Mountain', short: 'Mountain', tone: 'R' },
  { name: 'Forest', short: 'Forest', tone: 'G' },
  { name: 'Plains', short: 'Plains', tone: 'W' },
  { name: 'Wastes', short: 'Wastes', tone: 'C' },
  { name: 'Watery Grave', short: 'U/B dual', tone: 'multi' },
  { name: 'Command Tower', short: '5-colour', tone: 'multi' },
];

const DEMO: SimPlay[] = [
  { kind: 'land', player: 1, name: 'Island' },
  { kind: 'land', player: 2, name: 'Forest' },
  { kind: 'land', player: 1, name: 'Island' },
  { kind: 'land', player: 2, name: 'Plains' },
  { kind: 'land', player: 1, name: 'Swamp' },
  { kind: 'land', player: 1, name: 'Island' },
  { kind: 'land', player: 1, name: 'Mountain' },
];

const DEFAULT_PACK_URL = 'http://127.0.0.1:8650/';

type PackState =
  | { status: 'none' }
  | { status: 'loading'; url: string }
  | { status: 'ok' | 'failed'; url: string; manifestUrl: string | null; pack: ScenePack | null; errors: string[]; warnings: string[]; note: string | null };

export default function AmbiencePage() {
  const [plays, setPlays] = useState<SimPlay[]>([]);
  const [stage, setStage] = useState(0); // 0 = auto
  const systemReduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [motion, setMotion] = useState<'system' | 'reduce' | 'full'>(() => loadSceneryPrefs().motion);
  const reduced = motion === 'reduce' || (motion === 'system' && systemReduced);
  const [orient, setOrient] = useState<'rotated' | 'upright'>('upright');
  const initial = useMemo(() => currentPrefs(), []);
  const [url, setUrl] = useState(initial.mode === 'pack' ? initial.packUrl : '');
  const [packState, setPackState] = useState<PackState>({ status: 'none' });
  const [usePack, setUsePack] = useState(initial.mode === 'pack');
  const [eventsLog, setEventsLog] = useState<SceneryEvent[]>([]);
  const fx = useSceneryFx();

  const log = useMemo(() => simLog(plays), [plays]);
  const scenery = useMemo(() => sceneryFromLog(log, Infinity), [log]);
  const pack = usePack && packState.status === 'ok' ? packState.pack : null;
  const maxStage = Math.max(4, ...Object.values(pack?.biomes ?? {}).map((b) => b?.stages.length ?? 0));

  const play = (p: SimPlay) => setPlays((cur) => [...cur, p]);
  // A play appended → its scenery events (flash, effects); undo and reset make none.
  const prevPlays = useRef<SimPlay[]>([]);
  useEffect(() => {
    const before = prevPlays.current;
    prevPlays.current = plays;
    if (plays.length !== before.length + 1 || before.some((p, i) => p !== plays[i])) return;
    const prevLog = simLog(before);
    const ev = sceneryEvents(sceneryFromLog(prevLog, Infinity), scenery, log.frames.at(-1)!.body as never);
    fx.push(ev);
    setEventsLog((l) => [...ev, ...l].slice(0, 6));
  }, [plays]); // eslint-disable-line react-hooks/exhaustive-deps
  const playDemo = () => {
    fx.reset();
    setEventsLog([]);
    setPlays([]);
    DEMO.forEach((p, i) => setTimeout(() => play(p), 350 * (i + 1)));
  };

  const loadPack = async (u: string) => {
    if (!u.trim()) return;
    setPackState({ status: 'loading', url: u });
    const m = await fetchManifest(u, { fetch: (x, i) => fetch(x, i) });
    if (!m.pack) {
      setPackState({ status: 'failed', url: u, manifestUrl: m.manifestUrl, pack: null, errors: m.errors, warnings: m.warnings, note: 'Showing the built-in scenery.' });
      return;
    }
    const pre = await preloadPack(m.pack, browserLoader(), { maxStage: 6 });
    const p = pre.failed.length ? withoutBiomes(m.pack, pre.failed) : m.pack;
    const any = Object.keys(p.biomes).length > 0;
    setPackState({
      status: any ? 'ok' : 'failed',
      url: u,
      manifestUrl: m.manifestUrl,
      pack: any ? p : null,
      errors: any ? [] : ['No asset loaded.'],
      warnings: [...m.warnings, ...pre.reasons],
      note: pre.failed.length ? `${pre.failed.map((b) => BIOME_LABEL[b]).join(', ')} fell back to the built-in scenery.` : null,
    });
    setUsePack(true);
  };
  const autoLoaded = useRef(false);
  useEffect(() => {
    if (!autoLoaded.current && initial.mode === 'pack' && initial.packUrl) {
      autoLoaded.current = true;
      void loadPack(initial.packUrl);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = (player: number) => slotsOf(scenery, player);

  return (
    <div className="amb">
      <header className="amb-top">
        <a className="amb-back" href="#">
          ← ForgeCoach
        </a>
        <div>
          <h1>Board scenery</h1>
          <p className="amb-sub">Play lands for either side and watch their side of the table grow. Nothing here talks to the engine.</p>
        </div>
      </header>

      <main className="amb-main">
        <section className="amb-table" aria-label="Preview table">
          <MockSide
            title="Opponent"
            player={SIM_PLAYERS[1]}
            top
            slots={counts(SIM_PLAYERS[1])}
            strip={
              <SceneryStrip
                slots={slotsOf(scenery, SIM_PLAYERS[1])}
                pack={pack}
                edge="top"
                orient={orient}
                reduced={reduced}
                pulses={fx.pulses.get(SIM_PLAYERS[1])}
                fx={fx.fx.get(SIM_PLAYERS[1])}
                stageOverride={stage || null}
              />
            }
            plays={plays}
          />
          <div className="amb-mid" aria-hidden="true" />
          <MockSide
            title="You"
            player={SIM_PLAYERS[0]}
            slots={counts(SIM_PLAYERS[0])}
            strip={
              <SceneryStrip
                slots={slotsOf(scenery, SIM_PLAYERS[0])}
                pack={pack}
                edge="bottom"
                reduced={reduced}
                pulses={fx.pulses.get(SIM_PLAYERS[0])}
                fx={fx.fx.get(SIM_PLAYERS[0])}
                stageOverride={stage || null}
              />
            }
            plays={plays}
          />
        </section>

        <aside className="amb-panel">
          <div className="amb-card">
            <h2>Play</h2>
            {[SIM_PLAYERS[0], SIM_PLAYERS[1]].map((p) => (
              <div key={p} className="amb-group" role="group" aria-label={p === SIM_PLAYERS[0] ? 'Your plays' : 'Opponent plays'}>
                <div className="amb-group-h">{p === SIM_PLAYERS[0] ? 'You' : 'Opponent'}</div>
                <div className="amb-lands">
                  {LANDS.map((l) => (
                    <button key={l.name} className={`amb-land t-${l.tone}`} onClick={() => play({ kind: 'land', player: p, name: l.name })} data-play={`${p}:${l.name}`}>
                      {l.short}
                    </button>
                  ))}
                </div>
                <div className="amb-row">
                  <button className="btn btn-quiet btn-sm" onClick={() => play({ kind: 'creature', player: p })}>
                    Creature enters
                  </button>
                  <button className="btn btn-quiet btn-sm" onClick={() => play({ kind: 'attack', player: p })}>
                    Attack
                  </button>
                </div>
              </div>
            ))}
            <div className="amb-row">
              <button className="btn btn-quiet btn-sm" onClick={() => setPlays((p) => p.slice(0, -1))} disabled={!plays.length}>
                Undo
              </button>
              <button
                className="btn btn-quiet btn-sm"
                onClick={() => {
                  setPlays([]);
                  fx.reset();
                  setEventsLog([]);
                }}
                disabled={!plays.length}
              >
                Reset
              </button>
              <button className="btn btn-primary btn-sm" onClick={playDemo}>
                Demo sequence
              </button>
            </div>
            {eventsLog.length > 0 && (
              <ul className="amb-events" aria-label="Last scenery events">
                {eventsLog.map((e, i) => (
                  <li key={i}>{describe(e)}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="amb-card">
            <h2>View</h2>
            <label className="amb-field">
              <span>
                Stage <b>{stage ? stage : 'auto'}</b>
              </span>
              <input type="range" min={0} max={maxStage} step={1} value={stage} onChange={(e) => setStage(Number(e.target.value))} aria-label="Stage (0 = from the lands)" />
              <span className="amb-hint">Auto follows the lands: 1 / 2–3 / 4–5 / 6+.</span>
            </label>
            <div className="amb-field">
              <span>Motion</span>
              <div className="amb-seg" role="radiogroup" aria-label="Motion">
                {(['system', 'full', 'reduce'] as const).map((m) => (
                  <button key={m} role="radio" aria-checked={motion === m} className={motion === m ? 'is-on' : ''} onClick={() => setMotion(m)}>
                    {m === 'system' ? `System${systemReduced ? ' (still)' : ''}` : m === 'full' ? 'Full' : 'Stills only'}
                  </button>
                ))}
              </div>
            </div>
            <div className="amb-field">
              <span>Opponent side</span>
              <div className="amb-seg" role="radiogroup" aria-label="Opponent side">
                {(['upright', 'rotated'] as const).map((o) => (
                  <button key={o} role="radio" aria-checked={orient === o} className={orient === o ? 'is-on' : ''} onClick={() => setOrient(o)}>
                    {o === 'rotated' ? 'Turned, as across a table' : 'Upright vista'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <PackCard
            url={url}
            setUrl={setUrl}
            state={packState}
            usePack={usePack}
            setUsePack={setUsePack}
            onLoad={() => loadPack(url || DEFAULT_PACK_URL)}
            onSave={() => saveSceneryPrefs({ ...loadSceneryPrefs(), mode: usePack && url ? 'pack' : 'procedural', packUrl: url, motion })}
          />
        </aside>
      </main>
    </div>
  );
}

function describe(e: SceneryEvent): string {
  const who = e.kind === 'damage' ? (e.player === SIM_PLAYERS[0] ? 'you' : 'opponent') : e.player === SIM_PLAYERS[0] ? 'you' : 'opponent';
  if (e.kind === 'land') return `land · ${who} · ${e.biome} slot ${e.slot + 1}${e.newSlot ? ' (new)' : ''} · stage ${e.prevStage}→${e.stage}`;
  if (e.kind === 'creature') return `creature · ${who} · ${e.colors.join('') || 'colourless'}`;
  if (e.kind === 'attack') return `attack · ${who} · ${e.attackerIds.length} attacker${e.attackerIds.length === 1 ? '' : 's'}`;
  return `damage · ${who} · ${e.amount}`;
}

function MockSide({ title, player, top, slots, strip, plays }: { title: string; player: number; top?: boolean; slots: ReturnType<typeof slotsOf>; strip: React.ReactNode; plays: SimPlay[] }) {
  const lands = plays.filter((p): p is Extract<SimPlay, { kind: 'land' }> => p.kind === 'land' && p.player === player);
  const creatures = plays.filter((p) => p.kind === 'creature' && p.player === player).length;
  const summary = slots.length ? slots.map((s) => `${BIOME_LABEL[s.biome]} ${fmt(s.weight)} · stage ${s.stage}`).join('   ') : 'No lands yet';
  const chips = (
    <div className="amb-chips" aria-label={`${title}'s lands`}>
      {lands.map((l, i) => (
        <span key={i} className={`amb-chip t-${LANDS.find((x) => x.name === l.name)?.tone ?? 'C'}`}>
          {l.name}
        </span>
      ))}
    </div>
  );
  const creatureRow = creatures > 0 && (
    <div className="amb-creatures">
      {Array.from({ length: creatures }, (_, i) => (
        <span key={i} className="amb-creature">
          2/2
        </span>
      ))}
    </div>
  );
  return (
    <div className={`amb-side ${top ? 'is-top' : 'is-me'}`}>
      <div className="amb-side-h">
        <b>{title}</b>
        <span className="amb-summary">{summary}</span>
      </div>
      <div className="amb-bf scn-host">
        {strip}
        {top ? (
          <>
            {chips}
            {creatureRow}
          </>
        ) : (
          <>
            {creatureRow}
            {chips}
          </>
        )}
      </div>
    </div>
  );
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function PackCard({
  url,
  setUrl,
  state,
  usePack,
  setUsePack,
  onLoad,
  onSave,
}: {
  url: string;
  setUrl: (s: string) => void;
  state: PackState;
  usePack: boolean;
  setUsePack: (b: boolean) => void;
  onLoad: () => void;
  onSave: () => void;
}) {
  const [saved, setSaved] = useState(false);
  const [paste, setPaste] = useState('');
  const pasted = useMemo(() => {
    if (!paste.trim()) return null;
    let raw: unknown;
    try {
      raw = JSON.parse(paste);
    } catch (e) {
      return { errors: [`Not valid JSON: ${e instanceof Error ? e.message : String(e)}`], warnings: [], summary: null };
    }
    const r = validateManifest(raw, manifestUrlFor(url || DEFAULT_PACK_URL) ?? DEFAULT_PACK_URL);
    const summary = r.pack
      ? (Object.entries(r.pack.biomes) as [Biome, NonNullable<ScenePack['biomes'][Biome]>][]).map(([b, v]) => `${BIOME_LABEL[b]}: ${v.stages.length} stage${v.stages.length === 1 ? '' : 's'}, ${v.stages.map((s) => s.layers.length).join('/')} layers`).join(' · ')
      : null;
    return { errors: r.errors, warnings: r.warnings, summary };
  }, [paste, url]);
  return (
    <div className="amb-card">
      <h2>Art pack</h2>
      <label className="amb-field">
        <span>Pack URL (a folder with scenery.json, or the .json)</span>
        <div className="amb-row amb-urlrow">
          <input type="url" value={url} placeholder={DEFAULT_PACK_URL} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onLoad()} spellCheck={false} />
          <button className="btn btn-primary btn-sm" onClick={onLoad} disabled={state.status === 'loading'}>
            {state.status === 'loading' ? 'Loading…' : state.status === 'ok' ? 'Reload' : 'Load'}
          </button>
        </div>
      </label>
      {state.status !== 'none' && state.status !== 'loading' && (
        <div className={`amb-status ${state.status === 'ok' ? 'is-ok' : 'is-bad'}`} role="status">
          {state.status === 'ok' ? (
            <>
              Loaded <b>{state.pack!.name}</b>
              {state.pack!.author ? ` by ${state.pack!.author}` : ''}: {Object.keys(state.pack!.biomes).map((b) => BIOME_LABEL[b as Biome]).join(', ')}. Other biomes use the built-in scenery.
            </>
          ) : (
            <>Not loaded. {state.note}</>
          )}
          {state.status === 'ok' && state.note && <div>{state.note}</div>}
        </div>
      )}
      {state.status !== 'none' && state.status !== 'loading' && (state.errors.length > 0 || state.warnings.length > 0) && (
        <ul className="amb-issues">
          {state.errors.map((e, i) => (
            <li key={`e${i}`} className="is-error">
              {e}
            </li>
          ))}
          {state.warnings.map((w, i) => (
            <li key={`w${i}`}>{w}</li>
          ))}
        </ul>
      )}
      <div className="amb-row">
        <label className="amb-check">
          <input type="checkbox" checked={usePack} onChange={(e) => setUsePack(e.target.checked)} disabled={state.status !== 'ok'} /> Show the pack (off: built-in)
        </label>
      </div>
      <div className="amb-row">
        <button
          className="btn btn-quiet btn-sm"
          onClick={() => {
            onSave();
            setSaved(true);
            setTimeout(() => setSaved(false), 1500);
          }}
        >
          {saved ? 'Saved' : 'Use on the board'}
        </button>
        <span className="amb-hint">Turns scenery on in Settings with this choice.</span>
      </div>
      <details className="amb-paste">
        <summary>Check a manifest by pasting it</summary>
        <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={7} spellCheck={false} placeholder='{ "schema": 1, "biomes": { "island": { "stages": [ … ] } } }' aria-label="Manifest JSON" />
        {pasted && (
          <ul className="amb-issues">
            {pasted.summary && <li className="is-ok">Valid: {pasted.summary}</li>}
            {pasted.errors.map((e, i) => (
              <li key={`e${i}`} className="is-error">
                {e}
              </li>
            ))}
            {pasted.warnings.map((w, i) => (
              <li key={`w${i}`}>{w}</li>
            ))}
          </ul>
        )}
        <span className="amb-hint">
          Relative paths resolve against the pack URL. At most {MAX_LAYERS} layers per stage. The spec: docs/scenery-pack-spec.md.
        </span>
      </details>
      <p className="amb-hint" style={{ '--x': 0 } as CSSProperties}>
        Serve a pack with <code>npx http-server ./pack --cors -p 8650</code>, then Load. Or open <code>#ambience?scenery=http://127.0.0.1:8650/</code>.
      </p>
    </div>
  );
}
