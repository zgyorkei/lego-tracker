"""Bake Brick Tracker's icon set (LT.LOGO.APPLY) from the Glim render.

Run with Blender's bundled Python (numpy, no Pillow), isolated, from any folder:
  <blender>/4.5/python/bin/python.exe -I docs/design/logo-minifigs/make_icons.py

Input:  renders/T/ghost.png (render_bust.py --style B --only ghost --folder T).
Output (all PNG, committed):
  public/icons/icon-192.png, icon-512.png       the Chrome app, "any" purpose (rounded tile)
  public/icons/icon-maskable-512.png            full bleed, head and hood inside the 80% safe circle
  public/icons/apple-touch-icon.png             180 px, opaque, full bleed (iOS rounds it itself)
  public/icons/favicon-32.png                   the rounded tile at 32 px
  desktop/icons/<n>.png                         16, 32, 48, 64, 128, 256: the desktop app (tray,
                                                window, and the .ico desktop/build.mjs makes)
  docs/shots/favicon-32.png                     the same favicon, for the docs

The tile is the "App icon tile" of the pick page, drawn in numpy instead of CSS:
border-radius 22.5%, linear-gradient(160deg, tile[0], tile[1]), a radial highlight at
30% 18% (white .35 fading out at 55%), an inset 2 px white .35 line along the top and an
inset 3 px black .18 line along the bottom (both scaled to the icon's size), and the bust
as wide as the tile, rising from the bottom edge with margin-bottom -7%.
All the blending is done in sRGB like a browser does; the final shrink is in linear light.
"""
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import minifigs as mf
from pngio import read_png, write_png, resample_premultiplied

ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
SRC = os.path.join(HERE, 'renders', 'T', 'ghost.png')

RADIUS = 0.225          # border-radius, share of the icon's width
BUST_DROP = 0.07        # margin-bottom -7%: the bust's box reaches this far below the tile
BASE = 232.0            # the width the CSS pixel values (2 px, 3 px) were drawn at
SAFE_R = 0.40           # the maskable safe zone: a circle of 80% of the icon's width
SAFE_HEAD = 0.62        # the top share of the bust (the head and hood) that must stay inside the safe circle


def rgb255(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], np.float64) / 255.0


def rr_cov(X, Y, w, r, dy=0.0):
    """Anti-aliased coverage of the rounded square [0, w]^2 shifted down by dy (all in work pixels)."""
    px = np.abs(X - w / 2) - (w / 2 - r)
    py = np.abs(Y - dy - w / 2) - (w / 2 - r)
    d = np.hypot(np.maximum(px, 0), np.maximum(py, 0)) + np.minimum(np.maximum(px, py), 0) - r
    return np.clip(0.5 - d, 0.0, 1.0)


def min_circle(points):
    """Centre and radius of (nearly) the smallest circle round the points (Badoiu-Clarkson)."""
    c = points.mean(axis=0)
    for k in range(1, 3000):
        far = points[np.argmax(((points - c) ** 2).sum(axis=1))]
        c = c + (far - c) / (k + 1)
    return c, float(np.sqrt(((points - c) ** 2).sum(axis=1).max()))


def over_atop(pm, al, rgb, a):
    """Lay a straight-colour layer of alpha a over the premultiplied pixels, only where they exist."""
    k = a[..., None]
    return rgb * k * al[..., None] + pm * (1 - k)


def tile_icon(bust, size, rounded=True, safe=False):
    """The icon at size x size as straight-alpha uint8 RGBA. bust: the 1024 px render, uint8 RGBA."""
    t0, t1 = [rgb255(c) for c in mf.by_key()['ghost']['tile']]
    ss = max(1, min(4, 1024 // size))
    W = size * ss
    ys, xs = np.mgrid[0:W, 0:W]
    X, Y = xs + 0.5, ys + 0.5

    # the tile: shape and the 160deg gradient (the gradient line is |w sin| + |w cos| long)
    cov = rr_cov(X, Y, W, RADIUS * W) if rounded else np.ones((W, W))
    th = np.radians(160.0)
    dx, dy = np.sin(th), -np.cos(th)
    length = W * (abs(dx) + abs(dy))
    t = (((X - W / 2) * dx + (Y - W / 2) * dy) / length + 0.5)[..., None]
    grad = t0 * (1 - t) + t1 * t
    pm = grad * cov[..., None]
    al = cov

    # the inset lines along the top (white) and the bottom (black), only on the rounded tile
    if rounded:
        px = W / BASE
        top = cov * (1 - rr_cov(X, Y, W, RADIUS * W, dy=2.0 * px))
        bottom = cov * (1 - rr_cov(X, Y, W, RADIUS * W, dy=-3.0 * px))
        pm = over_atop(pm, al, np.array([1.0, 1.0, 1.0]), 0.35 * top)
        pm = over_atop(pm, al, np.array([0.0, 0.0, 0.0]), 0.18 * bottom)

    # the radial highlight at 30% 18%, farthest-corner sized, fading out at 55%
    cx, cy = 0.30 * W, 0.18 * W
    far = np.hypot(max(cx, W - cx), max(cy, W - cy))
    a_hl = 0.35 * np.clip(1 - np.hypot(X - cx, Y - cy) / (0.55 * far), 0.0, 1.0)
    pm = over_atop(pm, al, np.array([1.0, 1.0, 1.0]), a_hl)

    # the bust
    if safe:
        # The head and hood (the top part of the bust) go inside the safe circle; the shoulders below
        # may leave it, so the cut edge of the bust runs off the bottom of the icon instead of floating.
        pts = np.argwhere(bust[::4, ::4, 3] > 25)[:, ::-1] * 4.0 + 2.0          # (x, y) in render pixels
        y_top, y_bottom = pts[:, 1].min(), pts[:, 1].max()
        head = pts[pts[:, 1] < y_top + SAFE_HEAD * (y_bottom - y_top)]
        c, r = min_circle(head)
        k = SAFE_R * 0.97 * W / r                                                 # render pixels to work pixels
        n = int(round(bust.shape[1] * k))
        ox = int(round(W / 2 - c[0] * k))
        oy = int(round(W / 2 - c[1] * k))
        gap = W - (oy + y_bottom * k)                                             # the bust must reach the bottom edge
        if gap > 0:
            oy += int(np.ceil(gap))
    else:
        n = W
        ox, oy = 0, int(round(BUST_DROP * W))
    layer = resample_premultiplied(bust, n)                                       # float RGBA, straight alpha
    la = np.zeros((W, W))
    lrgb = np.zeros((W, W, 3))
    x0, y0 = max(ox, 0), max(oy, 0)
    x1, y1 = min(ox + n, W), min(oy + n, W)
    if x1 > x0 and y1 > y0:
        sub = layer[y0 - oy:y1 - oy, x0 - ox:x1 - ox]
        lrgb[y0:y1, x0:x1] = sub[..., :3]
        la[y0:y1, x0:x1] = sub[..., 3]
    pm = over_atop(pm, al, lrgb, la)

    straight = np.where(al[..., None] > 1e-6, pm / np.maximum(al[..., None], 1e-6), 0.0)
    out = np.concatenate([np.clip(straight, 0, 1), al[..., None]], axis=2)
    out8 = (out * 255 + 0.5).astype(np.uint8)
    small = resample_premultiplied(out8, size) if ss > 1 else out
    small = np.asarray(small)
    if not rounded:
        small = small.copy()
        small[..., 3] = 1.0                                                       # opaque, no stray alpha at the edges
    small[small[..., 3] < 1.0 / 255] = 0
    return (np.clip(small, 0, 1) * 255 + 0.5).astype(np.uint8)


def save(rel, rgba):
    path = os.path.join(ROOT, *rel.split('/'))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    write_png(path, rgba)
    print('%-38s %4dx%-4d %6d bytes' % (rel, rgba.shape[1], rgba.shape[0], os.path.getsize(path)), flush=True)


def main():
    bust = read_png(SRC)
    for size in (192, 512):
        save('public/icons/icon-%d.png' % size, tile_icon(bust, size))
    save('public/icons/icon-maskable-512.png', tile_icon(bust, 512, rounded=False, safe=True))
    save('public/icons/apple-touch-icon.png', tile_icon(bust, 180, rounded=False))
    fav = tile_icon(bust, 32)
    save('public/icons/favicon-32.png', fav)
    save('docs/shots/favicon-32.png', fav)
    for size in (16, 32, 48, 64, 128, 256):
        save('desktop/icons/%d.png' % size, tile_icon(bust, size))


if __name__ == '__main__':
    main()
