# quilt-playtest — Developer Guide
> For developers extending the probe suite, applying/porting the patches, or adding
> new sheet-shaped experiments.

## Code layout (file-by-file map of the important paths)

```
README.md                       demo table, 7 headline patches, sheet fixes, 5 known
                                gaps, EVOLUTION chapter (recalibrated play-test)
PLAYTEST-LOG.md                 independent lane's executed results (✅/⚠️/❌ with causes)
patches/playtest-patches.diff   THE ARTIFACT: cumulative diff fdfed69 → patched,
                                528 lines as committed, 16 files (15 src + 1 test),
                                12 numbered PLAY-TEST PATCH comment blocks
packages/                       BUILT dist trees only (no src, no package.json):
  core/dist/                    the patched engine (cells/, engine.js, listener,
                                router, gesture, context, parser, types, index…)
  core/dist/cells/ai.js         carries PLAY-TEST PATCH 8 (schema passthrough)
  cli/ mcp/ sdk/ tui/           sibling package dists + their node_modules
node_modules/                   TRACKED IN GIT — 9,551 of 9,650 tracked files;
                                zero-install property; DO NOT delete or gitignore
examples/                       the e-series (all import ../../quilt-arcade/engine/index.js
                                per the path repairs — see PLAYTEST-LOG)
  e2_reactive_basics.mjs        from-scratch reactive app (sensors→formulas→listener→pager)
  e2b_examples_e2e.mjs          repo's own example fleet end-to-end (needs missing fixture)
  e3_gesture_ekg.mjs            CellEKG: gesture differential geometry on live subscriptions
  e4_federation.mjs             adaptEngine() ~20-line QuiltEngine→SDK adapter; 3 engines
                                via LocalCellTransport + CellRouter; quilt:// URIs
  e5_llm_cells.mjs              kind:'ai' cells with real GLM calls (flagship; needs sdk)
  e6_multitenant.mjs            one sheet, multi-tenant: caller-context memo keys,
                                tier-gated routing; documents gap #9
  e7_probes.mjs                 11-probe adversarial suite (9/11 + 2 documented gaps)
  e7_probes_upstream.mjs        the dissent ledger (vanilla upstream main: 6/11 leak)
  e8_ocean_sheet.mjs            Ocean-as-a-Sheet: embed→cosine→remember, tide budget gate,
                                fnv1a64 witness receipts (needs sdk + network)
  e9_sysone_sheet.mjs           Choice/Score/Noul as typed ai-cell kinds; fence attack
  e10_tidepool_artifacts.mjs    distills the play-test into tidepool artifacts
tidepool-artifacts.jsonl        5 hash-chained artifacts (≤200 words, 16-number fingerprints)
quilt-playtest-report.pdf       the report deliverable
chart-ekg.png, chart-triage.png report charts
```

## Core concepts (named as the code names them)

1. **Sheet / cell kinds** — `value`, `formula`, `sensor`, `listener`, `program`,
   `router`, `api`, `io`, `ai` (the ai kind has 7 sub-kinds, tested upstream).
   Pull-based evaluation with caller-aware memoization.
2. **CallerContext / contextKey** — the per-caller cache key (`f:id|i:identity|t:tags`).
   Patch 10 adds `callKey(ctx, input)` (stable JSON of the input) because contextKey
   alone ignores `input`; patch 12 makes effectful cells re-evaluate by default with
   opt-in `memo: true`.
3. **Eager reactive mode** (`options.eager`) — stale formulas recompute during
   propagation so listeners observe real prev→current transitions (patch 3); patch 9
   seeds `cell.value` on pull so the eager path has a `prev` at all.
4. **Witness receipts** — the fleet's fnv1a-64 hash-chained receipt format, ported
   line-for-line from `ocean.ts` into e8; every receipt re-derives from its printed
   form ("witness chain SEALED").
5. **Tide budget gate** — e8's counter limiting how much the ocean remembers per
   session; shrinking `config.tide_budget` mid-session emits the tide_out 429 voice
   through a real listener.
6. **The fence** — e9's schema-bounded adapter contract for ai cells (choice menus,
   score rubrics, noul questions); patch 8 exists because sheet-declared schema fields
   were silently dropped before the adapter saw them.

## How to extend

### Port the patches to a real upstream clone (the PR path)

```bash
git clone https://github.com/SuperInstance/quilt quilt-under-test
cd quilt-under-test && git checkout fdfed69   # the base of record
git apply --check /path/to/quilt-playtest/patches/playtest-patches.diff
git apply          /path/to/quilt-playtest/patches/playtest-patches.diff
npm install && npm test    # expect 36/36 green (patch commit receipt)
```

The diff is a plain git diff against `fdfed69` with 16 files; if upstream moved,
re-derive rather than force-apply — each `PLAY-TEST PATCH n` comment block states the
failure it fixes, so re-implementation is mechanical.

### Add a probe to the suite

1. Read `examples/e7_probes.mjs` — probes are self-contained asserts with printed
   PASS/FAIL and a name (P1..P11); the two documented gaps are prints, not throws.
2. A new probe must state what leaking looks like (e.g. "served the memoized first
   verdict forever") and print evidence, so the dissent ledger can re-run it against
   vanilla upstream verbatim.
3. If the probe finds a new leak: add the numbered patch comment block in the diff
   style (failure story first, fix second), regenerate the diff, update the README
   count honestly, and re-run the 36 upstream tests.

### Add a sheet-shaped experiment (the E8/E9 pattern)

1. Model the service as ordinary cells; use `kind: 'ai'` cells for model steps and keep
   the fence in the adapter (typed menus, bounded rubrics).
2. Adopt the fleet's idiom per the EVOLUTION chapter: witness-receipt format, tide
   gate, tidepool memory protocol — do not invent parallel vocabulary.
3. Precompute nothing that hides cost: e8's receipt shows 6 asks → 2 real GLM calls
   (cache hits are printed, not hidden).
4. Record honest corrections in the README's EVOLUTION chapter — E9's first "fence held"
   result was retracted because patch-8's absence made an empty option set refuse
   everything ("right outcome, wrong reason").

## Testing

```bash
# The zero-install sanity check (works in a fresh clone, offline):
node --input-type=module -e "import('./packages/core/dist/index.js').then(async m => {
  const e = new m.QuiltEngine('t');
  e.loadSheet({id:'t',title:'t',cells:[{id:'a',kind:'value',value:1},
    {id:'b',kind:'formula',expr:'a+1'}]});
  console.log((await e.get('b')).data); })"
# expected: 2

# The e-series (requires the quilt-arcade sibling engine; e5/e8/e9 need sdk+network):
node examples/e2_reactive_basics.mjs && node examples/e7_probes.mjs

# The upstream core suite (requires a full upstream clone with the diff applied):
cd <upstream-clone>/packages/core && npm test    # 36/36 expected
```

"Green" means: the dist engine evaluates (the sanity check), e7 reports 9/11 with only
the two documented gaps failing, the dissent ledger reproduces 6/11 on vanilla
upstream, and the upstream suite is 36/36 with the diff applied (the patch commit's
receipt; this drop cannot re-run it).

## Conventions

- **Patch comments are the documentation**: every hunk that matters carries a
  `PLAY-TEST PATCH n` block explaining the failure before the fix. Keep that style.
- **Executed-results honesty**: `PLAYTEST-LOG.md` records ❌/⚠️ rows with causes; new
  work appends there rather than quietly upgrading claims.
- **Sibling-relative imports**: the examples assume `../quilt-arcade` (and historically
  `../quilt`, `../quilt-upstream-main`); document any layout change in PLAYTEST-LOG.
- **No secrets**: e5/e8/e9 read provider keys from env at runtime; no key material in
  the repo.
- **Commit style**: single-purpose subjects that state the artifact ("patches: ship the
  cumulative playtest diff (12 engine patches, 36/36 upstream tests green)").

## Gotchas for editors

- **Never delete or gitignore `node_modules/`** — it is the zero-install property, and
  it is what a fresh clone relies on. Upstream committed it; this repo preserves that.
- **The README's "727 lines" is stale** — the committed diff is 528 lines (patches
  1–12, 16 files) after the regeneration receipted as commit `8693678`. If you
  regenerate the diff again, update both numbers in the same commit.
- **Don't "fix" e2b by deleting it** — the missing fixture is receipted in
  PLAYTEST-LOG as a hole in the drop; restoring the fixture is the fix.
- **packages/* are dist-only**: there is no src to edit here. Source changes go through
  the patch diff (against upstream) plus a rebuild of the dist you commit.
- **Patch 12 changed default semantics** — if you write new example sheets, remember
  effectful cells (program/router/ai) re-evaluate on every pull unless they declare
  `memo: true`; the upstream ai cache test in the diff encodes the new contract.
- **e9's lesson generalizes**: any cell kind carrying schema metadata needs a
  passthrough contract, or schemas become hints by accident (patch 8's comment).
