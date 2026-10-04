# quilt-playtest — Knowledge Map
> The index of indexes. Every deeper-knowledge location for this repo, one line each.
> Audience routing: ONBOARDING (start) → USER-GUIDE / DEVELOPER-GUIDE / ENGINEERING-NOTES / CTO-BRIEF.

## In this repo

- `README.md` — demo table, the seven headline patches, example-sheet fixes, five
  known gaps, and the EVOLUTION chapter (the recalibrated play-test: three shifts,
  dissent ledger, sheet-shaped thesis, honest corrections). Note: its "727 lines" is
  stale; the committed diff is 528 lines.
- `PLAYTEST-LOG.md` — the independent lane's executed-results ledger (2026-09-26,
  kimi1): ✅/⚠️/❌ per example with causes, plus the path repairs applied to make the
  e-series run off a fresh machine.
- `patches/playtest-patches.diff` — THE ARTIFACT: cumulative diff against upstream
  `fdfed69`, 528 lines as committed, 16 file headers (9 content-bearing: 8 src + 1
  test; 7 mode-only churn), 12 logical patches in 17 labeled comment blocks
  (`PLAY-TEST FIX`/`ITERATION` for 1–7, `PLAYTEST PATCH 8`, `PLAY-TEST PATCH n` for 9–12).
- `examples/` — the e-series, all importing a sibling vendored engine
  (`../../quilt-arcade/engine/index.js`; e7_probes_upstream → `../../quilt-upstream-main/…`):
  - `e2_reactive_basics.mjs` — from-scratch reactive app: sensors → formulas → edge-triggered listener → pager program, dashboard subscriptions.
  - `e2b_examples_e2e.mjs` — the repo's own example fleet end-to-end (blocked: missing `boat-autopilot/sheet.yaml` fixture).
  - `e3_gesture_ekg.mjs` — CellEKG: gesture differential-geometry math on live subscriptions; catches a cooling-loop fault thresholds cannot see.
  - `e4_federation.mjs` — the missing ~20-line QuiltEngine → SDK adapter (`adaptEngine()`); three engines via LocalCellTransport + CellRouter; `quilt://` URIs.
  - `e5_llm_cells.mjs` — flagship LLM demo: `kind: 'ai'` cells with real GLM calls (3 tickets → 1/10, 10/10, 7/10; 7 calls). Needs sdk + network.
  - `e6_multitenant.mjs` — one sheet as multi-tenant backend: caller-context memo keys, tier-gated routing; documents engine gap #9.
  - `e7_probes.mjs` — the 11-probe adversarial suite (P1–P11; 9/11 pass, 2 documented gaps).
  - `e7_probes_upstream.mjs` — the DISSENT LEDGER: same probes on vanilla upstream `fdfed69`; 6/11 still leak.
  - `e8_ocean_sheet.mjs` — Ocean-as-a-Sheet: embed → cosine match → hit/miss → remember; fnv1a64 witness receipts ported from ocean.ts; tide budget gate; 6 asks → 2 real GLM calls; chain SEALED. Needs sdk + network.
  - `e9_sysone_sheet.mjs` — System One in the sheet: Choice/Score/Noul as typed ai kinds; adversarial injection (BANANA/score-100/forced-yes) → types hold, values leak, receipt surfaces the dissent. Needs sdk + network.
  - `e10_tidepool_artifacts.mjs` — distills the play-test into 5 hash-chained artifacts → `tidepool-artifacts.jsonl`.
- `packages/` — BUILT dist trees only (core, cli, mcp, sdk, tui; no src, no per-package
  package.json). `packages/core/dist/index.js` is the runnable patched engine.
- `node_modules/` — TRACKED IN GIT (upstream committed it; 9,551 of 9,650 tracked files
  per ONBOARDING). The zero-install property. Do not delete; do not npm install over it.
- `tidepool-artifacts.jsonl` — 5 hash-chained artifacts (≤200 words each, 16-number
  native fingerprints), seq 0 starts at GENESIS `prev_hash 0000000000000000`; ready for
  the tidepool `POST /api/remember` protocol.
- `quilt-playtest-report.pdf`, `chart-ekg.png`, `chart-triage.png` — the report
  deliverables (PDF 305,558 bytes; charts for the CellEKG and triage stories).
- `.git/worktrees/quilt-upstream-main` — registration of the LINKED WORKTREE
  `../quilt-upstream-main` (its `.git` file points here); HEAD detached at
  `fdfed691b8f6f188ba6f5341dc8d5381848e17e5`, the vanilla A/B base of the dissent ledger.

## Pre-existing docs

Docs that existed before the wave-69 documentation layer:

- `README.md` — the play-test's own front door (deliverable of the original lane,
  extended by the EVOLUTION chapter).
- `PLAYTEST-LOG.md` — the executed-results ledger from the independent repair lane.
- `quilt-playtest-report.pdf` + two charts — the formal report deliverable.

Wave-69 doc layer (this package): ONBOARDING, USER-GUIDE, DEVELOPER-GUIDE (written by
the earlier 69-doc-f scribe), plus ENGINEERING-NOTES, CTO-BRIEF, KNOWLEDGE-MAP
(written by 69-doc-f2). No pre-wave-69 docs were rewritten.

## In the fleet

- **SuperInstance/quilt** — UPSTREAM, the subject under test. Reactive cell runtime;
  the 12 patches are PR-ready contributions against it. Its own example sheets
  (weather-monitor, task-scheduler, sensor-anomaly) are fixed inside the diff.
- **quilt-arcade** — SIBLING (runtime provider). Vendors the play-test-patched engine
  as plain JS at `engine/index.js`; the e-series imports it after the path repairs
  receipted in PLAYTEST-LOG. The hold'em work in quilt-arcade found patches 10–12
  (journal Task 9) which were mirrored back into this repo's diff.
- **quilt-upstream-main** — LINKED WORKTREE of this clone (lives at
  `../quilt-upstream-main`; gitdir inside this repo's `.git/worktrees/`), pinned at
  upstream merge `fdfed69` (PR #24, landing-ocean). Exists to make the dissent ledger
  an A/B measurement rather than a claim.
- **tidepool** — DOWNSTREAM target. e10's artifacts are shaped for its
  `POST /api/remember` protocol; upload blocked only by sandbox network reachability.
- **jev-quilt** — SIBLING doctrine. Its witness/observation framing is adopted by
  e8/e9 (witness receipts, tide gates) — tested in code here rather than in canon.
- **quilt-cloudflare** — SIBLING service. Its `ocean.ts` (the cloud Ocean) is the
  line-for-line port source for e8's witness idiom; the live worker was
  network-unreachable from the sandbox (HTTP 000, receipted).
- **quilt-tools / quilt-quant / quilt-lab / quilt-arena** — SIBLINGS sharing the
  portfolio zip lineage (journal Tasks 7–14); they consume the patched-engine
  semantics this repo defined (fresh-by-default effectful cells, memo opt-in).

## In the journal

SuperInstance/superinstance-lab → `worklog.md`. Grep `playtest` — the Task IDs that
touch this repo:

- **Task ID 1** — cloned SuperInstance/quilt to `/home/z/my-project/quilt-playtest`;
  environment readied (the repo's birth).
- **Task ID 5-6** — the play-test deliverables: report PDF, README,
  `patches/playtest-patches.diff` (727 lines then), 7 example scripts, 2 charts;
  ENGINE PATCH 8 found by arming the System One fence (36/36 tests green); e10
  tidepool artifacts written.
- **Task ID 7** — 10-tool portfolio build on quilt ("playtested to 75/75");
  cumulative diff regenerated (patches 1–11; upstream still unpatched).
- **Task ID 8** — spreadsheet-games lane (playtest/polish vocabulary in the portfolio).
- **Task ID 9** — Texas Hold'em lane: ENGINE PATCH 12 (state-blind caches froze the
  sheet), mirrored into `quilt-playtest/packages/core` sources; diff regenerated =
  `fdfed69` → patched, patches 1–12, core suite 36/36 green. This is the regen that
  makes the committed diff 528 lines.
- **Task ID 10, 12, 13, 14** — portfolio zips and the Stage-9 branding passes; the
  recurring line "playtest (12 patches, 36/36)" across the portfolio receipts.
- **Task ID 60-engine** — repo sync: quilt-playtest's 168 local-only commits preserved
  on branch `backup/local-c694291`, then synced to `origin/main 8693678` (the
  cumulative-diff ship commit); fresh-clone census.
- **Task ID 61** — queue carry noting the "M6 playtest gift engine" (the vendored
  patched engine as a cross-lane gift).
- **Task ID 66-c** — quilt-pincher's smoke test borrowed the tsx binary from sibling
  quilt-playtest (the zero-install property paying rent in another repo).
- **Task ID 68-a** — dirty-state triage: quilt-playtest blocked by untracked
  node_modules/packages colliding with upstream's committed copies → set aside,
  ff-pulled, local copies removed (the origin of the "do not npm install over it" rule).
- **Task IDs 69-doc-f / 69-doc-f2** — wave-69 documentation layer (ONBOARDING,
  USER-GUIDE, DEVELOPER-GUIDE by the earlier f-lane scribe; ENGINEERING-NOTES,
  CTO-BRIEF, KNOWLEDGE-MAP + README routing by 69-doc-f2).

## Receipts of record

- `patches/playtest-patches.diff` — proves the 12 fixes exist, in reviewable form,
  against a pinned base; its in-diff test change (`test/ai.test.ts`) encodes the new
  memo contract.
- Journal commits `ec0936b` (Super Z drop import) and `8693678` (ship the cumulative
  playtest diff — 12 engine patches, 36/36 upstream tests green) — the patch-state
  receipts; cited by the journal and ONBOARDING, not re-runnable from this dist-only drop.
- `PLAYTEST-LOG.md` — proves what actually executed on a second machine, including
  the three demos that could NOT run and why.
- `tidepool-artifacts.jsonl` — hash-chained (seq 0 tip row_hash `037cd3c49259150f`);
  the dissent-ledger claim ("6 of 11 probes still leak on fdfed69") is artifact seq 0.
- `e8`'s SEALED witness chain + `e9`'s incoherent-receipt tell — recorded in the README
  EVOLUTION chapter; the artifacts are the scripts that regenerate them.
- `worklog.md` Task IDs above — the lifecycle receipts (birth, deliverables, regens,
  sync, cross-repo reuse).

## How to search further

```bash
# Walk every patch story in order:
grep -nE "PLAY-?TEST (PATCH|FIX|ITERATION)" patches/playtest-patches.diff

# All probe verdicts (patched vs upstream A/B):
grep -n "rec('P" examples/e7_probes.mjs examples/e7_probes_upstream.mjs

# Every receipted number in the demos:
grep -rn "ms\b\|calls\|sim=" examples/*.mjs README.md PLAYTEST-LOG.md | grep -v "^Binary"

# Journal lineage (in superinstance-lab):
grep -n "playtest" worklog.md
grep -n "quilt-playtest" worklog.md

# The witness idiom shared with the fleet:
grep -n "fnv1a64\|GENESIS\|row_hash" examples/e8_ocean_sheet.mjs examples/e9_sysone_sheet.mjs tidepool-artifacts.jsonl

# Engine-behavior claims in the diff (the strongest source):
grep -n "PLAY-TEST" patches/playtest-patches.diff
```
