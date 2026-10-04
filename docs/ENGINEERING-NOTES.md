# quilt-playtest — Engineering Notes
> For engineers operating, reviewing, or porting the play-test patch set.
> Companion to ONBOARDING (entry point), DEVELOPER-GUIDE (extending), and CTO-BRIEF (investment).

## Architecture

The repo is a play-test harness wrapped around a patched QuiltEngine. Five components:

1. **The subject** — upstream SuperInstance/quilt (reactive cell runtime: sheets of
   typed cells, pull-based evaluation, caller-aware memoization, listeners), at the
   base of record `fdfed69` (the landing-ocean merge; PR #24 lineage).
2. **The artifact** — `patches/playtest-patches.diff`: the cumulative diff, 528 lines
   as committed, 16 file headers (9 carry content hunks — 8 src files + 1 test file;
   7 are mode-only `100644→100755` churn), 12 logical patches told in 17 labeled
   comment blocks.
3. **The runtime** — built dist trees committed under `packages/` (core, cli, mcp,
   sdk, tui) plus `node_modules/` **tracked in git** (upstream committed it). This is
   the zero-install property: a fresh clone evaluates sheets immediately, offline.
4. **The harness** — `examples/e*.mjs`, 11 scripts. e2–e7 and e10 import a sibling
   vendored engine `../../quilt-arcade/engine/index.js` (the path-repaired layout,
   receipted in PLAYTEST-LOG); `e7_probes_upstream.mjs` imports
   `../../quilt-upstream-main/packages/core/dist/index.js` — vanilla upstream for the
   A/B "dissent ledger". In this workspace `../quilt-upstream-main` is a **linked
   worktree of this clone** (gitdir → `quilt-playtest/.git/worktrees/`, detached HEAD
   at `fdfed691b8f…`).
5. **The evidence chain** — `PLAYTEST-LOG.md` (executed-results ledger),
   `chart-ekg.png` / `chart-triage.png` / `quilt-playtest-report.pdf` (report),
   `tidepool-artifacts.jsonl` (5 hash-chained artifacts, GENESIS prev_hash
   `0000000000000000`).

Data flow through the patched engine, with the patch points marked:

```
 sheet def ──▶ QuiltEngine.loadSheet() ──▶ dependency graph
                 │  FIX-1: listener `watch` lists now add graph edges
                 │         (loadSheet AND register — both paths wired)
                 ▼
 engine.set/push(id, v, ctx) ──▶ propagate(changedId, ctx, visited, prev)
                 │  FIX-4: `visited` set — cyclic pushes terminate
                 │  FIX-3: eager mode (options.eager) — stale formulas recompute
                 │         DURING propagation, so prev→current is real
                 │  FIX-7: program/router caches invalidated like formula/value/ai
                 ▼
        fireListener(dep, changedId, current, prev, runtime)
                 │  FIX-5: FRESH event context per fire (row=evt-<ts>-<n>,
                 │         metadata.{changed,prev,current}) — actions re-run
                 │         and can see the event; no more first-fire memoization
                 ▼
        runtime.call(actionId, input, evtCtx)
                 │  P11: context-bound runtime — nested calls keep caller identity
                 │  P10: callKey(ctx, input) — input joins the memo key
                 │  P12: effectful cells (program/router/ai) evaluate FRESH by
                 │       default; `memo: true` opts back into caller-aware caching
                 ▼
 cells/* evaluators
    value:   FIX-2  get() returns live cell.value (set() visible to get())
    formula: P9    pull seeds cell.value — eager prev exists after a pull
    router:  FIX-6 ctx passthrough on delegation (+ dotted-path `contains` rewrite)
    ai:      P8    schema fields (options/min/max/rubric) reach the provider adapter
```

And the repo's artifact flow:

```
 upstream quilt @ fdfed69 ──(cumulative diff)──▶ patches/playtest-patches.diff
        │                                              │ git apply + build
        │                                              ▼
        │                                     packages/core/dist (committed)
        │                                              │
 examples/e2–e7,e10 ──import──▶ ../quilt-arcade/engine (vendored patched JS)
        │                                                              │
        ├─ e7_probes (9/11) ──A/B──▶ e7_probes_upstream ──▶ vanilla worktree
        ├─ e8/e9 witness chains ──▶ tidepool-artifacts.jsonl ──▶ tidepool
        └─ charts + PDF ──▶ README + PLAYTEST-LOG ──▶ journal (worklog.md)
```

### The patch set by subsystem

| # | File(s) | What breaks without it |
|---|---|---|
| 1 | engine.ts (loadSheet + register) | every listener in every sheet is dead code — watch lists never joined the graph |
| 2 | engine.ts (get) | `set()` invisible to `get()` on value cells (classic stale-read asymmetry) |
| 3 | engine.ts (options.eager, propagate) | no real prev→current transitions; edge-triggered conditions impossible |
| 4 | engine.ts (propagate) | set/push on a cyclic sheet recursed forever |
| 5 | listener.ts + program.ts (call signature) | actions memoized after first fire (state machines ran once) and blind to the event |
| 6 | router.ts + context.ts | delegation dropped caller context (tenant isolation collapsed); dotted-path `contains` silently never matched |
| 7 | engine.ts (propagate) | program/router cells served their first result forever (LLM workflow never saw new input) |
| 8 | cells/ai.ts | sheet-declared fences (options/min/max/rubric) silently dropped before the provider adapter |
| 9 | formula.ts | a pull left cell.value idle — eager listeners missed the first threshold crossing |
| 10 | context.ts + engine.ts | runtime.call(id, a) and (id, b) collided on one memo key |
| 11 | engine.ts | nested runtime.call from inside a program dropped caller identity (tier/tags) |
| 12 | engine.ts + types.ts + test/ai.test.ts | state-blind call/get caches froze stateful sheets (hold'em arbiter served a stale verdict forever) |

Naming evolution inside the diff: patches 1–7 are labeled `PLAY-TEST FIX` /
`PLAY-TEST ITERATION`, patch 8 `PLAYTEST PATCH 8`, patches 9–12 `PLAY-TEST PATCH n`.
Grep all three spellings (`grep -nE "PLAY-?TEST (PATCH|FIX|ITERATION)"`) to walk the
whole set.

## Invariants

- **Upstream suite green** — 36/36 core tests pass with the diff applied. Enforced
  where: a full upstream clone at `fdfed69` + `git apply` + `npm test` (receipted in
  the journal at the patch commits; NOT re-runnable from this drop, which ships dist
  trees only). The rewritten ai cache test inside the diff encodes the new memo
  contract, so the suite and the semantics cannot drift apart silently.
- **Purity contract (post-patch-12)** — caller-aware memoization is promised only for
  value/formula cells and effectful cells that declare `memo: true`. Effectful kinds
  (program/router/ai) evaluate fresh by default. A sheet that relied on the old
  state-blind cache was being served stale verdicts; that was the bug, not a feature.
- **Pull semantics preserved** — `options.eager` defaults to `false`; the cycle guard
  and invalidation changes are semantics-preserving or strictly bug fixes. A vanilla
  pull-based sheet behaves as upstream documents.
- **Event-context uniqueness** — listener fires carry unique row keys
  (`evt-<Date.now()>-<counter>`, monotonic `evtCounter` in listener.ts). Never reuse a
  context across fires; that is exactly the bug patch 5 fixed.
- **Caller-identity survival** — delegation chains (router → program → cell) must
  thread the CallerContext. Enforced by construction: router passthrough (fix 6),
  patch 11's context-bound runtime, with an explicit ctx still winning.
- **Repo-level invariants** — `node_modules/` stays tracked (the zero-install
  property; do not delete, do not gitignore); the diff applies cleanly against
  `fdfed69` (`git apply --check` is the drift test); witness chains re-derive from
  their printed form (e8 "SEALED"; tidepool artifacts hash-chain from GENESIS).

## Failure modes & blast radius

| Failure | Blast radius | Containment |
|---|---|---|
| `get()` on an idle cyclic sheet stack-overflows (unpatched pull path) | crashes the calling process | push path is guarded (patch 4); documented gap — do not pull idle cycles |
| NaN flows through the pure graph with `status: "ready"` | silent data corruption downstream | none — probe P7 keeps it visible; treat NaN at sheet level |
| Program cells execute via `new AsyncFunction` | arbitrary code with sheet privileges; no sandbox | real, documented, unpatched — multi-tenant sheets must trust program authors (drives e9's fence thinking) |
| Memo staleness on engines without patches 10/12 (incl. vanilla upstream) | wrong answers served across tenants/inputs | apply the diff; interim workaround: vary `ctx.row` per request |
| Sibling engine missing (`ERR_MODULE_NOT_FOUND …/quilt-arcade/engine/index.js`) | e-series refuses at import — fail-fast | repoint imports to `./packages/core/dist/index.js` (committed patched build) or recreate the sibling |
| e5/e8/e9 without `z-ai-web-dev-sdk` / network / keys | demos cannot run; nothing else breaks | receipts carry the executed results (README EVOLUTION; PLAYTEST-LOG ⚠ rows) |
| Diff mode churn (7 files `100644→100755`) | review noise only | harmless to apply; strip before submitting upstream if objected to |
| README's "727 lines" vs committed 528 | citation drift | trust the committed file; cite "patches 1–12, 16 files" (receipted regen at journal Task 9 / commit `8693678`) |

The README's "Known gaps left open" list is the record of the ORIGINAL 7-patch
state; patches 10 and 12 (added later by the hold'em lane, journal Task 9) narrow the
memo-key gap on the `call()` path (`callKey` includes input; caching is opt-in).
What remains genuinely open: NaN flow, formulas reading effectful cells' last value
on the lazy path, undeclared `runtime.get` deps invisible to invalidation, the
AsyncFunction sandbox gap, and the idle-cycle pull overflow.

## Performance & cost envelope

Measured, receipted:

- **5000-fanout push: ~2.6–3 ms** — two receipts agree (tidepool artifact seq 0 says
  2.6 ms; README says ~3 ms). Same order, no contradiction.
- **900-deep chain pull: 2053 ms** (PLAYTEST-LOG e7 row) — recursion depth survives;
  latency is linear-ish and dominated by async churn, not the graph.
- **Probe verdicts**: patched engine 9/11 (P7 NaN, P4 idle-pull cycle are the two
  documented failures); vanilla upstream `fdfed69` 6/11 (dissent ledger).
- **LLM spend (real calls, receipted)**: e5 = 7 GLM calls for 3 tickets;
  e8 = 6 asks → 2 real GLM calls (4 memory hits; paraphrase sim 0.6708); e10 = zero
  network. Single-digit API calls per demo run — the tide gate, not the quota,
  is the cost control.

Unmeasured (no receipts — label any new numbers as unverified until you produce
them): memory footprint, e-series wall-clock totals, per-get overhead of
fresh-by-default evaluation on hot loops, CI cost (this repo has none).

## Operations

- **Local-only; no CI in this repo.** Verification is the command set in
  USER-GUIDE/DEVELOPER-GUIDE: the zero-install engine sanity check (fresh clone,
  offline), the e-series (sibling engine needed), and the upstream suite in a full
  clone with the diff applied (36/36 expected).
- **Sibling layout** — examples expect `../quilt-arcade` (vendored patched engine,
  plain JS, zero build) and `../quilt-upstream-main` (vanilla A/B base). In this
  workspace `../quilt-upstream-main` is a **linked worktree of this clone**: its
  `.git` file points to `quilt-playtest/.git/worktrees/quilt-upstream-main`, HEAD
  detached at `fdfed691b8f6f188ba6f5341dc8d5381848e17e5`. A plain fresh clone will
  NOT carry that checkout — recreate a worktree/checkout at `fdfed69` or repoint the
  import before running the dissent ledger.
- **Zero-install discipline** — `node_modules/` is tracked (upstream committed it;
  9,551 of 9,650 tracked files per ONBOARDING). Never `npm install` over it; never
  delete it. Fresh clones already carry vitest/tsx/tsc binaries under
  `node_modules/.bin/`.
- **Credentials model** — e5/e8/e9 read provider keys from env vars at runtime; env
  var NAMES only appear in docs; no key/token values exist anywhere in this repo
  (verified by content scan of examples and docs during the wave-69 pass).
  `z-ai-web-dev-sdk` is not on npm — source it per your lane's copy.
- **External dependency status** — the live worker
  (`quilt-cloudflare.superinstance.workers.dev`) was network-unreachable from the
  sandbox (HTTP 000), so live-Ocean probes were replaced by the local counterfactual
  e8 (receipted in the README EVOLUTION chapter). e10's upload path
  (`POST /api/remember`) needs a reachable tidepool worker.

## Design decisions & why

1. **Patch-as-diff against a pinned base (`fdfed69`), not a maintained fork.** Keeps
   the contribution PR-shaped and reviewable; the tradeoff is drift — upstream has
   since shipped v0.4.0–v0.6.0 release notes in the worktree tree while the diff base
   stays at the landing-ocean merge — and a drop that cannot re-run the suite it
   claims (the receipt carries the claim). Mitigation: every patch's failure story is
   in the diff, so re-derivation on a newer base is mechanical.
2. **In-diff documentation.** Each fix carries its failure story adjacent to the hunk
   ("the hold'em arbiter returned a stale verdict forever"), which is why the diff is
   the repo's most valuable file. Tradeoff: documentation lives in a diff, so
   line-count claims rot (727 → 528) and greps must span three label spellings.
3. **Eager mode opt-in (`options.eager`, default false).** Preserves upstream's
   pull-based semantics for existing sheets. Tradeoff: listeners only observe real
   prev→current transitions under `eager: true` — which is why every reactive example
   sets it. Making it default-true would have changed semantics for consumers who
   never asked.
4. **Fresh-by-default effectful evaluation (patch 12), memoization opt-in.** Pays
   extra provider calls to avoid serving stale LLM verdicts (the hold'em receipt).
   Tradeoff: hot loops re-evaluate unless the author declares `memo: true` — accepted
   because a stale cached "answer" from a stateful sheet is a correctness failure,
   while a recompute is only a cost.
5. **Dissent ledger via worktree A/B.** Patch value is measured, not asserted: the
   same 11 probes run against vanilla `fdfed69` leak 6/11, so the fixes are unmerged
   open value, and the fleet's own landing demos depend on exactly those paths.
   Tradeoff: one more checkout to maintain — cheap next to the claim it certifies.
6. **Dist-only drop with tracked node_modules.** Any lane, any machine, zero installs,
   offline — the most-relied-on property of the repo. Tradeoff: no src/test in-tree,
   so the source of truth for engine changes is the diff itself, and the 36/36 claim
   rides on receipts rather than a local re-run.
