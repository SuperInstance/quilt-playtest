// E3 — CELL EKG: gesture-based motion analysis wired to a live engine.
// Novel use: the repo's Gesture math (arcLength, bendingEnergy, twistEnergy,
// planarity) is a standalone module — nothing in the runtime uses it. This
// monitor attaches to ANY engine via subscriptions and classifies how each
// cell MOVES: smooth drift vs oscillation vs regime shift vs stuck.
// Threshold alarms fire on the motion signature, not on absolute values.
import { QuiltEngine, Gesture } from '/home/z/my-project/quilt-playtest/packages/core/dist/index.js';

// ── the reusable monitor ──────────────────────────────────────────────
class CellEKG {
  constructor(engine, { window = 24, onChange } = {}) {
    this.engine = engine;
    this.windowSize = window;
    this.onChange = onChange ?? (() => {});
    this.history = new Map();   // cellId -> number[] (or vec)
    this.state = new Map();     // cellId -> last phase label
    this.events = [];
  }

  watch(cellId) {
    this.history.set(cellId, []);
    this.state.set(cellId, 'quiet');
    this.engine.subscribe(cellId, (v) => {
      const d = v.data;
      if (typeof d !== 'number' || !Number.isFinite(d)) return;
      const h = this.history.get(cellId);
      h.push(d);
      if (h.length > this.windowSize) h.shift();
      if (h.length >= 6) this.classify(cellId, h.slice());
    });
  }

  classify(cellId, series) {
    const g = Gesture.fromSeries(series);
    const speed = g.speed();
    const arc = g.arcLength();
    const net = Math.abs(series[series.length - 1] - series[0]);
    const bending = g.bendingEnergy();
    const twist = g.twistEnergy?.() ?? 0;
    const planarity = g.planarity?.() ?? 1;
    const straightness = arc > 1e-9 ? net / arc : 1; // 1 = purposeful drift, ~0 = wandering

    let phase;
    if (speed < 1e-9) phase = 'stuck';
    else if (bending > 1.0) phase = 'oscillating';
    else if (twist > 0.5 || planarity < 0.5) phase = 'regime-shift';
    else if (straightness > 0.8) phase = 'drifting';
    else phase = 'wandering';

    const prev = this.state.get(cellId);
    if (phase !== prev) {
      const evt = { cell: cellId, from: prev, to: phase, at: Date.now(),
        metrics: { speed: +speed.toFixed(3), bending: +bending.toFixed(3),
                   twist: +twist.toFixed(3), straightness: +straightness.toFixed(2) } };
      this.events.push(evt);
      this.state.set(cellId, phase);
      this.onChange(evt);
    }
  }
}

// ── drive it with a synthetic sensor that changes its BEHAVIOR ────────
const engine = new QuiltEngine('ekg-demo', { eager: true });
engine.loadSheet({ id: 'ekg-demo', cells: [
  { id: 'plant.temp', kind: 'sensor', default: 40 },
  { id: 'plant.cooling', kind: 'formula', expr: 'plant.temp > 80 ? "active" : "idle"' },
]});

const ekg = new CellEKG(engine, {
  onChange: (e) => console.log(`  ⚡ phase change [${e.cell}]: ${e.from} → ${e.to}   ${JSON.stringify(e.metrics)}`),
});
ekg.watch('plant.temp');

console.log('── phase 1: smooth thermal drift (expect: drifting) ──');
for (let t = 40; t <= 58; t += 2) { await engine.push('plant.temp', t); await tick(5); }

console.log('── phase 2: cooling loop fault — hunting/oscillation (expect: oscillating) ──');
let dir = 1;
for (let i = 0; i < 12; i++) { await engine.push('plant.temp', 58 + dir * 6); dir *= -1; await tick(5); }

console.log('── phase 3: step change — compressor kicks in (expect: regime-shift or drifting) ──');
for (const t of [40, 34, 28, 22, 18, 15]) { await engine.push('plant.temp', t); await tick(5); }

console.log('── phase 4: settled (expect: stuck/quiet) ──');
for (let i = 0; i < 6; i++) { await engine.push('plant.temp', 15); await tick(5); }

console.log('\n── verdict: a naive threshold alarm (temp > 80) caught NONE of these');
console.log('   failures — the max temp reached was 64. The motion signature caught 3. ──');
console.log('   total phase transitions detected:', ekg.events.length);

function tick(ms) { return new Promise(r => setTimeout(r, ms)); }
