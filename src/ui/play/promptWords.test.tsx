/*
 * ForgeCoach — ui/play/promptWords.test.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Forge's target and choice prompts in plain English (promptWords.ts): the
 * parser, every class of PROMPT_RULES on its own example, one recorded input
 * frame per class drawn the way the decision slot draws it
 * (`testdata/forge-prompts.json`, taken from mtg-table's frame logs — see
 * each entry's `from` and `seq`), Arc Trail's second target in the slot, and
 * the class: no title in any recorded game in the repository is Forge's
 * bookkeeping ("Parent Targeted:", "Targeted:", "(n more can be targeted)", a
 * bracketed list, Forge's target syntax).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GameStateBody, InputBody } from '../../protocol.ts';
import { parseLog, type GameLog } from '../../log.ts';
import { abilityWords, parsePrompt, PROMPT_RULES, promptWords, splitEntityList, type PromptContext } from './promptWords.ts';
import { describeInput } from './inputView.ts';
import { attentionOf, inputCounter, passToggles } from './decisionModel.ts';
import { selectionSummary } from './selection.ts';
import { DecisionSlot } from './DecisionSlot.tsx';
import recorded from './testdata/forge-prompts.json' with { type: 'json' };

interface Recorded {
  class: string;
  from: string;
  seq: number;
  seat: number;
  players: { id: number; name: string }[];
  input: InputBody;
}
const FRAMES = recorded as unknown as Recorded[];

function stateOf(r: Recorded): GameStateBody {
  return {
    turn: 5,
    round: 3,
    phase: 'MAIN1',
    activePlayer: r.seat,
    priority: r.seat,
    players: r.players.map((p) => ({ ...p, zones: {} })),
    stack: [],
    stackCards: [],
    combat: null,
    events: [],
  } as unknown as GameStateBody;
}
const nameOf = (seat: number) => (id: number) => (id === seat ? 'You' : 'Search AI');
const view = (r: Recorded) => describeInput(r.input, stateOf(r), r.seat, { nameOf: nameOf(r.seat) });
const frame = (cls: string, re: RegExp): Recorded => FRAMES.find((f) => f.class === cls && re.test(f.input.prompt))!;

describe('parsePrompt: Forge’s message in its parts', () => {
  it('a later target: the source, no ability text, the instruction, the parent’s target', () => {
    const p = parsePrompt('Arc Trail (28) -  \n\nSelect any other target (1 damage)\nParent Targeted:[Tireless Tracker (93)]');
    expect(p).toEqual({ source: 'Arc Trail (28)', ability: null, ask: 'Select any other target (1 damage)', targeted: [], parentTargeted: ['Tireless Tracker (93)'], more: null });
  });

  it('a slot with picks: the Targeted list, one per line, and the count left', () => {
    const p = parsePrompt('Inferno Titan (9) - Whenever Inferno Titan enters or attacks, it deals 3 damage divided as you choose among one, two, or three targets.\n\nSelect any target to distribute damage to\nTargeted: \nEvan\nGoblin Shaman Token (126)\n(1 more can be targeted)');
    expect(p.source).toBe('Inferno Titan (9)');
    expect(p.ask).toBe('Select any target to distribute damage to');
    expect(p.targeted).toEqual(['Evan', 'Goblin Shaman Token (126)']);
    expect(p.more).toBe(1);
  });

  it('a cost’s selection: the ability on a line of its own', () => {
    const p = parsePrompt('Woe Strider (35)\n - Sacrifice another creature: Scry 1.\nSelect another creature to sacrifice (1 left)');
    expect(p.source).toBe('Woe Strider (35)');
    expect(p.ability).toBe('Sacrifice another creature: Scry 1.');
    expect(p.ask).toBe('Select another creature to sacrifice (1 left)');
  });

  it('the short form, and a prompt with no source', () => {
    expect(parsePrompt('Shock (3) - Select any target')).toMatchObject({ source: 'Shock (3)', ask: 'Select any target' });
    expect(parsePrompt('Select target player')).toMatchObject({ source: null, ask: 'Select target player' });
    expect(parsePrompt('Do you want to pay 1 life?')).toMatchObject({ source: null, ask: 'Do you want to pay 1 life?' });
    expect(parsePrompt('Use triggered ability of Sun Titan (23)?\nTriggered by: Sun Titan (23)')).toMatchObject({ source: null, ask: 'Use triggered ability of Sun Titan (23)?' });
  });

  it('a spell whose text is its name (an Aura’s sa.toString) has no ability text', () => {
    expect(parsePrompt('Robotics Mastery (39) - Robotics Mastery\n\nSelect target creature').ability).toBeNull();
  });

  it('Java’s list of entities: a comma inside a card’s name, a player without an id', () => {
    expect(splitEntityList('Peggy Carter, Secret Agent (4), Goblin Token (12)')).toEqual(['Peggy Carter, Secret Agent (4)', 'Goblin Token (12)']);
    expect(splitEntityList('Evan, Tireless Tracker (93)', ['Evan', 'Justin'])).toEqual(['Evan', 'Tireless Tracker (93)']);
  });

  it('an ability’s bookkeeping tail is not the card’s text', () => {
    expect(abilityWords("Whenever this creature attacks, up to one target creature gets -1/-0 until end of turn. [Attacker: Ant-Man's Air Force (23)]")).toBe(
      'Whenever this creature attacks, up to one target creature gets -1/-0 until end of turn.',
    );
  });
});

describe('PROMPT_RULES: every class takes its own example', () => {
  for (const rule of PROMPT_RULES) {
    it(rule.id, () => {
      const parts = parsePrompt(rule.example);
      const c: PromptContext = {
        parts,
        min: rule.id === 'optional-target' ? 0 : 1,
        max: rule.id === 'divide-damage' ? 3 : rule.id === 'several-targets' ? 2 : 1,
        chosen: null,
        ok: { label: 'OK', enabled: rule.id === 'optional-target' || rule.id === 'several-targets' },
        sourceName: parts.source?.replace(/\s*\(\d+\)$/, '') ?? null,
        nameOf: (e) => e.replace(/\s*\(\d+\)$/, ''),
      };
      const w = promptWords(c);
      expect(w?.rule).toBe(rule.id);
      // plain words: Forge's bookkeeping never reaches the title
      expect(w!.title).not.toMatch(/Parent Targeted|Targeted:|more can be targeted|\[|\]|\.YouCtrl|^Select /);
    });
  }
});

describe('a recorded frame per class, as the decision slot says it', () => {
  const cases: [string, RegExp, { title: string; context: string | null; counter?: string }][] = [
    [
      'later-target',
      /Tireless Tracker/,
      {
        title: 'Arc Trail: choose any other target (1 damage)',
        context: 'First target: Tireless Tracker. Choose a different target for the rest of the effect.',
        counter: '0/1 · need 1 more',
      },
    ],
    ['one-target', /Arc Trail/, { title: 'Arc Trail: choose any target (2 damage)', context: null }],
    ['one-target', /Depower/, { title: 'Depower: choose target creature', context: null }],
    ['one-target', /Reanimate/, { title: 'Reanimate: choose target creature card in a graveyard', context: null }],
    ['one-target', /Blood Artist/, { title: 'Blood Artist: choose target player', context: null }],
    ['sacrifice-cost', /Priest/, { title: 'Priest of Forgotten Gods: sacrifice 2 other creatures', context: 'This is part of the cost. Cancel takes back the whole activation.' }],
    ['sacrifice-cost', /Woe Strider/, { title: 'Woe Strider: sacrifice another creature', context: 'This is part of the cost. Cancel takes back the whole activation.' }],
    ['divide-damage', /Inferno Titan/, { title: 'Inferno Titan: choose the targets to divide the damage among (up to 3)', context: 'Targeted so far: Goblin Shaman Token.', counter: '1/3 · up to 2 more' }],
    ['forge-syntax', /Sun Titan/, { title: 'Sun Titan: choose a target', context: null }],
    ['several-targets', /Priest/, { title: 'Priest of Forgotten Gods: choose target player (up to 2)', context: 'Targeted so far: Search AI. Press OK when you are done.' }],
    ['optional-target', /Ant-Man/, { title: "Ant-Man's Air Force: choose up to one target creature", context: 'Optional — press OK to choose none.' }],
    ['optional-target', /Yawgmoth/, { title: 'Yawgmoth, Thran Physician: choose target creature (optional)', context: 'Optional — press OK to choose none.' }],
    ['instruction-under-card', /Island/, { title: 'Put Island on the top or bottom of your library?', context: null }],
  ];
  for (const [cls, re, want] of cases) {
    it(`${cls}: ${re.source}`, () => {
      const r = frame(cls, re);
      expect(r, `a recorded ${cls} frame matching ${re}`).toBeTruthy();
      const v = view(r);
      expect(v.title).toBe(want.title);
      expect(v.context ?? null).toBe(want.context);
      if (want.counter) expect(inputCounter(r.input, v)).toBe(want.counter);
    });
  }

  it('the card’s own text comes with the choice, without Forge’s ids or tails', () => {
    expect(view(frame('one-target', /Arc Trail/)).sourceText).toBe('Arc Trail deals 2 damage to any target and 1 damage to any other target.');
    expect(view(frame('optional-target', /Ant-Man/)).sourceText).toBe('Whenever this creature attacks, up to one target creature gets -1/-0 until end of turn.');
    // a sub-ability's later target: Forge prints no text (PlayView then reads the card's cached oracle)
    expect(view(frame('later-target', /Tireless Tracker/)).sourceText ?? null).toBeNull();
  });
});

describe('Arc Trail’s second target in the decision slot (Justin’s play test, 2026-10-17)', () => {
  const r = frame('later-target', /Goblin Shaman/);
  const v = view(r);
  const state = stateOf(r);
  const attention = attentionOf({ connected: true, over: false, ask: null, input: r.input, view: v, state, seat: r.seat, oppName: 'Search AI', inputSeq: r.seq });
  const html = renderToStaticMarkup(
    <DecisionSlot
      view={v}
      busy={null}
      pool={null}
      canUndo={false}
      undoDepth={0}
      onOk={() => undefined}
      onCancel={() => undefined}
      onAct={() => undefined}
      onHelp={() => undefined}
      flash={null}
      selection={selectionSummary(v, { attackers: 0, blockers: 0 })}
      wide
      attention={attention}
      counter={inputCounter(r.input, v)}
      toggles={passToggles({ yielding: null, seat: r.seat, view: v, canAct: true })}
      sourceText="Arc Trail deals 2 damage to any target and 1 damage to another target."
    />,
  );
  const visible = html.replace(/<[^>]*>/g, ' ');

  it('says what is asked in words, with the first target and the card’s text', () => {
    expect(visible).toContain('Arc Trail: choose any other target (1 damage)');
    expect(visible).toContain('First target: Goblin Shaman Token. Choose a different target for the rest of the effect.');
    expect(visible).toContain('0/1 · need 1 more');
    expect(visible).toContain('Arc Trail deals 2 damage to any target and 1 damage to another target.');
  });

  it('Forge’s bookkeeping is never on the slot’s face, and stays one hover away (ids out)', () => {
    expect(visible).not.toMatch(/Parent Targeted|Click to select/);
    expect(html).toContain('title="Engine: Arc Trail - · Select any other target (1 damage) · Parent Targeted:[Goblin Shaman Token]"');
    expect(html).not.toMatch(/\(\d+\)\]/);
  });

  it('the context line is not a phone’s hidden hint', () => {
    expect(html).toMatch(/class="ab-select-line is-hint is-context"/);
  });
});

function logs(): { name: string; log: GameLog }[] {
  const out: { name: string; log: GameLog }[] = [];
  for (const dir of ['../../../public/samples/', '../../../bench/coach/logs/', '../../play/testdata/']) {
    const base = new URL(dir, import.meta.url);
    for (const f of readdirSync(base)) if (f.endsWith('.jsonl.gz')) out.push({ name: f, log: parseLog(gunzipSync(readFileSync(new URL(f, base))).toString('utf8')) });
  }
  return out;
}

describe('the class: no decision title is Forge’s bookkeeping, in every recorded game and frame here', () => {
  const RAW = /Parent Targeted|Targeted:|more can be targeted|\[|\]|\b[A-Z][a-z]+\.[A-Z][A-Za-z]+\+/;

  it('the recorded frames of every class', () => {
    for (const r of FRAMES) expect(view(r).title, `${r.from}#${r.seq}`).not.toMatch(RAW);
  });

  it('every input of every recorded game in the repository', () => {
    const raw: string[] = [];
    let targets = 0;
    for (const { name, log } of logs()) {
      let state: GameStateBody | null = null;
      for (const f of log.frames) {
        if (f.type === 'state') state = f.body as GameStateBody;
        if (f.type !== 'input') continue;
        const v = describeInput(f.body as InputBody, state, log.seat);
        if (v.mode === 'target') targets++;
        if (RAW.test(v.title)) raw.push(`${name}#${f.seq}: ${v.title}`);
      }
    }
    expect(targets).toBeGreaterThan(10);
    expect(raw).toEqual([]);
  });
});
