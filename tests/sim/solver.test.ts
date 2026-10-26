// Solver acceptance against analytic results and recorded ngspice 47 values
// (see web/docs/adr-001-solver.md for the reference circuits).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, SolverError } from '../../sim/circuit.ts';
import { type Netlist, defaultPad, MODELS } from '../../sim/netlist.ts';

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

test('DC divider matches analytic within 1e-6', () => {
  const c = new Circuit({ schemaVersion: 1, devices: [
    { kind: 'ground', id: 'g', node: 'gnd' },
    { kind: 'vsource', id: 'v1', p: 'in', n: 'gnd', volts: 5 },
    { kind: 'resistor', id: 'r1', a: 'in', b: 'out', ohms: 2000 },
    { kind: 'resistor', id: 'r2', a: 'out', b: 'gnd', ohms: 3000 }
  ] });
  c.operatingPoint();
  assert.ok(rel(c.nodeVoltage('out'), 3) < 1e-6, String(c.nodeVoltage('out')));
  assert.ok(rel(c.deviceCurrent('v1'), 1e-3) < 1e-6);
});

test('RC source step tracks analytic response within 1% of peak', () => {
  const net: Netlist = { schemaVersion: 1, devices: [
    { kind: 'switch', id: 'sw', a: 'vcc', b: 'in', closed: true, ron: 1e-6 },
    { kind: 'vsource', id: 'v1', p: 'vcc', n: '0', volts: 5 },
    { kind: 'resistor', id: 'r', a: 'in', b: 'out', ohms: 1000 },
    { kind: 'resistor', id: 'rd', a: 'in', b: '0', ohms: 1e9 },
    { kind: 'capacitor', id: 'c', a: 'out', b: '0', farads: 10e-6 }
  ] };
  const c = new Circuit(net);
  c.zeroState();
  const tau = 1000 * 10e-6;
  let worst = 0;
  for (let k = 1; k <= 100; k++) {
    c.advanceTo(k * 5e-6 * 100);
    const t = c.t;
    const expected = 5 * (1 - Math.exp(-t / tau));
    worst = Math.max(worst, Math.abs(c.nodeVoltage('out') - expected) / 5);
  }
  assert.ok(worst < 0.01, `max error ${worst}`);
  assert.ok(worst < 1e-3, `max error ${worst} exceeds tightened 0.1% gate`);
});

test('diode operating point matches ngspice 47 within 1e-5', () => {
  const c = new Circuit({ schemaVersion: 1, devices: [
    { kind: 'vsource', id: 'v', p: 'in', n: '0', volts: 5 },
    { kind: 'resistor', id: 'r', a: 'in', b: 'a', ohms: 1000 },
    { kind: 'diode', id: 'd', a: 'a', k: '0', model: { is: 1.7143528192808883e-7, n: 2 } }
  ] });
  c.operatingPoint();
  assert.ok(rel(c.nodeVoltage('a'), 0.526073126081) < 1e-5, String(c.nodeVoltage('a')));
  assert.ok(rel(c.deviceCurrent('d'), 0.00447392687392) < 1e-5);
});

test('NPN bias point matches ngspice 47 within 1e-5', () => {
  const c = new Circuit({ schemaVersion: 1, devices: [
    { kind: 'vsource', id: 'v', p: 'vcc', n: '0', volts: 12 },
    { kind: 'resistor', id: 'rc', a: 'vcc', b: 'c', ohms: 1000 },
    { kind: 'resistor', id: 'rb', a: 'vcc', b: 'b', ohms: 220e3 },
    { kind: 'npn', id: 'q', c: 'c', b: 'b', e: '0', model: { is: 1e-13, bf: 100, br: 1 } }
  ] });
  c.operatingPoint();
  assert.ok(rel(c.nodeVoltage('c'), 6.83546662765) < 1e-5, String(c.nodeVoltage('c')));
  assert.ok(rel(c.nodeVoltage('b'), 0.638027855019) < 1e-5, String(c.nodeVoltage('b')));
});

test('PNP mirror of the NPN bias point', () => {
  const c = new Circuit({ schemaVersion: 1, devices: [
    { kind: 'vsource', id: 'v', p: '0', n: 'vee', volts: 12 },
    { kind: 'resistor', id: 'rc', a: 'vee', b: 'c', ohms: 1000 },
    { kind: 'resistor', id: 'rb', a: 'vee', b: 'b', ohms: 220e3 },
    { kind: 'pnp', id: 'q', c: 'c', b: 'b', e: '0', model: { is: 1e-13, bf: 100, br: 1 } }
  ] });
  c.operatingPoint();
  assert.ok(rel(-c.nodeVoltage('c'), 6.83546662765) < 1e-5, String(c.nodeVoltage('c')));
});

test('NMOS on-state matches ngspice 47 LEVEL=1 within 1e-5', () => {
  const c = new Circuit({ schemaVersion: 1, devices: [
    { kind: 'vsource', id: 'vdd', p: 'vdd', n: '0', volts: 10 },
    { kind: 'vsource', id: 'vg', p: 'g', n: '0', volts: 5 },
    { kind: 'resistor', id: 'rl', a: 'vdd', b: 'd', ohms: 1000 },
    { kind: 'nmos', id: 'm', d: 'd', g: 'g', s: '0', model: { vto: 1.5, kp: 0.02, lambda: 0 } }
  ] });
  c.operatingPoint();
  assert.ok(rel(c.nodeVoltage('d'), 0.1437557339497803) < 1e-5, String(c.nodeVoltage('d')));
  assert.ok(rel(c.deviceCurrent('rl'), 0.00985624426605022) < 1e-5);
});

test('rail-limited op-amp follows a closed-loop gain and supplies load current', () => {
  const c = new Circuit({ schemaVersion: 1, devices: [
    { kind: 'vsource', id: 'vcc', p: 'vcc', n: '0', volts: 5 },
    { kind: 'vsource', id: 'vin', p: 'in', n: '0', volts: 1 },
    { kind: 'resistor', id: 'rf', a: 'out', b: 'fb', ohms: 10e3 },
    { kind: 'resistor', id: 'rg', a: 'fb', b: '0', ohms: 10e3 },
    { kind: 'resistor', id: 'load', a: 'out', b: '0', ohms: 1000 },
    { kind: 'opamp', id: 'u1', plus: 'in', minus: 'fb', out: 'out', vcc: 'vcc', vee: '0',
      model: MODELS.opampGeneric }
  ] });
  c.operatingPoint();
  assert.ok(Math.abs(c.nodeVoltage('out') - 2) < 0.002, `output ${c.nodeVoltage('out')}`);
  assert.ok(c.deviceCurrent('u1') > 0.002, 'op-amp sources load and feedback current');
  assert.ok(Math.abs(c.deviceCurrent('vcc') - c.deviceCurrent('u1')) < 1e-8,
    'supply current tracks output current');
});

test('op-amp output saturates inside both supply rails', () => {
  for (const vin of [-1, 6]) {
    const c = new Circuit({ schemaVersion: 1, devices: [
      { kind: 'vsource', id: 'vcc', p: 'vcc', n: '0', volts: 5 },
      { kind: 'vsource', id: 'vin', p: 'in', n: '0', volts: vin },
      { kind: 'resistor', id: 'load', a: 'out', b: '0', ohms: 1000 },
      { kind: 'opamp', id: 'u1', plus: 'in', minus: 'out', out: 'out', vcc: 'vcc', vee: '0',
        model: MODELS.opampGeneric }
    ] });
    c.operatingPoint();
    const output = c.nodeVoltage('out');
    assert.ok(output >= -1e-6 && output <= 4.8, `output ${output}`);
    assert.ok(Math.abs(output - (vin < 0 ? 0.196 : 4.706)) < 0.05, `output ${output}`);
  }
});

test('op-amp inverting feedback and capacitive load survive snapshot/restore', () => {
  const c = new Circuit({ schemaVersion: 1, devices: [
    { kind: 'vsource', id: 'vp', p: 'vcc', n: '0', volts: 5 },
    { kind: 'vsource', id: 'vn', p: '0', n: 'vee', volts: 5 },
    { kind: 'vsource', id: 'vin', p: 'in', n: '0', volts: 1 },
    { kind: 'switch', id: 'sw', a: 'in', b: 'rin', closed: false },
    { kind: 'resistor', id: 'ri', a: 'rin', b: 'fb', ohms: 10e3 },
    { kind: 'resistor', id: 'rf', a: 'out', b: 'fb', ohms: 20e3 },
    { kind: 'capacitor', id: 'cl', a: 'out', b: '0', farads: 1e-6 },
    // Ideal (no GBW pole): 1 uF behind 20 ohm would ring a 1 MHz part, as it would on the bench.
    { kind: 'opamp', id: 'u1', plus: '0', minus: 'fb', out: 'out', vcc: 'vcc', vee: 'vee',
      model: { ...MODELS.opampGeneric, gbw: 0, slewRate: 0 } }
  ] });
  c.operatingPoint();
  assert.ok(Math.abs(c.nodeVoltage('out')) < 1e-5);
  c.setSwitch('sw', true);
  const before = c.snapshot();
  c.advanceTo(20e-6);
  const first = c.nodeVoltage('out');
  assert.ok(first < -0.5 && first > -2, `transient output ${first}`);
  c.restore(before);
  c.advanceTo(20e-6);
  assert.equal(c.nodeVoltage('out'), first);
  c.advanceTo(200e-6);
  assert.ok(Math.abs(c.nodeVoltage('out') + 2) < 0.004, `settled output ${c.nodeVoltage('out')}`);
});

test('op-amp follower slews at its slew rate on a large step', () => {
  const c = new Circuit({ schemaVersion: 1, devices: [
    { kind: 'vsource', id: 'vcc', p: 'vcc', n: '0', volts: 5 },
    { kind: 'vsource', id: 'vin', p: 'in', n: '0', volts: 0,
      pwl: { timesNs: [0, 1, 1e6], volts: [0, 3, 3] } },
    { kind: 'resistor', id: 'load', a: 'out', b: '0', ohms: 10e3 },
    { kind: 'opamp', id: 'u1', plus: 'in', minus: 'out', out: 'out', vcc: 'vcc', vee: '0',
      model: { ...MODELS.opampGeneric, gbw: 1e6, slewRate: 0.5e6 } }
  ] });
  c.operatingPoint();
  // From the 0.2 V low rail at 0.5 V/us, after < 1 us of saturation recovery.
  c.advanceTo(4e-6);
  const mid = c.nodeVoltage('out');
  assert.ok(mid > 1.4 && mid < 2.2, `slewing output at 4 us ${mid}`);
  c.advanceTo(5e-6);
  assert.ok(Math.abs(c.nodeVoltage('out') - mid - 0.5) < 0.02, 'slope is the slew rate');
  c.advanceTo(20e-6);
  assert.ok(Math.abs(c.nodeVoltage('out') - 3) < 0.005, `settled ${c.nodeVoltage('out')}`);
});

test('op-amp follower small-signal step follows the GBW pole', () => {
  const c = new Circuit({ schemaVersion: 1, devices: [
    { kind: 'vsource', id: 'vcc', p: 'vcc', n: '0', volts: 5 },
    { kind: 'vsource', id: 'vin', p: 'in', n: '0', volts: 1,
      pwl: { timesNs: [0, 0.1, 1e6], volts: [1, 1.01, 1.01] } },
    { kind: 'opamp', id: 'u1', plus: 'in', minus: 'out', out: 'out', vcc: 'vcc', vee: '0',
      model: { ...MODELS.opampGeneric, gbw: 1e6, slewRate: 0 } }
  ] });
  c.operatingPoint();
  const tau = 1 / (2 * Math.PI * 1e6);
  c.advanceTo(tau);
  const frac = (c.nodeVoltage('out') - 1) / 0.01;
  assert.ok(Math.abs(frac - (1 - Math.exp(-1))) < 0.05, `fraction at tau ${frac}`);
  c.advanceTo(10 * tau);
  assert.ok(Math.abs(c.nodeVoltage('out') - 1.01) < 1e-4);
});

test('op-amp comparator recovers from saturation quickly (no windup)', () => {
  const c = new Circuit({ schemaVersion: 1, devices: [
    { kind: 'vsource', id: 'vcc', p: 'vcc', n: '0', volts: 5 },
    { kind: 'vsource', id: 'ref', p: 'ref', n: '0', volts: 2.5 },
    { kind: 'vsource', id: 'vin', p: 'in', n: '0', volts: 5,
      pwl: { timesNs: [0, 100e3, 100.001e3, 1e9], volts: [5, 5, 0, 0] } },
    { kind: 'resistor', id: 'load', a: 'out', b: '0', ohms: 10e3 },
    { kind: 'opamp', id: 'u1', plus: 'in', minus: 'ref', out: 'out', vcc: 'vcc', vee: '0',
      model: MODELS.opampGeneric }
  ] });
  c.operatingPoint();
  c.advanceTo(100e-6);
  assert.ok(c.nodeVoltage('out') > 4.5);
  c.advanceTo(115e-6);
  assert.ok(c.nodeVoltage('out') < 0.5, `output 15 us after the input fell ${c.nodeVoltage('out')}`);
});

test('op-amp output current is limited into a short to ground', () => {
  const short = (iLimit: number) => {
    const c = new Circuit({ schemaVersion: 1, devices: [
      { kind: 'vsource', id: 'vcc', p: 'vcc', n: '0', volts: 5 },
      { kind: 'vsource', id: 'vin', p: 'in', n: '0', volts: 2 },
      { kind: 'resistor', id: 'short', a: 'out', b: '0', ohms: 0.1 },
      { kind: 'opamp', id: 'u1', plus: 'in', minus: 'out', out: 'out', vcc: 'vcc', vee: '0',
        model: { ...MODELS.opampGeneric, iLimit } }
    ] });
    c.operatingPoint();
    return c.deviceCurrent('u1');
  };
  const limited = short(0.025);
  // 25 mA plus the 0.1 % residue of the ~0.24 A the 20 Ω output would drive.
  assert.ok(limited > 0.024 && limited < 0.0255, `limited ${limited}`);
  // Unlimited, only rOut (20 Ω) stands between the 4.8 V rail and the short.
  assert.ok(short(0) > 0.2, `unlimited ${short(0)}`);
});

test('op-amp input offset appears at the output times the noise gain', () => {
  const out = (vos: number) => {
    const c = new Circuit({ schemaVersion: 1, devices: [
      { kind: 'vsource', id: 'vcc', p: 'vcc', n: '0', volts: 5 },
      { kind: 'vsource', id: 'vee', p: 'vee', n: '0', volts: -5 },
      { kind: 'resistor', id: 'rf', a: 'out', b: 'fb', ohms: 100e3 },
      { kind: 'resistor', id: 'rg', a: 'fb', b: '0', ohms: 1e3 },
      { kind: 'opamp', id: 'u1', plus: '0', minus: 'fb', out: 'out', vcc: 'vcc', vee: 'vee',
        model: { ...MODELS.opampGeneric, vos } }
    ] });
    c.operatingPoint();
    return c.nodeVoltage('out');
  };
  // Grounded-input gain-of-101 stage: 1 mV offset -> about 101 mV out.
  assert.ok(Math.abs(out(1e-3) - 0.101) < 0.002, `out ${out(1e-3)}`);
  assert.ok(Math.abs(out(0)) < 1e-6, `out ${out(0)}`);
});

test('op-amp rejects invalid model parameters', () => {
  assert.throws(() => new Circuit({ schemaVersion: 1, devices: [
    { kind: 'opamp', id: 'bad', plus: 'p', minus: 'n', out: 'o', vcc: 'vcc', vee: 'vee',
      model: { gain: 0, rOut: 0, rIn: -1, headroom: -0.1 } }
  ] }), /op-amp model needs/);
  assert.throws(() => new Circuit({ schemaVersion: 1, devices: [
    { kind: 'opamp', id: 'bad', plus: 'p', minus: 'n', out: 'o', vcc: 'vcc', vee: 'vee',
      model: { ...MODELS.opampGeneric, iLimit: -1 } }
  ] }), /iLimit must be >= 0/);
});

test('LED forward drop and current through 330 ohm from 3.3 V', () => {
  const c = new Circuit({ schemaVersion: 1, devices: [
    { kind: 'vsource', id: 'v', p: 'vcc', n: '0', volts: 3.3 },
    { kind: 'resistor', id: 'r', a: 'vcc', b: 'a', ohms: 330 },
    { kind: 'led', id: 'led', a: 'a', k: '0', model: MODELS.ledRed, color: 'red', ratedAmps: 0.02 }
  ] });
  c.operatingPoint();
  const vf = c.nodeVoltage('a');
  const i = c.deviceCurrent('led');
  assert.ok(vf > 1.7 && vf < 2.0, `vf ${vf}`);
  assert.ok(Math.abs(i - (3.3 - vf) / 330) < 1e-9, 'KCL');
});

test('LC tank conserves energy over ten periods within 1%', () => {
  const c = new Circuit({ schemaVersion: 1, devices: [
    { kind: 'capacitor', id: 'c', a: 'n', b: '0', farads: 1e-6 },
    { kind: 'inductor', id: 'l', a: 'n', b: '0', henries: 1e-3 },
    { kind: 'isource', id: 'kick', p: 'n', n: '0', amps: 0 }
  ] }, { hMax: 1e-6 });
  c.zeroState();
  // 1 V initial capacitor voltage.
  c.x[0] = 1;
  (c.state as Float64Array)[0] = 1;
  const period = 2 * Math.PI * Math.sqrt(1e-3 * 1e-6);
  let peak = 0;
  c.advanceTo(9 * period);
  for (let k = 0; k < 200; k++) {
    c.advanceTo(9 * period + (k + 1) * period / 200);
    peak = Math.max(peak, Math.abs(c.nodeVoltage('n')));
  }
  assert.ok(Math.abs(peak - 1) < 0.01, `peak ${peak}`);
});

test('voltage-source loop is reported as singular', () => {
  const c = new Circuit({ schemaVersion: 1, devices: [
    { kind: 'vsource', id: 'a', p: 'x', n: '0', volts: 1 },
    { kind: 'vsource', id: 'b', p: 'x', n: '0', volts: 2 }
  ] });
  assert.throws(() => c.operatingPoint(), (e: unknown) => e instanceof SolverError && e.code === 'SINGULAR');
});

test('invalid netlists are rejected with actionable messages', () => {
  assert.throws(() => new Circuit({ schemaVersion: 1, devices: [
    { kind: 'resistor', id: 'r', a: 'x', b: '0', ohms: -1 },
    { kind: 'resistor', id: 'r', a: 'x', b: '0', ohms: 1 }
  ] }), /ohms must be > 0; Duplicate device id r/);
});

test('pad threshold crossing is localized and snapshot/restore is exact', () => {
  const pad = { ...defaultPad('PA6'), cIn: 0 };
  const c = new Circuit({ schemaVersion: 1, devices: [
    { kind: 'vsource', id: 'v', p: 'in', n: '0', volts: 3.3 },
    { kind: 'resistor', id: 'r', a: 'in', b: 'n', ohms: 1000 },
    { kind: 'capacitor', id: 'c', a: 'n', b: '0', farads: 10e-9 },
    { kind: 'pad', id: 'p', node: 'n', pad }
  ] });
  c.zeroState();
  const snap = c.snapshot();
  const crossings = c.advanceTo(50e-6);
  assert.equal(crossings.length, 1);
  const tau = 1000 * 10e-9;
  const expected = -tau * Math.log(1 - pad.vRise / 3.3);
  // Class tolerance for RC threshold timing: 0.1% of tau.
  assert.ok(Math.abs(crossings[0].t - expected) < 1e-3 * tau, `${crossings[0].t} vs ${expected}`);
  const end = c.nodeVoltage('n');
  c.restore(snap);
  const again = c.advanceTo(50e-6);
  assert.deepEqual(again, crossings);
  assert.equal(c.nodeVoltage('n'), end);
});

test('LDO regulates, drops out and draws quiescent current', () => {
  const ldo = (vin: number, load: number) => {
    const c = new Circuit({ schemaVersion: 1, devices: [
      { kind: 'vsource', id: 'v', p: 'in', n: '0', volts: vin },
      { kind: 'regulator', id: 'u', in: 'in', out: 'out', gnd: '0', model: MODELS.ldo3v3 },
      { kind: 'resistor', id: 'rl', a: 'out', b: '0', ohms: load }
    ] });
    c.operatingPoint();
    return { vout: c.nodeVoltage('out'), iin: c.deviceCurrent('v'), iout: c.deviceCurrent('u') };
  };
  const reg = ldo(5, 33);
  assert.ok(Math.abs(reg.vout - (3.3 - 0.05 * 0.1)) < 0.01, `regulated ${reg.vout}`);
  assert.ok(Math.abs(reg.iout - reg.vout / 33) < 1e-6, 'output current');
  assert.ok(Math.abs(reg.iin - reg.iout - 50e-6) < 1e-7, `quiescent ${reg.iin - reg.iout}`);
  const drop = ldo(3.0, 1000);
  assert.ok(Math.abs(drop.vout - 2.7) < 0.02, `dropout ${drop.vout}`);
  assert.ok(ldo(0, 1000).vout < 0.02, 'off with no input');
});

test('PWL vsource: interpolates, lands on corners, holds after the end, repeats', () => {
  const ramp = new Circuit({ schemaVersion: 1, devices: [
    { kind: 'ground', id: 'g', node: '0' },
    { kind: 'vsource', id: 'v', p: 'a', n: '0', volts: 0,
      pwl: { timesNs: [0, 1000, 3000], volts: [0, 3.3, 1] } },
    { kind: 'resistor', id: 'r', a: 'a', b: '0', ohms: 1000 }
  ] });
  ramp.operatingPoint();
  assert.equal(ramp.nodeVoltage('a'), 0);
  ramp.advanceTo(500e-9);
  assert.ok(Math.abs(ramp.nodeVoltage('a') - 1.65) < 1e-9, String(ramp.nodeVoltage('a')));
  ramp.advanceTo(1000e-9);
  assert.ok(Math.abs(ramp.nodeVoltage('a') - 3.3) < 1e-9);
  ramp.advanceTo(2000e-9);
  assert.ok(Math.abs(ramp.nodeVoltage('a') - 2.15) < 1e-9, String(ramp.nodeVoltage('a')));
  ramp.advanceTo(10e-6);
  assert.ok(Math.abs(ramp.nodeVoltage('a') - 1) < 1e-9);

  // 0/3.3 V square with 2 us period; with a large hMax the steps must still
  // stop on the edges, so the value just after a rising edge is exact.
  const sq = new Circuit({ schemaVersion: 1, devices: [
    { kind: 'ground', id: 'g', node: '0' },
    { kind: 'vsource', id: 'v', p: 'a', n: '0', volts: 0,
      pwl: { timesNs: [0, 999, 1000, 1999, 2000], volts: [0, 0, 3.3, 3.3, 0], repeat: true } },
    { kind: 'resistor', id: 'r', a: 'a', b: '0', ohms: 1000 }
  ] }, { hMax: 1e-3 });
  sq.operatingPoint();
  sq.advanceTo(5500e-9);
  assert.ok(Math.abs(sq.nodeVoltage('a') - 3.3) < 1e-9, `t=5.5us: ${sq.nodeVoltage('a')}`);
  sq.advanceTo(6500e-9);
  assert.ok(Math.abs(sq.nodeVoltage('a')) < 1e-9, `t=6.5us: ${sq.nodeVoltage('a')}`);
});
