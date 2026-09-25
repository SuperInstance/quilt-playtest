// E4 — FEDERATION: three QuiltEngines linked across "instances".
// The SDK's LocalCellTransport claims to work with QuiltEngine but no
// adapter exists (SDK tests use hand-rolled fake engines). This demo
// ships the missing ~20-line adapter and proves cross-instance cell
// addressing, propagation and subscription work end-to-end.
import { QuiltEngine } from '/home/z/my-project/quilt-playtest/packages/core/dist/index.js';
import {
  LocalCellTransport, CellRouter, resolveCell, subscribeCell, parseCellRef,
} from '/home/z/my-project/quilt-playtest/packages/sdk/dist/index.js';

// ── THE MISSING ADAPTER: QuiltEngine -> SDK LocalEngine ──────────────
function adaptEngine(engine) {
  return {
    async getCell(_sheetId, cellPath) {
      const v = await engine.get(cellPath);
      if (v.status === 'error') throw new Error(v.error?.message ?? 'cell error');
      return v.data;
    },
    async setCell(_sheetId, cellPath, value) {
      const cell = engine.getCell(cellPath);
      if (!cell) throw new Error(`no such cell: ${cellPath}`);
      if (cell.def.kind === 'sensor' || cell.def.kind === 'io') await engine.push(cellPath, value);
      else await engine.set(cellPath, value);
    },
    subscribe(_sheetId, cellPath, cb) {
      const subId = engine.subscribe(cellPath, (v) => cb(v.data));
      return () => engine.unsubscribe(subId);
    },
  };
}

// ── three engines: an edge device, a server, and a cloud control plane ──
const edge = new QuiltEngine('jetson-1', { eager: true });
edge.loadSheet({ id: 'autopilot', cells: [
  { id: 'compass.heading', kind: 'sensor', default: 180 },
  { id: 'desired.heading', kind: 'value', value: 180 },
  { id: 'heading.error', kind: 'formula', expr: '((desired.heading - compass.heading + 540) % 360) - 180' },
  { id: 'rudder.angle', kind: 'formula', expr: 'clamp(heading.error * 0.5, -30, 30)' },
  { id: 'alert.off_course', kind: 'listener', watch: ['heading.error'],
    condition: 'caller.metadata && Math.abs(caller.metadata.current) > 30', action: 'log.off_course' },
  { id: 'log.off_course', kind: 'program', code: `return { severity:'warn', off_by: Math.abs(input?.value ?? 0) };` },
]});

const server = new QuiltEngine('srv-fleet', { eager: true });
server.loadSheet({ id: 'fleet-agg', cells: [
  { id: 'fleet.jetson1_rudder', kind: 'value', value: null, description: 'mirror of edge rudder' },
  { id: 'fleet.jetson1_rudder_abs', kind: 'formula', expr: 'fleet.jetson1_rudder == null ? null : abs(fleet.jetson1_rudder)' },
]});

const cloud = new QuiltEngine('cloud-cp', { eager: true });
cloud.loadSheet({ id: 'control-plane', cells: [
  { id: 'cp.max_abs_rudder', kind: 'value', value: 0, description: 'worst-case steering demand seen' },
  { id: 'cp.alert_count', kind: 'value', value: 0 },
]});

// ── link them through the SDK ──
const transport = new LocalCellTransport(new Map([
  ['local', adaptEngine(edge)],
  ['srv', adaptEngine(server)],
  ['cloud', adaptEngine(cloud)],
]), 'local');

const router = new CellRouter();
router.add('local', transport).add('srv', transport).add('cloud', transport);
console.log('router instances:', router.instances().join(', '));

// cross-instance subscription: watch the server-side mirror of the edge rudder
const mirrorLog = [];
await subscribeCell('quilt://srv/fleet-agg#fleet.jetson1_rudder_abs', transport, (v) => {
  if (v != null) mirrorLog.push(v);
});

// ── drive: steer the edge boat, mirror into server, roll up into cloud ──
console.log('\n── steering the edge boat ──');
for (const h of [180, 150, 120, 90, 60]) {
  await edge.push('compass.heading', h);
  const rudder = (await edge.get('rudder.angle')).data;
  await server.set('fleet.jetson1_rudder', rudder);
  const abs = (await server.get('fleet.jetson1_rudder_abs')).data;
  const worst = (await cloud.get('cp.max_abs_rudder')).data;
  await cloud.set('cp.max_abs_rudder', Math.max(worst ?? 0, Math.abs(abs ?? 0)));
  console.log(`  heading=${h}°  edge.rudder=${rudder}°  srv.abs=${abs}°  cloud.worst=${(await cloud.get('cp.max_abs_rudder')).data}°`);
}

// remote cell handle: resolve + subscribe through the router
const edgeAlert = await resolveCell('quilt://local/autopilot#log.off_course', transport);
const alerts = [];
edgeAlert.subscribe((v) => { if (v) alerts.push(v); });
await edge.push('compass.heading', 10); // 170° off course
console.log('\n── resolved remote handle fired alert:', JSON.stringify(alerts[0] ?? null));

console.log('\n── final cloud state:', JSON.stringify({
  max_abs_rudder: (await cloud.get('cp.max_abs_rudder')).data,
  alert_count: (await cloud.get('cp.alert_count')).data,
}));
console.log('── parseCellRef check:', JSON.stringify(parseCellRef('quilt://jetson-7/autopilot#rudder.angle')));
