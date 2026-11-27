"""Brick Tracker logo proposals: the figures and their face and torso prints.

Pure Python + numpy (no bpy), imported by render_bust.py and finish.py.

Every figure here is an original character made for Brick Tracker; none is a
franchise character. The parts are standard LDraw minifigure parts (LDraw.org
Parts Library, CC BY 2.0 / CC BY 4.0); the face and torso prints are drawn
below as signed-distance shapes and painted onto the parts as textures.

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
           ring='#1d2b53', original=True, mascot=False):
    def deco(fn):
        FIGURES.append(dict(key=key, name=name, blurb=blurb, torso=torso, arms=arms, headgear=headgear,
                            colors=colors, head=head, tile=tile, ring=ring, prints=fn, mascot=mascot))
        return fn
    return deco


# 1 -- Bricksy the Builder (Brick Tracker mascot)
@figure('builder', 'Bricksy the Builder', 'Brick Tracker mascot: hard hat, hi-vis vest and a 2x4 brick badge',
        torso='#24457f', arms='#24457f', headgear=[('3833.dat', 'hat')],
        colors={'hat': '#ffb20f'}, tile=('#ffd500', '#f39c12'), ring='#24457f', mascot=True)
def p_builder(face, torso):
    brows(face, t=6.3, arch=0.7, length=3.0)
    eyes(face)
    grin(face, t=12.7, half=3.7, depth=2.7)
    freckles(face, t=11.7, dx=6.6)
    # white T-shirt neck, orange hi-vis vest with silver stripes
    collar_v(torso, '#f2f2f2', depth=7.5, open_w=5.0)
    for side in (-1, 1):
        vest = Poly([(side * 3.6, -1), (side * 9.6, -1), (side * 20.5, 32), (side * 3.0, 32), (side * 1.2, 9.5)])
        torso.fill(vest, '#ff6a13')
        stripe = Inter(vest, RRect(side * 11, 15.0, 22, 2.3))
        torso.fill(stripe, '#d8dde3')
        torso.fill(Inter(vest, RRect(side * 11, 15.0, 22, 0.7)), '#9aa3ad')
        torso.fill(Stroke([(side * 1.2, 9.5), (side * 3.0, 32)], 0.5), '#c94f06')
    # brick badge on the figure's left chest, a pencil in the other pocket
    brick_side(torso, 7.1, 10.2, 5.2, 2.6, '#ffd500', studs=2)
    torso.fill(RRect(-6.8, 8.6, 0.9, 5.0, 0.3, rot=8), '#1b1a1a')
    torso.fill(RRect(-6.8, 8.9, 0.6, 4.4, 0.2, rot=8), '#e24a3b')
    torso.fill(Poly([(-7.3, 6.3), (-6.2, 6.4), (-6.9, 4.9)]), '#f1d3a0')


# 2 -- Tally the Cataloguer (Brick Tracker mascot)
@figure('tally', 'Tally the Cataloguer', 'Brick Tracker mascot: round glasses, cardigan and a ticked checklist',
        torso='#0f7d88', arms='#0f7d88', headgear=[('62696.dat', 'hair')],
        colors={'hair': '#7a3e22'}, tile=('#5fd3c6', '#14858f'), ring='#0b5560', mascot=True)
def p_tally(face, torso):
    brows(face, t=6.2, length=2.6, w=0.65, arch=0.55, color='#5a2a14')
    eyes(face, rx=0.85, ry=1.2)
    lashes(face)
    for side in (-1, 1):
        face.fill(Diff(Circle(side * EYE_DX, EYE_T + 0.1, 2.45), Circle(side * EYE_DX, EYE_T + 0.1, 1.9)), '#2b2b2b')
    face.fill(Stroke(bez((-1.5, EYE_T - 0.1), (0, EYE_T - 0.9), (1.5, EYE_T - 0.1)), 0.5), '#2b2b2b')
    upper = bez((-2.9, 13.2), (0, 14.6), (2.9, 13.2))
    lower = bez((2.9, 13.2), (0, 17.2), (-2.9, 13.2))
    lips = Poly(np.concatenate([upper, lower[1:-1]]))
    face.fill(lips, '#c2394a')
    face.fill(Stroke(np.concatenate([upper, lower[1:]]), 0.35), '#7a1626')
    blush(face, t=12.6, dx=6.6, alpha=0.4)
    # cardigan over a white blouse, a clipboard with ticks
    collar_v(torso, '#f4f4f4', depth=9.0, open_w=5.2, outline='#0a5a63')
    buttons(torso, [0.0], [12.5, 17.5, 22.5], r=0.6, color='#f4f4f4', ring='#0a5a63')
    torso.fill(RRect(-6.0, 15.0, 8.6, 11.0, 0.8, rot=-6), '#1b1a1a')
    torso.fill(RRect(-6.0, 15.0, 7.8, 10.2, 0.6, rot=-6), '#9a6334')
    torso.fill(RRect(-6.0, 15.6, 6.4, 8.4, 0.2, rot=-6), '#ffffff')
    torso.fill(RRect(-6.25, 10.3, 3.0, 1.6, 0.5, rot=-6), '#aab1b8')
    for k in range(3):
        yy = 13.2 + k * 2.6
        xo = -8.0 + (yy - 15) * 0.1
        torso.fill(Stroke([(xo - 0.5, yy), (xo, yy + 0.6), (xo + 1.0, yy - 0.8)], 0.5), '#1f9d55')
        torso.fill(Stroke([(xo + 1.7, yy - 0.2 + 0.1), (xo + 5.0, yy - 0.55)], 0.45), '#7d8790')


# 3 -- Studbot (Brick Tracker mascot)
@figure('studbot', 'Studbot', 'Brick Tracker mascot: a part-counting robot with a bar-chart chest screen',
        torso='#8f979d', arms='#5c6670', headgear=[('14045.dat', 'phones')],
        colors={'phones': '#3b4148'}, head='#c6ccd2', tile=('#7ad7ff', '#2267b3'), ring='#2b3540', mascot=True)
def p_studbot(face, torso):
    face.fill(RRect(0, 9.4, 15.6, 5.6, 2.4), '#1f2a33')
    for side in (-1, 1):
        face.fill(RRect(side * 3.7, 9.4, 3.4, 2.2, 0.9), '#4fe3ff', glow=1.0)
        face.fill(RRect(side * 3.7 - 0.6, 8.9, 1.0, 0.6, 0.3), '#e8fbff', glow=1.0)
    face.fill(RRect(0, 14.4, 7.6, 2.8, 0.9), '#1f2a33')
    for k in range(5):
        face.fill(RRect(-2.6 + k * 1.3, 14.4, 0.55, 1.8, 0.2), '#aeb6bd')
    for side in (-1, 1):
        face.fill(Circle(side * 8.6, 14.0, 0.75), '#7b848c')
        face.fill(Circle(side * 8.6, 14.0, 0.35), '#3b4148')
    # chest screen with a bar chart, three buttons
    torso.fill(RRect(0, 10.6, 15.0, 10.0, 1.4), '#2b3036')
    torso.fill(RRect(0, 10.2, 12.6, 7.4, 0.8), '#0e2a36')
    for k, hgt in enumerate((2.4, 4.2, 3.2, 5.8)):
        torso.fill(RRect(-4.3 + k * 2.9, 13.4 - hgt / 2, 1.8, hgt, 0.3), '#4fe3ff', glow=0.8)
    for k, col in enumerate(('#e3242b', '#ffd500', '#1e6fd9')):
        torso.fill(Circle(-3.6 + k * 3.6, 18.6, 1.15), '#1b1a1a')
        torso.fill(Circle(-3.6 + k * 3.6, 18.6, 0.85), col)
    for side in (-1, 1):
        torso.fill(Circle(side * 8.2, 3.2, 0.7), '#5c6670')


# 4 -- Nova the Astronaut
@figure('astronaut', 'Nova the Astronaut', 'Classic helmet, white suit with orange shoulder flashes and a mission patch',
        torso='#eef0f1', arms='#eef0f1', headgear=[('3842b.dat', 'helmet')],
        colors={'helmet': '#f4f5f6'}, tile=('#3a4f9a', '#0d1640'), ring='#0d1640')
def p_astronaut(face, torso):
    brows(face, t=6.5, arch=0.35, tilt=0.35)
    eyes(face)
    smile(face, t=13.3, half=3.1, sag=1.2, shift=0.4)
    # headset microphone
    face.fill(Stroke([(-9.6, 12.2), (-6.0, 14.6), (-3.6, 14.9)], 0.6), '#3b3b3b')
    face.fill(Circle(-3.4, 14.9, 0.8), '#3b3b3b')
    # suit: orange shoulder flashes, a neck ring, a round mission patch
    for side in (-1, 1):
        torso.fill(Poly([(side * 6.5, -1), (side * 12.5, -1), (side * 20.5, 9.5), (side * 20.5, 13.0)]), '#f57c1f')
    torso.fill(Ellipse(0, 0.2, 7.4, 2.4), '#5c6670')
    torso.fill(Ellipse(0, 0.0, 6.2, 1.6), '#9aa3ad')
    torso.fill(Circle(-5.6, 12.4, 3.6), '#1b1a1a')
    torso.fill(Circle(-5.6, 12.4, 3.2), '#14286b')
    torso.fill(Stroke(arc(-5.6, 12.6, 2.2, 200, 340), 0.45), '#ffd500')
    torso.fill(star(-5.6, 12.7, 1.5), WHITE)
    torso.fill(RRect(-4.0, 10.2, 1.0, 0.7, 0.15), '#e3242b')
    torso.fill(RRect(5.5, 12.0, 4.6, 3.2, 0.5), '#5c6670')
    for k, col in enumerate(('#2a7de1', '#ffd500', '#e3242b')):
        torso.fill(RRect(4.2 + k * 1.3, 12.0, 0.8, 1.8, 0.2), col)
    torso.fill(Stroke([(0, 3.2), (0, 32)], 0.45), '#b3b9bf')


# 5 -- Captain Saltbrick the Pirate
@figure('pirate', 'Captain Saltbrick', 'Pirate captain: tricorne, eye patch, beard and a gold tooth',
        torso='#7b1a1d', arms='#7b1a1d', headgear=[('2544.dat', 'hat')],
        colors={'hat': '#1d1c1c'}, tile=('#2fa5b8', '#0c4d63'), ring='#3b0c0e')
def p_pirate(face, torso):
    # beard first, then the mouth over it
    beard = Poly(np.concatenate([bez((-8.6, 11.6), (-8.2, 19.6), (0, 20.8)), bez((0, 20.8), (8.2, 19.6), (8.6, 11.6))[1:],
                                 bez((8.6, 11.6), (5.0, 12.4), (0, 12.2))[1:], bez((0, 12.2), (-5.0, 12.4), (-8.6, 11.6))[1:-1]]))
    face.fill(beard, '#3e2414')
    grin(face, t=14.0, half=3.0, depth=2.0, lift=0.35, gold=1.2, tongue=False)
    for side in (-1, 1):
        mus = Poly(np.concatenate([bez((0, 12.6), (side * 3.0, 11.2), (side * 5.6, 13.6)), bez((side * 5.6, 13.6), (side * 3.0, 13.2), (0, 13.6))[1:]]))
        face.fill(mus, '#2a170c')
    # eye patch over the figure's right eye (viewer's left), strap across the forehead
    face.fill(Stroke([(-11.5, 4.6), (11.5, 11.0)], 0.7), INK)
    face.fill(Ellipse(-EYE_DX, EYE_T + 0.1, 2.2, 2.0), INK)
    eyes(face, dx=EYE_DX, look=0.0)
    face.fill(Ellipse(-EYE_DX, EYE_T + 0.1, 2.2, 2.0), INK)
    brows(face, t=6.6, tilt=1.1, arch=0.2, only=1)
    face.fill(Stroke(bez((-6.0, 6.0), (-4.0, 5.2), (-1.8, 6.4)), 0.8), INK)
    # coat: white shirt with ruffles, gold buttons, a cross belt
    collar_v(torso, '#f2efe6', depth=10.0, open_w=5.4)
    for k in range(4):
        torso.fill(Stroke(arc(0, 3.5 + k * 1.9, 1.4, 20, 160), 0.4), '#b8b1a0')
    buttons(torso, [-6.2, 6.2], [11.0, 15.5, 20.0], r=0.75, color='#e8b730')
    torso.fill(Poly([(-12.5, -1), (-8.5, -1), (19.5, 26.5), (19.5, 30.0)]), '#4a2a14')
    torso.fill(RRect(4.2, 13.6, 3.0, 2.4, 0.4, rot=43), '#e8b730')
    torso.fill(RRect(4.2, 13.6, 1.6, 1.0, 0.2, rot=43), '#4a2a14')


# 6 -- Mortimer the Wizard
@figure('wizard', 'Mortimer the Wizard', 'Tall wizard hat, white beard and a starry robe',
        torso='#4a2c8a', arms='#4a2c8a', headgear=[('6131.dat', 'hat'), ('6132.dat', 'beard')],
        colors={'hat': '#3a2272', 'beard': '#f1efe8'}, tile=('#8a63d2', '#2c1a5c'), ring='#2c1a5c')
def p_wizard(face, torso):
    for side in (-1, 1):
        b = Poly(np.concatenate([bez((side * 1.4, 7.4), (side * 3.6, 4.6), (side * 7.0, 6.8)), bez((side * 7.0, 6.8), (side * 4.2, 6.6), (side * 1.4, 8.2))[1:]]))
        face.fill(b, '#d9d6cf')
        face.fill(Stroke(np.concatenate([bez((side * 1.4, 7.4), (side * 3.6, 4.6), (side * 7.0, 6.8)), bez((side * 7.0, 6.8), (side * 4.2, 6.6), (side * 1.4, 8.2))[1:]]), 0.35), '#6a6560')
    eyes(face, t=9.8, rx=0.9, ry=1.25)
    for side in (-1, 1):
        face.fill(Stroke([(side * 5.6, 10.8), (side * 6.6, 11.6)], 0.35), '#a77b33')
    mus = Poly(np.concatenate([bez((0, 12.2), (-3.6, 11.4), (-6.0, 15.6)), bez((-6.0, 15.6), (-3.0, 13.8), (0, 13.6))[1:],
                               bez((0, 13.6), (3.0, 13.8), (6.0, 15.6))[1:], bez((6.0, 15.6), (3.6, 11.4), (0, 12.2))[1:-1]]))
    face.fill(mus, '#f1efe8')
    face.fill(Stroke(np.concatenate([mus.p, mus.p[:1]]), 0.35), '#8b867f')
    # robe: gold trim, stars and a crescent moon
    for side in (-1, 1):
        torso.fill(Stroke([(side * 4.8, -1), (side * 1.0, 32)], 1.6), '#e0a92a')
    for (x, y, r) in ((-9.0, 6.0, 1.4), (8.6, 16.5, 1.2), (-7.5, 20.0, 1.0), (10.5, 7.5, 0.9), (-12.0, 13.5, 0.8)):
        torso.fill(star(x, y, r), '#f2c94c')
    torso.fill(Diff(Circle(9.0, 10.5, 2.0), Circle(9.9, 9.9, 1.7)), '#f2c94c')


# 7 -- Sir Brickwell the Knight
@figure('knight', 'Sir Brickwell', 'Knight: steel helmet and a red tabard with a brick crest',
        torso='#a3abb2', arms='#a3abb2', headgear=[('3844.dat', 'helmet')],
        colors={'helmet': ('#a7afb6', 'metal')}, tile=('#e85a4f', '#8f1f1a'), ring='#5c1210')
def p_knight(face, torso):
    brows(face, t=6.6, tilt=0.7, arch=0.25, w=0.9)
    eyes(face)
    smile(face, t=13.2, half=3.2, sag=1.1, shift=-0.3)
    face.fill(Stroke([(4.6, 12.0), (6.0, 14.0)], 0.4), '#c48a5a')
    # chain mail lines under a red tabard with a crest
    for y in np.arange(1.0, 30.0, 1.6):
        torso.fill(Stroke([(-21, y), (21, y)], 0.25), '#7d868e')
    tab = Poly([(-6.5, -1), (6.5, -1), (12.5, 32), (-12.5, 32)])
    torso.fill(tab, '#c4211b')
    torso.fill(Stroke([(-6.5, -1), (-12.5, 32)], 0.8), '#f1f1f1')
    torso.fill(Stroke([(6.5, -1), (12.5, 32)], 0.8), '#f1f1f1')
    shield = Poly(np.concatenate([[(-4.6, 6.0), (4.6, 6.0)], bez((4.6, 6.0), (4.6, 14.5), (0, 17.5))[1:], bez((0, 17.5), (-4.6, 14.5), (-4.6, 6.0))[1:-1]]))
    torso.fill(Stroke(np.concatenate([shield.p, shield.p[:1]]), 0.9), INK)
    torso.fill(shield, '#f1f1f1')
    brick_top(torso, 0, 10.6, 3.4, '#1e5ac8')


# 8 -- Bjorn the Viking
@figure('viking', 'Bjorn the Viking', 'Horned helmet, braided ginger beard and a fur collar',
        torso='#5d3a1e', arms='#5d3a1e', headgear=[('53450c01.dat', 'helmet'), ('60749.dat', 'beard')],
        colors={'helmet': ('#6b7178', 'metal'), 15: '#efe6d2', 'beard': '#c8562b'}, tile=('#7fc4e8', '#2a5f8a'), ring='#3b2412')
def p_viking(face, torso):
    brows(face, t=6.6, tilt=0.8, arch=0.4, w=1.15, length=3.2, color='#a8401c')
    eyes(face)
    grin(face, t=12.6, half=3.4, depth=2.3, lift=0.4)
    for side in (-1, 1):
        mus = Poly(np.concatenate([bez((0, 11.6), (side * 3.4, 10.6), (side * 5.0, 13.6)), bez((side * 5.0, 13.6), (side * 3.0, 12.2), (0, 12.6))[1:]]))
        face.fill(mus, '#c8562b')
    # fur collar and a round brooch
    fur = []
    for k in range(13):
        x = -18 + k * 3
        fur.append((x, 4.4 + (k % 2) * 1.6))
    torso.fill(Poly([(-21, -1), (21, -1)] + [(x, y) for x, y in reversed(fur)]), '#9b8f7d')
    torso.fill(Stroke(fur, 0.45), '#5c5246')
    torso.fill(Circle(-7.5, 9.0, 1.9), '#1b1a1a')
    torso.fill(Circle(-7.5, 9.0, 1.6), '#d8a136')
    torso.fill(Circle(-7.5, 9.0, 0.6), '#8a5a12')
    torso.fill(Stroke([(-21, 21.0), (21, 21.0)], 2.2), '#2d1c0e')


# 9 -- Chef Pierrot
@figure('chef', 'Chef Pierrot', "Cook's hat, curled moustache and a red neckerchief",
        torso='#f3f3f1', arms='#f3f3f1', headgear=[('3898.dat', 'hat')],
        colors={'hat': '#fbfbfa'}, tile=('#ff7b6b', '#c0262d'), ring='#7a1418')
def p_chef(face, torso):
    brows(face, t=6.6, arch=0.6, length=2.6, color='#3c2414')
    happy_eyes(face)
    blush(face, t=12.0, dx=6.8, alpha=0.6)
    grin(face, t=13.9, half=2.8, depth=1.8, lift=0.4, tongue=True)
    for side in (-1, 1):
        pts = np.concatenate([bez((0, 12.4), (side * 2.6, 11.2), (side * 4.8, 12.6)),
                              bez((side * 4.8, 12.6), (side * 6.2, 13.3), (side * 6.0, 11.6))[1:],
                              bez((side * 6.0, 11.6), (side * 5.0, 13.8), (side * 2.6, 13.4))[1:],
                              bez((side * 2.6, 13.4), (side * 1.2, 13.2), (0, 13.4))[1:]])
        face.fill(Poly(pts), '#3c2414')
    # jacket: double buttons, a red neckerchief, a pocket with a spoon
    torso.fill(Poly([(-6.0, -1), (6.0, -1), (3.0, 4.5), (0.0, 6.0), (-3.0, 4.5)]), '#d6202a')
    torso.fill(Poly([(-1.6, 4.4), (1.6, 4.4), (2.6, 9.6), (0, 8.6), (-2.6, 9.6)]), '#b51820')
    torso.fill(Stroke([(-2.0, 7.5), (8.5, 32)], 0.45), '#c9c9c5')
    buttons(torso, [-1.0, 7.0], [12.0, 17.0, 22.0], r=0.75, color='#2f2f2f', ring=None)
    torso.fill(RRect(-7.6, 12.6, 5.0, 0.6, 0.2), '#c9c9c5')
    torso.fill(Ellipse(-8.6, 9.0, 0.9, 1.3), '#9aa3ad')
    torso.fill(Stroke([(-8.6, 10.2), (-8.4, 12.4)], 0.5), '#9aa3ad')


# 10 -- Blaze the Firefighter
@figure('firefighter', 'Blaze the Firefighter', 'Red fire helmet, black jacket with reflective stripes',
        torso='#232323', arms='#232323', headgear=[('3834.dat', 'helmet')],
        colors={'helmet': '#d3221c'}, tile=('#ffb347', '#e0461f'), ring='#232323')
def p_firefighter(face, torso):
    brows(face, t=6.5, tilt=0.6, arch=0.3, w=0.9)
    eyes(face)
    grin(face, t=12.8, half=3.5, depth=2.4, lift=0.45)
    face.fill(Ellipse(-6.8, 13.6, 1.6, 0.9, rot=-20), '#8c7a64', 0.55)
    face.fill(Ellipse(6.2, 6.6, 1.2, 0.6, rot=15), '#8c7a64', 0.45)
    # reflective stripes, a zip with clasps, a radio
    for y in (13.0, 21.5):
        torso.fill(RRect(0, y, 44, 3.0), '#f2c51d')
        torso.fill(RRect(0, y, 44, 1.2), '#d8dde3')
    torso.fill(Stroke([(0, 0.5), (0, 32)], 0.6), '#5a5a5a')
    for y in (7.0, 17.3, 26.0):
        torso.fill(RRect(0, y, 3.2, 1.2, 0.3), '#c2c7cc')
    torso.fill(RRect(-7.2, 6.6, 2.4, 4.0, 0.5), '#3f3f3f')
    torso.fill(RRect(-7.2, 6.0, 1.4, 1.2, 0.2), '#e3242b', glow=0.6)
    torso.fill(Stroke([(-6.6, 4.6), (-6.0, 1.0)], 0.4), '#3f3f3f')


# 11 -- Inspector Inkwell the Detective
@figure('detective', 'Inspector Inkwell', 'Grey fedora, monocle, trench coat and a red tie',
        torso='#c09a62', arms='#c09a62', headgear=[('61506.dat', 'hat')],
        colors={'hat': '#5d6166'}, tile=('#9aa7b8', '#3b4656'), ring='#2b3038')
def p_detective(face, torso):
    brows(face, t=6.2, arch=0.9, only=1, length=2.8, w=0.85)
    brows(face, t=7.0, tilt=0.5, arch=0.15, only=-1, length=2.8, w=0.85)
    eyes(face)
    face.fill(Diff(Circle(EYE_DX, EYE_T, 2.2), Circle(EYE_DX, EYE_T, 1.7)), '#d4a52a')
    face.fill(Stroke(bez((EYE_DX + 1.6, EYE_T + 1.6), (7.5, 14.0), (8.6, 17.5)), 0.35), '#d4a52a')
    face.fill(Stroke(bez((-2.8, 13.6), (0.4, 14.2), (3.0, 12.6)), 0.8), INK)
    face.fill(Stroke(bez((-2.6, 12.2), (0, 11.4), (2.6, 12.0)), 0.7), '#5b3a22')
    # trench coat: lapels, shirt, red tie, buttons
    collar_v(torso, '#f2f2f2', depth=11.0, open_w=6.0)
    torso.fill(Poly([(-1.1, 2.0), (1.1, 2.0), (1.6, 10.5), (0, 12.0), (-1.6, 10.5)]), '#c4211b')
    torso.fill(Poly([(-1.3, 0.5), (1.3, 0.5), (0.8, 2.4), (-0.8, 2.4)]), '#9d1914')
    for side in (-1, 1):
        lap = Poly([(side * 6.0, -1), (side * 10.2, -1), (side * 7.8, 6.0), (side * 9.8, 7.2), (side * 0.2, 12.8)])
        torso.fill(lap, '#a27f4c')
        torso.fill(Stroke(np.concatenate([lap.p, lap.p[:1]]), 0.4), '#6e5430')
    buttons(torso, [-4.2, 4.2], [16.0, 21.5], r=0.7, color='#4a3620', ring=None)


# 12 -- Glim the Ghost
@figure('ghost', 'Glim the Ghost', 'A friendly glow-in-the-dark ghost under a sheet hood',
        torso='#e4f4e8', arms='#e4f4e8', headgear=[('30381.dat', 'hood')],
        colors={'hood': ('#e4f4e8', 'glow')}, head='#eef9f0', tile=('#3b2a6b', '#120c2b'), ring='#120c2b')
def p_ghost(face, torso):
    for side in (-1, 1):
        face.fill(Ellipse(side * 3.6, 9.6, 1.6, 2.3), '#20203a')
        face.fill(Circle(side * 3.6 - 0.5, 8.7, 0.55), WHITE)
    face.fill(Ellipse(0, 14.6, 1.5, 1.8), '#20203a')
    blush(face, t=12.6, dx=6.6, color='#9fd8ff', alpha=0.6)
    # wavy sheet folds
    for k, x in enumerate((-9.0, -3.0, 3.0, 9.0)):
        torso.fill(Stroke(bez((x, 4.0), (x + 1.8, 14.0), (x - 0.6, 30.0)), 0.55), '#bfe3c8')
    torso.fill(Ellipse(0, 15, 6, 5), '#ffffff', 0.25, glow=0.3)


# 13 -- Kumo the Ninja
@figure('ninja', 'Kumo the Ninja', 'Crimson wrap and mask, fierce eyes, a silver throwing star',
        torso='#7a1214', arms='#7a1214', headgear=[('2187.dat', 'wrap')],
        colors={'wrap': '#7a1214'}, tile=('#f2c14e', '#d0701b'), ring='#3a0708')
def p_ninja(face, torso):
    mask = Poly(np.concatenate([[(-21, 11.4)], bez((-21, 11.4), (0, 10.4), (21, 11.4))[1:], [(21, 24), (-21, 24)]]))
    face.fill(mask, '#7a1214')
    face.fill(Stroke(bez((-21, 11.4), (0, 10.4), (21, 11.4)), 0.5), '#4a0a0b')
    face.fill(Poly([(-21, 0), (21, 0), (21, 5.6), (-21, 5.6)]), '#7a1214')
    brows(face, t=7.3, tilt=1.4, arch=0.1, w=1.0, length=3.2)
    for side in (-1, 1):
        face.fill(Ellipse(side * EYE_DX, EYE_T, 1.5, 0.95, rot=side * 12), WHITE)
        face.fill(Circle(side * EYE_DX + 0.3, EYE_T, 0.72), INK)
    # crossed kimono, black sash, silver shuriken
    torso.fill(Poly([(-6.0, -1), (-2.6, -1), (6.5, 13.0), (4.2, 15.0)]), '#4a0a0b')
    torso.fill(Poly([(6.0, -1), (2.6, -1), (-1.2, 7.2), (0.6, 8.6)]), '#4a0a0b')
    torso.fill(RRect(0, 21.5, 44, 4.0), '#1b1a1a')
    torso.fill(RRect(-6.0, 22.5, 2.0, 6.0, 0.4, rot=14), '#1b1a1a')
    sh = Union(*[RRect(6.5, 7.8, 4.4, 1.2, 0.4, rot=a) for a in (0, 45, 90, 135)])
    torso.fill(sh, '#1b1a1a')
    torso.fill(Union(*[RRect(6.5, 7.8, 3.8, 0.7, 0.3, rot=a) for a in (0, 45, 90, 135)]), '#cfd5da')
    torso.fill(Circle(6.5, 7.8, 0.45), '#1b1a1a')


# 14 -- Juniper the Explorer
@figure('explorer', 'Juniper the Explorer', 'Pith helmet, freckles, a safari shirt and a compass',
        torso='#8c8a4c', arms='#8c8a4c', headgear=[('30172.dat', 'hat')],
        colors={'hat': '#e3cf9c'}, tile=('#9ed36a', '#2f7a3a'), ring='#3c3a1c')
def p_explorer(face, torso):
    for side in (-1, 1):
        hair = Poly(np.concatenate([[(side * 6.6, 3.0)], bez((side * 6.6, 3.0), (side * 10.0, 6.0), (side * 11.4, 13.6))[1:],
                                    [(side * 13.5, 13.6), (side * 13.5, 3.0)]]))
        face.fill(hair, '#7a3e22')
    brows(face, t=6.5, arch=0.5, length=2.5, w=0.65, color='#5a2a14')
    eyes(face, rx=0.9, ry=1.3)
    lashes(face)
    freckles(face, t=11.9, dx=6.0)
    upper = bez((-3.2, 13.0), (0, 14.0), (3.2, 13.0))
    lower = bez((3.2, 13.0), (0, 17.6), (-3.2, 13.0))
    m = Poly(np.concatenate([upper, lower[1:-1]]))
    face.fill(m, '#3a1414')
    band = Poly(np.concatenate([upper, (upper + [0, 1.0])[::-1]]))
    face.fill(Inter(m, band), WHITE)
    face.fill(Stroke(np.concatenate([upper, lower[1:]]), 0.4), '#8a2a2a')
    # safari shirt: pockets, red bandana, compass on a strap
    torso.fill(Poly([(-5.6, -1), (5.6, -1), (0, 7.2)]), '#d33a2c')
    torso.fill(Poly([(-1.4, 4.0), (1.4, 4.0), (2.0, 9.2), (0, 8.0), (-2.0, 9.2)]), '#b02a1f')
    for side in (-1, 1):
        torso.fill(RRect(side * 7.0, 13.0, 5.2, 5.6, 0.5), '#6f6d38')
        torso.fill(RRect(side * 7.0, 13.0, 4.4, 4.8, 0.4), '#8c8a4c')
        torso.fill(Poly([(side * 4.4, 10.2), (side * 9.6, 10.2), (side * 9.6, 11.6), (side * 7.0, 12.6), (side * 4.4, 11.6)]), '#6f6d38')
    torso.fill(Stroke([(-11.0, 0.0), (3.0, 20.0)], 0.9), '#4a3620')
    torso.fill(Circle(3.4, 20.4, 2.3), '#1b1a1a')
    torso.fill(Circle(3.4, 20.4, 1.9), '#d8a136')
    torso.fill(Circle(3.4, 20.4, 1.4), '#f4f1e6')
    torso.fill(Poly([(3.4, 19.0), (3.9, 20.4), (3.4, 21.8), (2.9, 20.4)]), '#d3221c')


def by_key():
    return {f['key']: f for f in FIGURES}
