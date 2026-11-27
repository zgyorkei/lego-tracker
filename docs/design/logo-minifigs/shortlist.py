"""The Brick Tracker logo shortlist (LT.LOGO.SHORTLIST): small copies and shortlist.html.

Run with Blender's bundled Python (numpy, no Pillow), isolated:
  <blender>/4.5/python/bin/python.exe -I shortlist.py [--page-only]

The user's five picks from page D (27 Nov) plus Dex the Raver in four variants, all in
direction D (the app tile). Studbot (headphones refitted) and the ravers are new renders
in renders/S (render_bust.py --style A --folder S); the other four picks are the style A
renders of LT.LOGO.MINIFIGS in renders/A. This script recompresses the renders/S PNGs
(transparent pixels cleared), writes their <key>-192.png and <key>-48.png copies and
writes shortlist.html next to it. d.html and finish.py are left as they are.
"""
import os
import sys
import html

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import minifigs as mf
from pngio import read_png, write_png, resample_premultiplied

RENDERS = os.path.join(HERE, 'renders')
SIZES = (192, 48)
LIMIT_MB = 25.0

# (key, render folder): the five picks first, then the four raver variants
PICKS = [('studbot', 'S'), ('astronaut', 'A'), ('wizard', 'A'), ('viking', 'A'), ('ghost', 'A')]
RAVERS = [('raver-acid', 'S'), ('raver-checker', 'S'), ('raver-tiedye', 'S'), ('raver-glow', 'S')]


def finish_images():
    missing = []
    for key, folder in PICKS + RAVERS:
        if folder != 'S':
            continue
        src = os.path.join(RENDERS, folder, key + '.png')
        if not os.path.exists(src):
            missing.append('%s/%s' % (folder, key))
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
            write_png(os.path.join(RENDERS, folder, '%s-%d.png' % (key, size)), small)
        print('finished %s/%s %d KB' % (folder, key, os.path.getsize(src) // 1024), flush=True)
    return missing


def folder_mb():
    total = 0
    for root, _dirs, files in os.walk(HERE):
        if '__pycache__' in root:
            continue
        for f in files:
            total += os.path.getsize(os.path.join(root, f))
    return total / (1024 * 1024)


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
h2.group{font-size:18px;margin:26px 0 4px}
p.group{margin:0 0 12px;color:var(--muted)}
.strip{display:grid;grid-template-columns:repeat(9,minmax(0,1fr));gap:6px;padding:12px;border-radius:12px}
.strip.light{background:#f4f5f7;border:1px solid #e3e6eb}
.strip.dark{background:#1d2026;border:1px solid #1d2026;margin-top:8px}
.strip .cell{display:flex;flex-direction:column;align-items:center;gap:6px;font-size:11px;color:#7a8190;text-align:center}
.strip.dark .cell{color:#8d94a3}
.strip .cell .row{display:flex;align-items:flex-end;gap:8px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:16px}
.fig{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:10px}
.fig.picked{border-color:var(--accent);box-shadow:0 0 0 2px rgba(227,0,11,.18)}
.fig h3{margin:0;font-size:16px;display:flex;align-items:center;gap:8px}
.fig h3 .num{font-size:12px;color:var(--muted);font-weight:600;min-width:22px}
.tag{font-size:11px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;background:var(--yellow);color:#3a2f00;border-radius:4px;padding:1px 6px}
.tag.new{background:#ff5ea8;color:#fff}
.tag.fixed{background:#2b8a3e;color:#fff}
.fig .blurb{margin:0;color:var(--muted);font-size:13px;min-height:2.6em}
.hero{height:272px;border-radius:10px;display:flex;align-items:center;justify-content:center;overflow:hidden;
  background:radial-gradient(circle at 50% 38%,#ffffff 0,#e9ecf2 70%)}
.sizes{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.sw{border-radius:8px;padding:8px;display:flex;align-items:flex-end;gap:10px;justify-content:center}
.sw.light{background:#f4f5f7;border:1px solid #e3e6eb}
.sw.dark{background:#1d2026;border:1px solid #1d2026}
.sw .cell{display:flex;flex-direction:column;align-items:center;gap:2px;font-size:10.5px;color:#7a8190}
.sw.dark .cell{color:#8d94a3}
.sizes .note{grid-column:1/-1;font-size:11.5px;color:var(--muted);margin:0}
label.pick{display:flex;align-items:center;gap:8px;font-weight:600;cursor:pointer;user-select:none}
label.pick input{width:18px;height:18px;accent-color:var(--accent)}
.q{margin-top:26px}
.q h2{font-size:18px;margin:0 0 4px}
.q p.hint{margin:0 0 10px;color:var(--muted)}
.q .picks{margin:6px 0 10px;font-weight:600}
textarea{width:100%;min-height:64px;border:1px solid var(--line);border-radius:8px;padding:9px 11px;font:inherit;resize:vertical;background:#fff}
textarea:focus{outline:2px solid rgba(227,0,11,.35);border-color:transparent}
.copy{display:flex;align-items:center;gap:14px;margin-top:18px}
button{font:inherit;font-weight:700;background:var(--accent);color:#fff;border:0;border-radius:8px;padding:11px 22px;cursor:pointer}
button:hover{filter:brightness(1.08)}
#copied{color:#1d7a3a;font-weight:600}
footer{max-width:1320px;margin:0 auto;padding:0 28px 36px;color:var(--muted);font-size:12.5px}
footer p{margin:6px 0}
.tile{position:relative;overflow:hidden;border-radius:22.5%;display:flex;align-items:flex-end;justify-content:center;
  box-shadow:inset 0 2px 0 rgba(255,255,255,.35),inset 0 -3px 0 rgba(0,0,0,.18)}
.tile:before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 30% 18%,rgba(255,255,255,.35),rgba(255,255,255,0) 55%)}
.tile img{position:relative;width:100%;height:auto;display:block;margin-bottom:-7%}
.tile.big{width:232px;height:232px}
.tile.s192{width:96px;height:96px}
.tile.s48{width:48px;height:48px}
@media (max-width:1100px){.strip{grid-template-columns:repeat(5,minmax(0,1fr))}.intro{grid-template-columns:1fr}}
"""

JS = r"""
(function(){
  var store = 'lt-logo-shortlist';
  function els(sel){ return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function chosen(){ return els('input[name=logo]').filter(function(r){ return r.checked; })[0] || null; }
  function save(){
    var c = chosen();
    var st = {logo: c ? c.value : '', fields: {}};
    els('textarea').forEach(function(t){ st.fields[t.id] = t.value; });
    try { localStorage.setItem(store, JSON.stringify(st)); } catch (e) {}
  }
  function load(){
    var st = null;
    try { st = JSON.parse(localStorage.getItem(store) || 'null'); } catch (e) {}
    if (!st) return;
    els('input[name=logo]').forEach(function(r){ r.checked = r.value === st.logo; });
    els('textarea').forEach(function(t){ if (st.fields[t.id] != null) t.value = st.fields[t.id]; });
  }
  function refresh(){
    var c = chosen();
    els('input[name=logo]').forEach(function(r){
      var card = document.getElementById('fig-' + r.value);
      if (card) card.classList.toggle('picked', r.checked);
    });
    document.getElementById('pick-list').textContent = c
      ? 'Your pick: ' + c.getAttribute('data-name')
      : 'Nothing picked yet: choose "This is the app logo" on one of the figures.';
  }
  function val(id){ var e = document.getElementById(id); return e ? e.value.trim() : ''; }
  function answers(){
    var c = chosen();
    var lines = [];
    lines.push('Brick Tracker logo shortlist (direction D, app tile)');
    lines.push('');
    lines.push('1. Which one is the app logo?');
    lines.push('   Pick: ' + (c ? c.getAttribute('data-name') : '(none)'));
    lines.push('   Comment: ' + (val('c-logo') || '(none)'));
    lines.push('');
    lines.push('2. Anything to change on it?');
    lines.push('   Comment: ' + (val('c-change') || '(none)'));
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


def img_src(folder, key, size=None):
    return 'renders/%s/%s%s.png' % (folder, key, '' if size is None else '-%d' % size)


def tile_html(fig, src, cls, alt=''):
    t0, t1 = fig['tile']
    return ('<div class="tile %s" style="background:linear-gradient(160deg,%s,%s)"><img src="%s" alt="%s"></div>'
            % (cls, t0, t1, src, esc(alt)))


def short_name(fig):
    return fig['name'].replace(' the ', ' ').split(' ')[0] if not fig['key'].startswith('raver') else fig['name']


def strip(entries, theme):
    """Every figure side by side at 192 px (shown at 96 css px) and 48 px."""
    cells = []
    for fig, folder in entries:
        cells.append('<div class="cell"><div class="row">%s%s</div><span>%s</span></div>'
                     % (tile_html(fig, img_src(folder, fig['key'], 192), 's192'),
                        tile_html(fig, img_src(folder, fig['key'], 192), 's48'), esc(short_name(fig))))
    return '<div class="strip %s">%s</div>' % (theme, ''.join(cells))


def card(i, fig, folder, tag):
    key = fig['key']

    def swatch(theme):
        return ('<div class="sw %s"><div class="cell">%s<span>192</span></div><div class="cell">%s<span>48</span></div></div>'
                % (theme, tile_html(fig, img_src(folder, key, 192), 's192'),
                   tile_html(fig, img_src(folder, key, 48), 's48')))
    return ('<section class="fig" id="fig-%s"><h3><span class="num">%02d</span>%s%s</h3>'
            '<p class="blurb">%s</p><div class="hero">%s</div>'
            '<div class="sizes">%s%s<p class="note">192 px is the desktop and Chrome app icon (shown at 96 css px, '
            'sharp on a 2x screen); 48 px is the favicon at its true size.</p></div>'
            '<label class="pick"><input type="radio" name="logo" value="%s" data-name="%s"> This is the app logo</label>'
            '</section>'
            % (key, i + 1, esc(fig['name']), tag, esc(fig['blurb']),
               tile_html(fig, img_src(folder, key), 'big', fig['name']), swatch('light'), swatch('dark'),
               key, esc(fig['name'])))


def page_html():
    byk = mf.by_key()
    picks = [(byk[k], f) for k, f in PICKS]
    ravers = [(byk[k], f) for k, f in RAVERS]
    cards_p, cards_r = [], []
    for i, (fig, folder) in enumerate(picks):
        tag = ' <span class="tag fixed">headphones fixed</span>' if fig['key'] == 'studbot' else ''
        if fig.get('mascot'):
            tag = ' <span class="tag">mascot</span>' + tag
        cards_p.append(card(i, fig, folder, tag))
    for i, (fig, folder) in enumerate(ravers):
        cards_r.append(card(len(picks) + i, fig, folder, ' <span class="tag new">new</span>'))
    allf = picks + ravers
    return """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Brick Tracker logo shortlist</title>
<style>%(css)s</style></head>
<body>
<header><div class="brand"><div class="brick"></div><h1>Brick Tracker logo shortlist<small>direction D, the app tile: your five picks and Dex the Raver</small></h1></div>
<nav><a href="shortlist.html" class="on">Shortlist</a><a href="d.html">D: App icon tile (all 14)</a></nav></header>
<main>
<div class="intro">
<div class="panel"><h2>The shortlist</h2>
<p>Your five picks from page D (Studbot, Nova the Astronaut, Mortimer the Wizard, Bjorn the Viking, Glim the Ghost)
and the new figure you asked for, Dex the Raver, in four variants. All in direction D: the glossy figure rising
from a rounded tile in its own colours, the shape of a desktop or Chrome app icon.</p>
<p>Pick the one that becomes the app logo. The icon files are made from your pick in the next step.</p></div>
<div class="panel note"><h2>What changed</h2>
<p><b>Studbot:</b> the headphones are rebuilt. The band now runs over the top of the head, just behind the stud,
and the two cups sit centred on the sides of the head at ear height, flush against it.</p>
<p><b>Dex the Raver</b> is new: a normal guy with spiky messy short hair and headphones over his ears, in four takes on
the hair colour, the headphones and the rave print. He is an original character; the prints carry no band or brand logo.</p></div>
</div>

<h2 class="group">Side by side</h2>
<p class="group">All nine at 192 px (desktop and Chrome app icon) and 48 px (favicon), on light and on dark.</p>
%(strip_l)s
%(strip_d)s

<h2 class="group">Your five picks</h2>
<p class="group">Studbot is a new render with the fixed headphones; the other four are as they were on page D.</p>
<div class="grid">%(cards_p)s</div>

<h2 class="group">New: Dex the Raver, four variants</h2>
<p class="group">Same bust framing and face style as the others. Acid: brown hair, big black DJ cans, the yellow acid smiley
on black. Checker: bleached blond, a slim silver band, a smiley on a checkerboard band. Tie-dye: hot pink hair, neon lime cans,
a neon smiley on a tie-dye spiral. Glow: cyan hair, slim white cans with LED rings, glow sticks on a dark tee.</p>
<div class="grid">%(cards_r)s</div>

<section class="q panel"><h2>1. Which one is the app logo?</h2>
<p class="hint">Choose "This is the app logo" on one figure.</p>
<div class="picks" id="pick-list"></div>
<textarea id="c-logo" placeholder="Optional comment: why this one, or a runner-up"></textarea></section>

<section class="q panel"><h2>2. Anything to change on it?</h2>
<p class="hint">For example the tile colour, the hair colour, the headphones, the print or the framing.</p>
<textarea id="c-change" placeholder="Optional comment"></textarea></section>

<section class="q panel"><h2>Additional comments</h2>
<textarea id="c-additional" placeholder="Optional"></textarea>
<div class="copy"><button id="copy-btn" type="button">Copy answers</button><span id="copied"></span></div>
<pre id="manual" style="display:none;white-space:pre-wrap;background:#f4f5f7;padding:10px;border-radius:8px"></pre></section>
</main>
<footer>
<p>Parts: the LDraw.org Parts Library (ldraw.org), licensed CC BY 2.0 and CC BY 4.0; imported with the ImportLDraw add-on for Blender.
The headphones are modelled by docs/design/logo-minifigs/render_bust.py and fitted to each head and hair.
Rendered headless in Blender 4.5 (Cycles). Face and torso prints drawn for Brick Tracker by docs/design/logo-minifigs/minifigs.py.</p>
<p>LEGO and the minifigure figurine are trademarks of the LEGO Group, which does not sponsor, authorize or endorse Brick Tracker.</p>
</footer>
<script>%(js)s</script>
</body></html>
""" % dict(css=CSS, js=JS, strip_l=strip(allf, 'light'), strip_d=strip(allf, 'dark'),
           cards_p=''.join(cards_p), cards_r=''.join(cards_r))


def main():
    missing = [] if '--page-only' in sys.argv else finish_images()
    path = os.path.join(HERE, 'shortlist.html')
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(page_html())
    print('page', path)
    for key, folder in PICKS + RAVERS:
        for size in (None,) + SIZES:
            p = os.path.join(HERE, img_src(folder, key, size).replace('/', os.sep))
            if not os.path.exists(p):
                missing.append(img_src(folder, key, size))
    if missing:
        print('MISSING: ' + ', '.join(sorted(set(missing))))
    mb = folder_mb()
    print('folder %.1f MB%s' % (mb, ' (OVER %.0f MB)' % LIMIT_MB if mb > LIMIT_MB else ''))


main()
