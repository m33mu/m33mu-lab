#!/usr/bin/env node
// Run a saved workbench project headlessly (see tools/headless.ts):
//   node scripts/run-project.mjs public/examples/h563-bus.m33mu.json --ns 2e6 \
//     --expect-uart 'TEMP:OK' --worker build/worker/worker.mjs
// Exit status: 0 checks passed, 1 a check failed, 2 usage or project error.
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = mkdtempSync(join(tmpdir(), 'm33mu-run-project-'));
try {
  await build({
    entryPoints: [join(root, 'tools/headless.ts')], outfile: join(out, 'headless.mjs'), bundle: true,
    platform: 'node', format: 'esm', target: 'node20', logLevel: 'warning', external: ['node:*'],
    // The worker harness imports the worker bundle at run time.
    plugins: [{ name: 'keep-harness-external', setup(b) {
      b.onResolve({ filter: /web-worker-harness\.mjs$/ }, () =>
        ({ path: join(root, 'scripts/web-worker-harness.mjs'), external: true }));
    } }]
  });
  const r = spawnSync(process.execPath, [join(out, 'headless.mjs'), ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, M33MU_LAB_ROOT: root } });
  process.exitCode = r.status ?? 2;
} finally {
  rmSync(out, { recursive: true, force: true });
}
