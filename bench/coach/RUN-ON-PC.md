# Comparing the old and the new coach prompt on the PC

<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

This checks the prompt change on branch `c/coach-prompt-tune` (numbered options,
shorter state and boilerplate, hidden-information and legality rules) against
the prompt on `main`. It needs the real coach, so it runs on the PC through the
local coach helper (Claude Code, logged in). No API key is needed.

## What changed, in bench terms

- The app prompt numbers an engine question's options and the legal targets
  from 1. The bench numbers its choices the same way and asks for
  `ANSWER: <option number> — <its label>`. Attack and block answers still use
  creature ids (`attack:21,26`, `block:23>64`).
- The scorer maps the number back to the choice's token. A number past the
  list, or a number whose label is another option's ("1 — 1" when option 1 is
  "0"), is a **format failure**, never a silent pick. A bare token
  (`cast:12`) is still read, so the old prompt's replies score as before.
- No case file changed. Both prompts are run on the same 28 cases.

## 0. Set up (once, about 5 minutes)

Start the engine and the helper as usual (`./scripts/play.sh --engine-only` in
mtg-table, which starts the helper on `http://127.0.0.1:8643`). Then make one
worktree per prompt, so each run uses its own code and nothing is switched
during a run:

```bash
cd ~/ForgeCoach && git fetch origin
git worktree add ../fc-old origin/main
git worktree add ../fc-new origin/c/coach-prompt-tune
(cd ../fc-old && npm ci) && (cd ../fc-new && npm ci)
(cd ../fc-new && npm run bench:coach -- --dry-run)   # must end "All cases build and every answer is legal."
```

The dry run also prints the prompt size. Measured here (28 cases, classic
layout, bench section included): **old mean 7,465 chars ≈ 1,866 tokens, new
mean 6,854 chars ≈ 1,714 tokens** (tokens ≈ chars ÷ 4, a rough count).

## 1. Time one answer first (about 1 minute)

```bash
cd ../fc-new && npm run bench:coach -- --only mulligan-trample7-curve --repeat 1 --label smoke
```

The report's "Latency per answer" line gives the time per call. A full run is
28 cases × 3 answers = **84 calls, one at a time**, so a run takes about
84 × that latency. No answer has been timed for this estimate; at 30–60 s per
answer that is 45–85 minutes per run, so the dev comparison (two runs) takes
roughly 1.5–3 hours. Delete the smoke files afterwards.

## 2. The comparison on the development set

Run both prompts with the same settings (`--repeat 3` is the default; keep
`--thinking` and `--model` the same on both or leave them out):

```bash
cd ../fc-old && npm run bench:coach -- --label old-prompt --repeat 3
cd ../fc-new && npm run bench:coach -- --label new-prompt --repeat 3
cp ../fc-old/bench/coach/results/*-old-prompt.json bench/coach/results/
npm run bench:coach -- --compare bench/coach/results/<time>-old-prompt.json bench/coach/results/<time>-new-prompt.json
```

Run `--compare` from `fc-new` (it reads both files). A run that ends with exit
status 3 had transport errors (the helper busy, a usage limit, the network):
fix the cause and rerun that run; its numbers are not to be compared.

Optional second pair, if the app is used with Settings → Answer first: repeat
both runs with `--prompt-format answer-first` and compare those two.

## 3. How to read the comparison

`--compare` prints, A = old, B = new:

- **Verdict line**: "B is better", "B is worse" or "no detectable difference".
  It is on mean regret when the cases carry regret tables, otherwise on the
  quality score (acceptable +1, blunder −1, other legal answer 0), with a 95%
  paired-bootstrap interval over cases. Today no case is graded, so the
  verdict is on the score.
- **Format failures A · B**: missing, unparsable or illegal answers, with
  Wilson intervals. The numbering change is aimed here: expect it not to rise.
- **Transport errors**: must be 0 in both runs.
- **Flips** and **unstable cases**: which cases moved beyond noise, and which
  are too noisy to read.
- **Median latency**: the shorter prompt should not be slower.

## 4. The rule for keeping the new prompt

Keep it when all of these hold on the development set:

1. Neither run has a transport error.
2. The headline (regret if graded, else score) is **not worse**: the verdict
   is not "B is worse", and the mean difference has the right sign or is zero
   (score: B − A ≥ 0; regret: B − A ≤ 0). "No detectable difference" with the
   right sign is enough: the new prompt is about 8% shorter and states the
   legality and hidden-information rules.
3. **Format failures do not rise**: B's rate is at most A's plus 5 points, and
   B's Wilson interval does not lie entirely above A's.

Before deciding, read the answers of every "worse" flip in the B file: a flip
is a case where every new answer scored below every old one.

Otherwise keep the old prompt and look at the worse flips and the format
failures' `note` fields (for example "no option 0", "the label given is option
2's") to see what went wrong. Change the prompt only from what the
development cases show.

## 5. Once, on the held-out cases

Held-out cases (`"holdout": true`) are never used to tune a prompt. Today no
case is held out, so `--split holdout` prints "No cases to run" and this step
is skipped. Once cases are graded and held out (mtg-table's
`tools/coach-grade.sh`, then `npm run bench:coach -- import-graded graded.jsonl
--write --holdout 10`, in **both** worktrees or merged to `main` first, so both
prompts see the same case files), confirm the finished change once:

```bash
cd ../fc-old && npm run bench:coach -- --split holdout --label old-holdout --repeat 3
cd ../fc-new && npm run bench:coach -- --split holdout --label new-holdout --repeat 3
cp ../fc-old/bench/coach/results/*-old-holdout.json bench/coach/results/
npm run bench:coach -- --compare bench/coach/results/<time>-old-holdout.json bench/coach/results/<time>-new-holdout.json
```

About 10 cases × 3 answers = 30 calls per run. Apply the same rule; with so
few cases expect "no detectable difference". If the held-out set says "B is
worse", do not keep the change, and do not tune further against what it showed.

## Clean up

```bash
cd ~/ForgeCoach && git worktree remove ../fc-old && git worktree remove ../fc-new
```

Results are git-ignored; `git add -f` a report to keep it as a baseline.
