#!/bin/sh
# Run the H563 LED blink and RC button demos through the worker bench.
set -eu
repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
m33mu_root=${M33MU_ROOT:-"$repo_root/m33mu"}
m33mu_build=${M33MU_BUILD:-"$m33mu_root/build"}
task_build_dir=$(mktemp -d "${TMPDIR:-/tmp}/m33mu-web-demos.XXXXXX")
task_node=${M33MU_NODE:-node}
trap 'rm -rf "$task_build_dir"' EXIT HUP INT TERM
examples="$repo_root/public/examples"
export EM_CACHE="$task_build_dir/cache"
"$m33mu_root/scripts/build-wasm-api.sh" "$task_build_dir" "$task_build_dir/wasm" >/dev/null
if [ ! -d "$repo_root/node_modules/esbuild" ]; then
  "${M33MU_NPM:-npm}" --prefix "$repo_root" ci
fi
"$task_node" "$repo_root/scripts/bundle-web-worker.mjs" "$task_build_dir"
"$task_node" "$repo_root/scripts/test-web-demos.mjs" "$task_build_dir/worker.mjs" \
  "$examples/h563-blink.elf" "$examples/h563-button.elf" "$repo_root/fixtures/demos/golden.json"
"$task_node" "$repo_root/scripts/test-web-debug.mjs" "$task_build_dir/worker.mjs" "$examples/h563-blink.elf"
"$task_node" "$repo_root/scripts/test-web-sigc-source.mjs" "$task_build_dir/worker.mjs" "$examples/h563-button.elf"
"$task_node" "$repo_root/scripts/test-web-rp2350-gpio.mjs" "$task_build_dir/worker.mjs" "$examples/pico2-gpio.elf"
"$task_node" "$repo_root/scripts/test-web-board-button.mjs" "$task_build_dir/worker.mjs" "$examples/h563-b1.elf"
"$task_node" "$repo_root/scripts/test-web-nrf-gpio.mjs" "$task_build_dir/worker.mjs" "$examples/nrf5340-gpio.elf"
"$task_node" "$repo_root/scripts/test-web-worker-lifecycle.mjs" "$task_build_dir/worker.mjs" \
  "$examples/h563-blink.elf"
"${MAKE:-make}" -C "$m33mu_root/tests/firmware/test-stm32h563-uart-echo" CC="${M33MU_ARM_NONE_EABI_GCC:-arm-none-eabi-gcc}" app.elf >/dev/null
"$task_node" "$repo_root/scripts/test-web-uart.mjs" "$task_build_dir/worker.mjs" \
  "$m33mu_root/tests/firmware/test-stm32h563-uart-echo/app.elf"
"${MAKE:-make}" -C "$m33mu_root/tests/firmware/test-stm32h563-web-bus" CC="${M33MU_ARM_NONE_EABI_GCC:-arm-none-eabi-gcc}" app.elf >/dev/null
"$task_node" "$repo_root/scripts/test-web-buses.mjs" "$task_build_dir/worker.mjs" \
  "$m33mu_root/tests/firmware/test-stm32h563-web-bus/app.elf"
"${MAKE:-make}" -C "$m33mu_root/tests/firmware/test-stm32h563-web-pwm" CC="${M33MU_ARM_NONE_EABI_GCC:-arm-none-eabi-gcc}" app.elf >/dev/null
"$task_node" "$repo_root/scripts/test-web-pwm.mjs" "$task_build_dir/worker.mjs" \
  "$m33mu_root/tests/firmware/test-stm32h563-web-pwm/app.elf"
firmware_root=${M33MU_FIRMWARE_ROOT:-"$m33mu_root/tests/firmware"}
"$task_node" "$repo_root/scripts/test-web-cpus.mjs" "$task_build_dir/worker.mjs" "$firmware_root"
"$task_node" "$repo_root/scripts/test-web-crypto.mjs" "$task_build_dir/worker.mjs" "$firmware_root"
"$task_node" "$repo_root/scripts/test-web-secure-elements.mjs" "$task_build_dir/worker.mjs" "$firmware_root/test-stm32h563-web-se/app.elf"
