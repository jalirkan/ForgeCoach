/*
 * ForgeCoach — cube/guides/pauper.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * How to draft the two-player Pauper Cube (public/cubes/pauper-cube-180.md).
 */
import { FORGE_COMMON, FORMATS } from './common.ts';
import type { CubeGuide } from './types.ts';

export const PAUPER_GUIDE: CubeGuide = {
  cubeId: 'pauper',
  docTitle: /pauper cube/i,
  teaser: 'All commons, so card advantage wins: value creatures, fliers and the monarch, not bombs.',
  summary:
    'All commons, and the slowest, grindiest cube here. There are no bombs; games are decided by creature combat and card advantage: creatures that draw or bounce when they enter, fliers, the monarch (Palace Sentinels, Thorn of the Black Rose) and two-for-ones. Removal is plentiful in every colour, with Crypt Rats the only sweeper. Eight two-colour lanes each have two gold signposts; the mana is gain lands, bounce lands, Evolving Wilds and Ash Barrens.',
  archetypes: [
    {
      id: 'WU-blink',
      colors: 'WU',
      name: 'Azorius skies and blink',
      plan: 'Fliers with enter-the-battlefield value. Kor Skyfisher and Silver Drake return a creature you control to your hand, so you replay Mulldrifter, Man-o’-War or Inspiring Overseer for value. Ephemerate and Momentary Blink do the same at instant speed. Win in the air.',
      cards: ['Kor Skyfisher', 'Silver Drake', 'Judge\'s Familiar', 'Mulldrifter', 'Ephemerate'],
      pickEarly: 'Ephemerate, Kor Skyfisher and the ETB creatures that draw (Mulldrifter, Inspiring Overseer).',
      traps: 'Silver Drake must return a white or blue creature, itself if you have nothing better. Too many bounce creatures and not enough worth re-buying.',
      curve: 'Two- to four-drops, a few fives (Mulldrifter can be evoked for three). 17 lands, bounce lands counting as one and a half.',
      lab: { colors: 'WU', themes: ['FLK'] },
    },
    {
      id: 'UB-ninjas',
      colors: 'UB',
      name: 'Dimir ninjas and control',
      plan: 'Cheap evasive creatures (Faerie Seer, Spellstutter Sprite, Delver, Vault Skirge) attack; once one is unblocked, ninjutsu swaps it for a Ninja that draws or makes the opponent discard. The returned creature comes back to replay its ETB. The control version adds counters, removal and Gray Merchant.',
      cards: ['Ninja of the Deep Hours', 'Moon-Circuit Hacker', 'Cavern Harpy', 'Dinrova Horror', 'Gray Merchant of Asphodel'],
      pickEarly: 'Ninja of the Deep Hours, Snuff Out, Counterspell, then cheap fliers.',
      traps: 'Ninjas need unblocked attackers: without seven or eight cheap evasive creatures they are overpriced. Gray Merchant drains for your devotion to black, so it wants a mostly black deck.',
      curve: 'Many one- and two-drop fliers, ninjas at two to five. 16–17 lands.',
      lab: { colors: 'UB' },
    },
    {
      id: 'BR-sac',
      colors: 'BR',
      name: 'Rakdos sacrifice',
      plan: 'Creatures that leave something behind when they die (Carrier Thrall, Nested Shambler, Mogg War Marshal) plus outlets (Village Rites, Fling, Body Dropper) plus payoffs that drain or deal damage (Falkenrath Noble, Fireblade Artist). Crypt Rats resets the board when you are behind.',
      cards: ['Body Dropper', 'Fireblade Artist', 'Carrier Thrall', 'Village Rites', 'Falkenrath Noble'],
      pickEarly: 'Falkenrath Noble, the two gold cards and the cheap removal.',
      traps: 'Outlets without fodder, or fodder without payoffs. Crypt Rats hits your own creatures and you too.',
      curve: 'Low: lots of one- and two-drops, payoffs at three and four. 16–17 lands.',
      lab: { colors: 'BR', themes: ['SAC'] },
    },
    {
      id: 'RG-ramp',
      colors: 'RG',
      name: 'Gruul ramp',
      plan: 'Mana creatures and Eldrazi Spawn into big threats (Ulamog’s Crusher, Krosan Tusker, Annoyed Altisaur), with Fireball and Rolling Thunder as finishers that scale with your mana.',
      cards: ['Writhing Chrysalis', 'Branching Bolt', 'Llanowar Elves', "Ulamog's Crusher", 'Rolling Thunder'],
      pickEarly: 'The gold cards, Rolling Thunder and Fireball, then mana creatures.',
      traps: 'Arbor Elf only untaps a Forest. Ulamog’s Crusher costs eight and must attack every combat. Too much ramp and too few payoffs.',
      curve: 'Ramp at one to three, payoffs at six to eight. 16 lands with elves, else 17.',
      lab: { colors: 'RG' },
    },
    {
      id: 'GW-tokens',
      colors: 'WG',
      name: 'Selesnya tokens',
      plan: 'Go wide with Battle Screech, Triplicate Spirits, Sprout Swarm and Saproling Migration, then cash in with Rally the Peasants or Eagles of the North. Prismatic Strands wins a combat on its own.',
      cards: ['Selesnya Evangel', 'Qasali Pridemage', 'Battle Screech', 'Rally the Peasants', 'Prismatic Strands'],
      pickEarly: 'Battle Screech and Prismatic Strands, then the token makers.',
      traps: 'Battle Screech’s flashback taps three white creatures: the two birds plus one more. Lots of 1/1s with no way to make them bigger just get blocked.',
      curve: 'Two- to four-drops, some token spells at five or six (convoke helps). 17 lands.',
      lab: { colors: 'WG', themes: ['TOK'] },
    },
    {
      id: 'UR-spells',
      colors: 'UR',
      name: 'Izzet spells',
      plan: 'Cheap cantrips and burn trigger Swiftspear, Guttersnipe, Firebrand Archer and Murmuring Mystic, and make Tolarian Terror cheap. Bloodwater Entity and Ardent Elementalist give spells back.',
      cards: ['Izzet Charm', 'Bloodwater Entity', 'Guttersnipe', 'Delver of Secrets', 'Tolarian Terror'],
      pickEarly: 'Burn (Lightning Bolt, Chain Lightning) and the payoffs; cantrips come late.',
      traps: 'Too few instants and sorceries: about twelve or more, or the payoffs are just small bodies.',
      curve: 'Very low: payoffs at one to three, spells at one and two. 16 lands.',
      lab: { colors: 'UR', themes: ['SPL'] },
    },
    {
      id: 'BG-graveyard',
      colors: 'BG',
      name: 'Golgari graveyard',
      plan: 'Fill the graveyard (Mire Triton, Satyr Wayfinder, Glowspore Shaman), reuse it (Gravedigger, Desecrator Hag, Unearth, Tortured Existence) and turn it into cheap fat bodies (Gurmag Angler). A slow value deck that wins the long game.',
      cards: ['Glowspore Shaman', 'Desecrator Hag', 'Tortured Existence', 'Gurmag Angler', 'Mire Triton'],
      pickEarly: 'Tortured Existence, Gravedigger and removal.',
      traps: 'Delve and recursion fight over the same graveyard. Unearth only returns mana value 3 or less.',
      curve: 'Two- and three-drops, a few big bodies. 17 lands.',
      lab: { colors: 'BG', themes: ['GY'] },
    },
    {
      id: 'RW-aggro',
      colors: 'WR',
      name: 'Boros aggro and equipment',
      plan: 'Cheap attackers, equipment and tricks. Seeker of the Way grows with every noncreature spell you cast, Tenth District Legionnaire with every spell that targets it; Bonesplitter and Ancestral Blade push damage through; Goblin Bushwhacker or Rally the Peasants ends it.',
      cards: ['Tenth District Legionnaire', 'Dog Walker', 'Seeker of the Way', 'Rimrock Knight', 'Bonesplitter'],
      pickEarly: 'Bonesplitter, burn and the best two-drops.',
      traps: 'Running out of cards against a deck with blockers and life gain. Rimrock Knight can’t block.',
      curve: 'Very low: ten or more one- and two-drops. 16 lands.',
      lab: { colors: 'WR', themes: ['AGG'] },
    },
  ],
  principles: {
    valuing: [
      'Card advantage is what’s scarce: Mulldrifter, Gray Merchant, the monarch, and creatures that draw or return something when they enter. Value them above a fourth removal spell.',
      'Removal is plentiful (29 spells), but the best ones go early: Snuff Out, Journey to Nowhere, Lightning Bolt, Chain Lightning.',
      'The strongest commons are Prismatic Strands, Snuff Out, Ephemerate, Spellstutter Sprite and Tortured Existence; take them early.',
      'Fixing comes late: gain lands and bounce lands rarely make a pick hard. A bounce land is worth about one and a half lands.',
      'Synergy matters more here than in the other cubes: Ninjas without evasive creatures, or Rally without tokens, are weak cards.',
    ],
    formats: {
      grid: FORMATS.grid,
      winston: FORMATS.winston,
      booster: FORMATS.booster,
    },
    splash:
      'A gain land for every pair, Evolving Wilds and Ash Barrens make a light splash possible: one or two removal spells with three sources. Bounce lands only make their own two colours.',
  },
  forge: {
    points: [
      ...FORGE_COMMON,
      'Here the flags fall on the blink and token decks’ best cards (Ghostly Flicker, Prismatic Strands, Prophetic Prism) and on Rakdos (Fireblade Artist, Bogardan Dragonheart). If the lab numbers for Azorius blink look poor, part of that is the pilot.',
      'Tortured Existence is flagged too, so Golgari in the AI’s hands is mostly fair creatures. In yours, it is the engine.',
    ],
    flagged: {
      all: ['Prismatic Strands', 'Ghostly Flicker', 'Tortured Existence', 'Bogardan Dragonheart', 'Faithless Looting', 'Utopia Sprawl', 'Fireblade Artist', 'Prophetic Prism', 'Chromatic Star'],
      random: ['Plagued Rusalka', 'Kuldotha Rebirth', 'Fling', 'Ichor Wellspring'],
    },
  },
};
