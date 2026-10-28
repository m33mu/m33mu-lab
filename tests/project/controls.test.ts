import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG } from '../../src/project/catalog.ts';

test('audio pot has 100 kΩ end-to-end and a logarithmic midpoint', () => {
  const parts = CATALOG.potentiometer.devices('p', { ohms: 100000, position: 0.5, taper: 'audio' }, (t) => t);
  assert.equal(parts.length, 2);
  assert.equal(parts[0].kind, 'resistor');
  assert.equal(parts[1].kind, 'resistor');
  if (parts[0].kind !== 'resistor' || parts[1].kind !== 'resistor') return;
  assert.ok(Math.abs(parts[0].ohms - 9090.909) < 0.01);
  assert.ok(Math.abs(parts[0].ohms + parts[1].ohms - 100000) < 0.01);
});

test('encoder phases form a one-bit-at-a-time quadrature cycle', () => {
  const states = Array.from({ length: 4 }, (_, phase) => {
    const devices = CATALOG['rotary-encoder'].devices('enc', { phase }, (t) => t);
    assert.equal(devices.length, 3);
    assert.equal(devices[2].kind, 'switch');
    if (devices[2].kind === 'switch') assert.equal(devices[2].closed, false);
    return devices.slice(0, 2).map((d) => d.kind === 'switch' && d.closed ? 1 : 0).join('');
  });
  assert.deepEqual(states, ['00', '01', '11', '10']);
});
