// Function generator waveforms as one period of a repeating piecewise-linear
// source (see Pwl in netlist.ts). Square, triangle and sawtooth are exact;
// a sine is SINE_POINTS segments per period, within 0.03 % of the amplitude.
import type { Pwl } from './netlist.ts';

export type Waveform = 'sine' | 'square' | 'triangle' | 'sawtooth';
export const WAVEFORMS: Waveform[] = ['sine', 'square', 'triangle', 'sawtooth'];

export type FuncGenSettings = {
  waveform: Waveform;
  /** Hz, > 0. */
  frequency: number;
  /** Peak amplitude around the offset, V. */
  amplitude: number;
  offset: number;
  /** High fraction of the period, square only; clamped to the edge times. */
  duty: number;
};

export const SINE_POINTS = 128;

/** Square and sawtooth edges: a thousandth of the period, at most 50 ns. */
export function edgeSeconds(frequency: number): number {
  return Math.min(1e-3 / frequency, 50e-9);
}

export function funcGenPwl(s: FuncGenSettings): Pwl {
  const period = 1 / s.frequency;
  const lo = s.offset - s.amplitude;
  const hi = s.offset + s.amplitude;
  const ns = (t: number) => t * 1e9;
  let times: number[];
  let volts: number[];
  switch (s.waveform) {
  case 'sine':
    times = [];
    volts = [];
    for (let i = 0; i <= SINE_POINTS; i++) {
      times.push(ns(period * i / SINE_POINTS));
      volts.push(s.offset + s.amplitude * Math.sin(2 * Math.PI * i / SINE_POINTS));
    }
    volts[SINE_POINTS] = volts[0];
    break;
  case 'square': {
    const e = edgeSeconds(s.frequency);
    const d = Math.min(1 - 2 * e / period, Math.max(2 * e / period, s.duty));
    times = [0, d * period - e, d * period, period - e, period].map(ns);
    volts = [hi, hi, lo, lo, hi];
    break;
  }
  case 'triangle':
    times = [0, period / 2, period].map(ns);
    volts = [lo, hi, lo];
    break;
  case 'sawtooth': {
    const e = edgeSeconds(s.frequency);
    times = [0, period - e, period].map(ns);
    volts = [lo, hi, lo];
    break;
  }
  }
  return { timesNs: times, volts, repeat: true };
}
