#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
m33mu_root=${M33MU_ROOT:-"$repo_root/m33mu"}
m33mu_build=${M33MU_BUILD:-"$m33mu_root/build"}
task_npm=${M33MU_NPM:-npm}
cd "$repo_root"

if [ "${1:-}" = "--install" ]; then
    "$task_npm" --prefix "$repo_root" ci
fi

scripts/build-web-worker.sh "$repo_root/public/worker"
"$task_npm" --prefix "$repo_root" run build
