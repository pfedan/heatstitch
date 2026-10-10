import json, os, sys, time, pickle
import numpy as np
sys.path.insert(0, '.')
from sim import *

os.makedirs("ergebnis", exist_ok=True)
d = json.load(open('ergebnis/katze-stiche.json'))
P, segs, col = stitch_segments(d)
used = np.unique(np.r_[segs - 1, segs])
lo, hi = P[used].min(0), P[used].max(0)
c = (lo + hi) / 2
print('Größe mm', hi - lo, 'Stiche', len(segs))
fab = {'woven': WOVEN, 'knit': KNIT}[sys.argv[1] if len(sys.argv) > 1 else 'woven']
m = Mesh(c[0], c[1], 100.0, 1.0)
sim = Sim(m, fab)
t = time.time()
frames = []
r0 = sim.run(P, segs, frames)
print('Laufzeit', time.time() - t)
def err(r):
    fit = rigid_fit(r['final'][used], P[used])
    e = fit(r['final']) - P
    return e, np.sqrt((e[used] ** 2).sum(1))
hoopd = np.linalg.norm(r0['hoop_end'] - P, axis=1)[used]
e0, n0 = err(r0)
print('im Rahmen: Stoffpunkte bis Ende verschoben  mittel %.2f max %.2f mm' % (hoopd.mean(), hoopd.max()))
print('nach Ausspannen (starr angepasst): mittel %.2f  p95 %.2f  max %.2f mm' % (n0.mean(), np.percentile(n0, 95), n0.max()))
# Maßstab
A = np.c_[P[used] - c, np.ones(len(used))]
sx = np.linalg.lstsq(np.c_[P[used, 0] - c[0], np.ones(len(used))], r0['final'][used, 0], rcond=None)[0][0]
sy = np.linalg.lstsq(np.c_[P[used, 1] - c[1], np.ones(len(used))], r0['final'][used, 1], rcond=None)[0][0]
print('Maßstab x %.4f y %.4f' % (sx, sy))
# Korrektur
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
    print('Iteration %d: mittel %.3f p95 %.3f max %.3f mm' % (it + 1, n.mean(), np.percentile(n, 95), n.max()))
corr = needle - P
cn = np.linalg.norm(corr, axis=1)[used]
print('Korrektur: mittel %.2f p95 %.2f max %.2f mm' % (cn.mean(), np.percentile(cn, 95), cn.max()))
pickle.dump(dict(P=P, segs=segs, col=col, used=used, c=c, r0=r0, rc=runs[-1], needle=needle, frames=frames, hist=hist, mesh=(m.x0, m.y0, m.n, m.h), colors=d['colors'], fab=fab.name), open(f'ergebnis/verzug-{sys.argv[1] if len(sys.argv)>1 else "woven"}.pkl', 'wb'))
# Korrigierte Nadelpositionen (0,1 mm) für den PES-Export
name = sys.argv[1] if len(sys.argv) > 1 else 'woven'
nd = np.round(needle * 10).astype(int)
json.dump({'x': nd[:, 0].tolist(), 'y': nd[:, 1].tolist()}, open(f'ergebnis/needle-{name}.json', 'w'))
