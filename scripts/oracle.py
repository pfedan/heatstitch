"""Reads the files tests/oracle.test.ts wrote to oracle/ with pystitch (Ink/Stitch's fork of
pyembroidery; pyembroidery itself also works) and checks them against what heatstitch meant to
write: the same stitches, color changes and (where the format stores them) cuts and exact colors.
It is an independent reader, so a writer bug that heatstitch's own reader would mirror still shows.

    pip install pystitch==1.0.1
    ORACLE=1 npx vitest run tests/oracle.test.ts && python3 scripts/oracle.py
"""
import json
import sys
from pathlib import Path

try:
    import pystitch as pe
except ImportError:
    import pyembroidery as pe

OUT = Path(__file__).resolve().parent.parent / "oracle"
FORMATS = ["pes", "dst", "jef", "vp3", "exp", "xxx", "pec"]
# Formats with a cut command (JEF and DST cut by jump length, so their counts differ by design).
CUTS = {"pes", "pec", "exp", "xxx"}
# Formats that keep exact RGB.
EXACT_COLORS = {"vp3", "xxx"}
# Formats that store a palette slot per color.
PALETTES = {"pes", "pec", "jef"}


def read(path):
    p = pe.read(str(path))
    if p is None:
        raise ValueError("pyembroidery could not read it")
    stitches, cuts, changes = [], 0, 0
    for x, y, cmd in p.stitches:
        c = cmd & pe.COMMAND_MASK
        if c == pe.STITCH:
            stitches.append((round(x), round(y)))
        elif c == pe.TRIM:
            cuts += 1
        elif c == pe.COLOR_CHANGE:
            changes += 1
    colors = [[t.get_red(), t.get_green(), t.get_blue()] for t in p.threadlist]
    return stitches, cuts, changes, colors


def relative(s):
    return [(x - s[0][0], y - s[0][1]) for x, y in s] if s else s


def check(name, fmt, meant):
    stitches, cuts, changes, colors = read(OUT / f"{name}.{fmt}")
    want = [tuple(s) for s in meant["stitches"]]
    problems = []
    if fmt in ("jef", "xxx"):
        # JEF and XXX split stitches longer than 12.7 and 12.3 mm into equal ones: every meant stitch must be there.
        have = set(relative(stitches))
        missing = [s for s in relative(want) if s not in have]
        if missing:
            problems.append(f"{len(missing)} stitches missing, first {missing[0]}")
    elif relative(stitches) != relative(want):
        first = next((k for k, (a, b) in enumerate(zip(relative(stitches), relative(want))) if a != b), min(len(stitches), len(want)))
        problems.append(f"stitches differ from #{first} ({len(stitches)} read, {len(want)} meant)")
    if changes != meant["colorChanges"]:
        problems.append(f"{changes} color changes, meant {meant['colorChanges']}")
    if fmt in CUTS and cuts != meant["trims"]:
        problems.append(f"{cuts} cuts, meant {meant['trims']}")
    if fmt in EXACT_COLORS and colors != meant["colors"]:
        problems.append(f"colors {colors}, meant {meant['colors']}")
    if fmt in PALETTES and len(meant["colors"]) == len(colors):
        # Palette formats round colors, but different threads must stay different.
        m = meant["colors"]
        n = len(m)
        if any(m[i] != m[j] and colors[i] == colors[j] for i in range(n) for j in range(i)):
            problems.append(f"colors {colors} do not tell apart {meant['colors']}")
    return problems


def main():
    metas = sorted(OUT.glob("*.json"))
    if not metas:
        sys.exit("oracle/ is empty: run ORACLE=1 npx vitest run tests/oracle.test.ts first")
    failed = 0
    for meta in metas:
        meant = json.loads(meta.read_text())
        for fmt in FORMATS:
            try:
                problems = check(meta.stem, fmt, meant)
            except Exception as e:  # noqa: BLE001 - any reader error is a finding
                problems = [f"unreadable: {e}"]
            label = f"{meta.stem}.{fmt}"
            if problems:
                failed += 1
                print(f"FAIL {label}: " + "; ".join(problems))
            else:
                print(f"ok   {label}")
    print(f"{len(metas) * len(FORMATS) - failed} of {len(metas) * len(FORMATS)} files agree with {pe.__name__}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
