/*
 * ForgeCoach — cube/guides/modernEra.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * How to draft the Modern-Era Cube (public/cubes/modern-era-cube-180.md).
 */
import { FORGE_COMMON, FORMATS } from './common.ts';
import type { CubeGuide } from './types.ts';

export const MODERN_ERA_GUIDE: CubeGuide = {
  cubeId: 'modern-era',
  docTitle: /modern-era cube/i,
  teaser: 'Ten guild decks and a handful of famous bombs: take the bomb, then find the pair that is open.',
  summary:
    'Creatures and removal, at a high power level. Every colour has cheap removal and blue has real counterspells, so games are interactive: efficient threats plus burn win short games, two-for-ones and planeswalkers win long ones. A few famous cards decide games when unanswered (Sheoldred, the Apocalypse, Ragavan, The One Ring, Jace, the Mind Sculptor, Oko, Craterhoof Behemoth), and every draft has one or two of them. Each colour pair has two gold signposts, so the ten guild decks are all real.',
  archetypes: [
    {
      id: 'WU',
      colors: 'WU',
      name: 'Azorius fliers and flash',
      plan: 'Flash and flying creatures, a few counters, and removal. Play on the opponent’s turn when you can, so you never tap out into their best play. Win in the air.',
      cards: ['Spell Queller', 'Teferi, Time Raveler', 'Restoration Angel', 'Brazen Borrower', 'Vendilion Clique'],
      pickEarly: 'Spell Queller and Teferi, then the flash fliers. Swords to Plowshares and Path to Exile keep you alive while they attack.',
      traps: 'Too many counterspells and too few threats. Spell Queller only exiles spells with mana value 4 or less, and if Queller leaves play its owner may cast that spell for free.',
      curve: 'Mostly two- to four-drops, many with flash. 16–17 lands.',
      lab: { colors: 'WU' },
    },
    {
      id: 'UB',
      colors: 'UB',
      name: 'Dimir control and reanimation',
      plan: 'Kill or counter what matters, draw cards, and win with a flier or a big creature brought back early. Psychic Frog discards for counters, which also puts targets in the graveyard for Persist.',
      cards: ['Psychic Frog', 'Thief of Sanity', 'Persist', 'Archon of Cruelty', 'Damnation'],
      pickEarly: 'Cheap removal and card advantage first, Psychic Frog and Thief of Sanity once you are in the pair.',
      traps: 'Persist can’t return a legendary creature, so it can’t bring back Griselbrand; Archon of Cruelty and Grief are the targets. A control deck needs enough removal before it needs a finisher.',
      curve: 'Removal at one and two mana, then a top end of five- to eight-drops. 17 lands.',
      lab: { colors: 'UB' },
    },
    {
      id: 'BR',
      colors: 'BR',
      name: 'Rakdos aggro',
      plan: 'Cheap creatures that come back (Bloodghast, Bloodsoaked Champion), burn, and removal that trades up. Kolaghan’s Command is often two cards in one. Win early, and finish with burn when the board stalls.',
      cards: ["Kolaghan's Command", 'Terminate', 'Ragavan, Nimble Pilferer', 'Bloodghast', 'Lightning Bolt'],
      pickEarly: 'Ragavan and the burn and removal, then the two gold cards.',
      traps: 'Running out of gas against a deck that stabilises: Bloodghast and Bloodsoaked Champion can’t block. Keep a few cards that draw or grind (Fable of the Mirror-Breaker, Kolaghan’s Command).',
      curve: 'Low: eight or more one- and two-drops. 16 lands.',
      lab: { colors: 'BR' },
    },
    {
      id: 'RG',
      colors: 'RG',
      name: 'Gruul ramp',
      plan: 'Mana creatures into four-drops a turn early, then big threats. Minsc & Boo grows a trample or haste creature and can fling it; Bloodbraid Elf cascades into a free cheaper spell.',
      cards: ['Minsc & Boo, Timeless Heroes', 'Bloodbraid Elf', 'Llanowar Elves', 'Glorybringer', 'Inferno Titan'],
      pickEarly: 'Minsc & Boo, then the mana creatures (Llanowar Elves, Elvish Mystic, Noble Hierarch, Birds of Paradise) and the big red threats.',
      traps: 'Too many mana creatures and too few things to ramp into. Cascade hits a random cheaper spell, so Bloodbraid Elf is worse in a deck full of one-mana elves.',
      curve: 'Mana creatures at one, the payoffs at four to six. 16 lands with three or more mana creatures, else 17.',
      lab: { colors: 'RG' },
    },
    {
      id: 'GW',
      colors: 'WG',
      name: 'Selesnya creatures',
      plan: 'Efficient creatures that are hard to trade with, growing every turn (Luminarch Aspirant, Knight of the Reliquary). Collected Company puts two of them into play at instant speed.',
      cards: ['Voice of Resurgence', 'Knight of the Reliquary', 'Luminarch Aspirant', 'Collected Company', 'Tarmogoyf'],
      pickEarly: 'Good two- and three-drop creatures; the removal is white’s (Swords, Path, Prismatic Ending, March of Otherworldly Light).',
      traps: 'Collected Company only finds creatures with mana value 3 or less: it wants about fifteen of them. The deck is light on card draw, so don’t trade creatures away for nothing.',
      curve: 'Many two- and three-drops, a few four-plus. 16–17 lands.',
      lab: { colors: 'WG' },
    },
    {
      id: 'WB',
      colors: 'WB',
      name: 'Orzhov tokens and attrition',
      plan: 'Hand attack, removal, and token makers that are card advantage on their own. Lingering Souls is four fliers from one card; Elspeth, Sun’s Champion makes three soldiers a turn.',
      cards: ['Lingering Souls', 'Tidehollow Sculler', "Elspeth, Sun's Champion", 'Thoughtseize', 'Kitesail Freebooter'],
      pickEarly: 'Removal from both colours, Elspeth and Lingering Souls.',
      traps: 'Discard is best early and weak late: don’t take a fourth discard effect over a threat.',
      curve: 'Two- and three-drops, removal everywhere, one or two six-drops. 16–17 lands.',
      lab: { colors: 'WB' },
    },
    {
      id: 'UR',
      colors: 'UR',
      name: 'Izzet spells',
      plan: 'Cantrips and burn feed creatures that grow from spells (Dragon’s Rage Channeler, Young Pyromancer) and cheap delve threats (Murktide Regent). Win fast and protect the lead with counters.',
      cards: ['Expressive Iteration', 'Prismari Command', 'Murktide Regent', "Dragon's Rage Channeler", 'Young Pyromancer'],
      pickEarly: 'Burn and the cheap threats; cantrips come late.',
      traps: 'Tolarian Terror gets cheaper for each instant and sorcery in your graveyard, and Murktide Regent gets bigger for each one it exiles, so count your spells: about twelve or more.',
      curve: 'Very low: one- and two-drops and cheap spells. 16 lands.',
      lab: { colors: 'UR' },
    },
    {
      id: 'BG',
      colors: 'BG',
      name: 'Golgari midrange',
      plan: 'Trade one-for-one with removal and discard, then win with threats that outsize everything (Tarmogoyf) or grind (Grist, Liliana of the Veil).',
      cards: ['Grist, the Hunger Tide', 'Abrupt Decay', 'Liliana of the Veil', 'Tarmogoyf', 'Scavenging Ooze'],
      pickEarly: 'Removal from both colours and the planeswalkers.',
      traps: 'Abrupt Decay only hits mana value 3 or less. Liliana’s +1 makes you discard too, so she is best with a nearly empty hand.',
      curve: 'Two- to four-drops, few above five. 17 lands.',
      lab: { colors: 'BG' },
    },
    {
      id: 'RW',
      colors: 'WR',
      name: 'Boros aggro and equipment',
      plan: 'One- and two-drops, equipment to push damage through, burn to finish. Stoneforge Mystic finds Batterskull or Sword of Fire and Ice.',
      cards: ['Lightning Helix', 'Ajani Vengeant', 'Stoneforge Mystic', 'Goblin Guide', 'Batterskull'],
      pickEarly: 'Cheap creatures and burn, then equipment once you have Stoneforge.',
      traps: 'Equipment with too few creatures to carry it. Ajani Vengeant’s −2 is a Lightning Helix; its +1 only freezes one permanent.',
      curve: 'Low: eight or more one- and two-drops. 16 lands.',
      lab: { colors: 'WR' },
    },
    {
      id: 'GU',
      colors: 'UG',
      name: 'Simic ramp and value',
      plan: 'Ramp a turn ahead, then card-advantage engines. Oko makes Food and turns the opponent’s best creature into a vanilla 3/3 Elk; Uro draws, gains life and puts a land into play, then escapes from the graveyard as a 6/6.',
      cards: ['Oko, Thief of Crowns', "Uro, Titan of Nature's Wrath", 'Tireless Tracker', 'Noble Hierarch', 'Lotus Cobra'],
      pickEarly: 'Oko and Uro, then the mana creatures and card advantage.',
      traps: 'Uro’s escape needs five other cards in your graveyard; until then it is a three-mana ramp spell that draws a card.',
      curve: 'Mana creatures at one and two, engines at three and four. 16–17 lands.',
      lab: { colors: 'UG' },
    },
  ],
  principles: {
    valuing: [
      'Bombs first: this cube has real ones (Sheoldred, Ragavan, Jace, Oko, The One Ring, Craterhoof). Early in the draft, a bomb beats a removal spell.',
      'Removal next, and plenty of it: the bombs have to be answered, and you can’t count on seeing the cheap answers again.',
      'Fixing: the ten shocklands are the real duals. A Pathway makes one colour or the other (you choose a face), so it doesn’t help a splash. Birds of Paradise and Noble Hierarch also fix.',
      'Synergy pieces are light: the archetypes are colour pairs, and good cards fit into them. Take the gold signposts once you know the pair.',
    ],
    formats: {
      grid: FORMATS.grid,
      winston: `${FORMATS.winston} This cube was designed for Winston and Grid; with Winston, a pile with a bomb in it is almost always worth taking.`,
      booster: FORMATS.booster,
    },
    splash:
      'Splash only a removal spell or a bomb with one coloured pip, and only with three sources (shocklands, Birds of Paradise, Noble Hierarch). Pathways don’t count: each one is a single colour.',
  },
  forge: {
    points: [
      ...FORGE_COMMON,
      'Embercleave and Adanto Vanguard are flagged here, so a Boros deck in the AI’s hands is weaker than its card list. Take them yourself.',
      'Flash creatures (Spell Queller, Restoration Angel, Brazen Borrower, Vendilion Clique) are worth a little more against the AI than against a person.',
    ],
    flagged: {
      all: ['Adanto Vanguard', 'Prismatic Ending', 'Embercleave', 'Beast Within'],
      random: ['Loran of the Third Path', 'Eidolon of the Great Revel'],
    },
  },
};
