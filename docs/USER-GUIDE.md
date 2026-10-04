# quilt-playtest — User Guide
> For someone who wants to run the demos, understand the patched engine, or use the
> play-test to evaluate quilt v0.3.0.

## What you get

1. **A patched quilt engine, runnable with zero installs** — the built
   `packages/core/dist` tree (and cli/mcp/sdk/tui dists) committed to the repo,
   including tracked `node_modules/`, so a fresh clone evaluates sheets immediately.
2. **Twelve PR-ready engine patches** (`patches/playtest-patches.diff`) — fixes for
   dead listeners, stale reads, frozen stateful sheets, and more, each documented
   in-place with a `PLAY-TEST PATCH n` comment, with all 36 upstream core tests green
   (receipted by the patch commit).
3. **An e-series of verified demos** — reactive basics, end-to-end example sheets, an
   adversarial 11-probe suite, and four novel shapes (CellEKG gesture math on live
   subscriptions; a ~20-line engine→SDK federation adapter; one sheet as a multi-tenant
   backend; the spreadsheet that thinks with real LLM cells).
4. **The dissent ledger** — `e7_probes_upstream.mjs` re-runs the probes against vanilla
   upstream main so the value of the patches is measured, not asserted (6/11 still
   leak unpatched).
5. **The EVOLUTION recalibration** — Ocean-as-a-Sheet and System One in the sheet,
   arguing the fleet's flagship services are expressible as ordinary reactive sheets,
   plus honest corrections the second round forced.
6. **Report deliverables** — `quilt-playtest-report.pdf`, two charts, and 5
   hash-chained tidepool artifacts.

## Install

```bash
git clone https://github.com/SuperInstance/quilt-playtest
cd quilt-playtest
# Nothing to install: node_modules/ is tracked in git (upstream committed it).
# Do NOT run npm install; do NOT delete node_modules.
node --version   # >= 18 (ESM)
```

## First success in 5 minutes

Drive the vendored patched engine directly — this works in a fresh clone with zero
network:

```bash
node --input-type=module -e "
import { QuiltEngine } from './packages/core/dist/index.js';
const e = new QuiltEngine('demo');
e.loadSheet({ id: 'demo', title: 'Demo', cells: [
  { id: 'temp',   kind: 'value', value: 41 },
  { id: 'status', kind: 'formula', expr: \"temp > 40 ? 'hot' : 'ok'\" },
]});
console.log('status =', (await e.get('status')).data);
await e.set('temp', 35);
console.log('status =', (await e.get('status')).data);
"
# expected: status = hot    then: status = ok
```

That is the whole runtime model: typed cells, pull-based evaluation, formulas over
neighbors — the thing the patches make trustworthy.

## Everyday usage

### 1. Run the verified demos (needs the sibling engine — see gotcha)

The e-series imports `../../quilt-arcade/engine/index.js` (a vendored patched engine in
a sibling clone). With that sibling in place (or after repointing imports to
`packages/core/dist/index.js`):

```bash
node examples/e2_reactive_basics.mjs   # sensors → formulas → edge listener → pager
node examples/e7_probes.mjs            # 11-probe adversarial suite (9/11 + 2 gaps)
node examples/e3_gesture_ekg.mjs       # CellEKG classifies drifting/oscillating/stuck
node examples/e6_multitenant.mjs       # per-tenant memoization + tier gating
```

Expected for e7: probe-by-probe PASS/FAIL with the two documented gaps (NaN flow,
idle-cycle pull overflow) printed as findings, not crashes.

### 2. Run the LLM demos (network + sdk + keys required)

```bash
node examples/e5_llm_cells.mjs   # 3 support tickets scored 1/10, 10/10, 7/10;
                                 # escalation drafts a reply only for the outage
node examples/e8_ocean_sheet.mjs # Ocean-as-a-sheet: embed→match→remember, tide gate,
                                 # witness chain SEALED
node examples/e9_sysone_sheet.mjs# Choice/Score/Noul in the sheet; adversarial attack
```

These need `z-ai-web-dev-sdk` (not on npm — obtain it per your lane), network, and
provider keys as env vars. e5's receipted baseline: 3 tickets, 7 real LLM calls total.

### 3. Read the patches like a changelog

```bash
grep -nE "PLAY-?TEST (PATCH|FIX|ITERATION)" patches/playtest-patches.diff
```

Twelve patches across seventeen labeled comment blocks (labels evolved: the first
seven fixes say `PLAY-TEST FIX`/`PLAY-TEST ITERATION`, patch 8 says `PLAYTEST PATCH 8`,
patches 9–12 say `PLAY-TEST PATCH n`); each carries the failure story and the fix
rationale in-place
(e.g. patch 12's "state-blind call/get caches FROZE the sheet — the hold'em arbiter
returned a stale verdict forever").

### 4. Check what still leaks upstream (the dissent ledger)

```bash
node examples/e7_probes_upstream.mjs   # against vanilla upstream main (fdfed69):
                                       # P1/P2/P3 listeners dead, P4 cycles overflow,
                                       # P7 NaN flows, P9 stale effectful reads
```

### 5. Take the tidepool artifacts

`tidepool-artifacts.jsonl` holds the play-test distilled into 5 hash-chained artifacts
(each ≤200 words, 16-number native fingerprint), shaped for the tidepool protocol
(`POST /api/remember` when a live worker is reachable).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `ERR_MODULE_NOT_FOUND .../quilt-arcade/engine/index.js` | The examples were path-repaired to a sibling clone that a fresh clone lacks | Repoint example imports to `./packages/core/dist/index.js` (built patched engine, verified working), or create the `../quilt-arcade` sibling |
| `Cannot find module 'z-ai-web-dev-sdk'` | The sdk is not in the drop and not on npm | Obtain it per your lane's copy; e5/e8/e9 only |
| e2b fails: missing `examples/boat-autopilot/sheet.yaml` | Known hole in the drop (PLAYTEST-LOG ❌) | Restore the fixture upstream or skip e2b |
| You ran `npm install` and it churned | Unnecessary — node_modules/ is tracked in git | Don't; a fresh clone already has everything |
| An AI/program cell "changed behavior" after you re-checked against old notes | Patch 12: effectful cells re-evaluate by default; caching is opt-in via `memo: true` | That is the fix working; add `memo: true` only to genuinely pure cells |
| Repeated `runtime.call(id, input)` returns the same answer for different inputs | Only on engines without patches 10/12 (vanilla upstream: contextKey ignores input) | Apply the patch diff, or vary `ctx.row` as the documented workaround |
| `get()` hangs/crashes on a cyclic sheet | Known gap: push path guarded (patch 4), idle pull path still overflows | Don't pull idle cycles; it is documented, not yet patched |
| Tests can't be found to re-run 36/36 | This drop ships dist trees only, no `packages/core/test/` | The 36/36-green claim is the patch commit's receipt (`8693678`); re-run in a full upstream clone with the diff applied |

## FAQ

**Is this a fork of quilt?** No — it is a play-test: a clone of SuperInstance/quilt
v0.3.0 with 12 PR-ready patches applied and measured, plus demos. The patches are the
contribution; upstream adoption is the open decision.

**Why does the repo track node_modules/?** Upstream committed it and the drop preserved
the property: a fresh clone runs with zero installs, offline. Deleting node_modules
would break that; the docs repeat this because every instinct says to gitignore it.

**What do the patches actually fix?** The short list: listeners were dead code (watch
lists never joined the dependency graph); `set()` was invisible to `get()` on value
cells; edge-triggered listeners were impossible without eager mode; cyclic pushes
recursed forever; listener actions memoized after their first fire; router delegation
dropped caller identity; LLM-workflow cells served their first result forever. The diff
tells each story in place.

**What is the "dissent ledger"?** `e7_probes_upstream.mjs` re-runs the probe suite
against vanilla upstream main so the patch value is a measurement (6/11 leaks remain
unpatched upstream) — receipts over claims.

**Why do e8/e9 matter beyond demos?** They re-implement the fleet's two flagship
services (Ocean vector memory; Decide/System One) as ordinary sheets inside the
engine — evidence for the thesis that the durable unit is the sheet, not the service.
E9 also found patch 8 (schema fields silently dropped by the provider whitelist) by
arming a fence that degenerated to defaults.

**Are the numbers in the README trustworthy?** Mostly receipted and re-executed by an
independent lane (PLAYTEST-LOG), with honest ❌/⚠️ rows for what could not run. One
known staleness: the README's "727 lines" predates the regenerated 528-line diff
(patches 1–12, 16 files).
