// Timer PWM through the worker: TIM4_CH4 on PD15 (1 kHz, 25 %) drives an RC
// filter whose output settles at the duty-weighted average, and TIM3_CH3 on
// PB0 (on-board LD1) ramps its duty cycle.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadWorker, pad } from './web-worker-harness.mjs';

// Optional third argument: the m33mu CPU (default stm32h563).
const [workerPath, pwmElf, cpu] = process.argv.slice(2);
const w = await loadWorker(workerPath);
assert.equal((await w.request('loadFirmware', { bytes: new Uint8Array(readFileSync(pwmElf)), cpu })).ok, true);
// The firmware's prescalers assume a 64 MHz clock: on a part that resets
// slower, every period stretches by k.
const cpuHz = w.messages.find((m) => m.event === 'state')?.payload.cpuHz ?? 64e6;
const k = 64e6 / cpuHz;
const netlist = { schemaVersion: 1, devices: [
  { kind: 'pad', id: 'pad-PD15', node: 'PD15', pad: pad('PD15') },
  { kind: 'resistor', id: 'r1', a: 'PD15', b: 'f', ohms: 10e3 },
  { kind: 'capacitor', id: 'c1', a: 'f', b: 'gnd', farads: 1e-6 },
  { kind: 'ground', id: 'gnd1', node: 'gnd' }
] };
const created = await w.request('createBench', { netlist, options: { sampleNs: 10_000 },
  probes: [{ id: 'pwm', kind: 'voltage', net: 'PD15' }, { id: 'rc', kind: 'voltage', net: 'f' }] });
assert.equal(created.ok, true, JSON.stringify(created.error));
const batches = await w.runBench(Math.round(120_000_000 * k));

// Pad edges: period 1 ms, high 250 us.
const drives = batches.flatMap((b) => b.events).filter((e) => e.kind === 'pad' && e.socPad === 'PD15');
const highs = drives.filter((e) => e.drive === 'high').map((e) => e.timeNs);
const lows = drives.filter((e) => e.drive === 'low').map((e) => e.timeNs);
assert.ok(highs.length > 100, `only ${highs.length} rising edges`);
for (let i = 2; i < highs.length; i++) {
  assert.ok(Math.abs(highs[i] - highs[i - 1] - 1e6 * k) < 50, `period ${highs[i] - highs[i - 1]} ns`);
}
const width = lows.find((t) => t > highs[2]) - highs[2];
assert.ok(Math.abs(width - 250e3 * k) < 50, `high time ${width} ns`);
const unsupported = batches.flatMap((b) => b.events).filter((e) => e.kind === 'unsupported' && e.socPad === 'PD15');
assert.equal(unsupported.length, 0, JSON.stringify(unsupported));

// RC output after 10 tau: mean 3.3 V * 25 %, ripple a few mV.
const rows = [];
for (const b of batches) for (let i = 0; i < b.samples.length; i += 3) rows.push([b.samples[i], b.samples[i + 1], b.samples[i + 2]]);
const tail = rows.filter((r) => r[0] > 100e6 * k);
const mean = tail.reduce((s, r) => s + r[2], 0) / tail.length;
assert.ok(Math.abs(mean - 0.825) < 0.03, `RC mean ${mean} V`);
const vmax = Math.max(...tail.map((r) => r[1]));
assert.ok(vmax > 3.2, `PWM high ${vmax} V`);

// LD1: duty ramps by 2 % per 20 ms, reported by padDuty.
const duty = batches.map((b) => [Number(b.timeNs), b.padDuty?.PB0]).filter(([, d]) => d !== undefined);
const late = await w.runBench(Math.round(520_000_000 * k));
// Each batch reports the duty since the previous one; batches are sized by
// wall time, so average them, weighted by length, over the last >= 10 ms.
let lateDuty = 0;
{
  let span = 0;
  let sum = 0;
  for (let i = late.length - 1; i > 0 && span < 10e6 * k; i--) {
    const dt = Number(late[i].timeNs) - Number(late[i - 1].timeNs);
    const d = late[i].padDuty?.PB0;
    if (d === undefined || dt <= 0) continue;
    span += dt;
    sum += d * dt;
  }
  lateDuty = span > 0 ? sum / span : NaN;
}
assert.ok(duty.length > 0);
assert.ok(lateDuty > 0.4 && lateDuty < 0.6, `LD1 duty at 0.5 s: ${lateDuty}`);
await w.request('destroyBench');
console.log(`web pwm${cpu ? ` ${cpu}` : ''}: ok (period ${(k).toFixed(3)} ms, high ${width / 1e3} us, RC mean ${mean.toFixed(3)} V, LD1 duty at 0.5 s ${lateDuty.toFixed(2)})`);
process.exit(0);
