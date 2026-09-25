// E2b — drive the repo's own example sheets through their alert paths
// (patched engine: listener watch-wiring + eager mode; patched sheets: working idioms)
import { QuiltEngine, parseSheet } from '/home/z/my-project/quilt-playtest/packages/core/dist/index.js';
import { readFileSync } from 'node:fs';

const root = '/home/z/my-project/quilt-playtest';
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));

function makeEngine(yamlPath, opts = {}) {
  const sheet = parseSheet(readFileSync(`${root}/${yamlPath}`, 'utf8'));
  const engine = new QuiltEngine(sheet.id, { eager: true, tracing: true, ...opts });
  engine.loadSheet(sheet);
  return engine;
}

// ── 1. boat-autopilot: push the compass off course ──
{
  const e = makeEngine('examples/boat-autopilot/sheet.yaml');
  const logs = [];
  e.subscribe('log.off_course', v => { if (v.data) logs.push(v.data); });
  await e.push('compass.heading', 95);
  await tick();
  const err = (await e.get('heading.error')).data;
  console.log('1. boat-autopilot  heading.error =', err, '| alert:', JSON.stringify(logs[0] ?? null));
}

// ── 2. weather-monitor: comfort -> dangerous -> recovering ──
{
  const e = makeEngine('examples/weather-monitor/sheet.yaml');
  const events = [];
  e.subscribe('log.dangerous', v => { if (v.data) events.push(['dangerous', v.data.message]); });
  e.subscribe('log.comfort_lost', v => { if (v.data) events.push(['comfort_lost', v.data.message]); });
  await e.push('sensor.temperature', 95);  // comfortable -> dangerous
  await tick();
  await e.push('sensor.temperature', 20);  // dangerous -> safe again (no edge)
  await tick();
  console.log('2. weather-monitor events:', JSON.stringify(events));
}

// ── 3. sensor-anomaly: establish baseline, then spike ──
{
  const e = makeEngine('examples/sensor-anomaly/sheet.yaml');
  const alerts = [];
  e.subscribe('alert.emit', v => { if (v.data) alerts.push(v.data); });
  for (const t of [20, 21, 20, 22, 21]) await e.push('sensor.temp', t);
  await tick();
  const baseline = (await e.get('ewma.value')).data;
  await e.push('sensor.temp', 140); // the anomaly
  await tick();
  const z = (await e.get('surprise.z_score')).data;
  const esc = (await e.get('surprise.should_escalate')).data;
  console.log('3. sensor-anomaly   baseline=' + baseline.toFixed(2), 'z=' + (typeof z === 'number' ? z.toFixed(2) : z),
    'escalate=' + esc, '| alert:', JSON.stringify(alerts[0] ?? null));
}

// ── 4. task-scheduler: seed schedules, advance the clock past deadlines ──
{
  const e = makeEngine('examples/task-scheduler/sheet.yaml');
  const logs = [];
  e.subscribe('log.overdue', v => { if (v.data) logs.push(v.data); });
  const now = Date.now();
  await e.set('task.daily_summary.next_run_at', now - 5000); // due 5s ago
  await e.set('task.backup.next_run_at', now - 5000);
  await e.set('task.healthcheck.next_run_at', now + 3.5 * 24 * 3600 * 1000); // not yet due
  await e.set('clock.now', now + 10 * 24 * 3600 * 1000); // +10 days
  await tick();
  const anyOverdue = (await e.get('scheduler.any_overdue')).data;
  const list = (await e.call('scheduler.overdue_list')).data;
  console.log('4. task-scheduler   any_overdue =', anyOverdue, '| list:', JSON.stringify(list), '| log:', JSON.stringify(logs[0] ?? null));
}

// ── 5. traces: the engine recorded everything ──
{
  const e = makeEngine('examples/sensor-anomaly/sheet.yaml');
  for (const t of [20, 21, 140]) await e.push('sensor.temp', t);
  await tick();
  const traces = e.getTraces();
  const programTraces = traces.filter(t => t.cellId === 'ewma.update');
  console.log('5. tracing          engine recorded', traces.length, 'traces;',
    programTraces.length, 'ewma.update evaluations, avg',
    (programTraces.reduce((s, t) => s + (t.durationMs || 0), 0) / (programTraces.length || 1)).toFixed(2), 'ms each');
}
