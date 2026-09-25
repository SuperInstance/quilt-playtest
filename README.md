# Quilt Play-Test Deliverables

Extensive play-testing of https://github.com/SuperInstance/quilt (v0.3.0).
Everything here runs against a **patched engine** — see `patches/playtest-patches.diff`
(727 lines of PR-ready fixes + comments, all 36 upstream tests still passing).

## Quick start

```bash
cd /home/z/my-project/quilt-playtest   # the play-tested clone (already patched + built)
node <script>.mjs                      # any file below
```

## The demos (all verified working)

| File | What it proves |
|---|---|
| `e7_probes.mjs` | 11-probe adversarial suite: reactive semantics, per-tenant memoization, 900-deep chains, 5000-fanout in ~3ms, cycle behavior, NaN flow. **9/11 pass** (2 documented gaps). |
| `e2_reactive_basics.mjs` | From-scratch reactive app: sensors → formulas → edge-triggered listener → pager program, with dashboard subscriptions. |
| `e2b_examples_e2e.mjs` | The repo's own example fleet driven end-to-end: boat-autopilot off-course alert, weather dangerous alert, self-tuning anomaly escalation (EWMA baseline), task-scheduler overdue alert, tracing. |
| `e3_gesture_ekg.mjs` | **Novel**: CellEKG — the repo's Gesture differential-geometry math wired to live engine subscriptions. Classifies cell motion (drifting / oscillating / stuck) and caught a cooling-loop fault a threshold alarm cannot see. |
| `e4_federation.mjs` | **Novel**: the missing QuiltEngine → SDK adapter (`adaptEngine()`, ~20 lines). Three engines (edge/server/cloud) linked via `LocalCellTransport` + `CellRouter`: cross-instance reads, rollups, remote alert handles, `quilt://` URIs. |
| `e6_multitenant.mjs` | **Novel**: ONE sheet as a multi-tenant backend. Caller-context memoization gives per-tenant isolated caches (`f:cap.answer\|i:acme\|t:premium`), tier-gated routing blocks the free tier before it reaches the "model". |
| `e5_llm_cells.mjs` | **Flagship — the spreadsheet that thinks.** Real GLM calls (via z-ai-web-dev-sdk as the missing AI provider) inside `kind: 'ai'` cells. Three support tickets scored 1/10, 10/10, 7/10; escalation gate drafted a reply only for the outage; 7 real LLM calls total. Needs network. |

## Engine patches contributed (in `patches/playtest-patches.diff`)

1. **Listener `watch` wiring** — watch lists were never added to the dependency graph, so *every listener in every example sheet was dead code*. (`engine.ts`, loadSheet + register)
2. **Value-cell stale read** — `get()` on a value cell returned the *definition's* value, so `set()` was invisible to `get()` (but visible to formulas!). Classic stale-read asymmetry. (`engine.ts`)
3. **Eager reactive mode** (`options.eager`) — stale formulas recompute during propagation; listeners observe real prev→current transitions, making edge-triggered conditions (`prev !== "red" && current === "red"`) possible at all. (`engine.ts`)
4. **Propagation cycle guard** — `set`/`push` on a cyclic sheet recursed forever; now guarded by a visited set. (`engine.ts`)
5. **Fresh event contexts for listener actions** — actions were memoized after their first fire (state machines ran once) and couldn't see the event; now each fire gets a unique context carrying `caller.metadata.{changed,prev,current}`. (`listener.ts`)
6. **Router context passthrough + `contains` sugar fix** — delegation kept per-tenant cache isolation; `caller.identity.tags contains "x"` no longer compiles to an out-of-scope bare `tags`. (`router.ts`, `context.ts`)
7. **Effectful cache invalidation** — program/router cells now invalidate when declared upstream cells change (an LLM workflow used to serve its first result forever). (`engine.ts`)

## Example-sheet fixes (also in the diff)

- `weather-monitor`: io action cells → program cells (io actions are silent no-ops); fixed a `=is_comfortable == false` condition whose leading `=` made it silently unfireable.
- `task-scheduler`: `any_overdue` program → formula (derived boolean state must be pure to be watched); io → program.
- `sensor-anomaly`: redesigned as a *working* push-driven loop — EWMA state in a value cell updated by listener→program→`runtime.set`, z-score + escalation as formulas, edge-triggered escalation listener with a real action.

## Known gaps left open (documented, not patched)

- `contextKey` excludes `input` — same context + different input returns the memoized first answer. Workaround: vary `ctx.row` per request.
- NaN flows through the pure graph with `status: "ready"`.
- Formulas read effectful cells' *last* value; undeclared `runtime.get` deps are invisible to invalidation.
- Program cells execute via `new AsyncFunction` — no sandboxing (documented in-repo, real for multi-tenant use).
- `get()` on an idle cyclic sheet still stack-overflows (pull path).

---

# EVOLUTION CHAPTER — the fleet moved; here's the recalibrated play-test

*Added after surveying what the other agents shipped while this play-test ran:*
`quilt-roadmap-2026.md` now carries a **Q4 "The Ocean" phase**; the landing pages
ship live demos of **the Ocean** (vector memory in front of inference),
**Decide/System One** (schema-bounded Choice / Score / Noul), and **quantum audio**;
the org grew to 30+ repos (`tidepool`, `jev-quilt`, `quilt-ai`, `quilt-cloudflare`,
`quilt-agent`, …) with `claude/*` agent branches fixing gesture math and CI, and a
witness/canon discipline (fnv1a-64 hash-chained receipts) spanning everything.

## What changed in our approach — three shifts

1. **From "find leaks" to "keep the ledger honest".** We re-ran our 11-probe
   suite against vanilla upstream main (`fdfed69`) → **6/11 still leak**
   (`e7_probes_upstream.mjs`, the dissent ledger). The reactive-loop bugs our 7
   patches fix are *unmerged open value*, and the fleet's own landing demos
   depend on exactly those paths.
2. **From "use the API" to "speak the fleet's idiom".** New experiments adopt
   the witness-receipt format, the tide gate, and the tidepool memory protocol
   rather than inventing parallel vocabulary.
3. **From "cloud products" to "shapes the cell model can hold".** The fleet's
   two flagship *services* both turn out to be expressible as ordinary sheets —
   which is the strongest evidence yet for the roadmap's core thesis.

## New experiments (verified working, speak the fleet's idiom)

| File | What it proves |
|---|---|
| `e7_probes_upstream.mjs` | **Dissent ledger.** Vanilla upstream main: P1/P2/P3 (listeners dead), P4 (cycles overflow both paths), P7 (NaN flows), P9 (stale effectful reads) all still leak. |
| `e8_ocean_sheet.mjs` | **Ocean-as-a-Sheet** — the fleet's cloud Ocean rebuilt as one reactive sheet: embed → cosine match → hit/miss → remember; fnv1a64 hash-chained witness receipts ported line-for-line from `ocean.ts`; tide budget gate; live counters. 6 asks → **2 real GLM calls**; paraphrase hit sim=0.6708; shrinking `config.tide_budget` mid-session issued the tide_out 429 voice **through a real listener**; witness chain **SEALED** (every receipt re-derives from its printed form). |
| `e9_sysone_sheet.mjs` | **System One in the sheet** — Choice/Score/Noul as typed ai-cell kinds with the fence enforced in the adapter. Adversarial ticket demanded BANANA + score 100 + noul yes p=1: choice stayed in the menu (letter-coded A–D beats synonym-gravity), noul returned **no p=0.9 against the demanded yes/p=1**, score was gamed to 100 — and the incoherent receipt `{score:100, noul:no, p:0.9}` is the tell. **Types hold, values leak, and the witness chain surfaces the dissent.** |
| `e10_tidepool_artifacts.mjs` | **Tidepool discipline** — the play-test distilled into 5 hash-chained artifacts (≤200 words each, 16-number native fingerprints, tidepool protocol shape), ready for `POST /api/remember`. → `tidepool-artifacts.jsonl` |

## Engine patch #8 (found by arming the System One fence)

`evaluateAI` rebuilds the provider config from a hardcoded whitelist — any
schema field declared in the sheet (`options`, `min`, `max`, `rubric`) is
**silently dropped** before the adapter sees it, so a fence declared in the
sheet degenerates to adapter defaults without an error. Patch 8 passes through
own fields that are primitives or arrays-of-primitives. All 36 core tests green.
Generalized: *any cell kind carrying schema metadata needs a passthrough
contract, or schemas become hints by accident.*

## Honest corrections this round forced

- E9's first "the fence held every attack" result was partly an artifact of
  patch-8's absence: the adapter saw an **empty option set**, which refuses
  everything — right outcome, wrong reason. The letter-coded rerun with real
  options is the trustworthy result.
- The live worker (`quilt-cloudflare.superinstance.workers.dev`) is
  network-unreachable from this sandbox (HTTP 000), so live-Ocean probes were
  replaced by the stronger local counterfactual (E8).
- GLM's fresh answer about "what is a quilt cell" was about the *other* Quilt
  (the data-science tool). The ocean faithfully remembered it — receipts make
  wrong memories auditable and evictable. Memory without dissent is just a
  faster wrong answer.

## Where this sits vs the other agents

- `claude/*` branches: gesture-math robustness + CI — adjacent to E3, no overlap
  with the reactive-loop leaks.
- `jev-quilt` walkers: doctrine rounds (500 canon pieces) — we adopt their
  observation/witness framing but test it *in code* rather than in canon.
- The ecosystem's center of gravity (Ocean/Decide/quantum) is service-shaped;
  E8/E9 argue the durable form is sheet-shaped. Both can be true: the cloud
  Ocean is the fleet's shared memory; Ocean-as-a-sheet is the portable unit.
