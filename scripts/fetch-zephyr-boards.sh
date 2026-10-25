#!/bin/sh
# Fetch the Zephyr board files that the board generators use as pin-map
# evidence (gen-st-boards.py and gen-arduino-boards.py), pinned to one commit.
set -eu
repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
rev=${ZEPHYR_REV:-c425eabae5724d39fdd828d31ec35dc850795fe1}
out="$repo_root/boards/sources/zephyr"
for f in \
  st/nucleo_l552ze_q/arduino_r3_connector.dtsi \
  st/nucleo_u575zi_q/arduino_r3_connector.dtsi \
  st/nucleo_u575zi_q/st_zio_connector.dtsi \
  st/nucleo_n657x0_q/arduino_r3_connector.dtsi \
  st/nucleo_h533re/arduino_r3_connector.dtsi \
  st/nucleo_h533re/st_morpho_connector.dtsi \
  nordic/nrf5340dk/nrf5340dk_common.dtsi \
  nordic/nrf54lm20dk/nrf54lm20dk_common.dtsi \
  nxp/frdm_mcxn947/frdm_mcxn947.dtsi \
  nxp/frdm_mcxw71/frdm_mcxw71.dts \
  nxp/frdm_rw612/frdm_rw612_common.dtsi \
  nxp/lpcxpresso55s69/lpcxpresso55s69.dtsi \
  nxp/mimxrt700_evk/mimxrt700_evk_mimxrt798s_cm33_cpu0.dts; do
  board=${f#*/}
  mkdir -p "$out/$(dirname "$board")"
  curl -fsS "https://raw.githubusercontent.com/zephyrproject-rtos/zephyr/$rev/boards/$f" -o "$out/$board"
done
echo "$rev" > "$out/REVISION"
