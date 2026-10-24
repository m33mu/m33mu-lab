import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BusLayer, Eeprom24c02, SpiFlash, Tmp102, secureElementSpecs, type LineView } from '../../sim/buses.ts';

test('24C02 page writes wrap within 8 bytes and reads auto-increment', () => {
  const e = new Eeprom24c02(0x50);
  e.write(Uint8Array.from([0x06, 1, 2, 3, 4]));
  assert.deepEqual([...e.mem.subarray(0, 8)], [3, 4, 0xff, 0xff, 0xff, 0xff, 1, 2]);
  e.write(Uint8Array.from([0x06]));
  assert.deepEqual([...e.read(4)], [1, 2, 0xff, 0xff]);
});

test('TMP102 reports 1/16 degC left aligned', () => {
  const t = new Tmp102(0x48, -0.25);
  t.write(Uint8Array.from([0]));
  assert.deepEqual([...t.read(2)], [0xff, 0xc0]);
});

test('SPI flash: JEDEC, program needs WREN, erase sets 0xFF', () => {
  const f = new SpiFlash();
  const tx = (bytes: number[]) => { f.select(); const r = bytes.map((b) => f.exchange(b)); f.deselect(); return r; };
  assert.deepEqual(tx([0x9f, 0, 0, 0]), [0xff, 0xef, 0x40, 0x18]);
  tx([0x02, 0, 0, 0, 0x12]);
  assert.equal(f.mem[0], 0xff, 'no WREN, no program');
  tx([0x06]);
  tx([0x02, 0, 0, 0, 0x12, 0x34]);
  assert.deepEqual(tx([0x03, 0, 0, 0, 0, 0]).slice(4), [0x12, 0x34]);
  tx([0x06]);
  tx([0x20, 0, 0, 0]);
  assert.equal(f.mem[0], 0xff);
});

test('two I2C targets at one address: open-drain read is the AND, clash reported', () => {
  const lines: LineView = {
    level: () => 1, volts: (n) => (n === 'V' ? 3.3 : 0),
    padConfig: (p) => (p === 'PB8' || p === 'PB9' ? { mode: 2, af: 4 } : null), nowNs: () => 0
  };
  const nets = { VCC: 'V', GND: 'G', SCL: 'PB8', SDA: 'PB9' };
  const bus = new BusLayer({ pins: { PB8: 'PB8', PB9: 'PB9' }, devices: [
    { id: 'a', kind: 'i2c-eeprom', nets, params: {} },
    { id: 'b', kind: 'i2c-eeprom', nets, params: {} }] }, lines);
  (bus.devices[0].i2c as Eeprom24c02).mem[0] = 0xf0;
  (bus.devices[1].i2c as Eeprom24c02).mem[0] = 0x3c;
  assert.equal(bus.i2c(1, 0x50, false, Uint8Array.from([0])), 0);
  const data = new Uint8Array(1);
  assert.equal(bus.i2c(1, 0x50, true, data), 0);
  assert.equal(data[0], 0x30);
  assert.ok(bus.takeLog().some((r) => /address clash/.test(r.summary)));
  assert.equal(bus.i2c(2, 0x50, true, data), -1, 'I2C2 not routed to a header pin');
});

test('secure elements: specs from wiring, hand-off only when wired and attached', () => {
  const power = { VCC: 'V', GND: 'G' };
  const logic = {
    pins: { PA4: 'PA4', PA5: 'PA5', PA6: 'PA6', PA7: 'PA7', PB8: 'PB8', PB9: 'PB9', PB10: 'PB10', PF0: 'PF0' },
    devices: [
      { id: 'se1', kind: 'se-atecc608' as const, nets: { ...power, CS: 'PA4', SCK: 'PA5', MISO: 'PA6', MOSI: 'PA7' }, params: {} },
      { id: 'se2', kind: 'se-se050' as const, nets: { ...power, SCL: 'PB8', SDA: 'PB9' }, params: {} },
      // SCL on I2C2, SDA on I2C1: no single peripheral.
      { id: 'se3', kind: 'se-stsafe' as const, nets: { ...power, SCL: 'PB10', SDA: 'PB9' }, params: {} },
      { id: 'se4', kind: 'se-tropic01' as const, nets: { ...power, SCK: 'PA5', MISO: 'PA6', MOSI: 'PA7' }, params: {} }
    ]
  };
  assert.deepEqual(secureElementSpecs(logic).map((s) => s.spec ?? s.error), [
    'atecc608:SPI1:cs=PA4', 'se050:I2C1:addr=48',
    'SCL and SDA must reach one I²C peripheral', 'CS must be wired to a GPIO pin']);

  const af: Record<string, { mode: number; af: number }> = {
    PA5: { mode: 2, af: 5 }, PA6: { mode: 2, af: 5 }, PA7: { mode: 2, af: 5 },
    PB8: { mode: 2, af: 4 }, PB9: { mode: 2, af: 4 } };
  const lines: LineView = {
    level: (n) => (n === 'PA4' ? 0 : 1), volts: (n) => (n === 'V' ? 3.3 : 0),
    padConfig: (p) => af[p] ?? null, nowNs: () => 0
  };
  const bus = new BusLayer(logic, lines, { se1: null, se2: 'not in this WASM build' });
  assert.equal(bus.spi(1, 0x03), -1, 'wired, selected and attached: the emulator answers');
  bus.spiEnd(1);
  assert.equal(bus.i2c(1, 0x48, false, Uint8Array.from([1])), 1, 'unattached model NACKs');
  const log = bus.takeLog().map((r) => r.summary);
  assert.ok(log.some((s) => /SPI1 → se1: MOSI \[03\] \(atecc608 model\)/.test(s)), log.join('\n'));
  assert.ok(log.some((s) => /0x48 W: NACK \(se2: not in this WASM build\)/.test(s)), log.join('\n'));
});
