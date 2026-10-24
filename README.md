# m33mu-lab

A browser embedded-systems lab built on the [m33mu](https://github.com/danielinux/m33mu) ARMv8-M emulator. Real firmware runs in m33mu compiled to WebAssembly and drives an analog circuit on the same virtual clock. You wire parts, buses and instruments to a to-scale board drawing, load an ELF and run.

- Boards: all 15 m33mu CPU profiles run on their board artwork. The NUCLEO-H563ZI has its full Zio/morpho map from UM3115 (212 electrically wired contacts, the rest visual-only with the reason shown) and its on-board LEDs.
- Parts: breadboard, resistor, capacitor, LED, diode, push button, NPN, N-MOSFET, DC supply, ground, and logic-level I2C/SPI/UART devices.
- Firmware features: GPIO and EXTI, timer PWM outputs on H5, UART terminals, I2C/SPI buses with sniffers and failure injection, on-chip crypto engines.
- Secure elements: ATECC608A, TA100, TROPIC01, SE050 and STSAFE-A120 as wired bench parts, answered by m33mu's own models (`docs/crypto.md`).
- Instruments: multiple scopes, CRT-style UART terminals, bus sniffers, an inspector, diagnostics, SIGC capture import/export.
- Projects: v2 JSON with the circuit, probes, solver settings, view and an embedded ELF checked by SHA-256; examples in `public/examples/`.

What is and is not modelled: `docs/current-capabilities.md`. Design notes: `docs/adr-001-solver.md`, `docs/electrical-model.md`, `docs/buses.md`, `docs/pwm.md`, `docs/acceptance-matrix.md`. Work tracker: `docs/todo.md`, `docs/p0-progress.md`.

## Layout

- `m33mu/` — the emulator, as a git submodule. The lab uses only its WASM ABI (`m33mu/scripts/build-wasm-api.sh`, `mm_web_abi_*`), its native CLI and `web_parity_runner` for parity tests, and its test firmware under `m33mu/tests/firmware`.
- `src/` app, `worker/` emulator worker, `sim/` circuit solver, `boards/` + `public/boards/` board data and artwork, `project/` schemas, `tests/` unit and browser tests, `scripts/` build, test and board generators.

The worker checks `mm_web_abi_version()` against `M33MU_WEB_ABI_VERSION` in `worker/engine.mjs` and refuses a mismatched build.

## Build and run

Needs CMake, Emscripten (`emcc`, `emcmake`), Node.js/npm and the m33mu native build dependencies.

```sh
git submodule update --init
cmake -S . -B build -DM33MU_WOLFSSL_SRC=$HOME/src/wolfssl -DM33MU_WASM_RUST_SE=ON  # crypto optional
cmake --build build                    # m33mu CLI + dist/
cmake --build build --target webserver # Vite at http://127.0.0.1:5173/
```

Manual equivalent: `scripts/build-web-app.sh --install && npm run dev`. `M33MU_ROOT` points the scripts at another m33mu checkout.

## Tests

`cd build && ctest` runs everything below. `-DM33MU_FIRMWARE_ROOT=` points the all-CPU and crypto tests at a tests/firmware tree with built ELFs (unbuilt ones are skipped). Firmware-based tests need `arm-none-eabi-gcc`; the browser test needs Chromium (`M33MU_CHROMIUM` overrides the path).

- `node tests/run-unit.mjs` — solver, scheduler, project model, net graph, examples.
- `scripts/test-web-worker.sh` — worker API vs CLI parity.
- `scripts/test-web-demos.sh` — demos, lifecycle, UART, buses, PWM, every CPU, crypto engines, secure elements.
- `scripts/test-web-bench.sh`, `test-web-worker-wfi.sh`, `test-web-worker-active-exti.sh` — coupled firmware/circuit timing.
- `scripts/test-web-acceptance-matrix.sh` — CLI vs native session vs Node/WASM vs Chromium worker.
- `scripts/test-web-browser.sh [screenshot-dir]` — Chromium interaction tests against `dist/`, network blocked.

## License

AGPL-3.0-or-later, as m33mu (see `LICENSE`). Third-party notices: `THIRD_PARTY.md`.
