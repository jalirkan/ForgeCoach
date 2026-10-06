/*
 * ForgeCoach — ui/draft/PickScreen.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The pick screen, the same for all three variants: a header (gold kicker,
 * serif "Pack 1 · Pick 3" / "Grid 4 of 18" / "Pile 2", a mono line with the
 * offer and the pool count, seat chips), the big gold action top right with
 * a kebab menu (the coach, hints, what you know of the AI, the cube's guide), the offer as
 * large card images, and the pool panel underneath. Phones get the action in
 * a dock under the thumb.
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { cubeInfo } from '../../cube/cubes.ts';
import { GRID_LINES, poolColours, recommendGrid, recommendWinston } from '../../cube/pick.ts';
import { aiLabelFrom } from '../../draft/aiLabel.ts';
import { canPass, expectedPicks, knownAiCards, lineName, progress, toAct, yourPack, type BoosterDraft, type Draft, type GridDraft, type WinstonDraft } from '../../draft/draft.ts';
import { bestBoosterPick, buildPickPrompt, pickPromptCards } from '../../draft/pickPrompt.ts';
import { startAnswer, stopAnswer, useAnswer } from '../answers.ts';
import { cardsForPrompt, prefetchCards } from '../cardData.ts';
import { AnswerBox } from '../CoachPanel.tsx';
import { IconChevronLeft } from '../Icons.tsx';
import { CubeGuideSheet } from '../guide/CubeGuide.tsx';
import { Sheet } from '../Sheet.tsx';
import { cx } from '../util.ts';
import { CardInfoSheet } from '../deck/sheets.tsx';
import { SizeSlider, usePrefs, type Zone } from './Collection.tsx';
import { DCard } from './DCard.tsx';
import { GridBoard } from './GridBoard.tsx';
import { AiBanner, Dock, Kebab, SeatChips, Timer, useCountdown, type Action, type Seat } from './Panels.tsx';
import { PoolPanel, PoolSheet } from './Pool.tsx';
import { useCubeMeta } from './useCubeMeta.ts';
import { LabNumbers } from './LabNumbers.tsx';
import type { DraftGame } from './useDraftGame.ts';
import { WinstonBoard } from './WinstonBoard.tsx';

const KICKER = { grid: 'Grid draft', winston: 'Winston draft', booster: 'Booster draft' } as const;

function hashOf(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/**
 * `opponent`: Draft with a friend (draft/room.ts) — the friend's name, in place of
 * the AI everywhere the screen names the other seat. Absent: Draft vs AI, unchanged.
 * `notice`: a line over the offer (the room's connection state).
 */
export function PickScreen({ game, draft: d, onLeave, onSettings, opponent, notice }: { game: DraftGame; draft: Draft; onLeave: () => void; onSettings: () => void; opponent?: string; notice?: string | null }) {
  const them = opponent ?? 'the AI';
  const Them = opponent ?? 'The AI';
  const ctx = game.data.ctx!;
  const meta = useCubeMeta(ctx)!;
  const hints = game.saved?.hints ?? true;
  const side = game.saved?.side ?? [];
  const mine = toAct(d) === 'you' && !game.aiBusy;
  const known = useMemo(() => knownAiCards(d), [d]);
  const [info, setInfo] = useState<string | null>(null);
  const [poolOpen, setPoolOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [coach, setCoach] = useState(false);
  const [guide, setGuide] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [offerPrefs, setOfferPrefs] = usePrefs('draft-offer', { layout: 'gallery', group: 'none', size: 150 });
  const cube = cubeInfo(d.cubeId);

  // Images: what is on the table first, then the rest of the dealt cards.
  useEffect(() => {
    prefetchCards(d.format === 'grid' ? d.dealt.slice(d.g * 9, d.g * 9 + 18) : d.format === 'winston' ? d.piles.flat() : (d.table[0] ?? []));
  }, [d]);
  useEffect(() => prefetchCards(d.dealt), [d.dealt]);
  // A new decision clears the selection.
  const stepKey = `${d.log.length}:${d.format === 'grid' ? `${d.g}:${d.firstLine}` : ''}`;
  useEffect(() => {
    setSel(null);
    setPreview(null);
    setPick(null);
  }, [stepKey]);

  // The pick helper (src/cube/pick.ts) for your decision.
  const advice = useMemo(() => {
    if (!mine) return null;
    if (d.format === 'grid') {
      const a = recommendGrid(d.slots, d.picks.you, ctx, known);
      if (!a.best) return null;
      return { title: `Take the ${a.best.line.label.toLowerCase()}`, lines: a.best.reasons, line: GRID_LINES.findIndex((l) => l.id === a.best!.line.id), take: null, card: null };
    }
    if (d.format === 'booster') {
      const b = bestBoosterPick(yourPack(d), d.picks.you, ctx, known);
      if (!b) return null;
      return { title: `Pick ${b.name}`, lines: b.ranked.slice(0, 4).map((r) => `${r.name}: ${r.value}`), line: null, take: null, card: b.name };
    }
    const pile = d.piles[d.look] ?? [];
    if (!pile.length) return null;
    const a = recommendWinston({ pile, pileIndex: (d.look + 1) as 1 | 2 | 3, sizes: d.piles.map((p) => p.length) as [number, number, number], pool: d.picks.you, oppPool: known, seen: d.seen.you }, ctx);
    return { title: a.action === 'take' ? `Take pile ${d.look + 1}` : `Pass pile ${d.look + 1}`, lines: a.reasons, line: null, take: a.action === 'take', card: null };
  }, [mine, d, ctx, known]);

  // The decision: title, mono line, actions.
  const pr = progress(d);
  let title = pr.label;
  let offer = '';
  let primary: Action | undefined;
  let secondary: Action | undefined;
  let status: string | null = null;
  let waiting: string | null = null;
  if (d.format === 'grid') {
    const g = d as GridDraft;
    const n = g.slots.filter(Boolean).length;
    offer = `${n} cards on offer · you pick ${g.firstLine === null ? 'first' : 'second'}`;
    if (!mine) waiting = `${Them} picks a line…`;
    const lineN = sel !== null ? GRID_LINES[sel]!.slots.filter((i) => g.slots[i]).length : 0;
    status = sel !== null ? `${lineN} card${lineN === 1 ? '' : 's'} selected · ${lineName(sel)}` : mine ? 'Choose a row or a column' : null;
    primary = { label: sel === null ? 'Take line' : `Take ${sel < 3 ? 'row' : 'column'}`, onClick: () => sel !== null && game.act({ kind: 'line', line: sel }), disabled: !mine || sel === null, kbd: 'Enter' };
  } else if (d.format === 'winston') {
    const w = d as WinstonDraft;
    const n = w.piles[w.look]?.length ?? 0;
    title = d.done ? 'Draft complete' : `Pile ${w.look + 1}`;
    offer = `${n} card${n === 1 ? '' : 's'} in the pile · ${w.stack.length} in the stack`;
    if (!mine) waiting = `The AI looks at pile ${w.look + 1}…`;
    const pass = canPass(w);
    status = mine ? (pass ? (w.piles.slice(w.look + 1).every((p) => !p.length) ? 'Pass, and you take the top card of the stack blind' : 'Pass, and the pile grows by a card') : 'The stack is empty: this pile is yours') : null;
    primary = { label: 'Take pile', onClick: () => game.act({ kind: 'take' }), disabled: !mine, kbd: 'Enter' };
    secondary = { label: 'Pass', onClick: () => game.act({ kind: 'pass' }), disabled: !mine || !pass, kbd: 'P' };
  } else {
    const b = d as BoosterDraft;
    offer = `${yourPack(b).length} cards on offer`;
    status = pick ? `Picking ${pick}` : mine ? 'Choose a card' : null;
    primary = { label: 'Pick', onClick: () => pick && game.act({ kind: 'pick', card: pick }), disabled: !pick, kbd: 'Enter' };
    // Your last pick, until your next one: only then does the next seat pick from that pack.
    if (game.canUndo) secondary = { label: 'Undo pick', onClick: game.undo, disabled: false, kbd: 'Z' };
  }
  // The cards on offer, for the lab numbers panel.
  const offerNames = useMemo(
    () => (d.format === 'grid' ? (d as GridDraft).slots.filter((x): x is string => !!x) : d.format === 'winston' ? ((d as WinstonDraft).piles[(d as WinstonDraft).look] ?? []) : yourPack(d)),
    [d],
  );
  const poolOf = Math.round(expectedPicks(d));
  const mono = `${offer} · pool ${d.picks.you.length} / ${d.format === 'booster' ? '' : '~'}${poolOf}`;

  // Pick timer: at zero the pick helper's choice is made for you.
  const auto = useCallback(() => {
    if (!mine) return;
    if (d.format === 'booster') {
      const c = pick ?? advice?.card ?? yourPack(d)[0];
      if (c) game.act({ kind: 'pick', card: c });
    } else if (d.format === 'grid') {
      const l = sel ?? advice?.line;
      if (l !== null && l !== undefined && l >= 0) game.act({ kind: 'line', line: l });
    } else game.act({ kind: advice?.take === false && canPass(d) ? 'pass' : 'take' });
  }, [mine, d, pick, sel, advice, game]);
  const timerTotal = game.saved?.timer ?? 0;
  const left = useCountdown(timerTotal, mine && !d.done, stepKey, auto);

  // Keys: Enter acts, P passes (Winston), Z undoes a pick (Booster), Escape clears a selection.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement || document.querySelector('.sheet-backdrop')) return;
      if (e.key === 'Enter' && primary && !primary.disabled) {
        e.preventDefault();
        primary.onClick();
      } else if (secondary?.kbd && e.key.toLowerCase() === secondary.kbd.toLowerCase() && !secondary.disabled && !e.metaKey && !e.ctrlKey) secondary.onClick();
      else if (e.key === 'Escape') {
        setSel(null);
        setPick(null);
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  const moveSide = (name: string, to: Zone) => {
    const s = game.saved?.side ?? [];
    game.update({ side: to === 'side' ? [...s, name] : s.filter((x, i) => !(x === name && i === s.indexOf(name))) });
  };
  const mainPool = useMemo(() => {
    const out = [...d.picks.you];
    for (const n of side) {
      const i = out.indexOf(n);
      if (i >= 0) out.splice(i, 1);
    }
    return out;
  }, [d.picks.you, side]);

  const seats: Seat[] = [
    { id: 'you', label: 'You', active: mine },
    { id: 'ai', label: opponent ?? 'Forge AI', bot: !opponent, active: !mine && !d.done, onClick: () => setAiOpen(true) },
    ...(d.format === 'booster' ? d.bots.map((_, i) => ({ id: `bot${i + 2}`, label: `Bot ${i + 2}`, bot: true })) : []),
  ];
  const lastBlind = d.log[d.log.length - 1];

  return (
    <div className={cx('fx pk', `is-${d.format}`)}>
      <header className="pk-head">
        <div className="pk-titles">
          <div className="pk-kicker">
            <button className="pk-back" onClick={onLeave} aria-label="Leave the table (the draft is saved)">
              <IconChevronLeft size={14} />
            </button>
            <span className="fx-label">{KICKER[d.format]}</span>
            <span className="pk-cube">{game.saved?.title || cube?.title}</span>
          </div>
          <h1 className="pk-title">{title}</h1>
          <div className="pk-mono">{mono}</div>
          <SeatChips seats={seats} />
        </div>
        {/* Phones have no kebab: the guide gets a quiet link of its own. */}
        <button type="button" className="pk-guide" onClick={() => setGuide(true)}>
          Guide
        </button>
        <div className="pk-actions">
          {left !== null && mine && <Timer left={left} total={timerTotal} />}
          {secondary && (
            <button className="btn-line pk-second" onClick={secondary.onClick} disabled={secondary.disabled}>
              {secondary.label} {secondary.kbd && <kbd>{secondary.kbd}</kbd>}
            </button>
          )}
          {primary && (
            <button className="btn-gold pk-primary" onClick={primary.onClick} disabled={primary.disabled}>
              {primary.label} {primary.kbd && <kbd>{primary.kbd}</kbd>}
            </button>
          )}
          <Kebab
            items={[
              { label: 'Ask the coach', onClick: () => setCoach(true), disabled: !mine },
              { label: 'Hints', checked: hints, onClick: () => game.update({ hints: !hints }) },
              { label: d.format === 'grid' ? `${Them}’s picks` : `What you know ${them} has`, onClick: () => setAiOpen(true) },
              { label: 'Guide', onClick: () => setGuide(true) },
              { label: 'Coach settings', onClick: onSettings },
              { label: 'Leave the table', onClick: onLeave, danger: true },
            ]}
          />
        </div>
      </header>

      <section className="pk-offer" style={{ '--offer-cw': `${offerPrefs.size}px` } as CSSProperties}>
        {d.format !== 'grid' && (
          <div className="pk-size">
            <SizeSlider value={offerPrefs.size} onChange={(size) => setOfferPrefs({ size })} min={90} max={240} />
          </div>
        )}
        {notice && <div className="aibanner is-you" role="status">{notice}</div>}
        <AiBanner e={game.aiNote} d={d} them={opponent} />
        {lastBlind?.who === 'you' && lastBlind.kind === 'blind' && <div className="aibanner is-you">You took the top card blind: {lastBlind.cards[0]}</div>}
        {status && <p className="pk-status">{sel !== null || pick ? <span className="dot" /> : null}{status}</p>}
        {d.format === 'grid' ? (
          <GridBoard d={d} mine={mine} selected={sel} preview={preview} hint={hints ? (advice?.line ?? null) : null} aiLine={game.aiLine} onSelect={setSel} onPreview={setPreview} onInfo={setInfo} />
        ) : d.format === 'winston' ? (
          <WinstonBoard d={d} mine={mine} hintTake={hints && advice ? advice.take : null} onInfo={setInfo} />
        ) : (
          <div className={cx('pack', pick && 'has-pick')}>
            {yourPack(d).map((n, i) => (
              <DCard
                key={n}
                name={n}
                big
                className="pack-card"
                style={{ '--k': i } as CSSProperties}
                states={['new', pick === n ? 'sel' : null, hints && advice?.card === n && pick !== n ? 'hint' : null]}
                onClick={() => setPick(pick === n ? null : n)}
                label={`${n}${pick === n ? ' (selected)' : ''}`}
              />
            ))}
          </div>
        )}
        <LabNumbers names={offerNames} ctx={ctx} cubeId={d.cubeId} />
      </section>

      <div className="pk-divider" aria-hidden="true" />

      <PoolPanel names={mainPool} side={side} meta={meta} of={poolOf} onMove={moveSide} onInfo={setInfo} />

      <Dock primary={primary} secondary={secondary} status={status ? <span className="dock-title">{status}</span> : null} waiting={waiting} pool={d.picks.you.length} onPool={() => setPoolOpen(true)} />

      <PoolSheet open={poolOpen} onClose={() => setPoolOpen(false)} names={d.picks.you} meta={meta} title="Your pool" onInfo={setInfo} />
      <PoolSheet
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        names={known}
        meta={meta}
        title={d.format === 'grid' ? `${Them}’s picks` : `What you know ${them} has`}
        hiddenCount={d.picks.ai.length - known.length}
        label={`Looks like: ${aiLabelFrom(known, ctx).text}`}
        onInfo={setInfo}
        prefsKey="ai-sheet"
      />
      <CubeGuideSheet open={guide} onClose={() => setGuide(false)} cubeId={d.cubeId} meta={game.data.meta} colors={guide ? poolColours(d.picks.you, ctx) : ''} onInfo={setInfo} />
      <PickCoach open={coach} onClose={() => setCoach(false)} game={game} d={d} advice={advice} onSettings={onSettings} opponent={opponent} />
      <CardInfoSheet name={info} ctx={ctx} pool={d.picks.you} onClose={() => setInfo(null)} cubeId={d.cubeId} />
    </div>
  );
}

function PickCoach({ open, onClose, game, d, advice, onSettings, opponent }: { open: boolean; onClose: () => void; game: DraftGame; d: Draft; advice: { title: string; lines: string[] } | null; onSettings: () => void; opponent?: string }) {
  const ctx = game.data.ctx!;
  const [q, setQ] = useState('');
  const key = `pick:${d.id}:${d.log.length}:${hashOf(q.trim())}`;
  const answer = useAnswer(key);
  const makePrompt = useCallback(async () => buildPickPrompt({ ctx, draft: d, infos: await cardsForPrompt(pickPromptCards(d)), question: q, opponent }), [ctx, d, q, opponent]);
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
      <textarea className="coach-q" rows={2} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about this pick (optional)" aria-label="Question for the coach" />
      <AnswerBox
        answer={answer}
        askLabel="Ask the coach"
        idleText={
          opponent
            ? `The coach reads this pick, your pool, ${opponent}’s picks (a grid draft is face up) and every card’s text. Its advice stays in this browser: ${opponent} never sees it.`
            : 'The coach reads this pick, your pool, what you know the AI has and every card’s text. It never sees the AI’s hidden picks.'
        }
        onAsk={() => void startAnswer(key, makePrompt)}
        onStop={() => stopAnswer(key)}
        makePrompt={makePrompt}
        onOpenSettings={onSettings}
      />
    </Sheet>
  );
}
