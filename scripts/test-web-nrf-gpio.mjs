// nRF5340 pads on the bench: Button 1 (P0.23, pull-up) is copied to LED1
// (P0.28, active low), Arduino D2 (P1.04) to D3 (P1.05).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadWorker, pad } from './web-worker-harness.mjs';

const [workerPath, elf] = process.argv.slice(2);
const w = await loadWorker(workerPath);
assert.equal((await w.request('loadFirmware', { bytes: new Uint8Array(readFileSync(elf)), cpu: 'nrf5340' })).ok, true);
const pads = ['P0.23', 'P0.28', 'P1.04', 'P1.05'];
const netlist = { schemaVersion: 1, devices: [
  { kind: 'ground', id: 'g', node: 'GND' },
  ...pads.map((p) => ({ kind: 'pad', id: `pad-${p}`, node: p, pad: pad(p) })),
  { kind: 'switch', id: 'b1', a: 'P0.23', b: 'GND', closed: false, ron: 0.05, roff: 1e10 },
  { kind: 'switch', id: 'd2', a: 'P1.04', b: 'GND', closed: false, ron: 0.05, roff: 1e10 },
  { kind: 'resistor', id: 'rled', a: 'P0.28', b: 'GND', ohms: 10e3 },
  { kind: 'resistor', id: 'rd3', a: 'P1.05', b: 'GND', ohms: 10e3 }
] };
const created = await w.request('createBench', { netlist, options: { sampleNs: 100_000 } });
assert.equal(created.ok, true, JSON.stringify(created.error));
const all = [...await w.runBench(1_000_000)];
const t1 = Number((await w.request('setSwitch', { device: 'b1', closed: true })).result.timeNs);
all.push(...await w.runBench(2_000_000));
const t2 = Number((await w.request('setSwitch', { device: 'd2', closed: true })).result.timeNs);
all.push(...await w.runBench(3_000_000));
const ev = all.flatMap((b) => b.events);
assert.deepEqual(ev.filter((e) => e.kind === 'unsupported'), []);
const last = (p, before) => ev.filter((e) => e.kind === 'pad' && e.socPad === p && e.timeNs <= before).at(-1)?.drive;
assert.equal(last('P0.28', t1), 'high', 'LED1 off (high) while Button 1 is up');
assert.equal(last('P0.28', 2_000_000), 'low', 'LED1 on (low) while Button 1 is held');
assert.equal(last('P1.05', t2), 'high');
assert.equal(last('P1.05', 3_000_000), 'low', 'D3 follows D2');
await w.request('destroyBench');
console.log('web nrf gpio: ok (nRF5340 Button 1 -> LED1, D2 -> D3 through P0/P1 pads)');
process.exit(0);
