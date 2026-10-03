/*
 * ForgeCoach — cube/guides/common.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Advice that holds in every cube here: the three draft formats with two
 * players, and what the Forge AI does badly. Each guide adds its own lines.
 */

export const FORMATS = {
  grid:
    'Grid shows you nine cards at a time and nearly the whole cube by the end, so you can plan. Every line you take also decides what the AI gets from what is left: when two lines are close, take the one that leaves it less. Each of you ends with about 45–50 cards, plenty for two colours.',
  winston:
    'Winston deals only 90 of the 180 cards, and half the time you see a pile the AI just passed. Pools are thin: often only 18–20 good cards in your best two colours. If you come up short, take the third colour rather than playing filler, and with three colours play 18 lands. Take a deep pile of medium cards over one good card when you are still open.',
  booster:
    'With two players, three packs of 15 come from 90 of the 180 cards, and each pack goes back and forth, so you see it every other pick. What disappears between your picks tells you the AI’s colours. With more seats it plays like a normal cube draft, and the cards that come back (“wheel”) are the signal.',
};

/** What the Forge AI does badly, in any cube. Guides add what it means for that cube. */
export const FORGE_COMMON = [
  'It uses sacrifice outlets badly: it rarely sacrifices in response to removal or at the right moment. In your hands the same outlets are worth more than its results with them suggest.',
  'It attacks poorly into open mana. Flash creatures, instant-speed removal and combat tricks catch it again and again, so cards that let you pass with mana up are worth more against it than against a person.',
  'It misplays cards whose Forge script is flagged AI:RemoveDeck, combo pieces most of all. Those cards are not weak, and the AI is unlikely to punish you with them; its low lab numbers for them say more about the pilot than the card.',
];
