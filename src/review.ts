/*
 * ForgeCoach — review.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The post-game review: a compact turn-by-turn history built from the §3.6
 * events of every state frame, plus the prompt that asks for the review.
 *
 * Events carry ids only, so every name is resolved against the snapshot the
 * event arrived with (after the change) or the one before it (before the
 * change) — never a later or earlier one, so a card that was public once and
 * then went back into a hidden zone is not named by accident.
 *
 * The history walker and the card-text formatter are exported because the
 * coach prompt uses them too.
 */
import type { AnyCard, Card, GameEvent, GameStateBody } from './protocol.ts';
import { isHidden } from './protocol.ts';
import type { GameLog } from './log.ts';
import type { CardInfo } from './cards.ts';
import type { Prompt } from './prompt.ts';
import { buildCubeContext, type CubeCoachInput } from './cube/coachContext.ts';

// ---------------------------------------------------------------------------
// Card helpers shared with prompt.ts

const BASIC_LANDS = new Set(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes']);

/** Basic lands need no oracle text in a prompt. */
export function isBasicLandName(name: string): boolean {
  return BASIC_LANDS.has(name) || BASIC_LANDS.has(name.replace(/^Snow-Covered /, ''));
}

/** The name the viewer may use for this card, or null when it must not be named. */
export function visibleName(card: AnyCard | undefined | null): string | null {
  if (!card || isHidden(card)) return null;
  const c = card as Card;
  if (c.faceDown) return c.alt?.name || null;
  return c.name || null;
}

/**
 * One "Card text" block: every name once, in the given order, with cost, type
 * line, P/T and oracle text. `seen` supplies type / cost / P/T from the state
 * for cards the lookup does not know.
 */
export function formatCardTexts(names: string[], cards: Map<string, CardInfo>, seen?: Map<string, Card>): string {
  const out: string[] = [];
  for (const name of names) {
    const info = cards.get(name);
    if (info && info.found && info.oracleText.trim() !== '') {
      const head = [name];
      if (info.manaCost) head.push(info.manaCost);
      let line = head.join(' ');
      if (info.typeLine) line += ` — ${info.typeLine}`;
      if (info.power != null && info.toughness != null) line += ` — ${info.power}/${info.toughness}`;
      if (info.loyalty != null) line += ` — loyalty ${info.loyalty}`;
      const text = info.oracleText
        .trim()
        .split('\n')
        .map((l) => `  ${l}`)
        .join('\n');
      out.push(`${line}\n${text}`);
    } else {
      const c = seen?.get(name);
      let line = name;
      if (c) {
        if (c.manaCost) line += ` ${c.manaCost}`;
        if (c.types) line += ` — ${c.types}`;
        if (c.power != null && c.toughness != null) line += ` — ${c.power}/${c.toughness}`;
      }
      out.push(`${line}\n  (text unavailable)`);
    }
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// The history walker

export interface HistoryEvent {
  /** Index into log.frames of the state frame that carried the event. */
  frameIndex: number;
  /** Player-turn number the event belongs to (from the `turn` events). */
  turn: number;
  event: GameEvent;
}

export interface CastRecord {
  frameIndex: number;
  playerId: number;
  name: string | null;
  /** True for a spell (the card moved to the stack first); false for an ability or trigger. */
  spell: boolean;
  text: string;
}

export interface AttackRecord {
  frameIndex: number;
  playerId: number;
  attackers: { id: number; name: string | null; power: string | null; toughness: string | null }[];
  defender: string;
  /** attacker id → blocker names. Filled from the `blockers` event. */
  blocks: Map<number, (string | null)[]>;
}

export interface LeftRecord {
  frameIndex: number;
  /** Controller just before it left. */
  playerId: number | null;
  name: string | null;
  creature: boolean;
  token: boolean;
  to: string | null;
  sacrificed: boolean;
}

export interface TurnRecord {
  turn: number;
  activePlayer: number | null;
  lands: { frameIndex: number; playerId: number; name: string | null }[];
  casts: CastRecord[];
  attacks: AttackRecord[];
  life: { playerId: number; from: number; to: number }[];
  left: LeftRecord[];
  /** Tokens that entered from nowhere. */
  created: { playerId: number | null; name: string | null }[];
  mulligans: number[];
}

export interface GameHistory {
  turns: TurnRecord[];
  /** Index of each state frame in log.frames, in order. */
  stateFrames: number[];
}

function stateAt(log: GameLog, i: number): GameStateBody | null {
  const f = log.frames[i];
  return f && f.type === 'state' ? (f.body as GameStateBody) : null;
}

/** Every card of one snapshot by id, with the player whose zone holds it. */
export type CardIndex = Map<number, { card: AnyCard; playerId: number | null; zone: string }>;

export function indexOf(state: GameStateBody | null): CardIndex {
  const m: CardIndex = new Map();
  if (!state) return m;
  for (const c of state.stackCards ?? []) m.set(c.id, { card: c, playerId: c.controller, zone: 'stack' });
  for (const p of state.players) {
    for (const [zone, z] of Object.entries(p.zones)) {
      for (const c of (z as { cards: AnyCard[] }).cards ?? []) m.set(c.id, { card: c, playerId: p.id, zone });
    }
  }
  return m;
}

/**
 * Names and cards for the ids one state frame's events mention: the snapshot
 * the events arrived with (after the change) first, then the one before it
 * (before the change) — never any other, so a card that was public once and
 * went back into a hidden zone is not named by accident.
 */
export interface FrameResolver {
  nameOf(id: number): string | null;
  cardOf(id: number): Card | null;
}

export function frameResolver(prevIdx: CardIndex, postIdx: CardIndex): FrameResolver {
  return {
    nameOf(id) {
      const post = postIdx.get(id);
      const n = post ? visibleName(post.card) : null;
      if (n) return n;
      const pre = prevIdx.get(id);
      return pre ? visibleName(pre.card) : null;
    },
    cardOf(id) {
      const post = postIdx.get(id);
      if (post && !isHidden(post.card)) return post.card as Card;
      const pre = prevIdx.get(id);
      if (pre && !isHidden(pre.card)) return pre.card as Card;
      return null;
    },
  };
}

const historyCache = new WeakMap<GameLog, GameHistory>();

/** Walks every state frame once; cached per log object. */
export function gameHistory(log: GameLog): GameHistory {
  const hit = historyCache.get(log);
  if (hit) return hit;
  const turns: TurnRecord[] = [];
  const stateFrames: number[] = [];
  let cur: TurnRecord | null = null;
  const pendingToStack = new Set<number>();
  let prevIdx: CardIndex = new Map();
  let openAttack: AttackRecord | null = null;

  const ensure = (turn: number, active: number | null): TurnRecord => {
    if (!cur || cur.turn !== turn) {
      cur = { turn, activePlayer: active, lands: [], casts: [], attacks: [], life: [], left: [], created: [], mulligans: [] };
      turns.push(cur);
    }
    return cur;
  };

  log.frames.forEach((f, fi) => {
    if (f.type !== 'state') return;
    stateFrames.push(fi);
    const s = f.body as GameStateBody;
    const postIdx = indexOf(s);
    const { nameOf, cardOf } = frameResolver(prevIdx, postIdx);
    if (!cur) ensure(s.turn || 0, s.activePlayer);
    for (const e of s.events ?? []) {
      let t: TurnRecord = cur!;
      switch (e.kind) {
        case 'turn':
          t = ensure(e.turn, e.player);
          pendingToStack.clear();
          openAttack = null;
          break;
        case 'mulligan':
          t.mulligans.push(e.player);
          break;
        case 'land':
          t.lands.push({ frameIndex: fi, playerId: e.player, name: nameOf(e.cardId) });
          break;
        case 'zone':
          if (e.to?.zone === 'stack' && e.from && e.from.zone !== 'stack') pendingToStack.add(e.cardId);
          if (e.from === null && e.to?.zone === 'battlefield') t.created.push({ playerId: e.to.player, name: nameOf(e.cardId) });
          if (e.from?.zone === 'battlefield' && e.to?.zone !== 'battlefield') {
            const pre = prevIdx.get(e.cardId);
            const c = cardOf(e.cardId);
            t.left.push({
              frameIndex: fi,
              playerId: pre && !isHidden(pre.card) ? ((pre.card as Card).controller ?? pre.playerId) : (e.from.player ?? null),
              name: nameOf(e.cardId),
              creature: !!c && /\bCreature\b/.test(c.types),
              token: !!c && c.token,
              to: e.to?.zone ?? null,
              sacrificed: false,
            });
          }
          break;
        case 'sacrificed': {
          const rec = [...t.left].reverse().find((l) => l.frameIndex === fi && l.name === nameOf(e.cardId));
          if (rec) rec.sacrificed = true;
          else {
            const c = cardOf(e.cardId);
            t.left.push({
              frameIndex: fi,
              playerId: c?.controller ?? null,
              name: nameOf(e.cardId),
              creature: !!c && /\bCreature\b/.test(c.types),
              token: !!c && c.token,
              to: 'graveyard',
              sacrificed: true,
            });
          }
          break;
        }
        case 'cast': {
          const spell = pendingToStack.has(e.cardId);
          pendingToStack.delete(e.cardId);
          t.casts.push({ frameIndex: fi, playerId: e.controller, name: nameOf(e.cardId), spell, text: e.text });
          break;
        }
        case 'attackers': {
          const attackers: AttackRecord['attackers'] = [];
          let defender = '';
          for (const b of e.bands) {
            for (const id of b.attackerIds) {
              const c = cardOf(id);
              attackers.push({ id, name: nameOf(id), power: c?.power ?? null, toughness: c?.toughness ?? null });
            }
            if (b.defender) {
              if (b.defender.kind === 'player') defender = s.players.find((p) => p.id === b.defender!.id)?.name ?? 'a player';
              else defender = nameOf(b.defender.id) ?? 'a permanent';
            }
          }
          openAttack = { frameIndex: fi, playerId: e.player, attackers, defender, blocks: new Map() };
          if (attackers.length > 0) t.attacks.push(openAttack);
          break;
        }
        case 'blockers':
          if (openAttack) {
            for (const b of e.blocks) {
              // The bridge reports an unblocked attacker as blocked by itself; drop those.
              const ids = b.blockerIds.filter((id) => id !== b.attackerId);
              if (ids.length) openAttack.blocks.set(b.attackerId, ids.map(nameOf));
            }
          }
          break;
        case 'life':
          t.life.push({ playerId: e.player, from: e.from, to: e.to });
          break;
        default:
          break;
      }
    }
    prevIdx = postIdx;
  });
  const h = { turns, stateFrames };
  historyCache.set(log, h);
  return h;
}

// ---------------------------------------------------------------------------
// Summary

/** "You" for the viewing seat, the player's name otherwise. */
export function playerLabel(log: GameLog, id: number | null): string {
  if (id === null) return 'nobody';
  if (id === log.seat) return 'You';
  const p = log.hello?.players.find((x) => x.id === id);
  return p?.name ?? `Player ${id}`;
}

function listNames(names: (string | null)[], unknown = 'a hidden card'): string {
  const counts = new Map<string, number>();
  for (const n of names) {
    const k = n ?? unknown;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  // Semicolons, because card names contain commas ("Quake, Agent of S.H.I.E.L.D.").
  return [...counts].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join('; ');
}

function lastState(log: GameLog): GameStateBody | null {
  for (let i = log.frames.length - 1; i >= 0; i--) {
    const s = stateAt(log, i);
    if (s) return s;
  }
  return null;
}

/** Compact turn-by-turn summary of the whole game. */
export function summarizeGame(log: GameLog): string {
  const h = gameHistory(log);
  const last = lastState(log);
  const lines: string[] = [];
  const you = log.hello?.players.find((p) => p.id === log.seat);
  const opp = log.hello?.players.filter((p) => p.id !== log.seat) ?? [];
  lines.push(`Players: You = ${you?.name ?? `seat ${log.seat}`}; opponent = ${opp.map((p) => p.name).join(', ') || 'unknown'}.`);
  const deck = log.header.decks?.find((d) => d.player === log.seat);
  if (deck?.path) lines.push(`Your deck file: ${deck.path}.`);

  for (const t of h.turns) {
    const bits: string[] = [];
    if (t.mulligans.length) bits.push(`mulligans: ${listNames(t.mulligans.map((p) => playerLabel(log, p)))}`);
    if (t.turn === 0 && bits.length === 0) continue;
    if (t.turn > 0 && t.activePlayer !== null && !t.lands.some((l) => l.playerId === t.activePlayer)) bits.push('no land played');
    for (const l of t.lands) {
      bits.push(`${l.playerId === t.activePlayer ? '' : playerLabel(log, l.playerId) + ' '}land ${l.name ?? 'a land'}`);
    }
    const spells = t.casts.filter((c) => c.spell);
    const byPlayer = new Map<number, (string | null)[]>();
    for (const c of spells) byPlayer.set(c.playerId, [...(byPlayer.get(c.playerId) ?? []), c.name]);
    for (const [pid, names] of byPlayer) {
      bits.push(`${pid === t.activePlayer ? 'cast' : `${playerLabel(log, pid)} cast`} ${listNames(names)}`);
    }
    for (const a of t.attacks) {
      const parts = a.attackers.map((x) => {
        const pt = x.power != null ? ` ${x.power}/${x.toughness}` : '';
        const bl = a.blocks.get(x.id);
        return `${x.name ?? 'a hidden creature'}${pt}${bl ? ` (blocked by ${listNames(bl)})` : ''}`;
      });
      const unblocked = a.attackers.filter((x) => !a.blocks.has(x.id)).length;
      bits.push(
        `attacked ${a.defender === (you?.name ?? '') ? 'you' : a.defender} with ${parts.join('; ')}` +
          (a.blocks.size === 0 ? ' — no blocks' : unblocked ? ` — ${unblocked} unblocked` : ''),
      );
    }
    const made = new Map<number | null, (string | null)[]>();
    for (const c of t.created) made.set(c.playerId, [...(made.get(c.playerId) ?? []), c.name]);
    for (const [pid, names] of made) bits.push(`${playerLabel(log, pid) === 'You' ? 'your' : playerLabel(log, pid) + "'s"} tokens: ${listNames(names, 'a token')}`);
    const lifeBy = new Map<number, { from: number; to: number }>();
    for (const l of t.life) {
      const prev = lifeBy.get(l.playerId);
      lifeBy.set(l.playerId, { from: prev ? prev.from : l.from, to: l.to });
    }
    for (const [pid, l] of lifeBy) if (l.from !== l.to) bits.push(`${playerLabel(log, pid)} life ${l.from}→${l.to}`);
    const died = t.left.filter((l) => l.creature && l.to === 'graveyard' && !l.token);
    const tokensDied = t.left.filter((l) => l.creature && l.token && (l.to === 'graveyard' || l.to === null));
    const exiled = t.left.filter((l) => l.to === 'exile');
    const bounced = t.left.filter((l) => l.to === 'hand' || l.to === 'library');
    const otherGy = t.left.filter((l) => !l.creature && l.to === 'graveyard');
    const own = (l: LeftRecord) => `${l.name ?? 'a card'}${l.playerId !== null ? ` (${playerLabel(log, l.playerId) === 'You' ? 'yours' : playerLabel(log, l.playerId) + "'s"})` : ''}${l.sacrificed ? ' [sacrificed]' : ''}`;
    if (died.length) bits.push(`died: ${died.map(own).join('; ')}`);
    if (tokensDied.length) bits.push(`tokens died: ${tokensDied.map(own).join('; ')}`);
    if (exiled.length) bits.push(`exiled: ${exiled.map(own).join('; ')}`);
    if (bounced.length) bits.push(`returned from play: ${bounced.map(own).join('; ')}`);
    if (otherGy.length) bits.push(`to graveyard from play: ${otherGy.map(own).join('; ')}`);
    const head = t.turn === 0 ? 'Pre-game' : `T${t.turn} (R${Math.ceil(t.turn / 2)}) ${playerLabel(log, t.activePlayer)}`;
    lines.push(`${head}: ${bits.length ? bits.join(' | ') : 'nothing of note'}`);
  }

  if (last) {
    const life = last.players.map((p) => `${playerLabel(log, p.id)} ${p.life}`).join(', ');
    lines.push(`Final life: ${life}.`);
    for (const p of last.players) {
      const bf = p.zones.battlefield.cards
        .filter((c) => !isHidden(c) && !/\bLand\b/.test((c as Card).types))
        .map((c) => visibleName(c) ?? 'a face-down card');
      const lands = p.zones.battlefield.cards.filter((c) => !isHidden(c) && /\bLand\b/.test((c as Card).types)).length;
      lines.push(`Final board, ${playerLabel(log, p.id)}: ${lands} lands${bf.length ? '; ' + listNames(bf) : ''}.`);
    }
    const mine = last.players.find((p) => p.id === log.seat);
    if (mine) {
      const hand = mine.zones.hand.cards.map(visibleName);
      lines.push(`Your hand at the end: ${hand.length ? listNames(hand) : 'empty'}.`);
    }
  }
  if (log.over) {
    const w = log.over.winner === null ? 'Draw' : `${playerLabel(log, log.over.winner) === 'You' ? 'You won' : `${playerLabel(log, log.over.winner)} won`}`;
    lines.push(`Result: ${w}${log.over.reason ? ` (${log.over.reason})` : ''}${last ? ` on turn ${last.turn}` : ''}.`);
  } else {
    lines.push('Result: the log ends before the game is over.');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Review prompt

/** Cards that mattered: every spell cast, nonbasic land played, creature that fought or left play, and your last hand. */
export function reviewCardNames(log: GameLog): string[] {
  const h = gameHistory(log);
  const out = new Set<string>();
  const add = (n: string | null) => {
    if (n && !isBasicLandName(n)) out.add(n);
  };
  const tokens = new Set<string>();
  for (const fi of h.stateFrames) {
    const s = stateAt(log, fi)!;
    for (const p of s.players) for (const c of p.zones.battlefield.cards) if (!isHidden(c) && (c as Card).token) tokens.add((c as Card).name);
  }
  for (const t of h.turns) {
    for (const c of t.casts) if (c.spell) add(c.name);
    for (const l of t.lands) add(l.name);
    for (const a of t.attacks) {
      for (const x of a.attackers) add(x.name);
      for (const bl of a.blocks.values()) bl.forEach(add);
    }
    for (const l of t.left) add(l.name);
  }
  const last = lastState(log);
  if (last) {
    for (const p of last.players) for (const c of p.zones.battlefield.cards) add(visibleName(c));
    const mine = last.players.find((p) => p.id === log.seat);
    for (const c of mine?.zones.hand.cards ?? []) add(visibleName(c));
  }
  for (const t of tokens) out.delete(t);
  return [...out];
}

export const REVIEW_SYSTEM = `You are a Magic: The Gathering coach reviewing a finished game with a newer player (a few months of experience) who played against the Forge AI. The turn-by-turn summary is reconstructed from the engine's own event log, so it is exact; card text is the oracle text — use it rather than memory. The opponent's hidden cards are never named; do not guess them.

Write the review in this shape, short and concrete:
**Result:** one line on how the game was won or lost (the turning point).
**What went well:** one to three specific plays, each with the turn number.
**Mistakes:** at most three, most costly first. For each: the turn, what happened, the better play with the exact cards, and the general rule it breaks (e.g. "count lethal both ways before blocking", "fodder before payoffs", "hold the sacrifice outlet", "use your mana every turn", "don't chump while the loop matters"). Only call something a mistake if the summary supports it; if information is missing (hidden cards, the summary does not show a choice), say what you are assuming.
**One habit for next game:** a single sentence.

Rules details to get right: summoning sickness stops attacking and {T} abilities but not blocking, sacrificing or equipping; {T} abilities are once per untap while abilities without {T} repeat; "whenever you cast an instant or sorcery" ignores creatures, artifacts and enchantments; equip is sorcery-speed; triggered abilities work whether the source is tapped or not; revolt counts any permanent of yours leaving play (fetchlands, sacrificed creatures, tokens).`;

export function buildReviewPrompt(log: GameLog, cards: Map<string, CardInfo>, opts?: { guide?: string; cube?: CubeCoachInput }): Prompt {
  const names = reviewCardNames(log);
  const seen = new Map<string, Card>();
  for (const fi of gameHistory(log).stateFrames) {
    const s = stateAt(log, fi)!;
    for (const p of s.players)
      for (const z of Object.values(p.zones))
        for (const c of (z as { cards: AnyCard[] }).cards) {
          const n = visibleName(c);
          if (n && !seen.has(n) && !(c as Card).faceDown) seen.set(n, c as Card);
        }
  }
  const parts: string[] = [];
  parts.push('# Game summary', summarizeGame(log));
  parts.push('', '# Card text', names.length ? formatCardTexts(names, cards, seen) : '(none)');
  const cubeSection = buildCubeContext(log, opts?.cube);
  if (cubeSection) parts.push('', cubeSection);
  if (opts?.guide && opts.guide.trim()) parts.push('', '# My deck play guide', opts.guide.trim());
  parts.push('', '# Question', 'Review this game for me: what went well, and the (at most three) mistakes that cost the most, each tied to a general rule.');
  return { system: REVIEW_SYSTEM, user: parts.join('\n') };
}
