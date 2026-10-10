/*
 * ForgeCoach — livePlan/history.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * "GAME SO FAR": the redacted event log since the game began as compact text,
 * and the CARD TEXT block. Ported from mtg-table tools/llm-seat
 * (lib/history.mjs, D419). Built from s2c frames only, so it holds exactly
 * what the seat was shown (§8.3): an id the frame does not resolve is "a
 * hidden card", never a guess. A card the seat once saw keeps the name it was
 * shown (an id is stable for the game, §3.2) — information the seat had, not
 * an inference.
 */
import type { GameEvent, GameStateBody } from '../protocol.ts';
import type { LoggedFrame } from '../log.ts';
import { cardsById, nameOf, type LooseCard } from './board.ts';
import type { Oracle } from './oracle.ts';

interface Item {
  turn: number;
  who: string;
  text: string | null;
  turnStart?: true;
}

export class History {
  me: number | null;
  readonly items: Item[] = [];
  private readonly names = new Map<number, string>();
  private turn = 0;
  private turnPlayer: number | null = null;
  private resolvedNow = new Set<number>();

  constructor(me: number | null = null) {
    this.me = me;
  }

  private who(player: number | null | undefined): string {
    if (player === null || player === undefined) return 'someone';
    return player === this.me ? 'you' : 'opp';
  }

  private name(id: number, frameCards: Map<number, LooseCard>): string {
    const c = frameCards.get(id);
    const n = nameOf(c);
    if (n) return `${n} [${id}]`;
    if (this.names.has(id)) return `${this.names.get(id)} [${id}]`;
    if (c?.faceDown) return `a face-down card [${id}]`;
    return `a hidden card [${id}]`;
  }

  private add(text: string): void {
    this.items.push({ turn: this.turn, who: this.who(this.turnPlayer), text });
  }

  /** Feed one frame (only s2c is read). */
  push(frame: LoggedFrame): void {
    if (!frame || frame.dir === 'c2s') return;
    const body = (frame.body ?? {}) as Record<string, unknown>;
    if (frame.type === 'hello_ok' && typeof body.you === 'number') this.me = body.you;
    if (frame.type === 'state') this.onState(frame.body as GameStateBody);
  }

  private onState(s: GameStateBody): void {
    const cards = cardsById(s);
    for (const [id, c] of cards) {
      const n = nameOf(c);
      if (n) this.names.set(id, n);
    }
    this.resolvedNow = new Set((s.events ?? []).filter((e) => e.kind === 'resolved').map((e) => (e as { cardId: number }).cardId));
    for (const e of s.events ?? []) this.onEvent(e, cards);
  }

  private onEvent(e: GameEvent, cards: Map<number, LooseCard>): void {
    const nm = (id: number) => this.name(id, cards);
    const ev = e as GameEvent & Record<string, unknown>;
    switch (e.kind) {
      case 'turn':
        this.turn = e.turn;
        this.turnPlayer = e.player;
        this.items.push({ turn: e.turn, who: this.who(e.player), text: null, turnStart: true });
        break;
      case 'mulligan':
        this.add(`${this.who(e.player)} mulligan`);
        break;
      case 'land':
        this.add(`${this.who(e.player)} land ${nm(e.cardId)}`);
        break;
      case 'cast':
        this.add(`${this.who(e.controller)} cast ${nm(e.cardId)}`);
        break;
      case 'resolved':
        if (e.fizzled) this.add(`${nm(e.cardId)} fizzled`);
        break;
      case 'unstacked':
        if (!this.resolvedNow.has(e.cardId)) this.add(`${nm(e.cardId)} left the stack without resolving (countered?)`);
        break;
      case 'attackers': {
        const ids = (e.bands ?? []).flatMap((b) => b.attackerIds ?? []);
        if (ids.length) this.add(`${this.who(e.player)} attack: ${ids.map(nm).join(', ')}`);
        break;
      }
      case 'blockers': {
        const parts: string[] = [];
        for (const b of e.blocks ?? []) {
          const bl = (b.blockerIds ?? []).filter((x) => x !== b.attackerId);
          if (bl.length) parts.push(`${bl.map(nm).join(' + ')} blocks ${nm(b.attackerId)}`);
        }
        this.add(parts.length ? `${this.who(e.defendingPlayer)} block: ${parts.join('; ')}` : `${this.who(e.defendingPlayer)} no blocks`);
        break;
      }
      case 'life':
        this.add(`${this.who(e.player)} life ${e.from}->${e.to}`);
        break;
      case 'poison':
        this.add(`${this.who(e.player)} poison ${ev.from as number}->${(ev.from as number) + (ev.amount as number)}`);
        break;
      case 'zone': {
        const from = e.from?.zone;
        const to = e.to?.zone;
        if (from === 'battlefield' && to === 'graveyard') this.add(`${nm(e.cardId)} died / to graveyard`);
        else if (from === 'battlefield' && to === 'exile') this.add(`${nm(e.cardId)} exiled`);
        else if (from === 'battlefield' && (to === 'hand' || to === 'library')) this.add(`${nm(e.cardId)} returned to ${to}`);
        else if (from === 'hand' && to === 'graveyard') this.add(`${this.who(e.from!.player)} discard ${nm(e.cardId)}`);
        else if (from === 'library' && to === 'graveyard') this.add(`${this.who(e.from!.player)} milled ${nm(e.cardId)}`);
        else if (from === 'graveyard' && to === 'battlefield') this.add(`${nm(e.cardId)} returned from graveyard to battlefield`);
        break;
      }
      case 'outcome':
        this.add(e.winner === null ? 'game drawn' : `${this.who(e.winner)} won`);
        break;
      default:
        break;
    }
  }

  /** The event log as text, grouped by turn. */
  logText(): string {
    const lines: string[] = [];
    let cur: string | null = null;
    for (const it of this.items) {
      const head = it.turn > 0 ? `T${it.turn} (${it.who}):` : 'Before turn 1:';
      if (it.turnStart) {
        cur = head;
        lines.push(cur);
        continue;
      }
      if (cur === null || lines.length === 0) {
        cur = head;
        lines.push(cur);
      }
      lines[lines.length - 1] += ` ${it.text};`;
    }
    return lines.filter((l) => !/:$/.test(l) || l === lines[lines.length - 1]).join('\n') || '(nothing yet)';
  }
}

/** The history of `frames` (a log up to the moment). */
export function historyOf(frames: readonly LoggedFrame[], me: number): History {
  const h = new History(me);
  for (const f of frames) h.push(f);
  h.me = me;
  return h;
}

/** Names of every card the seat can see now, for the CARD TEXT block. */
export function visibleNames(state: GameStateBody | null | undefined): string[] {
  const names = new Set<string>();
  for (const c of cardsById(state).values()) {
    const n = nameOf(c);
    if (n) names.add(n);
  }
  return [...names].sort();
}

const BASICS = new Set(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes']);

export function cardTextBlock(names: readonly string[], oracle: Oracle): string {
  const list = names.filter((n) => !BASICS.has(n) && !n.startsWith('Snow-Covered '));
  const lines: string[] = [];
  for (const n of list) {
    const t = oracle.text(n);
    // a token or an effect has no oracle card: its type line and P/T are in the state
    if (t === null && (/ Token$/.test(n) || /'s Effect$/.test(n))) continue;
    lines.push(`${n}: ${t === null ? '(no oracle text available)' : t.replace(/\n/g, ' / ')}`);
  }
  return lines.length ? lines.join('\n') : '(none new)';
}
