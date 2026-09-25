// E2 — A from-scratch reactive app: "Service Health Responder"
// Proves the core loop: sensors -> formulas -> listeners -> program actions,
// with subscriptions as the "dashboard".
import { QuiltEngine } from '/home/z/my-project/quilt-playtest/packages/core/dist/index.js';

const engine = new QuiltEngine('svc-health', { tracing: true });

engine.loadSheet({
  id: 'svc-health',
  title: 'Service Health Responder',
  cells: [
    // --- push-based telemetry ---
    { id: 'telemetry.cpu',      kind: 'sensor', source: 'proc', default: 22, unit: 'pct' },
    { id: 'telemetry.mem',      kind: 'sensor', source: 'proc', default: 41, unit: 'pct' },
    { id: 'telemetry.err_rate', kind: 'sensor', source: 'gateway', default: 0.4, unit: 'pct' },

    // --- pure derived state ---
    { id: 'health.load',   kind: 'formula', expr: '(telemetry.cpu * 0.6 + telemetry.mem * 0.4) / 100' },
    { id: 'health.error',  kind: 'formula', expr: 'telemetry.err_rate' },
    { id: 'health.score',  kind: 'formula',
      expr: 'clamp(100 - health.load * 70 - health.error * 8, 0, 100)' },
    { id: 'health.status', kind: 'formula',
      expr: 'health.score > 70 ? "green" : health.score > 40 ? "amber" : "red"' },

    // --- reactive policy: page a human when red ---
    // NOTE (learned the hard way): conditions see caller.metadata.{changed,prev,current}
    // — a bare `current` throws inside evalWhen and is SILENTLY swallowed (returns false).
    { id: 'policy.page_on', kind: 'listener',
      watch: ['health.status'],
      condition: 'caller.metadata.current === "red" && caller.metadata.prev !== "red"',
      action: 'action.page' },

    // --- effectful action (code is a function BODY: input, caller, runtime, clamp...) ---
    { id: 'action.page', kind: 'program',
      code: `return { paged: true, on: input?.changed, at: Date.now() };` },
  ],
});

// dashboard subscription with a filter: only care about red transitions
const seen = [];
engine.subscribe('health.status', (v, prev) => {
  seen.push({ from: prev.data, to: v.data, at: v.computedAt });
}, (v, prev) => v.data === 'red' || prev.data === 'red');

console.log('── initial state ──');
console.log('health.score :', (await engine.get('health.score')).data);
console.log('health.status:', (await engine.get('health.status')).data);

console.log('\n── degrade the service (push new sensor readings) ──');
await engine.push('telemetry.cpu', 91);
await engine.push('telemetry.mem', 88);
console.log('status after cpu/mem spike:', (await engine.get('health.status')).data);
await engine.get('action.page'); // pull the pager to see if the listener fired
console.log('pager payload:', JSON.stringify((await engine.get('action.page')).data));

console.log('\n── recover ──');
await engine.push('telemetry.cpu', 30);
await engine.push('telemetry.mem', 45);
console.log('status after recovery     :', (await engine.get('health.status')).data);

console.log('\n── dashboard subscription caught transitions:', JSON.stringify(seen.map(s => `${s.from}→${s.to}`)));
console.log('── traces recorded:', engine.getTraces().length);
console.log('── cells:', engine.listCells().length, '| pager payload:', JSON.stringify((await engine.get('action.page')).data));
