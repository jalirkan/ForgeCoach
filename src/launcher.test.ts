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
  run)      mkdir -p "$out"; for _ in $(seq 1 25); do printf '{"ms":{"draft":1000,"build":500,"match":%s},"match":{"games":[{"ms":1}]}}\\n' "\${FAKE_MATCH_MS:-6500}"; done >"$out/drafts.jsonl" ;;
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
  fs.rmSync(path.join(home, '.config'), { recursive: true, force: true });
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

  describe('overnight', { timeout: 60_000 }, () => {
    it('--dry-run prints the whole plan and runs nothing', async () => {
      resetState();
      const r = await run(['overnight', '--dry-run', '--jobs', '3']);
      expect(r.code).toBe(0);
      expect(calls()).toEqual([]);
      expect(r.out).toContain(
        'tools/cubelab.sh evolve cubes/omega-cube-180.md --pool cubes/omega-seed-pool.tsv --generations 8 --drafts-per-gen 1200 --jobs 3 --seed 1 --out var/cubelab/evolve/omega-overnight-g8-d1200',
      );
      for (const c of ['synergy', 'modern-era', 'vintage', 'pauper']) {
        expect(r.out).toContain(
          `tools/cubelab.sh run cubes/${c}-cube-180.md --format grid --drafts 2000 --jobs 3 --seed 1 --out var/cubelab/runs/${c}-cube-180-overnight-n2000`,
        );
        expect(r.out).toContain(`tools/cubelab.sh report var/cubelab/runs/${c}-cube-180-overnight-n2000`);
      }
      expect(r.out).toContain(
        'tools/cubelab.sh selfplay cubes/synergy-cube-180.md --from var/cubelab/runs/synergy-cube-180-overnight-n2000 --iterations 4 --drafts-per-iter 1000 --h2h 1000 --deck-h2h 500 --games 1 --deck-synergy on --jobs 3 --out var/cubelab/selfplay/synergy-overnight-i4-d1000-h1000-k500',
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
        'mtg-table run cubes/synergy-cube-180.md --format grid --drafts 2000 --jobs 2 --seed 1 --out var/cubelab/runs/synergy-cube-180-overnight-n2000',
        'mtg-table report var/cubelab/runs/synergy-cube-180-overnight-n2000',
        'mtg-table selfplay cubes/synergy-cube-180.md --from var/cubelab/runs/synergy-cube-180-overnight-n2000 --iterations 4 --drafts-per-iter 1000 --h2h 1000 --deck-h2h 500 --games 1 --deck-synergy on --jobs 2 --out var/cubelab/selfplay/synergy-overnight-i4-d1000-h1000-k500',
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

    describe('sizes', () => {
      const dry = (args: string[], env: Record<string, string> = {}) => run(['overnight', '--dry-run', '--jobs', '4', ...args], env);

      it('size flags change the commands, the folder names and the plan', async () => {
        resetState();
        const r = await dry(['--evolve-gens', '3', '--evolve-drafts', '900', '--meta-drafts', '500', '--learn-iters', '2', '--learn-drafts', '600', '--learn-h2h', '700', '--learn-deck-h2h', '350']);
        expect(r.code).toBe(0);
        expect(r.out).toContain('--generations 3 --drafts-per-gen 900 --jobs 4 --seed 1 --out var/cubelab/evolve/omega-overnight-g3-d900');
        expect(r.out).toContain('--drafts 500 --jobs 4 --seed 1 --out var/cubelab/runs/pauper-cube-180-overnight-n500');
        expect(r.out).toContain('--iterations 2 --drafts-per-iter 600 --h2h 700 --deck-h2h 350 --games 1 --deck-synergy on --jobs 4 --out var/cubelab/selfplay/synergy-overnight-i2-d600-h700-k350');
        expect(r.out).toContain('Sizes: evolve 3 generations x 900 drafts; meta 500 drafts per cube; learn 2 iterations x 600 drafts, h2h 700, deck h2h 350');
      });

      it('refuses bad sizes, and warns when evolve drafts are under the useful minimum', async () => {
        for (const f of ['--evolve-gens', '--evolve-drafts', '--meta-drafts', '--learn-iters', '--learn-drafts', '--learn-h2h', '--learn-deck-h2h']) {
          for (const v of ['0', 'x', '-3', '1.5']) {
            const r = await dry([f, v]);
            expect(r.code, `${f} ${v}`).toBe(2);
            expect(r.out).toContain(f);
          }
          expect((await dry([f])).code).toBe(2);
        }
        expect((await dry(['--budget-hours', '0'])).code).toBe(2);
        expect((await dry(['--budget-hours', 'abc'])).code).toBe(2);
        const low = await dry(['--evolve-drafts', '200']);
        expect(low.code).toBe(0);
        expect(low.out).toContain('insufficient data');
      });

      it('a size change never resumes into, or skips as done, a run with other sizes', async () => {
        resetState();
        const a = await run(['overnight', '--no-pull', '--jobs', '1', '--only', 'pauper', '--meta-drafts', '600']);
        expect(a.code).toBe(0);
        expect(calls()[0]).toContain('--drafts 600 --jobs 1 --seed 1 --out var/cubelab/runs/pauper-cube-180-overnight-n600');
        const same = await run(['overnight', '--no-pull', '--jobs', '1', '--only', 'pauper', '--meta-drafts', '600']);
        expect(same.out).toContain('meta-pauper: already done');
        expect(calls()).toHaveLength(2);
        const other = await run(['overnight', '--no-pull', '--jobs', '1', '--only', 'pauper', '--meta-drafts', '700']);
        expect(other.out).not.toContain('meta-pauper: already done');
        expect(calls()[2]).toContain('--out var/cubelab/runs/pauper-cube-180-overnight-n700');
        expect(calls()).toHaveLength(4);
        expect(fs.existsSync(path.join(mtg, 'var/cubelab/runs/pauper-cube-180-overnight-n600/drafts.jsonl'))).toBe(true);
        expect(fs.existsSync(path.join(mtg, 'var/cubelab/runs/pauper-cube-180-overnight-n700/drafts.jsonl'))).toBe(true);
      });

      it('status shows the sizes of the run, the speed and the stop command', async () => {
        resetState();
        await run(['overnight', '--no-pull', '--jobs', '1', '--only', 'pauper', '--meta-drafts', '600']);
        const st = await run(['status']);
        expect(st.out).toContain('meta 600 per cube');
        expect(st.out).toContain('measured on this PC: 8.0 s/draft');
        expect(st.out).toContain('[done] meta-pauper');
      });
    });

    describe('measured speed and the budget', () => {
      it('assumes 10 s/draft until measured, then stores and uses the measured value', async () => {
        resetState();
        const d0 = await run(['overnight', '--dry-run', '--jobs', '7', '--only', 'pauper']);
        expect(d0.out).toContain('assumed 10 s/draft');
        // 2000 drafts x 10 s / 7 workers = 2857 s = 48 min
        expect(d0.out).toContain('about 48 min at 7 workers');
        await run(['overnight', '--no-pull', '--jobs', '1', '--only', 'pauper', '--meta-drafts', '600']); // fake drafts: 1000+500+6500 ms = 8 s
        expect(fs.readFileSync(path.join(home, '.config/forgecoach/config'), 'utf8')).toContain('OVN_SEC_PER_DRAFT=8.0');
        const d1 = await run(['overnight', '--dry-run', '--jobs', '7', '--only', 'pauper']);
        expect(d1.out).toContain('about 39 min at 7 workers (measured on this PC: 8.0 s/draft');
      });

      it('--budget-hours scales the drafts in proportion, never below the minimums', async () => {
        resetState();
        const r = await run(['overnight', '--dry-run', '--jobs', '7', '--budget-hours', '7']);
        expect(r.code).toBe(0);
        // at the defaults the queue is about 9 h of 10 core-seconds; about 80%
        const evo = /--drafts-per-gen (\d+)/.exec(r.out);
        const meta = /--drafts (\d+) --jobs 7/.exec(r.out);
        expect(Number(evo?.[1])).toBeGreaterThan(865);
        expect(Number(evo?.[1])).toBeLessThan(1200);
        expect(Number(meta?.[1])).toBeGreaterThan(500);
        expect(Number(meta?.[1])).toBeLessThan(2000);
        expect(Number(evo?.[1]) / 1200).toBeCloseTo(Number(meta?.[1]) / 2000, 1);
        expect(r.out).toContain('--budget-hours 7');
        expect(r.out).toMatch(/In all, about (6\.\d|7) h at 7 workers/);

        const tiny = await run(['overnight', '--dry-run', '--jobs', '7', '--budget-hours', '0.5']);
        expect(tiny.out).toContain('--drafts-per-gen 865 ');
        expect(tiny.out).toMatch(/--drafts 500 --jobs 7/);
        expect(tiny.out).toContain('--drafts-per-iter 300 --h2h 400 --deck-h2h 200');
        expect(tiny.out).toContain('minimum sizes');

        const big = await run(['overnight', '--dry-run', '--jobs', '7', '--budget-hours', '18', '--only', 'pauper']);
        expect(big.out).toMatch(/--drafts (\d+) --jobs 7/);
        expect(Number(/--drafts (\d+) --jobs 7/.exec(big.out)?.[1])).toBeGreaterThan(2000);
      });
    });

    describe('workers', () => {
      const fakeBin = (name: string, files: Record<string, string>): string => {
        const d = path.join(root, name);
        for (const [f, body] of Object.entries(files)) sh(path.join(d, f), `#!/usr/bin/env bash\n${body}\n`);
        return `${d}:${bin}:${process.env.PATH ?? ''}`;
      };
      const workers = (out: string): string => /Jobs in parallel inside a job: (\d+)/.exec(out)?.[1] ?? '';

      it('defaults to physical cores - 1 (lscpu counts unique core+socket)', async () => {
        const PATH = fakeBin('lscpu-bin', {
          lscpu: 'printf "# Core,Socket\\n"; for i in 0 1 2 3 4 5 6 7; do echo "$i,0"; echo "$i,0"; done',
          nproc: 'echo 16',
        });
        const r = await run(['overnight', '--dry-run'], { PATH, FORGECOACH_MEM_GB: '30' });
        expect(r.out).toContain('Cores: 8 physical (16 threads)');
        expect(workers(r.out)).toBe('7');
      });

      it('falls back to /proc/cpuinfo ids, then to threads / 2', async () => {
        const cpuinfo = path.join(root, 'cpuinfo');
        const entries: string[] = [];
        for (let t = 0; t < 12; t++) entries.push(`processor\t: ${t}\nphysical id\t: ${t % 2}\ncore id\t\t: ${Math.floor(t / 2) % 3}\n`);
        fs.writeFileSync(cpuinfo, entries.join('\n')); // 2 sockets x 3 cores = 6 physical
        const PATH = fakeBin('nolscpu-bin', { lscpu: 'exit 1', nproc: 'echo 12' });
        const a = await run(['overnight', '--dry-run'], { PATH, FORGECOACH_CPUINFO: cpuinfo, FORGECOACH_MEM_GB: '30' });
        expect(a.out).toContain('Cores: 6 physical (12 threads)');
        expect(workers(a.out)).toBe('5');
        const b = await run(['overnight', '--dry-run'], { PATH, FORGECOACH_CPUINFO: path.join(root, 'none'), FORGECOACH_MEM_GB: '30' });
        expect(b.out).toContain('Cores: 6 physical (12 threads)');
        expect(workers(b.out)).toBe('5');
      });

      it('keeps the RAM cap (about 4 GB a JVM); an explicit --jobs wins but warns', async () => {
        const PATH = fakeBin('ram-bin', { lscpu: 'printf "# c\\n"; for i in 0 1 2 3 4 5 6 7; do echo "$i,0"; done', nproc: 'echo 16' });
        const r = await run(['overnight', '--dry-run'], { PATH, FORGECOACH_MEM_GB: '12' });
        expect(workers(r.out)).toBe('3');
        const e = await run(['overnight', '--dry-run', '--jobs', '8'], { PATH, FORGECOACH_MEM_GB: '12' });
        expect(workers(e.out)).toBe('8');
        expect(e.out).toContain('may not fit');
      });
    });

    it('status does not complain about a meta job that has not started', async () => {
      resetState();
      await run(['overnight', '--no-pull', '--jobs', '1', '--only', 'pauper', '--hours', '0']);
      const st = await run(['status']);
      expect(st.out).not.toContain('No such file');
    });

    it('--stop does nothing when nothing runs; TERM stops a running lab cleanly (child stopped, state stopped)', async () => {
      resetState();
      expect((await run(['overnight', '--stop'])).out).toContain('No overnight lab is running');
      // a cubelab that takes a while, and records that it was stopped
      const slow = path.join(mtg, 'tools', 'cubelab.sh');
      const orig = fs.readFileSync(slow, 'utf8');
      sh(slow, `#!/usr/bin/env bash\necho "$$" >"$FAKE_PIDFILE"\ntrap 'echo child-term >>"$FAKE_LOG"; exit 0' TERM\nwhile true; do sleep 0.2; done\n`);
      const pidfile = path.join(root, 'child.pid');
      fs.rmSync(pidfile, { force: true });
      try {
        const lab = execFile('bash', [SCRIPT, 'overnight', '--no-pull', '--jobs', '1', '--only', 'pauper'], {
          env: { PATH: `${bin}:${process.env.PATH ?? ''}`, HOME: home, FORGECOACH_MTG: mtg, FORGECOACH_NO_INHIBIT: '1', FORGECOACH_NO_UPDATE: '1', FAKE_LOG: log, FAKE_NOTIFY: path.join(root, 'notify.log'), FAKE_PIDFILE: pidfile },
        });
        const exited = new Promise<void>((ok) => lab.once('exit', () => ok()));
        for (let i = 0; i < 100 && !fs.existsSync(pidfile); i++) await new Promise((r) => setTimeout(r, 100));
        expect(fs.existsSync(pidfile)).toBe(true);
        const st = await run(['status']);
        expect(st.out).toContain('overnight --stop');
        const stop = await run(['overnight', '--stop']);
        expect(stop.code).toBe(0);
        expect(stop.out).toContain('Stopped');
        await exited;
        expect(calls()).toContain('child-term');
        const after = await run(['status']);
        expect(after.out).toContain('Last run: stopped');
      } finally {
        fs.writeFileSync(slow, orig, { mode: 0o755 });
      }
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
