/*
 * ForgeCoach — ui/play/damageBar.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The arithmetic of the combat-damage bar (DamageBar.tsx; the endstep study
 * of 2026-10-12, §3): one `assign_damage` ask (mtg-table protocol §5.3,
 * amendment M67 / D424) as a split the player builds with − N + steppers.
 *
 * Pure: no DOM, no React, tested in node (damageBar.test.ts). The client has
 * no rules of its own — every number here is the wire's:
 *
 *   - `total`: the split assigns exactly this much;
 *   - `defenderAllowed`: the defending player (target 0) gets a row only when
 *     the engine says `true`. Absent (a bridge before M67) means "the bridge
 *     does not say" and is read as NOT allowed, never as `true`
 *     (`assignDamageRuleOf`, protocol.ts);
 *   - `targets[].lethal`: the engine's lethal damage per blocker (deathtouch
 *     and planeswalkers included). The defender's row is locked — stepper off,
 *     amount 0 — until every blocker has at least its lethal. A blocker the
 *     engine sent no lethal for constrains nothing (there is no fact to keep).
 *
 * Those three facts are all the bar enforces, arithmetically, so it never
 * builds a map the bridge would refuse for them. Anything else the engine
 * refuses (Forge's legacy damage order, say) comes back as a new ask whose
 * `reason` the bar prints in its sentence line.
 */
import { assignDamageRuleOf } from '../../protocol.ts';
import type { AskOption, AssignDamageAsk } from '../../protocol.ts';

/** Option index (the answer's key, as a string) → amount. */
export type Amounts = Record<string, number>;

export type DamageOption = AskOption & { lethal?: number | null; defender?: boolean };

export interface DamageRow {
  /** The option's ask-local index: the key the answer uses (§5.1). */
  index: number;
  label: string;
  defender: boolean;
  /** The engine's lethal damage for a blocker; null for the defender, or when the engine sent none. */
  lethal: number | null;
  option: DamageOption;
}

export interface DamageBarModel {
  askId: string;
  total: number;
  attackerId: number | null;
  /** The blockers, in the engine's order. */
  blockers: DamageRow[];
  /** The defending player's row — only when the engine says it may take damage. */
  defender: DamageRow | null;
  /** Why the engine refused the last split of this same question (a re-ask), or null. */
  reason: string | null;
}

const lethalOf = (o: DamageOption): number | null => (typeof o.lethal === 'number' && Number.isInteger(o.lethal) && o.lethal >= 0 ? o.lethal : null);

/** May target 0, the defender, take damage? The engine's word; absent is "not said", read as no. */
export function defenderAllowedOf(ask: AssignDamageAsk): boolean {
  return assignDamageRuleOf(ask).defenderAllowed === true;
}

export function damageBarOf(ask: AssignDamageAsk): DamageBarModel {
  const rows: DamageRow[] = (ask.targets as DamageOption[]).map((o) => ({
    index: o.id,
    label: o.label,
    defender: o.defender === true,
    lethal: o.defender === true ? null : lethalOf(o),
    option: o,
  }));
  const def = rows.find((r) => r.defender) ?? null;
  return {
    askId: ask.askId,
    total: Math.max(0, Math.floor(ask.total)),
    attackerId: ask.attackerId,
    blockers: rows.filter((r) => !r.defender),
    defender: def && defenderAllowedOf(ask) ? def : null,
    reason: assignDamageRuleOf(ask).reason,
  };
}

const amountOf = (amounts: Amounts, index: number): number => {
  const v = amounts[String(index)];
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
};

/** What the split has assigned so far. */
export function assignedOf(amounts: Amounts): number {
  let sum = 0;
  for (const v of Object.values(amounts)) sum += typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
  return sum;
}

/** What is still to assign: "N left of M" (negative only for a map the bar never builds). */
export function leftOf(model: DamageBarModel, amounts: Amounts): number {
  return model.total - assignedOf(amounts);
}

/** The blockers that are short of the lethal damage the engine said they need. */
export function shortBlockers(model: DamageBarModel, amounts: Amounts): DamageRow[] {
  return model.blockers.filter((b) => b.lethal !== null && amountOf(amounts, b.index) < b.lethal);
}

/** Is the defender's row locked: no row at all, or a blocker still short of lethal. */
export function defenderLocked(model: DamageBarModel, amounts: Amounts): boolean {
  return model.defender === null || shortBlockers(model, amounts).length > 0;
}

/** The rows the bar draws, blockers first, then the defender's (when it has one). */
export function barRows(model: DamageBarModel): DamageRow[] {
  return model.defender ? [...model.blockers, model.defender] : [...model.blockers];
}

/**
 * The split the bar opens on, and what Reset returns to: Forge's own Auto —
 * lethal to each blocker in the engine's order while damage lasts, the rest on
 * the defender when it has a row, else on the last blocker. With no blocker
 * and a defender, all of it on the defender; with neither, nothing.
 */
export function autoSplit(model: DamageBarModel): Amounts {
  const out: Amounts = {};
  let left = model.total;
  for (const b of model.blockers) {
    if (left <= 0) break;
    if (b.lethal === null || b.lethal <= 0) continue;
    const give = Math.min(b.lethal, left);
    out[String(b.index)] = give;
    left -= give;
  }
  if (left > 0) {
    const last = model.blockers[model.blockers.length - 1];
    const sink = model.defender ?? last ?? null;
    if (sink) out[String(sink.index)] = (out[String(sink.index)] ?? 0) + left;
  }
  return out;
}

/** Can row `index` move by `delta` (±1)? */
export function canStep(model: DamageBarModel, amounts: Amounts, index: number, delta: 1 | -1): boolean {
  const row = barRows(model).find((r) => r.index === index);
  if (!row) return false;
  const n = amountOf(amounts, index);
  if (row.defender && defenderLocked(model, amounts)) return false;
  if (delta < 0) return n > 0;
  return leftOf(model, amounts) > 0;
}

/**
 * One − or + on row `index`. Steppers never take the total above its limit
 * (to move a point: − one row, then + another). When a − leaves a blocker
 * short of lethal, the defender's row locks and its damage comes back to the
 * pool (it reads 0 and the attacker's tile shows it as left to assign).
 */
export function step(model: DamageBarModel, amounts: Amounts, index: number, delta: 1 | -1): Amounts {
  if (!canStep(model, amounts, index, delta)) return amounts;
  const next: Amounts = { ...amounts, [String(index)]: amountOf(amounts, index) + delta };
  return settle(model, next);
}

/** The defender holds nothing while it is locked. */
function settle(model: DamageBarModel, amounts: Amounts): Amounts {
  if (model.defender && defenderLocked(model, amounts) && amountOf(amounts, model.defender.index) > 0) {
    return { ...amounts, [String(model.defender.index)]: 0 };
  }
  return amounts;
}

export interface SplitCheck {
  ok: boolean;
  /** What is still wrong, in a few words; null when the split is legal. */
  why: string | null;
}

/** Is this split one the bar may send? Exactly the three facts the wire gave, and nothing else. */
export function checkSplit(model: DamageBarModel, amounts: Amounts): SplitCheck {
  const rows = new Map(barRows(model).map((r) => [String(r.index), r]));
  for (const [key, v] of Object.entries(amounts)) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) return { ok: false, why: 'Whole numbers only' };
    if (v === 0) continue;
    const row = rows.get(key);
    if (!row) return { ok: false, why: 'That target can’t take this damage' };
    if (row.defender) {
      const short = shortBlockers(model, amounts)[0];
      if (short) return { ok: false, why: `${short.label} needs ${short.lethal} before ${row.label} takes any` };
    }
  }
  const left = leftOf(model, amounts);
  if (left > 0) return { ok: false, why: `${left} left to assign` };
  if (left < 0) return { ok: false, why: `${-left} too many` };
  return { ok: true, why: null };
}

/** The answer for a legal split (`{ "<index>": n }`, positive amounts only), else null. */
export function answerOf(model: DamageBarModel, amounts: Amounts): Record<string, number> | null {
  if (!checkSplit(model, amounts).ok) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(amounts)) if (v > 0) out[k] = v;
  return out;
}

export interface LethalPips {
  /** One pip per point of lethal damage. */
  lethal: number;
  /** How many of them the split fills. */
  filled: number;
  /** `met`: lethal reached (green); `short`: not yet (red). */
  state: 'met' | 'short';
  /** Damage above lethal ("+1"). */
  over: number;
}

/** A blocker's lethal pips under its card; null for the defender or a blocker with no lethal from the engine. */
export function pipsOf(row: DamageRow, amounts: Amounts): LethalPips | null {
  if (row.defender || row.lethal === null) return null;
  const n = amountOf(amounts, row.index);
  return { lethal: row.lethal, filled: Math.min(n, row.lethal), state: n >= row.lethal ? 'met' : 'short', over: Math.max(0, n - row.lethal) };
}

export interface BarWords {
  /** "Hill Giant deals 3 damage — divide it among the blockers." */
  sentence: string;
  /** With a defender's row: the rule line ("Trample · every blocker must be lethal to spill over"). */
  rule: string | null;
}

/**
 * The bar's sentence and rule line. `attacker` is the attacker's name when the
 * frame shows it; `trample` only chooses the words (the attacker's wire
 * `keywords`), never what is allowed — that is `defenderAllowed`.
 */
export function barWords(model: DamageBarModel, attacker: string | null, trample: boolean): BarWords {
  const who = attacker || 'Your attacker';
  const among = model.blockers.length === 1 ? `assign it to ${model.blockers[0]!.label}` : 'divide it among the blockers';
  if (!model.defender) return { sentence: `${who} deals ${model.total} damage — ${among}.`, rule: null };
  const lethalFirst = model.blockers.length === 0 ? '' : trample ? '; assign lethal to each before it tramples over' : `; assign lethal to each before ${model.defender.label} takes any`;
  return {
    sentence: `${who} deals ${model.total} damage — ${among}${lethalFirst}.`,
    rule: model.blockers.length === 0 ? null : trample ? 'Trample · every blocker must be lethal to spill over' : `Every blocker must be lethal before ${model.defender.label} takes any`,
  };
}
