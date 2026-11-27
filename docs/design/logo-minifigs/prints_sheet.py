"""A contact sheet of every figure's face and torso print, flat, on its part colour.

A quick check of the drawn prints without a render:
  python prints_sheet.py <out.png>      (Blender's bundled Python is enough)
"""
import os
import sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import minifigs as mf
from pngio import write_png


def flat(canvas, base_hex):
    rgba = canvas.rgba_straight()
    base = np.asarray(mf.hex_rgb(base_hex), np.float32)
    a = rgba[..., 3:4]
    rgb = rgba[..., :3] * a + base * (1 - a)
    return np.concatenate([rgb, np.ones_like(a)], axis=2)


def pad_to(img, h, w):
    out = np.ones((h, w, 4), np.float32)
    out[:img.shape[0], :img.shape[1]] = img
    return out


def main(path):
    tiles = []
    for fig in mf.FIGURES:
        face, torso = mf.new_face(), mf.new_torso()
        fig['prints'](face, torso)
        f = flat(face, fig['head'])
        t = flat(torso, fig['torso'])
        h = max(f.shape[0], t.shape[0])
        row = np.concatenate([pad_to(f, h, f.shape[1]), np.ones((h, 16, 4), np.float32), pad_to(t, h, t.shape[1])], axis=1)
        tiles.append(row)
    w = max(r.shape[1] for r in tiles)
    cols = 2
    rows = []
    for i in range(0, len(tiles), cols):
        group = [pad_to(r, max(x.shape[0] for x in tiles[i:i + cols]), w) for r in tiles[i:i + cols]]
        while len(group) < cols:
            group.append(np.ones_like(group[0]))
        rows.append(np.concatenate([np.concatenate([g, np.ones((g.shape[0], 24, 4), np.float32)], axis=1) for g in group], axis=1))
        rows.append(np.ones((24, rows[-1].shape[1], 4), np.float32))
    sheet = np.concatenate(rows, axis=0)
    write_png(path, sheet)
    print('wrote', path, sheet.shape)


main(sys.argv[1])
