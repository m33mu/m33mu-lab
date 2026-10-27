// Coupling scheduler tests against a deterministic fake MCU.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../../sim/circuit.ts';
import { Bench, type McuPadEvent, type McuPort, type McuRunResult } from '../../sim/bench.ts';
import { defaultPad, type Netlist } from '../../sim/netlist.ts';

const HZ = 64e6;
const NS = 1e9 / HZ;

/** Models the analog-loop fixture: PA5 output goes high at cycle 100; every
 * PA6 edge toggles PA5 twelve cycles later; BKPT after four edges. */
class FakeMcu implements McuPort {
  cycle = 0;
  pa5 = 0 as 0 | 1 | 2;
  pa6 = 0;
  edges: number[] = [];
  queue: { level: number; t: number }[] = [];
  out: McuPadEvent[] = [];
  pendingToggle: number[] = [];
  done = false;
  nowNs() { return this.cycle * NS; }
  padState(socPad: string) {
    return socPad === 'PA5' ? { level: this.pa5, mode: 3, openDrain: false, pull: 0 }
      : { level: 2 as const, mode: 0, openDrain: false, pull: 0 };
  }
  scheduleInput(socPad: string, level: 0 | 1, timeNs: number) {
    if (socPad !== 'PA6') return;
    assert.ok(timeNs >= this.nowNs() - 1e-9 || timeNs === this.nowNs());
    this.queue.push({ level, t: Math.max(timeNs, this.nowNs()) });
    this.queue.sort((a, b) => a.t - b.t);
  }
  cancelInputs(fromNs: number) { this.queue = this.queue.filter((e) => e.t < fromNs); }
  popPadEvents() { const o = this.out; this.out = []; return o; }
  private setPa5(level: 0 | 1) {
    this.pa5 = level;
    this.out.push({ socPad: 'PA5', level, mode: 1, openDrain: false, pull: 0, timeNs: this.nowNs() });
  }
  runUntil(deadlineNs: number, budget: number): McuRunResult {
    const r = { deadlineReached: false, padChanged: false, stopped: false, systemReset: false, instructions: 0 };
    while (r.instructions < budget && !this.done) {
      if (this.nowNs() >= deadlineNs - 1e-9) { r.deadlineReached = true; break; }
      if (r.padChanged) break;
      while (this.queue.length && this.queue[0].t <= this.nowNs() + 1e-9) {
        const e = this.queue.shift()!;
        if (e.level !== this.pa6) { this.pa6 = e.level; this.edges.push(this.cycle); this.pendingToggle.push(this.cycle + 12); }
      }
      this.cycle++;
      r.instructions++;
      if (this.cycle === 100) { this.setPa5(1); r.padChanged = true; }
      if (this.pendingToggle.length && this.pendingToggle[0] === this.cycle) {
        this.pendingToggle.shift();
        this.setPa5(this.pa5 === 1 ? 0 : 1);
        r.padChanged = true;
        if (this.edges.length >= 4) { this.done = true; r.stopped = true; }
      }
    }
    return r;
  }
}

function rcNetlist(): Netlist {
  return { schemaVersion: 1, devices: [
    { kind: 'pad', id: 'out', node: 'drive', pad: { ...defaultPad('PA5'), rOn: 1e-3, cIn: 0 } },
    { kind: 'resistor', id: 'r', a: 'drive', b: 'n', ohms: 1000 },
    { kind: 'capacitor', id: 'c', a: 'n', b: '0', farads: 10e-9 },
    { kind: 'pad', id: 'in', node: 'n', pad: { ...defaultPad('PA6'), cIn: 0 } }
  ] };
}

function run(lookaheadNs: number) {
  const mcu = new FakeMcu();
  const bench = new Bench(new Circuit(rcNetlist()), mcu, [{ id: 'v', kind: 'voltage', net: 'n' }],
    { lookaheadNs, sampleNs: 100 });
  for (let i = 0; i < 10_000 && !mcu.done; i++) bench.runUntil(1e6, 16);
  return { mcu, bench };
}

for (const lookahead of [50_000, 777]) test(`RC feedback through the scheduler matches analytic crossing times (lookahead ${lookahead} ns)`, () => {
  const { mcu, bench } = run(lookahead);
  assert.equal(mcu.edges.length, 4);
  const pads = bench.takeEvents();
  const crossings = pads.filter((e) => e.kind === 'crossing' && e.socPad === 'PA6');
  const drives = pads.filter((e) => e.kind === 'pad');
  assert.ok(crossings.length >= 4);
  const tau = 1e-5;
  const vr = defaultPad('PA6').vRise;
  const vf = defaultPad('PA6').vFall;
  // Piecewise analytic RC response driven by the recorded drive edges.
  let v = 0;
  let tPrev = drives[0].timeNs;
  let vs = 3.3;
  const vAt = (t: number) => vs + (v - vs) * Math.exp(-(t - tPrev) * 1e-9 / tau);
  let di = 1;
  for (let k = 0; k < 4; k++) {
    const x = crossings[k];
    while (di < drives.length && drives[di].timeNs <= x.timeNs) {
      v = vAt(drives[di].timeNs);
      tPrev = drives[di].timeNs;
      vs = drives[di].drive === 'high' ? 3.3 : 0;
      di++;
    }
    const target = x.level ? vr : vf;
    const expected = tPrev + -tau * Math.log((vs - target) / (vs - v)) * 1e9;
    // Class tolerance: 0.1% of tau.
    assert.ok(Math.abs(x.timeNs - expected) < 1e-3 * tau * 1e9, `crossing ${k}: ${x.timeNs} vs ${expected}`);
    // The MCU saw the edge at the first cycle boundary at or after the crossing.
    assert.equal(mcu.edges[k], Math.ceil(Math.ceil(x.timeNs - 1e-6) / NS - 1e-9));
  }
  assert.ok(bench.rollbacks >= 4, `rollbacks ${bench.rollbacks}`);
});

// Different lookaheads take different solver steps, so edges may round to
// neighbouring cycles; each lookahead is checked against the analytic
// response above. Replays with the same configuration must be identical.
test('scheduler replay is bit-identical for the same configuration', () => {
  const a = run(50_000);
  const b = run(50_000);
  assert.deepEqual(a.mcu.edges, b.mcu.edges);
  assert.deepEqual(a.bench.takeSamples(), b.bench.takeSamples());
});

test('samples are monotonic and bounded', () => {
  const { bench } = run(50_000);
  const s = bench.takeSamples();
  assert.ok(s.length > 10);
  for (let i = 1; i < s.length; i++) assert.ok(s[i][0] > s[i - 1][0]);
  for (const row of s) assert.ok(row[1] > -0.01 && row[1] < 3.31);
});

test('analog-only bench runs without an MCU', () => {
  const net: Netlist = { schemaVersion: 1, devices: [
    { kind: 'vsource', id: 'v', p: 'a', n: '0', volts: 5 },
    { kind: 'resistor', id: 'r', a: 'a', b: 'b', ohms: 1e3 },
    { kind: 'capacitor', id: 'c', a: 'b', b: '0', farads: 1e-6 }
  ] };
  const bench = new Bench(new Circuit(net), null, [{ id: 'vb', kind: 'voltage', net: 'b' }], { sampleNs: 1e5 });
  let r = bench.runUntil(5e6);
  for (let i = 0; i < 100 && !r.reachedTarget; i++) r = bench.runUntil(5e6);
  assert.ok(r.reachedTarget);
  // DC operating point start: capacitor already charged to 5 V.
  assert.ok(Math.abs(bench.circuit.nodeVoltage('b') - 5) < 1e-6);
});

test('the ADC gets each analog pad trajectory, corners kept, restarted on rollback', () => {
  const mcu = new FakeMcu();
  const sent: { socPad: string; tNs: number; mv: number }[] = [];
  (mcu as McuPort).pushAnalog = (socPad, tNs, mv) => sent.push({ socPad, tNs, mv });
  // PA6, the RC node, in analog mode.
  const digital = mcu.padState.bind(mcu);
  mcu.padState = (p: string) => (p === 'PA6' ? { ...digital(p), mode: 3 } : digital(p));
  const bench = new Bench(new Circuit(rcNetlist()), mcu, [], { lookaheadNs: 1000 });
  for (let i = 0; i < 2000 && !mcu.done; i++) bench.runUntil(1e6, 16);
  const all = sent.splice(0);
  sent.push(...all.filter((s) => s.socPad === 'PA6'));
  assert.ok(sent.length > 10, `${sent.length} points`);
  assert.ok(sent.every((s) => Number.isInteger(s.mv) && s.mv >= 0 && s.mv <= 5500));
  // PA5 is analog only until the firmware makes it an output at cycle 100.
  assert.ok(all.filter((s) => s.socPad === 'PA5').every((s) => s.tNs <= 100 * NS + 1));
  // PA5 steps high at cycle 100: the flat 0 mV stretch ends with a point
  // just before the charge starts rather than a ramp from time 0.
  const rise = sent.findIndex((s) => s.mv > 0);
  assert.ok(rise > 0 && sent[rise - 1].mv === 0 && sent[rise].tNs - sent[rise - 1].tNs < 2000,
    JSON.stringify(sent.slice(0, rise + 1)));
  assert.ok(sent.some((s) => s.mv >= Math.floor(defaultPad('PA6').vRise * 1000) - 5));
  // Each rollback restarts the trajectory at the synchronized time.
  assert.ok(bench.rollbacks > 0);
  assert.ok(sent.some((s, i) => i > 0 && s.tNs <= sent[i - 1].tNs));
});
