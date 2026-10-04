/*
 * ForgeCoach — prompt.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The coach prompt for one decision: a fixed system prompt (coaching spec,
 * rules pitfalls, answer format) and a deterministic, compact user message
 * (state table per player, stack, combat, card text, play guide, question).
 *
 * What the player actually did is deliberately left out — the coach must not
 * be anchored on it. Hidden cards are never named.
 */
import type { AnyCard, AskBody, Card, GameStateBody, PlayerState, SideboardAsk } from './protocol.ts';
import { isHidden, keywordsOf, MANA_COLORS } from './protocol.ts';
import type { GameLog } from './log.ts';
import type { Decision } from './decisions.ts';
import { isPlayDrawInput, isTargetInput, phaseLabel } from './decisions.ts';
import type { CardInfo } from './cards.ts';
import type { ChosenColors, ManaSource } from './state.ts';
import { chosenColors, chosenColorSource, colorName, infoFor, instantSpeedOptions, turnFacts, untappedManaSources } from './state.ts';
import { formatCardTexts, isBasicLandName, visibleName } from './review.ts';
import { buildCubeContext, type CubeCoachInput } from './cube/coachContext.ts';

export interface Prompt {
  system: string;
  user: string;
}

// ---------------------------------------------------------------------------
// System prompt

/**
 * How the coach lays out its answer:
 * - 'classic' (default): **Play:** first, then why, the rule, the confidence and the rest;
 * - 'answer-first': a one-line **Answer:**, its **Confidence:** and **Rule:** first, so the
 *   play can be shown as soon as that line has streamed, then the explanation.
 */
export type PromptFormat = 'classic' | 'answer-first';
export const PROMPT_FORMATS: readonly PromptFormat[] = ['classic', 'answer-first'];

const COACH_INTRO = `You coach a newer Magic: The Gathering player (a few months in) who is playing against the Forge AI. You get the engine's exact game state as the player sees it, the oracle text of the cards that matter, and sometimes a play guide for the player's deck.

Ground rules:
- The state is exact: TAPPED, SUMMONING SICK, counters, damage, P/T (pumps and counters included), the untapped mana sources, the mana pool (shown only when not empty), the land drop and this turn's spells.
- Use the given card text, never memory of a card. If a card's text is unavailable, say what you assume it does.
- You can't see the opponent's hand or either library. Never name or assume a specific hidden card; reason about what they could have (cards in hand, open mana, colours) and say it is a guess.
- Recommend only legal plays. Numbered options and legal targets in the message are exactly what the engine accepts: pick from them and name your pick by its number and label.

Check before any attack, block, activation or spell:
- SUMMONING SICK: can't attack or pay a {T} cost (mana abilities included); CAN block, use abilities without {T}, be sacrificed, equipped and targeted.
- {T} in a cost means once per untap; an ability without {T} ("{1}: +1/+0") repeats while you can pay.
- Mana: only the listed untapped sources plus the pool, each source one mana of one of its colours; the pool empties between steps. Check colours, not just the total, and say which sources pay for what.
- One land drop per turn unless a card says otherwise.
- "Whenever you cast an instant or sorcery" (prowess) triggers only on instants and sorceries: never on other spells or on activated abilities. A copy that is cast is a spell.
- Equip is sorcery speed (your main phase, empty stack) and may target a summoning-sick creature. Equipment that lowers toughness (Skullclamp) kills a 1-toughness creature at once, and its death triggers still happen.
- Triggered abilities ("whenever … dies / attacks / enters") work whether the source is tapped or not.
- Revolt (Fatal Push) counts any permanent of yours that left the battlefield this turn: a cracked fetchland, a sacrificed creature, a dead token. The state lists them.
- Read restrictions literally: "can't block" (Bloodghast, Gravecrawler); conditional haste (Bloodghast only while an opponent is at 10 life or less; it returns on every landfall, fetchlands included); conditional recasting (Gravecrawler only while you control a Zombie).
- Facing removal with a sacrifice outlet, sacrifice the target in response for value.
- Count lethal both ways before every attack and every block: what you can push through against their life and untapped blockers, and what they can swing back with next turn.

`;

const F_PLAY = '**Play:** the recommended line as numbered steps in order. For each spell or ability: its cost, which sources pay it, and the mana left after. For combat: every attacker / blocker assignment. For a numbered option or target: its number and label.';
const F_WHY = '**Why:** two or three sentences.';
const F_RULE = '**Rule:** the heuristic the line follows, in a few words ("count lethal", "hold the outlet", "fodder before payoffs", "trade on your terms", "use all your mana", "don\'t overextend"), so the pattern transfers.';
const F_CONFIDENCE = '**Confidence:** high, medium or low, then a few words why when it is not high. Low means a close call: another line is about as good, or the right play turns on something hidden.';
const F_TAIL = [
  "**Trap:** the tempting wrong play and why it's wrong, in one sentence.",
  '**Their turn:** in one sentence, what the opponent can do next (untapped creatures, open mana, cards in hand) and what to keep back for it.',
  '**Alternative:** only if a second line is genuinely close; otherwise leave it out.',
  '**Assumptions:** only if something is ambiguous or a card\'s text is unavailable — state it rather than guessing.',
];

/** The coach's system prompt for a layout (`COACH_SYSTEM` is the classic one). */
export function coachSystem(format: PromptFormat = 'classic'): string {
  const lines =
    format === 'answer-first'
      ? [
          'Answer format — answer first, short, no preamble, no restating the state. The first line is the answer, so the player can act on it before reading the rest:',
          '**Answer:** the recommended play in one line (a numbered option or target by number and label, e.g. "2 — Plains"; otherwise e.g. "Attack with both Bears, keep the Wall home").',
          F_CONFIDENCE,
          F_RULE,
          F_PLAY,
          F_WHY,
          ...F_TAIL,
        ]
      : ['Answer format — short, no preamble, no restating the state:', F_PLAY, F_WHY, F_RULE, F_CONFIDENCE, ...F_TAIL];
  return `${COACH_INTRO}${lines.join('\n')}`;
}

export const COACH_SYSTEM = coachSystem('classic');

// ---------------------------------------------------------------------------
// Small helpers

const isLand = (c: Card) => /\bLand\b/.test(c.types);
const isCreature = (c: Card) => /\bCreature\b/.test(c.types);

function playerName(state: GameStateBody, id: number | null, seat: number): string {
  if (id === null) return 'nobody';
  const p = state.players.find((x) => x.id === id);
  const n = p?.name ?? `Player ${id}`;
  return id === seat ? `you (${n})` : n;
}

function displayName(card: AnyCard | undefined | null): string {
  if (!card) return 'an unknown card';
  if (isHidden(card)) return 'a hidden card';
  const c = card as Card;
  if (c.faceDown) return c.alt ? `face-down ${c.alt.name}` : 'a face-down card';
  return c.name || 'a nameless card';
}

function cardsById(state: GameStateBody): Map<number, AnyCard> {
  const m = new Map<number, AnyCard>();
  for (const p of state.players) for (const z of Object.values(p.zones)) for (const c of (z as { cards: AnyCard[] }).cards) m.set(c.id, c);
  for (const c of state.stackCards ?? []) if (!m.has(c.id)) m.set(c.id, c);
  return m;
}

function counterText(counters: Record<string, number>): string {
  const keys = Object.keys(counters).sort();
  return keys
    .filter((k) => counters[k]! !== 0)
    .map((k) => `${counters[k]}× ${k}`)
    .join(', ');
}

function manaPoolText(p: PlayerState): string {
  const parts = MANA_COLORS.filter((c) => (p.manaPool[c] ?? 0) > 0).map((c) => `${c}×${p.manaPool[c]}`);
  return parts.length ? parts.join(' ') : 'empty';
}

const COLOR_ORDER = 'WUBRGC';

function manaSourcesText(sources: ManaSource[]): string {
  if (sources.length === 0) return '0';
  const groups = new Map<string, string[]>();
  for (const s of sources) {
    const key = s.colors.length ? [...s.colors].sort((a, b) => COLOR_ORDER.indexOf(a) - COLOR_ORDER.indexOf(b)).join('/') : 'unknown colour';
    // A Thriving land whose chosen colour the log doesn't record: only its own colour is certain.
    const name = s.unrecordedChoice ? `${s.name}: ${key}, or the colour chosen as it entered (not recorded)` : s.name;
    groups.set(key, [...(groups.get(key) ?? []), name]);
  }
  const keys = [...groups.keys()].sort();
  const per = keys.map((k) => {
    const names = groups.get(k)!;
    const counts = new Map<string, number>();
    for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
    const list = [...counts].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(', ');
    return `${k}×${names.length} (${list})`;
  });
  const byColor = COLOR_ORDER.split('')
    .map((col) => [col, sources.filter((s) => s.colors.includes(col)).length] as const)
    .filter(([, n]) => n > 0)
    .map(([col, n]) => `${col} ${n}`);
  const unsure = sources.some((s) => s.unrecordedChoice) ? ' (a land whose chosen colour is not recorded is counted only for its own colour)' : '';
  return `${sources.length} — ${per.join('; ')}${byColor.length ? ` · sources by colour: ${byColor.join(', ')}${unsure}` : ''}`;
}

// ---------------------------------------------------------------------------
// Permanents

function permanentLine(c: Card, byId: Map<number, AnyCard>): string {
  const bits: string[] = [];
  let head = displayName(c);
  if (c.token) head += ' (token)';
  head += ` #${c.id}`;
  if (c.faceDown) head += ' [face down]';
  bits.push(head);
  const type = c.types || '';
  if (c.power != null && c.toughness != null && (isCreature(c) || c.faceDown)) bits.push(`${c.power}/${c.toughness}`);
  if (type) bits.push(type);
  if (c.loyalty != null && !c.counters['LOYALTY'] && !c.counters['Loyalty']) bits.push(`loyalty ${c.loyalty}`);
  const kw = keywordsOf(c);
  if (kw.length) bits.push(kw.map((k) => k.toLowerCase().replace(/_/g, ' ')).join(', '));
  if (c.tapped) bits.push('TAPPED');
  if (c.sick && isCreature(c)) bits.push('SUMMONING SICK');
  if (c.attacking) bits.push('ATTACKING');
  if (c.blocking) bits.push('BLOCKING');
  const ctr = counterText(c.counters);
  if (ctr) bits.push(`counters: ${ctr}`);
  if (c.damage > 0) bits.push(`damage ${c.damage}`);
  if (c.attachedToId !== null) bits.push(`attached to ${displayName(byId.get(c.attachedToId))} #${c.attachedToId}`);
  if (c.attachmentIds.length) bits.push(`with ${c.attachmentIds.map((id) => `${displayName(byId.get(id))} #${id}`).join(', ')}`);
  return bits.join(' · ');
}

function landsLine(lands: Card[], cards?: Map<string, CardInfo>, chosen?: ChosenColors): string {
  const groups = new Map<string, number>();
  for (const c of lands) {
    const flags = [c.tapped ? 'TAPPED' : 'untapped'];
    if (chosen && chosenColorSource(c, cards)) {
      const pick = chosen.get(c.id);
      flags.push(pick ? `chosen colour ${colorName(pick)}` : 'chosen colour not recorded');
    }
    if (c.token) flags.push('token');
    const ctr = counterText(c.counters);
    if (ctr) flags.push(ctr);
    const key = `${displayName(c)} (${flags.join(', ')})`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return [...groups].map(([k, n]) => (n > 1 ? `${n}× ${k}` : k)).join('; ');
}

function battlefieldLines(p: PlayerState, byId: Map<number, AnyCard>, info?: Map<string, CardInfo>, chosen?: ChosenColors): string[] {
  const cards = p.zones.battlefield.cards;
  const hidden = cards.filter((c) => isHidden(c));
  const visible = cards.filter((c) => !isHidden(c)) as Card[];
  const lands = visible.filter((c) => isLand(c) && !isCreature(c));
  const creatures = visible.filter((c) => isCreature(c) || (c.faceDown && !isLand(c)));
  const other = visible.filter((c) => !lands.includes(c) && !creatures.includes(c));
  const out: string[] = [];
  out.push(`Lands (${lands.length}): ${lands.length ? landsLine(lands, info, chosen) : 'none'}`);
  out.push(`Creatures (${creatures.length}):${creatures.length ? '' : ' none'}`);
  for (const c of creatures) out.push(`  - ${permanentLine(c, byId)}`);
  if (other.length) {
    out.push(`Other permanents (${other.length}):`);
    for (const c of other) out.push(`  - ${permanentLine(c, byId)}`);
  }
  if (hidden.length) out.push(`Hidden permanents: ${hidden.length}`);
  return out;
}

function namesList(cards: AnyCard[]): string {
  if (cards.length === 0) return 'empty';
  const counts = new Map<string, number>();
  for (const c of cards) {
    const n = displayName(c);
    counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  return [...counts].map(([n, k]) => (k > 1 ? `${n} ×${k}` : n)).join('; ');
}

function handLines(p: PlayerState, isViewer: boolean): string[] {
  const cards = p.zones.hand.cards;
  if (isViewer) {
    if (cards.length === 0) return ['Hand (0): empty'];
    // Identical cards share a line ("Mountain ×3 · Basic Land - Mountain"), in first-seen order.
    const rows = new Map<string, { name: string; rest: string; n: number }>();
    for (const c of cards) {
      let name = 'a hidden card';
      let rest = '';
      if (!isHidden(c)) {
        const k = c as Card;
        name = displayName(k);
        rest = `${k.manaCost ? ` ${k.manaCost}` : ''}${k.types ? ` · ${k.types}` : ''}`;
      }
      const row = rows.get(name + rest) ?? { name, rest, n: 0 };
      row.n++;
      rows.set(name + rest, row);
    }
    return [`Hand (${p.zones.hand.count}):`, ...[...rows.values()].map((r) => `  - ${r.name}${r.n > 1 ? ` ×${r.n}` : ''}${r.rest}`)];
  }
  const known = cards.filter((c) => !isHidden(c));
  return [`Hand: ${p.zones.hand.count} cards${known.length ? ` (revealed: ${namesList(known)}; the rest hidden)` : ' (hidden)'}`];
}

// ---------------------------------------------------------------------------
// Stack, combat, ask

function stackLines(state: GameStateBody, seat: number, byId: Map<number, AnyCard>): string[] {
  if (state.stack.length === 0) return ['Stack: empty'];
  const out = [`Stack (${state.stack.length}, top resolves first):`];
  const stackCards = new Map<number, AnyCard>();
  for (const c of state.stackCards ?? []) stackCards.set(c.id, c);
  const items = [...state.stack].reverse();
  items.forEach((it, i) => {
    const src = it.sourceCardId !== null ? (stackCards.get(it.sourceCardId) ?? byId.get(it.sourceCardId)) : undefined;
    const who = playerName(state, it.controller, seat);
    const srcName = src ? displayName(src) : 'an unknown source';
    const text = it.text ? `: "${it.text.replace(/\s+/g, ' ').trim()}"` : '';
    const targets = [
      ...it.targetCardIds.map((id) => `${displayName(byId.get(id))} #${id}`),
      ...it.targetPlayerIds.map((id) => playerName(state, id, seat)),
    ];
    out.push(`  ${i + 1}. ${i === 0 ? '(top) ' : ''}${srcName} — controller ${who}${text}${targets.length ? ` → targets: ${targets.join(', ')}` : ''}`);
  });
  return out;
}

function powerOf(c: AnyCard | undefined): number {
  if (!c || isHidden(c)) return 0;
  const n = parseInt((c as Card).power ?? '0', 10);
  return Number.isFinite(n) ? n : 0;
}

function combatLines(state: GameStateBody, seat: number, byId: Map<number, AnyCard>): string[] {
  const bands = state.combat?.bands ?? [];
  if (bands.length === 0) return [];
  const out = ['Combat:'];
  let total = 0;
  let unblocked = 0;
  let defenderLife: number | null = null;
  for (const b of bands) {
    const atk = b.attackerIds.map((id) => {
      const c = byId.get(id);
      const pt = c && !isHidden(c) && (c as Card).power != null ? ` ${(c as Card).power}/${(c as Card).toughness}` : '';
      return `${displayName(c)} #${id}${pt}`;
    });
    let def = 'unknown';
    if (b.defender?.kind === 'player') {
      def = playerName(state, b.defender.id, seat);
      defenderLife = state.players.find((p) => p.id === b.defender!.id)?.life ?? defenderLife;
    } else if (b.defender) def = `${displayName(byId.get(b.defender.id))} #${b.defender.id}`;
    const blockers = b.blockerIds.filter((id) => !b.attackerIds.includes(id));
    const pow = b.attackerIds.reduce((s, id) => s + powerOf(byId.get(id)), 0);
    total += pow;
    if (blockers.length === 0 && b.defender?.kind === 'player') unblocked += pow;
    const bl = blockers.length ? `blocked by ${blockers.map((id) => `${displayName(byId.get(id))} #${id}`).join(', ')}` : 'no blockers (yet)';
    out.push(`  - ${atk.join(' + ')} → ${def} · ${bl}`);
  }
  out.push(`  Attacking power total ${total}; unblocked at a player ${unblocked}${defenderLife !== null ? ` (defending player's life ${defenderLife})` : ''}.`);
  return out;
}

/** An option's label as the prompt prints it: a bare number (an amount: 0, 1, 2 …) is quoted, so it is never read as the option's own number. */
export function optionLabelText(label: string): string {
  return /^\d+$/.test(label.trim()) ? `"${label.trim()}"` : label;
}

/**
 * The engine's options, numbered from 1 in the engine's order. The bench
 * numbers its choices the same way (bench/coachBench.ts), so "option 2" means
 * the same option in the coach's answer and in the bench's scoring.
 */
function optionLabels(opts: { label: string; card?: AnyCard }[], suffix: (i: number) => string = () => ''): string {
  return opts
    .map((o, i) => {
      // An option's label is engine text that the bridge already gates; a hidden card's label is "???".
      const label = o.card && isHidden(o.card) ? 'a hidden card' : o.label;
      return `  ${i + 1}. ${optionLabelText(label)}${suffix(i)}`;
    })
    .join('\n');
}

const LEGAL_ONLY = 'only these are legal';

function askLines(ask: AskBody, byId: Map<number, AnyCard>): string[] {
  const out: string[] = [`Engine question (${ask.kind}):`];
  const on = (card: AnyCard | null | undefined) => (card ? ` [card: ${displayName(card)}]` : '');
  switch (ask.kind) {
    case 'confirm':
      out.push(`  ${ask.prompt}${on(ask.card)} (${LEGAL_ONLY}):`, optionLabels([{ label: ask.yesLabel || 'yes' }, { label: ask.noLabel || 'no' }]));
      break;
    case 'options':
      out.push(`  ${ask.prompt}${on(ask.card)} (${LEGAL_ONLY}):`, optionLabels(ask.options));
      break;
    case 'text':
      out.push(`  ${ask.prompt}${ask.numeric ? ' (a number)' : ''}`);
      break;
    case 'choose_list':
    case 'choose_entities':
      out.push(`  ${ask.prompt} (choose ${ask.min === ask.max ? ask.max : `${ask.min}–${ask.max}`}; ${LEGAL_ONLY}):`, optionLabels(ask.options));
      break;
    case 'ability_menu':
      out.push(
        `  Which ability of ${displayName(byId.get(ask.cardId))} #${ask.cardId}?`,
        optionLabels(ask.options, (i) => (ask.options[i]!.canPlay ? '' : ' (not playable now)')),
      );
      break;
    case 'order':
      out.push(`  ${ask.prompt} (${ask.destLabel})`, optionLabels([...ask.dest, ...ask.source]));
      break;
    case 'assign_damage':
      out.push(
        `  Assign ${ask.total} combat damage from ${ask.attackerId !== null ? `${displayName(byId.get(ask.attackerId))} #${ask.attackerId}` : 'an attacker'}:`,
        ask.targets.map((t, i) => `  ${i + 1}. ${t.defender ? `${t.label} (defender)` : t.label}${t.lethal != null ? ` — lethal ${t.lethal}` : ''}`).join('\n'),
      );
      break;
    case 'assign_amount':
      out.push(`  Assign ${ask.total} ${ask.label}${ask.atLeastOne ? ' (at least 1 each)' : ''}:`, optionLabels(ask.targets));
      break;
    case 'manipulate_list':
      out.push(`  ${ask.prompt}`, optionLabels(ask.cards));
      break;
    case 'sideboard':
      out.push(`  ${ask.prompt}`);
      break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Picking a target

/** What the target is for: the spell or ability, from the input's focus card and the first part of its prompt. */
function targetSource(d: Decision, byId: Map<number, AnyCard>): string | null {
  const input = d.input;
  if (!input) return null;
  const head = input.prompt.split(/\n\s*\n/)[0]!.trim();
  // The focus card, else the "Name (id) - …" the prompt opens with (the bridge gates both).
  let id = input.focusCardId;
  const m = /^(.+?) \((\d+)\)/.exec(head);
  if (id === null && m) id = Number(m[2]);
  const focus = input.focusCard ?? (id !== null ? byId.get(id) : undefined);
  const name = focus ? (isHidden(focus) ? null : displayName(focus)) : m && Number(m[2]) === id ? m[1]!.trim() : null;
  // "Quake, Agent of S.H.I.E.L.D. (31) - Seismic Takedown — Whenever …" → "Seismic Takedown — Whenever …"
  let what = head.includes('\n') || /^Select\b/i.test(head) ? '' : head.replace(/ \(\d+\)/g, '').replace(/\s+/g, ' ').trim();
  if (name && what.startsWith(`${name} - `)) what = what.slice(name.length + 3).trim();
  if (name && what === name) what = '';
  if (!name && !what) return null;
  const who = name ? `${name}${id !== null ? ` #${id}` : ''}` : '';
  return [who, what].filter(Boolean).join(' — ');
}

function targetLines(d: Decision, seat: number, byId: Map<number, AnyCard>): string[] {
  const input = d.input!;
  const sel = input.selectable;
  const s = d.state;
  const out: string[] = [];
  const src = targetSource(d, byId);
  if (src) out.push(`Choosing a target for: ${src}`);
  const n = sel.min === sel.max ? `${sel.max}` : `${sel.min}–${sel.max}`;
  out.push(`Legal targets (the engine accepts only these; choose ${n}):`);
  // Numbered from 1 in the engine's order, as the bench numbers its target choices.
  if (sel.mode === 'players') {
    sel.cardIds.forEach((id, i) => out.push(`  ${i + 1}. ${playerName(s, id, seat)}`));
    return out;
  }
  for (const [i, id] of sel.cardIds.entries()) {
    const c = byId.get(id);
    const owner = s.players.find((p) => Object.values(p.zones).some((z) => (z.cards as AnyCard[]).some((x) => x.id === id)));
    const ctl = c && c.controller !== null && c.controller !== undefined ? c.controller : (owner?.id ?? null);
    const whose = ctl === null ? '' : ctl === seat ? 'yours' : `${playerName(s, ctl, seat)}'s`;
    const zone = owner ? (Object.entries(owner.zones).find(([, z]) => (z.cards as AnyCard[]).some((x) => x.id === id))?.[0] ?? '') : '';
    if (!c) {
      out.push(`  ${i + 1}. #${id}`);
      continue;
    }
    const where = zone && zone !== 'battlefield' ? ` · in ${zone}` : '';
    const line = isHidden(c) ? `${displayName(c)} #${id}` : permanentLine(c as Card, byId);
    out.push(`  ${i + 1}. ${line}${whose ? ` · ${whose}` : ''}${where}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Play or draw: the viewing seat's own deck

/** The viewing seat's own main deck as it answered the sideboarding question in this log (name → count), or null. */
function sideboardedDeck(log: GameLog, upTo: number): Map<string, number> | null {
  let ask: SideboardAsk | null = null;
  let deck: Map<string, number> | null = null;
  const end = Math.min(upTo, log.frames.length - 1);
  for (let i = 0; i <= end; i++) {
    const f = log.frames[i]!;
    if (f.type === 'ask' && (f.body as AskBody).kind === 'sideboard') ask = f.body as SideboardAsk;
    else if (f.type === 'answer' && ask && (f.body as { askId?: string }).askId === ask.askId) {
      const v = (f.body as { value?: unknown }).value;
      if (!Array.isArray(v)) continue;
      const all = [...ask.main, ...ask.side];
      deck = new Map();
      for (const id of v) {
        const o = all.find((x) => x.id === id);
        if (!o) continue;
        const n = o.label.replace(/\s*\([A-Z0-9]{2,6}\)\s*$/, '').trim();
        deck.set(n, (deck.get(n) ?? 0) + 1);
      }
    }
  }
  return deck;
}

function deckLines(log: GameLog, d: Decision, cards: Map<string, CardInfo>): string[] {
  const seat = log.seat;
  const out: string[] = ['# My deck'];
  const match = log.hello?.match;
  const header = log.header?.decks?.find((x) => x.player === seat);
  const file = header?.path ? header.path.replace(/^.*[\\/]/, '').replace(/\.dck$/i, '') : '';
  const name = match?.yourDeck?.name?.trim() || file || null;
  const size = match?.yourDeck?.cards ?? header?.cards ?? null;
  if (name || size) out.push(`${name ? `${name}` : 'My deck'}${size ? ` — ${size} cards` : ''}`);
  const deck = sideboardedDeck(log, d.frameIndex);
  if (deck && deck.size) {
    const isLandName = (n: string) => isBasicLandName(n) || /\bLand\b/.test(infoFor(n, cards)?.typeLine ?? '');
    const list = (pred: (n: string) => boolean) =>
      [...deck]
        .filter(([n]) => pred(n))
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([n, k]) => (k > 1 ? `${n} ×${k}` : n));
    const total = [...deck.values()].reduce((a, b) => a + b, 0);
    const lands = [...deck].filter(([n]) => isLandName(n)).reduce((a, [, k]) => a + k, 0);
    out.push(`Main deck for this game (as I sideboarded it): ${total} cards, ${lands} lands`);
    out.push(`  Lands: ${list(isLandName).join(', ') || 'none'}`);
    out.push(`  Other cards: ${list((n) => !isLandName(n)).join(', ') || 'none'}`);
  } else if (out.length === 1) {
    out.push('Deck list not in the log (see the play guide, if any).');
  }
  return out;
}

const PLAY_DRAW_QUESTION =
  "Before the game starts, the engine asks whether I want to play first or draw first. No opening hand is dealt yet, so judge from my deck (above, if known) and the play guide, not from a hand. Should I play or draw, and why? The general principle: in a two-player game going first is usually right — it is a full turn of tempo, so aggressive and midrange decks almost always play; drawing first can suit a slow, controlling deck that wins long games on card advantage, or a deck that badly needs to hit its land drops. Recommend one, and say what about my deck decides it.";

function targetQuestion(d: Decision, byId: Map<number, AnyCard>): string {
  const src = targetSource(d, byId);
  return `The engine wants me to choose a target${src ? ` for ${src.split(' — ').slice(0, 2).join(' — ')}` : ''}. Which numbered target is best, and why (what it does to the target, whose it is, what it changes this turn and on the opponent's next turn)? Which tempting target is wrong?`;
}

/** Ask kinds whose options the prompt numbers for a single pick. */
const NUMBERED_PICK: ReadonlySet<AskBody['kind']> = new Set(['confirm', 'options', 'choose_list', 'choose_entities', 'ability_menu']);

function questionFor(d: Decision, seat: number, byId: Map<number, AnyCard>): string {
  const s = d.state;
  const mine = s.activePlayer === seat;
  const phase = phaseLabel(s.phase);
  if (!s.phase || !s.turn) {
    if (isPlayDrawInput(d.input, s)) return PLAY_DRAW_QUESTION;
    return 'This is my opening hand, before the game starts. Should I keep it or mulligan? Judge lands, colours and early plays against what my deck needs.';
  }
  switch (d.kind) {
    case 'main':
      return s.phase === 'MAIN2'
        ? 'It is my second main phase (combat is over) and I have priority. What should I do now — land, spells, abilities — and what should I keep up for the opponent\'s turn?'
        : 'It is my first main phase and I have priority. What should I do this turn — land drop, spells and abilities in order, whether and with what to attack — and what should I hold back?';
    case 'attack':
      return 'I am declaring attackers. Which creatures should attack (and at whom), which should stay home, and why? Count lethal both ways.';
    case 'block':
      return 'The opponent is attacking me. How should I block — which blocker on which attacker, or no block — and should I use anything before or after blocks? Count lethal both ways.';
    case 'choice':
      if (!d.ask && isTargetInput(d.input)) return targetQuestion(d, byId);
      if (d.ask && NUMBERED_PICK.has(d.ask.kind)) return 'The engine is asking me the question above. Which numbered option should I choose, and why?';
      return 'The engine is asking me the question above. What should I choose, and why?';
    case 'priority':
    default:
      if (s.stack.length > 0) return 'There is something on the stack and I have priority. Should I respond (with what, paid how), or let it resolve?';
      if (!mine) return `I have priority during the opponent's ${phase}. Should I do anything now (an instant, an ability), or pass?`;
      return `I have priority in my ${phase}. Should I do anything now, or pass?`;
  }
}

// ---------------------------------------------------------------------------
// Card names

/**
 * Every card name whose oracle text the coach prompt for this decision may
 * include (what the app looks up). The prompt then leaves out a card that is
 * only in the viewer's graveyard and does nothing from there (`promptCardNames`).
 */
export function coachCardNames(log: GameLog, d: Decision): string[] {
  return collectCardNames(log, d, true);
}

function collectCardNames(log: GameLog, d: Decision, graveyard: boolean): string[] {
  const seat = log.seat;
  const s = d.state;
  const out = new Set<string>();
  const add = (c: AnyCard | null | undefined) => {
    if (!c || isHidden(c)) return;
    if ((c as Card).token) return; // tokens have no printed card to look up
    const n = visibleName(c);
    if (n && !isBasicLandName(n)) out.add(n);
  };
  const me = s.players.find((p) => p.id === seat);
  const opps = s.players.filter((p) => p.id !== seat);
  me?.zones.hand.cards.forEach(add);
  me?.zones.battlefield.cards.forEach(add);
  for (const p of opps) p.zones.battlefield.cards.forEach(add);
  (s.stackCards ?? []).forEach(add);
  for (const p of opps) p.zones.hand.cards.forEach(add); // only revealed ones survive `add`
  for (const p of s.players) p.zones.command.cards.forEach(add);
  if (graveyard) me?.zones.graveyard.cards.forEach(add);
  add(d.input?.focusCard);
  if (isTargetInput(d.input)) {
    // The spell or ability being targeted: often on its way to the stack and in no zone yet.
    const src = d.input!.focusCardId !== null ? cardsById(s).get(d.input!.focusCardId) : undefined;
    if (src) add(src);
    else {
      const m = /^(.+?) \(\d+\) - /.exec(d.input!.prompt.trim());
      if (m && !isBasicLandName(m[1]!.trim())) out.add(m[1]!.trim());
    }
  }
  if (d.ask) {
    const a = d.ask as unknown as { card?: AnyCard | null; options?: { card?: AnyCard }[]; targets?: { card?: AnyCard }[]; cards?: { card?: AnyCard }[] };
    add(a.card);
    for (const o of [...(a.options ?? []), ...(a.targets ?? []), ...(a.cards ?? [])]) add(o.card);
  }
  return [...out];
}

/** Oracle text that works from a graveyard (or mentions one): such a card's text matters while it sits there. */
const FROM_GRAVEYARD = /graveyard|flashback|escape|unearth|embalm|eternalize|disturb|jump-start|retrace|aftermath|dredge|scavenge|encore|madness/i;

/**
 * The names whose text the prompt prints, in `coachCardNames` order: a card
 * seen only in the viewer's graveyard is dropped when its known text does
 * nothing from there (it is still named in the graveyard line).
 */
function promptCardNames(log: GameLog, d: Decision, cards: Map<string, CardInfo>): string[] {
  const elsewhere = new Set(collectCardNames(log, d, false));
  return coachCardNames(log, d).filter((n) => {
    if (elsewhere.has(n)) return true;
    const info = infoFor(n, cards);
    return !info || !info.found || FROM_GRAVEYARD.test(info.oracleText);
  });
}

/** Keywords every player knows: their reminder text is dropped from the prompt (new mechanics keep theirs). */
const KNOWN_KEYWORD =
  /^((?:Flying|Reach|Vigilance|Trample|Haste|Deathtouch|Lifelink|First strike|Double strike|Menace|Defender|Flash|Hexproof|Indestructible|Prowess|Ward|Equip|Cycling|Basic landcycling)\b[^()\n]*?)\s*\([^()\n]*\)\s*$/i;

/** Oracle text without the reminder text of well-known keywords, scry and surveil. */
export function withoutKnownReminders(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(KNOWN_KEYWORD, '$1').replace(/\b((?:scry|surveil) \d+\.?)\s*\((?:Look at|To scry|To surveil)[^()]*\)/gi, '$1'))
    .join('\n');
}

/** The card map with concise oracle text, for the names the prompt prints. */
function conciseCards(names: string[], cards: Map<string, CardInfo>): Map<string, CardInfo> {
  const out = new Map(cards);
  for (const n of names) {
    const info = cards.get(n);
    if (info?.oracleText) out.set(n, { ...info, oracleText: withoutKnownReminders(info.oracleText) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The prompt

function playerSection(
  log: GameLog,
  d: Decision,
  p: PlayerState,
  cards: Map<string, CardInfo>,
  byId: Map<number, AnyCard>,
  chosen: ChosenColors,
): string[] {
  const s = d.state;
  const viewer = p.id === log.seat;
  const out: string[] = [];
  out.push(`## ${viewer ? 'YOU' : 'OPPONENT'} — ${p.name}${s.activePlayer === p.id ? ' (active player)' : ''}`);
  const gy = p.zones.graveyard;
  const ex = p.zones.exile;
  out.push(
    `Life ${p.life}${p.poison ? ` · poison ${p.poison}` : ''} · library ${p.zones.library.count} · hand ${p.zones.hand.count} · graveyard ${gy.count} · exile ${ex.count}`,
  );
  const pc = Object.entries(p.counters).filter(([k, v]) => v && k.toLowerCase() !== 'poison');
  if (pc.length) out.push(`Player counters: ${pc.map(([k, v]) => `${v}× ${k}`).join(', ')}`);
  const pregame = !s.phase || !s.turn;
  if (!pregame) {
    const sources = untappedManaSources(s, p.id, cards, chosen);
    // An empty pool is the normal case (the system prompt says it is shown only when not empty).
    const pool = manaPoolText(p);
    if (pool !== 'empty') out.push(`Mana pool: ${pool}`);
    out.push(`Untapped mana sources: ${manaSourcesText(sources)}`);
    const facts = turnFacts(log, d.frameIndex, p.id);
    const turn: string[] = [];
    if (s.activePlayer === p.id) turn.push(`land drop ${facts.landPlayed === null ? 'unknown' : facts.landPlayed ? 'USED' : 'available'}`);
    const casts = facts.cast.filter((c) => c.playerId === p.id).map((c) => c.name);
    turn.push(`spells cast: ${casts.length ? casts.join('; ') : 'none'}`);
    turn.push(`left the battlefield (revolt): ${facts.leftBattlefield.length ? facts.leftBattlefield.join('; ') : 'none'}`);
    out.push(`This turn: ${turn.join(' · ')}`);
  }
  // At play-or-draw no hand is dealt yet: an empty hand is not something to judge.
  const playDraw = pregame && isPlayDrawInput(d.input, s);
  if (!(playDraw && viewer && p.zones.hand.count === 0)) out.push(...handLines(p, viewer));
  if (viewer && !pregame) {
    const inst = instantSpeedOptions(s, p.id, cards, chosen);
    if (inst.length) {
      out.push(
        `Instant-speed options the mana covers (heuristic — check the text): ${inst.map((o) => `${o.name}${o.via === 'ability' ? ` (ability ${o.cost})` : o.cost ? ` ${o.cost}` : ''}`).join('; ')}`,
      );
    }
  }
  if (pregame) return out;
  out.push(...battlefieldLines(p, byId, cards, chosen));
  out.push(`Graveyard: ${namesList(gy.cards)}`);
  if (ex.count) out.push(`Exile: ${namesList(ex.cards)}`);
  if (p.zones.command.count) out.push(`Command zone: ${namesList(p.zones.command.cards)}`);
  return out;
}

export function buildCoachPrompt(
  log: GameLog,
  d: Decision,
  cards: Map<string, CardInfo>,
  opts?: { guide?: string; cube?: CubeCoachInput; format?: PromptFormat },
): Prompt {
  const s = d.state;
  const seat = log.seat;
  const byId = cardsById(s);
  const lines: string[] = [];
  const pregame = !s.phase || !s.turn;
  const playDraw = pregame && isPlayDrawInput(d.input, s);
  // Colours chosen for the seat's own Thriving-style lands, from its own answers so far.
  const chosen = chosenColors(log, d.frameIndex, seat, cards);

  const round = s.round || Math.ceil((s.turn || 0) / 2);
  const whose = s.activePlayer === seat ? 'my turn' : `${playerName(s, s.activePlayer, seat)}'s turn`;
  lines.push('# Decision');
  const prio = d.kind === 'main' || d.kind === 'priority' ? ` · priority: ${playerName(s, s.priority, seat)}` : '';
  if (playDraw) lines.push('Pre-game · play or draw (no opening hand dealt yet)');
  else if (pregame) lines.push('Pre-game · opening hand (keep or mulligan)');
  else lines.push(`Round ${round} (turn ${s.turn}) · ${phaseLabel(s.phase)} · ${whose}${prio}`);
  lines.push(`Decision type: ${d.kind}`);
  // The input's prompt, unless an engine question is open on top of it (it is then a leftover, e.g.
  // "Yielding until end of turn") or it only repeats the line above ("Priority: … / Turn: … / Phase: …").
  const enginePrompt = d.input?.prompt ? d.input.prompt.replace(/\s*\n\s*/g, ' / ').trim() : '';
  if (enginePrompt && !d.ask && !/^Priority:/i.test(enginePrompt)) lines.push(`Engine prompt: ${enginePrompt}`);
  if (d.ask) lines.push(...askLines(d.ask, byId));
  else if (d.kind === 'choice' && isTargetInput(d.input)) lines.push(...targetLines(d, seat, byId));

  const me = s.players.find((p) => p.id === seat);
  const others = s.players.filter((p) => p.id !== seat);
  for (const p of [...(me ? [me] : []), ...others]) {
    lines.push('');
    lines.push(...playerSection(log, d, p, cards, byId, chosen));
  }

  lines.push('');
  lines.push(...stackLines(s, seat, byId));
  const combat = combatLines(s, seat, byId);
  if (combat.length) lines.push(...combat);

  const names = promptCardNames(log, d, cards);
  const seen = new Map<string, Card>();
  for (const c of byId.values()) {
    const n = visibleName(c);
    if (n && !seen.has(n) && !(c as Card).faceDown) seen.set(n, c as Card);
  }
  lines.push('');
  lines.push('# Card text');
  lines.push(names.length ? formatCardTexts(names, conciseCards(names, cards), seen) : '(no non-basic cards in view)');

  const cubeSection = buildCubeContext(log, opts?.cube, d.frameIndex);
  if (cubeSection) lines.push('', cubeSection);

  if (playDraw) lines.push('', ...deckLines(log, d, cards));

  if (opts?.guide && opts.guide.trim()) {
    lines.push('');
    lines.push('# My deck play guide');
    lines.push(opts.guide.trim());
  }

  lines.push('');
  lines.push('# Question');
  lines.push(questionFor(d, seat, byId));

  return { system: coachSystem(opts?.format ?? 'classic'), user: lines.join('\n') };
}

/** One paste-able block for the Claude app (system + user, clearly separated). */
export function promptAsText(p: Prompt): string {
  return `${p.system}\n\n---\n\n${p.user}`;
}
