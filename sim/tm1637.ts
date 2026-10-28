// TM1637 two-wire display protocol. This is GPIO bit-banging, not I2C:
// bytes are LSB-first and the ninth clock is a slave-driven ACK.

export type Tm1637State = { segments: number[]; on: boolean; brightness: number };
export type Tm1637Edge = { ack: boolean | null; changed: boolean; stopped: boolean };

export class Tm1637 {
  readonly segments = [0, 0, 0, 0];
  on = false;
  brightness = 0;
  private clk = 1;
  private dio = 1;
  private active = false;
  private bit = 0;
  private value = 0;
  private byteIndex = 0;
  private address = 0;
  private autoAddress = true;
  private writeEnabled = true;
  private ackHeld = false;
  private ackClocked = false;
  private dirty = false;

  state(): Tm1637State { return { segments: [...this.segments], on: this.on, brightness: this.brightness }; }

  edge(line: 'CLK' | 'DIO', level: 0 | 1): Tm1637Edge {
    const oldClk = this.clk, oldDio = this.dio;
    if (line === 'CLK') this.clk = level;
    else this.dio = level;
    const out: Tm1637Edge = { ack: null, changed: false, stopped: false };
    if (this.clk === 1 && oldClk === 1 && line === 'DIO') {
      if (oldDio === 1 && level === 0) {
        this.active = true;
        this.bit = 0;
        this.value = 0;
        this.byteIndex = 0;
        this.ackClocked = false;
        if (this.ackHeld) { this.ackHeld = false; out.ack = false; }
      } else if (oldDio === 0 && level === 1 && this.active) {
        this.active = false;
        out.changed = this.dirty;
        out.stopped = true;
        this.dirty = false;
        if (this.ackHeld) { this.ackHeld = false; out.ack = false; }
      }
      return out;
    }
    if (!this.active) return out;
    // The host releases DIO with CLK low after the eighth data clock.
    if (line === 'DIO' && this.clk === 0 && this.bit === 8 && level === 1 && !this.ackHeld) {
      this.ackHeld = true;
      out.ack = true;
    }
    if (line === 'CLK' && oldClk === 0 && level === 1) {
      if (this.bit < 8) {
        this.value |= this.dio << this.bit;
        this.bit++;
        if (this.bit === 8) this.accept(this.value);
      } else this.ackClocked = true;
    }
    if (line === 'CLK' && oldClk === 1 && level === 0 && this.bit === 8 && !this.ackClocked && this.dio === 1 && !this.ackHeld) {
      this.ackHeld = true;
      out.ack = true;
    }
    if (line === 'CLK' && oldClk === 1 && level === 0 && this.ackClocked) {
      this.bit = 0;
      this.value = 0;
      this.ackClocked = false;
      if (this.ackHeld) { this.ackHeld = false; out.ack = false; }
    }
    return out;
  }

  private accept(value: number): void {
    if (this.byteIndex++ === 0) {
      if ((value & 0xc0) === 0x40) {
        this.autoAddress = (value & 0x04) === 0;
        this.writeEnabled = (value & 0x02) === 0;
      } else if ((value & 0xc0) === 0x80) {
        const on = !!(value & 0x08), brightness = value & 7;
        this.dirty ||= on !== this.on || brightness !== this.brightness;
        this.on = on;
        this.brightness = brightness;
      } else if ((value & 0xc0) === 0xc0) this.address = value & 0x0f;
    } else if (this.writeEnabled && this.address < this.segments.length) {
      this.dirty ||= this.segments[this.address] !== value;
      this.segments[this.address] = value;
      if (this.autoAddress) this.address++;
    }
  }
}
