/*
 * ForgeCoach — e2e/playtest/scripts.mjs
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * What a card can do outside "cast it from your hand", from Forge's own card
 * scripts (res/cardsfolder/cardsfolder.zip in the Forge release the engine
 * runs). An engine before mtg-table M61 does not list what is playable
 * (protocol §3.2: `abilities` is `[]` in every recording; Forge's
 * InputPassPriority judges any click; since M61 `state.playable` lists the
 * cards outside the battlefield, and the monkey uses that instead), so the
 * playtest's priority candidates —
 * the cards whose click the engine may accept — come from here: activated
 * abilities on the battlefield (Equip, Crew…), abilities usable from the hand
 * (cycling, channel, ninjutsu…), and casting or activating from the graveyard
 * (flashback, unearth, escape…). The engine stays the judge of each click;
 * this only says where the board must offer one.
 *
 * Without the zip (no Forge release on the machine, the fake engine) every
 * card has no extra abilities and the candidates are the hand and the board.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const BF_KEYWORDS = /^(Equip|Crew|Reconfigure|Fortify|Level up|Outlast|Monstrosity|Adapt|Boast|Exhaust)\b/i;
const HAND_KEYWORDS = /^(Cycling|TypeCycling|Landcycling|Basic landcycling|Swampcycling|Islandcycling|Forestcycling|Mountaincycling|Plainscycling|Wizardcycling|Slivercycling|Channel|Ninjutsu|Bloodrush|Forecast|Transmute|Reinforce|Foretell)\b/i;
const GY_KEYWORDS = /^(Flashback|Unearth|Escape|Embalm|Eternalize|Disturb|Retrace|Jump-start|Scavenge|Encore|Aftermath|Dredge)\b/i;

/** One card's script → the flags the playtest uses. */
export function parseScript(text) {
  const out = { name: null, types: '', bf: [], hand: [], gy: [], manaOnly: false };
  for (const line of text.split(/\r?\n/)) {
    if (line === 'ALTERNATE') break; // the other face is not castable from where this one is
    const [k, ...rest] = line.split(':');
    const v = rest.join(':');
    if (k === 'Name' && out.name === null) out.name = v.trim();
    else if (k === 'Types') out.types = v.trim();
    else if (k === 'K') {
      const kw = v.trim();
      if (BF_KEYWORDS.test(kw)) out.bf.push(kw.split(':')[0]);
      else if (HAND_KEYWORDS.test(kw) || /cycling/i.test(kw.split(':')[0])) out.hand.push(kw.split(':')[0]);
      else if (GY_KEYWORDS.test(kw)) out.gy.push(kw.split(':')[0]);
    } else if (k === 'A' && /^\s*AB\$/.test(v)) {
      const zone = /ActivationZone\$\s*(\w+)/.exec(v)?.[1] ?? 'Battlefield';
      const mana = /^\s*AB\$\s*Mana\b/.test(v);
      const what = mana ? 'mana' : 'ability';
      if (/^Hand$/i.test(zone)) out.hand.push(what);
      else if (/^Graveyard$/i.test(zone)) out.gy.push(what);
      else if (/^Battlefield$/i.test(zone)) out.bf.push(what);
    }
  }
  out.manaOnly = out.bf.length > 0 && out.bf.every((x) => x === 'mana');
  return out;
}

/**
 * An index of card name → flags. Built once from the zip (about 33 000
 * scripts) and cached as JSON beside the report.
 */
export function loadScripts({ zip, cache }) {
  if (cache && existsSync(cache)) {
    try {
      return new Map(Object.entries(JSON.parse(readFileSync(cache, 'utf8'))));
    } catch {
      /* rebuild */
    }
  }
  const map = new Map();
  if (!zip || !existsSync(zip)) return map;
  const all = execFileSync('unzip', ['-p', zip], { maxBuffer: 512 * 1024 * 1024 }).toString('utf8');
  for (const chunk of all.split(/\n(?=Name:)/)) {
    const s = parseScript(chunk);
    if (!s.name || map.has(s.name)) continue;
    if (s.bf.length || s.hand.length || s.gy.length) map.set(s.name, { bf: s.bf, hand: s.hand, gy: s.gy, manaOnly: s.manaOnly });
  }
  if (cache) writeFileSync(cache, JSON.stringify(Object.fromEntries(map)));
  return map;
}

/** Flags for a card name (front face for "A // B"). */
export function flagsOf(scripts, name) {
  if (!name) return null;
  return scripts.get(name) ?? scripts.get(name.split(' // ')[0]) ?? null;
}
