import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Tm1637 } from '../../sim/tm1637.ts';
import { BusLayer, type LogicNetlist } from '../../sim/buses.ts';

function send(op: (clk: 0 | 1, dio: 0 | 1) => void, bytes: number[]) {
  op(1, 1); op(1, 0); op(0, 0);
  for (let byte of bytes) {
    for (let bit = 0; bit < 8; bit++) {
      const dio = (byte & 1) as 0 | 1;
      op(0, dio); op(1, dio); op(0, dio);
      byte >>= 1;
    }
    op(0, 1); op(1, 1); op(0, 1);
  }
  op(0, 0); op(1, 0); op(1, 1);
}

test('TM1637 accepts LSB-first commands, ACKs and displays A001', () => {
  const tm = new Tm1637();
  const ack: boolean[] = [];
  const op = (clk: 0 | 1, dio: 0 | 1) => {
    for (const result of [tm.edge('CLK', clk), tm.edge('DIO', dio)])
      if (result.ack !== null) ack.push(result.ack);
  };
  send(op, [0x40]);
  send(op, [0xc0, 0x77, 0x3f, 0x3f, 0x06]);
  send(op, [0x8f]);
  assert.deepEqual(tm.state(), { segments: [0x77, 0x3f, 0x3f, 0x06], on: true, brightness: 7 });
  assert.equal(ack.filter(Boolean).length, 7);
  assert.equal(ack.filter((x) => !x).length, 7);
});

test('wiring layer decodes GPIO edges, logs display, and drives DIO ACK low', () => {
  const logic: LogicNetlist = { cpu: 'stm32n657', pins: { PH4: 'clk', PC3: 'dio' },
    devices: [{ id: 'display', kind: 'tm1637', nets: { VCC: 'vcc', GND: 'gnd', CLK: 'clk', DIO: 'dio' }, params: {} }] };
  const input: number[] = [];
  const bus = new BusLayer(logic, { level: () => 1, volts: (net) => net === 'vcc' ? 5 : 0,
    padConfig: () => null, nowNs: () => 0 }, {}, (_pad, level) => input.push(level));
  const op = (clk: 0 | 1, dio: 0 | 1) => {
    bus.onGpioEvents([{ socPad: 'PH4', level: clk, timeNs: 0 }, { socPad: 'PC3', level: dio, timeNs: 0 }]);
  };
  send(op, [0x40]); send(op, [0xc0, 0x77, 0x3f, 0x3f, 0x06]); send(op, [0x8f]);
  assert.equal(input.filter((x) => x === 0).length, 7);
  assert.equal(input.filter((x) => x === 1).length, 7);
  assert.deepEqual(bus.takeLog().at(-1)?.tm1637, { id: 'display', segments: [0x77, 0x3f, 0x3f, 0x06], on: true, brightness: 7 });
});
