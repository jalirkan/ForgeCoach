/*
 * ForgeCoach — livePlan/check.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The legality pass. In mtg-table's plan mode (tools/llm-seat lib/plan-core.mjs,
 * D419) a program carried each step out on the engine and sent a step that
 * could not be done back to the model with the reason; about one step a game
 * needed it. The coach cannot carry anything out — the player does — so this
 * checks every step BEFORE the player sees the plan, with the same matching and
 * the same words ("<step> cannot be done: <why>"):
 *
 *   - every name matches a card or player the seat can see (`#n` for one of two
 *     cards of a name, adventure halves by their own names);
 *   - play land: a land in hand (or listed as playable), one land a turn, none
 *     when a land was already played, only in the player's own turn;
 *   - cast: listed in `state.playable` when the frame has it (else in hand at a
 *     speed the moment allows);
 *   - activate: listed in `state.activatable` (or a playable non-hand ability),
 *     the ability words matching one when the permanent has several; a
 *     permanent the plan itself casts first (equipment, then equip) is let
 *     through for the engine to judge;
 *   - mana: the steps in order, each paid from what the earlier ones left
 *     (colours count; mana.ts ManaBudget);
 *   - attack with: the player's untapped creatures that are not summoning sick
 *     (unless they have haste), or the ones the attack declaration lists;
 *   - block X with Y: X attacks the player, Y is their untapped creature, each
 *     blocker once;
 *   - target / choose: one of the open question's answers, or something visible;
 *   - keep / mulligan only at the opening hand.
 *
 * What it cannot catch is what only the engine knows: a target a spell's text
 * does not allow (hexproof, "target creature with power 2 or less"), costs it
 * cannot read (cost reducers, convoke, X), timing restrictions in card text,
 * a creature that cannot block (flying, "can't block"), and anything the
 * opponent does in between. The engine is still the judge when the player acts.
 * Pure and DOM-free.
 */
import type { GameStateBody, InputBody } from '../protocol.ts';
import { cardsById, hasKeyword, isCreature, isLand, nameOf, playersOf, zoneCards, type LooseCard } from './board.ts';
import { ManaBudget, activationManaCost, zoneCost } from './mana.ts';
import { choiceCandidates, namesAChoice, type Moment } from './moments.ts';
import { atPriority, offersOf, type Offer, type Offers } from './offers.ts';
import { hasNonManaActivated, needsTap, type Oracle } from './oracle.ts';
import { abilitySplits, matchAbility, matchRef, normName, parseRef, splitNames, type Candidate, type Ref, type Step } from './parse.ts';
import { attackCandidates, blockPairs, choicesWords, phaseWords } from './prompt.ts';

export interface CheckInput {
  steps: readonly Step[];
  moment: Pick<Moment, 'kind' | 'atAttack' | 'ask'>;
  state: GameStateBody;
  me: number;
  oracle: Oracle;
  /** Lands the player has played this turn (moments.ts landsPlayedThisTurn). */
  landsPlayed: number;
  /** The engine's input at the moment (the attack declaration's selectable list). */
  input?: InputBody | null;
  ask?: unknown;
}

export interface StepCheck {
  ok: boolean;
  /** Why it cannot be done (the first problem found). */
  why?: string;
}

export interface CheckResult {
  ok: boolean;
  steps: StepCheck[];
  /** The first step that cannot be done, for the correction. */
  first: { step: Step; why: string } | null;
}

const PRIORITY_VERBS = new Set(['play land', 'cast', 'activate']);
const COMBAT_OVER = new Set(['COMBAT_DECLARE_BLOCKERS', 'COMBAT_FIRST_STRIKE_DAMAGE', 'COMBAT_DAMAGE', 'COMBAT_END', 'MAIN2', 'END_OF_TURN', 'CLEANUP']);
const BLOCKS_OVER = new Set(['COMBAT_FIRST_STRIKE_DAMAGE', 'COMBAT_DAMAGE', 'COMBAT_END', 'MAIN2', 'END_OF_TURN', 'CLEANUP']);

interface CastCand {
  card: LooseCard;
  zone: string;
  faces: string[];
  offer: Offer | null;
}

export function checkPlan(c: CheckInput): CheckResult {
  const { state, me, oracle, moment } = c;
  const cards = cardsById(state);
  const { mine } = playersOf(state, me);
  const own = state.activePlayer === me;
  const offers: Offers | null = atPriority(state, me, c.input ?? null, c.ask ?? null) && moment.kind !== 'mulligan' && moment.kind !== 'play-draw' ? offersOf(state, me, oracle) : null;
  const budget = new ManaBudget(state, me, oracle);
  const results: StepCheck[] = [];
  const castIds = new Set<number>();
  const castCards: LooseCard[] = [];
  let landStep: Step | null = null;
  let attackStep: Step | null = null;
  const blockersUsed = new Set<number | string>();
  let questionAnswered = false;
  // sorcery speed later in the plan: the player's own turn, outside the end of it
  const ownLater = own && state.phase !== 'END_OF_TURN' && state.phase !== 'CLEANUP';
  const handCards = zoneCards(mine, 'hand').filter((x) => x.hidden !== true);

  const visible = (text: string): string[] => {
    const cands: Candidate[] = [...cards.values()].filter((x) => nameOf(x)).map((x) => ({ id: x.id, name: nameOf(x)!, group: 'any', aliases: oracle.faces(nameOf(x)!).map(normName) }));
    for (const p of state.players ?? []) {
      cands.push({ id: `player:${p.id}`, name: p.name, group: `player:${p.id}`, aliases: p.id === me ? ['me', 'myself', 'you', 'yourself', 'my face'] : ['opponent', 'opp', 'the opponent', 'their face', 'opponent s face'] });
    }
    const missing: string[] = [];
    for (const n of splitNames(text, cands.map((x) => x.name))) {
      const ref = parseRef(n);
      if (/^(none|nothing|no target)$/.test(ref.name)) continue;
      const m = matchRef(ref, cands);
      if (!m.ok && m.why !== 'ambiguous') missing.push(n.trim());
    }
    return missing;
  };

  for (const [idx, step] of c.steps.entries()) {
    const fail = (why: string) => results.push({ ok: false, why });
    const ok = () => results.push({ ok: true });
    const before = c.steps.slice(0, idx);
    const priorityBefore = before.some((s) => PRIORITY_VERBS.has(s.verb));

    // The opening hand and the coin toss take one step of their own.
    if (moment.kind === 'mulligan') {
      if (step.verb === 'keep' || step.verb === 'mulligan') ok();
      else fail('the opening hand is decided with the single step "keep" or "mulligan"');
      continue;
    }
    if (moment.kind === 'play-draw') {
      if (step.verb === 'choose' && /^(play|draw)\b/i.test(String(step.names ?? '').trim())) ok();
      else fail('reply with the single step "choose play" or "choose draw"');
      continue;
    }
    if (step.verb === 'keep' || step.verb === 'mulligan') {
      fail('it is not the start of the game: keep and mulligan are only for your opening hand');
      continue;
    }
    // An open question comes first.
    if (moment.ask && !questionAnswered) {
      if (step.verb === 'target' || step.verb === 'choose') {
        const q = moment.ask;
        const names = splitNames(String(step.names ?? ''), choiceCandidates(q, state, me).map((x) => x.name));
        const none = names.length === 1 && /^(none|nothing)$/i.test(names[0]!.trim());
        if (none && q.min === 0) {
          questionAnswered = true;
          ok();
          continue;
        }
        const bad = names.find((n) => !namesAChoice(n, q, state, me));
        if (bad !== undefined) {
          const { choices } = choicesWords(q, state, me);
          fail(`"${bad.trim()}" is not one of the choices (the choices: ${choices})`);
          continue;
        }
        // a question of N answers: the next target / choose steps fill it
        const want = Math.max(1, q.min);
        let have = names.length;
        for (let j = idx + 1; have < want && j < c.steps.length && (c.steps[j]!.verb === 'target' || c.steps[j]!.verb === 'choose'); j++) have += splitNames(String(c.steps[j]!.names ?? '')).length;
        if (have < want) {
          fail(`the engine asks for ${q.min === q.max ? q.min : `${q.min} to ${q.max}`} answers here; name ${want === 1 ? 'one' : want}`);
          continue;
        }
        if (have >= want) questionAnswered = true;
        ok();
        continue;
      }
      if (step.verb !== 'pass' && step.verb !== 'hold') {
        fail('the engine is asking you a question now: answer it first with "target <name>" or "choose <option>", in the words shown');
        continue;
      }
    }

    switch (step.verb) {
      case 'pass':
      case 'hold':
        ok();
        break;

      case 'play land': {
        if (!own || !ownLater || moment.kind === 'response' || moment.kind === 'end-step' || moment.kind === 'blocks') {
          fail(`a land can be played only in your own main phase with an empty stack (it is ${own ? 'your' : "the opponent's"} ${phaseWords(state.phase)})`);
          break;
        }
        if (moment.kind === 'turn' && moment.atAttack && !attackStep && c.steps.slice(idx).some((s) => s.verb === 'attack with')) {
          fail('you are at the declaration of attackers now: what comes before the attack had to be done in your first main phase, which is over');
          break;
        }
        if (landStep) {
          fail(`you play one land a turn, and step ${landStep.n} already plays one`);
          break;
        }
        const cands: Candidate<LooseCard>[] = (offers && !offers.legacy
          ? offers.filter((o) => o.verb === 'land').map((o) => cards.get(o.cardId)).filter((x): x is LooseCard => !!x)
          : handCards.filter((x) => isLand(x))
        ).map((x) => ({ id: x.id, name: nameOf(x) ?? '', group: x.zone ?? 'hand', data: x }));
        const ref = parseRef(step.name);
        const m = matchRef(ref, cands);
        if (!m.ok) {
          fail(whyNotPlayable('land', ref, m.why, m.found, step));
          break;
        }
        if (c.landsPlayed > 0) {
          fail('you have already played a land this turn');
          break;
        }
        landStep = step;
        budget.addLand(m.pick.data!);
        ok();
        break;
      }

      case 'cast': {
        if (moment.kind === 'turn' && moment.atAttack && !attackStep && c.steps.slice(idx).some((s) => s.verb === 'attack with')) {
          fail('you are at the declaration of attackers now: what comes before the attack had to be done in your first main phase, which is over');
          break;
        }
        if (moment.kind === 'blocks' && c.steps.slice(idx).some((s) => s.verb === 'block')) {
          fail('you are declaring blockers now: the blocks (or "pass") come first; a spell or an ability goes after them');
          break;
        }
        const list: CastCand[] = [];
        if (offers && !offers.legacy) {
          for (const o of offers.filter((x) => x.verb === 'cast')) {
            const card = cards.get(o.cardId);
            if (card && !list.some((x) => x.card.id === card.id)) list.push({ card, zone: o.zone, faces: oracle.faces(nameOf(card) ?? ''), offer: o });
          }
        } else {
          const anySpeed = !offers ? ownLater && moment.kind !== 'response' && moment.kind !== 'end-step' : false;
          for (const x of handCards) {
            if (isLand(x)) continue;
            const instant = /\bInstant\b/.test(String(x.types ?? '')) || hasKeyword(x, 'FLASH');
            if (offers || anySpeed || instant) list.push({ card: x, zone: 'hand', faces: oracle.faces(nameOf(x) ?? ''), offer: null });
          }
        }
        const cands: Candidate<CastCand>[] = list.map((x) => ({ id: x.card.id, name: nameOf(x.card) ?? '', group: x.zone, aliases: x.faces.map(normName), data: x }));
        const ref = parseRef(step.name);
        const m = matchRef(ref, cands, castIds);
        if (!m.ok) {
          fail(whyNotPlayable('cast', ref, m.why, m.found, step));
          break;
        }
        const pick = m.pick.data!;
        const face = pick.faces.find((f) => normName(f) === ref.name && normName(f) !== normName(nameOf(pick.card))) ?? null;
        let cost: string | null | undefined = pick.card.manaCost;
        let how = '';
        if (face) cost = oracle.faceCost(nameOf(pick.card)!, face) ?? null;
        else if (pick.zone !== 'hand') {
          const alt = zoneCost(pick.card, pick.zone, oracle);
          cost = alt ? alt.cost : null;
          how = alt ? `from your ${pick.zone} it is cast by ${alt.how}: ` : '';
        }
        const what = `step ${step.n} (cast ${face ?? nameOf(pick.card)}${cost ? `, ${cost}` : ''})`;
        const p = budget.spend(cost, what, pick.card);
        if (p) {
          fail(`${how}${p}`);
          break;
        }
        if (step.targets) {
          const miss = visibleOrCast(step.targets);
          if (miss.length) {
            fail(`no card or player named "${miss[0]}" is in view for its target (names as the game shows them)`);
            break;
          }
        }
        castIds.add(pick.card.id);
        castCards.push(pick.card);
        if (!face) budget.addCast(pick.card);
        ok();
        break;
      }

      case 'activate': {
        if (moment.kind === 'turn' && moment.atAttack && !attackStep && c.steps.slice(idx).some((s) => s.verb === 'attack with')) {
          fail('you are at the declaration of attackers now: what comes before the attack had to be done in your first main phase, which is over');
          break;
        }
        if (moment.kind === 'blocks' && c.steps.slice(idx).some((s) => s.verb === 'block')) {
          fail('you are declaring blockers now: the blocks (or "pass") come first; a spell or an ability goes after them');
          break;
        }
        const why = activateProblem(step);
        if (why) fail(why);
        else if (step.targets && visibleOrCast(step.targets).length) fail(`no card or player named "${visibleOrCast(step.targets)[0]}" is in view for its target (names as the game shows them)`);
        else ok();
        break;
      }

      case 'attack with': {
        if (!own) {
          fail('it is not your turn');
          break;
        }
        if (COMBAT_OVER.has(state.phase ?? '') || (state.phase === 'COMBAT_DECLARE_ATTACKERS' && !(moment.kind === 'turn' && moment.atAttack))) {
          fail(`combat is over this turn (it is your ${phaseWords(state.phase)})`);
          break;
        }
        if (attackStep) {
          fail(`you attack once a turn, and step ${attackStep.n} already declares the attack`);
          break;
        }
        attackStep = step;
        if (step.names == null || /^(none|nothing|no one|no creatures?)$/i.test(normName(String(step.names)))) {
          ok();
          break;
        }
        const sel = moment.atAttack && c.input?.selectable?.mode === 'cards' ? new Set(c.input.selectable.cardIds) : null;
        const pool = sel ? zoneCards(mine, 'battlefield').filter((x) => sel.has(x.id)) : attackCandidates(state, me);
        // a creature with haste the plan casts first can attack too
        const hasty = castCards.filter((x) => isCreature(x) && (hasKeyword(x, 'HASTE') || /(^|\n)[^\n:]*\bHaste\b/.test(oracle.text(nameOf(x) ?? '') ?? '')));
        const cands: Candidate[] = [...pool, ...hasty].map((x) => ({ id: x.id, name: nameOf(x) ?? '', group: 'mine' }));
        const taken = new Set<number | string>();
        let bad: string | null = null;
        for (const n of splitNames(step.names, cands.map((x) => x.name))) {
          const ref = parseRef(n);
          const m = matchRef(ref, cands, taken);
          if (!m.ok) {
            bad = whyNotCreature(ref, 'attack', taken);
            break;
          }
          taken.add(m.pick.id);
        }
        if (bad) fail(bad);
        else ok();
        break;
      }

      case 'block': {
        if (own) {
          fail("you block on the opponent's turn, not yours");
          break;
        }
        if (BLOCKS_OVER.has(state.phase ?? '')) {
          fail('the declaration of blockers is over');
          break;
        }
        const pairs = blockPairs(state, me);
        const atBlocks = moment.kind === 'blocks' || pairs.attackers.length > 0;
        const attackers: Candidate[] = (atBlocks ? pairs.attackers : zoneCards(playersOf(state, me).opp, 'battlefield').filter((x) => isCreature(x))).map((x) => ({ id: x.id, name: nameOf(x) ?? '', group: 'theirs' }));
        const blockers: Candidate[] = pairs.blockers.map((x) => ({ id: x.id, name: nameOf(x) ?? '', group: 'mine' }));
        const aRef = parseRef(step.attacker);
        const a = matchRef(aRef, attackers);
        if (!a.ok && a.why !== 'ambiguous') {
          fail(`"${aRef.raw}" is not attacking you (attacking: ${attackers.map((x) => x.name).join(', ') || 'nothing'})`);
          break;
        }
        const bRef = parseRef(step.blocker);
        const b = matchRef(bRef, blockers, blockersUsed);
        if (!b.ok) {
          const twice = blockersUsed.size && blockers.some((x) => blockersUsed.has(x.id) && normName(x.name) === bRef.name);
          fail(twice ? `${step.blocker} already blocks; each creature blocks one attacker` : whyNotCreature(bRef, 'block', blockersUsed));
          break;
        }
        blockersUsed.add(b.pick.id);
        ok();
        break;
      }

      case 'target':
      case 'choose': {
        const names = String(step.names ?? '');
        // after a cast or an activation: its target, or a choice its card asks for later
        if (priorityBefore || moment.ask) {
          if (step.verb === 'target') {
            const miss = visibleOrCast(names);
            if (miss.length) {
              fail(`no card or player named "${miss[0]}" is in view (names as the game shows them)`);
              break;
            }
          }
          ok();
          break;
        }
        fail('nothing is asking you to choose or target right now (you have priority)');
        break;
      }
    }
  }

  const firstBad = results.findIndex((r) => !r.ok);
  return { ok: firstBad < 0, steps: results, first: firstBad < 0 ? null : { step: c.steps[firstBad]!, why: results[firstBad]!.why! } };

  // ---------------------------------------------------------------------------

  function visibleOrCast(text: string): string[] {
    const castNames = new Set(castCards.map((x) => normName(nameOf(x))));
    return visible(text).filter((n) => !castNames.has(parseRef(n).name));
  }

  function activateProblem(step: Step): string | null {
    const engine = offers?.engineActivatable === true;
    const byCard = new Map<number, Offer[]>();
    if (offers) {
      for (const o of offers.filter((x) => x.verb === 'activate')) {
        if (!byCard.has(o.cardId)) byCard.set(o.cardId, []);
        byCard.get(o.cardId)!.push(o);
      }
    }
    // without the engine's list (an older engine, or not at priority now): the card text's hint
    if (!engine) {
      for (const x of zoneCards(mine, 'battlefield')) {
        if (x.hidden === true || x.controller !== me || byCard.has(x.id)) continue;
        const text = nameOf(x) ? oracle.text(nameOf(x)!) : null;
        if (!hasNonManaActivated(text)) continue;
        if (x.tapped && needsTap(text)) continue;
        byCard.set(x.id, [{ verb: 'activate', cardId: x.id, zone: 'battlefield', legacy: true }]);
      }
    }
    const cands: Candidate<LooseCard>[] = [...byCard.keys()].map((id) => ({ id, name: nameOf(cards.get(id)) ?? '', group: byCard.get(id)![0]!.zone ?? 'battlefield', data: cards.get(id) }));
    // a permanent this plan casts first (an Equipment, then its equip): the engine judges it
    for (const x of castCards) if (!byCard.has(x.id)) cands.push({ id: x.id, name: nameOf(x) ?? '', group: 'cast', data: x });
    let pick: Candidate<LooseCard> | null = null;
    let sel: string | null = null;
    let first: { ref: Ref; why: 'missing' | 'ambiguous' | 'id'; found: Candidate[]; known: boolean } | null = null;
    for (const sp of abilitySplits(step.name ?? '')) {
      const ref = parseRef(sp.name);
      const m = matchRef(ref, cands);
      if (m.ok) {
        pick = m.pick;
        sel = sp.ability;
        break;
      }
      const known = [...cards.values()].some((x) => nameOf(x) && normName(nameOf(x)) === ref.name);
      if (!first || (!first.known && (known || (first.why === 'missing' && m.why !== 'missing')))) first = { ref, why: m.why, found: m.found, known };
    }
    if (!pick) return whyNotPlayable('activate', first!.ref, first!.why, first!.found, step);
    if (pick.group === 'cast') {
      // its one activated ability's mana, when the text has just one
      const text = oracle.text(pick.name) ?? '';
      const equip = /\b(?:Equip|Reconfigure)\s*((?:\{[^}]+\})+)/i.exec(text);
      const cost = equip?.[1] ?? null;
      return budget.spend(cost, `step ${step.n} (activate ${pick.name}${cost ? `, ${cost}` : ''})`);
    }
    const abil = byCard.get(pick.id as number)!;
    const labelOf = (a: Offer) => String(a.abilityLabel ?? '');
    let o: Offer | null = null;
    if (sel !== null && abil.some((a) => a.abilityLabel !== undefined)) {
      const mm = matchAbility(sel, abil.map(labelOf));
      if (!mm.ok) return `"${sel}" ${mm.why === 'ambiguous' ? 'fits more than one' : 'is not one'} of the abilities the engine allows ${pick.name} now: ${abil.map((a) => `"${labelOf(a)}"`).join('; ')}`;
      o = abil[mm.index]!;
    } else if (abil.length === 1) {
      o = abil[0]!;
    }
    if (o && o.abilityLabel) {
      const mana = activationManaCost(o.abilityLabel);
      const p = budget.spend(mana, `step ${step.n} (activate ${pick.name}${mana ? `, ${mana}` : ''})`);
      if (p) return `its ability "${o.abilityLabel.slice(0, 80)}" ${p.replace(/^it costs/, 'costs')}`;
      if (/\{T\}/.test(String(o.abilityLabel).split(':')[0] ?? '')) budget.tap(pick.id as number);
    }
    return null;
  }

  function whyNotPlayable(want: 'land' | 'cast' | 'activate', ref: Ref, why: 'missing' | 'ambiguous' | 'id', found: Candidate[], step: Step): string {
    if (why === 'ambiguous') {
      return `"${ref.raw}" fits more than one card: ${found.map((x) => `${x.name} #${x.id} (${x.group === 'hand' ? 'your hand' : `your ${x.group}`})`).join(', ')}; add the number`;
    }
    if (why === 'id') return `there is no ${ref.name ? `"${ref.name}" ` : ''}card #${ref.id} you can ${step.verb} now`;
    const all = [...cards.values()].filter((x) => nameOf(x) && (normName(nameOf(x)) === ref.name || oracle.faces(nameOf(x)!).some((f) => normName(f) === ref.name)));
    if (all.length === 0) return `no card named "${ref.raw}" is in your hand or on the battlefield (names as the game shows them)`;
    const mineAll = all.filter((x) => x.controller === me || (x.zone === 'hand' && x.owner === me));
    if (mineAll.length === 0) return `${nameOf(all[0])} is the opponent's card`;
    const inHand = mineAll.find((x) => x.zone === 'hand');
    const onField = mineAll.find((x) => x.zone === 'battlefield');
    const yourTurnMain = own && (state.phase === 'MAIN1' || state.phase === 'MAIN2') && !(state.stack ?? []).length;
    if (want === 'land') {
      if (inHand && !isLand(inHand)) return `${nameOf(inHand)} is not a land: write "cast ${nameOf(inHand)}"`;
      if (!inHand) return `${nameOf(mineAll[0])} is not in your hand (it is in your ${mineAll[0]!.zone})`;
      if (c.landsPlayed > 0) return 'you have already played a land this turn';
      if (!yourTurnMain && moment.kind !== 'turn') return `a land can be played only in your own main phase with an empty stack (it is ${own ? 'your' : "the opponent's"} ${phaseWords(state.phase)})`;
      return `the engine does not offer to play ${nameOf(inHand)} now`;
    }
    if (want === 'cast') {
      if (inHand && castIds.has(inHand.id) && mineAll.filter((x) => x.zone === 'hand').length === 1) return `${nameOf(inHand)} is already cast by an earlier step`;
      if (inHand && isLand(inHand)) return `${nameOf(inHand)} is a land: write "play land ${nameOf(inHand)}"`;
      if (!inHand && onField) return `${nameOf(onField)} is already on the battlefield; for its ability write "activate ${nameOf(onField)}"`;
      if (!inHand) return `${nameOf(mineAll[0])} is in your ${mineAll[0]!.zone}, and the engine does not offer to cast it from there now`;
      const instant = /\bInstant\b/.test(String(inHand.types ?? '')) || hasKeyword(inHand, 'FLASH');
      if (!instant && !yourTurnMain) return `${nameOf(inHand)} is not an instant: it can be cast only in your own main phase with an empty stack (it is ${own ? 'your' : "the opponent's"} ${phaseWords(state.phase)})`;
      return `the engine does not offer to cast ${nameOf(inHand)} now`;
    }
    if (!onField) return `${nameOf(mineAll[0])} is not on your battlefield (it is in your ${mineAll[0]!.zone}); only a permanent's ability can be activated this way`;
    if (offers?.engineActivatable) {
      const pw = /\bPlaneswalker\b/.test(String(onField.types ?? ''));
      const w = onField.tapped ? ' (it is tapped)' : pw ? ' (a planeswalker uses one loyalty ability a turn, in your main phase with an empty stack)' : '';
      return `the engine offers no ability of ${nameOf(onField)} now${w}`;
    }
    const text = oracle.text(nameOf(onField)!);
    if (onField.tapped && needsTap(text)) return `${nameOf(onField)} is tapped`;
    if (isCreature(onField) && onField.sick && needsTap(text) && !hasKeyword(onField, 'HASTE')) return `${nameOf(onField)} is summoning sick, so it cannot use a {T} ability yet`;
    return `the engine offers no ability of ${nameOf(onField)} now (mana abilities are used for you when you pay)`;
  }

  function whyNotCreature(ref: Ref, what: 'attack' | 'block', taken: ReadonlySet<number | string>): string {
    const mineBf = zoneCards(mine, 'battlefield').filter((x) => x.hidden !== true);
    const hits = mineBf.filter((x) => normName(nameOf(x)) === ref.name && (ref.id === null || x.id === ref.id));
    const label = (x: LooseCard) => (ref.id !== null ? `${nameOf(x)} #${x.id}` : nameOf(x) ?? `card #${x.id}`);
    if (hits.length === 0) {
      const cast = castCards.find((x) => normName(nameOf(x)) === ref.name);
      if (cast && what === 'attack') return `${nameOf(cast)} comes in this turn by an earlier step, so it is summoning sick`;
      return `you have no creature named "${ref.raw}" on the battlefield`;
    }
    const x = hits.find((h) => !taken.has(h.id)) ?? hits[0]!;
    if (taken.has(x.id)) return `${label(x)} is named twice`;
    if (!isCreature(x)) return `${label(x)} is not a creature`;
    if (x.tapped) return `${label(x)} is tapped`;
    if (what === 'attack' && x.sick && !hasKeyword(x, 'HASTE')) return `${label(x)} is summoning sick (it came under your control this turn)`;
    return `the engine does not let ${label(x)} ${what} now`;
  }
}
