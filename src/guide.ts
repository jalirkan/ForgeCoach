/*
 * ForgeCoach — guide.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Deck play guides, editable in the UI, stored in localStorage (an in-memory
 * map stands in where there is no localStorage, e.g. node tests).
 *
 * Built-in guides are seeded on first read. Saving over a built-in keeps the
 * edit; deleting a built-in restores its default text instead of removing it.
 */
export interface Guide {
  id: string;
  name: string;
  text: string;
}

export const RAKDOS_GUIDE_ID = 'builtin:rakdos-sacrifice-cube';

export const RAKDOS_GUIDE_TEXT = `Rakdos sacrifice (cube practice deck).

Decklist: Viscera Seer, Carrion Feeder, Gravecrawler, Stitcher's Supplier, Blood Artist, Zulaport Cutthroat, Priest of Forgotten Gods, Young Pyromancer, Ophiomancer, Bloodghast, Juri, Master of the Revue, Mayhem Devil, Woe Strider, Midnight Reaper, Pia Nalaar, Pia and Kiran Nalaar, Hangarback Walker, Skullclamp, Goblin Bombardment, Village Rites, Deadly Dispute, Lightning Bolt, Fatal Push, Blood Crypt, Bloodstained Mire, Marsh Flats, Scalding Tarn, 7 Swamp, 6 Mountain.

How to play it:
- Lead with fodder; hold the payoffs (Blood Artist, Zulaport Cutthroat, Mayhem Devil) until there is an instant-speed sacrifice outlet on the board (Viscera Seer, Goblin Bombardment, or Village Rites / Deadly Dispute in hand).
- Respond to removal by sacrificing the target: it dies either way, so make it pay (drain, scry, draw, a counter on Juri). Fatal Push also gets revolt from any sacrifice.
- Juri gets a +1/+1 counter whenever you sacrifice a permanent, and her death trigger deals damage equal to her power to any target: she is reach. Feed her sacrifices, then sacrifice her last with the damage aimed at face (or the best creature).
- Ophiomancer makes a deathtouch Snake at every upkeep (yours and the opponent's) if you control no Snake. Keep the Snake as a blocker through the opponent's turn, then sacrifice it to an outlet at the end of the opponent's turn so a new one arrives at your upkeep: one free sacrifice per turn cycle for Blood Artist, Zulaport, Mayhem Devil and Juri.
- Skullclamp only on 1-toughness creatures (they die at once and draw two). Skullclamp + Bloodghast + a land is a draw engine: equip (1) kills Bloodghast, draw two, the next land drop (a fetchland entering counts) brings it back. Once per land drop, and Bloodghast can't block.
- Gravecrawler + Goblin Bombardment + a Zombie (Stitcher's Supplier, Carrion Feeder) is a 1-mana ping loop. Don't chump-block with Stitcher's Supplier while the Gravecrawler loop matters.
- Count your reach before you cast removal: Lightning Bolt (3), Bombardment pings (one per creature you can sacrifice), Juri's power, Mayhem Devil pings, Blood Artist / Zulaport drains. If the total is lethal, Bolt the face and keep the creatures as ammunition; if not, use Bolt / Push on the blocker or the engine that stops you.
- Keep count of sacrifice outlets on board: 0 = play it like a creature deck, 1 = the engine is on, 2 = count the drains, the game ends soon.
- Mardu variant (if the deck splashes white): Lingering Souls is four fliers of fodder.`;

export const SHIELD_GUIDE_ID = 'builtin:shield-wu';

export const SHIELD_GUIDE_TEXT = `S.H.I.E.L.D. (white-blue Marvel Super Heroes, 40 cards, 16 lands: 7 Plains, 7 Island, Thriving Heath, Thriving Isle).

Decklist: Agent Phil Coulson, Peggy Carter, Agent 13, Agents of S.H.I.E.L.D., Quake, Nick Fury, Wasp, Ant-Man (Reformed Rogue), Ant-Man's Air Force, Giant-Sized Flying Ant, Bold Biochemist, A.I.M. Scientists, Aerial Doombot, S.H.I.E.L.D. Helicarrier, S.H.I.E.L.D. Spy Kit, Strategic Intervention, Web Up, Helicarrier Strike, Borough Backup, Super Suit, Robotics Mastery, Quantum Reduction, Depower, Pym Particles.

The plan: attack with exactly one creature. Peggy (indestructible), Agents of S.H.I.E.L.D. and Strategic Intervention (+1/+1 each, Intervention also taps a defender), Agent 13 (a Clue), Nick Fury (draw, then put a creature with mana value 3 or less from hand onto the battlefield tapped and attacking, indestructible) and Spy Kit (untap it, scry 1) all trigger on "attacks alone". Everyone else stays home as blockers. Attacking with two creatures turns all of it off, so check before you declare.

- The attacker: pick the one that gets through. Wasp and Ant-Man's Air Force fly; Ant-Man is unblockable when you cast a blue spell first (and draws on combat damage); Pym Particles makes anything unblockable and draws. With Peggy out the attacker is also indestructible, so even a blocked attack is safe.
- Phil Coulson has vigilance, so he attacks and still taps: {T} puts a +1/+1 counter on each other Hero (Agent 13, Agents, Quake, Peggy, Nick Fury, Wasp, Ant-Man, Borough Backup tokens). Use it every turn.
- Quake taps a creature or land whenever you cast a noncreature spell: cast a cheap one (Spy Kit, Strategic Intervention, Pym Particles) before combat to tap the only good blocker, or cast an instant on the opponent's turn to tap one of their lands.
- Teamwork (Helicarrier Strike, Quantum Reduction) means you may tap creatures with total power 2 or more as an extra cost: tap creatures that are not attacking or blocking. Helicarrier Strike deals 2 to an attacker or blocker, 4 with teamwork; Quantum Reduction with teamwork has flash and shrinks a creature to -5/-0 with no abilities.
- Hold: Web Up (exile a nonland permanent) for the creature that actually beats you, not the first one. Depower (cheaper on an attacker) and Giant-Sized Flying Ant (flash, tap or untap a nonland permanent) are tricks for the opponent's attack or your own end of turn. Robotics Mastery has flash: cast it at end of turn or in response to removal on your attacker.
- Helicarrier needs crew 6: it comes with two Soldier tokens, so treat it as a source of bodies and a late flier, not something to crew early.
- A.I.M. Scientists and Borough Backup can landcycle for {2} if you are short on lands.

Traps: don't attack with a second creature "for value" and lose the alone-triggers; don't cast Web Up on a mana dork; don't tap your would-be attacker for teamwork. How you win: one protected, growing attacker draws cards every turn while the rest of the team holds the ground and fliers finish.`;

export const BLINK_GUIDE_ID = 'builtin:blink-cube';
export const BLINK_GUIDE_TEXT = `Azorius / Bant blink (synergy cube).

Plan: creatures whose enter-the-battlefield effect is good (Thraben Inspector, Spirited Companion, Mulldrifter, Reflector Mage, Wood Elves) get replayed by blink effects (Ephemerate, Flickerwisp, Restoration Angel, Soulherder), with Sun Titan and Reveillark on top.
- Sequence: ETB creature first, blink second. Never blink a creature whose ETB has no target or no value.
- Ephemerate has rebound: cast it from hand on your own turn to get a second blink at your next upkeep. Cast it in response to removal or damage to save the creature and fizzle the spell.
- Restoration Angel has flash: keep four mana up, blink at end of the opponent's turn or in response to removal. It cannot blink another Angel.
- Soulherder blinks a creature at the end of each of your turns and grows when a creature is exiled; point it at Reflector Mage (bounce a blocker each turn) or Mulldrifter (draw two).
- Reveillark returns two creatures with power 2 or less when it leaves the battlefield: blink it, or let it die, and bring back Reflector Mage, Mulldrifter, Spirited Companion, Inspector. Sun Titan returns a permanent with mana value 3 or less on entering and on each attack.
- Flickerwisp exiles any other permanent until the next end step: your own ETB creature, a blocker, or a land. Cast on your own turn it comes back at that turn's end step.
- Wood Elves needs a Forest: Bant only.
Trap: don't spend Ephemerate on an ETB when Restoration Angel or Soulherder will do it for free later. Win with fliers (Flickerwisp, Angel, Reveillark) while the value engine drowns the opponent.`;

export const COUNTERS_GUIDE_ID = 'builtin:counters-cube';
export const COUNTERS_GUIDE_TEXT = `Golgari / Abzan counters (synergy cube).

Plan: put +1/+1 counters on cheap creatures, then double them with Hardened Scales, Winding Constrictor and Conclave Mentor (each adds one more counter, and they stack: two of them means +2 per event).
- Land the doubler first (turn one Hardened Scales, turn two Constrictor or Mentor), then the counter creatures: Walking Ballista X=1 enters with 2 counters under one doubler; Hangarback Walker X=1 becomes 2 counters and 2 Thopters when it dies; Pelt Collector, Scavenging Ooze ({G}: eat a creature card in a graveyard for a counter and 1 life) and Evolution Sage (proliferates on every landfall) do the growing.
- Fetchlands feed Evolution Sage: crack the fetch for two landfalls (the fetch, then the land it finds), so hold the land until Sage is out.
- Walking Ballista can ping in response to removal: remove counters to kill small creatures or go face before it dies. Don't shoot with it if the counters matter more than one damage.
- Winding Constrictor also adds a counter on you and on artifacts; Conclave Mentor gains you life equal to its power when it dies.
- Protect the doublers; the deck is much weaker without them. Don't expose them as blockers.
Win: one huge Pelt Collector, Ooze or Ballista, or Hangarback and Ballista pings finishing the opponent.`;

export const SPELLS_GUIDE_ID = 'builtin:spells-cube';
export const SPELLS_GUIDE_TEXT = `Izzet spells (synergy cube).

Plan: a low curve of cheap creatures that reward noncreature spells, backed by cantrips and burn. Every spell should trigger something.
- Payoffs: Monastery Swiftspear (haste, prowess), Soul-Scar Mage (prowess; your noncreature damage to creatures becomes -1/-1 counters), Young Pyromancer (a 1/1 for each instant or sorcery), Third Path Iconoclast (a Soldier artifact token for each noncreature spell), Murmuring Mystic (a flying Bird per instant or sorcery), Talrand (a 2/2 flying Drake per instant or sorcery).
- Replay engines: Dreadhorde Arcanist casts a free instant or sorcery with mana value no more than its power from your graveyard when it attacks (Lightning Bolt and one-mana cantrips; it counts as a cast, so Pyromancer and the others trigger). Snapcaster Mage gives flashback for one turn to the best spell.
- Sequence: payoff creature first, then cantrips and burn after it, so each spell makes value. Cantrip before you cast the burn so you know what you hold (Thought Scour also fills the graveyard for Arcanist and Snapcaster).
- Burn the creature that blocks your small ones, or the face when the count of burn in hand is lethal.
Trap: don't cast spells into a sweeper or a counter without a second payoff; keep a payoff in hand when your first is the only one on the table. Win with a swarm of tokens, prowess hits and burn to the face.`;

export const GRAVEYARD_GUIDE_ID = 'builtin:graveyard-cube';
export const GRAVEYARD_GUIDE_TEXT = `Dimir / Sultai graveyard (synergy cube).

Plan: fill the graveyard cheaply, bring back recursive creatures, then reanimate a bomb.
- Fillers: Stitcher's Supplier (mills three on entering and on dying), Satyr Wayfinder (mills the rest of the top four, keeps a land), Thought Scour (mill two, draw a card).
- Recursive bodies: Bloodghast returns whenever a land enters (and can't block); Gravecrawler can be cast from the graveyard while you control a Zombie (Supplier and Prized Amalgam are Zombies); Prized Amalgam returns at the next end step whenever a creature enters from your graveyard or is cast from it, so Bloodghast coming back counts.
- Reanimation: Persist returns a nonlegendary creature with a -1/-1 counter for two mana; Unburial Rites returns any creature (flashback {3}{W} needs white). Archon of Cruelty on turn three drains, makes the opponent sacrifice and discard, and does it again each attack. Sun Titan returns mana value 3 or less permanents each time it attacks.
- Sequence: fill first, check what is in the graveyard, then spend the reanimation spell. Don't cast Persist or Unburial Rites with nothing big to return.
- Keep a land in hand to bring Bloodghast home on your turn (a fetchland entering counts).
Trap: milling yourself in a 40-card deck; count your library before using a third mill. Win with the reanimated Archon or Titan, with recursive attackers filling out the clock.`;

export const ARTIFACTS_GUIDE_ID = 'builtin:artifacts-cube';
export const ARTIFACTS_GUIDE_TEXT = `Artifact aggro (synergy cube).

Plan: a cheap pile of artifacts that replace themselves, with Cranial Plating, Steel Overseer, Sai, Pia and Kiran Nalaar and Marionette Master making them dangerous, and Skullclamp / Deadly Dispute as the draw engines.
- Cranial Plating gives +1/+0 per artifact you control: equip {1}, and with black mana attach it at instant speed ({B}{B}) in response to a block or to removal. Put it on an evasive creature (a Thopter).
- Steel Overseer taps to put a +1/+1 counter on each artifact creature you control (Thopters, Servos, Walking Ballista, Hangarback Walker): turn two Overseer, turn three go wide.
- Sai makes a Thopter for each artifact spell, so cast Sai before the cheap artifacts. Pia and Kiran Nalaar give two Thopters and turn artifacts into 2 damage ({2}{R}, sacrifice an artifact).
- Marionette Master drains for its power whenever an artifact goes to the graveyard: choose counters (bigger drain) when the opponent is low, Servos (more bodies, more artifacts to lose) when the board matters.
- Skullclamp on a Thopter or Servo is two cards; Deadly Dispute sacrificing a spent artifact is two cards and a Treasure.
- Don't sacrifice a Clue or Treasure you still need for mana unless it wins the turn.
Trap: don't overextend into a sweeper while the engines (Overseer, Master) are the only way to win; keep a Skullclamp for the rebuild. Win with Plating on a flier, or Marionette Master draining out the final points.`;

export const LANDFALL_GUIDE_ID = 'builtin:landfall-cube';
export const LANDFALL_GUIDE_TEXT = `Landfall ramp (synergy cube).

Plan: play lands one at a time (fetchlands for double landfall) into mana and a snowballing board.
- Early: Lotus Cobra (mana of any color on each landfall), Scute Swarm (an Insect per landfall; with six or more lands it makes a copy of itself, so the Swarm doubles), Tireless Tracker (a Clue per landfall, and a counter when you sacrifice a Clue).
- Fetchlands are two landfalls: the fetchland and the land it finds. Keep it until the landfall creatures are out, and watch your life total (each crack costs 1).
- Titania, Protector of Argoth makes a 5/3 Elemental whenever a land goes to the graveyard from the battlefield (a cracked fetchland counts) and returns a land when it enters. Ramunap Excavator lets you replay lands from the graveyard: crack, replay the fetchland next turn.
- Top end: Omnath, Locus of Rage (a 5/5 on each landfall; dies for 3 damage) and Avenger of Zendikar (a Plant per land, and each landfall grows them all). Cast Avenger with every land you can, then play a land.
- Sequence: creatures before the land drop every turn; save the land until the engine is on.
Trap: don't play the land first with Cobra or Tracker in hand. Win with a wide board of 5/3s, 5/5s and giant Plants.`;

export const LIFEGAIN_GUIDE_ID = 'builtin:lifegain-cube';
export const LIFEGAIN_GUIDE_TEXT = `Selesnya lifegain tokens (synergy cube).

Plan: cheap creatures gain life whenever creatures enter, lifegain payoffs grow, and token makers do the work.
- Enablers: Soul Warden (any creature entering, the opponent's too), Lunarch Veteran (another creature of yours entering), Prosperous Innkeeper (Treasure, and another creature of yours entering). Play them on turns one and two; they gain nothing on their own.
- Payoffs: Ajani's Pridemate gets a counter for each life gain event, so each enabler is a separate counter; Conclave Mentor adds a counter to each counter event (and gains life when it dies); Welcoming Vampire draws a card once a turn when a creature with power 2 or less enters.
- Token makers: Adeline (a Human token attacking every attack; her power is your creature count) and Brimaz (a Cat token on attack and block) fill the board and trigger everything.
- Sequence: enablers first, Pridemate next, token makers last; attack with Adeline and Brimaz as soon as it is safe, since every token that enters gains life.
- Brimaz is a fine blocker; Adeline is better attacking.
Trap: don't run the payoffs out without an enabler on the board. Win by going wide, with Pridemate and Adeline enormous.`;

export const COUNTER_BLITZ_GUIDE_ID = 'builtin:counter-blitz-gw';
export const COUNTER_BLITZ_GUIDE_TEXT = `Counter Blitz, green-white (a 40-card deck built from the Final Fantasy X Commander precon; Tidus and Yuna are three colours, so they stay out of a two-colour build).

Plan: cheap creatures that put +1/+1 counters on your team every turn, then make the countered creatures hard to block and hard to kill. Count everything with a counter on it: half the deck checks for one.
- Counter engines, best first on the curve: Shelinda, Yevon Acolyte (lifelink; each creature that enters after her gets a counter while it is smaller than her, otherwise she grows), Maester Seymour (at the start of each combat on your turn, puts counters equal to its power on another creature), Tromell, Seymour's Butler (each other nontoken creature enters with an extra counter; {1},{T}: proliferate once per nontoken creature that entered this turn, so play your creatures first, then use it), Wakka, Devoted Guardian (when a counter went on Wakka this turn, every other creature you control gets one at your end step). Duskshell Crawler and Generous Patron put counters on others when they enter; Gyre Sage and Incubation Druid turn a counter into mana (Druid makes three).
- Removal: Summon: Ixion (chapter I exiles their creature until the Saga leaves; it leaves after chapter III, so the creature comes back: race it or remove it again), Auron, Venerated Guardian (each attack exiles a defender's creature with less power than Auron, until Auron leaves: attack with it every turn, it grows first), Summon: Yojimbo (chapter I exiles an artifact, enchantment or tapped creature; then attacking you costs {2} a creature for two turns), Path to Exile, Destroy Evil (toughness 4 or more, or an enchantment), Collective Effort (escalate by tapping creatures: kill a power-4 creature and counter your whole team in one card).
- Damning Verdict destroys only creatures with no counters: with counters on your team it is a one-sided wipe. Count before you cast it. Farewell is modes you choose: exile all creatures only when you are behind on board.
- Protect the board: Inspiring Call draws a card for each creature with a +1/+1 counter and makes them indestructible until end of turn, so hold it for their removal or wipe, or for a big attack. Gatta and Luzzu has flash: prevent the damage to a blocker or attacker and turn it into counters.
- Evasion: Sphere Grid gives creatures with +1/+1 counters reach and trample and grows anything that connects; Duskshell Crawler gives trample. Chocobo Knights gives your countered attackers double strike whenever you attack.
- Lord Jyscal Guado (a flier) investigates at each end step in which you put a counter on a creature: almost every turn here. Walking Ballista grows with spare mana and pings in response to removal.
Traps: don't cast Promise of Loyalty with a wide board (you keep one creature); don't put Ixion's exile on a creature you can kill for good with Path; don't run a creature out alone into open mana when Inspiring Call or Gatta can wait for the fight. Win: a board of countered creatures with trample, finished by Wakka's or Seymour's end-step growth.`;

const BUILTINS: readonly Guide[] = Object.freeze([
  Object.freeze({ id: RAKDOS_GUIDE_ID, name: 'Rakdos sacrifice (cube)', text: RAKDOS_GUIDE_TEXT }),
  Object.freeze({ id: SHIELD_GUIDE_ID, name: 'S.H.I.E.L.D. (Marvel W/U)', text: SHIELD_GUIDE_TEXT }),
  Object.freeze({ id: BLINK_GUIDE_ID, name: 'Azorius / Bant blink (cube)', text: BLINK_GUIDE_TEXT }),
  Object.freeze({ id: COUNTERS_GUIDE_ID, name: 'Golgari / Abzan counters (cube)', text: COUNTERS_GUIDE_TEXT }),
  Object.freeze({ id: SPELLS_GUIDE_ID, name: 'Izzet spells (cube)', text: SPELLS_GUIDE_TEXT }),
  Object.freeze({ id: GRAVEYARD_GUIDE_ID, name: 'Dimir / Sultai graveyard (cube)', text: GRAVEYARD_GUIDE_TEXT }),
  Object.freeze({ id: ARTIFACTS_GUIDE_ID, name: 'Artifact aggro (cube)', text: ARTIFACTS_GUIDE_TEXT }),
  Object.freeze({ id: LANDFALL_GUIDE_ID, name: 'Landfall ramp (cube)', text: LANDFALL_GUIDE_TEXT }),
  Object.freeze({ id: LIFEGAIN_GUIDE_ID, name: 'Selesnya lifegain tokens (cube)', text: LIFEGAIN_GUIDE_TEXT }),
  Object.freeze({ id: COUNTER_BLITZ_GUIDE_ID, name: 'Counter Blitz G/W (Final Fantasy X deck)', text: COUNTER_BLITZ_GUIDE_TEXT }),
]);

const GUIDES_KEY = 'forgecoach.guides.v1';
const ACTIVE_KEY = 'forgecoach.activeGuide.v1';

// --- storage with an in-memory fallback -----------------------------------

const memory = new Map<string, string>();

function storage(): Storage | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (!ls) return null;
    const probe = '__forgecoach_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}

function read(key: string): string | null {
  const ls = storage();
  if (ls) {
    try {
      return ls.getItem(key);
    } catch {
      /* fall through */
    }
  }
  return memory.has(key) ? memory.get(key)! : null;
}

function write(key: string, value: string | null): void {
  const ls = storage();
  if (ls) {
    try {
      if (value === null) ls.removeItem(key);
      else ls.setItem(key, value);
      return;
    } catch {
      /* quota or privacy mode: keep it in memory */
    }
  }
  if (value === null) memory.delete(key);
  else memory.set(key, value);
}

// --- guides ----------------------------------------------------------------

function isGuide(x: unknown): x is Guide {
  const g = x as Guide;
  return !!g && typeof g.id === 'string' && typeof g.name === 'string' && typeof g.text === 'string';
}

/** User-saved guides (including edited built-ins), in saved order. */
function stored(): Guide[] {
  const raw = read(GUIDES_KEY);
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter(isGuide) : [];
  } catch {
    return [];
  }
}

function store(gs: Guide[]): void {
  write(GUIDES_KEY, JSON.stringify(gs));
}

export function isBuiltinGuide(id: string): boolean {
  return BUILTINS.some((b) => b.id === id);
}

/** The shipped default of a built-in guide, or null. */
export function defaultGuide(id: string): Guide | null {
  const b = BUILTINS.find((x) => x.id === id);
  return b ? { ...b } : null;
}

/** Built-ins first (edited copy if the user saved one), then the user's own guides. */
export function listGuides(): Guide[] {
  const saved = stored();
  const byId = new Map(saved.map((g) => [g.id, g]));
  const out: Guide[] = BUILTINS.map((b) => ({ ...(byId.get(b.id) ?? b) }));
  for (const g of saved) if (!isBuiltinGuide(g.id)) out.push({ ...g });
  return out;
}

export function getGuide(id: string): Guide | null {
  return listGuides().find((g) => g.id === id) ?? null;
}

export function saveGuide(g: Guide): void {
  if (!isGuide(g) || g.id === '') throw new Error('A guide needs an id, a name and text.');
  const saved = stored();
  const i = saved.findIndex((x) => x.id === g.id);
  const copy = { id: g.id, name: g.name, text: g.text };
  if (i >= 0) saved[i] = copy;
  else saved.push(copy);
  store(saved);
}

/** Removes a user guide; for a built-in, throws away the edits (the default comes back). */
export function deleteGuide(id: string): void {
  store(stored().filter((g) => g.id !== id));
  if (!isBuiltinGuide(id) && activeGuideId() === id) setActiveGuideId(null);
}

/** A fresh id for a new user guide. */
export function newGuideId(): string {
  return `user:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** The guide the user picked for coaching (null = none). */
export function activeGuideId(): string | null {
  const id = read(ACTIVE_KEY);
  if (!id) return null;
  return listGuides().some((g) => g.id === id) ? id : null;
}

export function setActiveGuideId(id: string | null): void {
  write(ACTIVE_KEY, id);
}

/** Text of the active guide, for buildCoachPrompt / buildReviewPrompt. */
export function activeGuideText(): string | undefined {
  const id = activeGuideId();
  return id ? (getGuide(id)?.text ?? undefined) : undefined;
}
