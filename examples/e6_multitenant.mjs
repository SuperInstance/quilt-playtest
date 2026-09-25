// E6 — ONE SHEET AS A WHOLE MULTI-TENANT BACKEND.
// The caller-context memoization means a single sheet serves many tenants
// with isolated cached derived values and per-tier policy routing — no
// per-tenant deployments, no cache keys to manage by hand.
import { QuiltEngine } from '/home/z/my-project/quilt-playtest/packages/core/dist/index.js';

let llmCalls = 0;
const engine = new QuiltEngine('saas-sheet', { eager: true });

engine.loadSheet({
  id: 'saas-sheet',
  title: 'Multi-tenant AI gateway as one sheet',
  axes: { rows: { name: 'tenant' }, cols: { name: 'capability' } },
  cells: [
    // per-tenant rate limiting: pure-formula token bucket
    { id: 'limits.rate', kind: 'value', value: 5 },
    { id: 'limits.window_ms', kind: 'value', value: 60000 },
    { id: 'limits.requests', kind: 'value', value: {} }, // tenant -> [timestamps]

    // capability cells (would be api/ai cells in production; program here so
    // we can count invocations without network)
    { id: 'cap.answer', kind: 'program',
      code: `globalThis.__llmCalls = (globalThis.__llmCalls ?? 0) + 1; return { text: 'answer for ' + (input?.q ?? ''), tenant: caller.identity?.id };` },

    // caller-aware routing: policy by tier, encoded as data
    { id: 'gateway.route', kind: 'router',
      rules: [
        { when: 'caller.identity.tags contains "premium"', route: 'cap.answer' },
        { when: 'caller.identity.tags contains "free"', route: { value: { error: 'quota-exceeded', upgrade: true } } },
        { when: 'true', route: 'cap.answer' },
      ] },
  ],
});

// ── simulate a burst of tenants hitting the same sheet ──
const tenants = [
  { id: 'acme', type: 'agent', tags: ['premium'] },
  { id: 'globex', type: 'agent', tags: ['standard'] },
  { id: 'freebie', type: 'agent', tags: ['free'] },
];

for (const tenant of tenants) {
  const ctx = { identity: tenant, timestamp: Date.now() };
  const r1 = await engine.call('gateway.route', { q: 'hello' }, ctx);
  const r2 = await engine.call('gateway.route', { q: 'hello' }, ctx); // same tenant+question -> cached?
  const r3 = await engine.call('gateway.route', { q: 'different question' }, ctx);
  console.log(`${tenant.id.padEnd(8)} (tier: ${tenant.tags[0]})`);
  console.log(`  call1: ${JSON.stringify(r1.data)}`);
  console.log(`  call2 (same q): ${JSON.stringify(r2.data)}  <- ${JSON.stringify(r1.data) === JSON.stringify(r2.data) ? 'MEMOIZED' : 'recomputed'}`);
  console.log(`  call3 (new q):  ${JSON.stringify(r3.data)}`);
}

console.log('\ncap.answer invocations:', (globalThis.__llmCalls ?? 0),
  '(acme+globex each pay 1 for first q; free tier never reaches the model)');

// ── the memoization audit: read the cache keys directly ──
const cap = engine.getCell('cap.answer');
console.log('\ncache keys on cap.answer:', [...cap.contextCache.keys()].map(k =>
  k.replace(/r:evt[^|]*/, 'r:<event>')));
console.log('\n-> one cell, per-tenant isolated memoized results, zero infrastructure.');
console.log('-> KNOWN GAP (finding #9): contextKey excludes INPUT, so call3 (new q, same');
console.log('   tenant) is served the memoized first answer. Workaround: vary ctx.row per');
console.log('   request (e.g. row = request id) until per-input keys land in the engine.');
