/*
 * ForgeCoach — cube/guides/synergy.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * How to draft the Synergy Cube (public/cubes/synergy-cube-180.md).
 */
import { FORGE_COMMON, FORMATS } from './common.ts';
import type { CubeGuide } from './types.ts';

export const SYNERGY_GUIDE: CubeGuide = {
  cubeId: 'synergy',
  docTitle: /synergy cube/i,
  teaser: 'Draft a web, not a pile: most cards sit in two or three themes, and the hub cards keep you open.',
  summary:
    'A medium-speed cube with a tight power band. No single card wins on its own here; the closest things to bombs are Chandra, Torch of Defiance and Elspeth, Sun’s Champion. Games are won by whose engine gets running: tokens fed to sacrifice outlets, enter-the-battlefield creatures replayed by blink, +1/+1 counters doubled. Cheap creature removal is everywhere and there are only two counterspells, so what you build on the board decides most games. Ten shocklands and ten fetchlands make a third colour easy.',
  archetypes: [
    {
      id: 'BR-sac',
      colors: 'BR',
      also: 'W',
      name: 'Rakdos sacrifice',
      plan: 'Make bodies that are happy to die, sacrifice them for value, and drain with death triggers. You win by grinding: every chump block and every removal spell the opponent points at you turns into a drain, a ping or a card.',
      cards: ['Goblin Bombardment', 'Viscera Seer', 'Blood Artist', 'Mayhem Devil', 'Priest of Forgotten Gods'],
      pickEarly: 'The outlets, Goblin Bombardment above all, then Yawgmoth, Thran Physician (an outlet that draws), Mayhem Devil and Juri, Master of the Revue. Fodder that leaves something behind (Murderous Redcap, Young Pyromancer, Ophiomancer, Hangarback Walker, Lingering Souls in Mardu) comes later.',
      traps: 'Payoffs without outlets: Blood Artist and Zulaport Cutthroat do nothing until something dies. Count your outlets before taking a third payoff, and keep a few cards that can actually close a game.',
      curve: 'Low: seven or eight one- and two-drops, little above four mana. 16 lands.',
      lab: { colors: 'BR', themes: ['SAC'] },
    },
    {
      id: 'WU-blink',
      colors: 'WU',
      also: 'G',
      name: 'Azorius blink',
      plan: 'Creatures with good enter-the-battlefield effects, replayed by blink. Each blink is another bounce, another card or another token. You win in the air with Flickerwisp, Restoration Angel and Reveillark while the value piles up.',
      cards: ['Reflector Mage', 'Soulherder', 'Ephemerate', 'Restoration Angel', 'Mulldrifter'],
      pickEarly: 'Reflector Mage and Soulherder (the two Azorius gold cards) and the repeatable blinkers. Creatures with a good ETB are common; ways to replay them are not.',
      traps: 'Too many blink effects and too few targets: Ephemerate on a creature with no ETB is a wasted card. Restoration Angel can’t blink another Angel. Wood Elves needs a Forest, so it belongs only in Bant.',
      curve: 'Midrange: a few two-drops (Thraben Inspector, Spirited Companion), most of the deck at three and four, Sun Titan or Reveillark on top. 16–17 lands.',
      lab: { colors: 'WU', themes: ['ETB'] },
    },
    {
      id: 'BG-counters',
      colors: 'BG',
      also: 'W',
      name: 'Golgari counters',
      plan: 'Put +1/+1 counters on cheap creatures and add more. Hardened Scales, Winding Constrictor and Conclave Mentor each add one extra counter whenever counters go on a creature, and they stack. You win with one or two creatures that got far too big, or with Walking Ballista pings.',
      cards: ['Hardened Scales', 'Winding Constrictor', 'Walking Ballista', 'Hangarback Walker', 'Conclave Mentor'],
      pickEarly: 'The doublers, Winding Constrictor first (it also counts on artifacts). The counter creatures (Pelt Collector, Scavenging Ooze, Evolution Sage, Ballista, Hangarback) are spread over green and colourless and come later.',
      traps: 'A doubler with nothing to double: Hardened Scales alone is a blank card. Take it once you have three or four creatures that make counters.',
      curve: 'Low: doublers at one to three mana, counter creatures at one to three, a few fours. 16 lands.',
      lab: { colors: 'BG', themes: ['CTR'] },
    },
    {
      id: 'UR-spells',
      colors: 'UR',
      name: 'Izzet spells',
      plan: 'Cheap creatures that reward instants and sorceries, plus cantrips and burn. Every spell should make a token or deal damage. You win early with tokens and attackers, then finish with burn.',
      cards: ['Third Path Iconoclast', 'Young Pyromancer', 'Talrand, Sky Summoner', 'Murmuring Mystic', 'Lightning Bolt'],
      pickEarly: 'The payoffs and the burn. Cantrips (Opt, Consider, Brainstorm, Ponder, Thought Scour) are plentiful and come late.',
      traps: 'Too many creatures. With fewer than about twelve instants and sorceries the payoffs are just small bodies; count your spells as you draft.',
      curve: 'Very low: payoffs at one to four mana, spells at one and two. 16 lands.',
      lab: { colors: 'UR', themes: ['SPL'] },
    },
    {
      id: 'UB-graveyard',
      colors: 'UB',
      also: 'G',
      name: 'Dimir graveyard',
      plan: 'Fill your graveyard and play creatures out of it. Self-mill sets up Bloodghast, Gravecrawler and Prized Amalgam coming back, and Reanimate, Unburial Rites or Persist put a big creature like Archon of Cruelty into play early.',
      cards: ["Stitcher's Supplier", 'Prized Amalgam', 'Bloodghast', 'Reanimate', 'Archon of Cruelty'],
      pickEarly: 'Prized Amalgam, the reanimation spells and one or two big targets. Self-mill (Stitcher’s Supplier, Thought Scour, Satyr Wayfinder) comes later.',
      traps: 'Reanimation with nothing worth reanimating, or nothing that puts the target in the graveyard. Persist can’t return a legendary creature.',
      curve: 'One- and two-drop enablers, then a couple of big creatures you don’t plan to hard-cast. 16–17 lands.',
      lab: { colors: 'UB', themes: ['GY'] },
    },
    {
      id: 'artifacts',
      colors: '',
      name: 'Artifact aggro (any colours)',
      plan: 'Cheap artifacts that replace themselves (Mishra’s Bauble, Chromatic Star, Ichor Wellspring, Clues) power up Cranial Plating and Steel Overseer and feed Sai, Master Thopterist and Marionette Master. You win by attacking with one creature carrying Plating, or by grinding with Experimental Synthesizer and Deadly Dispute.',
      cards: ['Cranial Plating', 'Steel Overseer', 'Sai, Master Thopterist', 'Marionette Master', 'Retrofitter Foundry'],
      pickEarly: 'Cranial Plating and Steel Overseer: the payoffs are few, the cheap artifacts are everywhere. It fits beside whatever colours you end up in.',
      traps: 'Artifacts that do nothing alone: Bauble and Chromatic Star are only good with payoffs. Forge’s AI plays Bauble, Chromatic Star and Prophetic Prism badly, so they also look worse in the lab than they are.',
      curve: 'Very low: lots of zero- to two-mana artifacts, few cards above four. 16 lands.',
      lab: { colors: '', themes: ['ART'] },
    },
    {
      id: 'G-landfall',
      colors: 'G',
      also: 'RU',
      name: 'Landfall ramp',
      plan: 'Every fetchland is two landfall triggers: one as it enters, one for the land it finds. Lotus Cobra, Scute Swarm and Tireless Tracker grow off them; Titania makes a 5/3 each time a fetchland is sacrificed, and Omnath and Avenger of Zendikar turn lands into an army.',
      cards: ['Lotus Cobra', 'Titania, Protector of Argoth', 'Scute Swarm', 'Avenger of Zendikar', 'Omnath, Locus of Rage'],
      pickEarly: 'Fetchlands are your engine as well as your mana: take them over medium spells. Then Titania and Lotus Cobra.',
      traps: 'Seven-drops with nothing to reach them. Omnath costs {3}{R}{R}{G}{G}, so it wants a real red half, not a splash.',
      curve: 'Ramp and landfall creatures at two and three, payoffs at five to seven. 17 lands, fetchlands included.',
      lab: { colors: 'G', themes: ['LND'] },
    },
    {
      id: 'WG-lifegain',
      colors: 'WG',
      name: 'Selesnya lifegain tokens',
      plan: 'Small creatures that gain life whenever another creature enters (Soul Warden, Lunarch Veteran, Prosperous Innkeeper) feed Ajani’s Pridemate, while token makers go wide. You win by attacking with a wide board behind Adeline, Brimaz or a large Pridemate.',
      cards: ["Ajani's Pridemate", 'Soul Warden', 'Prosperous Innkeeper', 'Adeline, Resplendent Cathar', 'Conclave Mentor'],
      pickEarly: 'Adeline and Brimaz, King of Oreskos (they make tokens every attack), then Conclave Mentor and Pridemate. The one-drop life gainers come late.',
      traps: 'Lifegain with no payoff is a pile of 1/1s. You need Pridemate, Adeline or Brimaz to turn the life and tokens into damage.',
      curve: 'Low: several one- and two-drops, token makers at three and four. 16 lands.',
      lab: { colors: 'WG', themes: ['TOK', 'LIFE'] },
    },
  ],
  principles: {
    valuing: [
      'Removal is cheap and common in every colour (Swords to Plowshares, Lightning Bolt, Fatal Push, Go for the Throat, Bone Shards). Take a premium one early, but you’ll see more; don’t take a fifth over a key engine piece.',
      'Fixing is only the twenty shocklands and fetchlands. A dual in your colours is worth a medium playable, and fetchlands count twice in the landfall and graveyard decks.',
      'Bombs are few: Chandra, Torch of Defiance and Elspeth, Sun’s Champion. Take them, but they don’t carry a deck alone here.',
      'Synergy pieces: early on, prefer the hub cards that sit in three themes (Blood Artist, Young Pyromancer, Thraben Inspector, Tireless Tracker, Hangarback Walker, Grist). Take narrow payoffs once you know you are in their deck.',
    ],
    formats: {
      grid: `${FORMATS.grid} This is the cube’s recommended format: you can plan your web of themes from the start.`,
      winston: FORMATS.winston,
      booster: FORMATS.booster,
    },
    splash:
      'Fetchlands find any shockland that shares a basic land type with them, so a third colour costs little. Splash a removal spell or a one-pip gold card with two or three sources. Don’t splash synergy pieces: they need the rest of their deck to work.',
  },
  forge: {
    points: [
      ...FORGE_COMMON,
      'Here that hits sacrifice hardest: Viscera Seer and Goblin Bombardment are flagged, so the AI wastes the Rakdos deck’s best outlets. Take them yourself; they will rate below their real strength in the lab.',
      'Against the AI, keep mana up for Restoration Angel and instant removal on its turn: it walks attackers into them.',
    ],
    flagged: {
      all: ['Prismatic Ending', 'Viscera Seer', 'Goblin Bombardment', 'Faithless Looting', 'Beast Within', "Mishra's Bauble", 'Chromatic Star', 'Prophetic Prism'],
      random: ['Intangible Virtue', 'Hardened Scales', 'Soulherder', 'Winding Constrictor', 'Ichor Wellspring', 'Lotus Petal'],
    },
  },
};
