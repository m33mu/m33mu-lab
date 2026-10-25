import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { emptyProject, type Project } from '../../src/project/model.ts';
import { allTerminals, compileCircuit, type BoardLayout } from '../../src/project/netgraph.ts';
import { busOptions, defaultChipSelect, partBusKind, wireBus } from '../../src/project/buswire.ts';

const root = process.env.M33MU_WEB_ROOT!;
const load = (cpu: string) => JSON.parse(readFileSync(join(root, `public/boards/layout/${cpu}.json`), 'utf8')) as BoardLayout;

function wireOne(p: Project, layouts: Map<string, BoardLayout>, partId: string, busId: string) {
  const terms = allTerminals(p, layouts);
  const bus = busOptions(p, layouts).find((b) => b.id === busId)!;
  assert.ok(bus, `bus ${busId}`);
  return wireBus(p, terms, partId, bus, defaultChipSelect(p, terms, partId, bus));
}

test('bus parts are recognised from their terminals', () => {
  assert.equal(partBusKind('spi-flash'), 'spi');
  assert.equal(partBusKind('se-atecc608'), 'spi');
  assert.equal(partBusKind('i2c-eeprom'), 'i2c');
  assert.equal(partBusKind('sniffer'), null);
  assert.equal(partBusKind('resistor'), null);
});

test('H563: SPI1 and I2C buses from the silkscreen; one selection wires a flash completely', () => {
  const layouts = new Map([['stm32h563', load('stm32h563')]]);
  const p = emptyProject();
  const buses = busOptions(p, layouts);
  const spi = buses.find((b) => b.kind === 'spi')!;
  assert.match(spi.label, /^SPI1 \(PA5 SCK, PB5 MOSI, PG9 MISO, PD14 CS\)/);
  assert.ok(buses.some((b) => b.kind === 'i2c' && b.label.startsWith('I2C1')));
  p.parts.push({ id: 'flash1', kind: 'spi-flash', x: 900, y: 300, rotation: 0, params: {} },
    { id: 'flash2', kind: 'spi-flash', x: 900, y: 500, rotation: 0, params: {} });
  const one = wireOne(p, layouts, 'flash1', spi.id);
  assert.deepEqual(one.missing, []);
  assert.equal(one.added, 6);
  const two = wireOne(one.project, layouts, 'flash2', spi.id);
  assert.equal(two.added, 6);
  const c = compileCircuit(two.project, layouts);
  assert.deepEqual(c.diagnostics.filter((d) => d.severity === 'error'), []);
  const nets = (id: string) => c.logic.devices.find((d) => d.id === id)!.nets;
  assert.equal(nets('flash1').SCK, nets('flash2').SCK);
  assert.equal(nets('flash1').MISO, nets('flash2').MISO);
  assert.notEqual(nets('flash1').CS, nets('flash2').CS, 'second part gets its own chip select');
  assert.equal(c.logic.pins.PA5, nets('flash1').SCK);
  // Rewiring replaces the part's wires instead of adding more.
  const again = wireOne(two.project, layouts, 'flash1', spi.id);
  assert.equal(again.project.wires.length, two.project.wires.length);
});

test('Arduino SPI header on a Nordic board and a Zio-only ST board', () => {
  for (const cpu of ['nrf5340', 'stm32u585']) {
    const layouts = new Map([[cpu, load(cpu)]]);
    const p = emptyProject(cpu as never);
    const spi = busOptions(p, layouts).find((b) => b.kind === 'spi');
    assert.ok(spi && spi.label.startsWith('Arduino SPI'), `${cpu}: ${spi?.label}`);
    p.parts.push({ id: 'se1', kind: 'se-atecc608', x: 1200, y: 300, rotation: 0, params: {} });
    const r = wireOne(p, layouts, 'se1', spi.id);
    assert.deepEqual(r.missing, [], cpu);
    const c = compileCircuit(r.project, layouts);
    assert.deepEqual(c.diagnostics.filter((d) => d.severity === 'error'), [], cpu);
  }
});
