/*
 * ForgeCoach — eventLog.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The readable game log: the §3.6 events of every state frame as plain lines
 * ("Forge AI cast Lightning Bolt → Grizzly Bears", "Grizzly Bears died",
 * "You: life 20 → 17"), grouped under turn headers, oldest first. A cast reads
 * its targets off the SAME frame's stack item (matched by `stackId`), named
 * through the frame resolver; an item that already resolved has no arrow.
 * Triggered abilities are their own kind so the drawer can fold them.
 *
 * Names come from review.ts's per-frame resolver, the same rule the post-game
 * summary uses: an id is named only from the snapshot its event arrived with or
 * the one before, so a card that went back into a hidden zone is never named.
 * The choice of which events are worth a line follows mtg-table's
 * render/describe.ts (GPL-3.0-or-later, the mtg-table authors), in words
 * instead of ids.
 *
 * Built incrementally: a live game's GameLog is append-only, so the walk keeps
 * its place per session header and only reads the new frames.
 */
import type { Card, EntityRef, GameStateBody, StackItem } from './protocol.ts';
import type { GameLog } from './log.ts';
import { stackKind } from './ui/stackModel.ts';
import { frameResolver, indexOf, playerLabel, type CardIndex, type FrameResolver } from './review.ts';

/** One piece of a line: text, a card (tappable to read it), or a player. */
export type LogSeg = string | { card: Card | null; name: string; id: number } | { player: number; name: string };

export type LogKind =
  | 'land'
  | 'cast'
  | 'ability'
  | 'trigger'
  | 'activated'
  | 'attack'
  | 'block'
  | 'damage'
  | 'life'
  | 'died'
  | 'left'
  | 'token'
  | 'counter'
  | 'attach'
  | 'info'
  | 'outcome';

export interface LogLine {
  frameIndex: number;
  kind: LogKind;
  /** The player the line is about (colours the line), or null. */
  who: number | null;
  /** The step the event happened in (the Forge `PhaseType` name), or null before the first turn. */
  phase: string | null;
  segs: LogSeg[];
}

export interface LogTurn {
  /** Player-turn number; 0 for the pre-game. */
  turn: number;
  activePlayer: number | null;
  /** First state frame of the turn. */
  frameIndex: number;
  lines: LogLine[];
}

/** The plain text of a line, for tests and copy. */
export function lineText(line: LogLine): string {
  return line.segs.map((s) => (typeof s === 'string' ? s : s.name)).join('');
}

interface Walk {
  frames: GameLog['frames'];
  done: number;
  prevIdx: CardIndex;
  turns: LogTurn[];
  pendingToStack: Set<number>;
  /** Cards whose leaving play a `sacrificed` event already wrote (or will rewrite). */
  sacrificed: Set<number>;
  /** The step the walk is in: the last state's phase, moved on by `phase` events. */
  phase: string | null;
}

const walks = new WeakMap<object, Walk>();

const ABILITY_TEXT_MAX = 110;

/** Forge's stack text without the ids it embeds ("(47) - Attach to Soldier Token (91)"). */
export function abilityText(text: string, name: string | null): string {
  let t = text.replace(/\[\[|\]\]/g, '').replace(/\s*\(\d+\)/g, '');
  if (name && t.startsWith(name)) t = t.slice(name.length);
  t = t.replace(/^\s*[-—:]\s*/, '').replace(/\s*\(Targeting:\s*\)/, '');
  return t;
}

function shorten(s: string, max: number): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max - 1).trimEnd() + '…' : one;
}

/**
 * The turn-by-turn log up to and including `upTo` (a frame index; default:
 * the whole log). Turns with no lines are kept so the headers still read in
 * order; the pre-game is dropped when nothing happened in it.
 */
export function gameEventLog(log: GameLog, upTo = Infinity): LogTurn[] {
  const key = log.header as object;
  let w = walks.get(key);
  // A different (or reset) frame list: start again.
  if (!w || w.done > log.frames.length || (w.done > 0 && w.frames[w.done - 1] !== log.frames[w.done - 1])) {
    w = { frames: log.frames, done: 0, prevIdx: new Map(), turns: [], pendingToStack: new Set(), sacrificed: new Set(), phase: null };
    walks.set(key, w);
  }
  w.frames = log.frames;
  for (; w.done < log.frames.length; w.done++) {
    const f = log.frames[w.done]!;
    if (f.type !== 'state') continue;
    const s = f.body as GameStateBody;
    const postIdx = indexOf(s);
    foldFrame(w, log, w.done, s, frameResolver(w.prevIdx, postIdx));
    w.prevIdx = postIdx;
  }
  const out: LogTurn[] = [];
  for (const t of w.turns) {
    if (t.frameIndex > upTo) break;
    const lines = upTo === Infinity ? t.lines : t.lines.filter((l) => l.frameIndex <= upTo);
    if (t.turn === 0 && lines.length === 0) continue;
    out.push(lines === t.lines ? { ...t, lines: t.lines.slice() } : { ...t, lines });
  }
  return out;
}

/** What a `cast` event is: a spell, a trigger, an activated ability, or an ability we cannot tell more about. */
function castKind(e: { cardId: number; controller: number; stackId: number; text: string }, item: StackItem | undefined, pending: boolean, s: GameStateBody): 'cast' | 'trigger' | 'activated' | 'ability' {
  const flagged = !!item && (item.isAbility === true || !!item.isOptionalTrigger);
  // The card went to the stack from somewhere this frame (or the one before): a spell.
  if (pending && !flagged) return 'cast';
  // Read the engine's own flags and the source's zone, else Forge's trigger wording.
  const real: StackItem = item ?? { id: e.stackId, sourceCardId: e.cardId, controller: e.controller, text: e.text, targetCardIds: [], targetPlayerIds: [], isAbility: true };
  const k = stackKind({ ...real, text: real.text || e.text }, s.stackCards?.find((c) => c.id === real.sourceCardId));
  return k === 'spell' ? 'cast' : k === 'triggered' ? 'trigger' : k === 'activated' ? 'activated' : 'ability';
}

function foldFrame(w: Walk, log: GameLog, fi: number, s: GameStateBody, r: FrameResolver): void {
  const ensure = (turn: number, active: number | null): LogTurn => {
    const cur = w.turns[w.turns.length - 1];
    if (cur && cur.turn === turn) return cur;
    const t: LogTurn = { turn, activePlayer: active, frameIndex: fi, lines: [] };
    w.turns.push(t);
    return t;
  };
  if (w.turns.length === 0) ensure(s.turn || 0, s.activePlayer);
  const player = (id: number | null): LogSeg => (id === null ? 'Someone' : { player: id, name: playerLabel(log, id) });
  const card = (id: number, fallback = 'a hidden card'): LogSeg => {
    const name = r.nameOf(id);
    return name ? { card: r.cardOf(id), name, id } : fallback;
  };
  const entity = (ref: EntityRef | null): LogSeg => (ref === null ? 'someone' : ref.kind === 'player' ? player(ref.id) : card(ref.id, 'a permanent'));
  const controllerOf = (id: number): number | null => r.cardOf(id)?.controller ?? null;
  const landIds = new Set<number>();
  for (const e of s.events ?? []) if (e.kind === 'land') landIds.add(e.cardId);

  for (const e of s.events ?? []) {
    const t = w.turns[w.turns.length - 1]!;
    const add = (kind: LogKind, who: number | null, ...segs: LogSeg[]) => t.lines.push({ frameIndex: fi, kind, who, phase: w.phase ?? s.phase, segs });
    switch (e.kind) {
      case 'turn':
        ensure(e.turn, e.player);
        w.pendingToStack.clear();
        w.phase = null;
        break;
      case 'phase':
        w.phase = e.phase;
        break;
      case 'mulligan':
        add('info', e.player, player(e.player), ' took a mulligan');
        break;
      case 'land':
        add('land', e.player, player(e.player), ' played ', card(e.cardId, 'a land'));
        break;
      case 'cast': {
        const pending = w.pendingToStack.has(e.cardId);
        w.pendingToStack.delete(e.cardId);
        // The stack item this cast put up, if it is still there on this frame.
        const item = s.stack?.find((x) => x.id === e.stackId);
        const kind = castKind(e, item, pending, s);
        const targets: LogSeg[] = [];
        if (item) {
          for (const id of item.targetCardIds) targets.push(card(id));
          for (const id of item.targetPlayerIds) targets.push(player(id));
        }
        const arrow: LogSeg[] = [];
        targets.forEach((tg, i) => arrow.push(i === 0 ? ' → ' : ', ', tg));
        if (kind === 'cast') {
          add('cast', e.controller, player(e.controller), ' cast ', card(e.cardId, 'a spell'), ...arrow);
        } else {
          const name = r.nameOf(e.cardId);
          // The stack text usually starts "Name - "; the name is already a segment.
          // With the targets listed, the engine's "(Targeting: …)" tail would say them twice.
          const raw = targets.length ? e.text.replace(/\s*\(Targeting:.*\)\s*$/s, '') : e.text;
          const text = raw === '' ? '' : shorten(abilityText(raw, name), ABILITY_TEXT_MAX);
          const verb = kind === 'trigger' ? ' triggered' : kind === 'activated' ? ' activated' : ' ability';
          add(kind, e.controller, card(e.cardId, 'a hidden source'), text ? `${verb}: ${text}` : verb, ...arrow);
        }
        break;
      }
      case 'resolved':
        if (e.fizzled) add('info', controllerOf(e.cardId), card(e.cardId, 'a spell'), ' fizzled');
        break;
      case 'attackers': {
        for (const b of e.bands) {
          if (b.attackerIds.length === 0) continue;
          const segs: LogSeg[] = [player(e.player), ' attacked ', entity(b.defender), ' with '];
          b.attackerIds.forEach((id, i) => {
            if (i > 0) segs.push(i === b.attackerIds.length - 1 ? ' and ' : ', ');
            segs.push(card(id, 'a creature'));
          });
          add('attack', e.player, ...segs);
        }
        break;
      }
      case 'blockers': {
        let any = false;
        for (const b of e.blocks) {
          // An unblocked attacker is `blockerIds: []` (M52) or, before M52, blocked by itself.
          const by = b.blockerIds.filter((id) => id !== b.attackerId);
          if (by.length === 0) continue;
          any = true;
          const segs: LogSeg[] = [];
          by.forEach((id, i) => {
            if (i > 0) segs.push(i === by.length - 1 ? ' and ' : ', ');
            segs.push(card(id, 'a creature'));
          });
          segs.push(' blocked ', card(b.attackerId, 'an attacker'));
          add('block', e.defendingPlayer, ...segs);
        }
        if (!any && e.blocks.length > 0) add('block', e.defendingPlayer, player(e.defendingPlayer), ' did not block');
        break;
      }
      case 'damage':
        add('damage', controllerOf(e.sourceCardId), card(e.sourceCardId, 'a source'), ` dealt ${e.amount} ${e.combat ? 'combat ' : ''}damage to `, entity(e.target));
        break;
      case 'life':
        if (e.from !== e.to) add('life', e.player, player(e.player), `: life ${e.from} → ${e.to}`);
        break;
      case 'poison':
        add('life', e.player, player(e.player), ` got ${e.amount} poison counter${e.amount === 1 ? '' : 's'} (${e.from + e.amount} total)`);
        break;
      case 'zone': {
        const from = e.from?.zone ?? null;
        const to = e.to?.zone ?? null;
        if (to === 'stack' && from && from !== 'stack') {
          w.pendingToStack.add(e.cardId);
          break;
        }
        if (from === null && to === 'battlefield') {
          add('token', e.to!.player, player(e.to!.player), ' created ', card(e.cardId, 'a token'));
          break;
        }
        if (from === 'battlefield' && to !== 'battlefield') {
          if (w.sacrificed.has(e.cardId)) {
            w.sacrificed.delete(e.cardId);
            break;
          }
          const c = r.cardOf(e.cardId);
          const who = c?.controller ?? e.from!.player ?? null;
          const creature = !!c && /\bCreature\b/.test(c.types);
          if (to === 'graveyard' || to === null) add(creature ? 'died' : 'left', who, card(e.cardId, 'a permanent'), creature ? ' died' : to === null ? ' left play' : ' was put into the graveyard');
          else if (to === 'exile') add('left', who, card(e.cardId, 'a permanent'), ' was exiled');
          else if (to === 'hand') add('left', who, card(e.cardId, 'a permanent'), ' returned to its owner’s hand');
          else if (to === 'library') add('left', who, card(e.cardId, 'a permanent'), ' was put into its owner’s library');
          break;
        }
        if (to === 'battlefield' && from !== 'stack' && !landIds.has(e.cardId)) {
          const name = r.nameOf(e.cardId);
          if (name) add('token', e.to!.player, card(e.cardId), ` entered the battlefield${from === 'graveyard' ? ' from the graveyard' : from === 'exile' ? ' from exile' : ''}`);
          break;
        }
        if (from === 'hand' && to === 'graveyard') {
          add('left', e.from!.player, player(e.from!.player), ' discarded ', card(e.cardId, 'a card'));
          break;
        }
        if (from === 'library' && to === 'graveyard') {
          const name = r.nameOf(e.cardId);
          if (name) add('left', e.from!.player, card(e.cardId), ' was put into the graveyard from the library');
          break;
        }
        if (from === 'graveyard' && to === 'hand') {
          const name = r.nameOf(e.cardId);
          if (name) add('info', e.to!.player, player(e.to!.player), ' returned ', card(e.cardId), ' to hand');
          break;
        }
        if (to === 'exile' && (from === 'graveyard' || from === 'hand')) {
          const name = r.nameOf(e.cardId);
          if (name) add('left', e.from!.player, card(e.cardId), ` was exiled from ${from === 'hand' ? 'a hand' : 'the graveyard'}`);
        }
        break;
      }
      case 'sacrificed': {
        // The zone event may already have written "died"; rewrite it.
        const prior = [...t.lines].reverse().find((l) => l.frameIndex === fi && (l.kind === 'died' || l.kind === 'left') && l.segs.some((sg) => typeof sg !== 'string' && 'id' in sg && sg.id === e.cardId));
        const who = controllerOf(e.cardId);
        if (prior) {
          prior.kind = 'died';
          prior.segs = [player(prior.who ?? who), ' sacrificed ', card(e.cardId, 'a permanent')];
        } else {
          w.sacrificed.add(e.cardId);
          add('died', who, player(who), ' sacrificed ', card(e.cardId, 'a permanent'));
        }
        break;
      }
      case 'counters': {
        const d = e.to - e.from;
        if (d === 0) break;
        const n = Math.abs(d);
        add('counter', controllerOf(e.cardId), card(e.cardId, 'a permanent'), ` ${d > 0 ? 'got' : 'lost'} ${n === 1 ? 'a' : n} ${e.counter} counter${n === 1 ? '' : 's'} (now ${e.to})`);
        break;
      }
      case 'attach':
        if (e.to === null) add('attach', controllerOf(e.cardId), card(e.cardId, 'a permanent'), ' became unattached');
        else add('attach', controllerOf(e.cardId), card(e.cardId, 'a permanent'), ' was attached to ', entity(e.to));
        break;
      case 'scry':
        add('info', e.player, player(e.player), ` scried ${e.toTop + e.toBottom} (${e.toTop} on top, ${e.toBottom} on the bottom)`);
        break;
      case 'surveil':
        add('info', e.player, player(e.player), ` surveilled ${e.toLibrary + e.toGraveyard} (${e.toLibrary} back, ${e.toGraveyard} to the graveyard)`);
        break;
      case 'phased':
        add('info', controllerOf(e.cardId), card(e.cardId, 'a permanent'), ` phased ${e.phasedOut ? 'out' : 'in'}`);
        break;
      case 'foretold':
        add('info', e.player, player(e.player), ' foretold a card');
        break;
      case 'outcome':
        if (e.winner === null) add('outcome', null, 'The game is a draw');
        else add('outcome', e.winner, player(e.winner), ' won the game');
        break;
      default:
        // tap, stats, phase, shuffle, combat_end, unstacked: not worth a line.
        break;
    }
  }
  w.sacrificed.clear();
  w.phase = s.phase;
}

/** The part of a turn a step belongs to, as the log's subheads name it. */
export function phaseSection(phase: string | null): string {
  if (!phase) return 'Before the game';
  if (phase === 'UNTAP' || phase === 'UPKEEP' || phase === 'DRAW') return 'Beginning';
  if (phase === 'MAIN1') return 'Main phase';
  if (phase.startsWith('COMBAT')) return 'Combat';
  if (phase === 'MAIN2') return 'Second main';
  return 'End step';
}

/** A turn's lines cut into runs by section ("Main phase", "Combat"…), in order. `start` is the index of the run's first line in `lines`. */
export function sectionsOf(lines: readonly LogLine[]): { section: string; start: number; lines: LogLine[] }[] {
  const out: { section: string; start: number; lines: LogLine[] }[] = [];
  lines.forEach((l, i) => {
    const section = phaseSection(l.phase);
    const cur = out[out.length - 1];
    if (cur && cur.section === section) cur.lines.push(l);
    else out.push({ section, start: i, lines: [l] });
  });
  return out;
}

/** One row of a section: a plain line, or a run of consecutive triggers the drawer folds. */
export type LogItem = { type: 'line'; line: LogLine; /** Its index in its turn's lines. */ index: number } | { type: 'fold'; /** Stable while the log grows: the run's first line's index in its turn. */ key: number; lines: LogLine[] };

/** A section's lines with each run of consecutive `trigger` lines gathered into one fold. `start` is the section's `start`. */
export function foldTriggers(lines: readonly LogLine[], start = 0): LogItem[] {
  const out: LogItem[] = [];
  lines.forEach((line, i) => {
    if (line.kind !== 'trigger') {
      out.push({ type: 'line', line, index: start + i });
      return;
    }
    const cur = out[out.length - 1];
    if (cur && cur.type === 'fold') cur.lines.push(line);
    else out.push({ type: 'fold', key: start + i, lines: [line] });
  });
  return out;
}

/** The folded header's words: "Goblin Guide triggered" for one, "3 triggers: A, B and 1 more" for a run. */
export function foldSummary(lines: readonly LogLine[]): LogSeg[] {
  const sources: LogSeg[] = [];
  for (const l of lines) {
    const first = l.segs[0];
    if (first && typeof first !== 'string' && !sources.some((x) => typeof x !== 'string' && 'id' in x && 'id' in first && x.id === first.id)) sources.push(first);
  }
  if (lines.length === 1) return [sources[0] ?? 'A hidden source', ' triggered'];
  const shown = sources.slice(0, 3);
  const segs: LogSeg[] = [`${lines.length} triggers`];
  shown.forEach((sg, i) => segs.push(i === 0 ? ': ' : ', ', sg));
  if (sources.length > shown.length) segs.push(` and ${sources.length - shown.length} more`);
  return segs;
}
