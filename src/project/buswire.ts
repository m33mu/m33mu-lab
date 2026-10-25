// One-step bus wiring: find the SPI and I²C buses a board exposes (from the
// layout's silkscreen functions and Arduino R3 labels) and wire every line of
// a bus part to them, plus VCC to 3V3 and GND to GND.

import { CATALOG } from './catalog.ts';
import { type Project, type Wire, newId, refKey } from './model.ts';
import { type BoardLayout, type PlacedTerminal, contactId } from './netgraph.ts';

export type BusKind = 'spi' | 'i2c';

/** Board contacts per bus line; a line may appear on several headers. */
export type BusOption = {
  id: string;
  kind: BusKind;
  label: string;
  board: string;
  lines: Partial<Record<BusLine, string[]>>;
};

type BusLine = 'SCK' | 'MOSI' | 'MISO' | 'CS' | 'SCL' | 'SDA';
const SPI_LINES: BusLine[] = ['SCK', 'MOSI', 'MISO', 'CS'];
const I2C_LINES: BusLine[] = ['SCL', 'SDA'];
const ARDUINO: Record<string, BusLine> = { D10: 'CS', D11: 'MOSI', D12: 'MISO', D13: 'SCK', D14: 'SDA', D15: 'SCL', SDA: 'SDA', SCL: 'SCL' };
const WIRE_COLORS: Record<string, string> = {
  SCK: '#f49d37', MOSI: '#2e86de', MISO: '#1b998b', CS: '#6c4ab6', SCL: '#f49d37', SDA: '#2e86de',
  VCC: '#d7263d', GND: '#333333'
};

/** Bus kind a part speaks, from its terminals. */
export function partBusKind(kind: string): BusKind | null {
  const def = CATALOG[kind as keyof typeof CATALOG];
  if (!def?.logic || kind === 'sniffer') return null;
  const ids = def.terminals({}).map((t) => t.id);
  if (['SCK', 'MOSI', 'MISO', 'CS'].every((t) => ids.includes(t))) return 'spi';
  if (['SCL', 'SDA'].every((t) => ids.includes(t))) return 'i2c';
  return null;
}

export function busOptions(project: Project, layouts: Map<string, BoardLayout>): BusOption[] {
  const out: BusOption[] = [];
  for (const b of project.boards) {
    const layout = layouts.get(b.cpu);
    if (!layout) continue;
    type Entry = { id: string; pad: string };
    const groups = new Map<string, { kind: BusKind; lines: Partial<Record<BusLine, Entry[]>> }>();
    const add = (bus: string, kind: BusKind, line: BusLine, id: string, pad: string) => {
      const g = groups.get(bus) ?? { kind, lines: {} };
      groups.set(bus, g);
      (g.lines[line] ??= []).push({ id, pad });
    };
    for (const conn of layout.connectors) {
      for (const c of conn.contacts) {
        if (!c.electricalEnabled || !c.signal) continue;
        const id = contactId(conn.id, c);
        const pad = c.socPad ?? c.signal;
        for (const f of (c.function ?? '').split('/')) {
          const m = /^(SPI|I2C)(\d+)_(SCK|MISO|MOSI|CS|NSS|SCL|SDA)$/.exec(f);
          if (m) add(`${m[1]}${m[2]}`, m[1] === 'SPI' ? 'spi' : 'i2c', (m[3] === 'NSS' ? 'CS' : m[3]) as BusLine, id, pad);
        }
        const ard = /^Arduino (\S+)$/.exec(c.note ?? '')?.[1] ?? c.signal;
        const line = ARDUINO[ard];
        if (line) add(SPI_LINES.includes(line) ? 'Arduino SPI' : 'Arduino I²C', SPI_LINES.includes(line) ? 'spi' : 'i2c', line, id, pad);
      }
    }
    const seen = new Map<string, BusOption>();
    for (const [name, g] of groups) {
      const need = g.kind === 'spi' ? ['SCK', 'MOSI', 'MISO'] as BusLine[] : I2C_LINES;
      if (!need.every((l) => g.lines[l]?.length)) continue;
      // A line routed to several pads (SPI1_MOSI on PA7 and PB5) uses one:
      // the pad on the clock's GPIO port, else the first in name order.
      const port = (pad: string) => pad.replace(/\d+$/, '');
      const clockPort = port(g.lines[need[0]]![0].pad);
      const pads: Partial<Record<BusLine, string>> = {};
      const lines: Partial<Record<BusLine, string[]>> = {};
      for (const l of [...SPI_LINES, ...I2C_LINES]) {
        const entries = g.lines[l];
        if (!entries) continue;
        const names = [...new Set(entries.map((e) => e.pad))].sort();
        pads[l] = names.find((n) => port(n) === clockPort) ?? names[0];
        lines[l] = entries.filter((e) => e.pad === pads[l]).map((e) => e.id);
      }
      // Arduino headers routed to a named peripheral are one bus.
      const sig = need.map((l) => pads[l]).join(',');
      const desc = need.map((l) => `${pads[l]} ${l}`).join(', ');
      const prev = seen.get(sig);
      if (prev) {
        prev.label = prev.label.replace(' (', ` / ${name} (`);
        for (const l of [...SPI_LINES, ...I2C_LINES]) {
          for (const id of lines[l] ?? []) if (!(prev.lines[l] ??= []).includes(id)) prev.lines[l]!.push(id);
        }
        continue;
      }
      const opt: BusOption = { id: `${b.id}:${name}`, kind: g.kind, board: b.id, lines,
        label: `${name} (${desc}${pads.CS ? `, ${pads.CS} CS` : ''})` };
      seen.set(sig, opt);
      out.push(opt);
    }
  }
  return out.sort((a, b) => Number(a.label.startsWith('Arduino')) - Number(b.label.startsWith('Arduino')) ||
    a.label.localeCompare(b.label));
}

/** GPIO contacts a chip select can use: electrical, not a rail. */
export function csCandidates(terminals: PlacedTerminal[], board: string): PlacedTerminal[] {
  const seen = new Set<string>();
  return terminals.filter((t) => {
    if (t.ref.kind !== 'board' || t.ref.board !== board || !t.enabled || !t.socPad) return false;
    if (['GND', '3V3', '5V', 'VIN', 'IOREF', 'AREF', 'AGND'].includes(t.socPad) || seen.has(t.socPad)) return false;
    seen.add(t.socPad);
    return true;
  });
}

/** SoC pads already used as another part's chip select. */
export function usedChipSelects(project: Project, terminals: PlacedTerminal[], partId: string): Set<string> {
  const padOf = new Map(terminals.map((t) => [t.key, t.socPad]));
  const used = new Set<string>();
  for (const w of project.wires) {
    for (const [a, b] of [[w.from, w.to], [w.to, w.from]]) {
      const pad = padOf.get(refKey(b));
      if (a.kind === 'part' && a.part !== partId && a.terminal === 'CS' && b.kind === 'board' && pad) used.add(pad);
    }
  }
  return used;
}

/** Default chip select: the bus CS when no other part uses it, else the first free GPIO. */
export function defaultChipSelect(project: Project, terminals: PlacedTerminal[], partId: string, bus: BusOption): string | null {
  const used = usedChipSelects(project, terminals, partId);
  const padOf = new Map(terminals.map((t) => [t.key, t.socPad]));
  const busy = new Set(project.wires.flatMap((w) => [padOf.get(refKey(w.from)), padOf.get(refKey(w.to))]));
  const mine = project.wires.find((w) => (w.from.kind === 'part' && w.from.part === partId && w.from.terminal === 'CS') ||
    (w.to.kind === 'part' && w.to.part === partId && w.to.terminal === 'CS'));
  if (mine) {
    const other = mine.from.kind === 'board' ? mine.from : mine.to;
    if (other.kind === 'board' && other.board === bus.board) return refKey(other);
  }
  for (const id of bus.lines.CS ?? []) {
    const key = refKey({ kind: 'board', board: bus.board, contact: id });
    if (!used.has(padOf.get(key) ?? '')) return key;
  }
  const busLines = new Set(Object.values(bus.lines).flat().map((id) => padOf.get(refKey({ kind: 'board', board: bus.board, contact: id }))));
  const free = csCandidates(terminals, bus.board).find((t) => !busy.has(t.socPad) && !busLines.has(t.socPad));
  return free?.key ?? null;
}

/** Wire every bus line of `partId` to `bus` (nearest contact of each line),
 * chip select to `csKey`, VCC to 3V3 and GND to GND. Existing wires on those
 * part terminals are replaced. */
export function wireBus(project: Project, terminals: PlacedTerminal[], partId: string, bus: BusOption,
  csKey: string | null): { project: Project; added: number; missing: string[] } {
  const part = project.parts.find((p) => p.id === partId);
  if (!part) return { project, added: 0, missing: [] };
  const byKey = new Map(terminals.map((t) => [t.key, t]));
  const mineAt = (term: string) => byKey.get(refKey({ kind: 'part', part: partId, terminal: term }));
  const nearest = (from: PlacedTerminal | undefined, keys: string[]) => {
    let best: PlacedTerminal | null = null;
    let bestD = Infinity;
    for (const k of keys) {
      const t = byKey.get(k);
      if (!t || !from) continue;
      const d = (t.x - from.x) ** 2 + (t.y - from.y) ** 2;
      if (d < bestD) { best = t; bestD = d; }
    }
    return best;
  };
  const boardKeys = (ids: string[]) => ids.map((id) => refKey({ kind: 'board', board: bus.board, contact: id }));
  const railKeys = (rail: string) => terminals.filter((t) => t.ref.kind === 'board' && t.ref.board === bus.board &&
    t.enabled && t.socPad === rail).map((t) => t.key);
  const ids = CATALOG[part.kind].terminals(part.params).map((t) => t.id);
  const plan: [string, string[]][] = [];
  for (const line of bus.kind === 'spi' ? ['SCK', 'MOSI', 'MISO'] : I2C_LINES) {
    plan.push([line, boardKeys(bus.lines[line as BusLine] ?? [])]);
  }
  if (bus.kind === 'spi' && ids.includes('CS')) plan.push(['CS', csKey ? [csKey] : []]);
  if (ids.includes('VCC')) plan.push(['VCC', railKeys('3V3')]);
  if (ids.includes('GND')) plan.push(['GND', railKeys('GND')]);
  const replaced = new Set(plan.map(([t]) => t));
  const wires: Wire[] = project.wires.filter((w) => ![w.from, w.to].some((r) =>
    r.kind === 'part' && r.part === partId && replaced.has(r.terminal)));
  const missing: string[] = [];
  let added = 0;
  for (const [term, keys] of plan) {
    const from = mineAt(term);
    const to = nearest(from, keys);
    if (!from || !to) { missing.push(term); continue; }
    wires.push({ id: newId('w'), from: from.ref, to: to.ref, color: WIRE_COLORS[term] ?? '#333333' });
    added++;
  }
  return { project: { ...project, wires }, added, missing };
}
