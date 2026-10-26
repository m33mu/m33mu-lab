// Secure elements on the bench: the SE suite firmware talks to an ATECC608A
// (SPI1, CS PD14), an SE050 (I2C1 0x48) and an STSAFE-A120 (I2C2 0x20) placed
// as circuit parts. The bench checks power and wiring and m33mu's own models
// answer. Skipped when the WASM build lacks the Rust secure elements.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { loadWorker, pad } from './web-worker-harness.mjs';

const [workerPath, elf] = process.argv.slice(2);
const w = await loadWorker(workerPath);
const features = (await w.request('features', {})).result;
if (!features.rustSecureElements || !existsSync(elf)) {
  console.log('web secure elements: skip (no Rust secure elements in this build, or firmware not built)');
  process.exit(0);
}
const firmware = new Uint8Array(readFileSync(elf));

function bench({ stsafePowered = true } = {}) {
  // Header build of the suite (m33mu tests/firmware/test-stm32h563-web-se).
  const pins = ['PD14', 'PA5', 'PA6', 'PB5', 'PB8', 'PB9', 'PF1', 'PF0'];
  const devices = [
    { kind: 'ground', id: 'g', node: 'GND' },
    { kind: 'vsource', id: 'board-3V3', p: '3V3', n: 'GND', volts: 3.3 },
    ...pins.map((p) => ({ kind: 'pad', id: `pad-${p}`, node: p, pad: pad(p) })),
    ...['PB8', 'PB9', 'PF1', 'PF0'].map((p) => ({ kind: 'resistor', id: `pu-${p}`, a: '3V3', b: p, ohms: 4700 })),
    { kind: 'resistor', id: 'se1.iq', a: '3V3', b: 'GND', ohms: 3300 },
    { kind: 'resistor', id: 'se2.iq', a: '3V3', b: 'GND', ohms: 3300 },
    { kind: 'resistor', id: 'se3.iq', a: stsafePowered ? '3V3' : 'NC', b: 'GND', ohms: 3300 }
  ];
  const power = { VCC: '3V3', GND: 'GND' };
  const logic = {
    pins: Object.fromEntries(pins.map((p) => [p, p])),
    devices: [
      { id: 'se1', kind: 'se-atecc608', params: {}, nets: { ...power, CS: 'PD14', SCK: 'PA5', MISO: 'PA6', MOSI: 'PB5' } },
      { id: 'se2', kind: 'se-se050', params: {}, nets: { ...power, SCL: 'PB8', SDA: 'PB9' } },
      { id: 'se3', kind: 'se-stsafe', params: {},
        nets: { VCC: stsafePowered ? '3V3' : 'NC', GND: 'GND', SCL: 'PF1', SDA: 'PF0' } }
    ]
  };
  return { netlist: { schemaVersion: 1, devices }, logic };
}

async function run(options) {
  w.messages.length = 0;
  assert.equal((await w.request('loadFirmware', { bytes: firmware })).ok, true);
  const created = await w.request('createBench', { ...bench(options), options: { sampleNs: 1e6 } });
  assert.equal(created.ok, true, JSON.stringify(created.error));
  assert.deepEqual(created.result.secureElements.map((s) => s.spec),
    ['atecc608:SPI1:cs=PD14', 'se050:I2C1:addr=48', 'stsafe:I2C2:addr=20']);
  assert.ok(created.result.secureElements.every((s) => s.error === null), JSON.stringify(created.result));
  await w.runBench(400_000_000);
  const text = Buffer.concat(w.messages.filter((m) => m.event === 'uart').map((m) => Buffer.from(m.payload.bytes))).toString('latin1');
  const log = w.messages.filter((m) => m.event === 'busLog').flatMap((m) => m.payload.records);
  await w.request('destroyBench');
  return { text, log };
}

const good = await run();
assert.match(good.text, /RNG: [0-9A-F]{2}/, good.text);
assert.match(good.text, /ATR ok/, good.text);
assert.match(good.text, /Echo ok: DE AD BE EF/, good.text);
assert.ok(good.log.some((r) => r.bus === 'SPI1' && /se1: MOSI \[.*\] \(atecc608 model\)/.test(r.summary)), JSON.stringify(good.log.slice(0, 8)));
assert.ok(good.log.some((r) => r.bus === 'I2C1' && /0x48 W .*→ se2/.test(r.summary)));

const unpowered = await run({ stsafePowered: false });
assert.match(unpowered.text, /ATR ok/, unpowered.text);
assert.doesNotMatch(unpowered.text, /Echo ok/, unpowered.text);
assert.ok(unpowered.log.some((r) => r.bus === 'I2C2' && /0x20 W: NACK \(se3: unpowered\)/.test(r.summary)), JSON.stringify(unpowered.log.filter((r) => r.bus === 'I2C2').slice(0, 3)));
console.log('web secure elements: ok (ATECC608A, SE050, STSAFE-A120 on the bench; unpowered STSAFE NACKs)');
process.exit(0);
