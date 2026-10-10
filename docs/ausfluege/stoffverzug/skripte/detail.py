# Nahaufnahme: linke untere Ecke der Katze, Nadelwege vorher und nachher (Jersey und Webware).
import pickle, sys
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.collections import LineCollection
fig, axs = plt.subplots(1, 2, figsize=(12, 6.2), dpi=150)
for ax, name in zip(axs, ['woven', 'knit']):
    R = pickle.load(open(f'ergebnis/verzug-{name}.pkl', 'rb'))
    P, segs, col, used = R['P'], R['segs'], R['col'], R['used']
    rgb = np.array([[q['r'], q['g'], q['b']] for q in R['colors']]) / 255
    corr = R['needle'] - P
    c = R['c']
    A = np.c_[P[used] - c, np.ones(len(used))]
    coef, *_ = np.linalg.lstsq(A, corr[used], rcond=None)
    loc = corr - np.c_[P - c, np.ones(len(P))] @ coef
    lo = P[used].min(0)
    box = (lo[0] + 2, lo[0] + 14, P[used, 1].max() - 16, P[used, 1].max() - 4)
    EX = 10
    ax.set_facecolor('#33414f')
    ax.add_collection(LineCollection(np.stack([P[segs - 1], P[segs]], 1), colors='#9aa7b4', linewidths=0.5, alpha=0.6))
    Q = P + EX * loc
    ax.add_collection(LineCollection(np.stack([Q[segs - 1], Q[segs]], 1), colors=rgb[col], linewidths=0.7))
    sel = used[(P[used, 0] > box[0]) & (P[used, 0] < box[1]) & (P[used, 1] > box[2]) & (P[used, 1] < box[3])][::6]
    ax.quiver(P[sel, 0], P[sel, 1], EX * loc[sel, 0], EX * loc[sel, 1], angles='xy', scale_units='xy', scale=1, color='#ffd166', width=0.003, headwidth=4)
    ax.set_xlim(box[0], box[1]); ax.set_ylim(box[3], box[2]); ax.set_aspect('equal')
    ax.set_xticks(np.arange(np.ceil(box[0]), box[1], 2)); ax.set_yticks(np.arange(np.ceil(box[2]), box[3], 2))
    ax.set_xticklabels([]); ax.set_yticklabels([]); ax.grid(color='white', alpha=0.08)
    ax.set_title(f'{R["fab"]}: örtlicher Anteil bis {np.linalg.norm(loc[sel], axis=1).max():.2f} mm')
fig.suptitle('Linke untere Ecke links unten, 12 × 12 mm (Gitter 2 mm). Grau: Stickdatei. Farbig: korrigierte Nadelwege ohne Maßstab, ×10 überhöht.', fontsize=11)
fig.tight_layout(rect=(0, 0, 1, 0.95)); fig.savefig('ergebnis/katze-detail-pfote.png')
