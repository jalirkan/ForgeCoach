/*
 * ForgeCoach — cube/guides/omega.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * How to draft Omega, the greatest-hits cube (public/cubes/omega-cube-180.md).
 */
import { FORGE_COMMON, FORMATS } from './common.ts';
import type { CubeGuide } from './types.ts';

export const OMEGA_GUIDE: CubeGuide = {
  cubeId: 'omega',
  docTitle: /^omega/i,
  teaser: 'Famous cards at one fair power level: two or three bombs per colour, so passing one is fine.',
  summary:
    'Thirty years of famous cards at one fair power level: no Power, no Moxen, and no way to cheat creatures into play except Reanimate and Animate Dead. Games are creatures, removal, card advantage and planeswalkers fighting over a board, at a medium-fast pace. Each colour has two or three bombs (Baneslayer Angel, Jace, the Mind Sculptor, Sheoldred, Glorybringer, Primeval Titan…), so passing one is rarely a disaster. The two drafters usually split into an aggressive deck (Boros, Izzet, Rakdos, white tokens) and a slower one (Azorius, Dimir, Golgari, green ramp).',
  archetypes: [
    {
      id: 'RW-heroes',
      colors: 'WR',
      name: 'Boros heroes and equipment',
      plan: 'One- and two-drops, Stoneforge Mystic into Jitte, Batterskull or a Sword, and burn to finish. Mishra’s Factory and Mutavault are extra attackers that dodge sorcery-speed removal.',
      cards: ['Figure of Destiny', 'Lightning Helix', 'Stoneforge Mystic', "Umezawa's Jitte", 'Hero of Bladehold'],
      pickEarly: 'Stoneforge Mystic, Jitte and the burn, then the best one- and two-drops.',
      traps: 'Equipment with too few creatures. Ball Lightning is sacrificed at end of turn: it is burn, not a creature you keep.',
      curve: 'Very low: eight to ten one- and two-drops. 16 lands.',
      lab: { colors: 'WR' },
    },
    {
      id: 'UR-tempo',
      colors: 'UR',
      name: 'Izzet spells and tempo',
      plan: 'Cantrips and burn fuel Delver, Swiftspear, Dragon’s Rage Channeler, both Pyromancers and Murktide Regent. Snapcaster Mage, Brazen Borrower and counters protect a lead.',
      cards: ['Expressive Iteration', 'Fire // Ice', 'Delver of Secrets', 'Murktide Regent', 'Young Pyromancer'],
      pickEarly: 'Burn and the one- and two-mana threats; cantrips come late.',
      traps: 'Too few instants and sorceries for Delver and Murktide: about twelve or more.',
      curve: 'Very low. 16 lands.',
      lab: { colors: 'UR' },
    },
    {
      id: 'WU-blink',
      colors: 'WU',
      name: 'Azorius flash and blink',
      plan: 'Creatures that do something when they enter (Reflector Mage, Skyclave Apparition, Man-o’-War, Mulldrifter, Venser), replayed by Ephemerate, Flickerwisp and Restoration Angel. Counters, Wrath of God and Sun Titan on top.',
      cards: ['Reflector Mage', 'Teferi, Hero of Dominaria', 'Restoration Angel', 'Ephemerate', 'Venser, Shaper Savant'],
      pickEarly: 'Reflector Mage, the flash creatures and Swords to Plowshares.',
      traps: 'Sower of Temptation and Control Magic keep the creature only while they stay: blinking Sower ends the steal (it then takes a new target). Too many blink effects and too few ETB creatures.',
      curve: 'Mostly three- and four-drops, many with flash. 17 lands.',
      lab: { colors: 'WU' },
    },
    {
      id: 'UB-reanimator',
      colors: 'UB',
      name: 'Dimir control and reanimation',
      plan: 'Discard, kill spells, counters and card draw; get a big creature into the graveyard with Psychic Frog, Liliana of the Veil or Fact or Fiction and bring it back with Reanimate or Animate Dead. Grave Titan, Consecrated Sphinx and Kokusho are the best targets, and you can hard-cast them too.',
      cards: ['Psychic Frog', 'Reanimate', 'Animate Dead', 'Grave Titan', 'Consecrated Sphinx'],
      pickEarly: 'Cheap removal and counters, Psychic Frog, and the reanimation spells.',
      traps: 'There is no Entomb or Faithless Looting here, so reanimation is a bonus, not the plan. Reanimate costs life equal to the creature’s mana value.',
      curve: 'Interaction at one to three, a top end at six. 17 lands.',
      lab: { colors: 'UB' },
    },
    {
      id: 'BR-sac',
      colors: 'BR',
      name: 'Rakdos sacrifice and recursion',
      plan: 'Fodder that keeps coming (Bloodghast, Bitterblossom, Young Pyromancer, Fable, Hangarback Walker), outlets that turn it into damage or protection (Falkenrath Aristocrat, Siege-Gang Commander, Bone Shards), and Blood Artist to drain.',
      cards: ['Falkenrath Aristocrat', "Kolaghan's Command", 'Bitterblossom', 'Blood Artist', 'Siege-Gang Commander'],
      pickEarly: 'Bitterblossom, Skullclamp and the removal; the outlets are few, so take them when you see them.',
      traps: 'This lane has only three real outlets; without them it is a pile of small creatures. Bitterblossom costs a life every turn.',
      curve: 'Low: many two-drops, Siege-Gang on top. 16 lands.',
      lab: { colors: 'BR' },
    },
    {
      id: 'BG-midrange',
      colors: 'BG',
      name: 'Golgari graveyard midrange',
      plan: 'Trade one-for-one with removal and discard, then win with threats that outsize everything (Tarmogoyf) or come back (Vengevine, Bloodghast, Eternal Witness). Both Lilianas, Thragtusk and Grist grind long games.',
      cards: ['Grist, the Hunger Tide', 'Maelstrom Pulse', 'Tarmogoyf', 'Liliana of the Veil', 'Vengevine'],
      pickEarly: 'Removal from both colours and the planeswalkers.',
      traps: 'Vengevine only returns when you cast your second creature spell in a turn: it needs cheap creatures.',
      curve: 'Two- to four-drops, a few fives. 17 lands.',
      lab: { colors: 'BG' },
    },
    {
      id: 'G-ramp',
      colors: 'G',
      also: 'RU',
      name: 'Green ramp and lands',
      plan: 'Mana creatures, Garruk and Nissa into Primeval Titan, Avenger of Zendikar, Rampaging Baloths or Craterhoof. Fetchlands double up landfall for Baloths, Avenger and Lotus Cobra.',
      cards: ['Primeval Titan', 'Rampaging Baloths', 'Birds of Paradise', 'Bloodbraid Elf', "Uro, Titan of Nature's Wrath"],
      pickEarly: 'The mana creatures and one or two big payoffs; then the red or blue half (Bloodbraid Elf and Huntmaster, or Uro and Mystic Snake).',
      traps: 'Green removal is light by design: take a few answers to fliers. Too many seven-drops.',
      curve: 'Mana at one to three, payoffs at five to eight. 16 lands with three or more mana creatures, else 17.',
      lab: { colors: 'G' },
    },
    {
      id: 'W-tokens',
      colors: 'W',
      also: 'BG',
      name: 'White tokens',
      plan: 'Token makers (Adeline, Brimaz, Hero of Bladehold, Wedding Announcement, Lingering Souls, Bitterblossom) cashed in with anthems (Hero’s battle cry, Sorin’s emblem, Wedding Festivity) or Skullclamp.',
      cards: ['Lingering Souls', 'Sorin, Lord of Innistrad', 'Hero of Bladehold', 'Wedding Announcement', 'Skullclamp'],
      pickEarly: 'Skullclamp, Hero of Bladehold and Adeline, then the gold token makers.',
      traps: 'Lots of 1/1s without a way to make them bigger. Wrath of God and Damnation are in the cube: don’t overextend into a blue or black deck holding four mana up.',
      curve: 'Low: many two- and three-drops. 16 lands.',
      lab: { colors: 'W' },
    },
  ],
  principles: {
    valuing: [
      'Bombs are spread out: two or three per colour. Early, take the one in the colours you lean toward rather than a stray bomb in a third colour.',
      'Removal: every colour has its own kind. Cheap, flexible removal (Swords to Plowshares, Path to Exile, Lightning Bolt, Fatal Push) is a high pick because there are so many bombs to answer.',
      'Equipment: Jitte and the Swords are colourless and fit any creature deck. Take them early, both to play and to keep them away from the AI.',
      'Fixing: the ten original duals and ten fetchlands. Each fetchland finds seven of the ten duals. Mishra’s Factory and Mutavault make colourless mana, so they suit a two-colour aggro deck, not a three-colour one.',
      'Synergy: Skullclamp with token makers is the strongest engine; the rest of the cube rewards good cards more than narrow ones.',
    ],
    formats: {
      grid: `${FORMATS.grid} The recommended format: you see the bombs the AI takes and can plan around them.`,
      winston: FORMATS.winston,
      booster: FORMATS.booster,
    },
    splash:
      'Duals, fetchlands, Birds of Paradise and Coalition Relic make a third colour cheap. Splash a removal spell or a one-pip bomb. Keep aggressive decks to two colours; the creature lands only work there.',
  },
  forge: {
    points: [
      ...FORGE_COMMON,
      'Omega was built so the AI can play every card: none is flagged AI:RemoveDeck:All, and only Demonic Tutor is flagged Random. The AI is a fairer opponent here than in the other cubes.',
      'Its weak spots still show: it is clumsy with Falkenrath Aristocrat and Siege-Gang Commander as outlets, and it attacks into Restoration Angel, Venser, Brazen Borrower and The Wandering Emperor (which has flash). Draft those flash cards a little higher.',
    ],
    flagged: { all: [], random: ['Demonic Tutor'] },
  },
};
