import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseLog, type GameLog } from './log.ts';
import { extractDecisions, type Decision } from './decisions.ts';
import type { CardInfo } from './cards.ts';
import type { AnyCard, Card, GameStateBody } from './protocol.ts';
import { isHidden } from './protocol.ts';
import { buildCoachPrompt, coachCardNames, promptAsText } from './prompt.ts';

function load(name: string): GameLog {
  const bytes = readFileSync(new URL(`../public/samples/${name}.jsonl.gz`, import.meta.url));
  return parseLog(gunzipSync(bytes).toString('utf8'));
}

const SAMPLES = ['human-comfort-13', 'human-auto-42'] as const;
const logs = Object.fromEntries(SAMPLES.map((n) => [n, load(n)])) as Record<(typeof SAMPLES)[number], GameLog>;

/** A plausible card map: ~250 chars of oracle text per card, every third one unknown. */
function fakeCards(names: string[]): Map<string, CardInfo> {
  return new Map(
    names.map((n, i) => [
      n,
      {
        name: n,
        found: i % 3 !== 2,
        manaCost: '{1}{U}',
        typeLine: 'Creature — Test',
        oracleText: `Flying\nWhen ${n} enters, draw a card. ` + 'Lorem ipsum rules text that stands in for a real card. '.repeat(4),
        power: '2',
        toughness: '2',
        producedMana: [],
        colors: ['U'],
      } satisfies CardInfo,
    ]),
  );
}

function decisionAt(log: GameLog, frameIndex: number, kind?: Decision['kind']): Decision {
  const d = extractDecisions(log).find((x) => x.frameIndex === frameIndex && (!kind || x.kind === kind));
  if (!d) throw new Error(`no decision at frame ${frameIndex}`);
  return d;
}

function section(user: string, heading: string): string {
  const i = user.indexOf(heading);
  if (i < 0) return '';
  const rest = user.slice(i + heading.length);
  const j = rest.search(/\n(## |# )/);
  return j < 0 ? rest : rest.slice(0, j);
}

function visibleNames(state: GameStateBody): Set<string> {
  const out = new Set<string>();
  const add = (c: AnyCard) => {
    if (isHidden(c)) return;
    const k = c as Card;
    if (k.name) out.add(k.name);
    if (k.alt?.name) out.add(k.alt.name);
  };
  for (const p of state.players) for (const z of Object.values(p.zones)) (z as { cards: AnyCard[] }).cards.forEach(add);
  (state.stackCards ?? []).forEach(add);
  return out;
}

describe('buildCoachPrompt — human-comfort-13, my attack on turn 10 (frame 871)', () => {
  const log = logs['human-comfort-13'];
  const d = decisionAt(log, 871, 'attack');
  const p = buildCoachPrompt(log, d, fakeCards(coachCardNames(log, d)));
  const you = section(p.user, '## YOU');
  const opp = section(p.user, '## OPPONENT');

  it('has the header and the attack question', () => {
    expect(p.user).toContain('Round 5 (turn 10) · declare attackers · my turn');
    expect(p.user).toContain('Engine prompt: Select creatures to attack Forge AI');
    expect(p.user).toMatch(/# Question\nI am declaring attackers/);
  });

  it('counts untapped mana exactly (hand-checked: Thriving Isle + 2 Islands untapped, Plains tapped)', () => {
    expect(you).toContain('Untapped mana sources: 3 —');
    expect(you).toContain('U×2 (Island ×2)');
    expect(you).toContain('Thriving Isle');
    // Black was chosen for Thriving Isle as it entered (the seat's own answer in the log): it makes U or B, never W.
    expect(you).toContain('U/B×1 (Thriving Isle)');
    expect(you).toContain('Lands (4): Thriving Isle (untapped, chosen colour black); 2× Island (untapped); Plains (TAPPED)');
    expect(opp).toContain('Untapped mana sources: 1 — W×1 (Plains)');
    expect(you).toContain('Mana pool: empty');
  });

  it('reports the land drop and spells cast this turn', () => {
    expect(you).toContain('Land drop this turn: USED');
    expect(you).toContain('Spells cast this turn: S.H.I.E.L.D. Spy Kit');
    expect(opp).toContain('Spells cast this turn: none');
  });

  it('marks TAPPED and SUMMONING SICK on the right permanents', () => {
    expect(opp).toContain('A.I.M. Scientists #42 · 3/3 · Creature - Human Scientist Villain · TAPPED');
    expect(opp).toContain('Giant-Sized Flying Ant #64 · 3/2 · Creature - Insect · SUMMONING SICK');
    expect(you).toMatch(/Ant-Man's Air Force #23 · 2\/1 · Creature - Insect\n/);
    expect(you).not.toMatch(/Ant-Man's Air Force[^\n]*(TAPPED|SUMMONING SICK)/);
  });

  it('lists both graveyards and keeps the opponent hand hidden', () => {
    expect(you).toContain('Graveyard: Wasp, Shrinking Savior; Depower');
    expect(opp).toContain('Graveyard: Island');
    expect(opp).toContain('Hand: 4 cards (hidden)');
    // #50 is in the opponent's hand here and is cast as Agents of S.H.I.E.L.D. on turn 11.
    expect(p.user).not.toContain('Agents of S.H.I.E.L.D.');
  });

  it('includes card text for exactly coachCardNames, unknown ones marked', () => {
    const names = coachCardNames(log, d);
    expect(names).toEqual(expect.arrayContaining(["Ant-Man's Air Force", 'Web Up', 'Giant-Sized Flying Ant', 'Depower']));
    expect(names).not.toContain('Island');
    const text = section(p.user, '# Card text');
    const heads = text
      .split('\n')
      .filter((l) => l && !l.startsWith('  '))
      .map((l) => l.split(/ \{| —/)[0]);
    expect(heads).toEqual(names);
    expect(text).toContain('(text unavailable)');
  });

  it('never includes what the player actually did', () => {
    for (const a of d.actions) if (a.length > 8) expect(p.user).not.toContain(a);
    expect(p.user).not.toMatch(/\b(pressed|clicked)\b/);
  });
});

describe('buildCoachPrompt — blocks and combat', () => {
  const log = logs['human-comfort-13'];
  const d = decisionAt(log, 1293, 'block');
  const p = buildCoachPrompt(log, d, new Map());
  it('shows attackers, the incoming total against my life, and sick blockers', () => {
    expect(p.user).toContain('Round 8 (turn 15) · declare blockers · Forge AI\'s turn');
    expect(p.user).toContain('Agents of S.H.I.E.L.D. #50 2/4 → you (Human) · no blockers (yet)');
    expect(p.user).toContain('Attacking power total 10; unblocked at a player 10 (defending player\'s life 6).');
    expect(p.user).toContain('Quake, Agent of S.H.I.E.L.D. #31 · 3/3 · Legendary Creature - Inhuman Spy Hero · SUMMONING SICK');
    expect(p.user).toContain('Giant-Sized Flying Ant #64 · 3/2 · Creature - Insect · TAPPED · ATTACKING');
    expect(p.user).toMatch(/# Question\nThe opponent is attacking me\. How should I block/);
  });
  it('says text is unavailable when the card map is empty', () => {
    expect(section(p.user, '# Card text')).toContain('\nHelicarrier Strike {W} — Instant\n  (text unavailable)');
  });
});

describe('buildCoachPrompt — every decision of both samples', () => {
  for (const name of SAMPLES) {
    const log = logs[name];
    const ds = extractDecisions(log);

    it(`${name}: deterministic, small, and names no hidden card`, () => {
      expect(ds.length).toBeGreaterThan(5);
      // Every name the log ever shows for a card id.
      const everName = new Map<number, Set<string>>();
      for (const f of log.frames) {
        if (f.type !== 'state') continue;
        const s = f.body as GameStateBody;
        const all: AnyCard[] = [...(s.stackCards ?? [])];
        for (const pl of s.players) for (const z of Object.values(pl.zones)) all.push(...(z as { cards: AnyCard[] }).cards);
        for (const c of all) if (!isHidden(c) && (c as Card).name) everName.set(c.id, (everName.get(c.id) ?? new Set()).add((c as Card).name));
      }
      let max = 0;
      for (const d of ds) {
        const cards = fakeCards(coachCardNames(log, d));
        const a = buildCoachPrompt(log, d, cards);
        const reversed = new Map([...cards].reverse());
        const b = buildCoachPrompt(log, d, reversed);
        expect(b).toEqual(a);
        max = Math.max(max, a.user.length);
        expect(a.user.length + a.system.length).toBeLessThan(12_000);

        const visible = visibleNames(d.state);
        const hiddenIds: number[] = [];
        for (const pl of d.state.players) for (const z of Object.values(pl.zones)) for (const c of (z as { cards: AnyCard[] }).cards) if (isHidden(c)) hiddenIds.push(c.id);
        for (const id of hiddenIds) {
          for (const n of everName.get(id) ?? []) {
            if (visible.has(n)) continue; // another copy is public
            if ([...visible].some((v) => v.includes(n))) continue; // substring of a visible name
            expect(a.user, `decision ${d.index} leaks hidden #${id} ${n}`).not.toContain(n);
          }
        }
      }
      expect(max).toBeGreaterThan(1000);
    });
  }

  it('includes the guide when given, and promptAsText joins both halves', () => {
    const log = logs['human-auto-42'];
    const d = extractDecisions(log).find((x) => x.kind === 'main')!;
    const p = buildCoachPrompt(log, d, new Map(), { guide: 'Lead with fodder.' });
    expect(p.user).toContain('# My deck play guide\nLead with fodder.');
    expect(p.user.indexOf('# My deck play guide')).toBeLessThan(p.user.indexOf('# Question'));
    expect(promptAsText(p)).toBe(`${p.system}\n\n---\n\n${p.user}`);
    expect(buildCoachPrompt(log, d, new Map()).user).not.toContain('play guide');
  });

  it('system prompt carries the spec and the rules pitfalls', () => {
    const log = logs['human-auto-42'];
    const p = buildCoachPrompt(log, extractDecisions(log)[1]!, new Map());
    for (const s of ['SUMMONING SICK', '{T}', 'Equip is sorcery speed', 'instant or sorcery', 'Revolt', 'Count lethal both ways', '**Play:**', '**Trap:**', '**Their turn:**', 'heuristic', 'Assumptions'])
      expect(p.system).toContain(s);
  });
});
