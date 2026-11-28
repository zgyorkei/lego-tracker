"""Builds glim-darker.html (LT.LOGO.APPLY): Glim on the app tile as on the pick page, and one shade darker.

The user asked for "a bit darker shade" (28 Nov). The page shows both tiles at full size (232 px), 192 px
and 48 px on a light and a dark ground, the colours that changed, and the PNGs the app ships.

  <blender dir>/4.5/python/bin/python.exe -I docs/design/logo-minifigs/glim_darker.py

Needs renders/before/ghost.png (the pick page's Glim) and renders/T/ghost.png (the darker one); the
page links them and the baked icons by relative path, so open it from this folder.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import minifigs as mf

OUT = os.path.join(HERE, 'glim-darker.html')

OLD = {'hood': '#c4f0d2', 'head': '#d6f6e0', 'torso and arms': '#b9ebc9', 'sheet folds': '#86c99c'}


def new_colours():
    g = mf.by_key()['ghost']
    return {'hood': g['colors']['hood'][0], 'head': g['head'], 'torso and arms': g['torso'],
            'sheet folds': mf.GLIM_FOLDS}


CSS = """
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { margin: 0; font: 15px/1.5 system-ui, 'Segoe UI', sans-serif; background: #ece9f3; color: #1d1a2b; }
header { padding: 28px 32px 8px; }
h1 { margin: 0 0 4px; font-size: 24px; }
h2 { margin: 28px 0 10px; font-size: 17px; }
p { margin: 4px 0; max-width: 70ch; }
.note { color: #5b5670; }
main { padding: 0 32px 48px; }
.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; max-width: 1040px; }
.ground { border-radius: 14px; padding: 18px 20px 22px; }
.ground.light { background: #f6f3ee; color: #1d1a2b; border: 1px solid #d9d3e6; }
.ground.dark { background: #15111f; color: #ece9f3; border: 1px solid #2c2540; }
.ground h3 { margin: 0 0 12px; font-size: 14px; letter-spacing: .02em; text-transform: uppercase; opacity: .8; }
.row { display: flex; align-items: flex-end; gap: 22px; flex-wrap: wrap; }
figure { margin: 0; text-align: center; font-size: 12px; opacity: .85; }
figure figcaption { margin-top: 6px; }
.tile { position: relative; overflow: hidden; border-radius: 22.5%;
  background: linear-gradient(160deg, #3b2a6b, #120c2b);
  box-shadow: inset 0 2px 0 rgba(255,255,255,.35), inset 0 -3px 0 rgba(0,0,0,.18); }
.tile:before { content: ''; position: absolute; inset: 0;
  background: radial-gradient(circle at 30% 18%, rgba(255,255,255,.35), transparent 55%); }
.tile img { position: absolute; left: 0; bottom: 0; width: 100%; margin-bottom: -7%; display: block; }
.s232 { width: 232px; height: 232px; } .s192 { width: 192px; height: 192px; } .s48 { width: 48px; height: 48px; }
.baked img { display: block; image-rendering: auto; }
.sw { display: flex; gap: 12px; flex-wrap: wrap; margin: 8px 0 0; }
.sw div { display: flex; align-items: center; gap: 8px; background: #fff; border: 1px solid #d9d3e6; border-radius: 10px; padding: 6px 10px; }
.sw i { display: inline-block; width: 22px; height: 22px; border-radius: 6px; border: 1px solid rgba(0,0,0,.25); }
.sw b { font-weight: 600; } .sw code { font-size: 12px; }
"""


def tile(src, size):
    return ('<figure><div class="tile s%d"><img src="%s" alt=""></div><figcaption>%d px</figcaption></figure>'
            % (size, src, size))


def cell(title, src, ground):
    return ('<section class="ground %s"><h3>%s</h3><div class="row">%s%s%s</div></section>'
            % (ground, title, tile(src, 232), tile(src, 192), tile(src, 48)))


def swatches():
    new = new_colours()
    rows = []
    for k, old in OLD.items():
        rows.append('<div><i style="background:%s"></i><i style="background:%s"></i><b>%s</b>'
                    '<code>%s &rarr; %s</code></div>' % (old, new[k], k, old, new[k]))
    return '<div class="sw">%s</div>' % ''.join(rows)


def baked():
    items = [('../../../public/icons/icon-512.png', 232, 'icon-512 (Chrome app)'),
             ('../../../public/icons/icon-192.png', 192, 'icon-192'),
             ('../../../desktop/icons/48.png', 48, 'desktop 48'),
             ('../../../public/icons/favicon-32.png', 32, 'favicon 32'),
             ('../../../public/icons/icon-maskable-512.png', 128, 'maskable, shown at 128'),
             ('../../../public/icons/apple-touch-icon.png', 128, 'apple touch, shown at 128')]
    out = []
    for src, w, cap in items:
        out.append('<figure class="baked"><img src="%s" width="%d" height="%d" alt=""><figcaption>%s</figcaption></figure>'
                   % (src, w, w, cap))
    return '<div class="ground dark" style="max-width:1040px"><div class="row">%s</div></div>' % ''.join(out)


def main():
    page = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Glim, one shade darker (LT.LOGO.APPLY)</title>
<meta name="viewport" content="width=device-width, initial-scale=1"><style>%s</style></head><body>
<header><h1>Glim the Ghost: the pick page's tile, and one shade darker</h1>
<p class="note">You picked Glim the Ghost on the app icon tile (28 Nov) and asked for "a bit darker shade". Left: the
tile as it was on toon.html. Right: the one that goes into the app. The outlines, the face and the tile are the same;
only his body and glow colours are one step down.</p></header>
<main>
<h2>On a light and a dark ground</h2>
<div class="grid">
%s
%s
%s
%s
</div>
<h2>The colours that changed</h2>
<p class="note">Old on the left of each pair, new on the right.</p>
%s
<h2>The PNGs the apps ship (baked from the darker render)</h2>
<p class="note">The same image in the Chrome app (public/icons) and the desktop app (desktop/icons).</p>
%s
</main></body></html>
""" % (CSS,
       cell('Current (pick page), light', 'renders/before/ghost.png', 'light'),
       cell('Darker, light', 'renders/T/ghost.png', 'light'),
       cell('Current (pick page), dark', 'renders/before/ghost.png', 'dark'),
       cell('Darker, dark', 'renders/T/ghost.png', 'dark'),
       swatches(), baked())
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write(page)
    print('wrote', OUT)


if __name__ == '__main__':
    main()
