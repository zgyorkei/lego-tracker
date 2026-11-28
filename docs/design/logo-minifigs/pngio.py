"""Minimal PNG reading and writing with numpy and zlib only (8-bit RGB/RGBA, no interlace).

Used by make_icons.py and glim_darker.py, which run under Blender's bundled Python
(it has numpy but no Pillow).
"""
import struct
import zlib
import numpy as np


def write_png(path, rgba):
    """rgba: float 0..1 or uint8, H x W x 4 (or x 3), row 0 at the top."""
    a = np.asarray(rgba)
    if a.dtype != np.uint8:
        a = (np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8)
    h, w, c = a.shape
    color_type = 6 if c == 4 else 2
    raw = np.concatenate([np.zeros((h, 1), np.uint8), a.reshape(h, w * c)], axis=1).tobytes()

    def chunk(tag, data):
        body = tag + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, color_type, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9))
    png += chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)


def read_png(path):
    """Returns uint8 H x W x 4 (RGBA; RGB gets an opaque alpha)."""
    with open(path, 'rb') as f:
        data = f.read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', path
    pos = 8
    idat = b''
    w = h = depth = ctype = None
    while pos < len(data):
        n = struct.unpack('>I', data[pos:pos + 4])[0]
        tag = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + n]
        pos += 12 + n
        if tag == b'IHDR':
            w, h, depth, ctype, _, _, interlace = struct.unpack('>IIBBBBB', body)
            assert depth == 8 and ctype in (2, 6) and interlace == 0, (path, depth, ctype, interlace)
        elif tag == b'IDAT':
            idat += body
        elif tag == b'IEND':
            break
    c = 4 if ctype == 6 else 3
    raw = np.frombuffer(zlib.decompress(idat), np.uint8).reshape(h, 1 + w * c)
    out = np.zeros((h, w * c), np.int32)
    prev = np.zeros(w * c, np.int32)
    for y in range(h):
        ft = raw[y, 0]
        line = raw[y, 1:].astype(np.int32)
        if ft == 0:
            cur = line
        elif ft == 2:
            cur = (line + prev) & 255
        else:
            cur = np.zeros(w * c, np.int32)
            if ft == 1:
                for i in range(c):
                    cur[i::c] = np.cumsum(line[i::c]) & 255
            elif ft == 3:
                for x in range(w):
                    left = cur[(x - 1) * c:x * c] if x else 0
                    cur[x * c:(x + 1) * c] = (line[x * c:(x + 1) * c] + ((left + prev[x * c:(x + 1) * c]) >> 1)) & 255
            elif ft == 4:
                for x in range(w):
                    a = cur[(x - 1) * c:x * c] if x else np.zeros(c, np.int32)
                    b = prev[x * c:(x + 1) * c]
                    cc = prev[(x - 1) * c:x * c] if x else np.zeros(c, np.int32)
                    p = a + b - cc
                    pa, pb, pc = np.abs(p - a), np.abs(p - b), np.abs(p - cc)
                    pred = np.where((pa <= pb) & (pa <= pc), a, np.where(pb <= pc, b, cc))
                    cur[x * c:(x + 1) * c] = (line[x * c:(x + 1) * c] + pred) & 255
            else:
                raise ValueError('bad PNG filter %d in %s' % (ft, path))
        out[y] = cur
        prev = cur
    img = out.reshape(h, w, c).astype(np.uint8)
    if c == 3:
        img = np.concatenate([img, np.full((h, w, 1), 255, np.uint8)], axis=2)
    return img


def resample_premultiplied(rgba_u8, size):
    """Area (box) resample to size x size, in premultiplied linear light."""
    a = rgba_u8.astype(np.float64) / 255.0
    rgb = np.where(a[..., :3] <= 0.04045, a[..., :3] / 12.92, ((a[..., :3] + 0.055) / 1.055) ** 2.4)
    al = a[..., 3:4]
    pm = np.concatenate([rgb * al, al], axis=2)
    H, W = pm.shape[:2]
    # integral image area average for arbitrary ratios
    def axis_weights(n_in, n_out):
        m = np.zeros((n_out, n_in))
        scale = n_in / n_out
        for o in range(n_out):
            lo, hi = o * scale, (o + 1) * scale
            i0, i1 = int(np.floor(lo)), int(np.ceil(hi))
            for i in range(i0, min(i1, n_in)):
                m[o, i] = min(hi, i + 1) - max(lo, i)
            m[o] /= m[o].sum()
        return m
    wy = axis_weights(H, size)
    wx = axis_weights(W, size)
    out = np.einsum('oh,hwc->owc', wy, pm)
    out = np.einsum('pw,owc->opc', wx, out)
    al = out[..., 3:4]
    rgb = np.where(al > 1e-8, out[..., :3] / np.maximum(al, 1e-8), 0)
    rgb = np.where(rgb <= 0.0031308, rgb * 12.92, 1.055 * np.power(np.clip(rgb, 0, None), 1 / 2.4) - 0.055)
    return np.concatenate([np.clip(rgb, 0, 1), np.clip(al, 0, 1)], axis=2)
