// RP2350 pads on the bench: the Pico 2 demo firmware toggles GPIO25 every
// 50 ms and mirrors GPIO15 (pull-up input, pulled low by a switch) on GPIO16.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadWorker, pad } from './web-worker-harness.mjs';

const [workerPath, elf] = process.argv.slice(2);
const w = await loadWorker(workerPath);
assert.equal((await w.request('loadFirmware', { bytes: new Uint8Array(readFileSync(elf)), cpu: 'rp2350' })).ok, true);
const netlist = { schemaVersion: 1, devices: [
  { kind: 'ground', id: 'g', node: 'GND' },
  { kind: 'pad', id: 'pad-GPIO25', node: 'GPIO25', pad: pad('GPIO25') },
  { kind: 'resistor', id: 'rled', a: 'GPIO25', b: 'GND', ohms: 10e3 },
  { kind: 'pad', id: 'pad-GPIO15', node: 'GPIO15', pad: pad('GPIO15') },
  { kind: 'switch', id: 'sw1', a: 'GPIO15', b: 'GND', closed: false, ron: 0.05, roff: 1e10 },
  { kind: 'pad', id: 'pad-GPIO16', node: 'GPIO16', pad: pad('GPIO16') },
  { kind: 'resistor', id: 'rm', a: 'GPIO16', b: 'GND', ohms: 10e3 }
] };
const created = await w.request('createBench', { netlist, options: { sampleNs: 100_000 } });
assert.equal(created.ok, true, JSON.stringify(created.error));
assert.deepEqual(created.result.pads.sort(), ['GPIO15', 'GPIO16', 'GPIO25']);
const all = [];
all.push(...await w.runBench(30_000_000));
const press = await w.request('setSwitch', { device: 'sw1', closed: true });
assert.equal(press.ok, true);
const tPress = Number(press.result.timeNs);
all.push(...await w.runBench(120_000_000));
const allEvents = all.flatMap((b) => b.events);
// GPIOs reset to FUNCSEL NULL: no alternate-function notices for plain IO.
assert.deepEqual(allEvents.filter((e) => e.kind === 'unsupported'), []);
const events = allEvents.filter((e) => e.kind === 'pad');
const led = events.filter((e) => e.socPad === 'GPIO25');
const mirror = events.filter((e) => e.socPad === 'GPIO16');
// GPIO25 driven high, then low 50 ms later (TIMER0 microseconds).
const ledHigh = led.find((e) => e.drive === 'high');
const ledLow = led.find((e) => e.drive === 'low' && ledHigh && e.timeNs > ledHigh.timeNs);
assert.ok(ledHigh && ledLow, JSON.stringify(led.slice(0, 4)));
assert.ok(Math.abs(ledLow.timeNs - ledHigh.timeNs - 50e6) < 1e5, `LED half period ${ledLow.timeNs - ledHigh.timeNs}`);
// The pull-up keeps GPIO15 high until the switch closes; GPIO16 follows.
assert.ok(mirror.some((e) => e.drive === 'high' && e.timeNs < tPress), JSON.stringify(mirror.slice(0, 3)));
const low = mirror.find((e) => e.drive === 'low' && e.timeNs >= tPress);
assert.ok(low && low.timeNs - tPress < 1e5, `mirror low ${low?.timeNs} after press ${tPress}`);
await w.request('destroyBench');
console.log(`web rp2350 gpio: ok (LED half period ${((ledLow.timeNs - ledHigh.timeNs) / 1e6).toFixed(3)} ms, GPIO16 low ${(low.timeNs - tPress).toFixed(0)} ns after GPIO15 pulled low)`);
process.exit(0);
