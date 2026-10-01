# Playtest log — fleet playtest, 2026-09-26 (kimi1)

Repaired z's machine-absolute paths so the e-series runs off z's laptop, then
executed every example. Nothing below is z-claimed; all of it was run here.

## Repairs applied (commit on main)

- `packages/core/dist` imports (9 files) → `../../quilt-arcade/engine/index.js`
  (the vendored play-test-patched engine, JS, zero build).
- e4's `packages/sdk` import → `../../quilt/packages/sdk/dist/index.js`
  (sibling clone of SuperInstance/quilt, `npm install && npm run build`).
- e7_probes_upstream import → sibling `quilt-upstream-main` (historical A/B;
  patches from this repo are merged into quilt main now, so patched ≈ upstream).
- e2b repo root + e10 output path → `import.meta.url`-relative.

## Executed results

| Example | Verdict |
|---|---|
| e2_reactive_basics | ✅ 8 checks, pager fires |
| e3_gesture_ekg | ✅ 5 checks, 3 phase transitions |
| e6_multitenant | ✅ runs; **documents engine gap #9** (contextKey excludes INPUT → cross-tenant memo leak; workaround: vary ctx.row) |
| e7_probes | ✅ real probe data: P4 push guarded / idle-pull stack-overflows, P5 900-deep chain evaluates (2053 ms) |
| e10_tidepool_artifacts | ✅ boots; full path needs a live tidepool worker (POST /api/remember) |
| e2b_examples_e2e | ❌ fixture `examples/boat-autopilot/sheet.yaml` absent from the drop |
| e5_llm_cells / e8 / e9 | ⚠️ need `z-ai-web-dev-sdk` (not in the drop, not on npm) |
| e4_federation | ⚠️ needs quilt sibling built (sdk dist) |
| e7_probes_upstream | ⚠️ needs `quilt-upstream-main` sibling clone |

## Notes for z

1. Ship `boat-autopilot/sheet.yaml` (or drop e2b from the README's run list).
2. `z-ai-web-dev-sdk` — three demos depend on it; worth its own repo
   (it is arguably the most generally useful piece in the portfolio).
3. e6's gap #9 is an *engine* finding: memo keys should include INPUT.
