#!/usr/bin/env python3
"""Generate the web workbench example projects in public/examples/.

The H563 examples reference firmware ELFs built from
tests/firmware/test-stm32h563-web-{blink,button} and copied next to them
(make -C <dir> app.elf; cp app.elf public/examples/h563-<name>.elf).
"""

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "examples"
LAYOUT = "MB1404 H563ZI-C01"


def part(pid, kind, x, y, rotation=0, **params):
    return {"id": pid, "kind": kind, "x": x, "y": y, "rotation": rotation, "params": params}


def pt(part_id, terminal):
    return {"kind": "part", "part": part_id, "terminal": terminal}


def board(contact):
    return {"kind": "board", "board": "board1", "contact": contact}


def wire(n, a, b, color="#d7263d"):
    return {"id": f"w{n}", "from": a, "to": b, "color": color}


LAYOUTS = {"stm32h563": LAYOUT, "rp2350": "Pico 2 datasheet Fig. 2", "nrf5340": "nRF5340 DK (Zephyr Arduino map)"}


def project(pid, name, parts, wires, channels, window_ns, firmware=None, sample_ns=1000, lookahead_ns=50000, pan=(40, 20), zoom=0.5,
            cpu="stm32h563"):
    sim = {"cpu": cpu, "firmwareFormat": "elf", "firmwareSha256": None, "firmwareName": ""}
    if firmware:
        data = (OUT / firmware).read_bytes()
        sim["firmwareSha256"] = hashlib.sha256(data).hexdigest()
        sim["firmwareName"] = firmware
    return {
        "schemaVersion": 2, "projectId": pid, "name": name, "simulator": sim,
        "boards": [{"id": "board1", "cpu": cpu, "layoutRevision": LAYOUTS[cpu], "x": 0, "y": 0}],
        "parts": parts, "wires": wires,
        "instruments": {"scopes": [{"id": "scope1", "name": "Scope 1", "channels": channels, "windowNs": window_ns}]},
        "solver": {"lookaheadNs": lookahead_ns, "sampleNs": sample_ns},
        "ui": {"zoom": zoom, "panX": pan[0], "panY": pan[1]},
    }


def led_branch(start, r_id="r1", led_id="led1", gnd_id="gnd1", y=300, first_wire=1):
    parts = [
        part(r_id, "resistor", 800, y, ohms=330),
        part(led_id, "led", 1000, y, color="red"),
        part(gnd_id, "ground", 1100, y + 100),
    ]
    wires = [
        wire(first_wire, start, pt(r_id, "a")),
        wire(first_wire + 1, pt(r_id, "b"), pt(led_id, "a")),
        wire(first_wire + 2, pt(led_id, "k"), pt(gnd_id, "g"), "#333333"),
    ]
    return parts, wires


EXAMPLES = []

parts, wires = led_branch(board("CN7-10"))
EXAMPLES.append(("h563-blink", project(
    "example-h563-blink", "H563 LED blink (PA5, CN7 pin 10)", parts, wires,
    [{"kind": "voltage", "at": board("CN7-10")}, {"kind": "current", "part": "led1"}],
    1_000_000_000, firmware="h563-blink.elf", sample_ns=100_000, lookahead_ns=1_000_000),
    "SysTick firmware toggles PA5 every 100 ms; 330 Ω and a red LED to ground. LED brightness follows the solved current."))

parts, wires = led_branch(board("CN7-10"), r_id="r3")
parts += [
    part("v1", "supply", 800, 700, volts="3.3"),
    part("sw1", "switch", 900, 620),
    part("r1", "resistor", 1000, 620, ohms=10000),
    part("r2", "resistor", 1150, 700, 90, ohms=100000),
    part("c1", "capacitor", 1250, 700, 90, farads=100e-9),
    part("gnd2", "ground", 1200, 900),
]
wires += [
    wire(10, pt("v1", "p"), pt("sw1", "a")),
    wire(11, pt("sw1", "b"), pt("r1", "a")),
    wire(12, pt("r1", "b"), board("CN9-1"), "#2e86de"),
    wire(13, pt("r2", "a"), pt("r1", "b"), "#2e86de"),
    wire(14, pt("c1", "a"), pt("r1", "b"), "#2e86de"),
    wire(15, pt("r2", "b"), pt("gnd2", "g"), "#333333"),
    wire(16, pt("c1", "b"), pt("gnd2", "g"), "#333333"),
    wire(17, pt("v1", "n"), pt("gnd2", "g"), "#333333"),
]
EXAMPLES.append(("h563-button", project(
    "example-h563-button", "H563 RC button to EXTI (PA6, CN9 pin 1)", parts, wires,
    [{"kind": "voltage", "at": pt("r1", "b")}, {"kind": "current", "part": "led1"}],
    50_000_000, firmware="h563-button.elf", sample_ns=10_000),
    "Hold the push button: a 10 kΩ/100 kΩ divider charges 100 nF on PA6; each Schmitt crossing interrupts the firmware, which mirrors PA6 onto the PA5 LED."))

EXAMPLES.append(("divider", project(
    "example-divider", "DC divider", [
        part("v1", "supply", 900, 400, volts="5"),
        part("r1", "resistor", 1000, 300, ohms=2000),
        part("r2", "resistor", 1200, 300, 90, ohms=3000),
        part("gnd1", "ground", 1100, 600),
    ], [
        wire(1, pt("v1", "p"), pt("r1", "a")),
        wire(2, pt("r1", "b"), pt("r2", "a")),
        wire(3, pt("r2", "b"), pt("gnd1", "g"), "#333333"),
        wire(4, pt("v1", "n"), pt("gnd1", "g"), "#333333"),
    ], [{"kind": "voltage", "at": pt("r2", "a")}, None], 1_000_000, pan=(-300, 40)),
    "Analog only: 5 V across 2 kΩ + 3 kΩ; the midpoint must read 3 V."))

EXAMPLES.append(("rc-switch", project(
    "example-rc-switch", "RC charge through a switch", [
        part("v1", "supply", 900, 400, volts="5"),
        part("sw1", "switch", 1000, 300),
        part("r1", "resistor", 1100, 300, ohms=1000),
        part("c1", "capacitor", 1250, 300, 90, farads=10e-6),
        part("gnd1", "ground", 1150, 500),
    ], [
        wire(1, pt("v1", "p"), pt("sw1", "a")),
        wire(2, pt("sw1", "b"), pt("r1", "a")),
        wire(3, pt("r1", "b"), pt("c1", "a")),
        wire(4, pt("c1", "b"), pt("gnd1", "g"), "#333333"),
        wire(5, pt("v1", "n"), pt("gnd1", "g"), "#333333"),
    ], [{"kind": "voltage", "at": pt("c1", "a")}, {"kind": "current", "part": "r1"}], 50_000_000,
    sample_ns=10_000, pan=(-300, 40)),
    "Analog only: hold the button to charge 10 µF through 1 kΩ (τ = 10 ms); release and it holds its charge."))

EXAMPLES.append(("npn-led", project(
    "example-npn-led", "NPN low-side LED switch", [
        part("v1", "supply", 900, 500, volts="5"),
        part("sw1", "switch", 1000, 300),
        part("rb", "resistor", 1100, 300, ohms=10000),
        part("q1", "npn", 1250, 400),
        part("rc", "resistor", 1300, 200, ohms=220),
        part("led1", "led", 1450, 200, color="green"),
        part("gnd1", "ground", 1250, 600),
    ], [
        wire(1, pt("v1", "p"), pt("sw1", "a")),
        wire(2, pt("sw1", "b"), pt("rb", "a")),
        wire(3, pt("rb", "b"), pt("q1", "b")),
        wire(4, pt("v1", "p"), pt("led1", "a")),
        wire(5, pt("led1", "k"), pt("rc", "b")),
        wire(6, pt("rc", "a"), pt("q1", "c")),
        wire(7, pt("q1", "e"), pt("gnd1", "g"), "#333333"),
        wire(8, pt("v1", "n"), pt("gnd1", "g"), "#333333"),
    ], [{"kind": "current", "part": "led1"}, {"kind": "voltage", "at": pt("q1", "c")}], 10_000_000,
    sample_ns=10_000, pan=(-350, 40)),
    "Analog only: the button drives 10 kΩ into a 2N3904-like base; the transistor saturates and sinks the LED current through 220 Ω."))



# Bus demo: modules on I2C1/SPI1, a USB-UART adapter on USART2, a sniffer on
# the I2C lines. Header pins: UM3115 Rev 3 Tables 21-23.
def board_wire(n, contact, part_id, terminal, color):
    return wire(n, board(contact), pt(part_id, terminal), color)

bus_parts = [
    part("eeprom1", "i2c-eeprom", 900, 260, addressPins="0"),
    part("temp1", "i2c-temp", 900, 420, addressPins="0", celsius=25),
    part("flash1", "spi-flash", 900, 620),
    part("uart1", "usb-uart", 900, 820),
    part("sniff1", "sniffer", 1150, 120),
    part("r1", "resistor", 760, 100, 90, ohms=4700),
    part("r2", "resistor", 800, 100, 90, ohms=4700),
]
RED, BLK, YEL, GRN, BLU, ORG, PUR, WHT = "#d7263d", "#222222", "#f4d35e", "#2fb34a", "#2e86de", "#f49d37", "#6c4ab6", "#e6e6e6"
bus_wires = []
n = 0
def add(contact_or_pair, *rest):
    global n
    n += 1
    bus_wires.append(wire(n, *rest) if contact_or_pair is None else board_wire(n, *contact_or_pair, *rest))
for mod in ("eeprom1", "temp1", "flash1"):
    add(("CN8-7", mod, "VCC"), RED)
    add(("CN8-11", mod, "GND"), BLK)
for mod in ("eeprom1", "temp1"):
    add(("CN7-2", mod, "SCL"), YEL)
    add(("CN7-4", mod, "SDA"), GRN)
add(None, pt("r1", "a"), board("CN8-7"), RED)
add(None, pt("r1", "b"), board("CN7-2"), YEL)
add(None, pt("r2", "a"), board("CN8-7"), RED)
add(None, pt("r2", "b"), board("CN7-4"), GRN)
add(("CN7-16", "flash1", "CS"), WHT)
add(("CN7-10", "flash1", "SCK"), ORG)
add(("CN7-14", "flash1", "MOSI"), BLU)
add(("CN7-12", "flash1", "MISO"), PUR)
add(("CN9-12", "uart1", "GND"), BLK)
add(("CN9-6", "uart1", "RX"), GRN)
add(("CN9-4", "uart1", "TX"), BLU)
add(("CN7-2", "sniff1", "CH1"), YEL)
add(("CN7-4", "sniff1", "CH2"), GRN)
add(("CN7-8", "sniff1", "GND"), BLK)
EXAMPLES.append(("h563-bus", project(
    "example-h563-bus", "H563 I²C/SPI/UART bus demo", bus_parts, bus_wires,
    [{"kind": "voltage", "at": board("CN7-2")}, {"kind": "voltage", "at": board("CN7-4")}],
    1_000_000, firmware="h563-bus.elf", sample_ns=1_000, lookahead_ns=50_000),
    "Firmware talks to a 24C02 EEPROM and a TMP102 on I2C1, reads a W25Q flash JEDEC ID on SPI1 and sends 'ping' to a USB-UART adapter on USART2; results print on USART3. Remove a pull-up or an SDA wire to see BUSY or NACK."))


# Secure elements: m33mu's ATECC608A (SPI1, CS PD14), SE050 (I2C1) and
# STSAFE-A120 (I2C2 on PF1/PF0) models, driven by the secure element suite
# built for the header pins (m33mu tests/firmware/test-stm32h563-web-se).
se_parts = [
    part("se1", "se-atecc608", 900, 300),
    part("se2", "se-se050", 900, 560),
    part("se3", "se-stsafe", 900, 820),
    part("r1", "resistor", 760, 100, 90, ohms=4700),
    part("r2", "resistor", 800, 100, 90, ohms=4700),
    part("r3", "resistor", 840, 100, 90, ohms=4700),
    part("r4", "resistor", 880, 100, 90, ohms=4700),
]
bus_wires = []
n = 0
for mod in ("se1", "se2", "se3"):
    add(("CN8-7", mod, "VCC"), RED)
    add(("CN8-11", mod, "GND"), BLK)
add(("CN7-16", "se1", "CS"), WHT)
add(("CN7-10", "se1", "SCK"), ORG)
add(("CN7-14", "se1", "MOSI"), BLU)
add(("CN9-1", "se1", "MISO"), PUR)
add(("CN7-2", "se2", "SCL"), YEL)
add(("CN7-4", "se2", "SDA"), GRN)
add(("CN9-19", "se3", "SCL"), YEL)
add(("CN9-21", "se3", "SDA"), GRN)
for r, contact in (("r1", "CN7-2"), ("r2", "CN7-4"), ("r3", "CN9-19"), ("r4", "CN9-21")):
    add(None, pt(r, "a"), board("CN8-7"), RED)
    add(None, pt(r, "b"), board(contact), YEL if contact in ("CN7-2", "CN9-19") else GRN)
EXAMPLES.append(("h563-secure-elements", project(
    "example-h563-secure-elements", "H563 secure elements (ATECC608A, SE050, STSAFE-A120)", se_parts, bus_wires,
    [{"kind": "voltage", "at": board("CN7-2")}, {"kind": "voltage", "at": board("CN7-16")}],
    2_000_000, firmware="h563-secure-elements.elf", sample_ns=1_000, lookahead_ns=50_000),
    "The secure element suite asks an ATECC608A on SPI1 for its revision and random bytes, resets an SE050 on I2C1 and runs Echo and GenerateRandom on an STSAFE-A120 on I2C2; m33mu's own device models answer. Results print on USART3. Unplug a module's VCC to see it NACK."))


# Pico 2: m33mu tests/firmware/test-rp2350-web-gpio blinks the on-board LED
# (GPIO25) and copies GP15 (pull-up input) to GP16. Header: Pico 2 datasheet
# Figure 2 (GP15 pin 20, GP16 pin 21, GND pins 18 and 23).
pico_parts = [
    part("sw1", "switch", 520, 760),
    part("r1", "resistor", 520, 840, ohms=330),
    part("led1", "led", 700, 840, color="green"),
    part("gnd1", "ground", 800, 940),
]
pico_wires = [
    wire(1, board("J_LEFT-20"), pt("sw1", "a"), YEL),
    wire(2, pt("sw1", "b"), board("J_LEFT-18"), BLK),
    wire(3, board("J_RIGHT-21"), pt("r1", "a"), GRN),
    wire(4, pt("r1", "b"), pt("led1", "a"), GRN),
    wire(5, pt("led1", "k"), pt("gnd1", "g"), BLK),
    wire(6, pt("gnd1", "g"), board("J_RIGHT-23"), BLK),
]
EXAMPLES.append(("pico2-gpio", project(
    "example-pico2-gpio", "Pico 2 GPIO: button on GP15 lights GP16", pico_parts, pico_wires,
    [{"kind": "voltage", "at": board("J_LEFT-20")}, {"kind": "voltage", "at": board("J_RIGHT-21")}],
    200_000_000, firmware="pico2-gpio.elf", sample_ns=100_000, lookahead_ns=1_000_000, cpu="rp2350", pan=(200, 20)),
    "RP2350 firmware blinks the on-board LED (GPIO25) every 50 ms and copies GP15 to GP16: the internal pull-up keeps GP15 high and the green LED on, pressing the button pulls GP15 low and the LED goes off."))


# On-board B1 (PC13) copied to LD1 (PB0) by tests/firmware/test-stm32h563-web-b1.
EXAMPLES.append(("h563-b1", project(
    "example-h563-b1", "H563 user button B1 lights LD1", [], [], [None, None], 100_000_000,
    firmware="h563-b1.elf", sample_ns=100_000, lookahead_ns=1_000_000),
    "No circuit: press and hold the blue B1 button on the board drawing; the firmware copies PC13 to the green LD1 (PB0)."))


# nRF5340 DK: tests/firmware/test-nrf5340-web-gpio copies Button 1 (P0.23) to
# LED1 (P0.28) and Arduino D2 (P1.04) to D3 (P1.05); header from Zephyr.
nrf_parts = [
    part("sw1", "switch", 300, 760),
    part("r1", "resistor", 450, 840, ohms=330),
    part("led1", "led", 620, 840, color="green"),
    part("gnd1", "ground", 720, 940),
]
nrf_wires = [
    wire(1, board("ARD_DLOW-6"), pt("sw1", "a"), YEL),
    wire(2, pt("sw1", "b"), board("ARD_DHIGH-4"), BLK),
    wire(3, board("ARD_DLOW-5"), pt("r1", "a"), GRN),
    wire(4, pt("r1", "b"), pt("led1", "a"), GRN),
    wire(5, pt("led1", "k"), pt("gnd1", "g"), BLK),
    wire(6, pt("gnd1", "g"), board("ARD_POWER-6"), BLK),
]
EXAMPLES.append(("nrf5340-gpio", project(
    "example-nrf5340-gpio", "nRF5340 DK GPIO: D2 switch lights D3, Button 1 lights LED1", nrf_parts, nrf_wires,
    [{"kind": "voltage", "at": board("ARD_DLOW-6")}, {"kind": "voltage", "at": board("ARD_DLOW-5")}],
    20_000_000, firmware="nrf5340-gpio.elf", sample_ns=10_000, lookahead_ns=100_000, cpu="nrf5340", pan=(60, 20)),
    "Firmware copies Arduino D2 (P1.04, pull-up) to D3 (P1.05): the green LED is on until you press the switch. Hold Push button 1 on the board strip and LED 0 (P0.28, active low) lights."))


def main():
    index = []
    for name, proj, description in EXAMPLES:
        (OUT / f"{name}.m33mu.json").write_text(json.dumps(proj, indent=2) + "\n", encoding="utf-8")
        index.append({"id": name, "name": proj["name"], "project": f"{name}.m33mu.json",
                      "firmware": proj["simulator"]["firmwareName"] or None, "description": description})
    # Keep examples maintained outside this script (e.g. opamp-gain).
    path = OUT / "index.json"
    known = {e["id"] for e in index}
    if path.exists():
        index += [e for e in json.loads(path.read_text(encoding="utf-8"))["examples"] if e["id"] not in known]
    path.write_text(json.dumps({"schemaVersion": 1, "examples": index}, indent=2, ensure_ascii=False) + "\n",
                    encoding="utf-8")


if __name__ == "__main__":
    main()
