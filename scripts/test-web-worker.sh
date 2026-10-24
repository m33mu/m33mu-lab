#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
m33mu_root=${M33MU_ROOT:-"$repo_root/m33mu"}
m33mu_build=${M33MU_BUILD:-"$m33mu_root/build"}
task_build_dir=$(mktemp -d "${TMPDIR:-/tmp}/m33mu-wasm-worker.XXXXXX")
task_parity_file=$(mktemp "${TMPDIR:-/tmp}/m33mu-web-cli-parity.XXXXXX")
task_emcmake=${M33MU_EMCMAKE:-emcmake}
task_node=${M33MU_NODE:-node}
task_cli=${M33MU_CLI:-"$m33mu_build/m33mu"}
trap 'rm -rf "$task_build_dir"; rm -f "$task_parity_file"' EXIT HUP INT TERM

export EM_CACHE="$task_build_dir/cache"
export M33MU_CLI="$task_cli"
python3 "$repo_root/scripts/check_web_worker_cli_parity.py" \
  "$task_cli" "$task_parity_file"
export M33MU_CLI_PARITY="$task_parity_file"
"$task_emcmake" cmake -S "$m33mu_root/cmake/wasm" -B "$task_build_dir"
cmake --build "$task_build_dir" --target m33mu_web_api --parallel
if [ ! -d "$repo_root/node_modules/esbuild" ]; then
  "${M33MU_NPM:-npm}" --prefix "$repo_root" ci
fi
"$task_node" "$repo_root/scripts/bundle-web-worker.mjs" "$task_build_dir"
"$task_node" "$repo_root/scripts/test-web-worker.mjs" \
  "$task_build_dir/worker.mjs"
