/*
 * ForgeCoach — ui/cardRefs.test.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The coach's engine ids read as the board shows the card (common-sense pass
 * item 11, observed turn 22: "block Construct Token #297 with Phyrexian Myr
 * Token"): in combat the lane badge's number, else what tells two
 * same-named cards apart (P/T, tapped, place in the row); never the id. The
 * plan's steps, the check's reasons and Markdown answers all go through it,
 * and hovering a step lights the cards it names (boardFocus.ts).
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import type { AnyCard, Card, GameStateBody } from '../protocol.ts';
import { boardFocus, setBoardFocus } from './boardFocus.ts';
import { cardRefText, namedCardIds, splitCardRefs, type CardRefLook } from './cardRefs.ts';
import { CardRefContext, CoachText } from './CoachText.tsx';
import { Markdown } from './Markdown.tsx';
import { PlanView } from './play/PlanView.tsx';
import type { AdviceEntry } from './play/autoPlan.ts';
import type { Answer } from './answers.ts';

function card(id: number, name: string, extra: Partial<Card> = {}): Card {
  return {
    id, name, setCode: 'ONE', manaCost: '', types: 'Artifact Creature - Construct', power: '4', toughness: '4', loyalty: null, damage: 0, counters: {},
    tapped: false, sick: false, attacking: false, blocking: false, faceDown: false, token: true, alt: null, attachedToId: null, attachmentIds: [],
    controller: 1, owner: 1, zone: 'battlefield', abilities: [], ...extra,
  } as unknown as Card;
}

function state(mine: AnyCard[], theirs: AnyCard[], combat: GameStateBody['combat'] = null, hand: AnyCard[] = []): GameStateBody {
  const zones = (bf: AnyCard[], h: AnyCard[] = []) => ({
    hand: { count: h.length, cards: h }, library: { count: 30, cards: [] }, graveyard: { count: 0, cards: [] },
    battlefield: { count: bf.length, cards: bf }, exile: { count: 0, cards: [] }, command: { count: 0, cards: [] },
  });
  return {
    turn: 22, round: 11, phase: combat ? 'COMBAT_DECLARE_BLOCKERS' : 'MAIN1', activePlayer: 1, priority: 0,
    players: [
      { id: 0, name: 'Justin', life: 5, poison: 0, manaPool: {}, counters: {}, zones: zones(mine, hand) },
      { id: 1, name: 'Search AI', life: 20, poison: 0, manaPool: {}, counters: {}, zones: zones(theirs) },
    ],
    stack: [], stackCards: [], combat, events: [],
  } as unknown as GameStateBody;
}

const myr = card(310, 'Phyrexian Myr Token', { controller: 0, owner: 0, power: '1', toughness: '1' });
const c296 = card(296, 'Construct Token', { power: '2', toughness: '2', attacking: true });
const c297 = card(297, 'Construct Token', { attacking: true });
const combat = { bands: [{ attackerIds: [296, 297], defender: { kind: 'player', id: 0 }, blockerIds: [], damageOrder: [] }] } as unknown as GameStateBody['combat'];
const inCombat: CardRefLook = { state: state([myr], [c296, c297], combat) };
const STEP = 'block Construct Token #297 with Phyrexian Myr Token';

afterEach(() => setBoardFocus(null));

describe('engine ids in the coach\'s words', () => {
  it('in combat: the lane badge number, the name kept, the id gone', () => {
    const segs = splitCardRefs(STEP, inCombat);
    expect(segs).toEqual(['block ', { id: 297, text: 'Construct Token', tag: '2', combat: true }, ' with Phyrexian Myr Token']);
    expect(cardRefText(STEP, inCombat)).toBe('block Construct Token 2 with Phyrexian Myr Token');
  });

  it('outside combat: the P/T when it tells them apart, else tapped / untapped, else the place in the row', () => {
    const quiet = { state: state([myr], [card(296, 'Construct Token', { power: '2', toughness: '2' }), card(297, 'Construct Token')]) };
    expect(cardRefText(STEP, quiet)).toBe('block Construct Token 4/4 with Phyrexian Myr Token');
    const tapped = { state: state([], [card(296, 'Construct Token', { tapped: true }), card(297, 'Construct Token')]) };
    expect(cardRefText('attack Construct Token #297', tapped)).toBe('attack Construct Token untapped');
    const same = { state: state([], [card(296, 'Construct Token'), card(297, 'Construct Token'), card(298, 'Construct Token')]) };
    expect(cardRefText('Construct Token #297', same)).toBe('Construct Token 2nd from left');
  });

  it('a unique name needs nothing; the log\'s [id] spelling and a name without "Token" too', () => {
    const one = { state: state([myr], [card(297, 'Construct Token')]) };
    expect(cardRefText('kill Construct Token #297 first', one)).toBe('kill Construct Token first');
    expect(cardRefText('Construct [297] attacked', one)).toBe('Construct attacked');
    expect(splitCardRefs('Construct #297', one)).toEqual([{ id: 297, text: 'Construct', tag: null, combat: false }]);
  });

  it('an id the board does not show (hidden, gone) loses only its number; no board: ids out', () => {
    const one = { state: state([], [{ id: 400, hidden: true } as unknown as AnyCard]) };
    expect(cardRefText('a face-down card #400 and card #999', one)).toBe('a face-down card and card');
    expect(cardRefText(STEP, null)).toBe('block Construct Token with Phyrexian Myr Token');
  });

  it('the cards a step names: its ids, and every visible card it spells out', () => {
    expect(namedCardIds(STEP, inCombat).sort()).toEqual([297, 310]);
    expect(namedCardIds('attack with Construct Token', inCombat).sort()).toEqual([296, 297]);
    expect(namedCardIds(STEP, null)).toEqual([]);
  });
});

describe('drawn', () => {
  const html = (node: React.ReactNode, look: CardRefLook | null = inCombat) => renderToStaticMarkup(<CardRefContext.Provider value={look}>{node}</CardRefContext.Provider>);

  it('CoachText: the badge number as a chip, never "#297"', () => {
    const out = html(<CoachText text={STEP} />);
    expect(out).toContain('class="coach-card"');
    expect(out).toContain('class="coach-card-n"');
    expect(out).not.toMatch(/#\d|297/);
  });

  it('the engine labels a step quotes lose their bookkeeping (seen against real Forge: "choose Nyxborn Hydra - Creature 0 / 1 (X=0)")', () => {
    const out = html(<CoachText text="choose Nyxborn Hydra - Creature 0 / 1 (X=0)" />);
    expect(out).toBe('choose Nyxborn Hydra - Creature 0 / 1');
    expect(html(<CoachText text={`${STEP} (Exiled=0)`} />)).not.toMatch(/Exiled|297/);
  });

  it('Markdown answers (short and detailed styles) read ids the same way', () => {
    const out = html(<Markdown text={'**Block** Construct Token #297 with your Myr.\n\n- keep Phyrexian Myr Token #310 back'} />);
    expect(out).not.toMatch(/#\d|297|310/);
    expect(out).toContain('coach-card');
  });

  it('a plan\'s steps: no engine id, the named card named as the board shows it', () => {
    const entry = { key: 'k', kind: 'plan', label: 'Your blocks', forTurn: 22, frameIndex: 0, decision: null, seq: 1, moment: { kind: 'blocks', id: 'blocks:22', question: 'q', label: 'Your blocks' } } as unknown as AdviceEntry;
    const answer = { status: 'done', text: `PLAN: Chump the 4/4 Construct Token #297 to stay alive.\nSTEPS:\n1. ${STEP}\n2. pass\nEND` } as unknown as Answer;
    const out = html(<PlanView entry={entry} answer={answer} log={null} seat={0} />);
    expect(out).toContain('plan-steps');
    expect(out).toContain('Construct Token');
    expect(out).not.toMatch(/#\d|297/);
  });

  it('focus: a step lights the cards it names, and goes out', () => {
    setBoardFocus(namedCardIds(STEP, inCombat));
    expect([...boardFocus()].sort()).toEqual([297, 310]);
    setBoardFocus(null);
    expect(boardFocus().size).toBe(0);
  });
});
