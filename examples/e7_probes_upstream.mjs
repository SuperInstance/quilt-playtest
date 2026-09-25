// E7 — adversarial probe suite: find where the reactive model holds and where it leaks
import { QuiltEngine, parseSheet, Gesture } from '/home/z/my-project/quilt-upstream-main/packages/core/dist/index.js';

let pass = 0, fail = 0;
const rec = (name, ok, detail) => { ok ? pass++ : fail++; console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };

// ── P1: does a subscription on a FORMULA fire when inputs are pushed? ──
{
  const e = new QuiltEngine('p1', { eager: true });
  e.loadSheet({ id: 'p1', cells: [
    { id: 'a', kind: 'value', value: 1 },
    { id: 'b', kind: 'formula', expr: 'a * 2' },
  ]});
  const fires = [];
  e.subscribe('b', v => fires.push(v.data));
  (await e.get('b'));
  await e.set('a', 5);
  (await e.get('b'));
  rec('P1 subscribe-on-formula fires on input change', fires.length > 0, `fires=${JSON.stringify(fires)} (0 = derived cells are invisible to subscribers until pulled)`);
}

// ── P2: does a listener watching a FORMULA fire when the formula's inputs change? (the repo's own sensor-anomaly pattern) ──
{
  const e = new QuiltEngine('p2', { eager: true });
  e.loadSheet({ id: 'p2', cells: [
    { id: 'sensor.temp', kind: 'sensor', default: 20 },
    { id: 'should_escalate', kind: 'formula', expr: 'sensor.temp > 80' },
    { id: 'alert', kind: 'listener', watch: ['should_escalate'], condition: 'caller.metadata.current === true', action: 'action' },
    { id: 'action', kind: 'program', code: `return { fired: !!input, changed: input?.changed ?? null };` },
  ]});
  await e.get('should_escalate'); // prime the formula (false)
  const events = [];
  e.subscribe('action', v => events.push(v.data)); // observe listener-path invocations
  await e.push('sensor.temp', 95); // now over threshold
  const viaListener = events.find(x => x?.fired);
  rec('P2 listener-on-formula fires on threshold crossing', viaListener?.changed === 'should_escalate', `listener-path invocations: ${JSON.stringify(events)}`);
}

// ── P3: listener watching a VALUE/SENSOR cell (should work) ──
{
  const e = new QuiltEngine('p3', { eager: true });
  e.loadSheet({ id: 'p3', cells: [
    { id: 's', kind: 'sensor', default: 1 },
    { id: 'alert', kind: 'listener', watch: ['s'], condition: 'caller.metadata.current > 10', action: 'action' },
    { id: 'action', kind: 'program', code: `return { fired: !!input, changed: input?.changed ?? null };` },
  ]});
  const events = [];
  e.subscribe('action', v => events.push(v.data));
  await e.push('s', 50);
  const viaListener = events.find(x => x?.fired);
  rec('P3 listener-on-sensor fires', viaListener?.changed === 's', `listener-path invocations: ${JSON.stringify(events)}`);
}

// ── P4: dependency cycle a->b->a ──
{
  const e = new QuiltEngine('p4', { eager: true });
  e.loadSheet({ id: 'p4', cells: [
    { id: 'a', kind: 'formula', expr: 'b + 1', deps: ['b'] },
    { id: 'b', kind: 'formula', expr: 'a + 1', deps: ['a'] },
  ]});
  let pushOutcome = 'ok';
  try {
    await Promise.race([
      e.set('a', 1), // push path — should hit the cycle guard now
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 2s')), 2000)),
    ]);
    pushOutcome = 'completed without hang';
  } catch (err) { pushOutcome = `threw: ${String(err.message).slice(0, 60)}`; }
  let getOutcome = 'ok';
  try {
    // idle cycle (fresh engine, nothing computed yet) — the true crash case
    const e2 = new QuiltEngine('p4b', { eager: true });
    e2.loadSheet({ id: 'p4b', cells: [
      { id: 'a', kind: 'formula', expr: 'b + 1', deps: ['b'] },
      { id: 'b', kind: 'formula', expr: 'a + 1', deps: ['a'] },
    ]});
    await Promise.race([
      e2.get('a'), // pull path — refreshDeps still recurses on idle cycles (documented gap)
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 2s')), 2000)),
    ]);
    getOutcome = 'completed';
  } catch (err) { getOutcome = `threw: ${String(err.message).slice(0, 60)}`; }
  rec('P4 cycle: push path guarded, idle pull still overflows', pushOutcome.includes('without hang') && getOutcome.includes('threw'), `push=${pushOutcome} | idle-get=${getOutcome}`);
}

// ── P5: deep chain — 900 formulas a0->a1->...->a899 ──
{
  const e = new QuiltEngine('p5');
  const cells = [{ id: 'a0', kind: 'value', value: 1 }];
  for (let i = 1; i < 900; i++) cells.push({ id: `a${i}`, kind: 'formula', expr: `a${i - 1} + 1` });
  e.loadSheet({ id: 'p5', cells });
  const t0 = performance.now();
  const v = await e.get('a899');
  const ms = (performance.now() - t0).toFixed(1);
  rec('P5 900-deep chain evaluates', v.data === 900, `value=${v.data} in ${ms}ms (recursion depth survived)`);
}

// ── P6: wide fan-out — 1 sensor -> 5000 formulas, push propagation ──
{
  const e = new QuiltEngine('p6');
  const cells = [{ id: 'src', kind: 'sensor', default: 0 }];
  for (let i = 0; i < 5000; i++) cells.push({ id: `f${i}`, kind: 'formula', expr: 'src * 2', deps: ['src'] });
  e.loadSheet({ id: 'p6', cells });
  await e.get('f0');
  const t0 = performance.now();
  await e.push('src', 21);
  const ms = (performance.now() - t0).toFixed(1);
  const v = await e.get('f4999');
  rec('P6 push fans out to 5000 formulas', v.data === 42, `push took ${ms}ms, f4999=${v.data}`);
}

// ── P7: NaN leakage — formula over un-pushed sensor ──
{
  const e = new QuiltEngine('p7');
  e.loadSheet({ id: 'p7', cells: [
    { id: 'compass.heading', kind: 'sensor' },
    { id: 'error', kind: 'formula', expr: 'compass.heading - 180' },
  ]});
  const v = await e.get('error');
  rec('P7 NaN guard on missing sensor', v.status === 'error' || Number.isNaN(v.data) === false, `status=${v.status} data=${v.data} (NaN flows silently through pure graph)`);
}

// ── P8: per-context memoization — same effectful cell, two tenants ──
{
  const e = new QuiltEngine('p8');
  
  e.loadSheet({ id: 'p8', cells: [
    { id: 'expensive', kind: 'program', code: `globalThis.__calls = (globalThis.__calls ?? 0) + 1; return { for: caller.identity?.id };` },
  ]});
  const calls = () => globalThis.__calls ?? 0;
  const ctxA = { identity: { id: 'tenant-a', type: 'agent' }, timestamp: Date.now() };
  const ctxB = { identity: { id: 'tenant-b', type: 'agent' }, timestamp: Date.now() };
  await e.call('expensive', null, ctxA);
  await e.call('expensive', null, ctxA); // same tenant -> cached
  await e.call('expensive', null, ctxB); // other tenant -> recompute
  rec("P8 per-tenant memoization", calls() === 2, `program executed ${calls()}x for 3 calls across 2 tenants (expect 2)`);
}

// ── P9: does evaluating an effectful cell mark downstream formulas stale? ──
{
  const e = new QuiltEngine('p9', { eager: true });
  e.loadSheet({ id: 'p9', cells: [
    { id: 'prog', kind: 'program', code: `return (input?.n ?? 0);`, deps: [] },
    { id: 'down', kind: 'formula', expr: 'prog + 1', deps: ['prog'] },
  ]});
  const first = await e.get('down'); // prog=0 -> down=1
  await e.call('prog', { n: 10 });   // prog now 10
  const second = await e.get('down');
  rec('P9 formula sees re-evaluated program', second.data === 11, `first=${first.data} second=${second.data} (11 = freshness propagated)`);
}

// ── P10: set on missing cell vs get on missing cell ──
{
  const e = new QuiltEngine('p10');
  e.loadSheet({ id: 'p10', cells: [{ id: 'x', kind: 'value', value: 1 }] });
  let setThrew = false, gotErr = null;
  try { await e.set('nope', 1); } catch { setThrew = true; }
  const g = await e.get('nope');
  gotErr = g.status;
  rec('P10 asymmetric error handling', setThrew && gotErr === 'error', `set threw=${setThrew}, get.status='${gotErr}' (asymmetry is documented-ish but surprising)`);
}

// ── P11: Gesture sanity (the differential-geometry API) ──
{
  const straight = Gesture.fromSeries([1, 2, 3, 4, 5]);
  const oscillating = Gesture.fromSeries([1, 5, 1, 5, 1, 5]);
  rec('P11 Gesture: straight path has ~0 bending energy, oscillation high',
    straight.bendingEnergy() < 0.01 && oscillating.bendingEnergy() > 1,
    `straight=${straight.bendingEnergy().toFixed(4)}, oscillating=${oscillating.bendingEnergy().toFixed(3)}`);
}

console.log(`\n══ ${pass} held, ${fail} leaked ══`);
