// The generated STM32 AF tables against entries read from the datasheets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { busAf } from '../../sim/buses.ts';

// Header pads read from STM32H563 DS14258 Rev 6 (AF0-AF15 tables) when the
// table was hand written. PB11 was dropped: the H563ZI has no PB11.
const H563_AF: Record<string, Record<number, string>> = {
  PA5: { 5: 'SPI1_SCK' }, PA6: { 5: 'SPI1_MISO' }, PA7: { 5: 'SPI1_MOSI' },
  PB5: { 5: 'SPI1_MOSI' }, PG9: { 5: 'SPI1_MISO' }, PD7: { 5: 'SPI1_MOSI' },
  PB6: { 4: 'I2C1_SCL', 7: 'USART1_TX', 8: 'LPUART1_TX' },
  PB7: { 4: 'I2C1_SDA', 7: 'USART1_RX', 8: 'LPUART1_RX' },
  PB8: { 4: 'I2C1_SCL' }, PB9: { 4: 'I2C1_SDA' }, PB10: { 4: 'I2C2_SCL' },
  PD5: { 7: 'USART2_TX' }, PD6: { 7: 'USART2_RX' },
  PF0: { 4: 'I2C2_SDA' }, PF1: { 4: 'I2C2_SCL' }
};
import { STM32_AF } from '../../sim/stm32-af.ts';

test('generated STM32H563 table agrees with DS14258 Tables 9-10', () => {
  for (const [pad, afs] of Object.entries(H563_AF)) {
    for (const [af, signal] of Object.entries(afs)) {
      assert.equal(STM32_AF.stm32h563[pad]?.[Number(af)], signal, `${pad} AF${af}`);
    }
  }
});

test('Arduino SPI1/I2C1 pins carry the expected AFs on every STM32 board', () => {
  for (const cpu of ['stm32h563', 'stm32h533', 'stm32u585', 'stm32l552']) {
    const t = STM32_AF[cpu];
    assert.equal(t.PA5[5], 'SPI1_SCK', cpu);
    assert.equal(t.PA6[5], 'SPI1_MISO', cpu);
    assert.equal(t.PA7[5], 'SPI1_MOSI', cpu);
    // Nucleo-64 H533RE routes Arduino D15/D14 to PB6/PB7; the Nucleo-144
    // boards use PB8/PB9.
    const [scl, sda] = cpu === 'stm32h533' ? ['PB6', 'PB7'] : ['PB8', 'PB9'];
    assert.equal(t[scl][4], 'I2C1_SCL', cpu);
    assert.equal(t[sda][4], 'I2C1_SDA', cpu);
  }
});

test('the bus layer picks the table of the netlist CPU, none for other vendors', () => {
  assert.equal(busAf(undefined), STM32_AF.stm32h563);
  assert.equal(busAf('stm32u585').PB8[4], 'I2C1_SCL');
  assert.deepEqual(busAf('nrf5340'), {});
});
