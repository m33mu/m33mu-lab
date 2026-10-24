// A recorded SIGC trace replayed into an MCU input: a 0/3.3 V square (period
// 2 ms, edges 10 us) through 1 kOhm into PA6 of the button demo firmware,
// whose EXTI handler mirrors PA6 on PA5. The vsource is what the catalog's
// sigc-source part compiles to (tests/project/project.test.ts checks that).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadWorker, pad } from './web-worker-harness.mjs';

const [workerPath, buttonElf] = process.argv.slice(2);
const w = await loadWorker(workerPath);
assert.equal((await w.request('loadFirmware', { bytes: new Uint8Array(readFileSync(buttonElf)) })).ok, true);

// One 2 ms period (the last point): 10 us rise ending at 1 ms, 10 us fall ending at 2 ms.
const source = [{ kind: 'vsource', id: 'sig1', p: 'src', n: 'gnd', volts: 0,
  pwl: { timesNs: [0, 990_000, 1_000_000, 1_990_000, 2_000_000], volts: [0, 0, 3.3, 3.3, 0], repeat: true } }];
const netlist = { schemaVersion: 1, devices: [
  ...source,
  { kind: 'resistor', id: 'r1', a: 'src', b: 'PA6', ohms: 1000 },
  { kind: 'pad', id: 'pad-PA6', node: 'PA6', pad: pad('PA6') },
  { kind: 'pad', id: 'pad-PA5', node: 'PA5', pad: pad('PA5') },
  { kind: 'resistor', id: 'r3', a: 'PA5', b: 'gnd', ohms: 10e3 },
  { kind: 'ground', id: 'gnd1', node: 'gnd' }
] };
assert.equal((await w.request('createBench', { netlist, options: { sampleNs: 10_000 } })).ok, true);
const events = (await w.runBench(6_500_000)).flatMap((b) => b.events);
const crossings = events.filter((e) => e.kind === 'crossing' && e.socPad === 'PA6');
const led = events.filter((e) => e.kind === 'pad' && e.socPad === 'PA5');
// The rising threshold (about 1.78 V) is crossed about halfway up each 10 us
// edge, and the edges repeat exactly every 2 ms.
const rises = crossings.filter((c) => c.level === 1).map((c) => c.timeNs);
const falls = crossings.filter((c) => c.level === 0).map((c) => c.timeNs);
assert.equal(rises.length, 3, JSON.stringify(crossings));
assert.ok(falls.length >= 3);
assert.ok(rises[0] > 990_000 && rises[0] < 1_000_000, `first rise at ${rises[0]}`);
rises.forEach((t, k) => assert.ok(Math.abs(t - rises[0] - 2_000_000 * k) < 1, `rise ${k} at ${t}`));
for (const t of rises) {
  const on = led.find((e) => e.drive === 'high' && e.timeNs >= t);
  assert.ok(on && on.timeNs - t < 2_000, `LED follows the rise at ${t}`);
}
await w.request('destroyBench');
console.log(`web sigc source: ok (rises at ${rises.map((t) => (t / 1e6).toFixed(4)).join(', ')} ms, LED mirrors via EXTI)`);
process.exit(0);
