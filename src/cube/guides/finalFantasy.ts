/*
 * ForgeCoach — cube/guides/finalFantasy.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * How to draft the Final Fantasy Cube (public/cubes/final-fantasy-cube-180.md): 180 cards
 * from the Final Fantasy release, picked with 17Lands' Premier Draft data, built around the
 * set's own ten two-colour archetypes.
 */
import { FORGE_COMMON, FORMATS } from './common.ts';
import type { CubeGuide } from './types.ts';

export const FINAL_FANTASY_GUIDE: CubeGuide = {
  cubeId: 'final-fantasy',
  docTitle: /final fantasy cube/i,
  teaser: 'Summons, Job select heroes and Tiered magic: the Final Fantasy set’s ten guild decks at their best.',
  summary:
    'The best of the Final Fantasy release for two players. Its mechanics carry the games: Job select Equipment brings a 1/1 Hero to wear it, Summons are Saga creatures that do something every turn and then leave, Tiered spells grow with the mana you pay, and Towns are the dual lands. Each colour pair has a plan and two or three gold signposts. There is removal in every colour, a few big bombs at the top of the curve (Summon: Knights of Round, Ardyn, Summon: Bahamut), and two-colour mana: one tapped Town per pair.',
  archetypes: [
    {
      id: 'WU-artifacts',
      colors: 'WU',
      name: 'Azorius artifacts and Heroes',
      plan: 'Job select Equipment (Dragoon’s Lance, White Mage’s Staff, Paladin’s Arms) each make a Hero and an artifact at once. Cid gives artifact creatures and Heroes +1/+1 per Artificer, Tidus grows whenever an artifact enters and taps a blocker each attack, Gaelicat hits for three in the air with two artifacts, and Delivery Moogle finds a cheap artifact.',
      cards: ['Cid, Timeless Artificer', 'Tidus, Blitzball Star', "Dragoon's Lance", 'Gaelicat', 'Delivery Moogle'],
      pickEarly: 'The Job select Equipment and Smuggler’s Copter, then Cid and Tidus; removal like White Auracite and Eject.',
      traps: 'Counting artifacts that do nothing: an Equipment that never gets equipped is only its Hero. Tidus is a 2/1 until artifacts arrive, so play him after a few.',
      curve: 'Many one- and two-drops, Equipment at two and three. 16 lands.',
      lab: { colors: 'WU' },
    },
    {
      id: 'UB-control',
      colors: 'UB',
      name: 'Dimir surveil control',
      plan: 'Trade early, loot and surveil to the answers, and win late. Locke Cole (deathtouch, lifelink) blocks and loots, Emet-Selch loots on entering and attacking and later lets you play cards from your graveyard, Dreams of Laguna draws twice with flashback. Removal and counterspells cover the rest.',
      cards: ['Locke Cole', 'Emet-Selch, Unsundered', 'Dreams of Laguna', 'Il Mheg Pixie', 'Resentful Revelation'],
      pickEarly: 'Black removal (Fatal Push, Sephiroth’s Intervention, Overkill), Counterspell and card draw; the gold cards come late.',
      traps: 'Too few threats: a control deck still needs four or five creatures that win. Emet-Selch transforms only at fourteen cards in your graveyard, so treat that as a bonus.',
      curve: 'Interaction at one to three, card draw at four, a few finishers. 17 lands.',
      lab: { colors: 'UB' },
    },
    {
      id: 'BR-wizards',
      colors: 'BR',
      name: 'Rakdos Wizards and spells',
      plan: 'Black Wizard tokens deal 1 damage to the opponent whenever you cast a noncreature spell. Kuja makes one at each of your end steps and transforms with four Wizards, doubling their damage. Cornered by Black Mages and Circle of Power make Wizards too, Garland surveils on every spell, and the Tiered burn (Thunder Magic, Fire Magic) clears the way.',
      cards: ['Kuja, Genome Sorcerer', 'Garland, Knight of Cornelia', 'Cornered by Black Mages', 'Circle of Power', 'Thunder Magic'],
      pickEarly: 'Kuja, then cheap removal: every removal spell is also a Wizard ping.',
      traps: 'Too many creatures: the Wizards need noncreature spells to do anything. Aim for twelve or more instants and sorceries.',
      curve: 'Cheap spells and a few creatures, Kuja at four. 16 lands.',
      lab: { colors: 'BR' },
    },
    {
      id: 'RG-landfall',
      colors: 'RG',
      name: 'Gruul landfall',
      plan: 'Every land drop does something: Sazh’s Chocobo grows, Ride the Shoopuf puts a counter on a creature, Rydia loots, Gladiolus gives another creature +2/+2 and trample. Town Greeter and Summon: Fenrir find extra lands, and Chocobo Kick returns a land to replay it.',
      cards: ['Gladiolus Amicitia', 'Rydia, Summoner of Mist', "Sazh's Chocobo", 'Ride the Shoopuf'],
      pickEarly: 'Removal first (Choco-Comet, Lightning Bolt, Chocobo Kick), then the landfall creatures.',
      traps: 'Landfall cards are weak after the lands run out: keep a few big threats for the late game, and play 17 lands so the land drops keep coming.',
      curve: 'Landfall at one and two, threats at four to six. 17 lands.',
      lab: { colors: 'RG' },
    },
    {
      id: 'WG-summons',
      colors: 'WG',
      name: 'Selesnya Summons',
      plan: 'Summons are Saga creatures: each chapter does something, then they leave. Garnet removes lore counters when she attacks and grows, so Sagas stay and repeat their chapters; Clash of the Eikons fights and adds or removes a lore counter. Yuna gives enchantment creatures trample, lifelink and ward on your turn and returns an enchantment card from your graveyard each end step.',
      cards: ['Yuna, Hope of Spira', 'Garnet, Princess of Alexandria', 'Rinoa Heartilly', 'Summon: Fenrir', 'Summon: Ixion'],
      pickEarly: 'Yuna, Summon: Ixion and the best Summons (Fenrir, Titan), then white removal.',
      traps: 'A Summon leaves after its last chapter: count it as a spell that does several things, not a creature that stays. Yuna brings them back.',
      curve: 'Garnet at two, Summons at three to five, Yuna and Rinoa at five. 17 lands.',
      lab: { colors: 'WG' },
    },
    {
      id: 'WB-alone',
      colors: 'WB',
      name: 'Orzhov lone attackers',
      plan: 'Attack with one creature at a time: Squall gives a lone attacker double strike and returns a permanent card with mana value 3 or less from your graveyard when he connects. Rufus Shinra brings Darkstar, Dark Knight’s Greatsword gives +3/+0 for life, and Zack Fair saves the attacker and hands it his counters and Equipment.',
      cards: ['Squall, SeeD Mercenary', 'Rufus Shinra', 'Zack Fair', "Dark Knight's Greatsword"],
      pickEarly: 'Removal in both colours, then Squall and the Equipment.',
      traps: 'Attacking alone loses races against a wide board: kill their blockers first, and keep the rest home to block.',
      curve: 'Two- and three-drops, Squall at four. 16 lands.',
      lab: { colors: 'WB' },
    },
    {
      id: 'BG-graveyard',
      colors: 'BG',
      name: 'Golgari graveyard',
      plan: 'Put permanent cards in your graveyard (Town Greeter mills four, trades and removal do the rest). Cloud of Darkness gives a creature −X/−X for each one, Exdeath transforms at six into a trampler as big as the count, and Jenova grows a creature each combat. Evil Reawakened returns the best creature with two extra counters.',
      cards: ['Cloud of Darkness', 'Jenova, Ancient Calamity', 'Exdeath, Void Warlock', 'Town Greeter'],
      pickEarly: 'Black removal and Cloud of Darkness, then cheap creatures that trade.',
      traps: 'Instants and sorceries do not count for Cloud of Darkness or Exdeath: only permanent cards.',
      curve: 'Trading creatures at two and three, payoffs at four and five. 17 lands.',
      lab: { colors: 'BG' },
    },
    {
      id: 'UG-towns',
      colors: 'UG',
      name: 'Simic Towns and ramp',
      plan: 'Ramp with Ignis Scientia, Prishe’s Wanderings and Traveling Chocobo (play lands from the top of your library), then land the big ones. Omega taps and stuns an opponent’s permanent with a counter for each nonbasic land you control, so take the Towns. Balamb Garden becomes a flying Vehicle that draws.',
      cards: ['Ignis Scientia', 'Omega, Heartless Evolution', 'Traveling Chocobo', 'Balamb Garden, SeeD Academy', "Prishe's Wanderings"],
      pickEarly: 'Bounce and counters, the Towns and the ramp, then the top end (Omega, Coliseum Behemoth).',
      traps: 'Ramp with nothing to ramp into: take four or five payoffs. Omega counts nonbasic lands, so a deck of basics makes it a plain 8/8.',
      curve: 'Ramp at two and three, payoffs at six and seven. 17 lands.',
      lab: { colors: 'UG' },
    },
    {
      id: 'UR-spells',
      colors: 'UR',
      name: 'Izzet big spells',
      plan: 'Cards that trigger when at least four mana was spent on a noncreature spell: Ultros stuns a creature, Sahagin grows and can’t be blocked, Blazing Bomb grows, Prompto makes a Treasure. The Emperor of Palamecia makes the mana and transforms. Tiered spells (Thunder Magic, Ice Magic) count when you pay up, and so do the four-mana sorceries.',
      cards: ['The Emperor of Palamecia', 'Shantotto, Tactician Magician', 'Ultros, Obnoxious Octopus', 'Sahagin', 'Blazing Bomb'],
      pickEarly: 'The Tiered spells and burn, which are good at any cost, then the payoffs.',
      traps: 'Spells that cost less than four do not trigger the payoffs unless they are Tiered and paid up: count your four-mana spells.',
      curve: 'Cheap payoffs, many spells at four. 17 lands.',
      lab: { colors: 'UR' },
    },
    {
      id: 'WR-equipment',
      colors: 'WR',
      name: 'Boros Equipment',
      plan: 'Job select and other Equipment on cheap creatures, attacking early. Giott has double strike and loots whenever an Equipment or Dwarf enters, Adelbert Steiner gets +1/+1 for each Equipment, Firion copies each new Equipment for a turn, Samurai’s Katana gives +2/+2, trample and haste. Zidane steals a blocker to swing for lethal.',
      cards: ['Giott, King of the Dwarves', 'Zidane, Tantalus Thief', 'Firion, Wild Rose Warrior', "Samurai's Katana", 'Adelbert Steiner'],
      pickEarly: 'Samurai’s Katana, Buster Sword and burn, then the cheap creatures.',
      traps: 'Too much Equipment and too few bodies: the Job select ones bring their own Hero, the others need creatures. Equip costs add up.',
      curve: 'Low: one- and two-drops and Equipment at two and three. 16 lands.',
      lab: { colors: 'WR' },
    },
  ],
  principles: {
    valuing: [
      'Removal is in every colour but not deep: the cheap ones (Lightning Bolt, Fatal Push, Thunder Magic, Sephiroth’s Intervention) go early.',
      'Job select Equipment counts as a creature and an Equipment: pick it like a two-for-one.',
      'Summons give value over turns and then leave: value them as spells, and higher in Selesnya, where Garnet and Yuna keep them.',
      'Fixing is thin on purpose: one Town per pair, Capital City, Starting Town, World Map and Blitzball. Take your pair’s Town once you know your colours.',
    ],
    formats: {
      grid: FORMATS.grid,
      winston: FORMATS.winston,
      booster: FORMATS.booster,
    },
    splash:
      'A splash needs three sources: your pair’s Town only helps its own two colours, so lean on Capital City, Starting Town, World Map and Blitzball. Splash one removal spell, not a gold card.',
  },
  forge: {
    points: [
      ...FORGE_COMMON,
      'Summons and Job select are new to the AI’s scripts: expect it to cast them, but not to time them well.',
      'This cube has no lab data yet, and no card here has been checked for AI:RemoveDeck flags; the first lab run will say.',
    ],
    flagged: { all: [], random: [] },
  },
};
