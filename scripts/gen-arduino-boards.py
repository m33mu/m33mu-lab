#!/usr/bin/env python3
"""Add Arduino R3 headers, user LEDs and buttons to the non-ST board drawings.

The sprite-pack drawings of these boards are provisional illustrations: their
connectors are placeholders whose pin identity is unknown, and they stay
visual-only. This script appends a labelled strip below each drawing with the
board's Arduino Uno R3 headers (Uno order and spacing) and its user LEDs and
buttons, all taken from Zephyr's board definition (boards/sources/zephyr,
fetched by scripts/fetch-zephyr-boards.sh at a pinned revision):

* nRF5340 DK, LPCXpresso55S69, FRDM-MCXN947, FRDM-MCXW71, FRDM-RW612: the
  arduino-header-r3 gpio-map, gpio-leds and gpio-keys.
* nRF54LM20 DK: LEDs and buttons (Zephyr maps no Arduino header for it).

Pad names follow the m33mu web session for each port model: P0.04 (Nordic),
PIO0_5 (LPC55S69), GPIO44 (RW612), P1_2 (MCXN947), PA1 (MCXW71).

Usage: scripts/gen-arduino-boards.py SPRITE_PACK.zip
"""
import json
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ZSRC = ROOT / "boards" / "sources" / "zephyr"
REV = (ZSRC / "REVISION").read_text().strip()
PITCH = 22.0


def nordic(ctrl, pin):
    return f"P{ctrl[-1]}.{int(pin):02d}"


def mcxn(ctrl, pin):
    return f"P{ctrl[-1]}_{int(pin)}"


def mcxw(ctrl, pin):
    return f"P{ctrl[-1].upper()}{int(pin)}"


def rw612(ctrl, pin):
    return f"GPIO{32 * int(ctrl[-1]) + int(pin)}"


def lpc55(ctrl, pin):
    return f"PIO{ctrl[-1]}_{int(pin)}"


def pic32(ctrl, pin):
    return f"P{ctrl[-1].upper()}{int(pin)}"


BOARDS = {
    "nrf5340": ("nordic/nrf5340dk/nrf5340dk_common.dtsi", nordic, True),
    "nrf54lm20": ("nordic/nrf54lm20dk/nrf54lm20dk_common.dtsi", nordic, False),
    "lpc55s69": ("nxp/lpcxpresso55s69/lpcxpresso55s69.dtsi", lpc55, True),
    "mcxn947": ("nxp/frdm_mcxn947/frdm_mcxn947.dtsi", mcxn, True),
    "mcxw71c": ("nxp/frdm_mcxw71/frdm_mcxw71.dts", mcxw, True),
    "rw612": ("nxp/frdm_rw612/frdm_rw612_common.dtsi", rw612, True),
    "m2354": ("nuvoton/numaker_m2354/user-manual", None, True),
    "pic32ck": ("microchip/pic32c/pic32ck_sg01_cult/pic32ck_sg01_cult.dts", pic32, False),
}
GPIO = r"&(gpio[0-9a-z]+|hsgpio[0-9]|port[a-z]) (\d+)"

# Uno R3 headers, pin 1 first, left to right as on the board.
D_HIGH = ["SCL", "SDA", "AREF", "GND", "D13", "D12", "D11", "D10", "D9", "D8"]
D_LOW = ["D7", "D6", "D5", "D4", "D3", "D2", "D1", "D0"]
POWER = ["NC", "IOREF", "RESET", "3V3", "5V", "GND", "GND", "VIN"]
ANALOG = ["A0", "A1", "A2", "A3", "A4", "A5"]
RAILS = {"GND": "GND", "3V3": "3V3", "5V": "5V", "IOREF": "3V3"}


def zfile(path):
    rel = path.split("/", 1)[1]
    return (ZSRC / rel).read_text(encoding="utf-8")


def node_body(text, compatible):
    """Body of the node with this compatible, up to its closing brace."""
    m = re.search(r'compatible = "%s";' % re.escape(compatible), text)
    if not m:
        return None
    depth, i = 1, m.end()
    while i < len(text) and depth:
        depth += {"{": 1, "}": -1}.get(text[i], 0)
        i += 1
    return text[m.end():i]


def arduino_map(text, name):
    body = node_body(text, "arduino-header-r3")
    if body is None:
        return {}
    out = {}
    for lab, ctrl, pin in re.findall(r"ARDUINO_HEADER_R3_([AD]\d+) 0 " + GPIO, body):
        out[lab] = name(ctrl, pin)
    # D14/D15 double as SDA/SCL on the D8-D15 header.
    if "D14" in out:
        out.setdefault("SDA", out["D14"])
    if "D15" in out:
        out.setdefault("SCL", out["D15"])
    return out


def leds_keys(text, name, compatible):
    body = node_body(text, compatible)
    if body is None:
        return []
    out = []
    for node in re.finditer(r"(\w+): [\w@-]+ \{(.*?)\};", body, re.S):
        gp = re.search(r"gpios = <" + GPIO + r" \(?([^>]*)>", node.group(2))
        if not gp:
            continue
        lab = re.search(r'label = "([^"]+)"', node.group(2))
        out.append((lab.group(1) if lab else node.group(1).replace("_", " "), name(gp.group(1), gp.group(2)),
                    "ACTIVE_LOW" not in gp.group(3)))
    return out


# NuMaker-M2354: no Zephyr board; NuMaker-M2354 User Manual Rev 1.00
# (cpu/m2354/UM_NuMaker-M2354_EN_Rev1.pdf in m33mu) Table 3-3 (NU1-NU4
# Arduino UNO mapping), Table 3-16 and the schematic (LEDG/LEDR from VCC
# through 330 R to PD.2/PD.3; SW2 to GND with R62 10 K pull-up on PF.11).
M2354_UM = "m33mu cpu/m2354/UM_NuMaker-M2354_EN_Rev1.pdf"
M2354_ARDUINO = {"D0": "PA8", "D1": "PA9", "D2": "PC1", "D3": "PC0", "D4": "PE7", "D5": "PE6", "D6": "PC12",
                 "D7": "PC11", "D8": "PC9", "D9": "PC10", "D10": "PA3", "D11": "PA0", "D12": "PA1", "D13": "PA2",
                 "SDA": "PG3", "SCL": "PG2", "A0": "PB11", "A1": "PB10", "A2": "PB9", "A3": "PB8", "A4": "PB7", "A5": "PB6"}
MANUAL = {"m2354": (M2354_ARDUINO, [("LEDG", "PD2", False), ("LEDR", "PD3", False)], [("SW2", "PF11", False)])}


def strip(cpu, base_layout, base_svg, cfg):
    path, name, has_header = cfg
    if cpu in MANUAL:
        ard, leds, keys = MANUAL[cpu]
    else:
        text = zfile(path)
        ard = arduino_map(text, name) if has_header else {}
        leds = leds_keys(text, name, "gpio-leds")
        keys = leds_keys(text, name, "gpio-keys")
    vb = base_layout["pixelViewbox"]
    W, H = vb[2], vb[3]
    top = H + 30
    rows_y = (top + 40, top + 40 + 3 * PITCH)
    x0 = 40.0
    layout = json.loads(json.dumps(base_layout))
    connectors = []
    svg = ['<g id="m33mu-arduino-strip">',
           f'<rect x="10" y="{H + 8:g}" width="{W - 20:g}" height="{150:g}" rx="10" fill="#1b2430" stroke="#5bc4ae" stroke-width="2"/>']
    origin = "NuMaker-M2354 UM Rev 1.00 Table 3-3" if cpu in MANUAL else f"{Path(path).parts[-2]} (Zephyr {REV[:12]})"
    caption = (f"Arduino R3 headers, LEDs and buttons: {origin}" if has_header else f"User LEDs and buttons: {origin}")
    svg.append(f'<text x="24" y="{H + 28:g}" font-family="sans-serif" font-size="14" fill="#cfe9e3">{caption}</text>')

    def header(cid, labels, x, y, desc):
        cs = []
        for n, lab in enumerate(labels, 1):
            pad = RAILS.get(lab) or ard.get(lab)
            note = None if pad else f"{lab}: not modelled on the bench" if lab in ("AREF", "RESET", "VIN", "NC") \
                else f"{lab}: not mapped in the board's Zephyr Arduino header"
            cx = x + (n - 1) * PITCH
            cs.append({"number": n, "contactId": f"{cid}-{n}", "x": round(cx, 2), "y": round(y, 2), "signal": lab,
                       "net": lab, **({"socPad": pad} if pad else {}), "mapping_verified": True,
                       "electricalEnabled": pad is not None, **({"note": note} if note else {})})
            svg.append(f'<rect x="{cx - 9:g}" y="{y - 9:g}" width="18" height="18" fill="#0b0d10" stroke="#3a4350"/>'
                       f'<text x="{cx:g}" y="{y + 24:g}" font-family="sans-serif" font-size="8" text-anchor="middle" fill="#9fb3c8">{lab}</text>')
        connectors.append({"id": cid, "kind": "arduino-female", "rows": 1, "columns": len(labels),
                           "description": desc, "geometryMeasured": False, "contacts": cs})

    if has_header:
        header("ARD_DHIGH", D_HIGH, x0, rows_y[0], "Arduino D8-D15 header (Uno R3)")
        header("ARD_DLOW", D_LOW, x0 + 10.6 * PITCH, rows_y[0], "Arduino D0-D7 header (Uno R3)")
        header("ARD_POWER", POWER, x0 + 3 * PITCH, rows_y[1], "Arduino power header (Uno R3)")
        header("ARD_ANALOG", ANALOG, x0 + 12 * PITCH, rows_y[1], "Arduino analog header (Uno R3)")
    lx = x0 + 20 * PITCH if has_header else x0
    out_leds, out_buttons = [], []
    for i, (label, pad, high) in enumerate(leds[:4]):
        x, y = lx + i * 50, rows_y[0] - 6
        low = label.lower()
        color = "#d62d2d" if "red" in low else "#2e86de" if "blue" in low else "#2fb34a"
        out_leds.append({"id": label, "pad": pad, "color": color, "x": x, "y": y, "w": 22, "h": 12, "activeHigh": high})
        svg.append(f'<rect x="{x:g}" y="{y:g}" width="22" height="12" rx="2" fill="#3a3d42"/>'
                   f'<text x="{x + 11:g}" y="{y + 28:g}" font-family="sans-serif" font-size="8" text-anchor="middle" fill="#9fb3c8">{label.replace("Green ", "")}</text>')
    for i, (label, pad, high) in enumerate(keys[:4]):
        x, y = lx + i * 50, rows_y[1] - 18
        out_buttons.append({"id": label, "pad": pad, "x": x, "y": y, "w": 36, "h": 36, "activeHigh": high})
        svg.append(f'<rect x="{x:g}" y="{y:g}" width="36" height="36" rx="6" fill="#d0d4da"/><circle cx="{x + 18:g}" cy="{y + 18:g}" r="11" fill="#202020"/>'
                   f'<text x="{x + 18:g}" y="{y + 50:g}" font-family="sans-serif" font-size="8" text-anchor="middle" fill="#9fb3c8">{label.replace("Push button", "BTN")}</text>')
    svg.append("</g>")
    for conn in layout["connectors"]:
        for c in conn["contacts"]:
            c["electricalEnabled"] = False
    layout["connectors"] += connectors
    layout["pixelViewbox"] = [vb[0], vb[1], W, H + 170]
    layout["leds"] = out_leds
    layout["buttons"] = out_buttons
    layout["electricalMapStatus"] = f"Arduino R3 strip, LEDs and buttons from {origin}; sprite connectors visual-only"
    layout["generator"] = "scripts/gen-arduino-boards.py"
    out_svg = re.sub(r'viewBox="0 0 ([0-9.]+) ([0-9.]+)"', f'viewBox="0 0 {W:g} {H + 170:g}"', base_svg, count=1)
    out_svg = re.sub(r'height="[0-9.]+"', f'height="{H + 170:g}"', out_svg, count=1)
    out_svg = out_svg.replace("</svg>", "\n".join(svg) + "\n</svg>")
    pins = {"schemaVersion": 1, "boardId": base_layout["boardName"], "cpu": cpu, "electricalMapStatus": "verified",
            "sources": [{"kind": "manufacturer-user-manual", "url": M2354_UM,
                         "evidence": "Table 3-3 Arduino UNO Extension Connectors and M2354KJFAE Mapping GPIO List; "
                                     "Table 3-16 LEDs and schematic LEDG/LEDR, SW2 nets"}] if cpu in MANUAL else
                        [{"kind": "zephyr-board-definition",
                         "url": f"https://github.com/zephyrproject-rtos/zephyr/blob/{REV}/boards/{path}",
                         "evidence": "arduino-header-r3 gpio-map, gpio-leds and gpio-keys nodes"}],
            "review": {"reviewer": "Claude (m33mu-lab session)", "reviewedAt": "2026-10-25",
                       "note": "Generated by scripts/gen-arduino-boards.py; header positions are schematic."},
            "contacts": [{"connectorId": k["id"], "physicalPadNumber": c["number"], "net": c["net"],
                          "socPad": c.get("socPad"), "signalMappingVerified": c["electricalEnabled"],
                          "electricalEnabled": c["electricalEnabled"], **({"note": c["note"]} if "note" in c else {})}
                         for k in connectors for c in k["contacts"]]}
    return layout, out_svg, pins


def main():
    pack = zipfile.ZipFile(sys.argv[1])
    for cpu, cfg in BOARDS.items():
        base_layout = json.loads(pack.read(f"layout/{cpu}.json"))
        base_svg = pack.read(f"svg/{cpu}.svg").decode("utf-8")
        layout, svg, pins = strip(cpu, base_layout, base_svg, cfg)
        (ROOT / "public/boards/layout" / f"{cpu}.json").write_text(json.dumps(layout, indent=2) + "\n", encoding="utf-8")
        (ROOT / "public/boards/svg" / f"{cpu}.svg").write_text(svg, encoding="utf-8")
        (ROOT / "boards" / f"{cpu}-pins.json").write_text(json.dumps(pins, indent=1) + "\n", encoding="utf-8")
        n = sum(c["electricalEnabled"] for k in layout["connectors"] for c in k["contacts"])
        print(f"{cpu}: {n} header contacts electrical, {len(layout['leds'])} LEDs, {len(layout['buttons'])} buttons")


if __name__ == "__main__":
    main()
