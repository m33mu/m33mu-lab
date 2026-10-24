// Debug panel: breakpoints by symbol or address, core registers with symbol
// annotations and a memory view. Talks to the worker's setBreakpoints,
// readMemory and writeMemory operations.

import { useEffect, useMemo, useState } from 'react';

export type ElfSymbol = { name: string; address: number; size: number; kind: 'func' | 'object' };

export type DebugMachine = {
  registers: number[]; xpsr: number; securityState: number; mode: number;
  breakpoint?: number | null;
};

type Props = {
  machine: DebugMachine | null;
  symbols: ElfSymbol[];
  breakpoints: number[];
  /** Execution is paused or stopped: memory can be read consistently. */
  halted: boolean;
  onBreakpoints(addresses: number[]): void;
  readMemory(address: number, length: number): Promise<(number | null)[]>;
  writeMemory(address: number, bytes: number[]): Promise<void>;
  onError(e: unknown): void;
};

const MAX_BREAKPOINTS = 16;
const ROW = 16;
const ROWS = 16;
const hex8 = (v: number) => (v >>> 0).toString(16).padStart(8, '0');
const REG_NAMES = ['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9', 'r10', 'r11', 'r12', 'sp', 'lr', 'pc'];

/** "name+0x12" for an address inside (or just after) a symbol. */
export function symbolize(symbols: ElfSymbol[], address: number): string {
  const a = address >>> 0;
  let best: ElfSymbol | null = null;
  for (const s of symbols) {
    if (s.address > a) break;
    if (s.kind === 'func' || a < s.address + Math.max(s.size, 1)) best = s;
  }
  if (!best || (best.size > 0 && a >= best.address + best.size + 0x1000)) return '';
  const off = a - best.address;
  return off === 0 ? best.name : `${best.name}+0x${off.toString(16)}`;
}

/** Address from "0x0c000134", "SysTick_Handler", "main+4", "sp", "r4". */
export function parseLocation(text: string, symbols: ElfSymbol[], regs: number[] | null): number | null {
  const t = text.trim();
  if (/^(0x)?[0-9a-f]{1,8}$/i.test(t)) return parseInt(t.replace(/^0x/i, ''), 16) >>> 0;
  const reg = REG_NAMES.indexOf(t.toLowerCase());
  if (reg >= 0) return regs ? regs[reg] >>> 0 : null;
  const m = /^([A-Za-z_.$][\w.$]*)(?:\s*\+\s*(0x[0-9a-f]+|\d+))?$/i.exec(t);
  if (!m) return null;
  const sym = symbols.find((s) => s.name === m[1]);
  if (!sym) return null;
  return (sym.address + (m[2] ? Number(m[2]) : 0)) >>> 0;
}

export function Debugger({ machine, symbols, breakpoints, halted, onBreakpoints, readMemory, writeMemory, onError }: Props) {
  const [bpText, setBpText] = useState('');
  const [memText, setMemText] = useState('sp');
  const [memBase, setMemBase] = useState<number | null>(null);
  const [mem, setMem] = useState<(number | null)[]>([]);
  const [prevMem, setPrevMem] = useState<(number | null)[]>([]);
  const [poke, setPoke] = useState('');
  const funcs = useMemo(() => symbols.filter((s) => s.kind === 'func'), [symbols]);
  const regs = machine?.registers ?? null;

  const resolvedBase = parseLocation(memText, symbols, regs);
  const base = resolvedBase === null ? null : (resolvedBase & ~(ROW - 1)) >>> 0;

  async function refresh(at: number | null = base) {
    if (at === null) return;
    try {
      const bytes = await readMemory(at, ROW * ROWS);
      setPrevMem(memBase === at ? mem : []);
      setMem(bytes);
      setMemBase(at);
    } catch (e) { onError(e); }
  }

  // Follow the machine while halted (registers such as sp move the view).
  useEffect(() => {
    if (halted && machine) void refresh();
  }, [halted, machine, base]); // eslint-disable-line react-hooks/exhaustive-deps

  function addBreakpoint() {
    const a = parseLocation(bpText, symbols, regs);
    if (a === null) { onError(new Error(`Unknown location "${bpText}"`)); return; }
    const addr = (a & ~1) >>> 0;
    if (!breakpoints.includes(addr) && breakpoints.length < MAX_BREAKPOINTS) onBreakpoints([...breakpoints, addr]);
    setBpText('');
  }

  async function doPoke() {
    // "<location> = 12 34 ab" writes bytes; RAM and peripherals only.
    const m = /^(.+?)\s*=\s*((?:[0-9a-f]{1,2}\s*)+)$/i.exec(poke);
    const at = m ? parseLocation(m[1], symbols, regs) : null;
    if (!m || at === null) { onError(new Error('Write as: <address|symbol> = 01 02 ff')); return; }
    try {
      await writeMemory(at, m[2].trim().split(/\s+/).map((b) => parseInt(b, 16)));
      setPoke('');
      await refresh();
    } catch (e) { onError(e); }
  }

  const pc = regs ? regs[15] & ~1 : null;
  const hitName = machine?.breakpoint != null ? symbolize(symbols, machine.breakpoint) : '';
  return (
    <div className="debugger" data-testid="debugger">
      <section className="dbg-col">
        <h4>Breakpoints <span className="muted">{breakpoints.length}/{MAX_BREAKPOINTS}</span></h4>
        <form className="dbg-row" onSubmit={(e) => { e.preventDefault(); addBreakpoint(); }}>
          <input list="dbg-funcs" value={bpText} onChange={(e) => setBpText(e.target.value)}
            placeholder="symbol or 0x address" aria-label="Breakpoint location" data-testid="bp-input" />
          <datalist id="dbg-funcs">{funcs.map((s) => <option key={`${s.name}@${s.address}`} value={s.name} />)}</datalist>
          <button type="submit" disabled={!bpText.trim()}>Add</button>
        </form>
        <ul className="dbg-list">
          {breakpoints.map((a) => (
            <li key={a} className={pc === a ? 'hit' : ''}>
              <code>0x{hex8(a)}</code> <span>{symbolize(symbols, a)}</span>
              <button aria-label={`Remove breakpoint 0x${hex8(a)}`} onClick={() => onBreakpoints(breakpoints.filter((x) => x !== a))}>×</button>
            </li>
          ))}
          {breakpoints.length === 0 && <li className="muted">None. Running continues until paused.</li>}
        </ul>
        {machine?.breakpoint != null && (
          <p className="dbg-hit" data-testid="bp-hit">Paused at 0x{hex8(machine.breakpoint)}{hitName ? ` (${hitName})` : ''}. Run continues, Step executes it.</p>
        )}
      </section>
      <section className="dbg-col">
        <h4>Registers <span className="muted">{machine ? `${machine.securityState ? 'Secure' : 'Non-secure'} ${machine.mode ? 'handler' : 'thread'}` : ''}</span></h4>
        <div className="dbg-regs">
          {REG_NAMES.map((n, i) => (
            <div key={n}><span>{n}</span><code>{regs ? hex8(regs[i]) : '—'}</code>
              <em>{regs && (i >= 14) ? symbolize(symbols, regs[i] & ~1) : ''}</em></div>
          ))}
          <div><span>xpsr</span><code>{machine ? hex8(machine.xpsr) : '—'}</code>
            <em>{machine ? `${machine.xpsr & 0x80000000 ? 'N' : '-'}${machine.xpsr & 0x40000000 ? 'Z' : '-'}${machine.xpsr & 0x20000000 ? 'C' : '-'}${machine.xpsr & 0x10000000 ? 'V' : '-'} exc ${machine.xpsr & 0x1ff}` : ''}</em></div>
        </div>
      </section>
      <section className="dbg-col mem">
        <h4>Memory</h4>
        <form className="dbg-row" onSubmit={(e) => { e.preventDefault(); void refresh(); }}>
          <input value={memText} onChange={(e) => setMemText(e.target.value)} aria-label="Memory address"
            placeholder="address, symbol or register" data-testid="mem-input" />
          <button type="submit" disabled={base === null}>Read</button>
        </form>
        <div className="dbg-mem" data-testid="mem-view">
          {memBase !== null && Array.from({ length: ROWS }, (_, r) => {
            const row = mem.slice(r * ROW, r * ROW + ROW);
            return (
              <div key={r}><code className="addr">{hex8(memBase + r * ROW)}</code>{' '}
                {row.map((b, i) => {
                  const k = r * ROW + i;
                  const changed = prevMem.length > 0 && prevMem[k] !== b;
                  return <code key={i} className={changed ? 'chg' : b === null ? 'na' : ''}>{b === null ? '··' : b.toString(16).padStart(2, '0')}</code>;
                })}
                {' '}<code className="ascii">{row.map((b) => (b !== null && b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('')}</code>
              </div>
            );
          })}
          {memBase === null && <p className="muted">Pause the firmware or press Read.</p>}
        </div>
        <form className="dbg-row" onSubmit={(e) => { e.preventDefault(); void doPoke(); }}>
          <input value={poke} onChange={(e) => setPoke(e.target.value)} aria-label="Write memory"
            placeholder="0x20000000 = de ad be ef" disabled={!halted} />
          <button type="submit" disabled={!halted || !poke.trim()}>Write</button>
        </form>
      </section>
    </div>
  );
}
