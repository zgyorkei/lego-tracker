"""Finish the Brick Tracker logo proposals (LT.LOGO.MINIFIGS): small copies and the four pages.

Run with Blender's bundled Python (numpy, no Pillow), isolated:
  <blender>/4.5/python/bin/python.exe -I finish.py [--pages-only]

Reads renders/A/<key>.png and renders/B/<key>.png (1024 px, from render_bust.py),
recompresses them (transparent pixels cleared), writes <key>-192.png and
<key>-48.png beside them (area resample in premultiplied linear light) and
writes the four pages a.html .. d.html next to this script:
  A  glossy studio plastic (style A renders)
  B  toon with outlines (style B renders)
  C  a round badge with BRICK TRACKER on an SVG text path (style B renders)
  D  an app icon: a rounded tile in each figure's colours (style A renders)
"""
import os
import sys
import html
import math

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import minifigs as mf
from pngio import read_png, write_png, resample_premultiplied

RENDERS = os.path.join(HERE, 'renders')
SIZES = (192, 48)
LIMIT_MB = 25.0


# ---------------------------------------------------------------------------
# Images

def finish_images():
    missing = []
    for style in ('A', 'B'):
        for fig in mf.FIGURES:
            src = os.path.join(RENDERS, style, fig['key'] + '.png')
            if not os.path.exists(src):
                missing.append('%s/%s' % (style, fig['key']))
                continue
            img = read_png(src)
            clean = img.copy()
            clean[clean[..., 3] == 0] = 0
            before = os.path.getsize(src)
            write_png(src + '.tmp', clean)
            if os.path.getsize(src + '.tmp') < before:
                os.replace(src + '.tmp', src)
            else:
                os.remove(src + '.tmp')
            for size in SIZES:
                small = resample_premultiplied(clean, size)
                small[small[..., 3] < 1.0 / 255] = 0
                write_png(os.path.join(RENDERS, style, '%s-%d.png' % (fig['key'], size)), small)
            print('finished %s/%s %d KB' % (style, fig['key'], os.path.getsize(src) // 1024), flush=True)
    return missing


def folder_mb():
    total = 0
    for root, _dirs, files in os.walk(HERE):
        if '__pycache__' in root:
            continue
        for f in files:
            total += os.path.getsize(os.path.join(root, f))
    return total / (1024 * 1024)


# ---------------------------------------------------------------------------
# Pages

PAGES = [
    ('a', 'A', 'Glossy studio plastic',
     'Real ABS plastic: a glossy coat, soft studio light from three area lamps, rendered in Cycles. '
     'The closest look to a figure on the shelf.'),
    ('b', 'B', 'Toon with outlines',
     'Cel shading: two flat tones and a hard highlight per colour, with a thick outer outline and thin inner '
     'lines (Freestyle). Bold, flat and very readable when small.'),
    ('c', 'C', 'Round badge',
     'The toon figure in a round emblem with BRICK TRACKER around the top. At 48 px the text would be a blur, '
     'so the favicon size drops it and lets the figure fill the badge.'),
    ('d', 'D', 'App icon tile',
     'The glossy figure rising from the bottom edge of a rounded square in its own colours, the shape of a '
     'desktop or Chrome app icon.'),
]

CSS = """
:root{--ink:#1b1d24;--muted:#5d6472;--line:#dde1e8;--card:#fff;--bg:#f2f3f6;--accent:#e3000b;--yellow:#ffcf00}
*{box-sizing:border-box}
body{margin:0;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--bg)}
header{background:#1b1d24;color:#fff;padding:18px 28px 0}
header .brand{display:flex;align-items:center;gap:12px}
header .brick{width:34px;height:22px;background:var(--yellow);border-radius:3px;position:relative;box-shadow:inset 0 -3px 0 rgba(0,0,0,.18)}
header .brick:before,header .brick:after{content:"";position:absolute;top:-6px;width:10px;height:6px;background:var(--yellow);border-radius:2px 2px 0 0}
header .brick:before{left:5px}header .brick:after{right:5px}
header h1{font-size:20px;margin:0;font-weight:700;letter-spacing:.2px}
header h1 small{font-weight:400;color:#aeb4c2;font-size:14px;margin-left:8px}
nav{display:flex;gap:4px;margin-top:14px}
nav a{color:#c9cedb;text-decoration:none;padding:9px 16px 10px;border-radius:8px 8px 0 0;font-weight:600;font-size:14px}
nav a:hover{color:#fff;background:#2a2d37}
nav a.on{background:var(--bg);color:var(--ink)}
main{max-width:1320px;margin:0 auto;padding:22px 28px 40px}
.intro{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:18px;margin-bottom:22px}
.panel{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px}
.panel h2{margin:0 0 6px;font-size:17px}
.panel p{margin:6px 0;color:var(--muted)}
.panel.note{border-left:4px solid var(--yellow)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}
.fig{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:10px}
.fig.picked{border-color:var(--accent);box-shadow:0 0 0 2px rgba(227,0,11,.18)}
.fig h3{margin:0;font-size:16px;display:flex;align-items:center;gap:8px}
.fig h3 .num{font-size:12px;color:var(--muted);font-weight:600;min-width:22px}
.tag{font-size:11px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;background:var(--yellow);color:#3a2f00;border-radius:4px;padding:1px 6px}
.fig .blurb{margin:0;color:var(--muted);font-size:13px;min-height:2.6em}
.hero{height:272px;border-radius:10px;display:flex;align-items:center;justify-content:center;overflow:hidden}
.hero.plain{background:radial-gradient(circle at 50% 38%,#ffffff 0,#e9ecf2 70%)}
.hero.plain.dark{background:radial-gradient(circle at 50% 38%,#3a3f4c 0,#1d2026 70%)}
.hero img{width:256px;height:256px;display:block}
.sizes{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.sw{border-radius:8px;padding:8px;display:flex;align-items:flex-end;gap:10px;justify-content:center}
.sw.light{background:#f4f5f7;border:1px solid #e3e6eb}
.sw.dark{background:#1d2026;border:1px solid #1d2026}
.sw .cell{display:flex;flex-direction:column;align-items:center;gap:2px;font-size:10.5px;color:#7a8190}
.sw.dark .cell{color:#8d94a3}
.s192{width:96px;height:96px}
.s48{width:48px;height:48px}
.sizes .note{grid-column:1/-1;font-size:11.5px;color:var(--muted);margin:0}
label.pick{display:flex;align-items:center;gap:8px;font-weight:600;cursor:pointer;user-select:none}
label.pick input{width:18px;height:18px;accent-color:var(--accent)}
.q{margin-top:26px}
.q h2{font-size:18px;margin:0 0 4px}
.q p.hint{margin:0 0 10px;color:var(--muted)}
.q .picks{margin:6px 0 10px;font-weight:600}
.q .radios{display:flex;gap:18px;flex-wrap:wrap;margin:6px 0 10px}
.q .radios label{display:flex;gap:6px;align-items:center;cursor:pointer}
textarea{width:100%;min-height:64px;border:1px solid var(--line);border-radius:8px;padding:9px 11px;font:inherit;resize:vertical;background:#fff}
textarea:focus{outline:2px solid rgba(227,0,11,.35);border-color:transparent}
.copy{display:flex;align-items:center;gap:14px;margin-top:18px}
button{font:inherit;font-weight:700;background:var(--accent);color:#fff;border:0;border-radius:8px;padding:11px 22px;cursor:pointer}
button:hover{filter:brightness(1.08)}
#copied{color:#1d7a3a;font-weight:600}
footer{max-width:1320px;margin:0 auto;padding:0 28px 36px;color:var(--muted);font-size:12.5px}
footer p{margin:6px 0}
/* C: badge */
svg.badge{display:block}
svg.badge text{font:800 17px system-ui,"Segoe UI",sans-serif;letter-spacing:2.2px}
/* D: tile */
.tile{position:relative;overflow:hidden;border-radius:22.5%;display:flex;align-items:flex-end;justify-content:center;
  box-shadow:inset 0 2px 0 rgba(255,255,255,.35),inset 0 -3px 0 rgba(0,0,0,.18)}
.tile:before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 30% 18%,rgba(255,255,255,.35),rgba(255,255,255,0) 55%)}
.tile img{position:relative;width:100%;height:auto;display:block;margin-bottom:-7%}
.tile.big{width:232px;height:232px}
.tile.s192{width:96px;height:96px}
.tile.s48{width:48px;height:48px}
"""

JS = r"""
(function(){
  var page = document.body.getAttribute('data-page');
  var store = 'lt-logo-minifigs-' + page;
  function els(sel){ return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function save(){
    var st = {picks: els('input.pickbox').filter(function(c){return c.checked;}).map(function(c){return c.value;}),
              fields: {}};
    els('textarea, input[type=radio]').forEach(function(e){
      if (e.type === 'radio') { if (e.checked) st.fields[e.name] = e.value; }
      else st.fields[e.id] = e.value;
    });
    try { localStorage.setItem(store, JSON.stringify(st)); } catch (e) {}
  }
  function load(){
    var st = null;
    try { st = JSON.parse(localStorage.getItem(store) || 'null'); } catch (e) {}
    if (!st) return;
    els('input.pickbox').forEach(function(c){ c.checked = st.picks.indexOf(c.value) >= 0; });
    els('textarea').forEach(function(t){ if (st.fields[t.id] != null) t.value = st.fields[t.id]; });
    els('input[type=radio]').forEach(function(r){ r.checked = st.fields[r.name] === r.value; });
  }
  function picked(){
    return els('input.pickbox').filter(function(c){return c.checked;}).map(function(c){return c.getAttribute('data-name');});
  }
  function refresh(){
    els('input.pickbox').forEach(function(c){
      var card = document.getElementById('fig-' + c.value);
      if (card) card.classList.toggle('picked', c.checked);
    });
    var p = picked();
    document.getElementById('pick-list').textContent = p.length ? 'Picked: ' + p.join(', ') : 'Nothing picked yet: tick "Pick this one" on the figures you like.';
  }
  function val(id){ var e = document.getElementById(id); return e ? e.value.trim() : ''; }
  function answers(){
    var title = document.body.getAttribute('data-title');
    var dir = els('input[name=direction]').filter(function(r){return r.checked;}).map(function(r){return r.value;})[0] || '(no answer)';
    var p = picked();
    var lines = [];
    lines.push('Brick Tracker logo proposals, page ' + title);
    lines.push('');
    lines.push('1. Which figures do you pick?');
    lines.push('   Picks: ' + (p.length ? p.join(', ') : '(none)'));
    lines.push('   Comment: ' + (val('c-figures') || '(none)'));
    lines.push('');
    lines.push('2. Is this the direction for the logo?');
    lines.push('   Answer: ' + dir);
    lines.push('   Comment: ' + (val('c-direction') || '(none)'));
    lines.push('');
    lines.push('3. Anything to change?');
    lines.push('   Comment: ' + (val('c-changes') || '(none)'));
    lines.push('');
    lines.push('Additional comments: ' + (val('c-additional') || '(none)'));
    return lines.join('\n');
  }
  function fallbackCopy(text){
    var ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.top = '-1000px';
    document.body.appendChild(ta); ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
    return ok;
  }
  function done(ok){
    var s = document.getElementById('copied');
    s.textContent = ok ? 'Copied: paste it into the chat.' : 'Copy failed: select the text below and copy it by hand.';
    if (!ok) { var pre = document.getElementById('manual'); pre.textContent = answers(); pre.style.display = 'block'; }
  }
  document.getElementById('copy-btn').addEventListener('click', function(){
    var text = answers();
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function(){ done(true); }, function(){ done(fallbackCopy(text)); });
    } else {
      done(fallbackCopy(text));
    }
  });
  load();
  refresh();
  document.addEventListener('change', function(){ refresh(); save(); });
  document.addEventListener('input', save);
})();
"""


def esc(s):
    return html.escape(s, quote=True)


def img_src(style, key, size=None):
    return 'renders/%s/%s%s.png' % (style, key, '' if size is None else '-%d' % size)


def badge_svg(fig, uid, src, px, text=True):
    """A round badge: a ring in the figure's ring colour, a disc in its tile colours, the bust rising
    from the disc's bottom, BRICK TRACKER around the top of the ring (left out when text=False)."""
    t0, t1 = fig['tile']
    ring = fig['ring']
    r_disc = 74 if text else 88
    cx = cy = 100
    # the bust fills the disc: its bottom edge on the disc's bottom, its width about the disc's
    size = r_disc * 2 * (1.0 if text else 1.02)
    ix = cx - size / 2
    iy = cy + r_disc - size + (4 if text else 2)
    parts = ['<svg class="badge" width="%d" height="%d" viewBox="0 0 200 200" role="img" aria-label="%s badge">'
             % (px, px, esc(fig['name']))]
    parts.append('<defs><radialGradient id="g%s" cx="50%%" cy="35%%" r="70%%"><stop offset="0" stop-color="%s"/>'
                 '<stop offset="1" stop-color="%s"/></radialGradient>'
                 '<clipPath id="k%s"><circle cx="%d" cy="%d" r="%d"/></clipPath>'
                 '<path id="p%s" d="M 17,100 A 83,83 0 0 1 183,100"/></defs>'
                 % (uid, t0, t1, uid, cx, cy, r_disc, uid))
    parts.append('<circle cx="100" cy="100" r="98" fill="%s"/>' % ring)
    parts.append('<circle cx="100" cy="100" r="95" fill="none" stroke="rgba(255,255,255,.28)" stroke-width="1.5"/>')
    parts.append('<circle cx="100" cy="100" r="%d" fill="url(#g%s)"/>' % (r_disc, uid))
    parts.append('<g clip-path="url(#k%s)"><image href="%s" x="%.1f" y="%.1f" width="%.1f" height="%.1f"/></g>'
                 % (uid, src, ix, iy, size, size))
    parts.append('<circle cx="100" cy="100" r="%d" fill="none" stroke="rgba(0,0,0,.25)" stroke-width="2"/>' % r_disc)
    if text:
        parts.append('<text fill="#ffffff"><textPath href="#p%s" startOffset="50%%" text-anchor="middle">'
                     'BRICK TRACKER</textPath></text>' % uid)
        # three studs along the bottom of the ring
        for ang in (-28, 0, 28):
            a = math.radians(90 + ang)
            x, y = 100 + 86 * math.cos(a), 100 + 86 * math.sin(a)
            parts.append('<circle cx="%.1f" cy="%.1f" r="5.2" fill="%s" stroke="rgba(255,255,255,.55)" stroke-width="1.6"/>'
                         % (x, y, t0))
    parts.append('</svg>')
    return ''.join(parts)


def tile_html(fig, src, cls):
    t0, t1 = fig['tile']
    return ('<div class="tile %s" style="background:linear-gradient(160deg,%s,%s)"><img src="%s" alt=""></div>'
            % (cls, t0, t1, src))


def figure_card(page, i, fig):
    key = fig['key']
    style = 'A' if page in ('a', 'd') else 'B'
    uids = iter(range(1000))

    def small(size):
        """The figure at one icon size: 192 px shown at 96 css px (sharp on a 2x screen), 48 px true size."""
        if page in ('a', 'b'):
            return '<img class="s%d" src="%s" alt="">' % (size, img_src(style, key, size))
        if page == 'c':
            uid = '%s%d' % (key, next(uids))
            return badge_svg(fig, uid, img_src(style, key, 192), 96 if size == 192 else 48, text=size == 192)
        return tile_html(fig, img_src(style, key, 192), 's%d' % size)

    if page in ('a', 'b'):
        big = '<div class="hero plain"><img src="%s" alt="%s"></div>' % (img_src(style, key), esc(fig['name']))
        note = '192 px shown at 96 css px (sharp on a 2x screen); 48 px at its true size.'
    elif page == 'c':
        big = '<div class="hero plain">%s</div>' % badge_svg(fig, key + 'L', img_src(style, key), 256)
        note = 'At 48 px the badge drops the text and the figure fills it (the favicon variant).'
    else:
        big = '<div class="hero plain">%s</div>' % tile_html(fig, img_src(style, key), 'big')
        note = 'The tile is drawn in CSS around the render; the app icon itself is made when a pick is applied.'

    def swatch(theme):
        return ('<div class="sw %s"><div class="cell">%s<span>192</span></div><div class="cell">%s<span>48</span></div></div>'
                % (theme, small(192), small(48)))
    tag = ' <span class="tag">mascot</span>' if fig.get('mascot') else ''
    return ('<section class="fig" id="fig-%s"><h3><span class="num">%02d</span>%s%s</h3>'
            '<p class="blurb">%s</p>%s<div class="sizes">%s%s<p class="note">%s</p></div>'
            '<label class="pick"><input type="checkbox" class="pickbox" value="%s" data-name="%s"> Pick this one</label>'
            '</section>'
            % (key, i + 1, esc(fig['name']), tag, esc(fig['blurb']), big, swatch('light'), swatch('dark'), note,
               key, esc(fig['name'])))


def page_html(page, letter, title, desc):
    nav = ''.join('<a href="%s.html"%s>%s: %s</a>' % (p, ' class="on"' if p == page else '', l, t)
                  for p, l, t, _d in PAGES)
    cards = ''.join(figure_card(page, i, f) for i, f in enumerate(mf.FIGURES))
    mascots = ', '.join(f['name'] for f in mf.FIGURES if f.get('mascot'))
    full_title = '%s: %s' % (letter, title)
    return """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Brick Tracker logo proposals, %(full)s</title>
<style>%(css)s</style></head>
<body data-page="%(page)s" data-title="%(fulle)s">
<header><div class="brand"><div class="brick"></div><h1>Brick Tracker logo proposals<small>%(n)d minifigure busts, four directions</small></h1></div>
<nav>%(nav)s</nav></header>
<main>
<div class="intro">
<div class="panel"><h2>Direction %(fulle)s</h2><p>%(desc)s</p>
<p>Every figure is a real minifigure bust (head, shoulders and the top of the torso) built from LDraw parts in Blender 4.5,
with the face and torso prints painted by the script. Each card shows it large, then at 192 px (desktop and Chrome app icon)
and 48 px (favicon), on light and on dark.</p></div>
<div class="panel note"><h2>About the figures</h2>
<p>All %(n)d figures are original characters made for Brick Tracker. The franchise characters in the request
(Darth Vader, a Sith Jar Jar, Batman and the Hidden Side cast) are not drawn: they belong to Lucasfilm, DC and the LEGO Group.</p>
<p>The safest picks for a published app are the three Brick Tracker mascots: %(mascots)s.
The minifigure shape itself is a LEGO trademark, so check that before publishing any of them.</p></div>
</div>
<div class="grid">%(cards)s</div>

<section class="q panel"><h2>1. Which figures do you pick?</h2>
<p class="hint">Tick "Pick this one" on as many figures as you like.</p>
<div class="picks" id="pick-list"></div>
<textarea id="c-figures" placeholder="Optional comment: why these, or a figure you miss"></textarea></section>

<section class="q panel"><h2>2. Is this the direction for the logo?</h2>
<p class="hint">Direction %(fulle)s. The other three are in the tabs at the top.</p>
<div class="radios">
<label><input type="radio" name="direction" value="Yes, this one"> Yes, this one</label>
<label><input type="radio" name="direction" value="Maybe"> Maybe</label>
<label><input type="radio" name="direction" value="No"> No</label></div>
<textarea id="c-direction" placeholder="Optional comment on the direction"></textarea></section>

<section class="q panel"><h2>3. Anything to change?</h2>
<p class="hint">Colours, faces, headgear, framing, the light, the frame or the text.</p>
<textarea id="c-changes" placeholder="Optional comment"></textarea></section>

<section class="q panel"><h2>Additional comments</h2>
<textarea id="c-additional" placeholder="Optional"></textarea>
<div class="copy"><button id="copy-btn" type="button">Copy answers</button><span id="copied"></span></div>
<pre id="manual" style="display:none;white-space:pre-wrap;background:#f4f5f7;padding:10px;border-radius:8px"></pre></section>
</main>
<footer>
<p>Parts: the LDraw.org Parts Library (ldraw.org), licensed CC BY 2.0 and CC BY 4.0; imported with the ImportLDraw add-on for Blender.
Rendered headless in Blender 4.5 (Cycles). Face and torso prints drawn for Brick Tracker by docs/design/logo-minifigs/minifigs.py.</p>
<p>LEGO and the minifigure figurine are trademarks of the LEGO Group, which does not sponsor, authorize or endorse Brick Tracker.</p>
</footer>
<script>%(js)s</script>
</body></html>
""" % dict(full=esc(full_title), fulle=esc(full_title), css=CSS, page=page, n=len(mf.FIGURES), nav=nav,
           desc=esc(desc), mascots=esc(mascots), cards=cards, js=JS)


def write_pages():
    paths = []
    for page, letter, title, desc in PAGES:
        path = os.path.join(HERE, page + '.html')
        with open(path, 'w', encoding='utf-8', newline='\n') as f:
            f.write(page_html(page, letter, title, desc))
        paths.append(path)
    return paths


def main():
    missing = [] if '--pages-only' in sys.argv else finish_images()
    for p in write_pages():
        print('page', p)
    if missing:
        print('MISSING renders: ' + ', '.join(missing))
    mb = folder_mb()
    print('folder %.1f MB%s' % (mb, ' (OVER %.0f MB)' % LIMIT_MB if mb > LIMIT_MB else ''))


main()
