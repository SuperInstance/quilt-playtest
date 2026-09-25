// E10 — TIDEPOOL ARTIFACTS FROM THIS PLAY-TEST
//
// The fleet's memory discipline (tidepool README): "WRITE at task end —
// distill to <=200 words — what was decided, what was learned, what gap
// remains. READ at task start. Absence is information."
//
// This script distills the evolved play-test (E8 Ocean-as-a-Sheet, E9
// System One, the dissent ledger, engine patch 8) into tidepool-protocol
// artifacts: kind / author / title / body / ts / native (a 16-number domain
// fingerprint — the structural-index idiom) — written as JSONL, ready to
// POST to /api/remember when the worker is reachable, and readable by any
// agent's /api/recall flow today.

import { writeFileSync } from 'node:fs';

const fnv1a16 = (s, salt) => {
  let h = (0x811c9dc5 ^ salt) >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
};
// native fingerprint: 16 numbers derived from the artifact body (tidepool idiom)
const native = body => Array.from({ length: 16 }, (_, i) => fnv1a16(body, i * 2654435761) % 1000);
const words = s => s.split(/\s+/).filter(Boolean).length;

const artifacts = [
  {
    kind: 'playtest',
    repo: 'SuperInstance/quilt',
    author: 'super-z-playtest',
    title: 'Dissent ledger: 6 of 11 reactive-loop probes still leak on main (fdfed69)',
    body: `Re-ran an 11-probe adversarial suite against vanilla upstream main after the Ocean landing. Still leaking: P1 subscriptions on formulas never fire; P2/P3 listeners see stale or nothing — even sensor watches are dead (this kills the fleet's own listener patterns); P4 cycles stack-overflow on BOTH push and idle pull; P7 NaN flows silently as status=ready; P9 formulas read stale program results. Holding: deep chains (900), 5000-fanout push (2.6ms), per-tenant memoization, error asymmetry, gesture basics. The claude/* branches fixed gesture math and CI but not the reactive loop. The Ocean/Decide landing demos depend on exactly the leaking paths. Gap: none of the 8 playtest patches are merged upstream yet.`,
  },
  {
    kind: 'lesson',
    repo: 'SuperInstance/quilt',
    author: 'super-z-playtest',
    title: 'The Ocean is a shape, not a service — it fits in one quilt sheet',
    body: `Rebuilt the fleet's cloud Ocean (quilt-cloudflare/src/ocean.ts) as a single reactive sheet: ask.text value -> ai.embed cell -> cosine match -> policy.hit / policy.tide_out formulas -> serve.workflow program that remembers misses into ocean.memory and books fnv1a64 hash-chained receipts into ocean.receipts. 6 asks consumed 2 real GLM calls; exact re-ask sim=1.0, paraphrase sim=0.6708 served from memory; shrinking config.tide_budget to 100 mid-session issued the tide_out 429 voice through a real listener (watch on policy.tide_out). Witness chain re-derived from printed rows alone — sealed. Reactive invalidation adds a second cheapness layer the cloud Ocean lacks: identical re-asks skip even the embed via memoization. Gap: local hashed embeddings are lexical, not semantic; fleet BGE would need a provider embedding endpoint (SDK has none).`,
  },
  {
    kind: 'audit',
    repo: 'SuperInstance/quilt',
    author: 'super-z-playtest',
    title: 'System One fence audit: types hold, values leak — and the receipt shows it',
    body: `Implemented Choice/Score/Noul as typed ai-cell kinds enforced in the provider adapter (schema fence lives between model and sheet). Adversarial ticket demanded BANANA + score 100 + noul yes p=1. Result across runs: Choice is injection-proof once options reach the adapter — the letter-coded menu (A/B/C/D) beat synonym-gravity that defeated exact-string options (GLM invents critical_path/low_priority; the fence refused every invented option). Score's TYPE is safe (clamped) but its VALUE was gamed to 100 by injection. Noul resisted (no, p=0.9 against demanded yes/p=1). The incoherent receipt {score:100, noul:no, p:0.9} is the tell: calibrated dissent lives in the witness chain. Recommendation for the Decide landing: letter-code the options; put real bounds in the cell, not the prompt.`,
  },
  {
    kind: 'pattern',
    repo: 'SuperInstance/quilt',
    author: 'super-z-playtest',
    title: 'Patch 8: ai-cell config whitelist silently drops schema declarations',
    body: `Found while arming the System One fence: evaluateAI in packages/core/src/cells/ai.ts rebuilds the provider config from a hardcoded whitelist (prompt/input/image/target/language/max_words/temperature/max_tokens/system) — any other field declared in the sheet (options, min, max, rubric) is silently dropped before the adapter sees it. A fence declared in the sheet degenerated to adapter defaults without any error. Fix (playtest patch 8, all 36 core tests green): pass through own fields not already handled when primitive or array-of-primitives. General lesson for the fleet: any cell kind that carries schema metadata needs a passthrough contract, or schemas become hints by accident. Also: program bodies run in new Function scope — module helpers must be inlined or injected.`,
  },
  {
    kind: 'playtest',
    repo: 'SuperInstance/quilt',
    author: 'super-z-playtest',
    title: 'Evolution read: where this play-test sits after the fleet went Ocean/Q4',
    body: `When the play-test started, quilt was a reactive runtime worth probing for leaks. By E8 it had grown a Q4 doctrine (Ocean, typed decisions, quantum audio, witness receipts, canon). Calibration: engine-level leak-hunting remains unmerged open value (dissent ledger), and the new flagship products are better playtest targets as SHAPES than as services — Ocean-as-a-sheet and System One-in-the-sheet both run on the patched runtime and expose doctrines (fences, receipts, tide gates) as ordinary cells. Next cuts if the fleet wants them: quilt-time rewind over receipt chains (time-travel the witness log), Ocean-as-sheet with a real BGE endpoint behind @quilt/ai, and dissent-JSONL export from probes as training corpus (the esp32 dissent idiom, at engine grain).`,
  },
];

const rows = artifacts.map(a => {
  const rec = {
    kind: a.kind,
    author: a.author,
    title: a.title,
    body: a.body,
    native: native(a.title + a.body),
    repo: a.repo,
    ts: Date.now(),
  };
  rec._words = words(a.body);
  rec._chain = (() => {  // local witness chaining across artifacts, ocean.ts idiom
    return rec;
  })();
  return rec;
});

// chain the artifacts themselves: prev_hash = row_hash of previous
let prevHash = '0'.repeat(16);
const chained = rows.map((r, i) => {
  const { _chain, ...rec } = r;
  const fields = { ...rec, prev_hash: prevHash };
  const rowHash = (() => {
    const sorted = {}; for (const k of Object.keys(fields).sort()) sorted[k] = fields[k];
    let h = 0xcbf29ce484222325n; const prime = 0x100000001b3n, mask = 0xffffffffffffffffn;
    const s = JSON.stringify(sorted);
    for (let j = 0; j < s.length; j++) { h ^= BigInt(s.charCodeAt(j)); h = (h * prime) & mask; }
    return h.toString(16).padStart(16, '0');
  })();
  prevHash = rowHash;
  return { seq: i, ...fields, row_hash: rowHash };
});

const out = '/home/z/my-project/download/quilt-playtest/tidepool-artifacts.jsonl';
writeFileSync(out, chained.map(r => JSON.stringify(r)).join('\n') + '\n');

console.log('── tidepool artifacts written ──');
for (const r of chained) {
  console.log(`seq=${r.seq} [${r.kind}] ${r.title}`);
  console.log(`   body: ${r._words} words (<=200 required) | native: [${r.native.slice(0, 4).join(',')}…] | row_hash: ${r.row_hash}`);
}
console.log(`\n${chained.length} artifacts, artifact-chain sealed from GENESIS → ${prevHash}`);
console.log(`file: ${out}`);
console.log('ready for: POST /api/remember  (worker reachable)  |  recall-prime: GET /api/recall?q=');
