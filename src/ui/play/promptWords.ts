/*
 * ForgeCoach — ui/play/promptWords.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Forge's target and choice prompts in plain English, for the decision slot's
 * title (Justin's play test, 2026-10-17: Arc Trail's second target read
 * "Parent Targeted:[Goblin Shaman Token]" and looked like an optional pick).
 *
 * Forge builds these messages in InputSelectTargets.showMessage and
 * InputSelectCardsFromList; the bridge passes them through as `input.prompt`
 * (mtg-table protocol §4: "rendered verbatim"). Their parts, as recorded in
 * every frame log we have:
 *
 *   Arc Trail (28) - Arc Trail deals 2 damage to any target and 1 damage to any other target.
 *                                                                    ← the source and its ability text
 *   Select any target (2 damage)                                     ← the instruction (the target's VTSelection)
 *   Targeted:                                                        ← this slot's picks so far, one per line
 *   Goblin Shaman Token (126)
 *   Parent Targeted:[Tireless Tracker (93)]                          ← an earlier slot's targets, same spell
 *   (2 more can be targeted)                                         ← when the slot takes more than one
 *
 * and a cost's selection: "Priest of Forgotten Gods (28)\n - {T}, Sacrifice
 * two other creatures: …\nSelect other creature to sacrifice (1 left)".
 *
 * `parsePrompt` splits a prompt into those parts; `PROMPT_RULES` is the
 * mapping, one entry per class, each with the words it writes. What the wire
 * does not carry is not invented: which slot of a spell is being filled, and
 * the amounts of the slots already filled, are not in the input (only "Parent
 * Targeted:" names them), so a later slot says what was chosen and what the
 * engine asks now, never "2 damage goes to X".
 *
 * Pure (no React, no DOM). Ids stay in what this returns; the caller
 * (inputView.ts describeInput) takes them out with everything else it draws.
 */

/** A prompt's parts. Every string keeps Forge's words, ids included. */
export interface PromptParts {
  /** The card the prompt is about ("Arc Trail (28)"), or null. */
  source: string | null;
  /** The ability's text after "Source - ", or null when Forge printed none (a sub-ability). */
  ability: string | null;
  /** The instruction: "Select any target (2 damage)", "Select other creature to sacrifice (1 left)". */
  ask: string;
  /** This slot's picks so far ("Targeted:"). */
  targeted: string[];
  /** The targets an earlier slot of the same spell or ability took ("Parent Targeted:[…]"). */
  parentTargeted: string[];
  /** "(n more can be targeted)", or null. */
  more: number | null;
}

const MORE = /^\((\d+) more can be targeted\)$/i;
const TARGETED = /^Targeted:\s*(.*)$/i;
const PARENT = /^Parent Targeted:\s*\[(.*)\]\s*$/i;
/** "Name (12)" with an optional " - ability" after it: a card header line. */
const HEADER_ID = /^(.*?\(\d+\))\s*(?:-\s*(.*))?$/;

/**
 * Java's `List.toString()` of game entities: "[Tireless Tracker (93), Evan]".
 * A card's name may hold a comma ("Peggy Carter, Secret Agent (4)") and a
 * player's has no id, so a piece without an id joins the next one unless it
 * is a known player name.
 */
export function splitEntityList(list: string, players: readonly string[] = []): string[] {
  const pieces = list.split(/,\s*/).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  let carry = '';
  for (const p of pieces) {
    const cur = carry ? `${carry}, ${p}` : p;
    if (/\(\d+\)$/.test(cur) || players.includes(cur)) {
      out.push(cur);
      carry = '';
    } else carry = cur;
  }
  if (carry) out.push(carry);
  return out;
}

/** Split one of Forge's prompts into its parts (see the header). */
export function parsePrompt(prompt: string, players: readonly string[] = []): PromptParts {
  const all = prompt
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const targeted: string[] = [];
  const parentTargeted: string[] = [];
  let more: number | null = null;
  const body: string[] = [];
  let inTargeted = false;
  for (const l of all) {
    const m = MORE.exec(l);
    if (m) {
      more = Number(m[1]);
      inTargeted = false;
      continue;
    }
    const p = PARENT.exec(l);
    if (p) {
      parentTargeted.push(...splitEntityList(p[1]!, players));
      inTargeted = false;
      continue;
    }
    const t = TARGETED.exec(l);
    if (t) {
      inTargeted = true;
      if (t[1]) targeted.push(t[1]);
      continue;
    }
    if (inTargeted) targeted.push(l);
    else body.push(l);
  }
  let source: string | null = null;
  let ability: string | null = null;
  let ask = '';
  if (body.length === 1) {
    // The short form: "Shock (3) - Select any target", "Reveillark - Select up to 2 target …".
    const line = body[0]!;
    const m = HEADER_ID.exec(line) ?? /^(.+?) - (.+)$/.exec(line);
    if (m && m[2] && /^(Select|Choose)\b/i.test(m[2])) {
      source = m[1]!.trim();
      ask = m[2].trim();
    } else ask = line;
  } else if (body.length > 1) {
    const head = body[0]!;
    ask = body[body.length - 1]!;
    const m = HEADER_ID.exec(head);
    if (m && !/\?$/.test(head)) {
      source = m[1]!.trim();
      ability = (m[2] ?? '').trim() || null;
    } else if (!/[.?!:]$/.test(head)) {
      const d = /^(.+?) - (.*)$/.exec(head);
      source = (d ? d[1]! : head).trim();
      ability = d ? d[2]!.trim() || null : null;
    }
    // The cost form puts the ability on a line of its own: "Woe Strider (35)\n - Sacrifice another creature: Scry 1."
    if (source && !ability && body.length > 2) ability = body.slice(1, -1).join(' ').replace(/^-\s*/, '').trim() || null;
    // No card header: a question line is the ask ("Use triggered ability of X?" over "Triggered by: X"), else the last line.
    if (!source) ask = body.find((l) => /\?$/.test(l)) ?? ask;
  }
  // Forge's sa.toString() for a spell with no text of its own is the card's name: no ability text.
  if (ability && source && sameName(ability, source)) ability = null;
  return { source, ability, ask, targeted, parentTargeted, more };
}

/**
 * An ability's text as a player reads it: without Forge's bookkeeping tails
 * ("[Attacker: Ant-Man's Air Force (23)]", "[Zone Changer: Inferno Titan (9)]")
 * and its "(Targeting ERROR)" placeholder.
 */
export function abilityWords(ability: string | null): string | null {
  if (!ability) return null;
  const t = ability
    .replace(/\s*\[(Attacker|Zone Changer|Triggered by|Cause|Defender|Blocker|Player|Card|Source)[^\]]*\]/gi, '')
    .replace(/\(Targeting ERROR\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return t || null;
}

function sameName(a: string, b: string): boolean {
  const bare = (s: string) => s.replace(/\s*\(\d+\)\s*/g, '').trim().toLowerCase();
  return bare(a) === bare(b);
}

// ---------------------------------------------------------------------------
// The mapping

/** What a rule reads: the prompt's parts and the input's structured fields (protocol §4). */
export interface PromptContext {
  parts: PromptParts;
  /** `selectable.min` / `.max` for this slot. */
  min: number;
  max: number;
  /** M65 `selectable.chosen` count for this slot, or null when the frame does not say (no rule needs it yet: Forge's own lists are read first). */
  chosen: number | null;
  /** The engine's OK: enabled, and its label. */
  ok: { label: string; enabled: boolean };
  /** The source's name as the board shows it (ids out), or null. */
  sourceName: string | null;
  /** An entity from a Targeted list as the board names it ("you" for the viewing seat). */
  nameOf: (entity: string) => string;
}

/** The slot's words: the title, and one line of context under it (or null). */
export interface PromptWords {
  /** Which class of PROMPT_RULES wrote it. */
  rule: string;
  title: string;
  context: string | null;
}

export interface PromptRule {
  id: string;
  /** One recorded example of the class (Forge's own text), for the tests and the reader. */
  example: string;
  test: (c: PromptContext) => boolean;
  words: (c: PromptContext) => Omit<PromptWords, 'rule'>;
}

/** "Select any target (2 damage)" → { object: "any target", amount: "2 damage" }. */
export function askObject(ask: string): { object: string; amount: string | null } {
  let object = ask.replace(/^(Select|Choose)\s+/i, '').replace(/\.$/, '').trim();
  let amount: string | null = null;
  const a = /\s*\((\d+ damage)\)\s*$/i.exec(object);
  if (a) {
    amount = a[1]!;
    object = object.slice(0, a.index).trim();
  }
  return { object, amount };
}

/** "Arc Trail: " — the title's lead, or "" when the prompt names no source. */
function lead(c: PromptContext): string {
  return c.sourceName ? `${c.sourceName}: ` : '';
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "A", "A and B", "A, B and C". */
export function listWords(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** "choose X" with the source in front: "Arc Trail: choose any target (2 damage)", or "Choose any target". */
function choose(c: PromptContext, object: string, tail = ''): string {
  const l = lead(c);
  return l ? `${l}choose ${object}${tail}` : `${capital(`choose ${object}`)}${tail}`;
}

/** How many a slot takes, when Forge's words do not say: " (up to 2)", " (2 targets)". */
function countTail(c: PromptContext, object: string): string {
  if (/\bup to\b|\b(two|three|four|\d+)\b/i.test(object)) return '';
  // Forge's own count first: "(n more can be targeted)" is printed whenever the slot takes more than one,
  // and a frame's min/max can still be the previous input's for a moment.
  if (c.parts.more !== null) {
    const total = c.parts.more + c.parts.targeted.length;
    return total > 1 ? ` (up to ${total})` : '';
  }
  if (c.max <= 1) return '';
  if (c.min === c.max) return ` (${c.max} targets)`;
  if (c.min > 0) return ` (${c.min} to ${c.max} targets)`;
  return ` (up to ${c.max})`;
}

/** "Targeted so far: Evan and Goblin Shaman Token." when the slot has picks. */
function soFar(c: PromptContext): string | null {
  const names = c.parts.targeted.map(c.nameOf);
  return names.length ? `Targeted so far: ${listWords(names)}.` : null;
}

/** Forge's internal target syntax leaking into the words: "Permanent.YouCtrl+cmcLE3". */
const FORGE_SYNTAX = /\b[A-Z][A-Za-z]*\.[A-Z][A-Za-z]*|\+[a-z]+[A-Z]{2}\d|\b(cmc|CMC)(LE|GE|EQ|LT|GT)\d/;
/** A cost's card selection: "Select another creature to sacrifice (1 left)". */
const SACRIFICE = /^Select (another |other )?(.+?) to sacrifice \((\d+) left\)$/i;

/**
 * The classes, in the order they are tried. The first whose `test` holds
 * writes the words; a prompt no rule takes keeps Forge's instruction line
 * (`describeInput` then cleans it of ids).
 */
export const PROMPT_RULES: readonly PromptRule[] = [
  {
    // Arc Trail's second target, Fire // Ice's split damage, a modal spell's next mode, "another target creature" riders.
    id: 'later-target',
    example: 'Arc Trail (28) -  \n\nSelect any other target (1 damage)\nParent Targeted:[Tireless Tracker (93)]',
    test: (c) => c.parts.parentTargeted.length > 0,
    words: (c) => {
      const { object, amount } = askObject(c.parts.ask);
      const earlier = c.parts.parentTargeted.map(c.nameOf);
      const different = /\b(other|another|different)\b/i.test(object);
      const first = earlier.length === 1 ? `First target: ${earlier[0]}.` : `Targets so far: ${listWords(earlier)}.`;
      const now = different ? 'Choose a different target for the rest of the effect.' : 'Now choose the target for the rest of the effect.';
      return { title: choose(c, object, (amount ? ` (${amount})` : '') + countTail(c, object)), context: `${first} ${now}` };
    },
  },
  {
    // A cost that sacrifices (Carrion Feeder, Woe Strider, Yawgmoth, Priest of Forgotten Gods).
    id: 'sacrifice-cost',
    example: 'Priest of Forgotten Gods (28)\n - {T}, Sacrifice two other creatures: Any number of target players each lose 2 life and sacrifice a creature. You add {B}{B} and draw a card.\nSelect other creature to sacrifice (2 left)',
    test: (c) => SACRIFICE.test(c.parts.ask),
    words: (c) => {
      const m = SACRIFICE.exec(c.parts.ask)!;
      const kind = (m[1] ?? '').trim().toLowerCase();
      const noun = m[2]!.trim();
      // Forge counts down what is left ("(1 left)"): the words follow its count, not the frame's.
      const left = Number(m[3]);
      const other = kind ? 'other ' : '';
      const what =
        left === 1
          ? `${kind === 'another' ? 'another' : kind === 'other' ? 'one other' : /^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`
          : `${left} ${other}${noun}s`;
      return { title: `${lead(c)}${c.sourceName ? 'sacrifice' : 'Sacrifice'} ${what}`, context: 'This is part of the cost. Cancel takes back the whole activation.' };
    },
  },
  {
    // "Deals N damage divided as you choose": Inferno Titan, Electrolyze, Fire // Ice's Fire.
    id: 'divide-damage',
    example:
      'Inferno Titan (9) - Whenever Inferno Titan enters or attacks, it deals 3 damage divided as you choose among one, two, or three targets.\n\nSelect any target to distribute damage to\nTargeted: \nGoblin Shaman Token (126)\n(2 more can be targeted)',
    test: (c) => /\bdistribute damage\b|\bdivide/i.test(c.parts.ask),
    words: (c) => ({
      title: `${lead(c)}${c.sourceName ? 'choose' : 'Choose'} the targets to divide the damage among${c.max > 1 ? ` (up to ${c.max})` : ''}`,
      context: soFar(c),
    }),
  },
  {
    // Forge's own target syntax in place of words (Sun Titan: "Select target Permanent.YouCtrl+cmcLE3").
    id: 'forge-syntax',
    example: 'Sun Titan (23) - Whenever Sun Titan enters or attacks, you may return target permanent card with mana value 3 or less from your graveyard to the battlefield.\n\nSelect target Permanent.YouCtrl+cmcLE3',
    test: (c) => FORGE_SYNTAX.test(c.parts.ask),
    words: (c) => ({ title: choose(c, 'a target', countTail(c, '')), context: c.parts.ability ? null : 'The card’s text says which targets are legal; the engine highlights them.' }),
  },
  {
    // A slot that takes several: "Select target player\n(2 more can be targeted)", Reveillark's "up to two".
    id: 'several-targets',
    example: 'Priest of Forgotten Gods (28) - {T}, Sacrifice two other creatures: Any number of target players each lose 2 life and sacrifice a creature.\n\nSelect target player\nTargeted: \nForge AI\n(1 more can be targeted)',
    test: (c) => /^(Select|Choose)\b/i.test(c.parts.ask) && (c.max > 1 || c.parts.more !== null || c.parts.targeted.length > 0),
    words: (c) => {
      const { object, amount } = askObject(c.parts.ask);
      const done = c.parts.targeted.length > 0 && c.ok.enabled ? ` Press ${c.ok.label} when you are done.` : '';
      const opt = c.min === 0 && c.parts.targeted.length === 0 && c.ok.enabled ? `Optional — press ${c.ok.label} to choose none.` : null;
      const so = soFar(c);
      return { title: choose(c, object, (amount ? ` (${amount})` : '') + countTail(c, object)), context: so ? so + done : opt };
    },
  },
  {
    // "Select up to one target creature", and Yawgmoth's min-0 "Select target creature".
    id: 'optional-target',
    example: "Ant-Man's Air Force (23) - Whenever this creature attacks, up to one target creature gets -1/-0 until end of turn.\n\nSelect up to one target creature",
    test: (c) => /^(Select|Choose)\b/i.test(c.parts.ask) && c.min === 0 && c.max === 1,
    words: (c) => {
      const { object, amount } = askObject(c.parts.ask);
      const said = /\bup to\b/i.test(object);
      return {
        title: choose(c, object, (amount ? ` (${amount})` : '') + (said ? '' : ' (optional)')),
        context: c.ok.enabled ? `Optional — press ${c.ok.label} to choose none.` : null,
      };
    },
  },
  {
    // One target: "Select target creature", "Choose target creature card in a graveyard", "Select any target (2 damage)".
    id: 'one-target',
    example: 'Depower (8) - Target creature gets -4/-0 until end of turn. Draw a card.\n\nSelect target creature',
    test: (c) => /^(Select|Choose)\b/i.test(c.parts.ask),
    words: (c) => {
      const { object, amount } = askObject(c.parts.ask);
      return { title: choose(c, object, amount ? ` (${amount})` : ''), context: null };
    },
  },
];

/**
 * The words for a target or choice prompt, or null when no rule takes it
 * (the caller keeps Forge's instruction line).
 */
export function promptWords(c: PromptContext): PromptWords | null {
  for (const r of PROMPT_RULES) if (r.test(c)) return { rule: r.id, ...r.words(c) };
  return null;
}
