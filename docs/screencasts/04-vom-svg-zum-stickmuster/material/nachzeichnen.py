"""Trace the cat-in-a-box PNG into an SVG: colored areas (meeting under the outlines) plus black
outlines as centerline strokes with their measured width, pupils as filled black shapes.

    python3 nachzeichnen.py katze-im-karton.png katze-im-karton.svg 100

Needs numpy, Pillow and OpenCV with contrib (cv2.ximgproc). The last number is the width in mm."""
import sys, math, re
import numpy as np, cv2
from PIL import Image

SRC, OUT = sys.argv[1], sys.argv[2]
WIDTH_MM = float(sys.argv[3]) if len(sys.argv) > 3 else 100

PAL = {
    'bg': (229, 229, 229), 'karton': (235, 192, 134), 'karton-schatten': (207, 151, 92),
    'fell': (253, 159, 53), 'streifen': (198, 83, 16), 'kontur': (11, 7, 7),
    'auge': (168, 221, 90), 'rosa': (252, 180, 175), 'glanz': (253, 253, 253),
}
HEX = {'karton': '#ebc086', 'karton-schatten': '#b77a34', 'fell': '#fd9f35', 'streifen': '#c65310',
       'auge': '#a8dd5a', 'rosa': '#fcb4af', 'glanz': '#ffffff', 'kontur': '#111111'}
names = list(PAL)
img = np.asarray(Image.open(SRC).convert('RGB')).astype(np.float32)
H, W = img.shape[:2]
pal = np.array([PAL[n] for n in names], np.float32)
d = ((img[:, :, None, :] - pal[None, None]) ** 2).sum(-1)
lab = d.argmin(-1).astype(np.uint8)
# Grey edge pixels (between outline and background) are no thread color.
chroma = img.max(-1) - img.min(-1); lum = img.mean(-1)
grey = chroma < 30
lab[grey & (lum < 175)] = names.index('kontur')
lab[grey & (lum >= 175) & (lum < 243)] = names.index('bg')
lab[grey & (lum >= 243)] = names.index('glanz')
lab = cv2.medianBlur(lab, 5)
K = names.index('kontur'); BG = names.index('bg')

black = (lab == K).astype(np.uint8)
black = cv2.morphologyEx(black, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
dist = cv2.distanceTransform(black, cv2.DIST_L2, 5)

# Pupils: thick black blobs (an opening with a disk wider than any line keeps only them).
disk = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (25, 25))
opened = cv2.morphologyEx(black, cv2.MORPH_OPEN, disk)
nlab, comp, stats, _ = cv2.connectedComponentsWithStats(opened)
opened = np.isin(comp, [i for i in range(1, nlab) if stats[i, cv2.CC_STAT_AREA] > 1500]).astype(np.uint8)
blobs = cv2.dilate(opened, np.ones((5, 5), np.uint8)) & black
lines = black & (1 - blobs)

# Colored areas: every non-black pixel keeps its color, black pixels take the nearest color.
nonblack = ((lab != K) & ~(cv2.dilate(black, np.ones((3, 3), np.uint8)).astype(bool) & (lum < 200))).astype(np.uint8)
_, idx = cv2.distanceTransformWithLabels(1 - nonblack, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
ys, xs = np.nonzero(nonblack)
lut = np.zeros(idx.max() + 1, np.uint8)
lut[idx[ys, xs]] = lab[ys, xs]
area = np.where(nonblack == 1, lab, lut[idx])
area = np.where(blobs == 1, K, area).astype(np.uint8)
# Merge specks into their surroundings.
for _ in range(2):
    area = cv2.medianBlur(area, 7)

scale = WIDTH_MM / W

def f(v):
    return f'{v:.1f}'

def contour_path(c, eps):
    c = cv2.approxPolyDP(c, eps, True).reshape(-1, 2)
    if len(c) < 3:
        return ''
    return 'M' + 'L'.join(f'{f(x)},{f(y)}' for x, y in c) + 'Z'

def _tan(prev, cur, nxt):
    a = cur - prev; b = nxt - cur
    la, lb = np.linalg.norm(a), np.linalg.norm(b)
    if la < 1e-6 or lb < 1e-6:
        return None
    if np.dot(a, b) / (la * lb) < 0.5:  # a corner: keep it sharp
        return None
    t = a / la + b / lb
    return t / (np.linalg.norm(t) + 1e-9)

def _bez(pts, closed):
    n = len(pts)
    s = f'M{f(pts[0][0])},{f(pts[0][1])}'
    segs = n if closed else n - 1
    for i in range(segs):
        p1, p2 = pts[i], pts[(i + 1) % n]
        L = np.linalg.norm(p2 - p1) / 3
        has_prev = closed or i > 0
        has_next = closed or i + 2 < n
        t1 = _tan(pts[i - 1], p1, p2) if has_prev else None
        t2 = _tan(p1, p2, pts[(i + 2) % n]) if has_next else None
        c1 = p1 + (t1 * L if t1 is not None else (p2 - p1) / 3)
        c2 = p2 - (t2 * L if t2 is not None else (p2 - p1) / 3)
        s += f'C{f(c1[0])},{f(c1[1])} {f(c2[0])},{f(c2[1])} {f(p2[0])},{f(p2[1])}'
    return s + ('Z' if closed else '')

def smooth_closed(p):
    return 'M' + 'L'.join(f'{f(x)},{f(y)}' for x, y in p) + 'Z'

def smooth_open(p):
    p = np.asarray(p, np.float32)
    return 'M' + 'L'.join(f'{f(x)},{f(y)}' for x, y in p)

def region_paths(mask, eps=1.2, min_area=40, grow=2):
    if grow: mask = cv2.dilate(mask.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * grow + 1, 2 * grow + 1)))
    cs, hier = cv2.findContours(mask.astype(np.uint8), cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    out = []
    if hier is None:
        return out
    for i, c in enumerate(cs):
        if hier[0][i][3] != -1 or cv2.contourArea(c) < min_area:
            continue
        d = contour_path(c.astype(np.float32), eps)
        j = hier[0][i][2]
        while j != -1:
            if cv2.contourArea(cs[j]) >= min_area:
                d += contour_path(cs[j].astype(np.float32), eps)
            j = hier[0][j][0]
        if d:
            out.append(d)
    return out

# Centerlines of the outlines.
skel = cv2.ximgproc.thinning(lines * 255, thinningType=cv2.ximgproc.THINNING_GUOHALL) > 0
nb = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
def neigh(y, x):
    for dy, dx in nb:
        yy, xx = y + dy, x + dx
        if 0 <= yy < H and 0 <= xx < W and skel[yy, xx]:
            yield yy, xx
deg = np.zeros((H, W), np.uint8)
for y, x in zip(*np.nonzero(skel)):
    deg[y, x] = sum(1 for _ in neigh(y, x))
visited = set()
polys = []
def walk(start, nxt):
    path = [start, nxt]
    visited.add(frozenset((start, nxt)))
    prev, cur = start, nxt
    while deg[cur] == 2:
        cand = [q for q in neigh(*cur) if q != prev and frozenset((cur, q)) not in visited]
        if not cand:
            break
        q = cand[0]
        visited.add(frozenset((cur, q)))
        path.append(q); prev, cur = cur, q
    return path
nodes = [(y, x) for y, x in zip(*np.nonzero(skel)) if deg[y, x] != 2]
for n0 in nodes:
    for q in neigh(*n0):
        if frozenset((n0, q)) not in visited:
            polys.append(walk(n0, q))
# Pure loops (no node).
for y, x in zip(*np.nonzero(skel)):
    if deg[y, x] == 2 and not any(frozenset(((y, x), q)) in visited for q in neigh(y, x)):
        q = next(neigh(y, x))
        polys.append(walk((y, x), q))

# Merge chains through junctions: join segments end to end where the direction continues.
segs = [np.array([(x, y) for y, x in p], np.float32) for p in polys]
widths = [2 * float(np.median([dist[int(y), int(x)] for x, y in s])) for s in segs]
keep = []
for s, w in zip(segs, widths):
    L = float(np.sum(np.linalg.norm(np.diff(s, axis=0), axis=1)))
    ends_free = 0
    a, b = tuple(s[0][::-1].astype(int)), tuple(s[-1][::-1].astype(int))
    if deg[a] == 1: ends_free += 1
    if deg[b] == 1: ends_free += 1
    # Spurs: short with one free end.
    if ends_free == 1 and L < 3.5 * w:
        pass
    if ends_free == 1 and L < 2.2 * w:
        continue
    if L < 3:
        continue
    keep.append([s, w])

def direction(s, at_start):
    k = min(len(s) - 1, 8)
    return (s[k] - s[0]) if at_start else (s[-1 - k] - s[-1])

merged = True
while merged:
    merged = False
    best = None
    for i in range(len(keep)):
        for j in range(len(keep)):
            if i == j: continue
            si, sj = keep[i][0], keep[j][0]
            for ei in (0, 1):
                for ej in (0, 1):
                    pi = si[-1] if ei else si[0]; pj = sj[-1] if ej else sj[0]
                    if np.linalg.norm(pi - pj) > 6: continue
                    di = -direction(si, ei == 0); dj = direction(sj, ej == 0)
                    cos = float(np.dot(di, dj) / (np.linalg.norm(di) * np.linalg.norm(dj) + 1e-9))
                    if cos > 0.75 and (best is None or cos > best[0]):
                        best = (cos, i, j, ei, ej)
    if best:
        _, i, j, ei, ej = best
        si = keep[i][0] if ei else keep[i][0][::-1]
        sj = keep[j][0] if ej == 0 else keep[j][0][::-1]
        Li, Lj = len(si), len(sj)
        keep[i] = [np.vstack([si, sj[1:]]), (keep[i][1] * Li + keep[j][1] * Lj) / (Li + Lj)]
        del keep[j]
        merged = True

def corners(s, k=7, cos_max=0.8):
    """Indices of sharp corners on a dense polyline (angle over a window of k points)."""
    n = len(s); res = []
    for i in range(k, n - k):
        a = s[i] - s[i - k]; b = s[i + k] - s[i]
        c = np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9)
        res.append((c, i))
    out = []
    for c, i in sorted(res):
        if c > cos_max: break
        if all(abs(i - j) > 2 * k for j in out): out.append(i)
    return sorted(out)

def soften(s, r=4, closed=False):
    if len(s) < 2 * r + 2: return s
    k = np.ones(2 * r + 1) / (2 * r + 1)
    if closed:
        e = np.vstack([s[-r:], s, s[:r]])
        return np.stack([np.convolve(e[:, j], k, 'valid') for j in (0, 1)], 1)
    e = np.vstack([np.repeat(s[:1], r, 0), s, np.repeat(s[-1:], r, 0)])
    out = np.stack([np.convolve(e[:, j], k, 'valid') for j in (0, 1)], 1)
    out[0], out[-1] = s[0], s[-1]
    return out

CAT = [names.index(n) for n in ('fell', 'streifen', 'rosa', 'auge')]
def is_cat(s, w):
    hits = 0; n = 0
    for i in range(1, len(s) - 1, 3):
        t = s[min(i + 1, len(s) - 1)] - s[i - 1]; t = t / (np.linalg.norm(t) + 1e-9); nrm = np.array([-t[1], t[0]])
        for sign in (1, -1):
            q = (s[i] + sign * nrm * (w / 2 + 4)).astype(int)
            if 0 <= q[0] < W and 0 <= q[1] < H:
                n += 1; hits += area[q[1], q[0]] in CAT
    return hits / max(n, 1) > 0.25

strokes = []
for s, w in keep:
    cat_line = is_cat(s, w)
    closed = np.linalg.norm(s[0] - s[-1]) < 3 and len(s) > 10
    if closed: s = s[:-1]
    cs = corners(np.vstack([s[-7:], s, s[:7]]) if closed else s)
    if closed: cs = [i - 7 for i in cs if 0 <= i - 7 < len(s)]
    if closed and cs:
        s = np.vstack([s[cs[0]:], s[:cs[0] + 1]]); cs = [i - cs[0] for i in cs[1:]] ; closed_loop = True
        cs = [i if i >= 0 else i + len(s) - 1 for i in cs]
    else:
        closed_loop = False
    cuts = [0] + cs + [len(s) - 1]
    d = ''
    if closed and not closed_loop:
        p = cv2.approxPolyDP(soften(s, closed=True).astype(np.float32).reshape(-1, 1, 2), 0.6, True).reshape(-1, 2)
        d = smooth_closed(p)
    else:
        for a, b in zip(cuts, cuts[1:]):
            piece = s[a:b + 1]
            if len(piece) < 2: continue
            p = cv2.approxPolyDP(soften(piece).astype(np.float32).reshape(-1, 1, 2), 0.6, False).reshape(-1, 2)
            seg = smooth_open(p)
            d += seg if not d else re.sub(r'^M[^CL]*', '', seg)
        if closed_loop: d += 'Z'
    strokes.append((d, max(w, 2.0), cat_line))

out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH_MM:.0f}mm" height="{H * scale:.1f}mm" viewBox="0 0 {W} {H}">',
       '<title>Katze im Karton</title>']
def ellipses(mask, min_area=30):
    cs, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    res = []
    for c in cs:
        if cv2.contourArea(c) < min_area or len(c) < 5: continue
        (cx, cy), (a, b), ang = cv2.fitEllipse(c)
        res.append(f'<ellipse cx="{cx:.1f}" cy="{cy:.1f}" rx="{a / 2:.1f}" ry="{b / 2:.1f}" transform="rotate({ang:.1f} {cx:.1f} {cy:.1f})"/>')
    return res
G = names.index('glanz')
eye = ((area == K) | (area == G)).astype(np.uint8)
eye = cv2.morphologyEx(eye, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
pupil_mask = np.zeros_like(eye)
for c in cv2.findContours(eye, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)[0]:
    if cv2.contourArea(c) > 1500: cv2.drawContours(pupil_mask, [c], -1, 1, -1)
area = np.where((pupil_mask == 1) & (area == K), names.index('auge'), area).astype(np.uint8)
glanz_mask = (area == G) & (pupil_mask == 1)
area = np.where(glanz_mask, names.index('auge'), area).astype(np.uint8)
for n in ['karton', 'karton-schatten', 'fell', 'streifen', 'rosa', 'auge']:
    i = names.index(n)
    ps = region_paths(area == i)
    if not ps: continue
    out.append(f'<g id="{n}" fill="{HEX[n]}" fill-rule="evenodd">')
    out += [f'<path d="{p}"/>' for p in ps]
    out.append('</g>')
SPLIT = len(sys.argv) > 4 and sys.argv[4] == 'split'
def stroke_group(gid, items):
    out.append(f'<g id="{gid}" fill="none" stroke="{HEX["kontur"]}" stroke-linecap="round" stroke-linejoin="round">')
    out.extend(f'<path d="{d}" stroke-width="{w:.1f}"/>' for d, w, _ in items)
    out.append('</g>')
if SPLIT:
    # Box outlines, then the pupils (a fill: the lines before and after stay separate objects), then the cat's.
    stroke_group('konturen-karton', [x for x in strokes if not x[2]])
out.append(f'<g id="pupillen" fill="{HEX["kontur"]}">'); out += ellipses(pupil_mask, 1500); out.append('</g>')
if SPLIT:
    stroke_group('konturen-katze', [x for x in strokes if x[2]])
    out.append(f'<g id="glanz" fill="{HEX["glanz"]}">'); out += ellipses(glanz_mask); out.append('</g>')
else:
    out.append(f'<g id="glanz" fill="{HEX["glanz"]}">'); out += ellipses(glanz_mask); out.append('</g>')
    stroke_group('konturen', strokes)
out.append('</svg>')
open(OUT, 'w').write('\n'.join(out))
print(len(strokes), 'strokes; widths px', sorted(round(x[1], 1) for x in strokes)[:5], '...', sum(x[2] for x in strokes))

if len(sys.argv) > 5:
    dbg = cv2.cvtColor((lines * 60).astype(np.uint8), cv2.COLOR_GRAY2BGR)
    dbg[skel] = (255, 255, 255)
    rng = np.random.default_rng(1)
    for s, w in keep:
        c = tuple(int(v) for v in rng.integers(80, 255, 3))
        cv2.polylines(dbg, [s.astype(np.int32).reshape(-1, 1, 2)], False, c, 2)
        cv2.circle(dbg, tuple(int(v) for v in s[0]), 3, (0, 0, 255), -1); cv2.circle(dbg, tuple(int(v) for v in s[-1]), 3, (0, 255, 0), -1)
    cv2.imwrite(sys.argv[4], dbg)
