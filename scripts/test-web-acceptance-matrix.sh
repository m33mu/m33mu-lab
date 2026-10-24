#!/bin/sh
# Build the parity fixture and the shipped worker, then compare CLI, native
# session, Node/WASM worker and Chromium worker final state.
set -eu
repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
m33mu_root=${M33MU_ROOT:-"$repo_root/m33mu"}
m33mu_build=${M33MU_BUILD:-"$m33mu_root/build"}
cli=${M33MU_CLI:-"$m33mu_build/m33mu"}
runner=${M33MU_PARITY_RUNNER:-"$m33mu_build/web_parity_runner"}
fixture="$m33mu_root/tests/firmware/test-stm32h563-web-parity"
"${MAKE:-make}" -C "$fixture" CC="${M33MU_ARM_NONE_EABI_GCC:-arm-none-eabi-gcc}" app.elf >/dev/null
if [ ! -d "$repo_root/node_modules/esbuild" ]; then
  "${M33MU_NPM:-npm}" --prefix "$repo_root" ci
fi
"$repo_root/scripts/build-web-app.sh" >/dev/null 2>&1
exec "${M33MU_NODE:-node}" "$repo_root/scripts/web-acceptance-matrix.mjs" "$cli" "$runner" \
  "$repo_root/public/worker" "$repo_root/dist" "$fixture/app.elf" "$@"
