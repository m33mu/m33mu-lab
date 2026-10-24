# Scope CSV and SIGC captures

The scope exports its current sample buffer as CSV (`time_ns,ch1,ch2`) or as a SIGC v1 voltage capture. SIGC uses the same little-endian container as `scripts/sigc.py`. The browser reader accepts one timebase, one or two traces, at most 400,000 samples and an 8 MiB file. Uniform and explicit timebases are supported.

SIGC samples are signed 16-bit millivolts. Export rounds voltage samples to the nearest millivolt, names traces `ch1` and `ch2`, records a 3300 mV full-scale metadata value, and makes the first sample time zero. It refuses current channels, missing samples and voltages outside the representable range. Use CSV when those data or absolute timestamps matter.

Import into the scope displays a preview while the bench is paused; running or resetting clears it, and project JSON does not store those samples.

To drive a circuit (and through it an MCU input) from a capture, place a **Signal source (SIGC trace replay)** part and load the `.sigc` file in its inspector, then pick a trace. The part is a voltage source between `+` and `−` that follows the trace piecewise-linearly from bench time 0 (the first sample), holding the last value or repeating with the last timestamp as the period. The solver steps exactly onto every sample time. The capture is stored in the project (base64 in the part's `sigc` parameter, up to the 8 MiB SIGC limit). Repeated timestamps keep their first sample. CLI signal replay remains available through `--signal-file`; see `docs/signal-sigc-convert.md` at the repository root.
