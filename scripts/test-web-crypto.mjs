// Crypto through the browser worker: on-chip crypto peripherals and the
// simulated secure elements attached to the buses. Each test firmware must
// print its success lines on the UART. Cases whose feature is compiled out of
// the WASM build (see the worker's features operation) are skipped.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadWorker } from './web-worker-harness.mjs';

const [workerPath, firmwareRoot] = process.argv.slice(2);
const w = await loadWorker(workerPath);
// cpu, ELF under tests/firmware, success line on the UART.
// cpu, ELF under tests/firmware, success line, needed feature, device specs.
const CASES = [
  ['lpc55s69', 'test-lpc55s69-hashcrypt/app.elf', /HASHCRYPT TEST SUCCESSFUL/, 'wolfcrypt', []],
  ['lpc55s69', 'test-lpc55s69-casper/app.elf', /CASPER TEST SUCCESSFUL/, 'wolfcrypt', []],
  ['nrf5340', 'test-nrf5340-cryptocell/app.elf', /CRYPTOCELL TEST SUCCESSFUL/, 'wolfcrypt', []],
  ['stm32u585', 'test-stm32u585-wolfssl-pka/app.elf', /PKA TEST SUCCESSFUL/, 'wolfcrypt', []],
  ['stm32h563', 'test-se-suite/app.elf', /RNG: [0-9A-F]{2}[\s\S]*ATR ok[\s\S]*Random ok/, 'rustSecureElements',
    ['atecc608:SPI1:cs=PA4', 'se050:I2C1:addr=48', 'stsafe:I2C2:addr=20']],
  ['stm32u585', 'test-ta100/app.elf', /Signature:/, 'ta100', ['ta100:SPI2:cs=PB5']]
];
const features = (await w.request('features', {})).result;
const ran = [];
for (const [cpu, elf, banner, feature, specs] of CASES) {
  const path = join(firmwareRoot, elf);
  if (!existsSync(path)) { console.log(`web crypto: skip ${elf} (not built)`); continue; }
  if (!features[feature]) { console.log(`web crypto: skip ${elf} (${feature} not in this WASM build)`); continue; }
  w.messages.length = 0;
  const loaded = await w.request('loadFirmware', { bytes: new Uint8Array(readFileSync(path)), cpu });
  assert.equal(loaded.ok, true, `${elf}: ${JSON.stringify(loaded.error)}`);
  const attached = await w.request('attachDevices', { specs });
  assert.equal(attached.ok, true, `${elf}: ${JSON.stringify(attached.error)}`);
  for (const d of attached.result.devices) assert.equal(d.ok, true, `${elf}: ${d.spec} ${d.error}`);
  let text = '';
  for (let i = 0; i < 4000; i++) {
    const s = await w.request('step', { instructionBudget: 100000 });
    assert.equal(s.ok, true, `${elf}: ${JSON.stringify(s.error)}`);
    text = Buffer.concat(w.messages.filter((m) => m.event === 'uart').map((m) => Buffer.from(m.payload.bytes))).toString('latin1');
    if (s.result.stopped || banner.test(text)) break;
  }
  assert.equal(w.messages.filter((m) => m.event === 'fault').length, 0, `${elf} faulted`);
  assert.match(text, banner, `${elf} UART: ${JSON.stringify(text.slice(-400))}`);
  ran.push(elf.split('/')[0]);
  await w.request('attachDevices', { specs: [] });
}

console.log(`web crypto: ok (${ran.join(', ') || 'none: build with M33MU_WOLFSSL_SRC'})`);
process.exit(0);
