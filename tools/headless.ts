// Headless project runner: compile a saved .m33mu.json project exactly as
// the UI does, run firmware and circuit in the worker under Node, and report
// UART output, scope samples and pass/fail checks. Bundled and started by
// scripts/run-project.mjs.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { parseProject, refKey, type Project } from '../src/project/model.ts';
import { compileCircuit, type BoardLayout } from '../src/project/netgraph.ts';
// @ts-expect-error plain ES module without types
import { loadWorker } from '../scripts/web-worker-harness.mjs';

type Args = {
  project: string; worker: string; root: string; firmware?: string; ns: number;
  expectUart: RegExp[]; expectStop: boolean; uartOut?: string; csv?: string; json: boolean;
};

function usage(message?: string): never {
  if (message) console.error(`run-project: ${message}`);
  console.error(`usage: run-project.mjs PROJECT.m33mu.json [--ns N] [--firmware app.elf]
  [--expect-uart REGEX]... [--expect-stop] [--uart-out FILE] [--csv FILE] [--worker worker.mjs] [--json]`);
  process.exit(2);
}

function parseArgs(argv: string[]): Args {
  const root = process.env.M33MU_LAB_ROOT!;
  const a: Args = { project: '', worker: join(root, 'dist/worker/worker.mjs'), root, ns: 100e6,
    expectUart: [], expectStop: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    const next = () => (i + 1 < argv.length ? argv[++i] : usage(`${v} needs a value`));
    if (v === '--ns') a.ns = Number(next());
    else if (v === '--firmware') a.firmware = next();
    else if (v === '--worker') a.worker = next();
    else if (v === '--expect-uart') a.expectUart.push(new RegExp(next()));
    else if (v === '--expect-stop') a.expectStop = true;
    else if (v === '--uart-out') a.uartOut = next();
    else if (v === '--csv') a.csv = next();
    else if (v === '--json') a.json = true;
    else if (v.startsWith('--')) usage(`unknown option ${v}`);
    else if (!a.project) a.project = v;
    else usage(`unexpected argument ${v}`);
  }
  if (!a.project) usage('no project given');
  if (!(a.ns > 0)) usage('--ns must be > 0');
  return a;
}

function firmwareFor(project: Project, args: Args): Uint8Array | null {
  const sim = project.simulator;
  let bytes: Uint8Array | null = null;
  if (args.firmware) bytes = new Uint8Array(readFileSync(args.firmware));
  else if (sim.firmwareBase64) bytes = Uint8Array.from(Buffer.from(sim.firmwareBase64, 'base64'));
  else if (sim.firmwareName) {
    const path = join(dirname(resolve(args.project)), sim.firmwareName);
    if (!existsSync(path)) usage(`project firmware ${sim.firmwareName} not found next to the project`);
    bytes = new Uint8Array(readFileSync(path));
  }
  if (bytes && sim.firmwareSha256 && !args.firmware) {
    const sha = createHash('sha256').update(bytes).digest('hex');
    if (sha !== sim.firmwareSha256) usage(`firmware SHA-256 ${sha} differs from the project's ${sim.firmwareSha256}`);
  }
  return bytes;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const project = parseProject(readFileSync(args.project, 'utf8'));
  const cpu = project.simulator.cpu;
  const layouts = new Map<string, BoardLayout>();
  for (const b of project.boards) {
    layouts.set(b.cpu, JSON.parse(readFileSync(join(args.root, `public/boards/layout/${b.cpu}.json`), 'utf8')));
  }
  const compiled = compileCircuit(project, layouts);
  const errors = compiled.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length) usage(`circuit errors: ${errors.map((e) => e.message).join('; ')}`);
  const firmware = firmwareFor(project, args);
  if (compiled.pads.length && !firmware) usage(`the circuit uses ${compiled.pads.join(', ')} but there is no firmware`);

  const w = await loadWorker(args.worker);
  if (firmware) {
    const loaded = await w.request('loadFirmware', { bytes: firmware, cpu });
    if (!loaded.ok) usage(`firmware rejected: ${JSON.stringify(loaded.error)}`);
  }
  // Scope channels become bench probes, as in the UI.
  const probes: { id: string; kind: 'voltage' | 'current'; net?: string; device?: string }[] = [];
  for (const sc of project.instruments.scopes) {
    sc.channels.forEach((ch, i) => {
      if (!ch) return;
      const id = `${sc.id}.ch${i + 1}`;
      if (ch.kind === 'voltage') {
        const net = compiled.terminalNet.get(refKey(ch.at));
        if (net) probes.push({ id, kind: 'voltage', net });
      } else if (compiled.netlist.devices.some((d) => d.id === ch.part)) {
        probes.push({ id, kind: 'current', device: ch.part });
      }
    });
  }
  const created = await w.request('createBench', { netlist: compiled.netlist, probes, logic: compiled.logic,
    options: { lookaheadNs: project.solver.lookaheadNs, sampleNs: project.solver.sampleNs } });
  if (!created.ok) usage(`bench rejected: ${JSON.stringify(created.error)}`);
  const t0 = Date.now();
  const benches = await w.runBench(args.ns);
  const wallMs = Date.now() - t0;

  const uart: Record<string, string> = {};
  for (const m of w.messages.filter((x: any) => x.event === 'uart')) {
    uart[m.payload.label] = (uart[m.payload.label] ?? '') + Buffer.from(m.payload.bytes).toString('latin1');
  }
  const last = benches.at(-1);
  const rows: string[] = [`time_ns,${probes.map((p) => p.id).join(',')}`];
  for (const b of benches) {
    const width = probes.length + 1;
    const s = b.samples as Float64Array | undefined;
    if (!s) continue;
    for (let i = 0; i + width <= s.length; i += width) rows.push(Array.from(s.subarray(i, i + width)).join(','));
  }
  const allText = Object.values(uart).join('\n');
  const failures: string[] = [];
  for (const re of args.expectUart) if (!re.test(allText)) failures.push(`UART output does not match ${re}`);
  if (args.expectStop && !last?.mcuStopped) failures.push('firmware did not stop (BKPT) before the end');
  const faults = w.messages.filter((x: any) => x.event === 'fault').map((x: any) => x.payload);
  if (faults.length) failures.push(`worker faults: ${JSON.stringify(faults)}`);

  if (args.uartOut) writeFileSync(args.uartOut, Object.entries(uart).map(([k, v]) => `== ${k}\n${v}`).join('\n'));
  if (args.csv) writeFileSync(args.csv, rows.join('\n') + '\n');
  const summary = {
    project: project.name, cpu, pads: compiled.pads, simulatedNs: Number(last?.timeNs ?? 0), wallMs,
    mcuStopped: !!last?.mcuStopped, uart, samples: rows.length - 1, failures
  };
  if (args.json) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(`${project.name} (${cpu}): ${(summary.simulatedNs / 1e6).toFixed(3)} ms simulated in ${wallMs} ms` +
      `${summary.mcuStopped ? ', firmware stopped' : ''}`);
    for (const [k, v] of Object.entries(uart)) console.log(`-- ${k}\n${v.trimEnd()}`);
    for (const f of failures) console.log(`FAIL: ${f}`);
  }
  process.exit(failures.length ? 1 : 0);
}

await main();
