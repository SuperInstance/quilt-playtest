# quilt-playtest — CTO Brief
> Executive summary in 5 minutes. Detail lives in docs/ENGINEERING-NOTES.md and docs/KNOWLEDGE-MAP.md.

## One-paragraph value statement

quilt-playtest is the receipted quality gate for SuperInstance/quilt, the fleet's
reactive cell runtime: an adversarial play-test that found 12 real engine bugs,
fixed them as a PR-ready cumulative diff with all 36 upstream tests still green
(receipted at patch commit `8693678`), quantified the residual leak rate on vanilla
upstream (6/11 probes, the "dissent ledger"), and produced two strategic proofs
(Ocean-as-a-Sheet, System One in the Sheet) arguing the fleet's flagship services are
expressible as ordinary reactive sheets. Its value is threefold: upstream PR readiness
(the patches fix reactive-loop paths the fleet's own landing demos depend on), engine
insight (a probe suite any future engine change can re-run), and architecture
evidence for the sheet-shaped thesis.

## What it does & for whom

- **For quilt's maintainers**: a 528-line cumulative diff (base `fdfed69`, the
  landing-ocean merge) that fixes dead listeners, stale reads, frozen stateful
  sheets, dropped caller identity, and silently-degenerated AI schemas — each
  documented in-place with its failure story, ready to split into PRs.
- **For fleet agents building on quilt**: an 11-script e-series of verified demos
  (reactive apps, multi-tenant sheets, federation adapter, LLM cells, adversarial
  probes) and the honest record of what could not run (PLAYTEST-LOG ❌/⚠ rows).
- **For decision-makers**: quantified risk (what still leaks unpatched upstream),
  quantified cost (single-digit LLM calls per demo), and a maturity verdict below.

## Maturity assessment

**Working, play-test hardened — as a patch set and evidence package; not a product.**

- Evidence for: all 36 upstream core tests green with the diff applied (receipted);
  an independent lane (PLAYTEST-LOG, 2026-09-26) re-executed the e-series and recorded
  ✅/⚠️/❌ per demo with causes; the witness chains in e8 re-derive ("SEALED"); the
  tidepool artifacts are hash-chained and self-verifying.
- Evidence of limits: this drop ships dist trees only (no src/test), so the 36/36
  claim rides on receipts rather than a local re-run; e5/e8/e9 need a non-npm SDK,
  network, and keys; one demo (e2b) is blocked on a missing upstream fixture.

## Risks

| Risk | Class | Mitigation status |
|---|---|---|
| **Fork drift vs upstream** — diff base is `fdfed69`; upstream has since shipped v0.4.0–v0.6.0 release notes, so the diff will not apply cleanly forever | technical | MITIGATED-BY-DESIGN: every patch carries its failure story in-place, so re-derivation on a newer base is mechanical; `git apply --check` is the drift alarm. No owner assigned for the rebase yet — residual. |
| **Unmerged open value** — 6/11 probes still leak on vanilla upstream; the fleet's landing demos depend on the leaking paths | technical/business | NOT MITIGATED until the PRs land. This is the repo's central argument for action, not a defect. |
| **Semantic change** (patch 12: effectful cells fresh by default, `memo: true` opt-in) could surprise downstream sheets that relied on caching | technical | DOCUMENTED: contract change is encoded in the rewritten upstream ai cache test and in all three guides. |
| **No sandbox for program cells** (`new AsyncFunction`) — unpatched, real for multi-tenant use | security | DOCUMENTED, NOT FIXED; e9's schema-fence work is the direction. Any multi-tenant deployment must treat program authors as trusted. |
| **Environment coupling** — examples import a sibling clone's vendored engine; `z-ai-web-dev-sdk` is not on npm; one lane's paths don't travel with a fresh clone | operational | DOCUMENTED (fail-fast imports, workarounds in USER-GUIDE troubleshooting); residual friction accepted for zero-install portability of the engine itself. |
| **Stale numbers in README** ("727 lines" vs committed 528) | credibility | DOCUMENTED in all doc layers; trust the committed artifact. |
| No secrets in repo (env-var names only; content-scanned during wave-69) | security | CLEAN — no token/key values committed. |

## Cost profile

- **Infrastructure: zero.** No CI, no servers, no databases. The repo is static
  artifacts + a vendored engine; a fresh clone runs offline.
- **Compute: a laptop.** Probes and demos are single-process Node (>= 18, ESM).
  Receipted hot spots: 5000-fanout push ~2.6–3 ms; 900-deep chain pull ~2.05 s.
- **LLM spend: single-digit calls per demo run, receipted** (e5: 7 calls; e8: 2 real
  calls out of 6 asks via the memory/tide gate; e10: zero network). Free-tier
  posture is excellent: everything except e5/e8/e9 runs with no keys at all.
- **People-cost: the rebase.** The only material future spend is re-deriving the 12
  patches onto a newer upstream base and landing the PRs — days, not weeks, because
  each fix is documented at the hunk.

## Strategic options

- **Invest (recommended): land the patches upstream.** Highest value per unit of
  work: the diff is PR-ready, tested, and fixes paths the fleet's own landing demos
  depend on; every week unmerged is the dissent ledger's 6/11 leak rate in production
  paths. Splitting into per-concern PRs (1–7 reactive loop, 8 AI schema, 10–12
  memoization) is mechanical.
- **Maintain (minimum viable): re-base + re-run.** Keep the diff applies-clean
  against upstream main; re-run the 11-probe suite as the engine evolves. Cheap
  insurance; preserves the repo's verification role.
- **Harvest-learnings (parallel, already happening):** the probe-suite methodology,
  the witness-receipt idiom, and the Ocean-as-a-Sheet / System-One-in-the-Sheet
  counter-theses feed other fleet repos (jev-quilt's framing adopted in e8/e9;
  tidepool artifacts ready for the memory protocol). No further investment needed.
- **Retire: not recommended.** Orphans the only quantified leak ledger for the
  fleet's core runtime and discards PR-ready work.

## Integration surface

- **SuperInstance/quilt** — upstream; the PR target; base of record `fdfed69`.
- **quilt-arcade** — sibling; vendored patched engine (plain JS) the e-series imports.
- **quilt-upstream-main** — linked worktree of this clone (gitdir inside
  `quilt-playtest/.git/worktrees/`), pinned at `fdfed69`; the A/B half of the dissent
  ledger.
- **tidepool** — downstream; e10's 5 hash-chained artifacts are shaped for
  `POST /api/remember` when a worker is reachable.
- **jev-quilt** — sibling doctrine; witness/observation framing adopted by e8/e9.
- **quilt-cloudflare** — the live Ocean service that e8 re-proves as a sheet; worker
  was network-unreachable from the sandbox (HTTP 000, receipted).
- **z-ai-web-dev-sdk** — the AI provider seam behind e5/e8/e9 (env-var keys, never
  committed).
- **superinstance-lab → worklog.md** — the journal of record; Task IDs 1, 5-6, 7, 9,
  60-engine, 68-a (among others) receipt this repo's lifecycle.
