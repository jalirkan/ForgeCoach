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
import type { AnyCard, AskBody, Card, GameStateBody, PlayerState } from './protocol.ts';
import { isHidden, keywordsOf, MANA_COLORS } from './protocol.ts';
import type { GameLog } from './log.ts';
import type { Decision } from './decisions.ts';
import { phaseLabel } from './decisions.ts';
import type { CardInfo } from './cards.ts';
import type { ManaSource } from './state.ts';
import { instantSpeedOptions, turnFacts, untappedManaSources } from './state.ts';
import { formatCardTexts, isBasicLandName, visibleName } from './review.ts';

export interface Prompt {
  system: string;
  user: string;
}

// ---------------------------------------------------------------------------
// System prompt

export const COACH_SYSTEM = `You are a Magic: The Gathering coach sitting next to a newer player (started a few months ago) who is playing against the Forge AI. At each decision you get the exact game state straight from the engine, the oracle text of the cards involved, and sometimes a play guide for the player's deck.

Trust the state, not intuition: TAPPED, SUMMONING SICK, counters, damage, P/T (already including pumps and counters), the mana pool, the untapped mana sources, the land drop and the spells cast this turn are exact. Use the given card text, never memory of a card; if a card's text is unavailable, say what you assume it does. Cards marked hidden are unknown — reason about what the opponent could have, never claim to know it.

Before recommending any attack, activation or spell, check:
- Summoning sickness: a creature marked SUMMONING SICK can't attack and can't pay a {T} cost (including a creature's mana ability). It CAN block, use abilities without {T}, be sacrificed, be equipped and be targeted.
- {T} in a cost means once per untap: "{1}, {T}: …" (Hangarback Walker) is once a turn; an ability with no {T} ("{1}: +1/+0", like Edgar's pump) can be activated again and again while you can pay.
- Mana: only the listed untapped sources plus the mana pool are available, each source makes one mana of one of its colours, and the pool empties between steps. Check colour requirements, not just the total. Say which sources pay for what.
- Land drop: one per turn unless a card says otherwise; the state says whether it is used.
- "Whenever you cast an instant or sorcery" (Young Pyromancer, prowess) triggers only on instants and sorceries — not creatures, artifacts or enchantments, and never on activated abilities. A copy that is cast (e.g. Prepared in Reality Fracture) is a spell; an activation is not.
- Equip is sorcery speed (your main phase, empty stack), activated from the Equipment, and may target a summoning-sick creature. Equipment that lowers toughness (Skullclamp's +1/-1) kills a 1-toughness creature immediately as a state-based action, and its death triggers still happen.
- Triggered abilities ("whenever … dies / attacks / enters") work whether the source is tapped or not.
- Revolt-style conditions ("if a permanent you controlled left the battlefield this turn", Fatal Push) count any permanent: a cracked fetchland, a sacrificed creature, a dead token. The state lists what left this turn.
- Read restrictions literally: "can't block" (Bloodghast, Gravecrawler), conditional haste (Bloodghast only while an opponent is at 10 life or less; it returns on every landfall, fetched lands included), conditional recasting (Gravecrawler only while you control a Zombie).
- Respond to removal by sacrificing its target for value when you have an outlet.
- Count lethal both ways before every attack and every block: what you can push through against their life and untapped blockers, and what they can swing back with next turn against your life and blockers.

Answer format — short, no preamble, no restating the state:
**Play:** one recommended line as numbered steps in order. For every spell or ability give its cost and which sources pay it, and what mana is left at the end. For combat, name every attacker / blocker assignment.
**Why:** two or three sentences. Name the heuristic the line follows ("count lethal", "hold the outlet", "fodder before payoffs", "trade on your terms", "use all your mana", "don't overextend") so the pattern transfers.
**Trap:** the tempting wrong play here and why it's wrong.
**Their turn:** what the opponent can do next (their untapped creatures, open mana, cards in hand) and what to keep back for it.
**Alternative:** only if a second line is genuinely close; otherwise leave this out.
**Assumptions:** only if something is ambiguous or a card's text is unavailable — state it rather than guessing.`;

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
    groups.set(key, [...(groups.get(key) ?? []), s.name]);
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
  return `${sources.length} — ${per.join('; ')}${byColor.length ? ` · sources by colour: ${byColor.join(', ')}` : ''}`;
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

function landsLine(lands: Card[]): string {
  const groups = new Map<string, number>();
  for (const c of lands) {
    const flags = [c.tapped ? 'TAPPED' : 'untapped'];
    if (c.token) flags.push('token');
    const ctr = counterText(c.counters);
    if (ctr) flags.push(ctr);
    const key = `${displayName(c)} (${flags.join(', ')})`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return [...groups].map(([k, n]) => (n > 1 ? `${n}× ${k}` : k)).join('; ');
}

function battlefieldLines(p: PlayerState, byId: Map<number, AnyCard>): string[] {
  const cards = p.zones.battlefield.cards;
  const hidden = cards.filter((c) => isHidden(c));
  const visible = cards.filter((c) => !isHidden(c)) as Card[];
  const lands = visible.filter((c) => isLand(c) && !isCreature(c));
  const creatures = visible.filter((c) => isCreature(c) || (c.faceDown && !isLand(c)));
  const other = visible.filter((c) => !lands.includes(c) && !creatures.includes(c));
  const out: string[] = [];
  out.push(`Lands (${lands.length}): ${lands.length ? landsLine(lands) : 'none'}`);
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
    return [
      `Hand (${p.zones.hand.count}):`,
      ...cards.map((c) => {
        if (isHidden(c)) return '  - a hidden card';
        const k = c as Card;
        return `  - ${displayName(k)}${k.manaCost ? ` ${k.manaCost}` : ''}${k.types ? ` · ${k.types}` : ''}`;
      }),
    ];
  }
  const known = cards.filter((c) => !isHidden(c));
  return [`Hand: ${p.zones.hand.count} cards${known.length ? ` (revealed: ${namesList(known)})` : ' (hidden)'}`];
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

function optionLabels(opts: { label: string; card?: AnyCard }[]): string {
  return opts
    .map((o, i) => {
      // An option's label is engine text that the bridge already gates; a hidden card's label is "???".
      const label = o.card && isHidden(o.card) ? 'a hidden card' : o.label;
      return `  ${i}. ${label}`;
    })
    .join('\n');
}

function askLines(ask: AskBody, byId: Map<number, AnyCard>): string[] {
  const out: string[] = [`Engine question (${ask.kind}):`];
  switch (ask.kind) {
    case 'confirm':
      out.push(`  ${ask.prompt}${ask.card ? ` [card: ${displayName(ask.card)}]` : ''} — ${ask.yesLabel} / ${ask.noLabel}`);
      break;
    case 'options':
      out.push(`  ${ask.prompt}${ask.card ? ` [card: ${displayName(ask.card)}]` : ''}`, optionLabels(ask.options));
      break;
    case 'text':
      out.push(`  ${ask.prompt}${ask.numeric ? ' (a number)' : ''}`);
      break;
    case 'choose_list':
      out.push(`  ${ask.prompt} (choose ${ask.min}–${ask.max})`, optionLabels(ask.options));
      break;
    case 'choose_entities':
      out.push(`  ${ask.prompt} (choose ${ask.min}–${ask.max})`, optionLabels(ask.options));
      break;
    case 'ability_menu':
      out.push(
        `  Which ability of ${displayName(byId.get(ask.cardId))} #${ask.cardId}?`,
        ask.options.map((o, i) => `  ${i}. ${o.label}${o.canPlay ? '' : ' (not playable now)'}`).join('\n'),
      );
      break;
    case 'order':
      out.push(`  ${ask.prompt} (${ask.destLabel})`, optionLabels([...ask.dest, ...ask.source]));
      break;
    case 'assign_damage':
      out.push(
        `  Assign ${ask.total} combat damage from ${ask.attackerId !== null ? `${displayName(byId.get(ask.attackerId))} #${ask.attackerId}` : 'an attacker'}:`,
        ask.targets.map((t, i) => `  ${i}. ${t.defender ? `${t.label} (defender)` : t.label}${t.lethal != null ? ` — lethal ${t.lethal}` : ''}`).join('\n'),
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

function questionFor(d: Decision, seat: number): string {
  const s = d.state;
  const mine = s.activePlayer === seat;
  const phase = phaseLabel(s.phase);
  if (!s.phase || !s.turn) {
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

/** Every card name whose oracle text the coach prompt for this decision will include. */
export function coachCardNames(log: GameLog, d: Decision): string[] {
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
  me?.zones.graveyard.cards.forEach(add);
  add(d.input?.focusCard);
  if (d.ask) {
    const a = d.ask as unknown as { card?: AnyCard | null; options?: { card?: AnyCard }[]; targets?: { card?: AnyCard }[]; cards?: { card?: AnyCard }[] };
    add(a.card);
    for (const o of [...(a.options ?? []), ...(a.targets ?? []), ...(a.cards ?? [])]) add(o.card);
  }
  return [...out];
}

// ---------------------------------------------------------------------------
// The prompt

function playerSection(
  log: GameLog,
  d: Decision,
  p: PlayerState,
  cards: Map<string, CardInfo>,
  byId: Map<number, AnyCard>,
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
    const sources = untappedManaSources(s, p.id, cards);
    out.push(`Mana pool: ${manaPoolText(p)}`);
    out.push(`Untapped mana sources: ${manaSourcesText(sources)}`);
    const facts = turnFacts(log, d.frameIndex, p.id);
    if (s.activePlayer === p.id) {
      out.push(`Land drop this turn: ${facts.landPlayed === null ? 'unknown' : facts.landPlayed ? 'USED' : 'available'}`);
    }
    const casts = facts.cast.filter((c) => c.playerId === p.id).map((c) => c.name);
    out.push(`Spells cast this turn: ${casts.length ? casts.join('; ') : 'none'}`);
    out.push(`Permanents that left the battlefield this turn (revolt): ${facts.leftBattlefield.length ? facts.leftBattlefield.join('; ') : 'none'}`);
  }
  out.push(...handLines(p, viewer));
  if (viewer && !pregame) {
    const inst = instantSpeedOptions(s, p.id, cards);
    if (inst.length) {
      out.push(
        `Instant-speed options the mana covers (heuristic — check the text): ${inst.map((o) => `${o.name}${o.via === 'ability' ? ` (ability ${o.cost})` : o.cost ? ` ${o.cost}` : ''}`).join('; ')}`,
      );
    }
  }
  if (pregame) return out;
  out.push(...battlefieldLines(p, byId));
  out.push(`Graveyard: ${namesList(gy.cards)}`);
  if (ex.count) out.push(`Exile: ${namesList(ex.cards)}`);
  if (p.zones.command.count) out.push(`Command zone: ${namesList(p.zones.command.cards)}`);
  return out;
}

export function buildCoachPrompt(log: GameLog, d: Decision, cards: Map<string, CardInfo>, opts?: { guide?: string }): Prompt {
  const s = d.state;
  const seat = log.seat;
  const byId = cardsById(s);
  const lines: string[] = [];

  const round = s.round || Math.ceil((s.turn || 0) / 2);
  const whose = s.activePlayer === seat ? 'my turn' : `${playerName(s, s.activePlayer, seat)}'s turn`;
  lines.push('# Decision');
  const prio = d.kind === 'main' || d.kind === 'priority' ? ` · priority: ${playerName(s, s.priority, seat)}` : '';
  if (!s.phase || !s.turn) lines.push('Pre-game · opening hand (keep or mulligan)');
  else lines.push(`Round ${round} (turn ${s.turn}) · ${phaseLabel(s.phase)} · ${whose}${prio}`);
  lines.push(`Decision type: ${d.kind}`);
  if (d.input?.prompt) lines.push(`Engine prompt: ${d.input.prompt.replace(/\s*\n\s*/g, ' / ').trim()}`);
  if (d.ask) lines.push(...askLines(d.ask, byId));

  const me = s.players.find((p) => p.id === seat);
  const others = s.players.filter((p) => p.id !== seat);
  for (const p of [...(me ? [me] : []), ...others]) {
    lines.push('');
    lines.push(...playerSection(log, d, p, cards, byId));
  }

  lines.push('');
  lines.push(...stackLines(s, seat, byId));
  const combat = combatLines(s, seat, byId);
  if (combat.length) lines.push(...combat);

  const names = coachCardNames(log, d);
  const seen = new Map<string, Card>();
  for (const c of byId.values()) {
    const n = visibleName(c);
    if (n && !seen.has(n) && !(c as Card).faceDown) seen.set(n, c as Card);
  }
  lines.push('');
  lines.push('# Card text');
  lines.push(names.length ? formatCardTexts(names, cards, seen) : '(no non-basic cards in view)');

  if (opts?.guide && opts.guide.trim()) {
    lines.push('');
    lines.push('# My deck play guide');
    lines.push(opts.guide.trim());
  }

  lines.push('');
  lines.push('# Question');
  lines.push(questionFor(d, seat));

  return { system: COACH_SYSTEM, user: lines.join('\n') };
}

/** One paste-able block for the Claude app (system + user, clearly separated). */
export function promptAsText(p: Prompt): string {
  return `${p.system}\n\n---\n\n${p.user}`;
}
