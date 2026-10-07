/*
 * ForgeCoach — e2e/playtest/report.mjs
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The playtest's report: report.json (everything) and report.md (per game:
 * result, turns, decisions, findings with their screenshots; then the
 * findings grouped across games, and the coach's latency when it ran).
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';

/** "card 123 (Skullclamp)" and "turn 7" read the same across games: the shape of a finding. */
export function findingShape(f) {
  return `${f.kind}: ${String(f.what ?? '').replace(/\b\d+\b/g, 'N').replace(/"[^"]*"/g, '"…"')}`;
}

function pct(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, median: q(0.5), p90: q(0.9), max: s[s.length - 1] };
}

export function writeReport(out, report) {
  const games = report.games ?? [];
  const all = [...games.flatMap((g) => g.findings ?? []), ...(report.matches ?? []).flatMap((m) => m.findings ?? [])];
  const shapes = new Map();
  for (const f of all) {
    const k = findingShape(f);
    const e = shapes.get(k) ?? { shape: k, count: 0, games: new Set(), example: f };
    e.count++;
    e.games.add(f.game ?? '?');
    shapes.set(k, e);
  }
  const results = {};
  for (const g of games) results[g.result ?? 'unknown'] = (results[g.result ?? 'unknown'] ?? 0) + 1;
  const lat = pct(games.flatMap((g) => g.coach?.latencyMs ?? []));
  const rare = {};
  for (const g of games) for (const st of Object.values(g.stats ?? {})) for (const [k, n] of Object.entries(st.rare ?? {})) rare[k] = (rare[k] ?? 0) + n;
  const summary = {
    games: games.length,
    matches: (report.matches ?? []).length,
    results,
    findings: all.length,
    distinct: shapes.size,
    rarePaths: rare,
    coachLatencyMs: lat,
    line: `playtest: ${games.length} game(s)${report.matches?.length ? `, ${report.matches.length} best-of-three(s)` : ''}; ${Object.entries(results).map(([k, n]) => `${n} ${k}`).join(', ') || 'none'}; ${all.length} finding(s) of ${shapes.size} kind(s)${report.error ? '; ERROR' : ''}`,
  };
  report.summary = summary;
  writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));

  const md = [];
  md.push(`# ForgeCoach playtest`, '');
  md.push(`${report.started} → ${report.finished ?? 'running'} · mode \`${report.options?.mode}\` · seed ${report.options?.seed} · coach ${report.options?.coach}`, '');
  md.push(`**${summary.line}**`, '');
  if (report.error) md.push('```', report.error, '```', '');
  if (report.matches?.length) {
    md.push('## Best of three', '', '| Match | Cube | Result | Games | Findings |', '|---|---|---|---|---|');
    for (const m of report.matches) md.push(`| ${m.id} | ${m.cube} | ${m.result} | ${m.games.join(', ')} | ${m.findings.length} |`);
    md.push('');
  }
  md.push('## Games', '', '| Game | Decks | Result | Turns | Decisions | Clicks | Findings | Time |', '|---|---|---|---|---|---|---|---|');
  for (const g of games) {
    const decks = Object.values(g.decks ?? {}).join(' vs ');
    const dec = Object.values(g.decisions ?? {}).join(' + ');
    const cl = Object.values(g.clicks ?? {}).join(' + ');
    md.push(`| ${g.id} | ${decks}${g.aiProfile ? ` [${g.aiProfile}]` : ''} | ${g.result}${g.reason ? ` (${g.reason})` : ''} | ${g.turns ?? ''} | ${dec} | ${cl} | ${(g.findings ?? []).length} | ${g.seconds ?? ''} s |`);
  }
  md.push('');
  if (Object.keys(rare).length) {
    md.push('## Paths exercised', '', Object.entries(rare).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · '), '');
  }
  md.push('## Findings by kind', '');
  if (!shapes.size) md.push('None.', '');
  for (const e of [...shapes.values()].sort((a, b) => b.count - a.count)) {
    const f = e.example;
    md.push(`- **${e.shape}** — ${e.count}× in game(s) ${[...e.games].join(', ')}`);
    md.push(`  - e.g. game ${f.game}, ${f.seat ?? ''}, turn ${f.turn ?? '?'} ${f.phase ?? ''}, frame ${f.frame ?? '?'} (seq ${f.seq ?? '?'}): ${f.what}${f.why ? ` — ${f.why}` : ''}`);
    if (f.prompt) md.push(`  - prompt: \`${String(f.prompt).replace(/\n/g, ' ⏎ ').slice(0, 200)}\``);
    if (f.ask) md.push(`  - ask: ${f.ask.kind} "${f.ask.prompt ?? ''}" [${(f.ask.options ?? []).join(' | ')}]`);
    if (f.card) md.push(`  - card: ${JSON.stringify(f.card)}`);
    if (f.ui) md.push(`  - board: ${JSON.stringify(f.ui)}`);
    if (f.shot) md.push(`  - screenshot: [${f.shot}](${f.shot})`);
  }
  md.push('');
  if (lat || games.some((g) => g.coach)) {
    md.push('## Coach', '');
    if (lat) md.push(`Latency per answered question (ms, request to the end of the stream): n ${lat.n}, median ${lat.median}, p90 ${lat.p90}, max ${lat.max}.`, '');
    for (const g of games) if (g.coach) md.push(`- game ${g.id}: ${g.coach.questions} question(s), ${g.coach.answered ?? '?'} answered (${g.coach.latencySource ?? 'page'}), per round ${JSON.stringify(g.coach.perRound)}, blank samples ${g.coach.blankSamples}/${g.coach.oppTurnSamples}${g.coach.stopped ? `, ${g.coach.stopped} stopped or superseded` : ''}${g.coach.latencyMs?.length ? `; latency in order (ms): ${g.coach.latencyMs.join(', ')}` : ''}${g.coach.firstTextMs?.length ? `; first text (ms): ${g.coach.firstTextMs.join(', ')}` : ''}${g.coach.promptKB?.length ? `; prompt (KB): ${g.coach.promptKB.join(', ')}` : ''}`);
    md.push('');
  }
  writeFileSync(path.join(out, 'report.md'), md.join('\n'));
  return summary;
}
