"""
Simulate the fabric distortion of an embroidery design stitch by stitch, and pre-correct every stitch.

Model (see ../README.md, "The model"):
- Fabric plus stabilizer: a flat, linear, orthotropic membrane (CST triangles), held at the edge of
  the hoop and pre-stretched by e0.
- Every stitch: an embedded bar (like rebar in an FE model) between the two fabric points under its
  needle holes, added in sewing order. Its rest length is (1 - s) times its length when sewn: on
  rigid fabric every stitch would pull with T = EA * s.
- The needle hits hoop coordinates. Which fabric point lies under it depends on all earlier
  stitches: X = p - u(X), solved by fixed-point iteration.
- Unhooping: free edge, no pre-stretch, every stitch keeps its rest length.
- Correction: displacement adjustment (Gan and Wagoner 2004): p <- p - (f(p) - target), repeated.

The material values are plausible guesses, not measurements (see "Assumptions" in ../README.md).
"""
import json
import sys
import numpy as np
import scipy.sparse as sp
import scipy.sparse.linalg as spla

STITCH = 0


class Fabric:
    def __init__(self, Ex, Ey, G, nu, name):
        self.Ex, self.Ey, self.G, self.nu, self.name = Ex, Ey, G, nu, name

    def D(self):
        S = np.array([[1 / self.Ex, -self.nu / self.Ex, 0], [-self.nu / self.Ex, 1 / self.Ey, 0], [0, 0, 1 / self.G]])
        return np.linalg.inv(S)


# Membrane stiffness in N/mm (fabric plus stabilizer), x = warp or wale direction.
WOVEN = Fabric(Ex=40.0, Ey=30.0, G=4.0, nu=0.2, name='woven with tear-away')
KNIT = Fabric(Ex=8.0, Ey=3.0, G=1.0, nu=0.3, name='jersey with cut-away')


class Mesh:
    """Structured triangle mesh over the hoop."""

    def __init__(self, cx, cy, size, h):
        n = int(round(size / h))
        self.n, self.h = n, h
        self.x0, self.y0 = cx - size / 2, cy - size / 2
        gx, gy = np.meshgrid(np.arange(n + 1) * h + self.x0, np.arange(n + 1) * h + self.y0)
        self.P = np.c_[gx.ravel(), gy.ravel()]
        idx = lambda i, j: j * (n + 1) + i
        tris = []
        for j in range(n):
            for i in range(n):
                a, b, c, d = idx(i, j), idx(i + 1, j), idx(i + 1, j + 1), idx(i, j + 1)
                tris += [(a, b, c), (a, c, d)]
        self.T = np.array(tris)
        on = (gx.ravel() <= self.x0 + 1e-9) | (gx.ravel() >= self.x0 + size - 1e-9) | (gy.ravel() <= self.y0 + 1e-9) | (gy.ravel() >= self.y0 + size - 1e-9)
        self.boundary = np.where(on)[0]
        self.ndof = 2 * len(self.P)

    def locate(self, X):
        """Triangle and shape functions per point (points outside are clamped to the edge)."""
        n, h = self.n, self.h
        fx = np.clip((X[:, 0] - self.x0) / h, 0, n - 1e-9)
        fy = np.clip((X[:, 1] - self.y0) / h, 0, n - 1e-9)
        i, j = np.floor(fx).astype(int), np.floor(fy).astype(int)
        lx, ly = fx - i, fy - j
        upper = lx >= ly  # triangle (a, b, c), else (a, c, d)
        a = j * (n + 1) + i
        b, c, d = a + 1, a + n + 2, a + n + 1
        nodes = np.where(upper[:, None], np.c_[a, b, c], np.c_[a, c, d])
        N = np.where(upper[:, None], np.c_[1 - lx, lx - ly, ly], np.c_[1 - ly, lx, ly - lx])
        return nodes, N

    def interp(self, U, X):
        nodes, N = self.locate(X)
        ux = (N * U[2 * nodes]).sum(1)
        uy = (N * U[2 * nodes + 1]).sum(1)
        return np.c_[ux, uy]

    def stiffness(self, fab):
        D = fab.D()
        P, T = self.P, self.T
        x, y = P[T, 0], P[T, 1]
        b = np.c_[y[:, 1] - y[:, 2], y[:, 2] - y[:, 0], y[:, 0] - y[:, 1]]
        c = np.c_[x[:, 2] - x[:, 1], x[:, 0] - x[:, 2], x[:, 1] - x[:, 0]]
        A2 = x[:, 1] * y[:, 2] - x[:, 2] * y[:, 1] - x[:, 0] * y[:, 2] + x[:, 2] * y[:, 0] + x[:, 0] * y[:, 1] - x[:, 1] * y[:, 0]
        ne = len(T)
        B = np.zeros((ne, 3, 6))
        B[:, 0, 0::2] = b
        B[:, 1, 1::2] = c
        B[:, 2, 0::2] = c
        B[:, 2, 1::2] = b
        B /= A2[:, None, None]
        Ke = np.einsum('eki,kl,elj->eij', B, D, B) * (np.abs(A2) / 2)[:, None, None]
        dofs = np.zeros((ne, 6), int)
        dofs[:, 0::2] = 2 * T
        dofs[:, 1::2] = 2 * T + 1
        r = np.repeat(dofs, 6, axis=1).ravel()
        cc = np.tile(dofs, (1, 6)).ravel()
        return sp.csr_matrix((Ke.ravel(), (r, cc)), shape=(self.ndof, self.ndof))


def stitch_segments(d):
    """Stitches as pairs of consecutive needle points (0.1 mm -> mm)."""
    x, y, cmd = np.array(d['x']) / 10.0, np.array(d['y']) / 10.0, np.array(d['cmd'])
    segs, color, k = [], [], 0
    for i in range(1, len(cmd)):
        if cmd[i] == 3:
            k += 1
        if cmd[i] == STITCH and cmd[i - 1] == STITCH:
            segs.append(i)
            color.append(k)
    return np.c_[x, y], np.array(segs), np.array(color)


class Sim:
    def __init__(self, mesh, fab, EA=20.0, s=0.02, e0=0.003, group=100):
        self.m, self.fab, self.EA, self.s, self.e0, self.group = mesh, fab, EA, s, e0, group
        self.Kf = mesh.stiffness(fab)

    def _thread_system(self, Xa, Xb, d, c):
        """Stiffness and load of the bars: energy k/2 (d.(ub-ua) + c)^2."""
        m = self.m
        na, Na = m.locate(Xa)
        nb, Nb = m.locate(Xb)
        L = np.maximum(np.linalg.norm(Xb - Xa, axis=1), 0.05)
        k = self.EA / L
        nodes = np.c_[na, nb]
        coef = np.c_[-Na, Nb]
        Bv = np.zeros((len(L), 12))
        Bv[:, 0::2] = coef * d[:, :1]
        Bv[:, 1::2] = coef * d[:, 1:]
        dofs = np.zeros((len(L), 12), int)
        dofs[:, 0::2] = 2 * nodes
        dofs[:, 1::2] = 2 * nodes + 1
        Ke = k[:, None, None] * Bv[:, :, None] * Bv[:, None, :]
        r = np.repeat(dofs, 12, axis=1).ravel()
        cc = np.tile(dofs, (1, 12)).ravel()
        K = sp.csr_matrix((Ke.ravel(), (r, cc)), shape=(m.ndof, m.ndof))
        F = np.bincount(dofs.ravel(), weights=(-(k * c)[:, None] * Bv).ravel(), minlength=m.ndof)
        return K, F

    def run(self, needle, segs, frames=None):
        """needle: needle positions (hoop coordinates) per needle point. Returns fabric points, hoop and final positions."""
        m = self.m
        fixed = np.r_[2 * m.boundary, 2 * m.boundary + 1]
        free = np.setdiff1d(np.arange(m.ndof), fixed)
        Ub = np.zeros(m.ndof)
        Ub[2 * m.boundary] = self.e0 * (m.P[m.boundary, 0] - (m.x0 + m.n * m.h / 2))
        Ub[2 * m.boundary + 1] = self.e0 * (m.P[m.boundary, 1] - (m.y0 + m.n * m.h / 2))
        K = self.Kf.copy()
        F = np.zeros(m.ndof)

        def solve(K, F):
            U = Ub.copy()
            rhs = F[free] - K[free][:, fixed] @ Ub[fixed]
            U[free] = spla.spsolve(K[free][:, free].tocsc(), rhs)
            return U

        U = solve(K, F)
        mat = np.full_like(needle, np.nan)  # fabric point (natural state) per needle point
        hoop = np.full_like(needle, np.nan)  # position in the hoop right after it was sewn
        D_all, C_all, A_all, B_all = [], [], [], []
        ends = np.unique(np.r_[segs - 1, segs])
        order = np.argsort(ends)
        ends = ends[order]
        done = np.zeros(len(needle), bool)
        for g0 in range(0, len(segs), self.group):
            gs = segs[g0:g0 + self.group]
            pts = np.unique(np.r_[gs - 1, gs])
            pts = pts[~done[pts]]
            if len(pts):
                p = needle[pts]
                X = p.copy()
                for _ in range(4):
                    X = p - m.interp(U, X)
                mat[pts], hoop[pts] = X, p
                done[pts] = True
            Xa, Xb = mat[gs - 1], mat[gs]
            xa, xb = hoop[gs - 1], hoop[gs]
            vec = xb - xa
            Lh = np.maximum(np.linalg.norm(vec, axis=1), 0.05)
            d = vec / Lh[:, None]
            L0 = (1 - self.s) * Lh
            c = (d * (Xb - Xa)).sum(1) - L0  # elongation at u = 0 in the natural state
            Kt, Ft = self._thread_system(Xa, Xb, d, c)
            K = K + Kt
            F = F + Ft
            U = solve(K, F)
            if frames is not None:
                frames.append((g0 + len(gs), U.copy()))
            A_all.append(Xa); B_all.append(Xb); D_all.append(d); C_all.append(c)
        hoop_end = mat + m.interp(U, mat)
        # Unhooping: free edge, no pre-stretch. Tiny springs on all nodes hold the rigid body motion.
        Kr = K + sp.identity(m.ndof) * 1e-6
        Ufree = spla.spsolve(Kr.tocsc(), F)
        final = mat + m.interp(Ufree, mat)
        return dict(mat=mat, hoop=hoop, hoop_end=hoop_end, final=final, U=U, Ufree=Ufree)


def rigid_fit(src, dst, w=None):
    """Best rotation and translation src -> dst (Kabsch), no scale."""
    w = np.ones(len(src)) if w is None else w
    cs, cd = (w[:, None] * src).sum(0) / w.sum(), (w[:, None] * dst).sum(0) / w.sum()
    H = ((src - cs) * w[:, None]).T @ (dst - cd)
    Uu, _, Vt = np.linalg.svd(H)
    R = (Uu @ Vt).T
    if np.linalg.det(R) < 0:
        Vt[-1] *= -1
        R = (Uu @ Vt).T
    return lambda P: (P - cs) @ R.T + cd
