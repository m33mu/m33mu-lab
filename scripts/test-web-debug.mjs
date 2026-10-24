// Debugger operations through the worker: ELF symbols, breakpoints in plain
// runs, steps and coupled bench runs, memory read/write.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadWorker, pad } from './web-worker-harness.mjs';

const [workerPath, blinkElf] = process.argv.slice(2);
const w = await loadWorker(workerPath);
const firmware = new Uint8Array(readFileSync(blinkElf));
const lastState = () => w.messages.filter((m) => m.event === 'state').at(-1)?.payload;

assert.equal((await w.request('loadFirmware', { bytes: firmware })).ok, true);
const { symbols } = (await w.request('symbols')).result;
const tick = symbols.find((s) => s.name === 'SysTick_Handler');
const reset = symbols.find((s) => s.name === 'Reset_Handler');
assert.ok(tick && tick.kind === 'func' && (tick.address & 1) === 0, JSON.stringify(symbols.slice(0, 5)));
assert.ok(reset);

// Vector table: initial SP and the reset vector (Thumb bit set).
const vt = (await w.request('readMemory', { address: 0x0c000000, length: 8 })).result.bytes;
const word = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
assert.equal(word(vt, 4), (reset.address | 1) >>> 0);
const unmapped = (await w.request('readMemory', { address: 0xdead0000, length: 4 })).result.bytes;
assert.deepEqual(unmapped, [null, null, null, null]);

// Plain run: pauses before the first SysTick handler instruction.
assert.equal((await w.request('setBreakpoints', { addresses: [tick.address | 1] })).ok, true);
w.messages.length = 0;
await w.request('run');
await w.waitEvent((m) => m.event === 'state' && m.payload.breakpoint != null);
let st = lastState();
assert.equal(st.breakpoint, tick.address);
assert.equal(st.pc & ~1, tick.address);
assert.equal(st.paused, true);

// Step executes the instruction under the breakpoint.
const s1 = (await w.request('step', { instructionBudget: 1 })).result;
assert.equal(s1.breakpoint, null);
assert.equal(s1.instructions, 1);
assert.notEqual(s1.pc & ~1, tick.address);

// RAM write and read back.
assert.equal((await w.request('writeMemory', { address: 0x20000100, bytes: [1, 2, 3, 4] })).ok, true);
assert.deepEqual((await w.request('readMemory', { address: 0x20000100, length: 4 })).result.bytes, [1, 2, 3, 4]);

// Bench run: the breakpoint pauses the coupled run with the circuit held.
const netlist = { schemaVersion: 1, devices: [
  { kind: 'ground', id: 'g', node: 'GND' },
  { kind: 'pad', id: 'pa5', node: 'PA5', pad: pad('PA5') },
  { kind: 'resistor', id: 'r', a: 'PA5', b: 'GND', ohms: 10000 }] };
assert.equal((await w.request('loadFirmware', { bytes: firmware })).ok, true);
assert.equal((await w.request('createBench', { netlist, options: { sampleNs: 100000 } })).ok, true);
w.messages.length = 0;
await w.request('runUntil', { targetNs: '1000000000' });
const hit = await w.waitEvent((m) => m.event === 'bench' && m.payload.breakpoint != null);
assert.equal(hit.payload.breakpoint, tick.address);
assert.equal(hit.payload.mcuStopped, false);
const t1 = BigInt(hit.payload.timeNs);
assert.ok(t1 > 0n);
// Resume: the next SysTick pauses again about 1 ms later.
w.messages.length = 0;
await w.request('runUntil', { targetNs: '1000000000' });
const hit2 = await w.waitEvent((m) => m.event === 'bench' && m.payload.breakpoint != null);
const dt = Number(BigInt(hit2.payload.timeNs) - t1);
assert.ok(dt > 900_000 && dt < 1_100_000, `SysTick period ${dt} ns`);
await w.request('setBreakpoints', { addresses: [] });
await w.request('destroyBench');
console.log(`web debug: ok (${symbols.length} symbols, breakpoint at SysTick_Handler 0x${tick.address.toString(16)}, bench SysTick period ${dt} ns)`);
process.exit(0);
