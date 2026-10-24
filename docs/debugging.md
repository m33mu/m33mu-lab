# Debugging firmware in the workbench

The **Debug** tab of the instrument dock (shown once firmware is loaded) pauses the emulated core on breakpoints and shows its state. It works for plain runs and for runs coupled to a circuit.

- **Breakpoints**: up to 16, by function name (completion from the ELF symbol table), `name+offset`, or address. Execution pauses *before* the instruction at the address; the bench holds the circuit at the MCU's virtual time. Run continues (executing the instruction under the breakpoint first); Step executes one instruction when no circuit is coupled. Breakpoints are cleared when another firmware image is loaded.
- **Registers**: r0-r12, sp, lr, pc, xPSR flags and exception number, security state and mode; lr and pc are shown as `symbol+offset`.
- **Memory**: 256 bytes from an address, symbol or register (`sp` by default), refreshed whenever execution halts, with changed bytes highlighted; unmapped bytes show `··`. While halted, `<location> = 01 02 ff` writes bytes (RAM and peripherals through the bus, as the CPU would).

Worker operations (see `worker/engine.mjs`): `symbols`, `setBreakpoints {addresses}`, `readMemory {address, length ≤ 4096}`, `writeMemory {address, bytes}`; `state` and `bench` events carry `breakpoint` (the PC) when paused at one. The C side is `mm_web_set_breakpoints()` in m33mu (`include/m33mu/web.h`).

Not yet: disassembly, step over/out, watchpoints, source-level views, GDB remote protocol over the browser.

Tests: `scripts/test-web-debug.mjs` (in `test-web-demos.sh`: symbols, breakpoint in a plain run, step, memory, breakpoints in a coupled bench resuming at the next SysTick exactly 1 ms later), `tests/project/debugger.test.ts`, Chromium "debug tab" check, m33mu `web_session_test` (breakpoint pause and resume).
