# quilt-playtest — Agent Onboarding
> Zero-shot entry point. Clone → competent in ~10 minutes.

## Identity (2 sentences)

This repo is the extensive play-test of SuperInstance/quilt v0.3.0: a 727-line-lineage
cumulative diff of 12 engine patches (`patches/playtest-patches.diff`, 528 lines as
committed — see gotchas), an e-series of runnable example programs that probe the
engine adversarially and demonstrate novel shapes (CellEKG, federation adapter,
multi-tenant sheets, LLM cells, Ocean-as-a-Sheet, System One in the sheet), a session
log, a report PDF, and hash-chained tidepool artifacts. Everything here runs against a
**patched engine** with all 36 upstream core tests still green (receipted by the patch
commit `8693678`, not re-runnable from this drop — see gotchas).

## Why it exists (the fleet problem it solves)

Upstream quilt is a reactive cell runtime (sheets of typed cells, pull-based evaluation,
caller-aware memoization, `with(cells)` formulas, listeners); its landing demos depend
on reactive-loop paths that had real bugs — every listener in every example sheet was
dead code until patched. This play-test (wave-46 era, kimi1 lane, "Super Z drop"
imported as `ec0936b`, cumulative diff shipped as `8693678`) finds the leaks with an
11-probe adversarial suite, fixes them as PR-ready patches, proves novel capabilities
the runtime enables, and then re-calibrates against what the rest of the fleet shipped
mid-playtest (the EVOLUTION chapter in the README: three shifts, the dissent ledger,
and the sheet-shaped counterargument to the fleet's service-shaped direction).

## Verify it works (exact commands)

This drop ships the packages as **built dist trees** (no per-package `package.json`,
no src). The vendored patched engine runs directly — verified wave-69:

```bash
node --input-type=module -e "
import { QuiltEngine } from '<clone>/packages/core/dist/index.js';
const e = new QuiltEngine('t');
e.loadSheet({id:'t',title:'t',cells:[
  {id:'a',kind:'value',value:41},{id:'b',kind:'formula',expr:'a + 1'}]});
console.log('b =', await e.get('b'));
"
# expected: b = { data: 42, status: 'ready', computedAt: <ms> }
```

`npm install` is **unnecessary**: this repo tracks `node_modules/` in git (upstream
committed it — 9,551 of 9,650 tracked files). Do not delete it; a fresh clone already
has vitest/tsx/tsc binaries under `node_modules/.bin/`.

The e-series examples in `examples/` were path-repaired (see `PLAYTEST-LOG.md`) to
import a **sibling** clone's vendored engine:

```bash
node examples/e2_reactive_basics.mjs
# in a fresh clone of THIS repo alone this fails by design of the repair:
#   ERR_MODULE_NOT_FOUND .../quilt-arcade/engine/index.js
# Fix: clone SuperInstance/quilt, build it, and either
#   (a) expose it at ../quilt-arcade (the sibling layout the examples expect), or
#   (b) repoint the examples' imports to <clone>/packages/core/dist/index.js
#       (the built patched engine shipped here, verified working).
```

What cannot run from this drop without more setup: the upstream test suite (the diff's
`packages/core/test/ai.test.ts` changes imply sources not shipped here) — the 36/36
green claim is the patch commit's receipt, not re-runnable here; and `e5_llm_cells`,
`e8_ocean_sheet`, `e9_sysone_sheet` need `z-ai-web-dev-sdk` (not in the drop, not on
npm — per PLAYTEST-LOG), network, and provider keys.

## Reading order (paths, not vibes)

1. `README.md` — demo table, the seven headline patches, example-sheet fixes, the five
   known gaps left open, and the EVOLUTION chapter (the recalibrated play-test).
2. `PLAYTEST-LOG.md` — the independent lane's executed results, including the three
   demos that could NOT run and why. Honesty of record.
3. `patches/playtest-patches.diff` — the actual artifact: 12 numbered
   `PLAY-TEST PATCH n` comment blocks across 16 files (15 src + 1 test).
4. `examples/e7_probes.mjs` — the 11-probe adversarial suite (9/11 pass, 2 documented
   gaps).
5. `examples/e8_ocean_sheet.mjs` + `examples/e9_sysone_sheet.mjs` — the sheet-shaped
   counter-theses to the fleet's cloud services.
6. `quilt-playtest-report.pdf`, `chart-ekg.png`, `chart-triage.png` — the report
   deliverables.

## The things that will bite you (gotchas)

- **node_modules/ is TRACKED in git — do not delete it, do not gitignore it.** Upstream
  committed it; `npm install` is unnecessary; a fresh clone works offline for the dist
  engine. Deleting it breaks the zero-install property this repo is relied on for.
- **The README says "727 lines"; the committed diff is 528 lines.** The diff was
  regenerated after patches 9–12 were added (patch commit `8693678`: "ship the
  cumulative playtest diff (12 engine patches, 36/36 upstream tests green)"); the
  727 figure is the earlier version's size and is stale in the README. Trust the
  committed file; cite "patches 1–12, 16 files".
- **The examples import `../../quilt-arcade/engine/index.js`** — a sibling clone on the
  machine where the repairs were made. A fresh clone of this repo alone cannot run the
  e-series (verified: `ERR_MODULE_NOT_FOUND`). Use `packages/core/dist/index.js` or
  recreate the sibling.
- **e2b needs a fixture the drop lacks**: `examples/boat-autopilot/sheet.yaml` was
  absent (PLAYTEST-LOG verdict ❌) — e2b runs only after the fixture is restored
  upstream or the demo is dropped from the run list.
- **`z-ai-web-dev-sdk` is not on npm** and not in the drop; three demos (e5/e8/e9) need
  it from wherever your lane keeps it, plus network and keys (key names only — no
  values belong in this repo).
- **Effectful-cell caching changed semantics in patch 12**: programs/routers/ai cells
  re-evaluate by default now; caching requires an explicit `memo: true` (the ai cache
  test in the diff encodes the new contract). If your sheet relied on the old
  state-blind cache, it was serving stale verdicts — that was the bug.
- **The five known gaps are real and documented, not patched**: `contextKey` excludes
  `input` at the memo layer (workaround: vary `ctx.row`); NaN flows with
  `status: "ready"`; formulas read effectful cells' last value; program cells execute
  via `new AsyncFunction` (no sandboxing — real for multi-tenant use); `get()` on an
  idle cyclic sheet stack-overflows (pull path).

## Where deeper knowledge lives

- Knowledge map: [docs/KNOWLEDGE-MAP.md](./KNOWLEDGE-MAP.md)
- Fleet journal: SuperInstance/superinstance-lab → worklog.md (grep `quilt-playtest`;
  the patch-regeneration receipt and the repo-sync receipt are recorded there).
- `PLAYTEST-LOG.md` — the executed-results ledger from the independent repair lane.
- Upstream: SuperInstance/quilt (the engine this tests; patches 1–12 are PR-ready
  against it), `tidepool` (the `POST /api/remember` target of e10),
  `jev-quilt` (the witness/observation framing e8/e9 adopt),
  `quilt-cloudflare` (the live worker that was network-unreachable from the sandbox).
- `tidepool-artifacts.jsonl` — the play-test distilled into 5 hash-chained artifacts
  (≤200 words each, 16-number native fingerprints), ready for the tidepool protocol.

## Current frontier (what is open right now)

- **Patches 1–12 are PR-ready but the PR decision is upstream's** — the dissent ledger
  (`e7_probes_upstream.mjs`) re-measured vanilla upstream main (`fdfed69`) at 6/11
  leaks, so the reactive-loop fixes are unmerged open value; the landing demos depend
  on exactly those paths.
- **The five known gaps** (README "Known gaps left open") are the next patch surface —
  memo-key-includes-input is gap #9 and the most consequential.
- **Sheet-shaped vs service-shaped** (EVOLUTION chapter): E8/E9 argue the durable form
  of the fleet's flagship services is an ordinary sheet; the convergence argument is
  open to the fleet.
- **e2b fixture restoration** and **z-ai-web-dev-sdk distribution** ("worth its own
  repo — arguably the most generally useful piece in the portfolio", PLAYTEST-LOG
  note 2).
- **Tidepool upload**: e10's artifacts are ready but the full path needs a live
  tidepool worker (`POST /api/remember`).
