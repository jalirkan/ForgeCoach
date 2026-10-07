/*
 * ForgeCoach — ui/stack.test.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The stack panel and its marks (stackModel.ts, arrows.ts, StackPanel.tsx,
 * CardTile's badges): numbering (1 = top, resolves next), the kind of each
 * item, the lines to the source and to every target, the matching badges on
 * board cards — and redaction: a concealed or face-down source shows no name
 * and no art, a blanked text stays blank. Real frames from mtg-table's
 * recordings (human-auto-42 seq 903: a spell under a triggered ability that
 * targets a land), plus hand-made concealed cases.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import type { AnyCard, Card, GameStateBody, StackItem } from '../protocol.ts';
import { buildStackArrows, cardKey, playerKey, stackKey, type RectBox, type RectKey } from './arrows.ts';
import { ArrowPaths } from './BoardArrows.tsx';
import { BoardMarksContext } from './cardContext.ts';
import { CardTile } from './CardTile.tsx';
import { StackPanel } from './StackPanel.tsx';
import { stackEntries, stackKind, stackMarks, stackPlayerMarks, stackText } from './stackModel.ts';

function card(id: number, name: string, zone: string, extra: Partial<Card> = {}): Card {
  return {
    id,
    name,
    setCode: 'M21',
    manaCost: '{1}',
    types: 'Creature - Human',
    power: '1',
    toughness: '1',
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
    controller: 0,
    owner: 0,
    zone,
    abilities: [],
    ...extra,
  } as unknown as Card;
}

function item(id: number, sourceCardId: number | null, extra: Partial<StackItem> = {}): StackItem {
  return { id, sourceCardId, controller: 0, text: '', targetCardIds: [], targetPlayerIds: [], ...extra } as StackItem;
}

function state(stack: StackItem[], battlefield: AnyCard[], stackCards: AnyCard[], oppBattlefield: AnyCard[] = []): GameStateBody {
  const zones = (bf: AnyCard[]) => ({
    hand: { count: 0, cards: [] },
    library: { count: 30, cards: [] },
    graveyard: { count: 0, cards: [] },
    battlefield: { count: bf.length, cards: bf },
    exile: { count: 0, cards: [] },
    command: { count: 0, cards: [] },
  });
  return {
    turn: 13,
    round: 7,
    phase: 'MAIN1',
    activePlayer: 0,
    priority: 0,
    players: [
      { id: 0, name: 'Human', life: 20, poison: 0, manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, counters: {}, zones: zones(battlefield) },
      { id: 1, name: 'Forge AI', life: 20, poison: 0, manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, counters: {}, zones: zones(oppBattlefield) },
    ],
    stack,
    stackCards,
    combat: null,
    events: [],
  } as unknown as GameStateBody;
}

// human-auto-42.jsonl seq 903, as recorded (bottom first).
const quake = card(31, 'Quake, Agent of S.H.I.E.L.D.', 'battlefield');
const island = card(38, 'Island', 'battlefield', { types: 'Basic Land - Island', power: null, toughness: null } as Partial<Card>);
const heli = card(29, 'S.H.I.E.L.D. Helicarrier', 'stack', { types: 'Artifact - Vehicle' } as Partial<Card>);
const recorded = state(
  [
    item(50, 29, { text: 'S.H.I.E.L.D. Helicarrier', isAbility: false, yieldKey: 'y17', isOptionalTrigger: false }),
    item(51, 31, {
      text: 'Seismic Takedown — Whenever you cast a noncreature spell, tap target creature or land. (Targeting: [[Island (38)]])',
      targetCardIds: [38],
      isAbility: true,
      yieldKey: 'y18',
      isOptionalTrigger: false,
    }),
  ],
  [quake, island],
  [heli, { ...quake }],
);

describe('stack model', () => {
  test('numbered from the top: 1 resolves next', () => {
    const es = stackEntries(recorded, 0);
    expect(es.map((e) => [e.n, e.item.id])).toEqual([
      [1, 51],
      [2, 50],
    ]);
  });

  test('kinds: a spell, a triggered ability, an activated ability', () => {
    const es = stackEntries(recorded, 0);
    expect(es.map((e) => e.kind)).toEqual(['triggered', 'spell']);
    expect(stackKind(item(1, 5, { text: '{T}: Add {G}.', isAbility: true }), undefined)).toBe('activated');
    expect(stackKind(item(1, 5, { text: 'Lightning Bolt' }), card(5, 'Lightning Bolt', 'stack'))).toBe('spell');
    expect(stackKind(item(1, 5, { text: 'Draw', isAbility: true, isOptionalTrigger: true }), undefined)).toBe('triggered');
  });

  test('controller, names, targets; the text without its Targeting tail', () => {
    const [top, spell] = stackEntries(recorded, 0);
    expect(top!.controller).toBe('You');
    expect(top!.name).toBe('Quake, Agent of S.H.I.E.L.D.');
    expect(top!.targets).toEqual([{ kind: 'card', id: 38, label: 'Island' }]);
    expect(top!.sourceOnBoard).toBe(true);
    expect(stackText(top!)).toBe('Seismic Takedown — Whenever you cast a noncreature spell, tap target creature or land.');
    expect(spell!.sourceOnBoard).toBe(false);
    expect(stackEntries(recorded, 1)[0]!.controller).toBe('Human');
  });

  test('badges: the source wears its number, the target a ringed one', () => {
    const m = stackMarks(stackEntries(recorded, 0));
    expect(m.get(31)).toEqual({ sources: [1], targets: [] });
    expect(m.get(38)).toEqual({ sources: [], targets: [1] });
    expect(m.has(29)).toBe(false); // a spell's card is on the stack, not the board
  });

  test('a player target is marked on the player', () => {
    const st = state([item(9, 29, { text: 'Shock deals 2 damage', targetPlayerIds: [1], isAbility: false })], [], [heli]);
    expect(stackPlayerMarks(stackEntries(st, 0)).get(1)).toEqual([1]);
    expect(stackEntries(st, 0)[0]!.targets[0]!.label).toBe('Forge AI');
  });

  test('redaction: a concealed source has no name, a face-down one is a back, a blank text stays blank', () => {
    const concealed = { id: 77, hidden: true, zone: 'stack', owner: 1, controller: 1 } as unknown as AnyCard;
    const morph = card(78, '', 'battlefield', { faceDown: true, controller: 1, owner: 1 } as Partial<Card>);
    const st = state(
      [item(1, 77, { controller: 1, text: '' }), item(2, 78, { controller: 1, text: '', isAbility: true, targetCardIds: [77] })],
      [],
      [concealed],
      [morph],
    );
    const es = stackEntries(st, 0);
    for (const e of es) {
      expect(e.name).toBeNull();
      expect(e.faceDown).toBe(true);
      expect(e.text).toBe('');
    }
    expect(es[0]!.targets[0]!.label).toBe('a hidden card');
    const html = renderToStaticMarkup(<StackPanel entries={es} state={st} variant="float" />);
    expect(html).toContain('Face-down card');
    expect(html).toContain('Hidden');
    expect(html).not.toContain('<img');
  });
});

describe('stack panel', () => {
  test('numbers, "next" on the top item, kind, controller, text and target chips', () => {
    const html = renderToStaticMarkup(<StackPanel entries={stackEntries(recorded, 0)} state={recorded} variant="float" onFold={() => undefined} />);
    expect(html).toContain('The Stack');
    expect(html).toMatch(/data-stack-item="51" data-stack-n="1"/);
    expect(html).toMatch(/data-stack-item="50" data-stack-n="2"/);
    expect(html.indexOf('data-stack-item="51"')).toBeLessThan(html.indexOf('data-stack-item="50"'));
    expect(html).toContain('>next<');
    expect(html).toContain('Triggered ability');
    expect(html).toContain('Spell');
    expect(html).toContain(' · You');
    expect(html).toContain('stackp-chip">Island<');
  });

  test('folded: the heading only', () => {
    const html = renderToStaticMarkup(<StackPanel entries={stackEntries(recorded, 0)} state={recorded} variant="float" folded onFold={() => undefined} />);
    expect(html).toContain('The Stack');
    expect(html).not.toContain('data-stack-item');
  });

  test('empty: nothing at all', () => {
    expect(renderToStaticMarkup(<StackPanel entries={[]} state={recorded} variant="float" />)).toBe('');
  });
});

describe('stack lines', () => {
  const box = (x: number, y: number, w = 80, h = 110): RectBox => ({ x, y, width: w, height: h });
  const rects = new Map<RectKey, RectBox>([
    [stackKey(51), box(1000, 300, 24, 24)],
    [stackKey(50), box(1000, 380, 24, 24)],
    [cardKey(31), box(400, 400)],
    [cardKey(38), box(500, 600)],
    [playerKey(1), box(40, 60, 60, 30)],
  ]);
  const get = (k: RectKey) => rects.get(k);

  test('from each item to its source on the battlefield and to each target', () => {
    const arrows = buildStackArrows(stackEntries(recorded, 0), get);
    expect(arrows.map((a) => [a.cls, a.n, a.from, a.to])).toEqual([
      ['source', 1, 's:51', 'c:31'],
      ['target', 1, 's:51', 'c:38'],
    ]);
    for (const a of arrows) expect(a.path).toMatch(/^M[\d.]+ [\d.]+ Q/);
  });

  test('a stack id is never read as a card id (protocol §10.1)', () => {
    // Card #51 exists on the board; the stack item #51 must still be reached only as s:51.
    const withCard51 = new Map(rects);
    withCard51.set(cardKey(51), box(10, 10));
    const arrows = buildStackArrows(stackEntries(recorded, 0), (k) => withCard51.get(k));
    expect(arrows.every((a) => a.from.startsWith('s:'))).toBe(true);
  });

  test('the panel folded: the lines start at the source card', () => {
    const noRows = (k: RectKey) => (k.startsWith('s:') ? undefined : rects.get(k));
    const arrows = buildStackArrows(stackEntries(recorded, 0), noRows);
    expect(arrows.map((a) => [a.cls, a.from, a.to])).toEqual([['target', 'c:31', 'c:38']]);
  });

  test('a target the board does not draw is no line', () => {
    const noTarget = (k: RectKey) => (k === 'c:38' ? undefined : rects.get(k));
    expect(buildStackArrows(stackEntries(recorded, 0), noTarget).map((a) => a.to)).toEqual(['c:31']);
  });

  test('a player target: a line to the life total, numbered', () => {
    const st = state([item(9, 29, { text: 'Shock', targetPlayerIds: [1], isAbility: false })], [], [heli]);
    const arrows = buildStackArrows(stackEntries(st, 0), (k) => (k === 's:9' ? box(1000, 300, 24, 24) : rects.get(k)));
    expect(arrows.map((a) => a.to)).toEqual(['p:1']);
    const svg = renderToStaticMarkup(<ArrowPaths arrows={arrows} />);
    expect(svg).toContain('data-arrows="1"');
    expect(svg).toMatch(/stack-arrow-badge[\s\S]*>1</);
  });
});

describe('badges on board cards', () => {
  test('a source tile and a target tile carry the item number', () => {
    const marks = { stack: stackMarks(stackEntries(recorded, 0)) };
    const html = renderToStaticMarkup(
      <BoardMarksContext.Provider value={marks}>
        <CardTile card={quake} side="me" />
        <CardTile card={island} side="me" />
      </BoardMarksContext.Provider>,
    );
    expect(html).toMatch(/data-card-id="31"[\s\S]*smk smk-src[^>]*>1</);
    expect(html).toMatch(/is-stack-target[\s\S]*data-card-id="38"[\s\S]*smk smk-tgt[^>]*>1</);
  });

  test('no marks: no badges (and none in a hand)', () => {
    const html = renderToStaticMarkup(<CardTile card={quake} side="me" />);
    expect(html).not.toContain('smk');
    const inHand = renderToStaticMarkup(
      <BoardMarksContext.Provider value={{ stack: stackMarks(stackEntries(recorded, 0)) }}>
        <CardTile card={quake} inHand />
      </BoardMarksContext.Provider>,
    );
    expect(inHand).not.toContain('smk');
  });
});
