#!/usr/bin/env node
/*
 * ForgeCoach — e2e/fake-engine.mjs
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A fake mtg-table bridge for the end-to-end tests: the seat socket (`/ws`),
 * the read-only observer socket (`/observe`, amendment M50) and `GET /health`,
 * speaking mtg-table's wire protocol (docs/protocol.md there; the types are
 * src/protocol.ts here) over a dependency-free WebSocket (wsserver.mjs).
 *
 * Behind it is a tiny deterministic rules model, enough for a short game of
 * Mountains, Raging Goblin, Memnite, Goblin Guide, Shock and Hill Giant: the opening
 * keep/mulligan prompt and the London mulligan's bottom pick, lands, mana
 * payment ("Auto"), the stack and priority passes, declare attackers (with
 * Alpha Strike / Call Back), the AI's attack and your blocks, a Shock whose
 * target is a `choose_entities` ask, combat damage, the result (`over`) and
 * the next game (`newGame`, M38: a new gameId and a fresh seq series). The
 * prompts, button labels and card shapes are copied from recorded Forge games
 * (public/samples), so the app's own parsing of them is what is exercised.
 * The opponent ("Forge AI") starts on 3 life so a game is three turns.
 *
 * Connection rules it keeps, as the real bridge does:
 *   - nothing is expected from the client first; a connect is sent hello_ok
 *     and the last state verbatim (same seq and t, M10), the current input
 *     re-emitted (only once one was pushed this game, M42), and any open ask
 *     verbatim (§2.1, §2.4); after `over` the catch-up ends with `over`;
 *   - a `resync` gets the same catch-up; `ping` gets `pong` with seq 0;
 *   - one seat (M13): a second /ws while one is open gets a seq-0 notice and
 *     close 4001;
 *   - an ask open when the seat drops is cancelled (M19): it takes its
 *     default (`dropMode: 'default'`, the bridge's behaviour), or — to test
 *     the other path of §2.4 — the engine asks again with a new askId once
 *     the seat is back (`dropMode: 'reask'`);
 *   - observers get the seat's cached hello_ok, state, over-or-latest input
 *     and open ask, then every later s2c frame; they are never answered.
 *
 * With `deathTrigger: true` the human starts with Blood Artist on the battlefield:
 * whenever a creature dies, Forge's InputSelectTargets asks "Select target
 * player" for its trigger with BOTH buttons off and no card listed (a mandatory
 * target: `updateButtons(false, false, false)`), and only a `clickPlayer` moves
 * the game on — the full-game playtest's J107 hang (Blood Artist, Falkenrath
 * Noble). Whatever input was due waits behind the trigger.
 *
 * With `playable: true` it also writes mtg-table M61's `state.playable` (the
 * seat's cards outside the battlefield a click would play, null off its
 * priority); without it, it is an engine from before M61. Scene `graveyard`
 * is `main3` with Cauldron Familiar in your graveyard.
 *
 * With `selection: true` it is an engine since mtg-table M64–M66 (D421–D423):
 * every `input` carries `selectable.playerIds` (the players a click is taken
 * for: the trigger's targets, the attack's defender, `[]` elsewhere, `null`
 * while paying) and `selectable.chosen` (the bottom pick, the declared
 * attackers and their defender, the declared blocks — which `state.combat`
 * then does not show until the declaration ends, as in Forge — and `null`
 * where no selection is up); `yieldTo {kind: "endStepOrOpponent"}` is taken
 * (`state.yield` shows it; refused with a `yieldTo` notice in the end step) and
 * the engine's Cancel stops it. Without it, the kind is refused as a bridge
 * before M64 does, and no input carries either key.
 *
 * Test hooks: `dropSeat()` (the TCP connection cut, the browser sees 1006),
 * `restart()` (a new process under the same game id: every socket cut, an
 * optional down time, then a fresh session whose seq series starts at 1),
 * `reset({scene})` (start from a scripted position), `seatAct(body)` (drive
 * the game as if from mtg-table's own board, for the live-watch test), and
 * the record of every frame a client sent (`received`) and every connection.
 *
 * Run it on its own to point a browser (or e2e/play.e2e.mjs) at it:
 *   node e2e/fake-engine.mjs [--port 8642] [--scene pregame|main3|graveyard] [--drop-mode default|reask] [--playable] [--death-trigger] [--selection]
 * with POST /control/drop, /control/restart[?scene=…], /control/reset[?scene=…]
 * and GET /control/log.
 */
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { acceptUpgrade, refuseUpgrade } from './wsserver.mjs';

const V = 1;
const HUMAN = 0;
const AI = 1;

// ---------------------------------------------------------------------------
// Cards

const DEFS = {
  Mountain: { setCode: 'M21', manaCost: null, types: 'Basic Land - Mountain', land: true },
  'Raging Goblin': { setCode: 'M10', manaCost: '{R}', types: 'Creature - Goblin Berserker', power: '1', toughness: '1', keywords: ['HASTE'], cost: 1 },
  'Goblin Guide': { setCode: 'ZEN', manaCost: '{R}', types: 'Creature - Goblin Scout', power: '2', toughness: '2', keywords: ['HASTE'], cost: 1 },
  Memnite: { setCode: 'SOM', manaCost: '{0}', types: 'Artifact Creature - Construct', power: '1', toughness: '1', keywords: [], cost: 0 },
  'Hill Giant': { setCode: 'M10', manaCost: '{3}{R}', types: 'Creature - Giant', power: '3', toughness: '3', keywords: [], cost: 4 },
  Shock: { setCode: 'M21', manaCost: '{R}', types: 'Instant', cost: 1, burn: 2 },
  // A death trigger with a mandatory player target (deathTrigger: true).
  'Blood Artist': { setCode: 'DKA', manaCost: '{1}{B}', types: 'Creature - Vampire', power: '0', toughness: '1', keywords: [], cost: 2, drain: true },
  // An activated ability from the graveyard that is no keyword (the full-game playtest's finding).
  // The fake model asks no Food for it.
  'Cauldron Familiar': {
    setCode: 'ELD', manaCost: '{B}', types: 'Creature - Cat', power: '1', toughness: '1', keywords: [], cost: 1,
    fromGraveyard: 'Sacrifice a Food: Return Cauldron Familiar from your graveyard to the battlefield.',
  },
};

const HAND = ['Mountain', 'Raging Goblin', 'Memnite', 'Shock', 'Mountain', 'Hill Giant', 'Mountain'];
const AI_LIBRARY = ['Mountain', 'Goblin Guide', 'Mountain', 'Hill Giant', 'Mountain', 'Hill Giant', 'Mountain', 'Mountain', 'Hill Giant', 'Mountain'];

const isCreature = (c) => /Creature/.test(DEFS[c.name].types);
const power = (c) => Number(DEFS[c.name].power ?? 0);
const toughness = (c) => Number(DEFS[c.name].toughness ?? 0);
const hasHaste = (c) => (DEFS[c.name].keywords ?? []).includes('HASTE');

function wire(c) {
  const d = DEFS[c.name];
  return {
    id: c.id,
    name: c.name,
    setCode: d.setCode,
    manaCost: d.manaCost,
    types: d.types,
    power: d.power ?? null,
    toughness: d.toughness ?? null,
    loyalty: null,
    keywords: d.keywords ?? [],
    damage: c.damage,
    counters: {},
    tapped: c.tapped,
    sick: c.sick,
    attacking: c.attacking,
    blocking: c.blocking,
    faceDown: false,
    token: false,
    alt: null,
    attachedToId: null,
    attachmentIds: [],
    controller: c.owner,
    owner: c.owner,
    zone: c.zone,
    abilities: [],
  };
}

const stub = (c) => ({ id: c.id, zone: c.zone, owner: c.owner, controller: c.owner, hidden: true });

const PHASE_TEXT = {
  UPKEEP: 'Upkeep step',
  DRAW: 'Draw step',
  MAIN1: 'Main phase, precombat',
  COMBAT_DECLARE_ATTACKERS: 'Declare Attackers Step',
  COMBAT_DECLARE_BLOCKERS: 'Declare Blockers Step',
  MAIN2: 'Main phase, postcombat',
  END_OF_TURN: 'End step',
};
const STOPS = { own: ['UPKEEP', 'MAIN1', 'COMBAT_DECLARE_BLOCKERS', 'MAIN2'], opp: ['COMBAT_DECLARE_ATTACKERS', 'COMBAT_DECLARE_BLOCKERS', 'END_OF_TURN'] };

const button = (label, enabled) => ({ label, enabled });
function inputBody(prompt, ok, cancel, extra = {}) {
  return {
    prompt,
    focusCardId: null,
    focusCard: null,
    buttons: { ok, cancel, focus: ok.enabled ? 'ok' : cancel.enabled && extra.focusCancel ? 'cancel' : null },
    selectable: extra.selectable ?? { cardIds: [], min: 0, max: 0, mode: 'none' },
    highlighted: extra.highlighted ?? [],
    weak: [],
    openZones: [],
  };
}

// ---------------------------------------------------------------------------
// One game: the rules model and its script. `out(type, body)` puts a frame on the wire.

class Game {
  constructor({ out, aiLife = 3, scene = 'pregame', playable = false, deathTrigger = false, selection = false }) {
    this.out = out;
    /** Amendments M64–M66: `selectable.playerIds` / `chosen` on every input, and the `endStepOrOpponent` yield. */
    this.selectionOn = selection;
    this.yieldState = null;
    /** Blood Artist on your battlefield: a creature dying asks for a target player with both buttons off. */
    this.deathTrigger = deathTrigger;
    this.triggers = [];
    this.parked = null;
    /** Amendment M61: write `state.playable` (null off the seat's priority), as an engine since 2026-10-07 does. */
    this.playableOn = playable;
    this.atPriority = false;
    this.nextId = 1;
    this.players = [
      { id: HUMAN, name: 'Human', isAi: false, life: 20, hand: [], battlefield: [], graveyard: [], library: [] },
      { id: AI, name: 'Forge AI', isAi: true, life: aiLife, hand: [], battlefield: [], graveyard: [], library: [] },
    ];
    this.turn = 0;
    this.phase = null;
    this.active = null;
    this.priority = null;
    this.stack = [];
    this.stackId = 0;
    this.attackers = [];
    this.blocks = new Map(); // attacker id -> blocker ids
    this.events = [];
    this.landPlayed = false;
    this.mulligans = 0;
    this.pending = null;
    this.askSeq = 0;
    this.gameOver = null;
    // Libraries, top first: two playable sevens (the opening hand and the one after a mulligan), then draws.
    const me = this.players[HUMAN];
    for (const name of [...HAND, ...HAND, 'Mountain', 'Hill Giant', 'Mountain', 'Hill Giant', 'Mountain']) me.library.push(this.make(name, HUMAN, 'library'));
    const ai = this.players[AI];
    this.nextId = 60;
    for (const name of AI_LIBRARY) ai.library.push(this.make(name, AI, 'library'));
    if (scene === 'main3') this.sceneMain3();
    else if (scene === 'pregame') this.scenePregame();
  }

  make(name, owner, zone) {
    return { id: this.nextId++, name, owner, zone, tapped: false, sick: false, attacking: false, blocking: false, damage: 0 };
  }

  move(c, zone) {
    const p = this.players[c.owner];
    for (const z of ['hand', 'battlefield', 'graveyard', 'library']) {
      const i = p[z].indexOf(c);
      if (i >= 0) p[z].splice(i, 1);
    }
    const from = c.zone;
    c.zone = zone;
    if (zone !== 'stack') p[zone].push(c);
    if (from === 'battlefield' && zone === 'graveyard' && isCreature(c)) {
      const artist = c.name === 'Blood Artist' && c.owner === HUMAN ? c : this.players[HUMAN].battlefield.find((x) => x.name === 'Blood Artist');
      if (artist) this.triggers.push(artist);
    }
    if (zone !== 'battlefield') Object.assign(c, { tapped: false, attacking: false, blocking: false, damage: 0 });
    this.events.push({ kind: 'zone', cardId: c.id, from: { zone: from, player: c.owner }, to: { zone, player: c.owner } });
  }

  draw(pid, n = 1) {
    for (let i = 0; i < n; i++) {
      const c = this.players[pid].library[0];
      if (c) this.move(c, 'hand');
    }
  }

  find(id) {
    for (const p of this.players) for (const z of ['hand', 'battlefield', 'graveyard']) for (const c of p[z]) if (c.id === id) return c;
    return null;
  }

  untappedLands(pid) {
    return this.players[pid].battlefield.filter((c) => DEFS[c.name].land && !c.tapped);
  }

  // ---- frames

  snapshot() {
    // M65's engine, as Forge: blocks being declared are not in state.combat until the declaration ends.
    const declaring = this.selectionOn && this.pending?.kind === 'block';
    const shown = (c) => (declaring && c.blocking ? { ...wire(c), blocking: false } : wire(c));
    const zones = (p) => {
      const viewer = p.id === HUMAN;
      const z = (cards, hide) => ({ count: cards.length, cards: cards.map((c) => (hide ? stub(c) : shown(c))) });
      return {
        hand: z(p.hand, !viewer),
        battlefield: z(p.battlefield, false),
        graveyard: z(p.graveyard, false),
        exile: { count: 0, cards: [] },
        command: { count: 0, cards: [] },
        library: { count: p.library.length, cards: [] },
      };
    };
    const bands = this.attackers.length
      ? [{ attackerIds: this.attackers.slice(), defender: { kind: 'player', id: this.active === HUMAN ? AI : HUMAN }, blockerIds: declaring ? [] : [...this.blocks.values()].flat(), damageOrder: [] }]
      : [];
    return {
      gameId: this.gameId,
      turn: this.turn,
      round: Math.ceil(this.turn / 2),
      phase: this.phase,
      activePlayer: this.active,
      priority: this.priority,
      gameOver: this.gameOver,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        isAi: p.isAi,
        life: p.life,
        poison: 0,
        counters: {},
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        phaseStops: p.id === HUMAN ? STOPS : { own: STOPS.opp, opp: STOPS.own },
        zones: zones(p),
      })),
      stack: this.stack.map((s) => ({
        id: s.id,
        sourceCardId: s.card.id,
        controller: s.card.owner,
        text: s.text,
        targetCardIds: s.target?.kind === 'card' ? [s.target.id] : [],
        targetPlayerIds: s.target?.kind === 'player' ? [s.target.id] : [],
        yieldKey: `y${s.id}`,
        isAbility: false,
        isOptionalTrigger: false,
        yielded: null,
      })),
      stackCards: this.stack.map((s) => wire(s.card)),
      combat: this.phase && this.phase.startsWith('COMBAT') ? { bands } : null,
      yield: this.yieldState,
      undo: { can: false, depth: 0 },
      ...(this.playableOn ? { playable: this.atPriority && this.priority === HUMAN && !this.gameOver ? this.playableNow() : null } : {}),
      events: this.events.splice(0),
    };
  }

  /** M61: your cards outside the battlefield a click would play now (mana not predicted, as Forge's click does not). */
  playableNow() {
    const me = this.players[HUMAN];
    const mainOk = this.active === HUMAN && (this.phase === 'MAIN1' || this.phase === 'MAIN2') && this.stack.length === 0;
    const out = [];
    for (const c of me.hand) {
      const d = DEFS[c.name];
      if (d.land ? mainOk && !this.landPlayed : /Instant/.test(d.types) || mainOk) {
        out.push({ cardId: c.id, zone: 'hand', abilities: [{ abilityId: 1000 + c.id, label: d.land ? `Play ${c.name}` : `Cast ${c.name}`, isSpell: !d.land }] });
      }
    }
    for (const c of me.graveyard) {
      const d = DEFS[c.name];
      if (d.fromGraveyard) out.push({ cardId: c.id, zone: 'graveyard', abilities: [{ abilityId: 2000 + c.id, label: d.fromGraveyard, isSpell: false }] });
    }
    return out;
  }

  emitState() {
    this.out('state', this.snapshot());
  }

  input(body, pending) {
    // A death trigger waits on its target first; the input that was due comes after it.
    if (this.triggers.length && !this.gameOver) {
      this.parked = { body, pending };
      return this.triggerPrompt();
    }
    this.pending = pending;
    this.atPriority = pending?.kind === 'priority';
    this.out('input', this.withSelection(body, pending));
  }

  /** M65/M66: what the seat has chosen in this input, and the players a click is taken for. */
  withSelection(body, pending) {
    if (!this.selectionOn) return body;
    const none = { cardIds: [], playerIds: [], blocks: [], attacks: [] };
    const asc = (a) => a.slice().sort((x, y) => x - y);
    let playerIds = [];
    let chosen = null;
    switch (pending?.kind) {
      case 'bottom':
        chosen = { ...none, cardIds: pending.chosen === null ? [] : [pending.chosen] };
        break;
      case 'trigger':
        playerIds = [HUMAN, AI];
        chosen = none;
        break;
      case 'attack':
        playerIds = [AI];
        chosen = { ...none, cardIds: asc(this.attackers), attacks: asc(this.attackers).map((id) => ({ attackerId: id, defender: { kind: 'player', id: AI } })) };
        break;
      case 'block': {
        const blocks = [...this.blocks.entries()].flatMap(([attackerId, ids]) => ids.map((blockerId) => ({ blockerId, attackerId })));
        chosen = { ...none, cardIds: asc(blocks.map((b) => b.blockerId)), blocks: blocks.sort((x, y) => x.blockerId - y.blockerId) };
        break;
      }
      case 'pay':
        playerIds = null;
        break;
    }
    return { ...body, selectable: { ...body.selectable, playerIds, chosen } };
  }

  /** Forge's InputSelectTargets for the trigger's mandatory "target player": no button, no listed card. */
  triggerPrompt() {
    const a = this.triggers[0];
    const text = `Blood Artist (${a.id}) - Whenever Blood Artist or another creature dies, target player loses 1 life and you gain 1 life. [Zone Changer: Blood Artist (${a.id})]\n\nSelect target player`;
    this.pending = { kind: 'trigger' };
    this.atPriority = false;
    this.emitState();
    this.out('input', this.withSelection(inputBody(text, button('OK', false), button('Cancel', false)), this.pending));
  }

  /** The trigger's player chosen: the drain resolves, then the next trigger or the input that was due. */
  resolveTrigger(playerId) {
    this.triggers.shift();
    const target = this.players[playerId];
    const me = this.players[HUMAN];
    const tFrom = target.life;
    target.life -= 1;
    this.events.push({ kind: 'life', player: target.id, from: tFrom, to: target.life });
    const mFrom = me.life;
    me.life += 1;
    this.events.push({ kind: 'life', player: HUMAN, from: mFrom, to: me.life });
    if (this.checkLife()) return;
    if (this.triggers.length) return this.triggerPrompt();
    const parked = this.parked;
    this.parked = null;
    this.emitState();
    if (parked) this.input(parked.body, parked.pending);
  }

  priorityPrompt() {
    const top = this.stack[this.stack.length - 1];
    return `Priority: Human\nTurn: ${this.turn} (${this.players[this.active].name})\nPhase: ${PHASE_TEXT[this.phase] ?? this.phase}\nStack: ${top ? top.text : 'Empty'}`;
  }

  // ---- scenes

  scenePregame() {
    if (this.deathTrigger) {
      const a = this.make('Blood Artist', HUMAN, 'battlefield');
      this.players[HUMAN].battlefield.push(a);
    }
    this.draw(HUMAN, 7);
    this.draw(AI, 7);
    this.emitState();
    this.keepPrompt();
  }

  /** Round 2, your turn, first main: a Mountain and Raging Goblin out, Shock in hand, the AI on 2 life with Goblin Guide. */
  sceneMain3() {
    const me = this.players[HUMAN];
    const ai = this.players[AI];
    const take = (p, name) => p.library.find((c) => c.name === name);
    const put = (c, zone) => {
      this.move(c, zone);
    };
    put(take(me, 'Mountain'), 'battlefield');
    put(take(me, 'Raging Goblin'), 'battlefield');
    for (const n of ['Mountain', 'Shock', 'Hill Giant', 'Mountain', 'Hill Giant']) put(take(me, n), 'hand');
    put(take(ai, 'Mountain'), 'battlefield');
    put(take(ai, 'Goblin Guide'), 'battlefield');
    this.draw(AI, 5);
    me.life = 18;
    ai.life = 2;
    this.turn = 3;
    this.events = [];
    this.startTurn(HUMAN, { draw: false, keepTurn: true });
  }

  /** `main3`, with Cauldron Familiar in your graveyard. */
  sceneGraveyard() {
    const f = this.make('Cauldron Familiar', HUMAN, 'graveyard');
    this.players[HUMAN].graveyard.push(f);
    this.sceneMain3();
  }

  // ---- pre-game

  keepPrompt() {
    const text = this.mulligans
      ? `Human, you are going first.\n\nYou have mulliganed ${this.mulligans} time. Do you want to keep your hand?`
      : 'Human, you are going first.\n\nDo you want to keep your hand?';
    this.input(inputBody(text, button('Keep', true), button('Mulligan', true)), { kind: 'keep' });
  }

  bottomPrompt(chosen = null) {
    const me = this.players[HUMAN];
    this.input(
      inputBody(`Return ${this.mulligans} card(s) to the bottom of your library`, button('OK', chosen !== null), button('Cancel', false), {
        selectable: { cardIds: me.hand.map((c) => c.id), min: 1, max: 1, mode: 'cards' },
        highlighted: chosen === null ? [] : [chosen],
      }),
      { kind: 'bottom', chosen },
    );
  }

  // ---- turns

  startTurn(pid, { draw = true, keepTurn = false } = {}) {
    // M64: a later turn beginning ends the yield (this model passes nothing for it: it only shows it).
    this.yieldState = null;
    if (!keepTurn) this.turn += 1;
    this.active = pid;
    this.priority = pid;
    this.landPlayed = false;
    for (const c of this.players[pid].battlefield) {
      if (c.tapped) this.events.push({ kind: 'tap', cardId: c.id, tapped: false });
      c.tapped = false;
      c.sick = false;
    }
    this.events.push({ kind: 'turn', player: pid, turn: this.turn }, { kind: 'phase', player: pid, phase: 'UPKEEP' });
    if (draw) {
      this.events.push({ kind: 'phase', player: pid, phase: 'DRAW' });
      this.draw(pid);
    }
    this.phase = 'MAIN1';
    this.events.push({ kind: 'phase', player: pid, phase: 'MAIN1' });
    if (pid === HUMAN) this.humanMain();
    else this.aiMain();
  }

  /** Your priority in a main phase; after a pass with an empty stack, combat (main 1) or the end of the turn (main 2). */
  humanMain() {
    this.priority = HUMAN;
    this.atPriority = true;
    this.emitState();
    this.priorityInput({
      resume: () => this.humanMain(),
      onEmpty: () => (this.phase === 'MAIN1' ? this.beginCombat() : this.endTurn()),
      onEndTurn: () => this.endTurn(),
    });
  }

  priorityInput(callbacks) {
    // As the bridge flushes a state when priority comes to the seat: M61's list is in the frame before the prompt.
    if (this.playableOn && !this.atPriority) {
      this.atPriority = true;
      this.emitState();
    }
    this.input(inputBody(this.priorityPrompt(), button('OK', true), button('End Turn', true)), { kind: 'priority', ...callbacks });
  }

  endTurn() {
    this.phase = 'END_OF_TURN';
    this.events.push({ kind: 'phase', player: this.active, phase: 'END_OF_TURN' }, { kind: 'phase', player: this.active, phase: 'CLEANUP' });
    this.attackers = [];
    this.blocks.clear();
    this.startTurn(this.active === HUMAN ? AI : HUMAN);
  }

  // ---- your combat

  canAttack(c) {
    return isCreature(c) && !c.tapped && (!c.sick || hasHaste(c));
  }

  beginCombat() {
    this.atPriority = false;
    const able = this.players[HUMAN].battlefield.filter((c) => this.canAttack(c));
    if (!able.length) {
      this.phase = 'MAIN2';
      this.events.push({ kind: 'phase', player: HUMAN, phase: 'MAIN2' });
      return this.humanMain();
    }
    this.phase = 'COMBAT_DECLARE_ATTACKERS';
    this.events.push({ kind: 'phase', player: HUMAN, phase: 'COMBAT_BEGIN' }, { kind: 'phase', player: HUMAN, phase: 'COMBAT_DECLARE_ATTACKERS' });
    this.emitState();
    this.attackPrompt();
  }

  attackPrompt() {
    const any = this.attackers.length > 0;
    this.input(
      inputBody('Select creatures to attack Forge AI or select player/card you wish to attack.', button('OK', true), button(any ? 'Call Back' : 'Alpha Strike', true), { highlighted: [AI] }),
      { kind: 'attack' },
    );
  }

  setAttacking(c, on) {
    c.attacking = on;
    c.tapped = on;
    this.events.push({ kind: 'tap', cardId: c.id, tapped: on });
    if (on) this.attackers.push(c.id);
    else this.attackers = this.attackers.filter((id) => id !== c.id);
  }

  alphaStrike() {
    for (const c of this.players[HUMAN].battlefield) if (!c.attacking && this.canAttack(c)) this.setAttacking(c, true);
    this.emitState();
    this.attackPrompt();
  }

  confirmAttacks() {
    if (this.attackers.length) this.events.push({ kind: 'attackers', player: HUMAN, bands: [{ defender: { kind: 'player', id: AI }, attackerIds: this.attackers.slice() }] });
    this.combatDamage(HUMAN);
    if (this.gameOver) return;
    this.phase = 'MAIN2';
    this.events.push({ kind: 'phase', player: HUMAN, phase: 'MAIN2' });
    this.humanMain();
  }

  /** Damage for the attacks `attacker` declared; ends the game when a player reaches 0. */
  combatDamage(attacker) {
    const defender = attacker === HUMAN ? AI : HUMAN;
    this.events.push({ kind: 'phase', player: attacker, phase: 'COMBAT_DAMAGE' });
    const dead = [];
    for (const id of this.attackers) {
      const a = this.find(id);
      if (!a) continue;
      const blockers = (this.blocks.get(id) ?? []).map((b) => this.find(b)).filter(Boolean);
      if (blockers.length) {
        const b = blockers[0];
        b.damage += power(a);
        this.events.push({ kind: 'damage', target: { kind: 'card', id: b.id }, sourceCardId: a.id, amount: power(a), combat: true, damageType: null });
        for (const x of blockers) {
          a.damage += power(x);
          this.events.push({ kind: 'damage', target: { kind: 'card', id: a.id }, sourceCardId: x.id, amount: power(x), combat: true, damageType: null });
        }
        for (const c of [a, ...blockers]) if (c.damage >= toughness(c)) dead.push(c);
      } else {
        const p = this.players[defender];
        const from = p.life;
        p.life -= power(a);
        this.events.push({ kind: 'damage', target: { kind: 'player', id: defender }, sourceCardId: a.id, amount: power(a), combat: true, damageType: null });
        this.events.push({ kind: 'life', player: defender, from, to: p.life });
      }
    }
    for (const c of dead) this.move(c, 'graveyard');
    const ids = this.attackers.slice();
    const bl = [...this.blocks.values()].flat();
    for (const p of this.players) for (const c of p.battlefield) Object.assign(c, { attacking: false, blocking: false });
    this.attackers = [];
    this.blocks.clear();
    this.events.push({ kind: 'combat_end', attackerIds: ids, blockerIds: bl });
    this.checkLife();
  }

  checkLife() {
    for (const p of this.players) {
      if (p.life <= 0 && !this.gameOver) {
        this.finish(p.id === HUMAN ? AI : HUMAN, 'AllOpponentsLost');
        return true;
      }
    }
    return false;
  }

  finish(winner, reason) {
    this.gameOver = { winner, reason, matchOver: this.matchOverIf?.(winner) ?? true };
    this.events.push({ kind: 'outcome', winner, lastTurn: this.turn });
    this.pending = { kind: 'over' };
    this.emitState();
    this.out('over', { ...this.gameOver });
  }

  // ---- the AI's turn

  aiMain() {
    const ai = this.players[AI];
    // M64: the opponent acting (a land drop is not acting, but this model ends it at the AI's turn either way).
    this.yieldState = null;
    const land = ai.hand.find((c) => DEFS[c.name].land);
    if (land) {
      this.move(land, 'battlefield');
      this.events.push({ kind: 'land', player: AI, cardId: land.id });
    }
    const guide = ai.hand.find((c) => c.name === 'Goblin Guide');
    if (guide && this.untappedLands(AI).length >= DEFS[guide.name].cost) {
      this.payCost(AI, guide);
      this.pushStack(guide, null);
      // You get priority with the AI's spell on the stack.
      this.priority = HUMAN;
      this.emitState();
      this.priorityInput({ resume: () => this.aiCombat(), onEmpty: () => this.aiCombat(), onEndTurn: null });
      return;
    }
    this.aiCombat();
  }

  aiCombat() {
    const ai = this.players[AI];
    const attackers = ai.battlefield.filter((c) => this.canAttack(c));
    if (!attackers.length) return this.aiEnd();
    this.phase = 'COMBAT_DECLARE_ATTACKERS';
    this.events.push({ kind: 'phase', player: AI, phase: 'COMBAT_BEGIN' }, { kind: 'phase', player: AI, phase: 'COMBAT_DECLARE_ATTACKERS' });
    for (const c of attackers) {
      c.attacking = true;
      c.tapped = true;
      this.attackers.push(c.id);
      this.events.push({ kind: 'tap', cardId: c.id, tapped: true });
    }
    this.events.push({ kind: 'attackers', player: AI, bands: [{ defender: { kind: 'player', id: HUMAN }, attackerIds: this.attackers.slice() }] });
    const canBlock = this.players[HUMAN].battlefield.some((c) => isCreature(c) && !c.tapped);
    if (!canBlock) {
      this.emitState();
      this.combatDamage(AI);
      if (!this.gameOver) this.aiEnd();
      return;
    }
    this.phase = 'COMBAT_DECLARE_BLOCKERS';
    this.priority = HUMAN;
    this.events.push({ kind: 'phase', player: AI, phase: 'COMBAT_DECLARE_BLOCKERS' });
    this.emitState();
    this.blockPrompt();
  }

  blockPrompt() {
    const a = this.find(this.attackers[0]);
    this.input(
      inputBody(`Select creatures to block ${a.name} (${a.id}) or select another attacker to declare blockers for.`, button('OK', true), button('Cancel', false), { highlighted: [a.id] }),
      { kind: 'block', attackerId: a.id },
    );
  }

  confirmBlocks() {
    const blocks = [...this.blocks.entries()].map(([attackerId, blockerIds]) => ({ attackerId, blockerIds }));
    this.events.push({ kind: 'blockers', defendingPlayer: HUMAN, blocks });
    this.combatDamage(AI);
    if (!this.gameOver) this.aiEnd();
  }

  aiEnd() {
    this.endTurn();
  }

  // ---- casting

  payCost(pid, card) {
    const lands = this.untappedLands(pid).slice(0, DEFS[card.name].cost);
    for (const l of lands) {
      l.tapped = true;
      this.events.push({ kind: 'tap', cardId: l.id, tapped: true });
    }
  }

  pushStack(card, target) {
    const id = ++this.stackId;
    const d = DEFS[card.name];
    const what = d.burn ? `${card.name} - ${card.name} deals ${d.burn} damage to any target.` : `${card.name} - Creature ${d.power} / ${d.toughness}`;
    const text = target ? `${what} (Targeting: ${target.label})` : what;
    this.move(card, 'stack');
    this.stack.push({ id, card, target, text });
    this.events.push({ kind: 'cast', stackId: id, cardId: card.id, controller: card.owner, text });
  }

  resolveTop() {
    const s = this.stack.pop();
    const c = s.card;
    const d = DEFS[c.name];
    this.events.push({ kind: 'resolved', cardId: c.id, fizzled: false }, { kind: 'unstacked', cardId: c.id });
    if (d.burn) {
      const t = s.target;
      if (t?.kind === 'player') {
        const p = this.players[t.id];
        const from = p.life;
        p.life -= d.burn;
        this.events.push({ kind: 'damage', target: { kind: 'player', id: t.id }, sourceCardId: c.id, amount: d.burn, combat: false, damageType: null });
        this.events.push({ kind: 'life', player: t.id, from, to: p.life });
      } else if (t?.kind === 'card') {
        const victim = this.find(t.id);
        if (victim && victim.zone === 'battlefield') {
          victim.damage += d.burn;
          this.events.push({ kind: 'damage', target: { kind: 'card', id: victim.id }, sourceCardId: c.id, amount: d.burn, combat: false, damageType: null });
          if (victim.damage >= toughness(victim)) this.move(victim, 'graveyard');
        }
      }
      c.zone = 'stack';
      this.move(c, 'graveyard');
    } else {
      c.zone = 'stack';
      this.move(c, 'battlefield');
      c.sick = true;
    }
    this.checkLife();
  }

  /** The spell you clicked: a target (an ask) for Shock, then the payment, then the stack. */
  beginCast(card) {
    const back = this.pending;
    if (DEFS[card.name].burn) return this.targetAsk(card, back);
    if (DEFS[card.name].cost === 0) return this.cast(card, null, back);
    this.payPrompt(card, null, back);
  }

  targetAsk(card, back) {
    const options = [];
    const opp = this.players[AI];
    options.push({ id: options.length, label: opp.name, kind: 'player', playerId: AI });
    for (const p of [this.players[AI], this.players[HUMAN]]) {
      for (const c of p.battlefield.filter(isCreature)) options.push({ id: options.length, label: `${c.name} (${c.id})`, kind: 'card', cardId: c.id, card: wire(c) });
    }
    options.push({ id: options.length, label: this.players[HUMAN].name, kind: 'player', playerId: HUMAN });
    this.pending = { kind: 'ask', card, back, options };
    this.askBody = {
      askId: `a${++this.askSeq}`,
      kind: 'choose_entities',
      timeoutMs: 0,
      prompt: `${card.name} (${card.id}) - ${card.name} deals ${DEFS[card.name].burn} damage to any target.\n\nSelect any target`,
      options,
      min: 1,
      max: 1,
      delayedReveal: null,
    };
    this.out('ask', this.askBody);
  }

  /** Asked again (with a new askId) — the reask path of a dropped question. */
  reask() {
    const p = this.pending;
    if (p?.kind !== 'ask') return;
    this.targetAsk(p.card, p.back);
  }

  onAnswer(askId, value) {
    const p = this.pending;
    if (p?.kind !== 'ask' || this.askBody?.askId !== askId) return false;
    this.askBody = null;
    const pick = Array.isArray(value) ? value[0] : typeof value === 'number' ? value : null;
    const opt = pick === null || pick === undefined ? null : p.options[pick];
    if (!opt) {
      // The default (§5.4): no target — the spell is not cast.
      this.pending = p.back;
      this.backTo(p.back);
      return true;
    }
    const target = opt.kind === 'player' ? { kind: 'player', id: opt.playerId, label: opt.label } : { kind: 'card', id: opt.cardId, label: opt.label };
    this.payPrompt(p.card, target, p.back);
    return true;
  }

  payPrompt(card, target, back) {
    const d = DEFS[card.name];
    const line = d.burn ? `${card.name} (${card.id}) - ${card.name} deals ${d.burn} damage to any target.` : `${card.name} - Creature ${d.power} / ${d.toughness}`;
    this.input(inputBody(`${line}\n\nPay Mana Cost: ${d.manaCost}`, button('Auto', true), button('Cancel', true)), { kind: 'pay', card, target, back });
  }

  /** Paid: the spell goes on the stack and you get priority again. */
  cast(card, target, back) {
    this.payCost(HUMAN, card);
    this.pushStack(card, target);
    this.priority = HUMAN;
    this.emitState();
    this.priorityInput(back);
  }

  /** Back to the priority you were in before you started casting. */
  backTo(back) {
    this.emitState();
    this.priorityInput(back);
  }

  // ---- acts

  onAct(body) {
    const p = this.pending;
    const a = body.action;
    if (a === 'concede') {
      if (!this.gameOver) this.finish(AI, 'Conceded');
      return;
    }
    if (a === 'yieldTo' && body.kind === 'endStepOrOpponent') {
      // M64. A bridge before it refuses the kind; one since refuses it in the end step and cleanup.
      if (!this.selectionOn) return this.out('notice', { level: 'warn', title: 'yieldTo', text: 'kind must be endOfTurn, marker or stack' });
      if (this.phase === 'END_OF_TURN' || this.phase === 'CLEANUP') {
        return this.out('notice', { level: 'warn', title: 'yieldTo', text: 'the end step has already begun' });
      }
      this.yieldState = { kind: 'endStepOrOpponent', playerId: this.active, phase: 'END_OF_TURN' };
      this.emitState();
      return;
    }
    // The engine's Cancel ends a running yield (§2.2: there is no cancel-yield act); the input stays.
    if (a === 'buttonCancel' && this.yieldState) {
      this.yieldState = null;
      this.emitState();
      return;
    }
    if (['setPhaseStop', 'setYield', 'yieldTo', 'undo'].includes(a)) {
      // M6: these four are answered with a fresh state.
      this.emitState();
      return;
    }
    if (!p || p.kind === 'over' || p.kind === 'ask') return this.out('notice', { level: 'warn', title: 'Not now', text: `${a}: the engine is not waiting for that` });
    if (p.kind === 'trigger') {
      if (a === 'clickPlayer' && this.players[body.playerId]) return this.resolveTrigger(body.playerId);
      // Forge's own answer to anything else: the same question again.
      if (a === 'clickCard') this.out('notice', { level: 'warn', title: 'Not selectable', text: `card ${body.cardId} cannot be selected now` });
      return this.triggerPrompt();
    }
    switch (p.kind) {
      case 'keep':
        if (a === 'buttonOk') {
          if (this.mulligans) return this.bottomPrompt();
          return this.startTurn(HUMAN, { draw: false });
        }
        if (a === 'buttonCancel') {
          const me = this.players[HUMAN];
          for (const c of me.hand.slice()) this.move(c, 'library'); // to the bottom
          this.events.push({ kind: 'mulligan', player: HUMAN }, { kind: 'shuffle', player: HUMAN });
          this.mulligans += 1;
          this.draw(HUMAN, 7);
          this.emitState();
          return this.keepPrompt();
        }
        break;
      case 'bottom':
        if (a === 'clickCard' && this.players[HUMAN].hand.some((c) => c.id === body.cardId)) return this.bottomPrompt(p.chosen === body.cardId ? null : body.cardId);
        if (a === 'buttonOk' && p.chosen !== null) {
          const c = this.find(p.chosen);
          this.move(c, 'library');
          return this.startTurn(HUMAN, { draw: false });
        }
        break;
      case 'priority':
        if (a === 'buttonCancel' && !this.stack.length && p.onEndTurn) return p.onEndTurn();
        if (a === 'buttonOk' || a === 'passPriority' || a === 'buttonCancel') {
          if (!this.stack.length) return p.onEmpty();
          // You pass, the AI passes: the top of the stack resolves.
          this.resolveTop();
          if (this.gameOver) return;
          if (this.stack.length) return this.backTo(p);
          return p.resume();
        }
        if (a === 'clickCard') return this.clickInPriority(body.cardId);
        break;
      case 'pay':
        if (a === 'buttonOk' || (a === 'clickCard' && this.untappedLands(HUMAN).some((c) => c.id === body.cardId))) {
          if (this.untappedLands(HUMAN).length < DEFS[p.card.name].cost) return this.out('notice', { level: 'warn', title: 'Not enough mana', text: '' });
          return this.cast(p.card, p.target, p.back);
        }
        if (a === 'buttonCancel') return this.backTo(p.back);
        break;
      case 'attack': {
        if (a === 'clickCard') {
          const c = this.find(body.cardId);
          if (c && c.owner === HUMAN && c.zone === 'battlefield' && (c.attacking || this.canAttack(c))) {
            this.setAttacking(c, !c.attacking);
            this.emitState();
            return this.attackPrompt();
          }
          break;
        }
        if (a === 'alphaStrike') return this.alphaStrike();
        if (a === 'buttonCancel') {
          if (this.attackers.length) {
            for (const id of this.attackers.slice()) this.setAttacking(this.find(id), false);
            this.emitState();
            return this.attackPrompt();
          }
          return this.alphaStrike();
        }
        if (a === 'buttonOk') return this.confirmAttacks();
        break;
      }
      case 'block': {
        if (a === 'clickCard') {
          const c = this.find(body.cardId);
          if (c && c.owner === HUMAN && c.zone === 'battlefield' && isCreature(c) && (!c.tapped || c.blocking)) {
            const list = this.blocks.get(p.attackerId) ?? [];
            c.blocking = !c.blocking;
            this.blocks.set(p.attackerId, c.blocking ? [...list, c.id] : list.filter((x) => x !== c.id));
            this.emitState();
            return this.blockPrompt();
          }
          break;
        }
        if (a === 'buttonOk') return this.confirmBlocks();
        break;
      }
    }
    if (a === 'clickCard') return this.out('notice', { level: 'warn', title: 'Not selectable', text: `card ${body.cardId} cannot be selected now` });
    return undefined;
  }

  clickInPriority(cardId) {
    const c = this.find(cardId);
    if (c && c.owner === HUMAN && c.zone === 'graveyard' && DEFS[c.name].fromGraveyard) {
      // Its one ability from the graveyard: back to the battlefield (Forge plays a lone ability without a menu).
      this.move(c, 'battlefield');
      c.sick = true;
      this.emitState();
      return this.priorityInput(this.pending);
    }
    const mainOk = this.active === HUMAN && (this.phase === 'MAIN1' || this.phase === 'MAIN2') && this.stack.length === 0;
    if (c && c.owner === HUMAN && c.zone === 'hand') {
      const d = DEFS[c.name];
      if (d.land && mainOk && !this.landPlayed) {
        this.landPlayed = true;
        this.move(c, 'battlefield');
        this.events.push({ kind: 'land', player: HUMAN, cardId: c.id });
        this.emitState();
        return this.priorityInput(this.pending);
      }
      const instant = /Instant/.test(d.types);
      if (!d.land && (instant || mainOk) && this.untappedLands(HUMAN).length >= d.cost) return this.beginCast(c);
    }
    return this.out('notice', { level: 'warn', title: 'Not selectable', text: `card ${cardId} cannot be selected now` });
  }
}

// ---------------------------------------------------------------------------
// The bridge: sockets, the session's frames, catch-ups.

export class FakeEngine {
  constructor({ gameId = 'human-ws-0', gameCount = 3, scene = 'pregame', dropMode = 'default', aiLife = 3, verbose = false, playable = false, deathTrigger = false, selection = false } = {}) {
    this.baseGameId = gameId;
    this.playable = playable;
    this.selection = selection;
    this.deathTrigger = deathTrigger;
    this.gameCount = gameCount;
    this.dropMode = dropMode;
    this.aiLife = aiLife;
    this.verbose = verbose;
    this.server = null;
    this.port = 0;
    this.seat = null;
    this.observers = new Set();
    /** Every socket: { id, path, openedAt, closedAt, code, refused }. */
    this.connections = [];
    /** Every frame a client sent: { conn, path, frame } (raw text in `raw` when it was not JSON). */
    this.received = [];
    this.down = false;
    this.connSeq = 0;
    this.newSession({ scene });
  }

  log(...a) {
    if (this.verbose) console.log('[fake-engine]', ...a);
  }

  // ---- session

  newSession({ scene = 'pregame' } = {}) {
    this.gameNumber = 0;
    this.wins = [0, 0];
    this.startGame({ scene });
  }

  startGame({ scene = 'pregame' } = {}) {
    this.gameNumber += 1;
    this.gameId = this.gameNumber === 1 ? this.baseGameId : `${this.baseGameId}-g${this.gameNumber}`;
    this.seq = 0;
    this.hello = null;
    this.lastState = null;
    this.lastInput = null;
    this.inputSeen = false;
    this.over = null;
    this.openAsk = null;
    this.reaskOnConnect = false;
    // Every frame of one game shares a `t` floor above the previous game's, so a restart's handshake never repeats a stamp.
    this.lastT = Math.max(this.lastT ?? 0, Date.now());
    this.emit('hello_ok', {
      gameId: this.gameId,
      you: HUMAN,
      seed: 0,
      ...(this.gameCount > 1 ? { gameNumber: this.gameNumber, gameCount: this.gameCount } : {}),
      forgeVersion: '2.0.14-fake',
      forgeJarSha256: '0'.repeat(64),
      unsupportedCards: [],
      players: [
        { id: HUMAN, name: 'Human', isAi: false },
        { id: AI, name: 'Forge AI', isAi: true },
      ],
      match: { yourDeck: { name: 'Mono-Red Test', path: 'decks/e2e-red.dck', cards: 40 }, aiDeck: { name: 'Red Probe', cards: 40 }, aiProfile: 'Default', games: this.gameCount },
    });
    const game = new Game({ out: (type, body) => this.emit(type, body), aiLife: this.aiLife, scene: 'none', playable: this.playable, deathTrigger: this.deathTrigger, selection: this.selection });
    this.game = game;
    game.gameId = this.gameId;
    game.matchOverIf = (winner) => {
      this.wins[winner] += 1;
      return this.wins[winner] >= Math.floor(this.gameCount / 2) + 1;
    };
    if (scene === 'main3') game.sceneMain3();
    else if (scene === 'graveyard') game.sceneGraveyard();
    else game.scenePregame();
  }

  /** Stamps and sends a server frame to the seat and the observers; caches what a catch-up re-delivers. */
  emit(type, body) {
    if (this.over && type !== 'over') {
      this.log(`dropped ${type} after over (§8.4)`);
      return null;
    }
    this.lastT = Math.max(this.lastT + 1, Date.now());
    const frame = { v: V, seq: ++this.seq, t: this.lastT, type, body };
    const text = JSON.stringify(frame);
    if (type === 'hello_ok') this.hello = text;
    if (type === 'state') this.lastState = text;
    if (type === 'input') {
      this.lastInput = text;
      this.inputSeen = true;
    }
    if (type === 'ask') this.openAsk = { askId: body.askId, text };
    if (type === 'over') this.over = text;
    this.log(`s2c ${type}#${frame.seq}${type === 'input' ? ` ${JSON.stringify(body.prompt.split('\n')[0])}` : ''}${type === 'ask' ? ` ${body.askId}` : ''}`);
    if (this.seat?.ws.open) this.seat.ws.send(text);
    for (const o of this.observers) o.ws.send(text);
    return frame;
  }

  /** §2.1 / §2.4: hello_ok and state verbatim, the input re-emitted, the open ask verbatim; `over` last. */
  catchUp(ws) {
    if (this.hello) ws.send(this.hello);
    if (this.lastState) ws.send(this.lastState);
    if (this.over) {
      ws.send(this.over);
      return;
    }
    if (this.inputSeen) {
      // Re-emitted with a new seq (M10), to every reader of the stream.
      const body = JSON.parse(this.lastInput).body;
      this.emit('input', body);
    }
    if (this.openAsk) ws.send(this.openAsk.text);
  }

  // ---- network

  async listen(port = 0, host = '127.0.0.1') {
    this.server = http.createServer((req, res) => this.onHttp(req, res));
    this.server.on('upgrade', (req, socket, head) => this.onUpgrade(req, socket, head));
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, host, resolve);
    });
    this.port = this.server.address().port;
    this.host = host;
    return this;
  }

  get seatUrl() {
    return `ws://127.0.0.1:${this.port}/ws`;
  }

  get observeUrl() {
    return `ws://127.0.0.1:${this.port}/observe`;
  }

  async close() {
    for (const c of [this.seat, ...this.observers]) c?.ws.terminate();
    if (!this.server) return;
    this.server.closeAllConnections?.();
    await new Promise((r) => this.server.close(() => r()));
  }

  onHttp(req, res) {
    const u = new URL(req.url, 'http://x');
    const json = (status, obj) => {
      res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify(obj));
    };
    if (u.pathname === '/health') return json(this.down ? 503 : 200, { status: this.down ? 'starting' : 'ok', gameId: this.gameId, seat: !!this.seat });
    if (u.pathname === '/control/log') return json(200, { connections: this.connections, received: this.received.map((r) => ({ path: r.path, conn: r.conn, frame: r.frame })) });
    if (req.method === 'POST' && u.pathname === '/control/drop') {
      this.dropSeat();
      return json(200, { ok: true });
    }
    if (req.method === 'POST' && u.pathname === '/control/restart') {
      void this.restart({ scene: u.searchParams.get('scene') ?? 'pregame', downMs: Number(u.searchParams.get('downMs') ?? 0) });
      return json(200, { ok: true });
    }
    if (req.method === 'POST' && u.pathname === '/control/reset') {
      this.reset({ scene: u.searchParams.get('scene') ?? 'pregame' });
      return json(200, { ok: true });
    }
    return json(404, { error: 'not found' });
  }

  onUpgrade(req, socket, head) {
    const path = new URL(req.url, 'http://x').pathname;
    if (this.down || (path !== '/ws' && path !== '/observe')) {
      this.connections.push({ id: ++this.connSeq, path, openedAt: Date.now(), closedAt: Date.now(), code: null, refused: this.down ? 'down' : 'path' });
      return refuseUpgrade(socket, this.down ? 503 : 404, this.down ? 'Service Unavailable' : 'Not Found');
    }
    const ws = acceptUpgrade(req, socket, head);
    if (!ws) return;
    const conn = { id: ++this.connSeq, path, openedAt: Date.now(), closedAt: null, code: null, refused: null };
    this.connections.push(conn);
    const entry = { ws, conn };
    ws.on('close', ({ code }) => {
      conn.closedAt = Date.now();
      conn.code = code;
      this.log(`${path} #${conn.id} closed ${code}`);
      if (path === '/observe') this.observers.delete(entry);
      else if (this.seat === entry) this.onSeatGone();
    });
    ws.on('message', (data) => this.onMessage(entry, path, data));
    if (path === '/observe') {
      this.observers.add(entry);
      this.log(`/observe #${conn.id} open`);
      this.catchUpObserver(ws);
      return;
    }
    if (this.seat) {
      // M13: one seat.
      conn.refused = 'seat';
      ws.send(JSON.stringify({ v: V, seq: 0, t: Date.now(), type: 'notice', body: { level: 'error', title: 'Seat taken', text: 'another client holds the seat' } }));
      ws.close(4001, 'seat taken');
      return;
    }
    this.seat = entry;
    this.log(`/ws #${conn.id} open`);
    this.catchUp(ws);
    if (this.reaskOnConnect) {
      this.reaskOnConnect = false;
      this.game.reask();
    }
  }

  catchUpObserver(ws) {
    if (this.hello) ws.send(this.hello);
    if (this.lastState) ws.send(this.lastState);
    if (this.over) ws.send(this.over);
    else if (this.lastInput) ws.send(this.lastInput);
    if (this.openAsk && !this.over) ws.send(this.openAsk.text);
  }

  /** M19: an ask parked on a dropped seat is cancelled. */
  onSeatGone() {
    this.seat = null;
    if (!this.openAsk || this.game.pending?.kind !== 'ask') return;
    const askId = this.openAsk.askId;
    this.openAsk = null;
    if (this.dropMode === 'reask') {
      this.log(`ask ${askId} cancelled by the drop; asking again on the reconnect`);
      this.game.askBody = null;
      this.reaskOnConnect = true;
      return;
    }
    this.log(`ask ${askId} cancelled by the drop; it takes its default`);
    this.game.onAnswer(askId, null);
  }

  onMessage(entry, path, data) {
    let frame = null;
    try {
      frame = JSON.parse(typeof data === 'string' ? data : data.toString('utf8'));
    } catch {
      /* recorded raw */
    }
    this.received.push({ conn: entry.conn.id, path, frame, raw: frame ? undefined : String(data) });
    if (path === '/observe') return; // never answered (M50)
    if (!frame || typeof frame !== 'object') return;
    this.log(`c2s ${frame.type} ${JSON.stringify(frame.body)}`);
    switch (frame.type) {
      case 'ping':
        entry.ws.send(JSON.stringify({ v: V, seq: 0, t: Date.now(), type: 'pong', body: {} }));
        return;
      case 'resync':
        this.catchUp(entry.ws);
        return;
      case 'act':
        if (this.over) {
          if (frame.body?.action === 'newGame' || frame.body?.action === 'nextGame') this.startGame();
          return;
        }
        this.game.onAct(frame.body ?? {});
        return;
      case 'answer': {
        const askId = frame.body?.askId;
        if (!this.openAsk || this.openAsk.askId !== askId) {
          this.emit('notice', { level: 'warn', title: 'Late answer', text: `ask ${askId} is not open` });
          return;
        }
        this.openAsk = null;
        this.game.onAnswer(askId, frame.body.value);
        return;
      }
      default:
        return;
    }
  }

  // ---- test hooks

  /** Cut the seat's TCP connection (no close frame: the browser sees 1006). */
  dropSeat() {
    this.seat?.ws.terminate();
  }

  /**
   * A new engine process under the same game id: every socket cut, `downMs`
   * of refused upgrades, then a fresh session (seq from 1, a new hello_ok).
   */
  async restart({ scene = 'pregame', downMs = 0 } = {}) {
    this.down = true;
    for (const c of [this.seat, ...this.observers]) c?.ws.terminate();
    this.seat = null;
    this.observers.clear();
    this.openAsk = null;
    if (downMs > 0) await new Promise((r) => setTimeout(r, downMs));
    this.newSession({ scene });
    this.down = false;
  }

  /** Start over from a scene without touching the sockets (before any client connects). */
  reset({ scene = 'pregame' } = {}) {
    this.openAsk = null;
    this.newSession({ scene });
  }

  /** Apply an act as if the seat sent it (mtg-table's own board playing, for observers). */
  seatAct(body) {
    if (this.over) return;
    this.game.onAct(body);
  }

  // ---- what the clients did

  /** c2s frames on a path (default the seat), optionally of one type. */
  frames(path = '/ws', type = null) {
    return this.received.filter((r) => r.path === path && r.frame && (type === null || r.frame.type === type)).map((r) => r.frame);
  }

  acts() {
    return this.frames('/ws', 'act').map((f) => f.body);
  }

  get pendingKind() {
    return this.over ? 'over' : this.game.pending?.kind ?? null;
  }

  /** Resolves once `pred()` is truthy; rejects after `ms` with `what`. */
  async waitFor(pred, what, ms = 5000) {
    const deadline = Date.now() + ms;
    for (;;) {
      const v = pred();
      if (v) return v;
      if (Date.now() > deadline) throw new Error(`timed out after ${ms} ms waiting for the engine: ${what} (engine at ${this.pendingKind})`);
      await new Promise((r) => setTimeout(r, 20));
    }
  }
}

export async function startFakeEngine(opts = {}) {
  const e = new FakeEngine(opts);
  await e.listen(opts.port ?? 0);
  return e;
}

// ---------------------------------------------------------------------------
// CLI

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const opt = (name, dflt) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : dflt;
  };
  const e = await startFakeEngine({ port: Number(opt('port', 8642)), scene: opt('scene', 'pregame'), dropMode: opt('drop-mode', 'default'), playable: args.includes('--playable'), deathTrigger: args.includes('--death-trigger'), selection: args.includes('--selection'), verbose: true });
  console.log(`fake engine: seat ${e.seatUrl}, observer ${e.observeUrl}, health http://127.0.0.1:${e.port}/health`);
}
