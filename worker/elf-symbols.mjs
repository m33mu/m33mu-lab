// Function and object symbols of an ELF32 little-endian image, for the
// debugger panes (breakpoints by name, symbol+offset for addresses).

const SHT_SYMTAB = 2;
const STT_OBJECT = 1;
const STT_FUNC = 2;
const MAX_SYMBOLS = 20000;

/** [{ name, address, size, kind: 'func' | 'object' }] sorted by address;
 * Thumb function addresses have bit 0 cleared. Empty if there is no symtab. */
export function elfSymbols(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length < 52 || u8[0] !== 0x7f || u8[1] !== 0x45 || u8[2] !== 0x4c || u8[3] !== 0x46 ||
      u8[4] !== 1 || u8[5] !== 1) return [];
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const shoff = dv.getUint32(32, true);
  const shentsize = dv.getUint16(46, true);
  const shnum = dv.getUint16(48, true);
  if (shentsize < 40 || shoff + shnum * shentsize > u8.length) return [];
  const section = (i) => {
    const o = shoff + i * shentsize;
    return { type: dv.getUint32(o + 4, true), offset: dv.getUint32(o + 16, true),
      size: dv.getUint32(o + 20, true), link: dv.getUint32(o + 24, true),
      entsize: dv.getUint32(o + 36, true) };
  };
  const out = [];
  const seen = new Set();
  for (let i = 0; i < shnum; i++) {
    const sym = section(i);
    if (sym.type !== SHT_SYMTAB || sym.link >= shnum) continue;
    const str = section(sym.link);
    const entsize = sym.entsize || 16;
    if (sym.offset + sym.size > u8.length || str.offset + str.size > u8.length) continue;
    const decoder = new TextDecoder();
    for (let o = sym.offset; o + 16 <= sym.offset + sym.size && out.length < MAX_SYMBOLS; o += entsize) {
      const type = u8[o + 12] & 0xf;
      if (type !== STT_FUNC && type !== STT_OBJECT) continue;
      const nameOff = dv.getUint32(o, true);
      if (nameOff === 0 || nameOff >= str.size) continue;
      let end = str.offset + nameOff;
      while (end < str.offset + str.size && u8[end] !== 0) end++;
      const name = decoder.decode(u8.subarray(str.offset + nameOff, end));
      const value = dv.getUint32(o + 4, true);
      const address = type === STT_FUNC ? (value & ~1) >>> 0 : value;
      const key = `${name}@${address}`;
      if (!name || name.startsWith('$') || seen.has(key)) continue;
      seen.add(key);
      out.push({ name, address, size: dv.getUint32(o + 8, true), kind: type === STT_FUNC ? 'func' : 'object' });
    }
  }
  return out.sort((a, b) => a.address - b.address);
}
