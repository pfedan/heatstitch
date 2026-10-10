import pickle, sys
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.collections import LineCollection
sys.path.insert(0, '.')
from sim import Mesh, rigid_fit

name = sys.argv[1] if len(sys.argv) > 1 else 'woven'
R = pickle.load(open(f'ergebnis/verzug-{name}.pkl', 'rb'))
P, segs, col, used, c = R['P'], R['segs'], R['col'], R['used'], R['c']
x0, y0, n, h = R['mesh']
m = Mesh(x0 + n * h / 2, y0 + n * h / 2, n * h, h)
rgb = np.array([[q['r'], q['g'], q['b']] for q in R['colors']]) / 255
scol = rgb[col]
FAB = '#33414f'
EX = 10  # Überhöhung
plt.rcParams.update({'font.size': 10, 'font.family': 'DejaVu Sans'})

def lines(ax, Q, colors, lw=0.5, alpha=1, z=2):
    ax.add_collection(LineCollection(np.stack([Q[segs - 1], Q[segs]], 1), colors=colors, linewidths=lw, alpha=alpha, zorder=z))

def frame(ax, pad=4):
    lo, hi = P[used].min(0) - pad, P[used].max(0) + pad
    ax.set_xlim(lo[0], hi[0]); ax.set_ylim(hi[1], lo[1]); ax.set_aspect('equal')
    ax.set_xticks([]); ax.set_yticks([])

r0, rc = R['r0'], R['rc']
fit0 = rigid_fit(r0['final'][used], P[used])
fin0 = fit0(r0['final'])
dev0 = fin0 - P

# Bild 1: verzerrt
fig, axs = plt.subplots(1, 3, figsize=(15, 5.6), dpi=150)
ax = axs[0]; ax.set_facecolor(FAB); lines(ax, P, scol); frame(ax); ax.set_title('Soll (Stickdatei)')
ax = axs[1]; ax.set_facecolor(FAB)
lines(ax, P, '#9aa7b4', lw=0.4, alpha=0.5, z=1)
lines(ax, P + EX * dev0, scol)
frame(ax); ax.set_title(f'Nach dem Ausspannen, Verschiebung ×{EX} überhöht\n(grau: Soll)')
ax = axs[2]
# Stoffverschiebung nach Ausspannen relativ zum Soll (starr angepasst), auf dem Netz
Ug = r0['Ufree'].reshape(-1, 2)
G = m.P
Gf = fit0(G + Ug) - G
mag = np.linalg.norm(Gf, axis=1).reshape(n + 1, n + 1)
lo, hi = P[used].min(0) - 4, P[used].max(0) + 4
im = ax.imshow(mag, extent=[x0, x0 + n * h, y0 + n * h, y0], cmap='magma', vmin=0, vmax=np.percentile(mag, 99.5), interpolation='bilinear')
step = 2
for j in range(0, n + 1, step):
    row = np.arange(n + 1) + j * (n + 1)
    ax.plot((G + EX * Gf)[row, 0], (G + EX * Gf)[row, 1], color='white', lw=0.3, alpha=0.5)
    colm = np.arange(n + 1) * (n + 1) + j
    ax.plot((G + EX * Gf)[colm, 0], (G + EX * Gf)[colm, 1], color='white', lw=0.3, alpha=0.5)
frame(ax); ax.set_title(f'Stoff: Verschiebung in mm\n(Raster 2 mm, ×{EX} überhöht)')
fig.colorbar(im, ax=ax, fraction=0.046, pad=0.02, label='mm')
fig.suptitle(f'Katze 60 mm auf {R["fab"]}: berechneter Verzug (Modellwerte geschätzt, nicht gemessen)', fontsize=12)
fig.tight_layout(); fig.savefig(f'ergebnis/katze-{name}-verzug.png'); plt.close(fig)

# Bild 2: Korrektur je Stich
corr = R['needle'] - P
cn = np.linalg.norm(corr, axis=1)
# globaler Anteil: affine Anpassung (Maßstab, Scherung, Verschiebung)
A = np.c_[P[used] - c, np.ones(len(used))]
coef, *_ = np.linalg.lstsq(A, corr[used], rcond=None)
glob = np.c_[P - c, np.ones(len(P))] @ coef
loc = corr - glob
ln = np.linalg.norm(loc, axis=1)
fig = plt.figure(figsize=(15, 9.6), dpi=150)
gs = fig.add_gridspec(2, 3, height_ratios=[1.25, 0.75])
ax = fig.add_subplot(gs[0, 0]); ax.set_facecolor('#1d232a')
segc = np.maximum(cn[segs - 1], cn[segs])
vmax = np.percentile(segc, 99)
lc = LineCollection(np.stack([P[segs - 1], P[segs]], 1), array=segc, cmap='viridis', linewidths=0.6, norm=plt.Normalize(0, vmax))
ax.add_collection(lc); frame(ax); ax.set_title('Korrektur je Stich, gesamt')
fig.colorbar(lc, ax=ax, fraction=0.046, pad=0.02, label='mm')
ax = fig.add_subplot(gs[0, 1]); ax.set_facecolor('#1d232a')
segl = np.maximum(ln[segs - 1], ln[segs])
lc = LineCollection(np.stack([P[segs - 1], P[segs]], 1), array=segl, cmap='viridis', linewidths=0.6, norm=plt.Normalize(0, np.percentile(segl, 99)))
ax.add_collection(lc); frame(ax); ax.set_title('Örtlicher Anteil (ohne Maßstab)')
fig.colorbar(lc, ax=ax, fraction=0.046, pad=0.02, label='mm')
ax = fig.add_subplot(gs[0, 2]); ax.set_facecolor(FAB)
lines(ax, P, scol, lw=0.4, alpha=0.35)
pts = used[::25]
AR = 20
ax.quiver(P[pts, 0], P[pts, 1], AR * loc[pts, 0], AR * loc[pts, 1], angles='xy', scale_units='xy', scale=1, color='#ffd166', width=0.0025, headwidth=4)
frame(ax); ax.set_title(f'Wohin die Nadel ausweicht (örtlich, ×{AR})\njeder 25. Einstich')
ax = fig.add_subplot(gs[1, :])
idx = np.arange(len(P))[used]
ax.scatter(idx, cn[used], s=1.5, c=rgb[col[np.searchsorted(segs, used).clip(0, len(segs) - 1)]], edgecolors='none')
ax.plot(idx, ln[used], color='#222', lw=0.5, alpha=0.8, label='örtlicher Anteil')
ax.set_xlabel('Einstich in Stickreihenfolge'); ax.set_ylabel('Korrektur in mm')
ax.set_xlim(0, len(P)); ax.set_ylim(0, None)
ax.set_facecolor('#8a96a3')
ax.legend(loc='upper left', frameon=False)
ax.set_title('Korrektur über die Stickreihenfolge (Punkte in Garnfarbe: gesamt; Linie: ohne Maßstab)')
sx, sy = 1 + coef[0, 0], 1 + coef[1, 1]
fig.suptitle(f'Katze auf {R["fab"]}: Nadelkorrektur je Stich. Globaler Anteil: Maßstab x {sx*100:.2f} %, y {sy*100:.2f} %', fontsize=12)
fig.tight_layout(); fig.savefig(f'ergebnis/katze-{name}-korrektur.png'); plt.close(fig)
print('global scale', sx, sy, 'local mean %.3f p95 %.3f max %.3f' % (ln[used].mean(), np.percentile(ln[used], 95), ln[used].max()))
