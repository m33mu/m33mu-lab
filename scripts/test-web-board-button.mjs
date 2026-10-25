// On-board button without a circuit: B1 (PC13) pressed through the worker's
// pressButton operation; the firmware copies PC13 to LD1 (PB0).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadWorker } from './web-worker-harness.mjs';

const [workerPath, elf] = process.argv.slice(2);
const w = await loadWorker(workerPath);
assert.equal((await w.request('loadFirmware', { bytes: new Uint8Array(readFileSync(elf)) })).ok, true);
const pb0 = () => w.messages.filter((m) => m.event === 'gpio' && m.payload.socPad === 'PB0').map((m) => m.payload.level);
await w.request('step', { instructionBudget: 2000 });
assert.equal(pb0().at(-1) ?? 0, 0, 'LD1 off while B1 is up');
assert.equal((await w.request('pressButton', { socPad: 'PC13', level: true })).ok, true);
await w.request('step', { instructionBudget: 2000 });
assert.equal(pb0().at(-1), 1, `LD1 on while B1 is down: ${JSON.stringify(pb0())}`);
assert.equal((await w.request('pressButton', { socPad: 'PC13', level: false })).ok, true);
await w.request('step', { instructionBudget: 2000 });
assert.equal(pb0().at(-1), 0, 'LD1 off after release');
console.log('web board button: ok (B1 on PC13 drives LD1 through the firmware)');
process.exit(0);
