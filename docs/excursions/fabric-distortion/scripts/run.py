"""One run without correction, then displacement adjustment. Usage: python3 run.py woven|knit"""
import json, os, sys, time, pickle
import numpy as np
sys.path.insert(0, '.')
from sim import *

name = sys.argv[1] if len(sys.argv) > 1 else 'woven'
os.makedirs('output', exist_ok=True)
d = json.load(open('output/cat-stitches.json'))
P, segs, col = stitch_segments(d)
used = np.unique(np.r_[segs - 1, segs])
lo, hi = P[used].min(0), P[used].max(0)
c = (lo + hi) / 2
print('size mm', hi - lo, 'stitches', len(segs))
fab = {'woven': WOVEN, 'knit': KNIT}[name]
m = Mesh(c[0], c[1], 100.0, 1.0)
sim = Sim(m, fab)
t = time.time()
frames = []
r0 = sim.run(P, segs, frames)
print('run time', time.time() - t)


def err(r):
    fit = rigid_fit(r['final'][used], P[used])
    e = fit(r['final']) - P
    return e, np.sqrt((e[used] ** 2).sum(1))


hoopd = np.linalg.norm(r0['hoop_end'] - P, axis=1)[used]
e0, n0 = err(r0)
print('in the hoop, fabric points moved after sewing: mean %.2f max %.2f mm' % (hoopd.mean(), hoopd.max()))
print('after unhooping (rigid fit): mean %.2f  p95 %.2f  max %.2f mm' % (n0.mean(), np.percentile(n0, 95), n0.max()))
sx = np.linalg.lstsq(np.c_[P[used, 0] - c[0], np.ones(len(used))], r0['final'][used, 0], rcond=None)[0][0]
sy = np.linalg.lstsq(np.c_[P[used, 1] - c[1], np.ones(len(used))], r0['final'][used, 1], rcond=None)[0][0]
print('scale x %.4f y %.4f' % (sx, sy))
# Correction
needle = P.copy()
hist = [n0]
runs = [r0]
for it in range(4):
    e, _ = err(runs[-1])
    needle = needle - e
    needle[np.isnan(needle)] = P[np.isnan(needle)]
    r = sim.run(needle, segs)
    runs.append(r)
    _, n = err(r)
    hist.append(n)
    print('iteration %d: mean %.3f p95 %.3f max %.3f mm' % (it + 1, n.mean(), np.percentile(n, 95), n.max()))
corr = needle - P
cn = np.linalg.norm(corr, axis=1)[used]
print('correction: mean %.2f p95 %.2f max %.2f mm' % (cn.mean(), np.percentile(cn, 95), cn.max()))
pickle.dump(dict(P=P, segs=segs, col=col, used=used, c=c, r0=r0, rc=runs[-1], needle=needle, frames=frames, hist=hist,
                 mesh=(m.x0, m.y0, m.n, m.h), colors=d['colors'], fab=fab.name), open(f'output/distortion-{name}.pkl', 'wb'))
# Corrected needle positions (0.1 mm) for the PES export
nd = np.round(needle * 10).astype(int)
json.dump({'x': nd[:, 0].tolist(), 'y': nd[:, 1].tolist()}, open(f'output/needle-{name}.json', 'w'))
