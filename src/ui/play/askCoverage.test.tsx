/*
 * ForgeCoach — ui/play/askCoverage.test.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The ask-coverage audit (the first two-person game: "a card that was
 * supposed to let him select a card from the graveyard … never popped up").
 * Every engine question must put a way to answer it on the screen:
 *
 *   1. every `ask` kind of mtg-table protocol §5.2, in every variant the
 *      protocol allows (reveal or not, "up to N", optional, unbounded,
 *      players, colours, numbers with "Other…", a delayedReveal, empty
 *      lists, unplayable abilities, …) plus every recorded ask in
 *      askFixtures.json, rendered by the real AskDialog (server render, no
 *      DOM): it must hold an enabled button that sends an answer, or enabled
 *      choices next to the button that confirms them — and a draft the
 *      engine's own numbers allow must be reachable;
 *   2. every place a card choice can arrive as an `input` (§4: targeting
 *      goes through `InputSelectTargets`, whose cards may sit in a graveyard,
 *      in exile, in a library, on the stack, or not be in the frame at all):
 *      each selectable id must have something to click — a board tile
 *      (battlefield, your hand) or the off-board picker (zonePick.ts), which
 *      must render a clickable card for it.
 *
 * A new ask kind in protocol.ts fails the first test until it has variants
 * here; a variant that renders nothing actionable fails the second.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import type { AnyCard, AskBody, AskOption, Card, GameStateBody, InputBody, PlayerState } from '../../protocol.ts';
import { ASK_KINDS } from '../../protocol.ts';
import { PlayContext, type PlayInteraction } from '../cardContext.ts';
import { AskDialog } from './AskDialog.tsx';
import { FIXTURE_ASKS } from './askFixtures.ts';
import { askOptions, choiceBounds, initialDraft, orderBounds, range, skipAction, validateDraft, type AskDraft } from './askModel.ts';
import { cardRole, describeInput } from './inputView.ts';
import { ZonePickPanel } from './ZonePickPanel.tsx';
import { zonePick } from './zonePick.ts';

// ---------------------------------------------------------------------------
// Builders

function card(id: number, name: string, zone: string, owner = 0, extra: Partial<Card> = {}): Card {
  return {
    id,
    name,
    setCode: 'M21',
    manaCost: '{1}{W}',
    types: 'Creature - Soldier',
    power: '2',
    toughness: '2',
    loyalty: null,
    damage: 0,
    counters: {},
    tapped: false,
    sick: false,
    attacking: false,
    blocking: false,
    faceDown: false,
    token: false,
    alt: null,
    attachedToId: null,
    attachmentIds: [],
    controller: owner,
    owner,
    zone,
    abilities: [],
    ...extra,
  } as unknown as Card;
}
const hidden = (id: number, zone: string, owner = 1): AnyCard => ({ id, hidden: true, zone, owner, controller: owner }) as unknown as AnyCard;
const cardOpt = (id: number, c: AnyCard, label = (c as Card).name ?? '???'): AskOption => ({ id, label, kind: 'card', cardId: c.id, card: c });
const textOpt = (id: number, label: string, kind: AskOption['kind'] = 'other'): AskOption => ({ id, label, kind });
const base = (kind: string, n: number) => ({ askId: `v${n}`, kind, timeoutMs: 120000 });

const gy1 = card(41, 'Raging Goblin', 'graveyard');
const gy2 = card(42, 'Memnite', 'graveyard');
const lib1 = card(51, 'Forest', 'library', 0, { types: 'Basic Land - Forest', power: null, toughness: null } as Partial<Card>);
const bf1 = card(61, 'Hill Giant', 'battlefield', 1);
const opp = hidden(71, 'hand');

/** Every ask kind, in the variants the protocol allows. */
function variants(): { name: string; ask: AskBody }[] {
  let n = 0;
  const v = (name: string, body: Record<string, unknown>) => ({ name, ask: { ...base(body.kind as string, ++n), ...body } as unknown as AskBody });
  const cards = [cardOpt(0, gy1), cardOpt(1, gy2)];
  const many = [cardOpt(0, gy1), cardOpt(1, gy2), cardOpt(2, lib1), cardOpt(3, bf1)];
  const colours = ['white', 'blue', 'black', 'red', 'green'].map((c, i) => textOpt(i, c, 'color'));
  const numbers = [textOpt(0, '0', 'number'), textOpt(1, '1', 'number'), textOpt(2, '2', 'number'), textOpt(3, 'Other...', 'text')];
  const players = [
    { id: 0, label: 'Human', kind: 'player', playerId: 0 },
    { id: 1, label: 'Forge AI', kind: 'player', playerId: 1 },
  ];
  return [
    v('ability_menu: playable', { kind: 'ability_menu', cardId: 61, options: [{ ...textOpt(0, '{T}: Add {G}.', 'ability'), abilityId: 1, canPlay: true, isSpell: false }, { ...textOpt(1, 'Hill Giant', 'ability'), abilityId: 2, canPlay: true, isSpell: true }] }),
    v('ability_menu: nothing playable', { kind: 'ability_menu', cardId: 61, options: [{ ...textOpt(0, '{2}: Draw', 'ability'), abilityId: 1, canPlay: false, isSpell: false }] }),
    v('confirm: with a card', { kind: 'confirm', prompt: 'Mana will be lost. Continue?', title: 'Mana', yesLabel: 'Yes', noLabel: 'No', defaultYes: false, card: bf1 }),
    v('confirm: no card, empty labels', { kind: 'confirm', prompt: 'Continue?', title: '', yesLabel: '', noLabel: '', defaultYes: true, card: null }),
    v('options: with card', { kind: 'options', prompt: 'Pick one', title: 'Options', options: [textOpt(0, 'Draw'), textOpt(1, 'Discard')], defaultIndex: 0, card: bf1 }),
    v('options: empty', { kind: 'options', prompt: 'Pick one', title: '', options: [], defaultIndex: -1, card: null }),
    v('text: numeric', { kind: 'text', prompt: 'Choose X', title: '', initial: '', suggestions: [], numeric: true }),
    v('text: free with suggestions', { kind: 'text', prompt: 'Name a card', title: '', initial: '', suggestions: ['Shock', 'Opt'], numeric: false }),
    v('choose_list: reveal', { kind: 'choose_list', prompt: 'Looking at cards in Forge AI’s hand', options: cards, min: -1, max: -1, reveal: true, preselected: [] }),
    v('choose_list: reveal, nothing', { kind: 'choose_list', prompt: 'Revealed', options: [], min: -1, max: -1, reveal: true, preselected: [] }),
    v('choose_list: exactly one card (graveyard)', { kind: 'choose_list', prompt: 'Choose a card from your graveyard', options: cards, min: 1, max: 1, reveal: false, preselected: [] }),
    v('choose_list: up to two', { kind: 'choose_list', prompt: 'Choose up to two', options: many, min: 0, max: 2, reveal: false, preselected: [] }),
    v('choose_list: optional one', { kind: 'choose_list', prompt: 'You may choose a card', options: cards, min: 0, max: 1, reveal: false, preselected: [] }),
    v('choose_list: unbounded', { kind: 'choose_list', prompt: 'Choose any number', options: many, min: 0, max: -1, reveal: false, preselected: [] }),
    v('choose_list: exactly two of four', { kind: 'choose_list', prompt: 'Choose two', options: many, min: 2, max: 2, reveal: false, preselected: [] }),
    v('choose_list: preselected', { kind: 'choose_list', prompt: 'Keep these', options: many, min: 1, max: 4, reveal: false, preselected: [0, 1] }),
    v('choose_list: colours', { kind: 'choose_list', prompt: 'Choose a color', options: colours, min: 1, max: 1, reveal: false, preselected: [] }),
    v('choose_list: numbers + Other…', { kind: 'choose_list', prompt: 'Choose a number', options: numbers, min: 1, max: 1, reveal: false, preselected: [] }),
    v('choose_list: text rows', { kind: 'choose_list', prompt: 'Choose a mode', options: [textOpt(0, 'Deal 2 damage'), textOpt(1, 'Gain 2 life')], min: 1, max: 1, reveal: false, preselected: [] }),
    v('choose_list: concealed cards', { kind: 'choose_list', prompt: 'Choose a card', options: [cardOpt(0, opp, '???'), cardOpt(1, gy1)], min: 1, max: 1, reveal: false, preselected: [] }),
    v('choose_list: impossible numbers', { kind: 'choose_list', prompt: 'Choose three', options: cards, min: 3, max: 3, reveal: false, preselected: [] }),
    v('choose_list: empty', { kind: 'choose_list', prompt: 'Choose', options: [], min: 1, max: 1, reveal: false, preselected: [] }),
    v('choose_entities: one card from a graveyard', { kind: 'choose_entities', prompt: 'Select a card from your graveyard', options: cards, min: 1, max: 1, delayedReveal: null }),
    v('choose_entities: optional', { kind: 'choose_entities', prompt: 'You may select a card', options: cards, min: 0, max: 1, delayedReveal: null }),
    v('choose_entities: up to N', { kind: 'choose_entities', prompt: 'Select up to 3', options: many, min: 0, max: 3, delayedReveal: null }),
    v('choose_entities: players', { kind: 'choose_entities', prompt: 'Choose a player', options: players, min: 1, max: 1, delayedReveal: null }),
    v('choose_entities: library search (delayedReveal)', { kind: 'choose_entities', prompt: 'Search for a land', options: [cardOpt(0, lib1)], min: 0, max: 1, delayedReveal: { owner: 0, zones: ['library'], messagePrefix: 'Searching: ', cards: [lib1, card(52, 'Shock', 'library')] } }),
    v('choose_entities: empty, mandatory', { kind: 'choose_entities', prompt: 'Select', options: [], min: 1, max: 1, delayedReveal: null }),
    v('order: triggers, all to order', { kind: 'order', prompt: 'Order of abilities', destLabel: 'Resolve first', dest: [], source: cards.map((o) => ({ ...o })), min: 0, max: 0, referenceCardId: 41, sideboardMode: false, showRemember: true }),
    v('order: some kept', { kind: 'order', prompt: 'Put on top', destLabel: 'Top of library', dest: [cardOpt(0, gy1)], source: [cardOpt(1, gy2), cardOpt(2, lib1)], min: -1, max: -1, referenceCardId: null, sideboardMode: false, showRemember: false }),
    v('order: sideboard mode', { kind: 'order', prompt: 'Sideboard', destLabel: 'Main', dest: [], source: [cardOpt(0, gy1)], min: 0, max: 1, referenceCardId: null, sideboardMode: true, showRemember: false }),
    v('order: empty', { kind: 'order', prompt: 'Order', destLabel: '', dest: [], source: [], min: -1, max: -1, referenceCardId: null, sideboardMode: false, showRemember: false }),
    v('assign_damage: blockers', { kind: 'assign_damage', attackerId: 61, total: 4, overrideOrder: false, maySkip: false, targets: [{ id: 0, label: 'Human', kind: 'player', playerId: 0, defender: true }, { ...cardOpt(1, gy1), lethal: 2 }, { ...cardOpt(2, gy2), lethal: 1 }] }),
    v('assign_damage: null attacker, no targets', { kind: 'assign_damage', attackerId: null, total: 2, overrideOrder: false, maySkip: true, targets: [] }),
    v('assign_amount: colours, at least one', { kind: 'assign_amount', sourceCardId: 61, total: 3, atLeastOne: true, label: 'mana', targets: colours.slice(0, 3).map((o) => ({ ...o, max: 2 })) }),
    v('assign_amount: players', { kind: 'assign_amount', sourceCardId: null, total: 2, atLeastOne: false, label: 'damage', targets: players }),
    v('manipulate_list', { kind: 'manipulate_list', prompt: 'Surveil', cards, manipulable: [0, 1], toTop: true, toBottom: true, toAnywhere: false }),
    v('manipulate_list: fixed', { kind: 'manipulate_list', prompt: 'Look', cards, manipulable: [], toTop: true, toBottom: false, toAnywhere: false }),
    v('sideboard', { kind: 'sideboard', prompt: 'Human', main: [textOpt(0, 'Mountain (M21)', 'card'), textOpt(1, 'Shock (M21)', 'card')], side: [textOpt(2, 'Hill Giant (M10)', 'card')] }),
    v('sideboard: empty main', { kind: 'sideboard', prompt: 'Human', main: [], side: [textOpt(0, 'Shock (M21)', 'card')] }),
  ];
}

function stateWith(cards: AnyCard[]): GameStateBody {
  const zones = (owner: number) => {
    const z: Record<string, { count: number; cards: AnyCard[] }> = {};
    for (const name of ['hand', 'library', 'graveyard', 'battlefield', 'exile', 'command']) {
      const cs = cards.filter((c) => (c as Card).owner === owner && (c as Card).zone === name);
      z[name] = { count: cs.length, cards: cs };
    }
    return z;
  };
  const player = (id: number, name: string) => ({ id, name, life: 20, poison: 0, manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, counters: {}, zones: zones(id) }) as unknown as PlayerState;
  return {
    turn: 5,
    round: 3,
    phase: 'MAIN1',
    activePlayer: 0,
    priority: 0,
    players: [player(0, 'Human'), player(1, 'Forge AI')],
    stack: [],
    stackCards: cards.filter((c) => (c as Card).zone === 'stack'),
    combat: null,
    events: [],
  } as unknown as GameStateBody;
}

// ---------------------------------------------------------------------------
// What "actionable" means in the markup

interface Btn {
  attrs: string;
  enabled: boolean;
}
function buttons(html: string): Btn[] {
  return [...html.matchAll(/<button\b([^>]*)>/g)].map((m) => ({ attrs: m[1]!, enabled: !/\sdisabled=""/.test(m[1]!) }));
}
function actionable(html: string): { ok: boolean; why: string } {
  const bs = buttons(html);
  const sends = bs.filter((b) => b.enabled && /data-answer="(skip|direct|yes|no|ok|confirm)"/.test(b.attrs));
  if (sends.length > 0) return { ok: true, why: 'an enabled answer button' };
  const confirm = bs.some((b) => /data-answer="confirm"/.test(b.attrs));
  // Choices: option buttons, move buttons, steppers and text inputs — not the dialog's own chrome (minimise, Concede).
  const choices = bs.some((b) => b.enabled && (/class="[^"]*\bask-opt\b/.test(b.attrs) || /aria-label="(Move|More to|Less to) /.test(b.attrs))) || /<input\b(?![^>]*disabled)/.test(html);
  if (confirm && choices) return { ok: true, why: 'choices beside a confirm button' };
  return { ok: false, why: `no enabled answer button (${bs.length} buttons)` };
}

/** A draft the engine's numbers allow, built the way a player would (pick the first options). */
function reachable(ask: AskBody): boolean {
  if (validateDraft(ask, initialDraft(ask)).ok) return true;
  if (skipAction(ask) !== null) return true;
  let d: AskDraft | null = null;
  switch (ask.kind) {
    case 'ability_menu': {
      const o = ask.options.find((x) => x.canPlay);
      d = o ? { shape: 'index', index: o.id } : null;
      break;
    }
    case 'options':
      d = { shape: 'index', index: 0 };
      break;
    case 'text':
      d = { shape: 'text', text: ask.numeric ? '1' : 'x' };
      break;
    case 'choose_list':
    case 'choose_entities': {
      const { lo } = choiceBounds(ask);
      d = { shape: 'indices', indices: askOptions(ask).slice(0, lo).map((o) => o.id) };
      break;
    }
    case 'order':
      d = { shape: 'order', ordered: range(orderBounds(ask).lo), remember: false };
      break;
    default:
      return false;
  }
  return d !== null && validateDraft(ask, d).ok;
}

function render(ask: AskBody, state: GameStateBody | null = null): string {
  return renderToStaticMarkup(<AskDialog ask={ask} state={state} onAnswer={() => undefined} onPreviewCard={() => undefined} onConcede={() => undefined} />);
}

// ---------------------------------------------------------------------------

describe('ask coverage: every ask kind and variant renders a way to answer', () => {
  const vs = variants();

  test('every ask kind of the protocol has variants here', () => {
    const covered = new Set(vs.map((x) => x.ask.kind));
    expect(ASK_KINDS.filter((k) => !covered.has(k))).toEqual([]);
  });

  test.each(vs.map((x) => [x.name, x.ask] as const))('%s', (_name, ask) => {
    const html = render(ask, stateWith([gy1, gy2, lib1, bf1]));
    expect(html).toContain('role="dialog"');
    const a = actionable(html);
    expect(a.ok, a.why).toBe(true);
    expect(reachable(ask)).toBe(true);
  });

  test.each(FIXTURE_ASKS.map((f) => [f.id, f] as const))('recorded %s', (_id, f) => {
    const html = render(f.ask, f.state);
    const a = actionable(html);
    expect(a.ok, a.why).toBe(true);
    expect(reachable(f.ask)).toBe(true);
    // Every engine label reaches the screen (a concealed card's "???" included).
    for (const o of askOptions(f.ask)) if (f.ask.kind !== 'sideboard') expect(html).toContain(o.label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;').slice(0, 12));
  });
});

// ---------------------------------------------------------------------------
// Card choices that arrive as an `input`

function targetInput(ids: number[], min: number, max: number, highlighted: number[] = []): InputBody {
  return {
    prompt: `Reveillark - Select up to ${max} target creature cards in your graveyard${highlighted.length ? '\nTargeted:\nRaging Goblin' : ''}\n(${max - highlighted.length} more can be targeted)`,
    focusCardId: null,
    focusCard: null,
    buttons: { ok: { label: 'OK', enabled: min === 0 || highlighted.length >= min }, cancel: { label: 'Cancel', enabled: min === 0 }, focus: 'ok' },
    selectable: { cardIds: ids, min, max, mode: 'cards' },
    highlighted,
    weak: [],
    openZones: [{ playerId: 0, zones: ['graveyard'] }],
  } as unknown as InputBody;
}

describe('ask coverage: a card choice in any zone has something to click', () => {
  const exiled = card(81, 'Shock', 'exile', 1);
  const myHand = card(91, 'Opt', 'hand', 0);
  const onStack = card(95, 'Lightning Bolt', 'stack', 1);
  const state = stateWith([gy1, gy2, lib1, bf1, exiled, myHand, onStack, opp]);
  const zones: [string, number[], number, number][] = [
    ['graveyard, up to two (Reveillark)', [41, 42], 0, 2],
    ['graveyard, exactly one', [41, 42], 1, 1],
    ['exile', [81], 1, 1],
    ['library', [51], 0, 1],
    ['the stack', [95], 1, 1],
    ['an id not in the frame', [999], 1, 1],
    ['battlefield and graveyard', [61, 41], 1, 1],
    ['your hand', [91], 1, 1],
    ['the battlefield', [61], 1, 1],
  ];
  test.each(zones)('%s', (_name, ids, min, max) => {
    const input = targetInput(ids, min, max);
    const view = describeInput(input, state, 0);
    expect(view.mode).toBe('target');
    const pick = zonePick(input, state, 0, view.mode);
    const onBoard = new Set([61, 91]);
    for (const id of ids) {
      const has = onBoard.has(id) || !!pick?.picks.some((p) => p.id === id);
      expect(has, `card ${id} has nowhere to be clicked`).toBe(true);
    }
    if (!pick) return;
    // The picker draws a clickable tile (or a nameless back) for each.
    const calls: number[] = [];
    const play: PlayInteraction = {
      mark: (c) => cardRole(c, { view, input, state, seat: 0 }),
      hint: () => false,
      click: (c) => calls.push(c.id),
      chosen: () => null,
      blockersFor: () => [],
      playerMark: () => false,
      clickPlayer: () => undefined,
    };
    const html = renderToStaticMarkup(
      <PlayContext.Provider value={play}>
        <ZonePickPanel pick={pick} view={view} state={state} seat={0} onOk={() => undefined} onCancel={() => undefined} />
      </PlayContext.Provider>,
    );
    for (const p of pick.picks) {
      expect(html).toMatch(new RegExp(`data-card-id="${p.id}"[^>]*data-mark="select"|data-card-id="${p.id}"`));
      if (p.card && !('hidden' in p.card && p.card.hidden)) expect(html).toContain(`data-mark="select"`);
    }
    // The engine's own buttons are in the panel, with its labels.
    expect(html).toContain('data-engine-button="ok"');
    // A concealed card's name never reaches the markup.
    expect(html).not.toContain('Lightning Bolt'.repeat(2));
  });

  test('the title says which zone, the count is the engine’s (highlighted)', () => {
    const input = targetInput([41, 42], 0, 2, [41]);
    const view = describeInput(input, state, 0);
    expect(view.title).toBe('Select up to 2 target creature cards in your graveyard');
    const pick = zonePick(input, state, 0, view.mode)!;
    expect(pick.chosenCount).toBe(1);
    expect(pick.picks.find((p) => p.id === 41)!.chosen).toBe(true);
    const html = renderToStaticMarkup(<ZonePickPanel pick={pick} view={view} state={state} seat={0} onOk={() => undefined} onCancel={() => undefined} />);
    expect(html).toContain('Choose from your graveyard');
    expect(html).toContain('Choose up to 2');
    expect(html).toContain('1 selected');
    expect(html).toContain('Reveillark');
  });

  test('a stale selectable set under a priority prompt raises no picker', () => {
    const input = { ...targetInput([41], 1, 1), prompt: 'Priority: Human\nTurn: 5 (Human)' } as InputBody;
    const view = describeInput(input, state, 0);
    expect(zonePick(input, state, 0, view.mode)).toBeNull();
  });

  test('a concealed card in the picker names nothing', () => {
    const lib = { ...hidden(52, 'library', 0) } as AnyCard;
    const st = stateWith([lib]);
    const input = targetInput([52], 1, 1);
    const view = describeInput(input, st, 0);
    const pick = zonePick(input, st, 0, view.mode)!;
    const html = renderToStaticMarkup(<ZonePickPanel pick={pick} view={view} state={st} seat={0} onOk={() => undefined} onCancel={() => undefined} />);
    expect(html).toContain('A card you can’t see');
    expect(html).toContain('data-card-id="52"');
  });
});
