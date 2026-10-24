#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
m33mu_root=${M33MU_ROOT:-"$repo_root/m33mu"}
task_output_dir=${1:-"$repo_root/dist/worker"}
task_build_dir=$(mktemp -d "${TMPDIR:-/tmp}/m33mu-web-worker-build.XXXXXX")
trap 'rm -rf "$task_build_dir"' EXIT HUP INT TERM

"$m33mu_root/scripts/build-wasm-api.sh" "$task_output_dir" "$task_build_dir"
rm -f "$task_output_dir/engine.mjs"
"${M33MU_NODE:-node}" "$repo_root/scripts/bundle-web-worker.mjs" "$task_output_dir"
