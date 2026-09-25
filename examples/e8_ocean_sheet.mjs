// E8 — OCEAN-AS-A-SHEET
//
// Evolution context: since this play-test started, the fleet shipped "The
// Ocean" (quilt-cloudflare/src/ocean.ts) — a witnessed, self-cheapening
// inference surface: embed the question, serve close hits from a vector
// memory, answer misses fresh, remember, and book EVERY call into an
// fnv-1a-64 hash-chained receipt log. The tide gate meteres spend.
//
// This demo asks the play-test question the fleet hasn't: is the cloud
// service even necessary, or is the Ocean a *shape* the cell model can hold?
// We rebuild the entire Ocean as a single quilt sheet:
//
//   ask.text ──▶ ask.vec (ai.embed) ──▶ ocean.match (program: cosine scan)
//                    │                       │
//                    ▼                       ▼
//              ocean.answer (ai.llm)   policy.hit / policy.tide_out (formulas)
//                    │                       │
//                    └────▶ serve.workflow (program) ◀──── tide budget (values)
//                                │  remember misses (runtime.set ocean.memory)
//                                │  book witness receipt (runtime.set ocean.receipts)
//                                ▼
//        ocean.size / ocean.hit_rate / ocean.tokens_saved (formulas)
//        tide.alert (listener → 429 voice when the tide goes out)
//
// The witness idiom (fnv1a64, canon, row shape) is ported line-for-line from
// the official ocean.ts so receipts re-derive anywhere the chart is known.
// Runs on the play-test-patched engine: vanilla upstream has no watch wiring,
// no eager mode, no effectful invalidation (see the dissent ledger).

import { QuiltEngine } from '/home/z/my-project/quilt-playtest/packages/core/dist/index.js';
import ZAI from 'z-ai-web-dev-sdk';

// ── witness idiom, ported from quilt-cloudflare/src/ocean.ts ────────────────
export function fnv1a64(input) {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < input.length; i++) {
    h ^= BigInt(input.charCodeAt(i));
    h = (h * prime) & mask;
  }
  return h.toString(16).padStart(16, '0');
}
export function canon(row) {
  const sorted = {};
  for (const k of Object.keys(row).sort()) sorted[k] = row[k];
  return JSON.stringify(sorted);
}
const GENESIS_PREV = '0'.repeat(16);

// ── local deterministic embedding: one geometry, zero network ───────────────
// The fleet's ocean uses 768-d BGE at the edge; the SDK here exposes no
// embeddings endpoint, so we serve the same *contract* from a signed hashed
// bag-of-words (the tidepool "native fingerprint" idiom, widened to 64 dims).
// Same model every time → the ocean stays one geometry. Paraphrases score
// high (shared content words), unrelated questions score ~0.
const DIMS = 64;
const STOP = new Set('a an the is are was were do does did how what why when who i you we my your our in on at to for of and or it its this that with as can will would should'.split(' '));
const stem = w => w.replace(/(ing|ed|es|s)$/, '');
function embed(text) {
  const v = new Array(DIMS).fill(0);
  const words = String(text).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(w => w && !STOP.has(w)).map(stem);
  for (const w of words) {
    let h = 5381;
    for (let i = 0; i < w.length; i++) h = ((h << 5) + h + w.charCodeAt(i)) >>> 0;
    const idx = h % DIMS;
    const sign = (h >>> 31) & 1 ? -1 : 1;
    v[idx] += sign;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map(x => x / norm);
}
const cosine = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

// ── the AI provider: z-ai-web-dev-sdk as an AIEngineLike ────────────────────
class OceanAI {
  constructor() { this.zai = null; this.llmCalls = 0; this.embedCalls = 0; }
  async init() { if (!this.zai) this.zai = await ZAI.create(); return this; }
  async call(config) {
    if (config.ai_kind === 'ai.embed') {           // local, deterministic, free
      this.embedCalls++;
      return embed(config.input ?? config.prompt ?? '');
    }
    this.llmCalls++;                                // fresh inference, real cost
    const completion = await this.zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: config.system ?? 'You are precise and terse. Reply with only what is asked.' },
        { role: 'user', content: config.prompt ?? config.input ?? '' },
      ],
      thinking: { type: 'disabled' },
    });
    return (completion.choices[0]?.message?.content ?? '').trim();
  }
}
const ai = await new OceanAI().init();

// ── the Ocean, as a sheet ────────────────────────────────────────────────────
const engine = new QuiltEngine('ocean-sheet', { eager: true, ai });

engine.loadSheet({
  id: 'ocean-sheet',
  title: 'The Ocean — a memory that makes answers cheaper, as a sheet',
  cells: [
    // configuration (the tide is USD-metered like the official one)
    { id: 'config.threshold', kind: 'value', value: 0.55, description: 'ocean hit threshold (hashed-embedding calibration; the BGE ocean uses 0.92)' },
    { id: 'config.tide_budget', kind: 'value', value: 260, description: 'micro-USD per tide window' },
    { id: 'config.fresh_cost', kind: 'value', value: 120, description: 'estimated micro-USD per fresh inference' },

    // the ask surface
    { id: 'ask.text', kind: 'value', value: '', description: 'the current question' },

    // the geometry: every prompt becomes a vector before it becomes an answer
    { id: 'ask.vec', kind: 'ai', ai_kind: 'ai.embed', provider: 'local',
      input: '{{ask.text}}', description: 'embedding of the ask — one geometry, deterministic' },

    // the ocean itself: distilled (q, a, v) artifacts, grown at runtime
    { id: 'ocean.memory', kind: 'value', value: [], description: 'the ocean — every miss remembered' },

    // fresh inference (only pulled on a miss; memoized on identical re-asks)
    { id: 'ocean.answer', kind: 'ai', ai_kind: 'ai.llm', provider: 'zai', model: 'default',
      system: 'You answer questions about the Quilt cell runtime and general topics in at most 2 sentences. Terse, factual.',
      prompt: '{{ask.text}}', description: 'fresh inference for misses' },

    // policy — pure formulas
    { id: 'policy.tide_out', kind: 'formula', expr: 'tide.spent >= config.tide_budget',
      description: 'the tide is out: window budget spent' },

    // state the serve loop moves
    { id: 'tide.spent', kind: 'value', value: 0, description: 'micro-USD spent this window' },
    { id: 'ocean.receipts', kind: 'value', value: [], description: 'fnv1a64 hash-chained witness log' },

    // the serve loop: match → branch (refuse | ocean | wave) → remember → book
    { id: 'serve.workflow', kind: 'program', deps: ['ask.text'],
      description: 'embed → match → serve or infer → remember → witness',
      code: `
        // helpers inlined: program bodies run in a new Function scope —
        // module-level identifiers are not visible in here.
        const fnv1a64 = (input) => {
          let h = 0xcbf29ce484222325n;
          const prime = 0x100000001b3n, mask = 0xffffffffffffffffn;
          for (let i = 0; i < input.length; i++) { h ^= BigInt(input.charCodeAt(i)); h = (h * prime) & mask; }
          return h.toString(16).padStart(16, '0');
        };
        const canon = (row) => { const s = {}; for (const k of Object.keys(row).sort()) s[k] = row[k]; return JSON.stringify(s); };
        const cosine = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
        const GENESIS_PREV = '0'.repeat(16);

        const t0 = Date.now();
        const vec = (await runtime.get('ask.vec')).data;
        const memory = (await runtime.get('ocean.memory')).data;
        const threshold = (await runtime.get('config.threshold')).data;
        const tideOut = (await runtime.get('policy.tide_out')).data;
        const question = (await runtime.get('ask.text')).data;

        // scan the ocean for the closest known question
        let best = { sim: 0, idx: -1 };
        memory.forEach((m, idx) => {
          const sim = cosine(m.v, vec);
          if (sim > best.sim) best = { sim, idx };
        });
        const hit = !tideOut && best.idx >= 0 && best.sim >= threshold;

        let source, answer, model;
        if (tideOut) {
          source = 'refused'; answer = 'the tide is out — budget spent, try again when it turns'; model = 'tide-gate';
        } else if (hit) {
          source = 'ocean'; answer = memory[best.idx].a; model = 'memory';
        } else {
          source = 'wave';
          answer = (await runtime.call('ocean.answer')).data;
          model = 'glm';
          // remember: the next stranger sailing the same water gets the cheap path
          await runtime.set('ocean.memory', [...memory, { q: question, a: answer, v: vec, ts: Date.now() }]);
          const spent = (await runtime.get('tide.spent')).data;
          await runtime.set('tide.spent', spent + (await runtime.get('config.fresh_cost')).data);
        }

        // book the witness receipt — every call, hit or miss, chained
        const receipts = (await runtime.get('ocean.receipts')).data;
        const prev = receipts.length ? receipts[receipts.length - 1] : null;
        const fields = {
          answer_hash: fnv1a64(answer),
          ms: Date.now() - t0,
          model,
          prev_hash: prev ? prev.row_hash : GENESIS_PREV,
          question_hash: fnv1a64(question),
          sim: source === 'ocean' ? Number(best.sim.toFixed(4)) : null,
          source,
          ts: Date.now(),
        };
        const row = { seq: prev ? prev.seq + 1 : 0, ...fields, row_hash: fnv1a64(canon(fields)) };
        await runtime.set('ocean.receipts', [...receipts, row]);

        return { source, answer, sim: fields.sim, seq: row.seq };
      ` },

    // live counters — the stats strip
    { id: 'ocean.size', kind: 'formula', expr: 'ocean.memory.length', description: 'ocean size' },
    { id: 'ocean.hit_rate', kind: 'formula',
      expr: 'ocean.receipts.length === 0 ? 0 : ocean.receipts.filter(r => r.source === "ocean").length / ocean.receipts.length',
      description: 'share of serves that stayed in memory' },
    { id: 'ocean.tokens_saved', kind: 'formula',
      expr: 'ocean.receipts.filter(r => r.source === "ocean").length * 180',
      description: 'estimated tokens never spent on fresh inference' },

    // the 429 voice: a listener that fires when the tide goes out
    { id: 'tide.alert', kind: 'listener', watch: ['policy.tide_out'],
      condition: 'caller.metadata.current === true', action: 'tide.voice' },
    { id: 'tide.voice', kind: 'program',
      code: `const log = (await runtime.get('tide.log')).data;\n        await runtime.set('tide.log', [...log, { ts: Date.now(), voice: 'tide_out', code: 429 }]);\n        return { voice: "tide_out", code: 429, message: "the ocean is resting — the tide went out" };` },
    { id: 'tide.log', kind: 'value', value: [], description: 'audit trail of listener-issued 429 voices' },
  ],
});

// ── sail the ocean ───────────────────────────────────────────────────────────
const MARK = { ocean: '⚡', wave: '🧠', refused: '🚫' };
async function ask(question) {
  const before = ai.llmCalls;
  await engine.set('ask.text', question);          // invalidates vec + answer caches
  const out = (await engine.call('serve.workflow')).data;
  const size = (await engine.get('ocean.size')).data;
  const rate = (await engine.get('ocean.hit_rate')).data;
  const saved = (await engine.get('ocean.tokens_saved')).data;
  console.log(`\n${MARK[out.source]} [${out.source}] "${question}"`);
  console.log(`   sim=${out.sim ?? '—'}  seq=${out.seq}  fresh-LLM-calls-this-ask=${ai.llmCalls - before}`);
  console.log(`   → ${String(out.answer).slice(0, 100)}${String(out.answer).length > 100 ? '…' : ''}`);
  console.log(`   ocean size=${size}  hit_rate=${(rate * 100).toFixed(0)}%  tokens_saved≈${saved}`);
  return out;
}

console.log('══════════════════════════════════════════════════════════════');
console.log(' E8 — THE OCEAN AS A SHEET  (witness-receipted, tide-metered)');
console.log('══════════════════════════════════════════════════════════════');

const r1 = await ask('what is a quilt cell?');                       // miss → fresh → remembered
const r2 = await ask('what is a quilt cell?');                       // exact re-ask → served
const r3 = await ask('what is a cell in quilt?');                    // paraphrase → served?
const r4 = await ask('how do I trim the mainsail in heavy wind?');   // unrelated → miss → fresh → remembered
const r5 = await ask('how should I trim the main sail in heavy wind?'); // paraphrase of r4 → served?

// drain the tide: shrink the window budget, then ask something new
console.log('\n── shrinking the tide window budget to 100 µUSD ──');
await engine.set('config.tide_budget', 100);
const r6 = await ask('what did the roadmap say about the Ocean phase?'); // refused — tide out

// ── verify the witness chain: every row re-derives from its printed form ────
const receipts = (await engine.get('ocean.receipts')).data;
let chainOk = true, prevHash = GENESIS_PREV;
receipts.forEach((r, i) => {
  const { seq, row_hash, ...fields } = r;
  const rederived = fnv1a64(canon(fields));
  const linkOk = seq === i && fields.prev_hash === prevHash && rederived === row_hash;
  if (!linkOk) chainOk = false;
  prevHash = row_hash;
});
console.log('\n── witness chain verification ──');
console.log(`   ${receipts.length} receipts, chain ${chainOk ? 'SEALED ✓ (every row re-derives; prev_hash links hold)' : 'BROKEN ✗'}`);
console.log('   last row:', JSON.stringify(receipts[receipts.length - 1]));

// listener audit: did the watch actually fire?
const tideLog = (await engine.get('tide.log')).data;
console.log(`\n── listener audit: tide.alert fired ${tideLog.length}× ${tideLog.length > 0 ? '✓ (watch on policy.tide_out → 429 voice)' : '✗ DID NOT FIRE'} ──`);
console.log(`\n══ tide gate: ${r6.source === 'refused' ? 'held (429 voice issued)' : 'not reached'} ══`);
console.log(`══ real GLM calls: ${ai.llmCalls} for ${receipts.length} asks — the ocean absorbed the rest ══`);
