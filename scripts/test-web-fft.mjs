// The ADC + FFT example under each function generator waveform: the firmware's
// spectrum on USART3 must match the Fourier series of the source, through the
// op-amp level shifter and the H563 ADC. Runs scripts/run-project.mjs.
//   node scripts/test-web-fft.mjs worker.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const [workerPath] = process.argv.slice(2);
const examples = join(root, 'public/examples');
const base = JSON.parse(readFileSync(join(examples, 'h563-adc-fft.m33mu.json'), 'utf8'));
const dir = mkdtempSync(join(tmpdir(), 'm33mu-web-fft-'));
copyFileSync(join(examples, 'h563-adc-fft.elf'), join(dir, 'h563-adc-fft.elf'));

// Peak amplitude 1 V: square odd harmonics 4/(pi n), triangle 8/(pi^2 n^2),
// sawtooth 2/(pi n). Square harmonics above 4 kHz alias (7th: 5250 -> 2750 Hz),
// so only the three strongest in-band ones are checked.
const cases = [
  { waveform: 'sine', frequency: 1000, peaks: [[1000, 1000]] },
  { waveform: 'square', frequency: 750, peaks: [[750, 4000 / Math.PI], [2250, 4000 / (3 * Math.PI)], [3750, 4000 / (5 * Math.PI)]] },
  { waveform: 'triangle', frequency: 500, peaks: [[500, 8000 / Math.PI ** 2], [1500, 8000 / (9 * Math.PI ** 2)], [2500, 8000 / (25 * Math.PI ** 2)]] },
  // Off-bin: the interpolated frequency; scalloping costs up to 15 % amplitude
  // and a partial sawtooth period in the frame shifts the mean.
  { waveform: 'sawtooth', frequency: 1234, peaks: [[1234, 2000 / Math.PI]], ampTol: 0.16, dcTol: 15 }
];
try {
  for (const c of cases) {
    const project = structuredClone(base);
    project.parts.find((p) => p.id === 'fg1').params = { waveform: c.waveform, frequency: c.frequency, amplitude: 1, offset: 0, duty: 50 };
    const path = join(dir, `${c.waveform}.m33mu.json`);
    const uart = join(dir, `${c.waveform}.txt`);
    writeFileSync(path, JSON.stringify(project));
    const r = spawnSync(process.execPath, [join(root, 'scripts/run-project.mjs'), path, '--ns', '450e6',
      '--worker', workerPath, '--uart-out', uart], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const lines = readFileSync(uart, 'latin1').split(/\r?\n/).filter((l) => l.startsWith('fft: dc'));
    assert.ok(lines.length >= 2, `${c.waveform}: ${lines.length} frames`);
    const last = lines.at(-1);
    const dc = Number(/dc (\d+) mV/.exec(last)[1]);
    assert.ok(Math.abs(dc - 1650) <= (c.dcTol ?? 5), `${c.waveform}: dc ${dc} mV`);
    const got = [...last.matchAll(/([\d.]+) Hz (\d+) mV/g)].map((m) => [Number(m[1]), Number(m[2])]);
    c.peaks.forEach(([f, mv], i) => {
      assert.ok(got[i], `${c.waveform}: missing peak ${f} Hz in ${last}`);
      assert.ok(Math.abs(got[i][0] - f) <= 1, `${c.waveform}: peak ${i} at ${got[i][0]} Hz, want ${f}`);
      assert.ok(Math.abs(got[i][1] - mv) <= mv * (c.ampTol ?? 0.03) + 3, `${c.waveform}: peak ${i} ${got[i][1]} mV, want ${mv.toFixed(0)}`);
    });
    console.log(`web fft ${c.waveform} ${c.frequency} Hz: ${last.slice(5)}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log('web fft: ok');
