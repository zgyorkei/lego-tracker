"""Brick Tracker logo proposals: the figures and their face and torso prints.

Pure Python + numpy (no bpy), imported by render_bust.py and finish.py.

FIGURES (the 14 of LT.LOGO.MINIFIGS) and EXTRA (Dex the Raver) are original
characters made for Brick Tracker. FRANCHISE (LT.LOGO.MINIFIGS.FIX1) holds the
characters the user named in his request: Darth Vader, Darth Jar-Jar, Batman and
three Hidden Side figures; they carry Lucasfilm, DC and LEGO Group marks and are
for his own choosing. The parts are standard LDraw minifigure parts (LDraw.org
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
           ring='#1d2b53', original=True, mascot=False, cam_el=12.0, phones=None, into=None,
           head_part=None, owner=None, cut_y=16.0, saber=None):
    """cam_el: the camera's elevation in degrees (lower it for a helmet whose brim hides the eyes).
    phones: headphones modelled by render_bust.py (see PHONES below), fitted to the head and hair.
    into: the list the figure goes in (FIGURES unless given).
    head_part: an LDraw part in place of the plain head (a character head such as the Gungan one); it gets no face print.
    owner: for a franchise figure, who owns the character (shown as a tag on the pages).
    cut_y: the LDraw y on the torso where the bust is cut (16: the usual bust; lower it for a wider crop).
    saber: a lightsaber modelled by render_bust.py: dict(hilt=(x, y, z), tip=(x, y, z), color, core, r), LDraw points."""
    def deco(fn):
        (FIGURES if into is None else into).append(
            dict(key=key, name=name, blurb=blurb, torso=torso, arms=arms, headgear=headgear,
                 colors=colors, head=head, tile=tile, ring=ring, prints=fn, mascot=mascot,
                 cam_el=cam_el, phones=phones, original=original, head_part=head_part,
                 owner=owner, cut_y=cut_y, saber=saber))
        return fn
    return deco


# Headphones are modelled by render_bust.py, not taken from LDraw: the library's one
# headphone part (14045, ear muffs) clips onto a bare head's stud with its cups at jaw
# height and cannot sit over hair. Sizes are LDU; a colour is '#hex' or ('#hex', kind).
#   color   band and cup shells       cushion  the ear pads
#   R, D    cup radius and depth      w, th    band width (front to back) and thickness
#   tilt    the band's plane leans back by this many degrees (clears a bare head's stud)
#   q       how far the band presses into the hair (quantile of the hair under it; 1.0 = on top)
#   cap     a dome on each cup's outside, or None     led   a glowing ring on each cup, or None
def phones(color, cushion='#23262b', R=5.0, D=3.8, w=3.4, th=1.4, tilt=8.0, q=0.75, cap=None, led=None):
    return dict(color=color, cushion=cushion, R=R, D=D, w=w, th=th, tilt=tilt, q=q, cap=cap, led=led)


EAR_T = 10.5        # ear centre: half way down the head's straight side (t 4 .. 17)


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
        torso='#8f979d', arms='#5c6670', headgear=[], colors={}, head='#c6ccd2', tile=('#7ad7ff', '#2267b3'),
        ring='#2b3540', mascot=True,
        phones=phones('#3b4148', cushion='#22262b', R=5.2, D=3.9, w=3.6, th=1.5, tilt=32.0, q=1.0))
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
    face.fill(Stroke([(-11.5, 12.6), (-EYE_DX, EYE_T + 0.1), (11.5, 2.2)], 0.7), INK)
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
        colors={'helmet': ('#6b7178', 'metal'), 15: '#efe6d2', 'beard': '#c8562b'}, tile=('#7fc4e8', '#2a5f8a'), ring='#3b2412',
        cam_el=4.0)
def p_viking(face, torso):
    # eyes a little low, so they show between the helmet's brim and the beard
    brows(face, t=8.4, tilt=0.8, arch=0.3, w=1.0, length=3.0, color='#a8401c')
    eyes(face, t=10.9, ry=1.25)
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
        torso='#b9ebc9', arms='#b9ebc9', headgear=[('30381.dat', 'hood')],
        colors={'hood': ('#c4f0d2', 'glow')}, head='#d6f6e0', tile=('#3b2a6b', '#120c2b'), ring='#120c2b')
def p_ghost(face, torso):
    for side in (-1, 1):
        face.fill(Ellipse(side * 3.6, 9.6, 1.6, 2.3), '#20203a')
        face.fill(Circle(side * 3.6 - 0.5, 8.7, 0.55), WHITE)
    face.fill(Ellipse(0, 14.6, 1.5, 1.8), '#20203a')
    blush(face, t=12.6, dx=6.6, color='#9fd8ff', alpha=0.6)
    # wavy sheet folds
    for k, x in enumerate((-9.0, -3.0, 3.0, 9.0)):
        torso.fill(Stroke(bez((x, 4.0), (x + 1.8, 14.0), (x - 0.6, 30.0)), 0.55), '#86c99c')
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


# ---------------------------------------------------------------------------
# LT.LOGO.SHORTLIST: Dex the Raver, the user's new figure ("a normal guy with spikey
# messy short hair, headphone over his ears, acid smiley tshirt or something ravey")
# in four variants. They live in EXTRA, not FIGURES, so finish.py and pages a..d stay
# as they were; by_key() covers both lists.

EXTRA = []


def smiley(c, cx, cy, r, face='#ffd400', ink=INK, glow=0.0, ink_glow=0.0, rim=0.38):
    """A plain smiley: a round face, two upright oval eyes and a wide smile with creases."""
    if rim:
        c.fill(Circle(cx, cy, r + rim), ink, glow=ink_glow)
    c.fill(Circle(cx, cy, r), face, glow=glow)
    for side in (-1, 1):
        c.fill(Ellipse(cx + side * 0.33 * r, cy - 0.27 * r, 0.11 * r, 0.21 * r), ink, glow=ink_glow)
    c.fill(Stroke(arc(cx, cy + 0.02 * r, 0.6 * r, 22, 158), 0.12 * r), ink, glow=ink_glow)
    for side in (-1, 1):
        a = math.radians(90 - side * 68)
        ex, ey = cx + 0.6 * r * math.cos(a), cy + 0.02 * r + 0.6 * r * math.sin(a)
        c.fill(Stroke([(ex - side * 0.12 * r, ey - 0.12 * r), (ex + side * 0.08 * r, ey + 0.1 * r)], 0.09 * r),
               ink, glow=ink_glow)


def tie_dye(c, cx, cy, palette, arms=3, twist=0.42):
    """Fill the whole canvas with a tie-dye spiral (soft bands of the palette, pale crinkle lines)."""
    xs = c.x0 + (np.arange(c.W) + 0.5) / c.ppu
    ys = c.y0 + (np.arange(c.H) + 0.5) / c.ppu
    X, Y = np.meshgrid(xs, ys)
    dx, dy = X - cx, Y - cy
    r = np.hypot(dx, dy)
    th = np.arctan2(dy, dx)
    wob = 0.035 * np.sin(th * 7 + r * 0.9) + 0.02 * np.sin(r * 2.3)
    h = (arms * th / (2 * math.pi) + twist * r / (2 * math.pi) * 2.2 + wob) % 1.0
    pal = np.array([hex_rgb(p) for p in palette], np.float32)
    n = len(pal)
    f = h * n
    i0 = np.floor(f).astype(int) % n
    i1 = (i0 + 1) % n
    k = (f - np.floor(f))[..., None]
    k = k * k * (3 - 2 * k)                    # soft but distinct bands
    rgb = pal[i0] * (1 - k) + pal[i1] * k
    edge = np.abs((f % 1.0) - 0.5)             # pale where the dye bled between bands
    pale = np.clip((edge - 0.43) / 0.07, 0, 1)[..., None] * 0.45
    rgb = rgb * (1 - pale) + pale
    c.rgb[:] = rgb.astype(np.float32)
    c.a[:] = 1.0


def checker_band(c, y0, rows, size, dark=INK):
    for j in range(rows):
        for i in range(-12, 12):
            if (i + j) % 2:
                c.fill(RRect(i * size + size / 2, y0 + j * size + size / 2, size, size), dark)


RAVER_BLURB = 'Dex the Raver: spiky messy hair, headphones over his ears, %s'


# 15 -- Dex: Acid
@figure('raver-acid', 'Dex: Acid', RAVER_BLURB % 'big black DJ cans and the yellow acid smiley on a black tee',
        torso='#1e1e20', arms='#1e1e20', headgear=[('53981.dat', 'hair')], colors={'hair': '#6b3a1e'},
        tile=('#ff5ea8', '#7a1e8f'), ring='#3a0d44', into=EXTRA,
        phones=phones('#1c1c1e', cushion='#2f2f31', R=5.8, D=4.6, w=4.4, th=1.7, q=0.7,
                      cap=('#b9c0c7', 'metal')))
def p_raver_acid(face, torso):
    brows(face, t=6.3, arch=0.75, length=2.9, color='#4a2410')
    eyes(face)
    grin(face, t=12.7, half=3.8, depth=2.8, lift=0.5)
    smiley(torso, 0.0, 8.4, 5.4)


# 16 -- Dex: Checker
@figure('raver-checker', 'Dex: Checker', RAVER_BLURB % 'a slim silver band and a smiley on a checkerboard band',
        torso='#f2f2ef', arms='#f2f2ef', headgear=[('2631.dat', 'hair')], colors={'hair': '#f0de8c'},
        tile=('#4fd1ff', '#1f5fbf'), ring='#0f2f63', into=EXTRA,
        phones=phones(('#c3c9cf', 'metal'), cushion='#2f3339', R=4.5, D=3.1, w=2.3, th=1.1, q=0.75))
def p_raver_checker(face, torso):
    brows(face, t=6.4, arch=0.55, length=2.7, color='#b08a3a')
    happy_eyes(face)
    grin(face, t=12.8, half=3.5, depth=2.5, lift=0.45)
    checker_band(torso, 9.6, 4, 1.75)
    smiley(torso, 0.0, 8.2, 4.7, rim=0.45)


# 17 -- Dex: Tie-dye
@figure('raver-tiedye', 'Dex: Tie-dye', RAVER_BLURB % 'neon-lime cans and a neon smiley on a tie-dye spiral',
        torso='#8a4dff', arms='#8a4dff', headgear=[('36762.dat', 'hair')], colors={'hair': '#ff3fa4'},
        tile=('#ffd23f', '#ff7a00'), ring='#7a2a00', into=EXTRA,
        phones=phones('#9ee21a', cushion='#1f1f1f', R=5.4, D=4.2, w=3.8, th=1.5, q=0.7, cap=('#1f1f1f', 'plastic')))
def p_raver_tiedye(face, torso):
    brows(face, t=6.2, arch=0.6, length=2.8, tilt=-0.3, color='#b0206a')
    eyes(face)
    grin(face, t=12.8, half=3.6, depth=2.7, lift=0.5)
    blush(face, t=12.4, dx=6.6, alpha=0.45)
    tie_dye(torso, 0.0, 8.6, ['#ff3fa4', '#ff8a1f', '#ffe11f', '#5ee34a', '#29c3ff', '#8a4dff'])
    smiley(torso, 0.0, 8.4, 5.0, face='#c8ff2e', glow=0.35)


# 18 -- Dex: Glow
@figure('raver-glow', 'Dex: Glow', RAVER_BLURB % 'slim white cans with LED rings and glow sticks on a dark tee',
        torso='#1d2133', arms='#1d2133', headgear=[('40233.dat', 'hair')], colors={'hair': '#27cfe3'},
        tile=('#24345f', '#070a17'), ring='#070a17', into=EXTRA,
        phones=phones('#f3f4f6', cushion='#2a2d33', R=4.8, D=3.4, w=2.6, th=1.2, q=0.75, led='#38f2ff'))
def p_raver_glow(face, torso):
    brows(face, t=6.4, arch=0.5, length=2.7, color='#178a99')
    happy_eyes(face)
    grin(face, t=12.8, half=3.5, depth=2.5, lift=0.45)
    # a glow-stick necklace around the collar
    torso.fill(Stroke(arc(0, -3.0, 8.2, 25, 155), 0.9), '#38f2ff', glow=1.0)
    # two glow sticks crossed on the chest, end caps darker
    for (a, b, col, cap) in (((-7.2, 3.6), (6.6, 14.2), '#7dff3a', '#2f6b17'),
                             ((7.2, 3.6), (-6.6, 14.2), '#ff4fd8', '#6b1a5c')):
        torso.fill(Stroke([a, b], 1.6), col, glow=1.0)
        torso.fill(Stroke([b, (b[0] + (a[0] - b[0]) * 0.07, b[1] + (a[1] - b[1]) * 0.07)], 1.7), cap)
    smiley(torso, -0.2, 8.9, 2.5, face='#ffe83a', glow=0.9, rim=0.3)


# ---------------------------------------------------------------------------
# Franchise figures (LT.LOGO.MINIFIGS.FIX1): the characters the user named in his
# request, drawn at his word for his own app. They carry the marks of their owners
# (Lucasfilm, DC, the LEGO Group), so the pages show them apart from the originals,
# and the three mascots stay the safe picks for a published app.

FRANCHISE = []


def bat_emblem(cx, cy, w):
    """The bat emblem, w wide: wings with a scalloped lower edge, two ears, a pointed tail."""
    half = [(0.08, -0.17), (0.14, -0.33), (0.25, -0.12), (0.55, -0.30), (1.0, -0.14),
            (0.86, 0.10), (0.70, 0.03), (0.55, 0.22), (0.38, 0.11), (0.19, 0.29), (0.0, 0.46)]
    right = [(cx + x * w / 2, cy + y * w / 2) for x, y in half]
    left = [(cx - x * w / 2, cy + y * w / 2) for x, y in reversed(half[:-1])]
    return Poly(right + left)


# 19 -- Darth Vader (Lucasfilm)
@figure('vader', 'Darth Vader', 'Star Wars: the black helmet over the mask, the chest panel with its lit buttons',
        torso='#1b1a1a', arms='#1b1a1a', headgear=[('30368.dat', 'helmet')], colors={'helmet': '#1b1a1a'},
        head='#1b1a1a', tile=('#e3242b', '#5a0b0b'), ring='#2a0505', original=False, into=FRANCHISE,
        owner='Lucasfilm')
def p_vader(face, torso):
    grey, steel = '#8d949b', '#4a4f55'
    # the mask: two dark eye lenses in grey rims, cheek lines, the triangular mouth grille
    for side in (-1, 1):
        face.fill(Poly([(side * 1.0, 7.8), (side * 6.8, 7.1), (side * 6.4, 11.4), (side * 1.4, 10.8)]), grey)
        face.fill(Poly([(side * 1.5, 8.3), (side * 6.2, 7.7), (side * 5.9, 10.8), (side * 1.8, 10.3)]), '#0b0c0d')
        face.fill(Ellipse(side * 4.4, 8.6, 1.0, 0.4, rot=-side * 8), '#7d8890', 0.8)
        face.fill(Stroke([(side * 6.4, 11.4), (side * 7.8, 18.0)], 0.6), grey)
        face.fill(Stroke([(side * 1.4, 10.8), (side * 3.7, 17.0)], 0.5), grey)
    face.fill(Poly([(0, 11.0), (3.8, 17.6), (-3.8, 17.6)]), grey)
    face.fill(Poly([(0, 12.4), (2.8, 17.0), (-2.8, 17.0)]), '#111214')
    for x in (-1.4, -0.7, 0.0, 0.7, 1.4):
        face.fill(Stroke([(x, 13.8 + abs(x) * 0.7), (x, 16.6)], 0.22), grey)
    face.fill(Stroke([(-5.4, 19.0), (5.4, 19.0)], 0.5), grey)
    # shoulder armour, the chest box with its buttons, the belt boxes
    torso.fill(Stroke(arc(0, -4.0, 9.0, 20, 160), 1.1), grey)
    for side in (-1, 1):
        torso.fill(Stroke(bez((side * 4.0, 2.2), (side * 9.0, 4.6), (side * 14.0, 3.2)), 0.6), steel)
    torso.fill(RRect(0, 11.5, 10.4, 7.4, 0.8), '#b9c0c7')
    torso.fill(RRect(0, 11.5, 9.2, 6.2, 0.5), '#26292d')
    for (x, y, c) in ((-2.9, 9.7, '#e3242b'), (-1.0, 9.7, '#2fbf4a'), (1.0, 9.7, '#2a7de1'), (2.9, 9.7, '#e3242b'),
                      (-2.9, 11.9, '#d8dde3'), (-1.0, 11.9, '#e3242b'), (1.0, 11.9, '#d8dde3'), (2.9, 11.9, '#2fbf4a')):
        torso.fill(RRect(x, y, 1.4, 1.2, 0.2), c, glow=0.5)
    for x in (-3.0, -1.5, 0.0, 1.5, 3.0):
        torso.fill(RRect(x, 13.9, 0.8, 0.9, 0.15), grey)
    torso.fill(RRect(0, 27.0, 44, 3.4), '#26292d')
    for x in (-6.5, -2.2, 2.2, 6.5):
        torso.fill(RRect(x, 27.0, 3.0, 2.4, 0.3), '#b9c0c7')


# 20 -- Darth Jar-Jar (Lucasfilm; the fan theory of Jar Jar Binks as a Sith lord)
# LT.LOGO.TOON (the user: "should show more so it is clear who he is"): the hood is down on
# his shoulders (15428) so the Gungan head shows whole, ears, eye stalks and snout, with a
# black cape for the robe, a crop down to the belt (cut_y) and a modelled red lightsaber.
@figure('darth-jarjar', 'Darth Jar-Jar', 'Star Wars fan theory: Jar Jar Binks as a Sith lord, black hooded robe and a red lightsaber',
        torso='#1b1a1a', arms='#1b1a1a', headgear=[('15428.dat', 'hood'), ('4524.dat', 'cape')],
        colors={'hood': '#1b1a1a', 'cape': '#1b1a1a'},
        head='#d08a4b', head_part='30371.dat', tile=('#b3121b', '#1a0406'), ring='#1a0406',
        original=False, into=FRANCHISE, owner='Lucasfilm', cut_y=30.0,
        saber=dict(hilt=(-16.0, 30.0, -16.0), tip=(34.0, -30.0, -16.0), color='#ff1f1f', core='#ffe8e4', r=1.9))
def p_darth_jarjar(face, torso):
    # the robe's crossed collar and folds, a belt
    torso.fill(Poly([(-6.5, -1), (-2.6, -1), (0.0, 8.5), (2.6, -1), (6.5, -1), (0.0, 13.5)]), '#2e2e33')
    for x in (-8.0, -3.5, 3.5, 8.0):
        torso.fill(Stroke(bez((x * 0.8, 15.0), (x * 1.05, 22.0), (x * 1.15, 32.0)), 0.5), '#38383f')
    torso.fill(RRect(0, 23.0, 44, 2.6), '#3a2a20')
    torso.fill(RRect(0, 23.0, 2.6, 2.2, 0.3), '#9aa1a8')
    # the red lightsaber is modelled by render_bust.py (saber=), no longer printed here


# 21 -- Batman (DC)
@figure('batman', 'Batman', 'DC: the black cowl with its ears, white eyes, and the bat emblem in a yellow oval',
        torso='#5b6066', arms='#5b6066', headgear=[('10113.dat', 'cowl')], colors={'cowl': '#1b1a1a'},
        head='#f6d7b3', tile=('#3b4a7a', '#0d1226'), ring='#0d1226', original=False, into=FRANCHISE,
        owner='DC')
def p_batman(face, torso):
    # the mask's lower edge on the head print, white eyes, a firm mouth and a chin line
    face.fill(Poly([(-21, 0), (21, 0), (21, 11.8), (6.8, 12.2), (2.0, 11.0), (0, 11.6), (-2.0, 11.0),
                    (-6.8, 12.2), (-21, 11.8)]), '#1b1a1a')
    for side in (-1, 1):
        face.fill(Poly([(side * 1.8, 9.6), (side * 6.0, 8.1), (side * 5.4, 10.5), (side * 2.2, 10.5)]), WHITE)
    face.fill(Stroke(bez((-3.0, 14.6), (0, 13.8), (3.0, 14.6)), 0.8), INK)
    face.fill(Stroke(bez((-1.4, 16.8), (0, 17.1), (1.4, 16.8)), 0.45), '#b88a5c')
    # the emblem in its yellow oval, chest lines, the yellow utility belt
    torso.fill(Ellipse(0, 9.6, 9.0, 5.3), INK)
    torso.fill(Ellipse(0, 9.6, 8.4, 4.7), '#f7d117')
    torso.fill(bat_emblem(0, 9.6, 14.8), INK)
    for side in (-1, 1):
        torso.fill(Stroke(bez((side * 2.0, 16.5), (side * 6.0, 18.5), (side * 10.0, 16.0)), 0.45), '#3d4146')
    torso.fill(Stroke([(0, 15.6), (0, 24.5)], 0.45), '#3d4146')
    torso.fill(RRect(0, 28.0, 44, 3.6), '#f7d117')
    torso.fill(RRect(0, 28.0, 3.6, 3.0, 0.4), '#c9a40c')
    for x in (-7.0, -4.2, 4.2, 7.0):
        torso.fill(RRect(x, 28.0, 2.0, 2.6, 0.3), '#d9b414')


HS_TILE = ('#2fd3a8', '#0c3b46')        # Hidden Side: teal to a dark night blue


# 22 -- Jack Davids (Hidden Side, the LEGO Group)
@figure('jack-davids', 'Jack Davids', 'Hidden Side: messy brown hair under a red backwards cap, a white hoodie with red stripes',
        torso='#f2f2f2', arms='#f2f2f2', headgear=[('65730p02.dat', 'hair'), ('15428.dat', 'hood')],
        colors={'hair': '#4a2c1a', 'hood': '#f2f2f2'}, tile=HS_TILE, ring='#0c3b46', original=False, into=FRANCHISE,
        owner='LEGO Hidden Side')
def p_jack(face, torso):
    brows(face, t=6.6, arch=0.5, length=2.8, color='#4a2c1a')
    eyes(face)
    grin(face, t=12.9, half=3.4, depth=2.3, lift=0.5, shift=0.4)
    # the hoodie: laces, two red stripes, a kangaroo pocket
    for side in (-1, 1):
        torso.fill(Stroke(bez((side * 1.6, 1.5), (side * 2.2, 6.0), (side * 1.8, 10.5)), 0.4), '#c9cdd1')
        torso.fill(Circle(side * 1.8, 10.8, 0.55), '#c9cdd1')
    for y in (13.2, 15.2):
        torso.fill(RRect(0, y, 44, 1.1), '#d3221c')
    pocket = [(-8.5, 32), (-6.5, 21.0), (6.5, 21.0), (8.5, 32)]
    torso.fill(Poly(pocket), '#e3e5e8')
    torso.fill(Stroke(pocket, 0.4), '#b5babf')


# 23 -- Parker L. Jackson (Hidden Side, the LEGO Group)
@figure('parker-jackson', 'Parker L. Jackson', 'Hidden Side: lavender hair in two braids, a black top, a coral bag strap and a P necklace',
        torso='#1b1a1a', arms='#1b1a1a', headgear=[('35714.dat', 'hair')], colors={'hair': '#a38bc7'},
        tile=('#ffd23f', '#e0457b'), ring='#5a1838', original=False, into=FRANCHISE,
        owner='LEGO Hidden Side')
def p_parker(face, torso):
    brows(face, t=6.6, arch=0.6, length=2.6, w=0.7, color='#6b4a8a')
    eyes(face)
    lashes(face)
    grin(face, t=12.9, half=3.2, depth=2.2, lift=0.45, tongue=False)
    # the coral bag on a strap across the chest, a silver necklace with a P pendant
    torso.fill(Stroke([(-9.0, -0.5), (7.0, 24.0)], 1.5), '#ff7f6e')
    torso.fill(RRect(4.0, 19.5, 9.0, 4.2, 1.9, rot=56), '#ff7f6e')
    torso.fill(Stroke(bez((1.2, 16.4), (3.6, 19.6), (6.4, 22.8)), 0.35), '#c4574a')
    torso.fill(Stroke(arc(0, -1.5, 6.8, 30, 150), 0.35), '#c9cdd1')
    torso.fill(Circle(0, 5.9, 1.3), '#c9cdd1')
    torso.fill(Stroke([(-0.4, 6.8), (-0.4, 5.0)], 0.35), INK)
    torso.fill(Stroke(arc(-0.2, 5.55, 0.55, -90, 90), 0.32), INK)


# 24 -- Possessed Chef Enzo (Hidden Side, the LEGO Group)
@figure('possessed-enzo', 'Possessed Chef Enzo', 'Hidden Side: a chef taken over by a ghost, neon-green head, glowing eyes and slime',
        torso='#f2f2f2', arms='#f2f2f2', headgear=[('98381.dat', 'hat')], colors={'hat': '#f2f2f2'},
        head='#6fe84a', tile=('#5b2fa8', '#0b0618'), ring='#0b0618', original=False, into=FRANCHISE,
        owner='LEGO Hidden Side')
def p_enzo(face, torso):
    dg, lime = '#1f5a1c', '#c8ff2e'
    for side in (-1, 1):
        face.fill(Ellipse(side * EYE_DX, EYE_T, 2.3, 1.9), lime, glow=1.0)
        face.fill(Ellipse(side * EYE_DX, EYE_T, 1.2, 1.3), '#0d2b0b')
        face.fill(Circle(side * EYE_DX, EYE_T, 0.5), '#eaffd0', glow=1.0)
        face.fill(Stroke(bez((side * 1.2, 7.4), (side * 3.6, 5.6), (side * 6.4, 6.6)), 1.3), dg)
        face.fill(Poly([(side * 7.4, 7.0), (side * 9.4, 7.5), (side * 9.8, 16.5), (side * 7.4, 15.0)]), dg)
    # moustache, an open frown with a tongue, slime dripping
    for side in (-1, 1):
        face.fill(Stroke(bez((side * 5.2, 13.4), (side * 2.0, 11.4), (0, 12.2)), 1.2), dg)
    face.fill(Ellipse(0, 15.4, 2.6, 1.7), '#0f3a0d')
    face.fill(Ellipse(0, 16.4, 1.6, 0.8), '#e65a7a')
    face.fill(Stroke([(1.6, 16.6), (1.9, 19.5)], 0.7), '#9bff3c', glow=0.8)
    face.fill(Circle(1.9, 19.7, 0.65), '#9bff3c', glow=0.8)
    # a white chef's jacket under a sand-green apron with glowing green slime, a pen and a pad
    apron = Poly([(-7.0, 9.0), (7.0, 9.0), (8.5, 32), (-8.5, 32)])
    torso.fill(apron, '#a0bcac')
    for side in (-1, 1):
        torso.fill(Stroke([(side * 6.6, 9.4), (side * 4.0, -1.0)], 0.8), '#a0bcac')
    for (x, y, r) in ((-3.5, 15.0, 1.4), (2.8, 20.5, 1.8), (-1.0, 26.5, 1.2), (5.2, 27.5, 0.9)):
        torso.fill(Circle(x, y, r), '#3f9a2a', 0.9, glow=0.4)
    torso.fill(RRect(-4.6, 12.0, 3.6, 2.6, 0.3), '#7f9c8c')
    torso.fill(RRect(-5.4, 10.8, 0.6, 3.0, 0.2), '#2a7de1')
    torso.fill(RRect(-3.9, 11.0, 1.8, 2.4, 0.2), WHITE)


# ---------------------------------------------------------------------------
# LT.LOGO.TOON: original figures for the toon page, one in the place of each
# franchise pick (Batman, Darth Jar-Jar, Possessed Chef Enzo). They are new
# characters made for Brick Tracker, not redraws of the franchise ones.

TOON = []


# 28 -- Captain Clutch (in the place of the Batman pick)
@figure('clutch', 'Captain Clutch', 'An original caped hero: a navy domino mask, a teal suit, orange cape ties and a brick emblem',
        torso='#0f8f8a', arms='#0f8f8a', headgear=[('62696.dat', 'hair')],
        colors={'hair': '#3a2414'}, tile=('#ffb23e', '#e2551b'), ring='#0b4d4a', into=TOON)
def p_clutch(face, torso):
    navy, orange = '#1d2b53', '#f07a1f'
    mask = Poly(np.concatenate([bez((-8.4, 7.6), (-4.2, 6.2), (0, 8.2)), bez((0, 8.2), (4.2, 6.2), (8.4, 7.6))[1:],
                                bez((8.4, 7.6), (8.2, 12.0), (4.2, 11.8))[1:], bez((4.2, 11.8), (1.4, 11.6), (0, 10.6))[1:],
                                bez((0, 10.6), (-1.4, 11.6), (-4.2, 11.8))[1:], bez((-4.2, 11.8), (-8.2, 12.0), (-8.4, 7.6))[1:-1]]))
    face.fill(mask, navy)
    for side in (-1, 1):
        face.fill(Ellipse(side * EYE_DX, 9.5, 1.55, 1.05), WHITE)
        face.fill(Ellipse(side * EYE_DX + 0.25, 9.6, 0.62, 0.78), INK)
        face.fill(Stroke(bez((side * 1.6, 6.2), (side * 3.8, 5.0), (side * 6.2, 5.8)), 0.8), '#3a2414')
    smile(face, t=13.7, half=3.0, sag=1.25, shift=0.3)
    # the suit: an emblem disc with a 2x2 brick, orange cape ties and clasps, a belt line
    torso.fill(Circle(0, 14.0, 6.6), INK)
    torso.fill(Circle(0, 14.0, 6.0), orange)
    brick_top(torso, 0, 14.0, 5.4, '#ffd23e', studs=(2, 2))
    for side in (-1, 1):
        torso.fill(Stroke([(side * 10.5, -1.0), (side * 6.6, 4.6)], 2.0), orange)
        torso.fill(Circle(side * 6.4, 4.8, 1.5), INK)
        torso.fill(Circle(side * 6.4, 4.8, 1.05), '#ffd23e')
    torso.fill(RRect(0, 27.0, 40.0, 2.4, 0.3), navy)
    torso.fill(RRect(0, 27.0, 3.4, 2.0, 0.3), '#ffd23e')


# 29 -- Lord Grumble (in the place of the Darth Jar-Jar pick)
@figure('grumble', 'Lord Grumble', 'An original clumsy dark lord: a crooked gold crown, a high purple collar and a buck-toothed scheming grin',
        torso='#3b1f5c', arms='#3b1f5c', headgear=[('18165.dat', 'crown'), ('20551c01.dat', 'cape')],
        colors={'crown': ('#e8b23a', 'metal'), 'cape': '#5a2d8c'}, tile=('#f05a5a', '#6e0f2a'), ring='#3a0716',
        into=TOON)
def p_grumble(face, torso):
    gold, brown = '#e8b23a', '#3c2414'
    # one brow down in a scowl, the other up: scheming
    brows(face, t=6.9, tilt=1.6, arch=0.2, w=0.95, only=-1)
    brows(face, t=5.9, tilt=-0.4, arch=0.9, w=0.95, only=1)
    eyes(face, t=9.7, rx=1.0, ry=1.3, look=0.35)
    # a gold monocle on his left eye, its chain down the cheek
    face.fill(Diff(Circle(EYE_DX, 9.7, 2.25), Circle(EYE_DX, 9.7, 1.75)), gold)
    face.fill(Stroke(bez((EYE_DX + 2.0, 10.6), (7.4, 14.0), (6.8, 18.5)), 0.32), gold)
    # a curled moustache over a lopsided grin with two buck teeth
    for side in (-1, 1):
        face.fill(Stroke(bez((0, 12.4), (side * 3.0, 11.6), (side * 4.6, 12.8), (side * 5.6, 11.2)), 0.9), brown)
        face.fill(Circle(side * 5.5, 11.0, 0.55), brown)
    upper = bez((-3.6, 14.0), (0.2, 13.4), (3.4, 13.4))
    lower = bez((3.4, 13.4), (0.6, 17.4), (-3.6, 14.0))
    mouth = Poly(np.concatenate([upper, lower[1:-1]]))
    face.fill(mouth, '#3a1414')
    for x in (-0.75, 0.75):
        face.fill(RRect(x, 14.55, 1.35, 1.7, 0.3), WHITE)
    face.fill(Stroke(np.concatenate([upper, lower[1:]]), 0.42), INK)
    # the robe: gold trim, a chain across the chest and a cracked brick pendant
    for side in (-1, 1):
        torso.fill(Stroke([(side * 4.4, -1), (side * 1.2, 32)], 1.4), gold)
    torso.fill(Stroke(bez((-10.0, 3.0), (-4.0, 11.0), (0, 11.6)), 0.7), gold)
    torso.fill(Stroke(bez((10.0, 3.0), (4.0, 11.0), (0, 11.6)), 0.7), gold)
    brick_top(torso, 0, 15.6, 4.6, gold, studs=(2, 2))
    torso.fill(Stroke([(-0.6, 12.0), (0.5, 14.2), (-0.7, 16.0), (0.6, 18.0), (0.0, 19.2)], 0.45), INK)


# 30 -- Chef Gusto, haunted (in the place of the Possessed Chef Enzo pick)
@figure('haunted-chef', 'Chef Gusto, haunted', 'An original possessed chef: glowing ghost-blue eyes, a wobbly grin and ghostly wisps on his whites',
        torso='#f3f3f1', arms='#f3f3f1', headgear=[('3898.dat', 'hat')],
        colors={'hat': '#fbfbfa'}, head='#c9d6e8', tile=('#38c6d9', '#13254d'), ring='#0d1834', into=TOON)
def p_haunted_chef(face, torso):
    cyan, socket, plum = '#5ff2ff', '#283050', '#6b3fa0'
    for side in (-1, 1):
        face.fill(Ellipse(side * EYE_DX, EYE_T, 2.2, 2.0), socket)
        face.fill(Ellipse(side * EYE_DX, EYE_T + 0.1, 1.35, 1.45), cyan, glow=1.0)
        face.fill(Circle(side * EYE_DX, EYE_T + 0.1, 0.5), '#eaffff', glow=1.0)
    brows(face, t=6.3, tilt=1.4, arch=0.3, w=0.9, color='#2a2238')
    # a thin curled moustache, then a wide wobbly grin with a row of teeth
    for side in (-1, 1):
        face.fill(Stroke(bez((0, 12.6), (side * 2.4, 11.8), (side * 4.2, 12.6), (side * 4.6, 11.4)), 0.6), '#2a2238')
    upper = np.concatenate([bez((-5.0, 14.0), (-2.5, 13.2), (0, 14.0)), bez((0, 14.0), (2.5, 13.2), (5.0, 14.0))[1:]])
    lower = bez((5.0, 14.0), (2.5, 17.6), (-2.5, 17.6), (-5.0, 14.0))
    mouth = Poly(np.concatenate([upper, lower[1:-1]]))
    face.fill(mouth, '#1c1430')
    band = Poly(np.concatenate([upper, (upper + [0, 1.0])[::-1]]))
    face.fill(Inter(mouth, band), WHITE)
    face.fill(Inter(mouth, Ellipse(0, 17.0, 2.4, 1.0)), cyan, 0.85, glow=0.8)
    face.fill(Stroke(np.concatenate([upper, lower[1:]]), 0.42), INK)
    # the jacket: a plum neckerchief, double buttons and glowing ghost wisps curling up
    torso.fill(Poly([(-6.0, -1), (6.0, -1), (3.0, 4.5), (0.0, 6.0), (-3.0, 4.5)]), plum)
    torso.fill(Poly([(-1.6, 4.4), (1.6, 4.4), (2.6, 9.6), (0, 8.6), (-2.6, 9.6)]), '#552f82')
    buttons(torso, [-3.4, 3.4], [13.0, 18.0, 23.0], r=0.75, color='#2f2f2f', ring=None)
    for (x, s) in ((-9.5, 1), (8.0, -1), (-1.0, 1)):
        torso.fill(Stroke(bez((x, 31.0), (x + s * 3.0, 25.0), (x - s * 1.5, 20.0), (x + s * 1.8, 15.5)), 0.9), cyan, 0.85, glow=0.6)
        torso.fill(Circle(x + s * 1.8, 15.2, 0.8), cyan, 0.85, glow=0.6)


def by_key():
    return {f['key']: f for f in FIGURES + EXTRA + FRANCHISE + TOON}
