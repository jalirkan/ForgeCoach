/*
 * ForgeCoach — cube/guides/vintage.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * How to draft the two-player Vintage Cube (public/cubes/vintage-cube-180.md).
 */
import { FORGE_COMMON, FORMATS } from './common.ts';
import type { CubeGuide } from './types.ts';

export const VINTAGE_GUIDE: CubeGuide = {
  cubeId: 'vintage',
  docTitle: /vintage cube/i,
  teaser: 'Power, Moxen and cheat decks: decide early whether you are the one cheating or the one holding the counterspell.',
  summary:
    'The fastest and most powerful cube here. Black Lotus, the Moxen, Sol Ring, Ancestral Recall and Time Walk are in, and four decks put huge creatures into play without casting them (Reanimate, Sneak Attack, Show and Tell, Tinker, Natural Order). Games can be decided on turn two or three, but every cheat needs two or three pieces and loses to one well-timed answer: Force of Will, Thoughtseize, Swords to Plowshares, Containment Priest. The other four decks are fair and fast, and they are the cheat drafter’s natural foil.',
  archetypes: [
    {
      id: 'W-aggro',
      colors: 'WR',
      also: 'B',
      name: 'White aggro and equipment',
      plan: 'One-drops, Stoneforge Mystic for an equipment, and burn to finish. Stoneforge can put Batterskull or Kaldra Compleat into play for {1}{W}. Fast pressure is the best answer to the cheat decks: every turn they spend setting up is damage taken.',
      cards: ['Stoneforge Mystic', "Umezawa's Jitte", 'Mother of Runes', 'Lightning Helix', "Phlage, Titan of Fire's Fury"],
      pickEarly: 'Stoneforge Mystic, Jitte, Swords to Plowshares and the cheap white creatures (Mother of Runes, Thalia, Adeline, Ocelot Pride).',
      traps: 'Batterskull and Kaldra Compleat are slow without Stoneforge; one big equipment is enough. Don’t take a fourth equipment over a two-drop.',
      curve: 'Very low: eight or more one- and two-drops. 16 lands, 15 with two or more Moxen, Lotus or Sol Ring.',
      lab: { colors: 'W', themes: ['AGG'] },
    },
    {
      id: 'UR-tempo',
      colors: 'UR',
      name: 'Izzet tempo',
      plan: 'Cheap threats and cantrips: get ahead early, then protect the lead with Force of Will, Counterspell and Memory Lapse and burn whatever slips through.',
      cards: ['Expressive Iteration', 'Third Path Iconoclast', 'Delver of Secrets', "Dragon's Rage Channeler", 'Lightning Bolt'],
      pickEarly: 'Burn, counters and the one-mana threats (Delver, Dragon’s Rage Channeler, Swiftspear, Ragavan).',
      traps: 'Delver of Secrets only flips when the top card is an instant or sorcery: it wants a deck of mostly spells. Too few threats, and the counters just trade.',
      curve: 'Very low. 16 lands, 15 with fast mana.',
      lab: { colors: 'UR', themes: ['SPL'] },
    },
    {
      id: 'B-reanimator',
      colors: 'UB',
      also: 'RW',
      name: 'Reanimator',
      plan: 'Put a huge creature in your graveyard (Entomb, Faithless Looting, Frantic Search, Psychic Frog) and bring it back on turn one to three with Reanimate, Animate Dead, Necromancy or Exhume. Griselbrand and Archon of Cruelty are the best targets.',
      cards: ['Entomb', 'Reanimate', 'Animate Dead', 'Griselbrand', 'Archon of Cruelty'],
      pickEarly: 'The enablers: Entomb and the reanimation spells are scarce, the big creatures come later (and the Sneak Attack drafter wants them too).',
      traps: 'Emrakul can’t be reanimated: when it hits the graveyard its owner shuffles the graveyard into the library. Exhume gives the opponent a creature too. Reanimate costs life equal to the creature’s mana value (8 for Griselbrand).',
      curve: 'Mostly one- and two-mana spells, three or four targets you never cast. 16 lands, 15 with fast mana.',
      lab: { colors: 'B', themes: ['REAN'] },
    },
    {
      id: 'UR-sneak',
      colors: 'UR',
      name: 'Sneak and Show',
      plan: 'Put a giant into play without casting it: Sneak Attack gives it haste for {R}, Show and Tell puts it straight onto the battlefield. Black Lotus, the Moxen and Ancient Tomb make it happen a turn or two early.',
      cards: ['Sneak Attack', 'Show and Tell', 'Emrakul, the Aeons Torn', 'Griselbrand', 'Ancient Tomb'],
      pickEarly: 'Sneak Attack and Show and Tell, then fast mana; the targets are shared with Reanimator.',
      traps: 'Show and Tell lets the opponent put a permanent from their hand into play too. A creature put in with Sneak Attack is sacrificed at end of turn, and Emrakul only gives an extra turn when it is cast.',
      curve: 'Cheap spells, fast mana and four or five fat creatures. 16 lands, 15 with fast mana.',
      lab: { colors: 'UR', themes: ['REAN'] },
    },
    {
      id: 'U-artifacts',
      colors: 'UR',
      also: 'W',
      name: 'Artifacts and Tinker',
      plan: 'Fast mana and cheap artifacts power out Urza and Kappa Cannoneer; Tinker sacrifices a spare artifact (a Mox will do) to put Wurmcoil Engine, Myr Battlesphere or Kaldra Compleat into play.',
      cards: ['Tinker', 'Urza, Lord High Artificer', 'Kappa Cannoneer', 'Wurmcoil Engine', 'Myr Battlesphere'],
      pickEarly: 'Tinker, Sol Ring and Black Lotus, then the payoffs.',
      traps: 'Tinker with no artifact to sacrifice, or with nothing big in the deck to find. Two or three Tinker targets is plenty.',
      curve: 'Many zero- to two-mana artifacts, three or four big ones. 16 lands, 15 with three or more fast-mana artifacts.',
      lab: { colors: 'U', themes: ['ART'] },
    },
    {
      id: 'WU-control',
      colors: 'WU',
      also: 'B',
      name: 'Control',
      plan: 'Counter the cheat spells, sweep the fair creatures, and win with planeswalkers. Mana Drain turns a countered spell into mana for your next main phase.',
      cards: ['Force of Will', 'Mana Drain', 'Jace, the Mind Sculptor', 'Teferi, Time Raveler', 'Teferi, Hero of Dominaria'],
      pickEarly: 'Force of Will, Mana Drain, Counterspell, and Jace.',
      traps: 'Balance is symmetrical: it hurts you as much as the opponent unless you build with few lands and creatures. Too many counters and no win condition.',
      curve: 'Interaction at one to three mana, planeswalkers at three to five. 17 lands.',
      lab: { colors: 'WU', themes: ['CTRL'] },
    },
    {
      id: 'G-ramp',
      colors: 'G',
      also: 'RUB',
      name: 'Lands and ramp',
      plan: 'Mana creatures and fetchlands into big green threats. Natural Order and Green Sun’s Zenith fetch the right one; Titania and Avenger of Zendikar turn fetchlands into an army.',
      cards: ['Wrenn and Six', 'Natural Order', 'Craterhoof Behemoth', 'Titania, Protector of Argoth', 'Primeval Titan'],
      pickEarly: 'Natural Order and the mana creatures (Llanowar Elves, Birds of Paradise, Delighted Halfling), then fetchlands.',
      traps: 'Natural Order sacrifices a green creature and finds only a green one, so it can’t get Emrakul. Craterhoof needs a board to matter.',
      curve: 'Mana creatures at one and two, payoffs at five to eight. 16 lands with four or more mana creatures, else 17.',
      lab: { colors: 'G', themes: ['LND', 'RAMP', 'FAT'] },
    },
    {
      id: 'BR-sac',
      colors: 'BR',
      also: 'W',
      name: 'Sacrifice midrange',
      plan: 'Recursive and token-making creatures (Bloodghast, Young Pyromancer, Fable of the Mirror-Breaker, Lingering Souls) fed to Goblin Bombardment and Skullclamp. Grinds out the fair decks and has the discard and removal to slow the cheat decks.',
      cards: ['Goblin Bombardment', 'Skullclamp', 'Bloodghast', "Kolaghan's Command", 'Bloodtithe Harvester'],
      pickEarly: 'Skullclamp and Goblin Bombardment, then removal and the token makers.',
      traps: 'Skullclamp on a creature with 1 toughness kills it and draws two; on anything bigger it’s just +1/−1. Too many engines and no pressure.',
      curve: 'Low: lots of two-drops. 16 lands.',
      lab: { colors: 'BR', themes: ['SAC'] },
    },
  ],
  principles: {
    valuing: [
      'Power and fast mana: Black Lotus and Sol Ring go in any deck; each Mox is filed under its colour, so take the one for your colour. Ancestral Recall and Time Walk are blue’s best cards.',
      'Cheap interaction is the glue. Every cheat plan loses to one Force of Will, Thoughtseize or Swords to Plowshares, so a fair deck should take them high, and a cheat deck should take a few to protect itself.',
      'Enablers before targets: Entomb, Reanimate, Sneak Attack, Show and Tell and Tinker are scarce; Griselbrand, Archon of Cruelty and Emrakul come later, and both cheat decks share them.',
      'Fixing: the ten original duals and ten fetchlands. Each fetchland finds seven of the ten duals, so a fetch in your colours is nearly a dual.',
      'Hosers (Containment Priest, Endurance, Scavenging Ooze, Pyrokinesis) are for games two and three: pick them late, but pick them.',
    ],
    formats: {
      grid: `${FORMATS.grid} You also see which cheat plan the AI is drafting toward, and can take its key enabler.`,
      winston: `${FORMATS.winston} Take the cheat enablers early: they are the scarce half of each combo.`,
      booster: FORMATS.booster,
    },
    splash:
      'Duals and fetchlands make a splash easy. Splash a removal spell or a one-pip bomb; don’t splash half a combo.',
  },
  forge: {
    points: [
      ...FORGE_COMMON,
      'Here the cheat decks lean on flagged cards (Tinker, Sneak Attack, Survival of the Fittest, Faithless Looting, Goblin Welder). The AI stumbles with them, so they rarely beat you from its side, and they are yours to take.',
      'Goblin Bombardment is flagged too: the AI’s sacrifice deck is weaker than it looks, yours isn’t.',
    ],
    flagged: {
      all: ['Mystic Confluence', 'Toxic Deluge', 'Faithless Looting', 'Goblin Welder', 'Goblin Bombardment', 'Sylvan Library', 'Beast Within', "Mishra's Bauble"],
      random: ['Loran of the Third Path', 'Frantic Search', 'Tinker', 'Demonic Tutor', 'Sneak Attack', 'Survival of the Fittest', 'Ancient Tomb'],
    },
  },
};
