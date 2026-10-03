/*
 * ForgeCoach — ui/draft/DraftApp.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Draft vs AI (#draft): set up a cube draft, draft it against the cube lab's
 * drafting AI (Grid or Winston), build your deck with the deck assistant's
 * builder while the AI builds its own out of sight, then set up the match.
 *
 * Layout: phone first — one column, the opponent as a strip at the top, the
 * board, and the big gold action in a dock under the thumb. From 1100 px the
 * board sits between two columns: the opponent and the DECISION panel on the
 * left, your pool and the pick help on the right.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import '../deck/deck.css';
import './draft.css';
import type { DeckBuild } from '../../cube/builder.ts';
import { cubeInfo } from '../../cube/cubes.ts';
import { listPools } from '../../cube/pools.ts';
import { GRID_LINES, recommendGrid, recommendWinston } from '../../cube/pick.ts';
import { canPass, knownAiCards, lineName, progress, toAct, type Draft, type GridDraft, type WinstonDraft } from '../../draft/draft.ts';
import { buildPickPrompt, pickPromptCards } from '../../draft/pickPrompt.ts';
import { startAnswer, stopAnswer, useAnswer } from '../answers.ts';
import { cardsForPrompt, prefetchCards } from '../cardData.ts';
import { AnswerBox } from '../CoachPanel.tsx';
import { IconChevronLeft, IconGear, IconSpark } from '../Icons.tsx';
import { SettingsDialog } from '../SettingsDialog.tsx';
import { Sheet } from '../Sheet.tsx';
import { cx } from '../util.ts';
import { BuildView } from '../deck/BuildView.tsx';
import { CardInfoSheet } from '../deck/sheets.tsx';
import { GridBoard } from './GridBoard.tsx';
import { WinstonBoard } from './WinstonBoard.tsx';
import { AiBanner, DecisionPanel, Dock, OppPanel, PickHelp, type DecisionModel } from './Panels.tsx';
import { PoolSheet, PoolSummary } from './Pool.tsx';
import { DraftSetup, MatchSetup } from './Setup.tsx';
import { useDraftGame } from './useDraftGame.ts';

type View = 'setup' | 'draft' | 'build' | 'match';

function viewFromHash(): View | null {
  const m = /^#draft\/(setup|build|match)\b/.exec(location.hash);
  return (m?.[1] as View | undefined) ?? null;
}

function hashOf(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

export default function DraftApp({ onExit }: { onExit: () => void }) {
  const game = useDraftGame();
  const { saved, draft } = game;
  const [settings, setSettings] = useState(false);
  const [view, setView] = useState<View>(() => {
    const v = viewFromHash();
    if (v) return v;
    if (!saved) return 'setup';
    return saved.draft.done ? 'build' : 'draft';
  });
  const go = useCallback((v: View) => {
    setView(v);
    history.replaceState(null, '', v === 'draft' ? '#draft' : `#draft/${v}`);
  }, []);
  // A finished draft moves on to the builder by itself.
  useEffect(() => {
    if (view === 'draft' && draft?.done) {
      const t = setTimeout(() => go('build'), 1400);
      return () => clearTimeout(t);
    }
  }, [view, draft?.done, go]);
  // No draft to show: back to set-up.
  useEffect(() => {
    if (!saved && view !== 'setup') go('setup');
  }, [saved, view, go]);

  let body;
  if (view === 'setup' || !saved) {
    body = (
      <DraftSetup
        resume={saved && !(saved.draft as { pending?: boolean }).pending ? saved.draft : null}
        hints={saved?.hints ?? true}
        onResume={() => go(saved?.draft.done ? 'build' : 'draft')}
        onAbandon={game.abandon}
        onBegin={(o) => {
          game.start(o);
          go('draft');
        }}
        onExit={onExit}
        onPaper={() => {
          location.hash = '#deck';
        }}
      />
    );
  } else if (!draft || !game.data.ctx) {
    body = (
      <div className="fx dr-wait">
        <span className="spinner spinner-lg" />
        <p className="serif-i">Shuffling the cube…</p>
      </div>
    );
  } else if (view === 'draft') {
    body = <DraftTable game={game} draft={draft} onSettings={() => setSettings(true)} onLeave={() => go('setup')} />;
  } else {
    body = <AfterDraft game={game} draft={draft} view={view} go={go} onSettings={() => setSettings(true)} />;
  }
  return (
    <>
      {body}
      <SettingsDialog open={settings} onClose={() => setSettings(false)} />
    </>
  );
}

// ---------------------------------------------------------------------------
// The table

function DraftTable({ game, draft: d, onSettings, onLeave }: { game: ReturnType<typeof useDraftGame>; draft: Draft; onSettings: () => void; onLeave: () => void }) {
  const ctx = game.data.ctx!;
  const hints = game.saved?.hints ?? true;
  const mine = toAct(d) === 'you' && !game.aiBusy;
  const known = useMemo(() => knownAiCards(d), [d]);
  const [info, setInfo] = useState<string | null>(null);
  const [poolOpen, setPoolOpen] = useState(false);
  const [oppOpen, setOppOpen] = useState(false);
  const [coach, setCoach] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const cube = cubeInfo(d.cubeId);

  // Card images for what is on the table first, then the rest of the cube.
  useEffect(() => {
    prefetchCards(d.format === 'grid' ? d.dealt.slice(d.g * 9, d.g * 9 + 18) : [...d.piles.flat()]);
  }, [d]);
  useEffect(() => prefetchCards(d.dealt), [d.dealt]);
  // A new grid or a new pick clears the selection.
  const gridKey = d.format === 'grid' ? `${d.g}:${d.firstLine}` : '';
  useEffect(() => {
    setSel(null);
    setPreview(null);
  }, [gridKey]);

  // The pick helper (src/cube/pick.ts), for your decisions.
  const advice = useMemo(() => {
    if (!mine) return null;
    if (d.format === 'grid') {
      const a = recommendGrid(d.slots, d.picks.you, ctx, known);
      if (!a.best) return null;
      const line = GRID_LINES.findIndex((l) => l.id === a.best!.line.id);
      return { kind: 'grid' as const, line, title: `Take the ${a.best.line.label.toLowerCase()}`, lines: a.best.reasons };
    }
    const pile = d.piles[d.look] ?? [];
    if (!pile.length) return null;
    const a = recommendWinston(
      { pile, pileIndex: (d.look + 1) as 1 | 2 | 3, sizes: d.piles.map((p) => p.length) as [number, number, number], pool: d.picks.you, oppPool: known, seen: d.seen.you },
      ctx,
    );
    return { kind: 'winston' as const, take: a.action === 'take', title: a.action === 'take' ? `Take pile ${d.look + 1}` : `Pass pile ${d.look + 1}`, lines: a.reasons };
  }, [mine, d, ctx, known]);

  const hintLine = hints && advice?.kind === 'grid' ? advice.line : null;
  const hintTake = hints && advice?.kind === 'winston' ? advice.take : null;

  // The decision.
  let m: DecisionModel;
  if (d.done) {
    m = { kicker: 'Draft complete', title: 'On to deckbuilding', sub: `You drafted ${d.picks.you.length} cards.` };
  } else if (!mine) {
    m = { kicker: progress(d).label, title: d.format === 'grid' ? 'The AI picks a line' : `The AI looks at pile ${d.look + 1}`, waiting: true };
  } else if (d.format === 'grid') {
    const g = d as GridDraft;
    const first = g.firstLine === null;
    const lineCards = sel !== null ? GRID_LINES[sel]!.slots.filter((i) => g.slots[i]).length : 0;
    m = {
      kicker: `${progress(d).label} · you pick ${first ? 'first' : 'second'}`,
      title: sel !== null ? `The ${lineName(sel)}` : 'Take a row or a column',
      sub: sel === null ? 'Tap an arrow to light a line, then take it.' : undefined,
      status: sel !== null ? `${lineCards} card${lineCards === 1 ? '' : 's'} selected` : null,
      primary: { label: sel !== null ? `Take ${sel < 3 ? 'row' : 'column'}` : 'Choose a line', onClick: () => sel !== null && game.act({ kind: 'line', line: sel }), disabled: sel === null, kbd: '⏎' },
    };
  } else {
    const w = d as WinstonDraft;
    const n = w.piles[w.look]?.length ?? 0;
    const pass = canPass(w);
    m = {
      kicker: progress(d).label,
      title: `Pile ${w.look + 1} · ${n} card${n === 1 ? '' : 's'}`,
      sub: pass ? (w.look === 2 || w.piles.slice(w.look + 1).every((p) => !p.length) ? 'Pass, and you take the top card of the stack blind.' : 'Pass, and it grows by a card for the next look.') : 'The stack is empty: this pile is yours.',
      primary: { label: 'Take pile', onClick: () => game.act({ kind: 'take' }), kbd: '⏎' },
      secondary: { label: 'Pass', onClick: () => game.act({ kind: 'pass' }), disabled: !pass, kbd: 'P' },
    };
  }

  // Keys: Enter takes, P passes, Escape clears the grid selection.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement || document.querySelector('.sheet-backdrop')) return;
      if (e.key === 'Enter' && m.primary && !m.primary.disabled) {
        e.preventDefault();
        m.primary.onClick();
      } else if ((e.key === 'p' || e.key === 'P') && m.secondary && !m.secondary.disabled) m.secondary.onClick();
      else if (e.key === 'Escape') setSel(null);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  const lastYou = [...d.log].reverse().find((e) => e.who === 'you' && e.kind === 'blind');

  return (
    <div className={cx('fx dr', `is-${d.format}`)}>
      <header className="dr-top">
        <button className="icon-btn" onClick={onLeave} aria-label="Leave the table (the draft is saved)">
          <IconChevronLeft size={18} />
        </button>
        <div className="dr-title">
          <span className="dr-cube">{cube?.title}</span>
          <span className="fx-label">
            {d.format === 'grid' ? 'Grid' : 'Winston'} · {progress(d).label}
          </span>
        </div>
        <label className="hint-toggle">
          <input type="checkbox" checked={hints} onChange={(e) => game.setHints(e.target.checked)} />
          <span className="hint-switch" aria-hidden="true" />
          <span className="fx-label">Hints</span>
        </label>
        <button className="pill is-gold dr-coach" onClick={() => setCoach(true)} disabled={!mine}>
          <IconSpark size={12} /> Coach
        </button>
        <button className="icon-btn" onClick={onSettings} aria-label="Settings">
          <IconGear size={18} />
        </button>
      </header>

      <div className="dr-body">
        <aside className="dr-left">
          <OppPanel d={d} ctx={ctx} known={known} onInfo={setInfo} onOpen={() => setOppOpen(true)} />
          <DecisionPanel m={m} />
        </aside>

        <main className="dr-center">
          <OppPanel d={d} ctx={ctx} known={known} onInfo={setInfo} onOpen={() => setOppOpen(true)} compact />
          <AiBanner e={game.aiNote} />
          {lastYou && d.log[d.log.length - 1] === lastYou && <div className="aibanner is-you">You took the top card blind: {lastYou.cards[0]}</div>}
          {d.format === 'grid' ? (
            <GridBoard
              d={d}
              mine={mine}
              selected={sel}
              preview={preview}
              hint={hintLine}
              aiLine={game.aiLine}
              onSelect={setSel}
              onPreview={setPreview}
              onInfo={setInfo}
            />
          ) : (
            <WinstonBoard d={d} mine={mine} hintTake={hintTake} onInfo={setInfo} />
          )}
        </main>

        <aside className="dr-right">
          <PickHelp title={hints ? (advice?.title ?? null) : null} lines={advice?.lines ?? []} onCoach={() => setCoach(true)} />
          <PoolSummary pool={d.picks.you} ctx={ctx} onOpen={() => setPoolOpen(true)} onInfo={setInfo} />
        </aside>
      </div>

      <Dock
        m={m}
        pool={d.picks.you.length}
        onPool={() => setPoolOpen(true)}
        extra={
          hints && advice ? (
            <button className="dock-hint" onClick={() => setCoach(true)}>
              <IconSpark size={11} /> {advice.title}
            </button>
          ) : (
            <button className="dock-hint" onClick={() => setCoach(true)} disabled={!mine}>
              <IconSpark size={11} /> Coach
            </button>
          )
        }
      />

      <PoolSheet open={poolOpen} onClose={() => setPoolOpen(false)} pool={d.picks.you} ctx={ctx} title="Your pool" onInfo={setInfo} />
      <PoolSheet
        open={oppOpen}
        onClose={() => setOppOpen(false)}
        pool={known}
        ctx={ctx}
        title={d.format === 'grid' ? 'The AI’s picks' : 'What you know the AI has'}
        hiddenCount={d.picks.ai.length - known.length}
        onInfo={setInfo}
      />
      <PickCoach open={coach} onClose={() => setCoach(false)} game={game} d={d} advice={advice} />
      <div className="fx-sheet-scope">
        <CardInfoSheet name={info} ctx={ctx} pool={d.picks.you} onClose={() => setInfo(null)} />
      </div>
    </div>
  );
}

function PickCoach({
  open,
  onClose,
  game,
  d,
  advice,
}: {
  open: boolean;
  onClose: () => void;
  game: ReturnType<typeof useDraftGame>;
  d: Draft;
  advice: { title: string; lines: string[] } | null;
}) {
  const ctx = game.data.ctx!;
  const [q, setQ] = useState('');
  const key = `pick:${d.id}:${d.log.length}:${hashOf(q.trim())}`;
  const answer = useAnswer(key);
  const makePrompt = useCallback(async () => buildPickPrompt({ ctx, draft: d, infos: await cardsForPrompt(pickPromptCards(d)), question: q }), [ctx, d, q]);
  return (
    <Sheet open={open} onClose={onClose} width={620} className="fx fx-sheet" title={<span className="serif-title">Ask the coach</span>} subtitle={progress(d).label}>
      {advice && (
        <div className="coach-call">
          <span className="fx-label">Pick helper</span> {advice.title}
          {advice.lines.length > 0 && (
            <ul>
              {advice.lines.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <textarea className="dc-q coach-q" rows={2} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about this pick (optional)" aria-label="Question for the coach" />
      <AnswerBox
        answer={answer}
        askLabel="Ask the coach"
        idleText="The coach reads this pick, your pool, what you know the AI has and every card’s text. It never sees the AI’s hidden picks."
        onAsk={() => void startAnswer(key, makePrompt)}
        onStop={() => stopAnswer(key)}
        makePrompt={makePrompt}
        onOpenSettings={() => undefined}
      />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// After the draft: build, then the match

function AfterDraft({ game, draft: d, view, go, onSettings }: { game: ReturnType<typeof useDraftGame>; draft: Draft; view: View; go: (v: View) => void; onSettings: () => void }) {
  const ctx = game.data.ctx!;
  const after = game.saved?.after;
  const pool = useMemo(() => (after?.poolId ? listPools().find((p) => p.id === after.poolId) : undefined), [after?.poolId]);
  const [build, setBuild] = useState<DeckBuild | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const known = useMemo(() => knownAiCards(d), [d]);
  const cube = cubeInfo(d.cubeId);
  useEffect(() => prefetchCards(d.picks.you), [d.picks.you]);

  const match =
    view === 'match' ? (
      <MatchSetup
        draft={d}
        build={build}
        after={after}
        known={known}
        meta={game.data.meta}
        cubeNames={ctx.cube.cards.map((c) => c.name)}
        onBack={() => go('build')}
        onAbandon={() => {
          game.abandon();
          go('setup');
        }}
      />
    ) : null;
  return (
    <>
    {match}
    <div className="fx dbuild" hidden={view === 'match'}>
      <header className="dr-top">
        <button className="icon-btn" onClick={() => go('setup')} aria-label="Draft set-up">
          <IconChevronLeft size={18} />
        </button>
        <div className="dr-title">
          <span className="dr-cube">Build your deck</span>
          <span className="fx-label">
            {cube?.title} · {d.format === 'grid' ? 'Grid' : 'Winston'} · {d.picks.you.length} cards drafted
          </span>
        </div>
        <button className="btn-gold dbuild-go" onClick={() => go('match')} disabled={!build}>
          Play this match
        </button>
        <button className="icon-btn" onClick={onSettings} aria-label="Settings">
          <IconGear size={18} />
        </button>
      </header>
      <div className="dbuild-intro">
        <p className="serif-i">
          The draft is over. The AI has built its forty from its {d.picks.ai.length} cards — its list stays hidden until you meet it across the table.
        </p>
      </div>
      <main className="dw-main dbuild-main">
        {!pool ? (
          <div className="bv-wait">
            <span className="spinner" /> Saving your pool…
          </div>
        ) : (
          <BuildView
            ctx={ctx}
            pool={pool}
            format={d.format}
            onInfo={setInfo}
            onSettings={onSettings}
            metaChip={<span className="meta-chip is-on">{game.data.meta ? `Lab: ${game.data.meta.sample?.games ?? '?'} games` : 'No lab data'}</span>}
            onCurrent={setBuild}
          />
        )}
      </main>
      <div className="dbuild-dock">
        <button className="btn-gold dock-main" onClick={() => go('match')} disabled={!build}>
          Play this match
        </button>
      </div>
      <CardInfoSheet name={info} ctx={ctx} pool={d.picks.you} onClose={() => setInfo(null)} />
    </div>
    </>
  );
}
