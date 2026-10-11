import pickle, sys, os, subprocess, shutil
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.collections import LineCollection
sys.path.insert(0, '.')
from sim import Mesh, rigid_fit

name = sys.argv[1] if len(sys.argv) > 1 else 'woven'
EX = float(sys.argv[2]) if len(sys.argv) > 2 else 15
R = pickle.load(open(f'output/distortion-{name}.pkl', 'rb'))
P, segs, col, used = R['P'], R['segs'], R['col'], R['used']
x0, y0, n, h = R['mesh']
m = Mesh(x0 + n * h / 2, y0 + n * h / 2, n * h, h)
cx, cy = x0 + n * h / 2, y0 + n * h / 2
rgb = np.array([[q['r'], q['g'], q['b']] for q in R['colors']]) / 255
mat = R['r0']['mat']
G = m.P
Uinit = 0.003 * np.c_[G[:, 0] - cx, G[:, 1] - cy]
tmp = 'output/frames'
shutil.rmtree(tmp, ignore_errors=True); os.makedirs(tmp)
lo, hi = P[used].min(0) - 8, P[used].max(0) + 8
frames = R['frames']
Ufin = R['r0']['Ufree'].reshape(-1, 2)
fin = R['r0']['final']
fit = rigid_fit(fin[used], P[used])
Ufin = fit(G + Ufin) - G  # without rigid body motion, relative to the fabric at rest
# In the hoop, then blend into the unhooped state and hold
seq = [(k, F.reshape(-1, 2) - Uinit, False) for k, F in frames]
last = seq[-1][1]
for t in np.linspace(0, 1, 18)[1:]:
    seq.append((len(segs), (1 - t) * last + t * Ufin, True))
seq += [seq[-1]] * 18
vmax = 0.3
for fi, (k, Ug, rel) in enumerate(seq):
    fig = plt.figure(figsize=(7.2, 7.2), dpi=150)
    ax = fig.add_axes([0, 0, 1, 1]); ax.set_facecolor('#33414f')
    mag = np.linalg.norm(Ug, axis=1).reshape(n + 1, n + 1)
    ax.imshow(mag, extent=[x0, x0 + n * h, y0 + n * h, y0], cmap='magma', vmin=0, vmax=vmax, alpha=0.55, interpolation='bilinear')
    D = G + EX * Ug
    for j in range(0, n + 1, 2):
        r = np.arange(n + 1) + j * (n + 1); ax.plot(D[r, 0], D[r, 1], color='white', lw=0.3, alpha=0.35)
        c = np.arange(n + 1) * (n + 1) + j; ax.plot(D[c, 0], D[c, 1], color='white', lw=0.3, alpha=0.35)
    s = segs[:k]
    # Position of every sewn point, its deviation from the target exaggerated
    pos = np.nan_to_num(mat) + m.interp((Ug + (Uinit if not rel else 0)).ravel(), np.nan_to_num(mat))
    show = P + EX * (pos - P)
    ax.add_collection(LineCollection(np.stack([show[s - 1], show[s]], 1), colors=rgb[col[:k]], linewidths=0.6))
    ax.set_xlim(lo[0], hi[0]); ax.set_ylim(hi[1], lo[1]); ax.set_aspect('equal'); ax.axis('off')
    txt = ('Unhooped' if rel else f'Stitch {k} of {len(segs)}') + f'   displacement ×{int(EX)}'
    ax.text(0.02, 0.02, txt, transform=ax.transAxes, color='white', fontsize=11)
    ax.text(0.02, 0.96, R['fab'].capitalize(), transform=ax.transAxes, color='white', fontsize=11)
    fig.savefig(f'{tmp}/f{fi:04d}.png'); plt.close(fig)
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', '10', '-i', f'{tmp}/f%04d.png', '-vf', 'scale=1080:1080,format=yuv420p', '-c:v', 'libx264', '-crf', '20', f'output/cat-{name}-sewing.mp4'], check=True)
shutil.rmtree(tmp)
print('ok', len(seq))
