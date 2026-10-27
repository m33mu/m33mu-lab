// PWM -> RC -> ADC feedback through the worker: TIM4_CH4 on PD15 drives an RC
// filter into Arduino A0 (PA6, ADC1 IN3); the firmware converts A0 every 5 ms
// and steers the duty cycle to a 1650 mV setpoint.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadWorker, pad } from './web-worker-harness.mjs';

const [workerPath, adcElf] = process.argv.slice(2);
const w = await loadWorker(workerPath);
assert.equal((await w.request('loadFirmware', { bytes: new Uint8Array(readFileSync(adcElf)) })).ok, true);
const { symbols } = (await w.request('symbols')).result;
const addr = (name) => symbols.find((s) => s.name === name)?.address;
async function readU32(name) {
  const r = await w.request('readMemory', { address: addr(name), length: 4 });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const b = r.result.bytes;
  return (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0;
}
const netlist = { schemaVersion: 1, devices: [
  { kind: 'pad', id: 'pad-PD15', node: 'PD15', pad: pad('PD15') },
  { kind: 'pad', id: 'pad-PA6', node: 'f', pad: pad('PA6') },
  { kind: 'resistor', id: 'r1', a: 'PD15', b: 'f', ohms: 10e3 },
  { kind: 'capacitor', id: 'c1', a: 'f', b: 'gnd', farads: 1e-6 },
  { kind: 'ground', id: 'gnd1', node: 'gnd' }
] };
const created = await w.request('createBench', { netlist, options: { sampleNs: 100_000 },
  probes: [{ id: 'rc', kind: 'voltage', net: 'f' }] });
assert.equal(created.ok, true, JSON.stringify(created.error));
const batches = await w.runBench(400_000_000);

const conversions = await readU32('g_conversions');
const mv = await readU32('g_adc_mv');
const duty = await readU32('g_duty_us');
assert.ok(conversions > 60, `only ${conversions} conversions`);
// Settled loop: A0 at the setpoint, PWM near 50 %, and the circuit agrees
// with what the ADC read.
assert.ok(Math.abs(mv - 1650) < 40, `ADC read ${mv} mV`);
assert.ok(Math.abs(duty - 500) < 40, `duty ${duty} us`);
const rows = [];
for (const b of batches) for (let i = 0; i < b.samples.length; i += 2) rows.push([b.samples[i], b.samples[i + 1]]);
const tail = rows.filter((r) => r[0] > 350e6);
const mean = tail.reduce((s, r) => s + r[1], 0) / tail.length;
assert.ok(Math.abs(mean - 1.65) < 0.04, `RC mean ${mean} V`);
const unsupported = batches.flatMap((b) => b.events).filter((e) => e.kind === 'unsupported');
assert.equal(unsupported.length, 0, JSON.stringify(unsupported));
await w.request('destroyBench');
console.log(`web adc: ok (${conversions} conversions, A0 ${mv} mV, duty ${duty} us, RC mean ${mean.toFixed(3)} V)`);
process.exit(0);
