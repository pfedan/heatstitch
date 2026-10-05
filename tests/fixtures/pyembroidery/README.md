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
