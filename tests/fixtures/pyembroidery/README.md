Files written by pyembroidery 1.5.1 from `public/examples/demos/sun.dst` with three named threads
(brand and catalog number), `sun-v6.pes` as PES version 6 with a thread list. `expected.json` holds
what pyembroidery reads back: the stitch positions (the same for every file) and per file the trims,
color changes and colors. The format tests check heatstitch's readers against it.

```python
import pyembroidery as pe
o = pe.read('public/examples/demos/sun.dst')
o.threadlist.clear()
for c, d, b, n in [(0x0a55a3, 'Royal Blue', 'Madeira', '1076'), (0xed171f, 'Red', 'Isacord', '1902'), (0x70bc1f, 'Lime', 'Madeira', '1049')]:
    t = pe.EmbThread(); t.color = c; t.description = d; t.brand = b; t.catalog_number = n; o.add_thread(t)
for fmt in ['jef', 'exp', 'vp3', 'pec']:
    pe.write(o, f'tests/fixtures/pyembroidery/sun.{fmt}')
pe.write(o, 'tests/fixtures/pyembroidery/sun-v6.pes', {'version': '6t'})
```

`origin-start.pes` (pyembroidery 1.5.1, PES version 1) starts sewing at the origin, so its first
record at PEC byte 528 is a 2-byte stitch instead of Brother's opening move:

```python
import pyembroidery as pe
p = pe.EmbPattern()
p.add_thread(0xed171f)
for x, y in [(0, 0), (20, 0), (20, 20), (0, 20), (0, 0), (10, 10)]:
    p.add_stitch_absolute(pe.STITCH, x, y)
p.add_command(pe.TRIM)
p.add_stitch_absolute(pe.JUMP, 200, 100)
for x, y in [(200, 100), (230, 100), (230, 130)]:
    p.add_stitch_absolute(pe.STITCH, x, y)
p.add_command(pe.END)
pe.write_pes(p, 'tests/fixtures/pyembroidery/origin-start.pes', {'version': '1'})
```

`sun.xxx` and `sun.sew` were added later, written by pystitch 1.0.1 (Ink/Stitch's fork, the version
CI uses for the oracle) from the same design and threads, and their entries added to `expected.json`
the same way. SEW stores indices into the Janome SEW table, taken from `catalog_number`:

```python
import pystitch as pe
# o as above
pe.write(o, 'tests/fixtures/pyembroidery/sun.xxx')
for t, n in zip(o.threadlist, ['12', '10', '6']):  # Blue, Red, Green
    t.catalog_number = n
pe.write(o, 'tests/fixtures/pyembroidery/sun.sew')
```
