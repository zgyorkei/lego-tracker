"""Brick Tracker logo (LT.LOGO.APPLY): the figure and its face and torso prints.

Pure Python + numpy (no bpy), imported by render_bust.py.

FIGURES holds one character, Glim the Ghost, an original figure made for Brick
Tracker (the user's pick from LT.LOGO.TOON, one shade darker than on the pick page).
The parts are standard LDraw minifigure parts (LDraw.org Parts Library, CC BY 2.0
/ CC BY 4.0); the face and torso prints are drawn below as signed-distance shapes
and painted onto the parts as textures.

Coordinates of the prints are LDraw units (LDU, 1 LDU = 0.4 mm):
- face: s = arc length around the head from the front centre (+s is the
  viewer's right), t = LDraw y inside the head part (0 = top of the head,
  growing downwards; the straight cylinder runs from t=4 to t=17);
- torso: x = LDraw x on the front of the torso (+x is the viewer's right),
  y = LDraw y inside the torso part (0 = the shoulders, 32 = the hips).
"""
import math
import numpy as np

# ---------------------------------------------------------------------------
# Colour helpers

def hex_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def srgb_to_linear(c):
    return tuple((v / 12.92) if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


# ---------------------------------------------------------------------------
# Signed distance shapes (negative inside). Each has a bounding box bb =
# (xmin, ymin, xmax, ymax) so a canvas only evaluates it where it can be.

class Shape:
    bb = (-1e9, -1e9, 1e9, 1e9)

    def d(self, X, Y):
        raise NotImplementedError


class Circle(Shape):
    def __init__(self, cx, cy, r):
        self.cx, self.cy, self.r = cx, cy, r
        self.bb = (cx - r, cy - r, cx + r, cy + r)

    def d(self, X, Y):
        return np.hypot(X - self.cx, Y - self.cy) - self.r


class Ellipse(Shape):
    def __init__(self, cx, cy, rx, ry, rot=0.0):
        self.cx, self.cy, self.rx, self.ry = cx, cy, rx, ry
        self.c, self.s = math.cos(math.radians(rot)), math.sin(math.radians(rot))
        m = max(rx, ry)
        self.bb = (cx - m, cy - m, cx + m, cy + m)

    def d(self, X, Y):
        dx, dy = X - self.cx, Y - self.cy
        u = dx * self.c + dy * self.s
        v = -dx * self.s + dy * self.c
        k0 = np.hypot(u / self.rx, v / self.ry)
        k1 = np.hypot(u / self.rx ** 2, v / self.ry ** 2)
        k1 = np.maximum(k1, 1e-9)
        return k0 * (k0 - 1.0) / k1


class RRect(Shape):
    def __init__(self, cx, cy, w, h, r=0.0, rot=0.0):
        self.cx, self.cy, self.hw, self.hh, self.r = cx, cy, w / 2, h / 2, r
        self.c, self.s = math.cos(math.radians(rot)), math.sin(math.radians(rot))
        m = math.hypot(w, h) / 2
        self.bb = (cx - m, cy - m, cx + m, cy + m)

    def d(self, X, Y):
        dx, dy = X - self.cx, Y - self.cy
        u = np.abs(dx * self.c + dy * self.s) - (self.hw - self.r)
        v = np.abs(-dx * self.s + dy * self.c) - (self.hh - self.r)
        out = np.hypot(np.maximum(u, 0), np.maximum(v, 0))
        return out + np.minimum(np.maximum(u, v), 0) - self.r


class Stroke(Shape):
    """A polyline of thickness w with round caps."""

    def __init__(self, pts, w):
        self.p = np.asarray(pts, dtype=np.float64)
        self.w = w
        xs, ys = self.p[:, 0], self.p[:, 1]
        self.bb = (xs.min() - w, ys.min() - w, xs.max() + w, ys.max() + w)

    def d(self, X, Y):
        best = None
        P = self.p
        if len(P) == 1:
            return np.hypot(X - P[0, 0], Y - P[0, 1]) - self.w / 2
        for i in range(len(P) - 1):
            ax, ay = P[i]
            ex, ey = P[i + 1] - P[i]
            wx, wy = X - ax, Y - ay
            l2 = ex * ex + ey * ey
            t = np.clip((wx * ex + wy * ey) / l2, 0, 1) if l2 > 0 else 0
            dd = (wx - ex * t) ** 2 + (wy - ey * t) ** 2
            best = dd if best is None else np.minimum(best, dd)
        return np.sqrt(best) - self.w / 2


class Poly(Shape):
    def __init__(self, pts):
        self.p = np.asarray(pts, dtype=np.float64)
        xs, ys = self.p[:, 0], self.p[:, 1]
        self.bb = (xs.min(), ys.min(), xs.max(), ys.max())

    def d(self, X, Y):
        P = self.p
        n = len(P)
        best = None
        inside = np.zeros(X.shape, dtype=bool)
        for i in range(n):
            ax, ay = P[i]
            bx, by = P[(i + 1) % n]
            ex, ey = bx - ax, by - ay
            wx, wy = X - ax, Y - ay
            l2 = ex * ex + ey * ey
            t = np.clip((wx * ex + wy * ey) / l2, 0, 1) if l2 > 0 else 0
            dd = (wx - ex * t) ** 2 + (wy - ey * t) ** 2
            best = dd if best is None else np.minimum(best, dd)
            if ay != by:
                cond = ((ay > Y) != (by > Y)) & (X < ex * (Y - ay) / ey + ax)
                inside ^= cond
        dist = np.sqrt(best)
        return np.where(inside, -dist, dist)


class Union(Shape):
    def __init__(self, *shapes):
        self.shapes = shapes
        self.bb = (min(s.bb[0] for s in shapes), min(s.bb[1] for s in shapes),
                   max(s.bb[2] for s in shapes), max(s.bb[3] for s in shapes))

    def d(self, X, Y):
        out = self.shapes[0].d(X, Y)
        for s in self.shapes[1:]:
            out = np.minimum(out, s.d(X, Y))
        return out


class Inter(Shape):
    def __init__(self, a, b):
        self.a, self.b = a, b
        self.bb = (max(a.bb[0], b.bb[0]), max(a.bb[1], b.bb[1]), min(a.bb[2], b.bb[2]), min(a.bb[3], b.bb[3]))

    def d(self, X, Y):
        return np.maximum(self.a.d(X, Y), self.b.d(X, Y))


class Diff(Shape):
    def __init__(self, a, b):
        self.a, self.b = a, b
        self.bb = a.bb

    def d(self, X, Y):
        return np.maximum(self.a.d(X, Y), -self.b.d(X, Y))


def bez(*p, n=28):
    """Points along a quadratic (3 points) or cubic (4 points) Bezier curve."""
    p = [np.asarray(q, dtype=np.float64) for q in p]
    t = np.linspace(0, 1, n)[:, None]
    if len(p) == 3:
        return (1 - t) ** 2 * p[0] + 2 * (1 - t) * t * p[1] + t ** 2 * p[2]
    return (1 - t) ** 3 * p[0] + 3 * (1 - t) ** 2 * t * p[1] + 3 * (1 - t) * t ** 2 * p[2] + t ** 3 * p[3]


def arc(cx, cy, r, a0, a1, n=32):
    """Points on a circle arc, angles in degrees (0 = +x, 90 = +y which is downwards)."""
    a = np.radians(np.linspace(a0, a1, n))
    return np.stack([cx + r * np.cos(a), cy + r * np.sin(a)], axis=1)


def star(cx, cy, r, inner=0.45, points=5, rot=-90):
    pts = []
    for i in range(points * 2):
        rr = r if i % 2 == 0 else r * inner
        a = math.radians(rot + i * 180.0 / points)
        pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    return Poly(pts)


# ---------------------------------------------------------------------------
# Canvas: premultiplied RGBA plus a glow (emission) mask, in LDU coordinates.

class Canvas:
    def __init__(self, x0, x1, y0, y1, ppu):
        self.x0, self.x1, self.y0, self.y1, self.ppu = x0, x1, y0, y1, ppu
        self.W = int(round((x1 - x0) * ppu))
        self.H = int(round((y1 - y0) * ppu))
        self.rgb = np.zeros((self.H, self.W, 3), np.float32)
        self.a = np.zeros((self.H, self.W), np.float32)
        self.glow = np.zeros((self.H, self.W), np.float32)

    def _win(self, bb):
        pad = 3.0 / self.ppu
        i0 = max(0, int(math.floor((bb[0] - pad - self.x0) * self.ppu)))
        i1 = min(self.W, int(math.ceil((bb[2] + pad - self.x0) * self.ppu)) + 1)
        j0 = max(0, int(math.floor((bb[1] - pad - self.y0) * self.ppu)))
        j1 = min(self.H, int(math.ceil((bb[3] + pad - self.y0) * self.ppu)) + 1)
        if i1 <= i0 or j1 <= j0:
            return None
        xs = self.x0 + (np.arange(i0, i1) + 0.5) / self.ppu
        ys = self.y0 + (np.arange(j0, j1) + 0.5) / self.ppu
        X, Y = np.meshgrid(xs, ys)
        return (slice(j0, j1), slice(i0, i1)), X, Y

    def fill(self, shape, color, alpha=1.0, glow=0.0):
        win = self._win(shape.bb)
        if win is None:
            return
        sl, X, Y = win
        cov = np.clip(0.5 - shape.d(X, Y) * self.ppu, 0.0, 1.0) * alpha
        c = np.asarray(hex_rgb(color), np.float32)
        k = cov[..., None]
        self.rgb[sl] = c * k + self.rgb[sl] * (1 - k)
        self.a[sl] = cov + self.a[sl] * (1 - cov)
        self.glow[sl] = glow * cov + self.glow[sl] * (1 - cov)

    def rgba_straight(self):
        """Straight-alpha RGBA, row 0 at the top."""
        a = self.a[..., None]
        rgb = np.where(a > 1e-6, self.rgb / np.maximum(a, 1e-6), 0)
        return np.concatenate([np.clip(rgb, 0, 1), self.a[..., None]], axis=2)


# ---------------------------------------------------------------------------
# Print geometry (from the LDraw parts 3626c and 973)

FACE_R = 12.0                 # LDU radius used to turn an angle into arc length
FACE_RANGE = (-21.0, 21.0)    # s range of the face texture (about +-100 degrees)
FACE_T = (0.0, 24.0)          # t range of the face texture
TORSO_X = (-21.0, 21.0)
TORSO_Y = (0.0, 32.0)
FACE_PPU = 48
TORSO_PPU = 36

INK = '#1b1a1a'
WHITE = '#ffffff'


def new_face():
    return Canvas(FACE_RANGE[0], FACE_RANGE[1], FACE_T[0], FACE_T[1], FACE_PPU)


def new_torso():
    return Canvas(TORSO_X[0], TORSO_X[1], TORSO_Y[0], TORSO_Y[1], TORSO_PPU)


# --- face parts -------------------------------------------------------------
EYE_T = 9.6
EYE_DX = 3.9


def eyes(c, t=EYE_T, dx=EYE_DX, rx=1.0, ry=1.4, look=0.0, color=INK, catch=True):
    for sx in (-dx, dx):
        c.fill(Ellipse(sx + look, t, rx, ry), color)
        if catch:
            c.fill(Circle(sx + look - 0.33 * rx, t - 0.42 * ry, 0.34 * rx), WHITE)


def happy_eyes(c, t=EYE_T, dx=EYE_DX, half=1.25, w=0.75):
    """Closed, smiling eyes (upward arcs)."""
    for sx in (-dx, dx):
        c.fill(Stroke(bez((sx - half, t + 0.5), (sx, t - 1.3), (sx + half, t + 0.5)), w), INK)


def brows(c, t=6.6, dx=EYE_DX, length=2.8, w=0.8, tilt=0.0, arch=0.45, color=INK, only=None):
    """tilt > 0 lowers the inner ends (cross); tilt < 0 raises them (worried)."""
    for side in (-1, 1):
        if only and side != only:
            continue
        cx = side * dx
        inner = (cx - side * length / 2, t + tilt / 2)
        outer = (cx + side * length / 2, t - tilt / 2)
        mid = (cx, t - arch - 0.0)
        c.fill(Stroke(bez(inner, (mid[0], 2 * mid[1] - (inner[1] + outer[1]) / 2), outer), w), color)


def smile(c, t=13.4, half=3.5, sag=1.5, w=0.8, color=INK, shift=0.0):
    c.fill(Stroke(bez((-half + shift, t), (shift, t + 2 * sag), (half + shift, t)), w), color)
    # little dimples at the ends
    for side in (-1, 1):
        ex = side * half + shift
        c.fill(Stroke([(ex - side * 0.15, t - 0.45), (ex + side * 0.35, t + 0.2)], w * 0.7), color)


def grin(c, t=12.9, half=3.6, depth=2.6, lift=0.5, teeth=1.0, tongue=True, gold=None, shift=0.0):
    """An open smile: dark mouth, a row of teeth along the top, a tongue."""
    upper = bez((-half + shift, t), (shift, t + 2 * lift), (half + shift, t))
    lower = bez((half + shift, t), (shift, t + 2 * depth), (-half + shift, t))
    mouth = Poly(np.concatenate([upper, lower[1:-1]]))
    c.fill(mouth, '#3a1414')
    if tongue:
        c.fill(Inter(mouth, Ellipse(shift, t + depth + 0.9, half * 0.62, 1.35)), '#d9535a')
    if teeth:
        band = Poly(np.concatenate([upper, (upper + [0, teeth])[::-1]]))
        c.fill(Inter(mouth, band), WHITE)
        if gold is not None:
            c.fill(Inter(Inter(mouth, band), RRect(gold + shift, t + lift + 0.4, 1.1, 2.2, 0.2)), '#f2b51b')
    c.fill(Stroke(np.concatenate([upper, lower[1:]]), 0.42), INK)


def freckles(c, t=12.0, dx=6.2, color='#c4813f', r=0.27):
    for side in (-1, 1):
        for ox, oy in ((-0.7, 0.0), (0.4, -0.45), (0.55, 0.55), (-0.25, 0.85)):
            c.fill(Circle(side * dx + side * ox, t + oy, r), color)


def blush(c, t=12.6, dx=6.4, color='#f08a6d', alpha=0.55):
    for side in (-1, 1):
        c.fill(Ellipse(side * dx, t, 1.35, 0.8), color, alpha)


def lashes(c, t=EYE_T, dx=EYE_DX, w=0.45):
    for side in (-1, 1):
        ox = side * dx + side * 0.75
        c.fill(Stroke([(ox, t - 1.0), (ox + side * 0.8, t - 1.6)], w), INK)
        c.fill(Stroke([(ox - side * 0.25, t - 1.35), (ox + side * 0.25, t - 2.15)], w), INK)


# --- torso parts -------------------------------------------------------------

def torso_half_width(y):
    """Half width of the front face of part 973 at height y (approximate)."""
    return 10.0 + 9.5 * (y / 32.0)


def collar_v(c, color, depth=8.0, top=1.0, open_w=4.6, outline=None):
    pts = [(-open_w, top - 1), (open_w, top - 1), (0, top + depth)]
    c.fill(Poly(pts), color)
    if outline:
        c.fill(Stroke([(-open_w, top - 0.6), (0, top + depth), (open_w, top - 0.6)], 0.55), outline)


def buttons(c, xs, ys, r=0.75, color='#e3b02f', ring=INK):
    for x in xs:
        for y in ys:
            if ring:
                c.fill(Circle(x, y, r + 0.3), ring)
            c.fill(Circle(x, y, r), color)


def brick_top(c, cx, cy, size, color, studs=(2, 2), outline=INK):
    """A brick seen from above: a rounded square with studs."""
    nx, ny = studs
    w, h = size * nx / 2, size * ny / 2
    c.fill(RRect(cx, cy, w + 0.9, h + 0.9, 0.5), outline)
    c.fill(RRect(cx, cy, w, h, 0.3), color)
    sx = w / nx
    sy = h / ny
    for i in range(nx):
        for j in range(ny):
            px = cx - w / 2 + sx * (i + 0.5)
            py = cy - h / 2 + sy * (j + 0.5)
            c.fill(Circle(px, py, sx * 0.34 + 0.18), outline)
            c.fill(Circle(px, py, sx * 0.34), color)
            c.fill(Circle(px - sx * 0.1, py - sx * 0.1, sx * 0.12), WHITE, 0.55)


def brick_side(c, cx, cy, w, h, color, studs=2, outline=INK):
    """A brick seen from the side: a block with studs on top."""
    c.fill(RRect(cx, cy, w + 0.8, h + 0.8, 0.3), outline)
    sw = w / studs
    for i in range(studs):
        px = cx - w / 2 + sw * (i + 0.5)
        c.fill(RRect(px, cy - h / 2 - 0.55, sw * 0.62 + 0.8, 1.5 + 0.8, 0.2), outline)
        c.fill(RRect(px, cy - h / 2 - 0.55, sw * 0.62, 1.5, 0.15), color)
    c.fill(RRect(cx, cy, w, h, 0.2), color)
    c.fill(RRect(cx - w * 0.22, cy - h * 0.18, w * 0.38, h * 0.22, 0.2), WHITE, 0.35)


# ---------------------------------------------------------------------------
# The figures. Parts are LDraw files with an LDraw colour code; 'colors' maps
# every code a figure uses to the colour (and a material kind) it renders in.
# A headgear part sits at the head's origin unless it names its own place.

HEAD = '3626c.dat'
TORSO = '973.dat'

FIGURES = []


def figure(key, name, blurb, torso, arms, headgear, colors, head='#f6c824', tile=('#2f6fd6', '#1c3f8f'),
           ring='#1d2b53', cam_el=12.0, cut_y=16.0):
    """cam_el: the camera's elevation in degrees. cut_y: the LDraw y on the torso where the bust is cut."""
    def deco(fn):
        FIGURES.append(dict(key=key, name=name, blurb=blurb, torso=torso, arms=arms, headgear=headgear,
                            colors=colors, head=head, tile=tile, ring=ring, prints=fn,
                            cam_el=cam_el, cut_y=cut_y))
        return fn
    return deco


# Glim the Ghost. The user asked for "a bit darker shade" (28 Nov): one step down from the
# LT.LOGO.TOON pick (hood #c4f0d2, head #d6f6e0, torso and arms #b9ebc9, folds #86c99c).
GLIM_FOLDS = '#5fa87a'


@figure('ghost', 'Glim the Ghost', 'A friendly glow-in-the-dark ghost under a sheet hood',
        torso='#8fd1a8', arms='#8fd1a8', headgear=[('30381.dat', 'hood')],
        colors={'hood': ('#9ad9b0', 'glow')}, head='#b4e3c4', tile=('#3b2a6b', '#120c2b'), ring='#120c2b')
def p_ghost(face, torso):
    for side in (-1, 1):
        face.fill(Ellipse(side * 3.6, 9.6, 1.6, 2.3), '#20203a')
        face.fill(Circle(side * 3.6 - 0.5, 8.7, 0.55), WHITE)
    face.fill(Ellipse(0, 14.6, 1.5, 1.8), '#20203a')
    blush(face, t=12.6, dx=6.6, color='#9fd8ff', alpha=0.6)
    # wavy sheet folds
    for k, x in enumerate((-9.0, -3.0, 3.0, 9.0)):
        torso.fill(Stroke(bez((x, 4.0), (x + 1.8, 14.0), (x - 0.6, 30.0)), 0.55), GLIM_FOLDS)
    torso.fill(Ellipse(0, 15, 6, 5), '#ffffff', 0.25, glow=0.3)


def by_key():
    return {f['key']: f for f in FIGURES}
