/*
 * ForgeCoach — play/aiName.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * What the board calls the AI seat. mtg-table's bridge names the AI policy the
 * match was started with in `hello_ok.match.aiPolicy` (amendment M56: plain,
 * outlets or search — what match setup's opponent-AI picker chose), read
 * through `aiPolicyOf`, the protocol file's one reader of it. The board shows
 * the picker's own name for it (`AI_POLICIES`, without the picker's
 * parenthetical aside: "Search AI", not "Search AI (stronger, slower)").
 *
 * An engine from before M56 does not send the key, and an AI-vs-AI recording
 * never does: then the seat keeps the name the engine gave it (`players[].name`,
 * "Forge AI"), exactly as before. Only a seat `players[]` marks `isAi`, and never
 * the viewer's own, is renamed. The policy is the player's own choice, public
 * at the table; nothing here reads a card.
 */
import { aiPolicyOf, type HelloOkBody } from '../protocol.ts';
import { AI_POLICIES, type AiPolicy } from '../draft/launch.ts';

/** The opponent-AI picker's name for `policy`, without its parenthetical aside. */
export function aiPolicyName(policy: AiPolicy): string {
  const label = AI_POLICIES.find((p) => p.id === policy)?.label ?? policy;
  return label.replace(/\s*\([^)]*\)\s*$/, '');
}

/**
 * The name to show for `player`: the chosen AI's name when the handshake says
 * which AI answers for this seat, otherwise `player.name` (or `fallback` when the
 * seat has no name or is unknown).
 */
export function seatDisplayName(
  hello: HelloOkBody | null | undefined,
  player: { id: number; name: string; isAi?: boolean } | null | undefined,
  fallback = 'Forge AI',
): string {
  const own = player?.name ? player.name : fallback;
  if (!player || !hello || player.id === hello.you) return own;
  const isAi = player.isAi ?? hello.players.find((p) => p.id === player.id)?.isAi ?? false;
  if (!isAi) return own;
  const policy = aiPolicyOf(hello);
  return policy ? aiPolicyName(policy) : own;
}
