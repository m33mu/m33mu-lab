import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLocation, symbolize, type ElfSymbol } from '../../src/instruments/Debugger.tsx';

const symbols: ElfSymbol[] = [
  { name: 'SysTick_Handler', address: 0x0c00013c, size: 16, kind: 'func' },
  { name: 'Reset_Handler', address: 0x0c00014c, size: 152, kind: 'func' },
  { name: 'ticks', address: 0x20000000, size: 4, kind: 'object' }
];

test('symbolize: function offsets, objects only inside their size', () => {
  assert.equal(symbolize(symbols, 0x0c00013c), 'SysTick_Handler');
  assert.equal(symbolize(symbols, 0x0c000150), 'Reset_Handler+0x4');
  assert.equal(symbolize(symbols, 0x20000002), 'ticks+0x2');
  assert.equal(symbolize(symbols, 0x0c000000), '');
});

test('parseLocation: hex, symbol+offset, registers', () => {
  const regs = Array.from({ length: 16 }, (_, i) => 0x1000 * i);
  assert.equal(parseLocation('0x0c00013c', symbols, regs), 0x0c00013c);
  assert.equal(parseLocation('c00013c', symbols, regs), 0x0c00013c);
  assert.equal(parseLocation('Reset_Handler+8', symbols, regs), 0x0c000154);
  assert.equal(parseLocation('Reset_Handler + 0x10', symbols, regs), 0x0c00015c);
  assert.equal(parseLocation('sp', symbols, regs), 0xd000);
  assert.equal(parseLocation('pc', symbols, null), null);
  assert.equal(parseLocation('nope', symbols, regs), null);
});
