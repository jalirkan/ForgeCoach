/*
 * ForgeCoach — cube/guides/fairFight.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * How to draft the Fair Fight Cube (public/cubes/fair-fight-cube-180.md):
 * the Pauper Cube's skeleton at every rarity, under eight flat-power rules.
 */
import { FORGE_COMMON, FORMATS } from './common.ts';
import type { CubeGuide } from './types.ts';

export const FAIR_FIGHT_GUIDE: CubeGuide = {
  cubeId: 'fair-fight',
  docTitle: /fair fight cube/i,
  teaser: 'Every rarity, Pauper’s low ceiling: no bombs, removal everywhere, games won by combat and two-for-ones.',
  summary:
    'The Pauper Cube’s eight lanes with the rarity limit lifted, under explicit flat-power rules: no single card wins a game, every threat has an answer, no combos or fast mana, and card advantage comes in two-for-ones. Rares are here for texture: removal on a body (Skyclave Apparition, Bonecrusher Giant, Murderous Rider), build-arounds and creature lands. The five planeswalkers have no plus ability, so they run out like enchantments. Every dual enters tapped.',
  archetypes: [
    {
      id: 'WU-blink',
      colors: 'WU',
      name: 'Azorius blink-skies',
      plan: 'Fliers and creatures with enter-the-battlefield value, reused. Kor Skyfisher returns a creature to replay it; Flickerwisp, Charming Prince, Restoration Angel, Ephemerate and Momentary Blink blink one; Soulherder blinks one every end step and grows. Reflector Mage and Man-o’-War buy the tempo, and you win in the air.',
      cards: ['Reflector Mage', 'Soulherder', 'Kor Skyfisher', 'Restoration Angel', 'Mulldrifter'],
      pickEarly: 'Skyclave Apparition, Reflector Mage, Restoration Angel, then the ETB creatures that draw (Mulldrifter, Inspiring Overseer).',
      traps: 'Too many blink effects and too few creatures worth blinking. Kor Skyfisher must return a permanent, so play it with something to re-buy.',
      curve: 'Two- to four-drops, Mulldrifter at five (or evoked for three). 17 lands.',
      lab: { colors: 'WU', themes: ['FLK'] },
    },
    {
      id: 'UB-ninjas',
      colors: 'UB',
      name: 'Dimir ninjas and control',
      plan: 'Cheap evasive creatures (Faerie Seer, Spellstutter Sprite, Spectral Sailor, Kitesail Freebooter, Baleful Strix) connect, then ninjutsu swaps one for a Ninja that draws or makes the opponent discard, and the returned creature replays its ETB. The control build adds counters, Ertai Resurrected, Chupacabra and Gray Merchant.',
      cards: ['Baleful Strix', 'Ertai Resurrected', 'Ninja of the Deep Hours', 'Moon-Circuit Hacker', 'Counterspell'],
      pickEarly: 'Baleful Strix, Ertai, Counterspell and black removal, then cheap fliers.',
      traps: 'Ninjas need unblocked attackers: without seven or eight cheap evasive creatures they are overpriced. Gray Merchant wants a mostly black deck.',
      curve: 'Many one- and two-drop fliers, ninjas at two to five. 16–17 lands.',
      lab: { colors: 'UB' },
    },
    {
      id: 'BR-sac',
      colors: 'BR',
      name: 'Rakdos sacrifice',
      plan: 'Fodder that leaves something behind (Carrier Thrall, Nested Shambler, Mogg War Marshal, Bloodghast, Woe Strider’s Goat, Tibalt’s Devils), outlets (Village Rites, Woe Strider, Siege-Gang Commander, Fling) and payoffs that deal damage on every death (Mayhem Devil, Falkenrath Noble). Crypt Rats resets the board.',
      cards: ['Mayhem Devil', 'Bloodtithe Harvester', 'Bloodghast', 'Siege-Gang Commander', 'Village Rites'],
      pickEarly: 'Mayhem Devil, Bloodtithe Harvester and the cheap removal.',
      traps: 'Outlets without fodder, or fodder without payoffs. Crypt Rats hits your own creatures and you too. Bloodghast can’t block.',
      curve: 'Low: lots of one- and two-drops, payoffs at three and four, Siege-Gang at five. 16–17 lands.',
      lab: { colors: 'BR', themes: ['SAC'] },
    },
    {
      id: 'RG-ramp',
      colors: 'RG',
      name: 'Gruul ramp',
      plan: 'Mana creatures, Sakura-Tribe Elder and Eldrazi Spawn into Thragtusk, Krosan Tusker and Annoyed Altisaur, with Branching Bolt, Fireball and Rolling Thunder as removal that scales with your mana.',
      cards: ['Writhing Chrysalis', 'Branching Bolt', 'Llanowar Elves', 'Thragtusk', 'Rolling Thunder'],
      pickEarly: 'The gold cards, Fireball and Rolling Thunder, Thragtusk, then mana creatures.',
      traps: 'Too much ramp and too few payoffs. The big creatures have no evasion, so they need removal or trample to get through.',
      curve: 'Ramp at one to three, payoffs at five to seven. 16 lands with two or more mana creatures, else 17.',
      lab: { colors: 'RG' },
    },
    {
      id: 'GW-tokens',
      colors: 'WG',
      name: 'Selesnya tokens',
      plan: 'Go wide with Battle Screech, Secure the Wastes, Saproling Migration, Attended Knight and Lovestruck Beast, then cash in with Trostani Discordant, Rally the Peasants or Unbreakable Formation.',
      cards: ['Trostani Discordant', 'Qasali Pridemage', 'Battle Screech', 'Secure the Wastes', 'Rally the Peasants'],
      pickEarly: 'Trostani, Battle Screech and the token makers; Unbreakable Formation protects the board from Sweltering Suns and Crypt Rats.',
      traps: 'Battle Screech’s flashback taps three white creatures. Lots of 1/1s with no anthem or pump just get blocked.',
      curve: 'Two- to four-drops, Trostani at five, Secure the Wastes at whatever you have. 17 lands.',
      lab: { colors: 'WG', themes: ['TOK'] },
    },
    {
      id: 'UR-spells',
      colors: 'UR',
      name: 'Izzet spells',
      plan: 'Cheap cantrips and burn trigger Swiftspear, Young Pyromancer, Guttersnipe, Ledger Shredder and Saheeli, and make Tolarian Terror cheap. Thing in the Ice flips to bounce the board; Snapcaster Mage and Archaeomancer give spells back.',
      cards: ['Saheeli, Sublime Artificer', 'Fire // Ice', 'Young Pyromancer', 'Thing in the Ice', 'Snapcaster Mage'],
      pickEarly: 'Burn (Lightning Bolt, Chain Lightning, Fire // Ice) and the payoffs; cantrips come late.',
      traps: 'Too few instants and sorceries: about twelve or more, or the payoffs are small bodies. Thing in the Ice bounces your own creatures too.',
      curve: 'Very low: payoffs at one to three, spells at one and two. 16 lands.',
      lab: { colors: 'UR', themes: ['SPL'] },
    },
    {
      id: 'BG-graveyard',
      colors: 'BG',
      name: 'Golgari graveyard',
      plan: 'Fill the graveyard (Mire Triton, Satyr Wayfinder, Grim Flayer, Grapple with the Past), reuse it (Gravedigger, Eternal Witness, Unearth, Pulse of Murasa, Woe Strider) and turn it into cheap big bodies (Gurmag Angler). Vraska’s deathtouch Assassins hold the ground while you grind.',
      cards: ["Vraska, Swarm's Eminence", 'Grim Flayer', 'Eternal Witness', 'Gurmag Angler', 'Mire Triton'],
      pickEarly: 'Removal, Eternal Witness, Scavenging Ooze and the two gold cards.',
      traps: 'Delve, Scavenging Ooze and recursion all eat the same graveyard. Unearth only returns mana value 3 or less.',
      curve: 'Two- and three-drops, a few big bodies. 17 lands.',
      lab: { colors: 'BG', themes: ['GY'] },
    },
    {
      id: 'RW-aggro',
      colors: 'WR',
      name: 'Boros aggro and equipment',
      plan: 'Cheap attackers, equipment and burn. Nahiri gives your team first strike on your turn and makes equipping cheap; Fervent Champion equips for {3} less; Stoneforge Mystic finds Shadowspear or Bonesplitter. Hellrider or Rally the Peasants ends it.',
      cards: ['Nahiri, Storm of Stone', 'Lightning Helix', 'Fervent Champion', 'Stoneforge Mystic', 'Bonesplitter'],
      pickEarly: 'Bonesplitter, burn, Kari Zev and the best two-drops.',
      traps: 'Running out of cards against blockers and life gain. Rimrock Knight can’t block, and the duals enter tapped, so keep the curve low.',
      curve: 'Very low: ten or more one- and two-drops. 16 lands.',
      lab: { colors: 'WR', themes: ['AGG'] },
    },
  ],
  principles: {
    valuing: [
      'Removal is plentiful in every colour, so value two-for-ones above a fourth kill spell: Skyclave Apparition, Bonecrusher Giant, Murderous Rider, Flametongue Kavu, Chupacabra, Mulldrifter.',
      'There are no bombs to take first. The strongest cards are flexible ones: Swords to Plowshares, Lightning Bolt, Fire // Ice, Ertai Resurrected, Restoration Angel, Snapcaster Mage.',
      'The gold signposts tell you a lane is open, but only take them early when they are also good cards (Mayhem Devil, Baleful Strix, Reflector Mage, Lightning Helix).',
      'Fixing comes late: every dual enters tapped. The Restless lands are also threats in a long game, so they are worth a mid pick in your colours.',
      'The planeswalkers are value enchantments, not bombs: pick them for the lane they serve.',
    ],
    formats: {
      grid: FORMATS.grid,
      winston: FORMATS.winston,
      booster: FORMATS.booster,
    },
    splash:
      'A Restless land for every colour pair, a gain land for every archetype, Evolving Wilds and Ash Barrens make a light splash possible: one or two removal spells with three sources. Jewel Thief and Deadly Dispute make Treasure too.',
  },
  forge: {
    points: [
      ...FORGE_COMMON,
      'Here only three cards are flagged, all Random (left out of random AI decks): Bomat Courier, Soulherder and Fling. The AI plays them when it drafts them.',
      'The archetypes here are design intent; the lab’s Forge-vs-Forge numbers for each appear beside it.',
    ],
    flagged: {
      all: [],
      random: ['Bomat Courier', 'Soulherder', 'Fling'],
    },
  },
};
