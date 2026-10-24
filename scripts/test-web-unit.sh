#!/bin/sh
# Run the web TypeScript unit tests (solver, scheduler, project model).
set -eu
repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
m33mu_root=${M33MU_ROOT:-"$repo_root/m33mu"}
m33mu_build=${M33MU_BUILD:-"$m33mu_root/build"}
if [ ! -d "$repo_root/node_modules/esbuild" ]; then
  "${M33MU_NPM:-npm}" --prefix "$repo_root" ci
fi
exec "${M33MU_NODE:-node}" "$repo_root/tests/run-unit.mjs" "$@"
