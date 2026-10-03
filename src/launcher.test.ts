/*
 * ForgeCoach — launcher.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * public/forgecoach.sh, the one-click launcher: it parses, its help lists the
 * commands, and `overnight` (the cube lab's AI-vs-AI queue) plans, runs,
 * resumes, copies its results and reports in `status` -- against a fake
 * mtg-table whose tools/cubelab.sh only records what it was asked.
 */
import { execFile, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../public/forgecoach.sh', import.meta.url));
const hasBash = spawnSync('bash', ['--version']).status === 0;

let root = '';
let home = '';
let mtg = '';
let bin = '';
let log = '';

const FAKE_CUBELAB = `#!/usr/bin/env bash
# Records every call; writes the files the real tool would leave behind.
echo "$(pwd | sed "s|.*/||") $*" >>"$FAKE_LOG"
out=""; prev=""
for a in "$@"; do [ "$prev" = "--out" ] && out="$a"; prev="$a"; done
case "$1" in
  run)      mkdir -p "$out"; echo '{}' >"$out/drafts.jsonl" ;;
  report)   echo '{"schema":1,"cube":{"name":"X"}}' >"$2/meta.json"; echo '<html>' >"$2/report.html" ;;
  evolve)   mkdir -p "$out/gen-01"; echo '{}' >"$out/gen-01/result.json"; echo cube >"$out/omega-cube-180.md"; echo log >"$out/changelog.md"; echo '<html>' >"$out/index.html" ;;
  selfplay) mkdir -p "$out"; echo r >"$out/values-1.ratings.tsv"; echo r >"$out/values-2.ratings.tsv"; echo s >"$out/values-2.synergy.tsv"; echo m >"$out/summary.md" ;;
esac
[ -n "\${FAKE_FAIL:-}" ] && [ "$1" = "\${FAKE_FAIL}" ] && exit 3
exit 0
`;

function sh(file: string, body: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, { mode: 0o755 });
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-launcher-'));
  home = path.join(root, 'home');
  mtg = path.join(home, 'mtg-table');
  bin = path.join(root, 'bin');
  log = path.join(root, 'cubelab.log');
  const forge = path.join(home, 'forge');
  fs.mkdirSync(path.join(forge, 'res'), { recursive: true });
  fs.writeFileSync(path.join(forge, 'forge-gui-desktop-2.0.14-jar-with-dependencies.jar'), 'x');
  fs.mkdirSync(path.join(mtg, 'tools', 'cubelab'), { recursive: true });
  fs.mkdirSync(path.join(mtg, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(mtg, 'bridge'), { recursive: true });
  for (const f of ['scripts/play.sh', 'tools/check-forge.sh', 'bridge/build.sh']) sh(path.join(mtg, f), '#!/usr/bin/env bash\n');
  fs.writeFileSync(path.join(mtg, 'config.json'), JSON.stringify({ forgeJar: path.join(forge, 'forge-gui-desktop-2.0.14-jar-with-dependencies.jar') }));
  fs.writeFileSync(path.join(mtg, 'tools', 'cubelab', 'cli.ts'), '// tools/cubelab.sh evolve ...\n// tools/cubelab.sh selfplay ...\n');
  sh(path.join(mtg, 'tools', 'cubelab.sh'), FAKE_CUBELAB);
  sh(path.join(bin, 'java'), '#!/usr/bin/env bash\ncase "$1" in --list-modules) echo jdk.compiler@21 ;; *) echo \'openjdk version "21.0.2" 2024-01-16\' >&2 ;; esac\n');
  sh(path.join(bin, 'notify-send'), '#!/usr/bin/env bash\necho "$*" >>"$FAKE_NOTIFY"\n');
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function run(args: string[], env: Record<string, string> = {}): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(
      'bash',
      [SCRIPT, ...args],
      {
        timeout: 60_000,
        env: {
          PATH: `${bin}:${process.env.PATH ?? ''}`,
          HOME: home,
          FORGECOACH_MTG: mtg,
          FORGECOACH_NO_INHIBIT: '1',
          FORGECOACH_NO_UPDATE: '1',
          FAKE_LOG: log,
          FAKE_NOTIFY: path.join(root, 'notify.log'),
          ...env,
        },
      },
      (err, stdout, stderr) => resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, out: `${stdout}${stderr}` }),
    );
  });
}

const calls = (): string[] => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : []);
const resetState = (): void => {
  fs.rmSync(log, { force: true });
  fs.rmSync(path.join(home, '.cache'), { recursive: true, force: true });
  fs.rmSync(path.join(home, '.local'), { recursive: true, force: true });
  fs.rmSync(path.join(mtg, 'var'), { recursive: true, force: true });
};

describe.skipIf(!hasBash)('forgecoach.sh', () => {
  it('parses with bash -n and keeps its marker lines', () => {
    expect(spawnSync('bash', ['-n', SCRIPT]).status).toBe(0);
    const text = fs.readFileSync(SCRIPT, 'utf8');
    expect(text.split('\n')[0]).toBe('#!/usr/bin/env bash');
    expect(text).toContain('# forgecoach-launcher: 1');
  });

  it('lists the overnight command in its help', async () => {
    const r = await run(['help']);
    expect(r.out).toMatch(/overnight \[options\]/);
    expect(r.out).toMatch(/--dry-run/);
  });

  it('writes the overnight app-menu entry on install', async () => {
    const r = await run(['install', '--no-pull'], { FORGECOACH_DOWNLOAD_URL: 'http://127.0.0.1:9/' });
    expect(r.out).toContain('ForgeCoach overnight lab');
    const d = fs.readFileSync(path.join(home, '.local/share/applications/forgecoach-overnight.desktop'), 'utf8');
    expect(d).toMatch(/^Name=ForgeCoach overnight lab$/m);
    expect(d).toMatch(/^Exec=.*forgecoach launch-overnight$/m);
  });

  describe('overnight', () => {
    it('--dry-run prints the whole plan and runs nothing', async () => {
      resetState();
      const r = await run(['overnight', '--dry-run', '--jobs', '3']);
      expect(r.code).toBe(0);
      expect(calls()).toEqual([]);
      expect(r.out).toContain(
        'tools/cubelab.sh evolve cubes/omega-cube-180.md --pool cubes/omega-seed-pool.tsv --generations 8 --drafts-per-gen 200 --jobs 3 --seed 1 --out var/cubelab/evolve/omega-overnight',
      );
      for (const c of ['synergy', 'modern-era', 'vintage', 'pauper']) {
        expect(r.out).toContain(
          `tools/cubelab.sh run cubes/${c}-cube-180.md --format grid --drafts 300 --jobs 3 --seed 1 --out var/cubelab/runs/${c}-cube-180-overnight`,
        );
        expect(r.out).toContain(`tools/cubelab.sh report var/cubelab/runs/${c}-cube-180-overnight`);
      }
      expect(r.out).toContain(
        'tools/cubelab.sh selfplay cubes/synergy-cube-180.md --from var/cubelab/runs/synergy-cube-180-overnight --iterations 4 --drafts-per-iter 300 --h2h 400 --deck-h2h 200 --games 1 --deck-synergy on --jobs 3 --out var/cubelab/selfplay/synergy-overnight',
      );
      // evolve first, selfplay last
      expect(r.out.indexOf('omega-cube-180.md')).toBeLessThan(r.out.indexOf('synergy-cube-180.md --format'));
      expect(r.out.indexOf('pauper-cube-180.md --format')).toBeLessThan(r.out.indexOf('selfplay'));
      expect(r.out).toContain('Import from file');
      expect(r.out).toContain('nothing was started');
    });

    it('--only narrows the queue, in queue order; an unknown job is refused', async () => {
      const r = await run(['overnight', '--dry-run', '--only', 'pauper,evolve', '--jobs', '2']);
      expect(r.out).toContain('evolve cubes/omega');
      expect(r.out).toContain('pauper-cube-180.md --format');
      expect(r.out).not.toContain('vintage-cube-180.md --format');
      expect(r.out).not.toContain('selfplay cubes');
      expect(r.out.indexOf('evolve cubes/omega')).toBeLessThan(r.out.indexOf('pauper-cube-180.md --format'));
      const bad = await run(['overnight', '--dry-run', '--only', 'bogus']);
      expect(bad.code).toBe(2);
      expect((await run(['overnight', '--jobs', '0', '--dry-run'])).code).toBe(2);
    });

    it('runs the queue one job at a time, copies the results, skips what is done, shows status', async () => {
      resetState();
      const r = await run(['overnight', '--no-pull', '--jobs', '2', '--only', 'synergy,learn']);
      expect(r.code).toBe(0);
      expect(calls()).toEqual([
        'mtg-table run cubes/synergy-cube-180.md --format grid --drafts 300 --jobs 2 --seed 1 --out var/cubelab/runs/synergy-cube-180-overnight',
        'mtg-table report var/cubelab/runs/synergy-cube-180-overnight',
        'mtg-table selfplay cubes/synergy-cube-180.md --from var/cubelab/runs/synergy-cube-180-overnight --iterations 4 --drafts-per-iter 300 --h2h 400 --deck-h2h 200 --games 1 --deck-synergy on --jobs 2 --out var/cubelab/selfplay/synergy-overnight',
      ]);
      const res = path.join(home, '.local/share/forgecoach');
      expect(JSON.parse(fs.readFileSync(path.join(res, 'meta/synergy.meta.json'), 'utf8')).schema).toBe(1);
      expect(fs.existsSync(path.join(res, 'reports/synergy-report.html'))).toBe(true);
      expect(fs.readFileSync(path.join(res, 'learned/synergy/values.synergy.tsv'), 'utf8')).toBe('s\n'); // the newest iteration's
      expect(fs.readFileSync(path.join(home, '.cache/forgecoach/overnight.log'), 'utf8')).toContain('$ tools/cubelab.sh report');
      expect(r.out).toContain('Import from file');
      expect(fs.readFileSync(path.join(root, 'notify.log'), 'utf8')).toContain('Overnight lab: 2 done');

      const again = await run(['overnight', '--no-pull', '--jobs', '2', '--only', 'synergy,learn']);
      expect(again.out).toContain('already done');
      expect(calls()).toHaveLength(3);

      const st = await run(['status']);
      expect(st.out).toContain('Overnight lab');
      expect(st.out).toContain('[done] meta-synergy');
      expect(st.out).toContain('synergy.meta.json');

      const redo = await run(['overnight', '--no-pull', '--jobs', '2', '--only', 'synergy', '--redo']);
      expect(redo.code).toBe(0);
      expect(calls()).toHaveLength(5);
    });

    it('a failed job is reported, the rest still run, and it is retried next time', async () => {
      resetState();
      const r = await run(['overnight', '--no-pull', '--jobs', '1', '--only', 'synergy,pauper'], { FAKE_FAIL: 'run' });
      expect(r.code).toBe(1);
      expect(r.out).toContain('meta-synergy: failed');
      expect(calls().filter((c) => c.includes(' run '))).toHaveLength(2); // pauper was still tried
      const st = await run(['status']);
      expect(st.out).toContain('[failed] meta-synergy');
    });

    it('--hours 0 starts nothing', async () => {
      resetState();
      const r = await run(['overnight', '--no-pull', '--jobs', '1', '--hours', '0']);
      expect(r.out).toContain('limit is up');
      expect(calls()).toEqual([]);
    });

    it('does not run beside a live engine without --yes; with --yes it does, at nice 19', async () => {
      resetState();
      const server = http.createServer((_q, s) => s.end('ok')).listen(0, '127.0.0.1');
      await new Promise((ok) => server.once('listening', ok));
      const port = (server.address() as { port: number }).port;
      fs.mkdirSync(path.join(home, '.cache/forgecoach'), { recursive: true });
      fs.writeFileSync(path.join(home, '.cache/forgecoach/engine.port'), `${port}\n`);
      try {
        const no = await run(['overnight', '--no-pull', '--jobs', '1', '--only', 'pauper']);
        expect(no.code).toBe(1);
        expect(no.out).toContain('engine is running');
        expect(calls()).toEqual([]);
        const yes = await run(['overnight', '--no-pull', '--jobs', '1', '--only', 'pauper', '--yes']);
        expect(yes.code).toBe(0);
        expect(yes.out).toContain('nice 19');
        expect(calls()).toHaveLength(2);
      } finally {
        server.close();
      }
    });
  });
});
