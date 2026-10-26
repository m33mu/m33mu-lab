// Selection inspector: parameters, solved voltages/currents, pad state, probes.

import { useEffect, useState } from 'react';
import { busAf } from '../sim/buses.ts';
import { CATALOG, formatSi, parseSi, sigcFromParam, sigcToParam } from './project/catalog.ts';
import { decodeSigc } from './instruments/sigc.ts';
import { type Project, type ProbeTarget, type TerminalRef, refKey } from './project/model.ts';
import { type CompiledCircuit, type PlacedTerminal, partTerminals } from './project/netgraph.ts';
import type { Selection } from './canvas/BenchCanvas.tsx';
import { type BusOption, csCandidates, defaultChipSelect, partBusKind, usedChipSelects } from './project/buswire.ts';

export type Observation = {
  timeNs: number;
  nets: Record<string, number>;
  currents: Record<string, number>;
  pads: Record<string, { volts: number; digital: 0 | 1; drive: string; pull: string }>;
};

export type McuPadInfo = { level: number; mode: number; pull: number; timeNs: number };

const MODES = ['input', 'output', 'alternate function', 'analog'];
const PULLS = ['none', 'pull-up', 'pull-down'];

type Props = {
  project: Project;
  selection: Selection;
  compiled: CompiledCircuit;
  terminals: Map<string, PlacedTerminal>;
  observation: Observation | null;
  mcuPads: Record<string, McuPadInfo>;
  benchActive: boolean;
  onParam(partId: string, key: string, value: number | string): void;
  onParams(partId: string, values: Record<string, number | string>): void;
  onRotate(): void;
  onDelete(): void;
  onProbe(channel: 0 | 1, target: ProbeTarget | null): void;
  buses: BusOption[];
  onWireBus(partId: string, busId: string, csKey: string | null): void;
};

/** Pick a board bus and a chip select, then wire every line in one step. */
function BusConnect({ partId, kind, props }: { partId: string; kind: 'spi' | 'i2c'; props: Props }) {
  const options = props.buses.filter((b) => b.kind === kind);
  const [busId, setBusId] = useState(options[0]?.id ?? '');
  const bus = options.find((b) => b.id === busId) ?? options[0];
  const terminals = [...props.terminals.values()];
  const fallback = bus && kind === 'spi' ? defaultChipSelect(props.project, terminals, partId, bus) : null;
  const [cs, setCs] = useState<string | null>(null);
  useEffect(() => setCs(null), [partId, busId]);
  const cpu = props.project.boards.find((b) => b.id === options[0]?.board)?.cpu;
  if (!options.length) {
    return <p className="muted bus-connect">This board has no {kind === 'spi' ? 'SPI' : 'I²C'} header with a known pin map; wire the lines by hand.</p>;
  }
  const chosenCs = cs ?? fallback;
  const used = usedChipSelects(props.project, terminals, partId);
  return (
    <fieldset className="bus-connect" data-testid="bus-connect">
      <legend>Connect to {kind === 'spi' ? 'SPI' : 'I²C'} bus</legend>
      <label className="param">Bus
        <select value={bus.id} onChange={(e) => setBusId(e.target.value)} data-testid="bus-select">
          {options.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
        </select>
      </label>
      {kind === 'spi' && (
        <label className="param">Chip select
          <select value={chosenCs ?? ''} onChange={(e) => setCs(e.target.value || null)} data-testid="bus-cs">
            {!chosenCs && <option value="">(none free)</option>}
            {csCandidates(terminals, bus.board).map((t) => (
              <option key={t.key} value={t.key}>{t.label}{used.has(t.socPad ?? '') ? ' — CS of another part' : ''}</option>
            ))}
          </select>
        </label>
      )}
      <button type="button" className="primary" data-testid="bus-wire" onClick={() => props.onWireBus(partId, bus.id, chosenCs)}>
        Wire {kind === 'spi' ? 'SCK, MOSI, MISO, CS' : 'SCL, SDA'}, VCC and GND
      </button>
      {kind === 'i2c' && <p className="muted">I²C needs pull-ups: add 4.7 kΩ from SCL and SDA to 3V3 unless the board has them.</p>}
      {Object.keys(busAf(cpu)).length === 0 && <p className="muted">The wiring is the board's, but bus devices answer firmware only on the STM32 boards (H563, H533, U585, L552) in this build.</p>}
    </fieldset>
  );
}

function ParamInput({ value, unit, onCommit }: { value: number; unit: string; onCommit(v: number): void }) {
  const [text, setText] = useState(formatSi(value, unit));
  const [bad, setBad] = useState(false);
  useEffect(() => { setText(formatSi(value, unit)); setBad(false); }, [value, unit]);
  return (
    <input value={text} aria-invalid={bad} className={bad ? 'invalid' : ''}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { const v = parseSi(text); if (v === null) setBad(true); else onCommit(v); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
  );
}

/** SIGC source: load a capture file and pick its trace. */
function SigcSourceParams({ part, onParam, onParams }: { part: Project['parts'][number]; onParam: Props['onParam'];
  onParams: Props['onParams'] }) {
  const [error, setError] = useState('');
  const capture = sigcFromParam(part.params.sigc);
  const n = capture?.timesNs.length ?? 0;
  const span = n > 1 ? (capture!.timesNs[n - 1] - capture!.timesNs[0]) * 1e-9 : 0;
  async function load(file: File) {
    setError('');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const decoded = decodeSigc(bytes);
      onParams(part.id, { sigc: sigcToParam(bytes), trace: decoded.traces[0].name });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  return (
    <div className="param">
      <label>SIGC capture
        <input type="file" accept=".sigc,application/octet-stream" data-testid="sigc-source-file"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f); e.target.value = ''; }} />
      </label>
      {capture ? (
        <>
          <label>Trace
            <select value={String(part.params.trace)} onChange={(e) => onParam(part.id, 'trace', e.target.value)}>
              {capture.traces.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
            </select>
          </label>
          <p className="muted" data-testid="sigc-source-info">{n} samples over {formatSi(span, 's')}; replayed from bench time 0.</p>
        </>
      ) : <p className="muted">No capture loaded: the source outputs 0 V.</p>}
      {error && <p className="warning">{error}</p>}
    </div>
  );
}

export function Inspector(props: Props) {
  const { project, selection, compiled, observation } = props;
  const voltageOf = (ref: TerminalRef) => {
    const net = compiled.terminalNet.get(refKey(ref));
    if (!net || !observation) return null;
    return observation.nets[net] ?? 0;
  };
  const probeButtons = (target: ProbeTarget) => (
    <div className="probe-buttons">
      <span className="muted">{target.kind === 'current' ? 'Current' : `Voltage${target.at.kind === 'part' ? ` at ${target.at.terminal}` : ''}`} →</span>
      {[0, 1].map((c) => (
        <button key={c} type="button" onClick={() => props.onProbe(c as 0 | 1, target)}
          title={`Show this ${target.kind} on scope channel ${c + 1}`}>CH{c + 1}</button>
      ))}
    </div>
  );

  if (!selection) {
    return (
      <div className="inspector empty">
        <p>Select a part, wire or board contact. Drag the background to pan, scroll to zoom.</p>
        <p><kbd>V</kbd> select · <kbd>W</kbd> wire · <kbd>R</kbd> rotate · <kbd>F</kbd> fit view · <kbd>Del</kbd> delete · <kbd>Ctrl+Z</kbd>/<kbd>Ctrl+Y</kbd> undo/redo</p>
      </div>
    );
  }
  if (selection.kind === 'contact') {
    const t = props.terminals.get(selection.key);
    if (!t || t.ref.kind !== 'board') return null;
    const soc = t.socPad;
    const pad = soc ? observation?.pads[soc] : undefined;
    const mcu = soc ? props.mcuPads[soc] : undefined;
    return (
      <div className="inspector">
        <h3>Board contact {t.ref.contact}</h3>
        {t.enabled && soc && ['GND', '3V3', '5V'].includes(soc) ? (
          <p>Board rail <strong>{soc}</strong>{soc === 'GND' ? ': the MCU ground reference.' : ': modelled as an ideal source.'}</p>
        ) : t.enabled ? (
          <dl>
            <dt>SoC pad</dt><dd>{soc}</dd>
            <dt>Firmware mode</dt><dd>{mcu ? `${MODES[mcu.mode]}, ${PULLS[mcu.pull] ?? 'none'}` : 'not reported yet'}</dd>
            <dt>Driver</dt><dd>{pad ? `${pad.drive}, pull ${pad.pull}` : '—'}</dd>
            <dt>Voltage</dt><dd>{pad ? formatSi(pad.volts, 'V') : 'not wired / bench idle'}</dd>
            <dt>Input level</dt><dd>{pad ? (pad.digital ? 'high' : 'low') : '—'}</dd>
            <dt>Current out of pad</dt><dd>{observation ? formatSi(observation.currents[`pad-${soc}`] ?? 0, 'A') : '—'}</dd>
          </dl>
        ) : (
          <p className="warning">Visual locator only. Its electrical mapping has not been verified for this board revision, so it cannot be wired.</p>
        )}
        {t.enabled && probeButtons({ kind: 'voltage', at: t.ref })}
      </div>
    );
  }
  if (selection.kind === 'wire') {
    const w = project.wires.find((x) => x.id === selection.id);
    if (!w) return null;
    const v = voltageOf(w.from);
    return (
      <div className="inspector">
        <h3>Wire</h3>
        <dl>
          <dt>Net</dt><dd>{compiled.terminalNet.get(refKey(w.from)) ?? '—'}</dd>
          <dt>Voltage</dt><dd>{v === null ? 'bench idle' : formatSi(v, 'V')}</dd>
        </dl>
        {probeButtons({ kind: 'voltage', at: w.from })}
        <button type="button" onClick={props.onDelete}>Delete wire</button>
      </div>
    );
  }
  const part = project.parts.find((p) => p.id === selection.id);
  if (!part) return null;
  const def = CATALOG[part.kind];
  const current = observation?.currents[part.id];
  const terms = partTerminals(project, part.id);
  return (
    <div className="inspector">
      <h3>{def.title} <span className="muted">{part.id}</span></h3>
      {part.kind === 'sigc-source' && <SigcSourceParams part={part} onParam={props.onParam} onParams={props.onParams} />}
      {def.params.filter((spec) => !spec.text).map((spec) => (
        <label key={spec.key} className="param">{spec.label}
          {spec.choices ? (
            <select value={String(part.params[spec.key])} onChange={(e) => props.onParam(part.id, spec.key, e.target.value)}>
              {spec.choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          ) : (
            <ParamInput value={Number(part.params[spec.key])} unit={spec.unit}
              onCommit={(v) => props.onParam(part.id, spec.key, Math.min(spec.max, Math.max(spec.min, v)))} />
          )}
        </label>
      ))}
      {partBusKind(part.kind) && <BusConnect key={part.id} partId={part.id} kind={partBusKind(part.kind)!} props={props} />}
      {part.kind !== 'breadboard' && (
        <dl>
          {terms.map((t) => {
            const v = t.ref.kind === 'part' ? voltageOf(t.ref) : null;
            return [<dt key={`${t.key}-l`}>{t.label}</dt>,
              <dd key={`${t.key}-v`}>{v === null ? '—' : formatSi(v, 'V')}</dd>];
          })}
          {current !== undefined && part.kind !== 'ground' && (<><dt>Current</dt><dd>{formatSi(current, 'A')}</dd></>)}
          {part.kind === 'led' && current !== undefined && (
            <><dt>Brightness</dt><dd>{Math.round(Math.max(0, Math.min(1, current / 0.02)) * 100)}% of rated 20 mA</dd></>
          )}
        </dl>
      )}
      {part.kind !== 'breadboard' && part.kind !== 'ground' && probeButtons({ kind: 'current', part: part.id })}
      {part.kind !== 'breadboard' && terms[0] && probeButtons({ kind: 'voltage', at: terms[0].ref })}
      <div className="row">
        <button type="button" onClick={props.onRotate}>Rotate</button>
        <button type="button" onClick={props.onDelete}>Delete</button>
      </div>
      {props.benchActive && <p className="muted">Parameter edits pause the bench until you apply them.</p>}
    </div>
  );
}
