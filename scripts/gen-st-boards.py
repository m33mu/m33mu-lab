#!/usr/bin/env python3
"""Generate artwork, layouts and pin maps for the other ST Nucleo boards.

Pin identities come from Zephyr's board definitions (Apache-2.0), fetched
into boards/sources/zephyr/ by scripts/fetch-zephyr-boards.sh:

* NUCLEO-L552ZE-Q: Arduino R3 map (arduino_r3_connector.dtsi).
* NUCLEO-N657X0-Q: Arduino Uno V3 and ST morpho headers from UM3417 Rev 1
  Tables 11-13 (this board has no Zio connectors).
* STM32U585 on NUCLEO-U575ZI-Q (U575/U585 are pin compatible): every Zio
  GPIO contact from st_zio_connector.dtsi (UM2861 Rev 10 Tables 15-18), plus
  the Arduino map.
* NUCLEO-H533RE (Nucleo-64): ST morpho GPIO contacts (st_morpho_connector.dtsi)
  and the Arduino R3 headers.

Nucleo-144 boards share the Zio/morpho geometry measured for the H563
(scripts/gen-h563-board.py, UM3115 Fig. 6) and the standard Zio power pin
positions; an Arduino label's Zio position is the one the U575 Zio table
annotates. Contacts a source does not list stay visual-only with that reason.
The Nucleo-64 drawing places the morpho and Arduino headers on the standard
2.54 mm grid; its geometry is illustrative.

Usage: scripts/gen-st-boards.py
"""
import importlib.util
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ZSRC = ROOT / "boards" / "sources" / "zephyr"
ZURL = f"https://github.com/zephyrproject-rtos/zephyr/blob/{(ROOT / 'boards/sources/zephyr/REVISION').read_text().strip()}/boards/st/"

spec = importlib.util.spec_from_file_location("h563", ROOT / "scripts" / "gen-h563-board.py")
h563 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h563)
PX, PITCH = h563.PX, h563.PITCH
POWER = {"GND", "AGND", "3V3", "5V", "IOREF", "AVDD", "VDD", "VREFP", "NRST", "VIN", "NC"}
RAIL_ALIAS = {"GND": "GND", "AGND": "GND", "3V3": "3V3", "IOREF": "3V3", "AVDD": "3V3", "5V": "5V"}

GPIO_RE = r"&gpio([a-z]) (\d+) "


def pad(port, pin):
    return f"P{port.upper()}{int(pin)}"


def zephyr(path):
    return (ZSRC / path).read_text(encoding="utf-8")


def arduino_map(path):
    """{'A0': 'PA3', ..., 'D15': 'PB8'} from an arduino_r3_connector.dtsi."""
    return {m[0]: pad(m[1], m[2]) for m in
            re.findall(r"ARDUINO_HEADER_R3_([AD]\d+) 0 " + GPIO_RE, zephyr(path))}


def zio_map(path):
    """({(cn, pin): pad}, {label: (cn, pin)}) from an st_zio_connector.dtsi."""
    pads, labels = {}, {}
    for line in zephyr(path).splitlines():
        m = re.search(r"ST_ZIO_CN(\d+)_(\d+) 0 " + GPIO_RE, line)
        if not m:
            continue
        key = (f"CN{m[1]}", int(m[2]))
        pads[key] = pad(m[3], m[4])
        lab = re.search(r"/\*\s*([AD]\d+)", line)
        if lab:
            labels.setdefault(lab[1], key)
    return pads, labels


def morpho_map(path):
    out = {}
    for side, n, port, pin in re.findall(r"ST_MORPHO_([LR])_(\d+) 0 " + GPIO_RE, zephyr(path)):
        out[("CN7" if side == "L" else "CN10", int(n))] = pad(port, pin)
    return out


# Standard Zio positions of the A0-A5 analog inputs (CN9 odd pins).
ZIO_ANALOG = {f"A{i}": ("CN9", 1 + 2 * i) for i in range(6)}
ZIO_PADS, ZIO_LABELS = zio_map("nucleo_u575zi_q/st_zio_connector.dtsi")
ZIO_LABELS.update(ZIO_ANALOG)
# Power/ground pins of the Zio connectors, identical on every Nucleo-144.
ZIO_POWER = {(cid, n): net for cid, nets in h563.ZIO.items() for n, net in enumerate(nets, 1) if net in POWER}

N144 = {
    "stm32l552": dict(name="NUCLEO-L552ZE-Q", rev="MB1361", zephyr="nucleo_l552ze_q",
                      arduino="nucleo_l552ze_q/arduino_r3_connector.dtsi", zio=None,
                      leds=[("LD1", "PC7", "#2fb34a", True), ("LD2", "PB7", "#2e86de", True), ("LD3", "PA9", "#d62d2d", True)],
                      button=("B1", "PC13")),
    "stm32u585": dict(name="NUCLEO-U575ZI-Q with STM32U585", rev="MB1549 (U575ZI-Q; U585 pin compatible)",
                      zephyr="nucleo_u575zi_q", arduino="nucleo_u575zi_q/arduino_r3_connector.dtsi", zio=True,
                      leds=[("LD1", "PC7", "#2fb34a", True), ("LD2", "PB7", "#2e86de", True), ("LD3", "PG2", "#d62d2d", True)],
                      button=("B1", "PC13")),
}


def nucleo144_nets(cfg):
    """{(cid, n): (net, enabled, note)} for Zio and morpho contacts."""
    ard = arduino_map(cfg["arduino"])
    out = {}
    for (cid, n), net in ZIO_POWER.items():
        rail = RAIL_ALIAS.get(net)
        out[(cid, n)] = (rail or net, rail is not None,
                         None if rail == net else (f"{net} (board {rail} net)" if rail else f"{net}: not modelled on the bench"))
    if cfg["zio"]:
        for key, p in ZIO_PADS.items():
            out[key] = (p, True, None)
    for label, p in ard.items():
        key = ZIO_LABELS.get(label)
        if key:
            out[key] = (p, True, f"Arduino {label}")
    return out


def build_nucleo144(cpu, cfg):
    nets = nucleo144_nets(cfg)
    src = f"{ZURL}{cfg['zephyr']}"
    what = "Zio GPIO contacts and Arduino R3 map" if cfg["zio"] else "Arduino R3 map"
    connectors = []
    for cid, kind, rows, x1, y1, measured, desc in h563.CONNECTORS:
        contacts = []
        for n in range(1, rows * 2 + 1):
            row, col = (n - 1) // 2, (n - 1) % 2
            net, enabled, note = nets.get((cid, n), (None, False, None))
            if net is None:
                note = ("ST morpho pin: no public pin map for this board in the sources used" if cid in ("CN11", "CN12")
                        else "Zio pin not listed in the board's Zephyr pin map")
            contacts.append({
                "number": n, "contactId": f"{cid}-{n}",
                "x": round((x1 + col * PITCH) * PX, 2), "y": round((y1 + row * PITCH) * PX, 2),
                "signal": net if enabled else None, "net": net, "mapping_verified": enabled,
                "artworkAnchorVerified": measured, "electricalEnabled": enabled,
                **({"note": note} if note else {})})
        connectors.append({"id": cid, "kind": kind, "rows": rows, "columns": 2, "description": desc,
                           "geometryMeasured": measured, "contacts": contacts})
    layout = {
        "schemaVersion": 1, "cpu": cpu, "boardName": cfg["name"], "boardRevision": cfg["rev"],
        "boardFamily": "nucleo144", "manufacturer": "STMicroelectronics", "manufacturerBoardVerified": True,
        "manufacturerSource": src, "artwork": f"../svg/{cpu}.svg", "pixelViewbox": [0, 0, h563.W * PX, h563.H * PX],
        "pixelsPerMm": PX, "pinLabelArtwork": False,
        "geometryStatus": "Nucleo-144 outline and Zio/morpho grid as measured for MB1404 (UM3115 Fig. 6); other features illustrative",
        "electricalMapStatus": f"verified from Zephyr {cfg['zephyr']} ({what}); other contacts visual-only",
        "warning": "Only contacts marked electricalEnabled can be wired; the others are visual locators.",
        "electricalEnabledByDefault": False, "generator": "scripts/gen-st-boards.py",
        "leds": [{"id": i, "pad": p, "color": c, "x": 290 + k * 40, "y": 1000, "w": 16, "h": 10, "activeHigh": hi}
                 for k, (i, p, c, hi) in enumerate(cfg["leds"])],
        "buttons": [{"id": cfg["button"][0], "pad": cfg["button"][1], "x": 165, "y": 1060, "w": 70, "h": 70, "activeHigh": True}],
        "connectors": connectors,
    }
    return layout, nucleo144_svg(cfg, connectors)


def nucleo144_svg(cfg, connectors):
    w, h = h563.W * PX, h563.H * PX
    s = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:g} {h:g}" width="{w:g}" height="{h:g}">',
         f'<title>{cfg["name"]} ({cfg["rev"]}), top view, original m33mu illustration</title>',
         '<defs><radialGradient id="hole"><stop offset="0" stop-color="#050505"/><stop offset="1" stop-color="#2a2a2a"/></radialGradient></defs>',
         f'<rect x="1" y="1" width="{w-2:g}" height="{h-2:g}" rx="18" fill="#eef1f6" stroke="#9aa6b8" stroke-width="2"/>',
         '<rect x="150" y="0" width="400" height="230" fill="#e4e8f0"/>',
         '<line x1="20" y1="232" x2="680" y2="232" stroke="#2b5cab" stroke-width="2" stroke-dasharray="10 6"/>',
         '<rect x="305" y="0" width="90" height="70" rx="8" fill="#b8bec8" stroke="#6c7480" stroke-width="2"/>',
         '<rect x="300" y="110" width="100" height="100" fill="#1f2328"/>',
         '<g transform="translate(350 640) rotate(45)"><rect x="-100" y="-100" width="200" height="200" fill="#202428"/>'
         '<circle cx="-80" cy="-80" r="6" fill="#3a3f45"/></g>']
    for cx, fill in ((200, "#3b73c8"), (500, "#202020")):
        s.append(f'<rect x="{cx-35}" y="1060" width="70" height="70" rx="8" fill="#d0d4da"/><circle cx="{cx}" cy="1095" r="22" fill="{fill}"/>')
    for i, (name, *_rest) in enumerate(cfg["leds"]):
        s.append(f'<rect x="{290 + i * 40}" y="1000" width="16" height="10" fill="#3a3d42"/>')
        s.append(f'<text x="{298 + i * 40}" y="994" font-family="sans-serif" font-size="10" text-anchor="middle" fill="#2b5cab">{name}</text>')
    for conn in connectors:
        cs = conn["contacts"]
        x0, y0 = cs[0]["x"] - PITCH * PX / 2, cs[0]["y"] - PITCH * PX / 2
        cw, ch = 2 * PITCH * PX, conn["rows"] * PITCH * PX
        if conn["kind"] == "zio-female":
            s.append(f'<rect x="{x0-2:g}" y="{y0-2:g}" width="{cw+4:g}" height="{ch+4:g}" rx="2" fill="#16181b"/>')
            left = x0 + cw / 2 < w / 2
            s.append(f'<text x="{x0 + cw + 6 if left else x0 - 6:g}" y="{y0 + 12:g}" font-family="sans-serif" font-size="16" '
                     f'text-anchor="{"start" if left else "end"}" fill="#2b5cab">{conn["id"]}</text>')
            s += [f'<rect x="{c["x"]-8:g}" y="{c["y"]-8:g}" width="16" height="16" fill="url(#hole)"/>' for c in cs]
        else:
            s.append(f'<text x="{x0 + cw / 2:g}" y="{y0 - 8:g}" font-family="sans-serif" font-size="16" text-anchor="middle" fill="#2b5cab">{conn["id"]}</text>')
            for c in cs:
                s.append(f'<circle cx="{c["x"]:g}" cy="{c["y"]:g}" r="9" fill="#c99a3b"/><circle cx="{c["x"]:g}" cy="{c["y"]:g}" r="4.5" fill="#1a1a1a"/>')
    s.append(f'<text x="350" y="1045" font-family="sans-serif" font-size="18" text-anchor="middle" fill="#2b5cab">{cfg["rev"].split()[0]}</text>')
    s.append('</svg>')
    return "\n".join(s) + "\n"


# ---------------------------------------------------------------- Nucleo-64

N64_W, N64_H = 70.0, 82.5
# Arduino Uno R3 header order (pin 1 first) and standard power header.
ARD_POWER = ["NC", "IOREF", "NRST", "3V3", "5V", "GND", "GND", "VIN"]
ARD_ANALOG = [f"A{i}" for i in range(6)]
ARD_DLOW = [f"D{i}" for i in range(8)]
ARD_DHIGH = ["D8", "D9", "D10", "D11", "D12", "D13", "GND", "AREF", "D14", "D15"]


def build_h533():
    ard = arduino_map("nucleo_h533re/arduino_r3_connector.dtsi")
    morpho = morpho_map("nucleo_h533re/st_morpho_connector.dtsi")
    connectors = []

    def single(cid, labels, x, y1, desc):
        cs = []
        for n, lab in enumerate(labels, 1):
            p = ard.get(lab) or RAIL_ALIAS.get(lab)
            note = (f"Arduino {lab}" if lab in ard else None) if p else f"{lab}: not modelled on the bench"
            cs.append({"number": n, "contactId": f"{cid}-{n}", "x": round(x * PX, 2), "y": round((y1 + (n - 1) * PITCH) * PX, 2),
                       "signal": p, "net": p or lab, "mapping_verified": p is not None, "artworkAnchorVerified": False,
                       "electricalEnabled": p is not None, **({"note": note} if note else {})})
        connectors.append({"id": cid, "kind": "arduino-female", "rows": len(labels), "columns": 1,
                           "description": desc, "geometryMeasured": False, "contacts": cs})

    for cid, x in (("CN7", 3.2), ("CN10", 64.3)):
        cs = []
        for n in range(1, 39):
            row, col = (n - 1) // 2, (n - 1) % 2
            p = morpho.get((cid, n))
            cs.append({"number": n, "contactId": f"{cid}-{n}", "x": round((x + col * PITCH) * PX, 2),
                       "y": round((12.0 + row * PITCH) * PX, 2), "signal": p, "net": p, "mapping_verified": p is not None,
                       "artworkAnchorVerified": False, "electricalEnabled": p is not None,
                       **({} if p else {"note": "morpho pin not listed in the Zephyr NUCLEO-H533RE morpho map (power, debug or NC)"})})
        connectors.append({"id": cid, "kind": "morpho-male", "rows": 19, "columns": 2,
                           "description": "ST morpho, 2x19", "geometryMeasured": False, "contacts": cs})
    # Arduino headers inside the morpho rows, Uno R3 order top to bottom.
    single("CN5", ARD_DHIGH[::-1], 56.0, 12.0, "Arduino D8-D15, GND, AREF (Uno R3)")
    single("CN9", ARD_DLOW[::-1], 56.0, 41.5, "Arduino D0-D7 (Uno R3)")
    single("CN6", ARD_POWER, 14.0, 22.0, "Arduino power (Uno R3)")
    single("CN8", ARD_ANALOG, 14.0, 45.0, "Arduino A0-A5 (Uno R3)")
    w, h = N64_W * PX, N64_H * PX
    s = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:g} {h:g}" width="{w:g}" height="{h:g}">',
         '<title>NUCLEO-H533RE (Nucleo-64), top view, original m33mu illustration</title>',
         f'<rect x="1" y="1" width="{w-2:g}" height="{h-2:g}" rx="16" fill="#eef1f6" stroke="#9aa6b8" stroke-width="2"/>',
         '<rect x="290" y="0" width="120" height="60" rx="8" fill="#b8bec8" stroke="#6c7480" stroke-width="2"/>',
         '<rect x="300" y="80" width="90" height="70" fill="#1f2328"/>',
         '<g transform="translate(350 520) rotate(45)"><rect x="-70" y="-70" width="140" height="140" fill="#202428"/></g>',
         '<rect x="200" y="690" width="70" height="70" rx="8" fill="#d0d4da"/><circle cx="235" cy="725" r="22" fill="#3b73c8"/>',
         '<rect x="440" y="690" width="70" height="70" rx="8" fill="#d0d4da"/><circle cx="475" cy="725" r="22" fill="#202020"/>',
         '<rect x="330" y="300" width="16" height="10" fill="#3a3d42"/>',
         '<text x="338" y="294" font-family="sans-serif" font-size="10" text-anchor="middle" fill="#2b5cab">LD2</text>',
         '<text x="350" y="800" font-family="sans-serif" font-size="18" text-anchor="middle" fill="#2b5cab">NUCLEO-H533RE</text>']
    for conn in connectors:
        cs = conn["contacts"]
        for c in cs:
            if conn["kind"] == "morpho-male":
                s.append(f'<circle cx="{c["x"]:g}" cy="{c["y"]:g}" r="9" fill="#c99a3b"/><circle cx="{c["x"]:g}" cy="{c["y"]:g}" r="4.5" fill="#1a1a1a"/>')
            else:
                s.append(f'<rect x="{c["x"]-11:g}" y="{c["y"]-13:g}" width="22" height="26" fill="#16181b"/>'
                         f'<rect x="{c["x"]-6:g}" y="{c["y"]-6:g}" width="12" height="12" fill="#3a3d42"/>')
        s.append(f'<text x="{cs[0]["x"]:g}" y="{cs[0]["y"] - 22:g}" font-family="sans-serif" font-size="14" text-anchor="middle" fill="#2b5cab">{conn["id"]}</text>')
    s.append('</svg>')
    layout = {
        "schemaVersion": 1, "cpu": "stm32h533", "boardName": "NUCLEO-H533RE", "boardRevision": "Nucleo-64",
        "boardFamily": "nucleo64", "manufacturer": "STMicroelectronics", "manufacturerBoardVerified": True,
        "manufacturerSource": f"{ZURL}nucleo_h533re", "artwork": "../svg/stm32h533.svg", "pixelViewbox": [0, 0, w, h],
        "pixelsPerMm": PX, "pinLabelArtwork": False,
        "geometryStatus": "illustrative: morpho and Arduino headers on the 2.54 mm grid, positions approximate",
        "electricalMapStatus": "verified from Zephyr nucleo_h533re (morpho GPIOs and Arduino R3 map); other contacts visual-only",
        "warning": "Only contacts marked electricalEnabled can be wired; the others are visual locators.",
        "electricalEnabledByDefault": False, "generator": "scripts/gen-st-boards.py",
        "leds": [{"id": "LD2", "pad": "PA5", "color": "#2fb34a", "x": 330, "y": 300, "w": 16, "h": 10, "activeHigh": True}],
        "buttons": [{"id": "B1", "pad": "PC13", "x": 200, "y": 690, "w": 70, "h": 70, "activeHigh": True}],
        "connectors": connectors,
    }
    return layout, "\n".join(s) + "\n"


# ---------------------------------------------------- NUCLEO-N657X0-Q (MB1940)

# UM3417 Rev 1 (January 2025) Table 11 (Arduino Uno V3) and Tables 12-13
# (ST morpho). This board has Arduino headers and ST morpho, not Zio.
# Analog header pins drive a 3.3 V digital I/O directly and a 1.8 V ADC input
# through an amplifier (Figure 14); the bench node is the digital pad.
N657_ARDUINO = {
    "CN5": ["5V_IN", "IOREF", "NRST", "3V3", "5V", "GND", "GND", "VIN"],
    "CN4": ["PF5", "PC10", "PF6", "PA2", "PC12", "PH2"],
    "CN13": ["PD9", "PD8", "PD0", "PE9", "PE0", "PE10", "PD5", "PE11"],
    "CN14": ["PD12", "PD7", "PA3", "PG2", "PG1", "PE15", "GND", "AREF", "PC1", "PH9"],
}
N657_ARD_LABEL = {
    "CN4": [f"A{i}" for i in range(6)], "CN13": [f"D{i}" for i in range(8)],
    "CN14": ["D8", "D9", "D10", "D11", "D12", "D13", None, None, "D14", "D15"],
}
N657_ADC = {"PF5": "PA8", "PC10": "PA9", "PF6": "PA10", "PA2": "PA12", "PC12": "PF3", "PH2": "PG15"}
# Odd pins then even pins, 1..N; "NC/PBx" pins are disconnected by default.
N657_MORPHO = {
    "CN3": ["NC", "OTG1_HSDM_CON", "PC2", "OTG1_HSDP_CON", "VDDIO", "5V", "BOOT0", "GND", "PH0", "VDDIO4",
            "PH1", "IOREF", "PC4", "NRST", "PC5", "3V3", "PC0", "5V", "GND", "GND", "PE4", "GND", "PC13", "VIN",
            "PC3", "PH4", "PC15", "PF5", "PC14", "PC10", "VDDIO5", "PF6", "VBAT", "PA2", "BOOT1", "PC12",
            "PC8", "PH2"],
    "CN15": ["PE12", "PE6", "PH9", "PE5", "PC1", "PD6", "VREFP", "5V_STLK", "GND", "PB2", "PE15", "NC/PB3",
             "PG1", "PB8", "PG2", "PB9", "PA3", "PB14", "PD7", "GND", "PD12", "PE7", "PE11", "PE1", "PD5", "PE14",
             "PE10", "PE13", "PE0", "PE2", "PE9", "AGND", "PD0", "PD10", "PD8", "PD11", "PD9", "PA1"],
    "CN2": ["PF8", "NC/PB1", "PG7", "PF2", "NC", "PF1", "NC", "PF0", "NC", "PF9", "GND", "PH5", "PG5", "NC",
            "NC", "NC/PB13", "PG14", "PG4", "NC", "PG6", "NC/PG12", "GND", "PG3", "NC/PG9", "PC9", "PB15",
            "PC11", "PC6", "PH8", "PH7", "NC", "PH3"],
    "CN16": ["GND", "PP1", "PP0", "PP2", "PO0", "PP3", "PO1", "PP4", "PO2", "PP5", "PO3", "PP6", "PO4", "PP7",
             "PE8", "GND", "NC", "PP8", "PD13", "PP9", "PA4", "PP10", "PD15", "PP11", "GND", "PP12", "PD3",
             "PP13", "PG13", "PP14", "PN12", "PP15"],
}
N657_UNSOLDERED = {"CN2", "CN16"}
UM3417 = "UM3417 Rev 1"


def n657_contact(cid, n, name, x, y, label=None):
    if name in RAIL_ALIAS:
        net, enabled = RAIL_ALIAS[name], True
        note = None if net == name else f"{name} (board {net} net)"
    elif re.fullmatch(r"P[A-Q]\d+", name):
        net, enabled = name, cid not in N657_UNSOLDERED
        note = (f"Arduino {label}" if label else None)
        if name in N657_ADC and cid == "CN4":
            note = f"Arduino {label}; also {N657_ADC[name]} (1.8 V ADC) through an amplifier, not modelled"
        if not enabled:
            note = f"{cid} is not soldered by default ({UM3417} section 8.2)"
    else:
        net, enabled = name, False
        note = (f"{name}: disconnected by default ({UM3417} Table 13 note 1)" if name.startswith("NC/")
                else f"{name}: not modelled on the bench")
    return {"number": n, "contactId": f"{cid}-{n}", "x": round(x * PX, 2), "y": round(y * PX, 2),
            "signal": net if enabled else None, "net": net, "mapping_verified": True,
            "artworkAnchorVerified": False, "electricalEnabled": enabled, **({"note": note} if note else {})}


def build_n657():
    connectors = []
    for cid, x, y1 in (("CN3", 3.16, 12.0), ("CN2", 3.16, 64.0), ("CN15", 64.28, 12.0), ("CN16", 64.28, 64.0)):
        names = N657_MORPHO[cid]
        cs = [n657_contact(cid, n, name, x + ((n - 1) % 2) * PITCH, y1 + ((n - 1) // 2) * PITCH)
              for n, name in enumerate(names, 1)]
        unsoldered = cid in N657_UNSOLDERED
        connectors.append({"id": cid, "kind": "morpho-male-unpopulated" if unsoldered else "morpho-male",
                           "rows": len(names) // 2, "columns": 2,
                           "description": f"ST morpho, 2x{len(names) // 2}" + (", not soldered by default" if unsoldered else ""),
                           "geometryMeasured": False, "contacts": cs})
    for cid, x, y1, desc in (("CN5", 14.0, 22.0, "Arduino power (Uno V3)"), ("CN4", 14.0, 45.0, "Arduino A0-A5 (Uno V3)"),
                             ("CN14", 56.0, 12.0, "Arduino D8-D15, GND, AREF (Uno V3)"),
                             ("CN13", 56.0, 41.5, "Arduino D0-D7 (Uno V3)")):
        names = N657_ARDUINO[cid]
        labels = N657_ARD_LABEL.get(cid, [None] * len(names))
        cs = [n657_contact(cid, n, name, x, y1 + (n - 1) * PITCH, labels[n - 1]) for n, name in enumerate(names, 1)]
        connectors.append({"id": cid, "kind": "arduino-female", "rows": len(names), "columns": 1, "description": desc,
                           "geometryMeasured": False, "contacts": cs})
    cfg = dict(name="NUCLEO-N657X0-Q", rev="MB1940",
               leds=[("LD6", "PG0", "#2fb34a", False), ("LD7", "PG8", "#2e86de", False), ("LD5", "PG10", "#d62d2d", False)],
               button=("B1", "PC13"))
    layout = {
        "schemaVersion": 1, "cpu": "stm32n657", "boardName": cfg["name"], "boardRevision": "MB1940",
        "boardFamily": "nucleo144", "manufacturer": "STMicroelectronics", "manufacturerBoardVerified": True,
        "manufacturerSource": "https://www.st.com/resource/en/user_manual/um3417-stm32n6-nucleo144-board-mb1940-stmicroelectronics.pdf",
        "artwork": "../svg/stm32n657.svg", "pixelViewbox": [0, 0, h563.W * PX, h563.H * PX],
        "pixelsPerMm": PX, "pinLabelArtwork": False,
        "geometryStatus": "illustrative: Nucleo-144 outline, morpho and Arduino headers on the 2.54 mm grid, positions approximate",
        "electricalMapStatus": f"verified from {UM3417} Tables 11-13 (Arduino Uno V3 and ST morpho); CN2/CN16 not soldered by default",
        "warning": "Only contacts marked electricalEnabled can be wired; the others are visual locators.",
        "electricalEnabledByDefault": False, "generator": "scripts/gen-st-boards.py",
        "leds": [{"id": i, "pad": p, "color": c, "x": 290 + k * 40, "y": 1000, "w": 16, "h": 10, "activeHigh": hi}
                 for k, (i, p, c, hi) in enumerate(cfg["leds"])],
        "buttons": [{"id": "B1", "pad": "PC13", "x": 165, "y": 1060, "w": 70, "h": 70, "activeHigh": True}],
        "connectors": connectors,
    }
    return layout, n657_svg(cfg, connectors)


def n657_svg(cfg, connectors):
    svg = nucleo144_svg(cfg, []).replace("</svg>\n", "")
    s = [svg]
    for conn in connectors:
        cs = conn["contacts"]
        for c in cs:
            if conn["kind"].startswith("morpho"):
                fill = "#c99a3b" if conn["kind"] == "morpho-male" else "#d8c7a0"
                s.append(f'<circle cx="{c["x"]:g}" cy="{c["y"]:g}" r="9" fill="{fill}"/><circle cx="{c["x"]:g}" cy="{c["y"]:g}" r="4.5" fill="#1a1a1a"/>')
            else:
                s.append(f'<rect x="{c["x"]-11:g}" y="{c["y"]-13:g}" width="22" height="26" fill="#16181b"/>'
                         f'<rect x="{c["x"]-6:g}" y="{c["y"]-6:g}" width="12" height="12" fill="#3a3d42"/>')
        s.append(f'<text x="{cs[0]["x"]:g}" y="{cs[0]["y"] - 22:g}" font-family="sans-serif" font-size="14" text-anchor="middle" fill="#2b5cab">{conn["id"]}</text>')
    s.append("</svg>")
    return "\n".join(s) + "\n"


def pins_doc(cpu, layout, sources):
    return {"schemaVersion": 1, "boardId": layout["boardName"], "cpu": cpu, "boardRevision": layout["boardRevision"],
            "electricalMapStatus": "verified", "sources": sources,
            "review": {"reviewer": "Claude (m33mu-lab session)", "reviewedAt": "2026-10-25",
                       "note": "Generated by scripts/gen-st-boards.py from the Zephyr board files in boards/sources/zephyr."},
            "contacts": [{"connectorId": k["id"], "physicalPadNumber": c["number"], "net": c["net"],
                          "socPad": c["signal"], "signalMappingVerified": c["mapping_verified"],
                          "electricalEnabled": c["electricalEnabled"], **({"note": c["note"]} if "note" in c else {})}
                         for k in layout["connectors"] for c in k["contacts"]]}


def main():
    base = ROOT / "public" / "boards"
    boards = {cpu: build_nucleo144(cpu, cfg) for cpu, cfg in N144.items()}
    boards["stm32h533"] = build_h533()
    boards["stm32n657"] = build_n657()
    for cpu, (layout, svg) in boards.items():
        (base / "svg" / f"{cpu}.svg").write_text(svg, encoding="utf-8")
        (base / "layout" / f"{cpu}.json").write_text(json.dumps(layout, indent=2) + "\n", encoding="utf-8")
        if cpu == "stm32n657":
            sources = [{"kind": "manufacturer-user-manual", "url": layout["manufacturerSource"],
                        "evidence": f"{UM3417} Table 11 (Arduino Uno V3), Tables 12-13 (ST morpho CN3/CN15, CN2/CN16)"}]
        else:
            zdir = N144[cpu]["zephyr"] if cpu in N144 else "nucleo_h533re"
            sources = [{"kind": "zephyr-board-definition", "url": f"{ZURL}{zdir}",
                        "evidence": "gpio-map of the Arduino R3 / ST Zio / ST morpho connector nodes"}]
        if cpu == "stm32u585":
            sources.append({"kind": "zephyr-board-definition", "url": f"{ZURL}nucleo_u575zi_q/st_zio_connector.dtsi",
                            "evidence": "Pinout taken from UM2861 (Rev 10) Tables 15-18 (per the file)"})
        (ROOT / "boards" / f"{cpu}-pins.json").write_text(json.dumps(pins_doc(cpu, layout, sources), indent=1) + "\n", encoding="utf-8")
        n = sum(c["electricalEnabled"] for k in layout["connectors"] for c in k["contacts"])
        t = sum(len(k["contacts"]) for k in layout["connectors"])
        print(f"{cpu}: {layout['boardName']}: {n} of {t} contacts electrical")


if __name__ == "__main__":
    main()
