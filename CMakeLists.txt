cmake_minimum_required(VERSION 3.16)
project(m33mu_lab NONE)

# m33mu-lab: browser workbench for the m33mu emulator. The emulator lives in
# the m33mu/ submodule; this project only builds the WASM ABI from it, the
# web app, and runs the workbench tests.

include(ExternalProject)
include(CTest)

set(M33MU_ROOT "${CMAKE_SOURCE_DIR}/m33mu" CACHE PATH "m33mu source tree")
set(M33MU_BUILD "${CMAKE_BINARY_DIR}/m33mu" CACHE PATH "m33mu native build tree")

find_program(M33MU_EMCMAKE emcmake REQUIRED)
find_program(M33MU_EMCC emcc REQUIRED)
find_program(M33MU_NODE node REQUIRED)
find_program(M33MU_NPM npm REQUIRED)
find_program(M33MU_ARM_NONE_EABI_GCC arm-none-eabi-gcc)
find_program(M33MU_CHROMIUM NAMES chromium chromium-browser google-chrome)

# Native m33mu CLI and web_parity_runner, used by parity tests.
ExternalProject_Add(m33mu_native
  SOURCE_DIR "${M33MU_ROOT}"
  BINARY_DIR "${M33MU_BUILD}"
  CMAKE_ARGS -DM33MU_ENABLE_WASM=OFF
  BUILD_COMMAND "${CMAKE_COMMAND}" --build "${M33MU_BUILD}" --target m33mu web_parity_runner --parallel
  INSTALL_COMMAND ""
  BUILD_ALWAYS ON
)

set(LAB_ENV
  "M33MU_ROOT=${M33MU_ROOT}"
  "M33MU_BUILD=${M33MU_BUILD}"
  "M33MU_EMCMAKE=${M33MU_EMCMAKE}"
  "M33MU_EMCC=${M33MU_EMCC}"
  "M33MU_NODE=${M33MU_NODE}"
  "M33MU_NPM=${M33MU_NPM}"
  "M33MU_CLI=${M33MU_BUILD}/m33mu"
  "M33MU_PARITY_RUNNER=${M33MU_BUILD}/web_parity_runner")
if(M33MU_ARM_NONE_EABI_GCC)
  list(APPEND LAB_ENV "M33MU_ARM_NONE_EABI_GCC=${M33MU_ARM_NONE_EABI_GCC}")
endif()

add_custom_target(web-app ALL
  COMMAND "${CMAKE_COMMAND}" -E env ${LAB_ENV} "${CMAKE_SOURCE_DIR}/scripts/build-web-app.sh" --install
  WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
  USES_TERMINAL
  COMMENT "Building the workbench into dist/")
add_custom_target(webserver
  COMMAND "${CMAKE_COMMAND}" -E env ${LAB_ENV} "${CMAKE_SOURCE_DIR}/scripts/run-webserver.sh"
  WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
  USES_TERMINAL
  COMMENT "Serving the workbench at http://127.0.0.1:5173/")

function(lab_test name script)
  add_test(NAME ${name}
    COMMAND "${CMAKE_COMMAND}" -E env ${LAB_ENV} "${CMAKE_SOURCE_DIR}/scripts/${script}")
  set_tests_properties(${name} PROPERTIES WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}" ${ARGN})
endfunction()

lab_test(web_sim_unit_test test-web-unit.sh)
lab_test(wasm_worker_api_test test-web-worker.sh)
if(M33MU_CHROMIUM)
  add_test(NAME web_browser_chromium_test
    COMMAND "${CMAKE_COMMAND}" -E env ${LAB_ENV} "M33MU_CHROMIUM=${M33MU_CHROMIUM}"
      "${CMAKE_SOURCE_DIR}/scripts/test-web-browser.sh")
  set_tests_properties(web_browser_chromium_test PROPERTIES
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}" RUN_SERIAL TRUE)
endif()
if(M33MU_ARM_NONE_EABI_GCC)
  lab_test(wasm_worker_wfi_exti_test test-web-worker-wfi.sh)
  lab_test(wasm_worker_active_exti_boundary_test test-web-worker-active-exti.sh)
  lab_test(web_acceptance_matrix_test test-web-acceptance-matrix.sh RUN_SERIAL TRUE)
  lab_test(wasm_worker_demos_test test-web-demos.sh)
  lab_test(wasm_worker_bench_rc_exti_test test-web-bench.sh)
endif()
