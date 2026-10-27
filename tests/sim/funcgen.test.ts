// Function generator waveforms against their closed forms.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edgeSeconds, funcGenPwl, SINE_POINTS } from '../../sim/funcgen.ts';
import { Circuit } from '../../sim/circuit.ts';
import { CATALOG } from '../../src/project/catalog.ts';

const base = { frequency: 1000, amplitude: 1, offset: 0.5, duty: 0.5 };

/** Linear interpolation of one period of a repeating PWL at tNs. */
function at(pwl: { timesNs: number[]; volts: number[] }, tNs: number): number {
  const T = pwl.timesNs[pwl.timesNs.length - 1];
  const t = ((tNs % T) + T) % T;
  let i = 0;
  while (pwl.timesNs[i + 1] < t) i++;
  const f = (t - pwl.timesNs[i]) / (pwl.timesNs[i + 1] - pwl.timesNs[i]);
  return pwl.volts[i] + f * (pwl.volts[i + 1] - pwl.volts[i]);
}

test('sine: within 0.03 % of the amplitude, one period long, repeating', () => {
  const pwl = funcGenPwl({ ...base, waveform: 'sine' });
  assert.equal(pwl.repeat, true);
  assert.equal(pwl.timesNs.length, SINE_POINTS + 1);
  assert.equal(pwl.timesNs.at(-1), 1e6);
  for (let t = 0; t < 2e6; t += 997) {
    const exact = 0.5 + Math.sin(2 * Math.PI * t / 1e6);
    assert.ok(Math.abs(at(pwl, t) - exact) <= 1 - Math.cos(Math.PI / SINE_POINTS) + 1e-12, `t ${t}`);
  }
});

test('square: duty, levels and edges; extreme duty clamps to the edges', () => {
  const pwl = funcGenPwl({ ...base, waveform: 'square', duty: 0.25 });
  assert.deepEqual(pwl.volts, [1.5, 1.5, -0.5, -0.5, 1.5]);
  assert.equal(pwl.timesNs[2], 250_000);
  assert.ok(Math.abs(pwl.timesNs[2] - pwl.timesNs[1] - edgeSeconds(1000) * 1e9) < 1e-6);
  for (const duty of [0, 1]) {
    const p = funcGenPwl({ ...base, waveform: 'square', frequency: 1e6, duty });
    assert.ok(p.timesNs.every((t, i) => i === 0 || t > p.timesNs[i - 1]), `duty ${duty}`);
  }
});

test('triangle and sawtooth span offset ± amplitude', () => {
  const tri = funcGenPwl({ ...base, waveform: 'triangle' });
  assert.equal(at(tri, 250_000), 0.5);
  assert.equal(at(tri, 500_000), 1.5);
  const saw = funcGenPwl({ ...base, waveform: 'sawtooth' });
  assert.ok(Math.abs(at(saw, 499_975) - 0.5) < 1e-3);
  assert.equal(saw.volts.at(-1), -0.5);
});

test('func-gen part drives the circuit with its waveform', () => {
  const net = (t: string) => (t === 'n' ? 'gnd' : 'out');
  const devices = CATALOG['func-gen'].devices('fg1',
    { waveform: 'sine', frequency: 1000, amplitude: 2, offset: 0, duty: 50 }, net);
  const c = new Circuit({ schemaVersion: 1, devices: [...devices,
    { kind: 'resistor', id: 'r', a: 'out', b: 'gnd', ohms: 1e3 },
    { kind: 'ground', id: 'g', node: 'gnd' }] });
  c.operatingPoint();
  c.advanceTo(0.25e-3);
  assert.ok(Math.abs(c.nodeVoltage('out') - 2) < 1e-3, `${c.nodeVoltage('out')}`);
  c.advanceTo(1.75e-3);
  assert.ok(Math.abs(c.nodeVoltage('out') + 2) < 1e-3, `${c.nodeVoltage('out')}`);
});
