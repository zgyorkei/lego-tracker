"""Brick Tracker logo, the toon redraw (LT.LOGO.TOON): small copies and toon.html.

Run with Blender's bundled Python (numpy, no Pillow), isolated:
  <blender>/4.5/python/bin/python.exe -I toon.py [--pages-only]

The user picked four figures on page C (Glim the Ghost, Darth Jar-Jar, Batman and
Possessed Chef Enzo) and asked for them redrawn in the toon style in all four
variants. As agreed with the user on 28 Nov, the three franchise picks are not
copied: each slot has an original figure of the same type (minifigs.py, TOON):
Captain Clutch for Batman, Lord Grumble for Darth Jar-Jar and Chef Gusto for
Chef Enzo. Glim is an original already. The renders come from render_bust.py,
style B, at 1024 px:
  renders/T/<key>.png   toon with outlines        (--style B --folder T)
  renders/TP/<key>.png  toon without outlines     (--style B --lines off --folder TP)
This script cleans them, writes <key>-192.png and <key>-48.png beside them (as
finish.py does) and writes toon.html: a grid of the four figures by the four
variants, each cell at full size and at 192 and 48 px on light and on dark.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import minifigs as mf
from pngio import read_png, write_png, resample_premultiplied
from finish import CSS, SIZES, RENDERS, LIMIT_MB, badge_svg, tile_html, esc, folder_mb

PICKS = ['ghost', 'clutch', 'grumble', 'haunted-chef']
FOLDERS = ('T', 'TP')

# (id, folder of the base render, title, what it is)
VARIANTS = [
    ('plain', 'TP', 'Plain toon bust',
     "A's framing: the bust on its own, in flat toon colours with no outlines."),
    ('toon', 'T', 'Toon with outlines',
     "B: the same toon render with a thick outer line and thin inner lines."),
    ('badge', 'T', 'Round badge',
     "C: the outlined toon bust in a round emblem with BRICK TRACKER around the top; the 48 px size drops the text."),
    ('tile', 'T', 'App icon tile',
     "D: the outlined toon bust rising from a rounded square in its own colours (D used the glossy render before)."),
]

# every figure on the page is an original; the stand-ins name the pick they replace and its owner
SAFE = {k: 'original' for k in PICKS}
STANDS_FOR = {
    'clutch': ('Batman', 'DC',
               'a brooding caped guardian of the night: a rounded hood, a long cape, a teal domino mask, '
               'a crescent-moon emblem and a stern frown. Nothing is taken from Batman: no bat emblem, '
               'no pointed cowl ears, no bat-suit colours.'),
    'grumble': ('Darth Jar-Jar', 'Lucasfilm',
                'a clumsy, comic dark lord: a big gold crown, a near-black robe with a high wine-red collar, '
                'a scheming buck-toothed grin and a nervous sweat drop. No Gungan features, no Sith hood, '
                'no lightsaber.'),
    'haunted-chef': ('Possessed Chef Enzo', 'LEGO Hidden Side',
                     'a chef taken over by a ghost: a ghost-blue face, glowing eyes, a wobbly grin and glowing '
                     'wisps curling up his whites. It does not copy Enzo\'s look.'),
}


# ---------------------------------------------------------------------------
# Images

def finish_images():
    """Clean the T and TP renders and write their 192 and 48 px copies; returns the missing ones."""
    missing = []
    for folder in FOLDERS:
        for key in PICKS:
            src = os.path.join(RENDERS, folder, key + '.png')
            if not os.path.exists(src):
                missing.append('%s/%s' % (folder, key))
                continue
            clean = read_png(src).copy()
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


# ---------------------------------------------------------------------------
# The page

TOON_CSS = """
main{max-width:1500px}
.matrix{display:grid;grid-template-columns:170px repeat(4,minmax(232px,1fr));gap:12px;overflow-x:auto;padding-bottom:6px}
.matrix .colh{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 12px}
.matrix .colh h3{margin:0;font-size:15px}
.matrix .colh p{margin:4px 0 0;color:var(--muted);font-size:12.5px}
.matrix .corner{display:flex;align-items:flex-end;color:var(--muted);font-size:12.5px;padding:0 4px 8px}
.matrix .rowh{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:6px}
.matrix .rowh h3{margin:0;font-size:15px;line-height:1.25}
.matrix .rowh p{margin:0;color:var(--muted);font-size:12.5px}
.matrix .rowh .stand{font-size:12px;color:var(--ink)}
.cell{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px;display:flex;flex-direction:column;gap:8px}
.cell.row-on,.cell.col-on,.rowh.on,.colh.on{border-color:#f0a3a6}
.cell.row-on.col-on{border-color:var(--accent);box-shadow:0 0 0 2px rgba(227,0,11,.22)}
.cell .hero{height:206px}
.cell .hero img{width:192px;height:192px}
.cell .sw{justify-content:space-around}
.tile.mid{width:184px;height:184px}
.tag.ok{background:#1d7a3a;color:#fff}
.legend{margin:0 0 12px;color:var(--muted);font-size:13px}
.q .radios label .sub{color:var(--muted);font-weight:400;font-size:12.5px}
"""

JS = r"""
(function(){
  var store = 'lt-logo-toon';
  function els(sel){ return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function val(id){ var e = document.getElementById(id); return e ? e.value.trim() : ''; }
  function radio(name){
    var r = els('input[name=' + name + ']').filter(function(x){ return x.checked; })[0];
    return r ? r : null;
  }
  function save(){
    var st = {};
    els('textarea').forEach(function(t){ st[t.id] = t.value; });
    els('input[type=radio]').forEach(function(r){ if (r.checked) st[r.name] = r.value; });
    try { localStorage.setItem(store, JSON.stringify(st)); } catch (e) {}
  }
  function load(){
    var st = null;
    try { st = JSON.parse(localStorage.getItem(store) || 'null'); } catch (e) {}
    if (!st) return;
    els('textarea').forEach(function(t){ if (st[t.id] != null) t.value = st[t.id]; });
    els('input[type=radio]').forEach(function(r){ r.checked = st[r.name] === r.value; });
  }
  function refresh(){
    var f = radio('figure'), v = radio('variant');
    var fk = f ? f.value : '', vk = v ? v.value : '';
    els('.cell').forEach(function(c){
      c.classList.toggle('row-on', c.getAttribute('data-fig') === fk);
      c.classList.toggle('col-on', c.getAttribute('data-var') === vk);
    });
    els('.rowh').forEach(function(h){ h.classList.toggle('on', h.getAttribute('data-fig') === fk); });
    els('.colh').forEach(function(h){ h.classList.toggle('on', h.getAttribute('data-var') === vk); });
  }
  function label(r){ return r ? r.getAttribute('data-label') : '(no answer)'; }
  function answers(){
    var lines = [];
    lines.push('Brick Tracker logo, the toon redraw (toon.html)');
    lines.push('');
    lines.push('1. Which figure is the logo?');
    lines.push('   Pick: ' + label(radio('figure')));
    lines.push('   Comment: ' + (val('c-figure') || '(none)'));
    lines.push('');
    lines.push('2. Which variant?');
    lines.push('   Pick: ' + label(radio('variant')));
    lines.push('   Comment: ' + (val('c-variant') || '(none)'));
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


def src(folder, key, size=None):
    return 'renders/%s/%s%s.png' % (folder, key, '' if size is None else '-%d' % size)


def tag(fig):
    if SAFE.get(fig['key']) == 'original':
        out = '<span class="tag ok" title="An original Brick Tracker character">original</span>'
        if fig['key'] in STANDS_FOR:
            pick, owner, _ = STANDS_FOR[fig['key']]
            out += (' <span class="tag fr" title="Your pick %s is a franchise character: %s owns it">in place of %s (%s)</span>'
                    % (esc(pick), esc(owner), esc(pick), esc(owner)))
        return out
    owner = fig.get('owner') or 'franchise'
    return '<span class="tag fr" title="A franchise character: %s owns it">%s</span>' % (esc(owner), esc(owner))


def cell(fig, variant):
    vid, folder, _title, _desc = variant
    key = fig['key']
    uid = iter(range(100))

    def small(size):
        """192 px shown at 96 css px (sharp on a 2x screen), 48 px at its true size."""
        if vid in ('plain', 'toon'):
            return '<img class="s%d" src="%s" alt="">' % (size, src(folder, key, size))
        if vid == 'badge':
            return badge_svg(fig, '%s%s%d' % (key, vid, next(uid)), src(folder, key, 192), 96 if size == 192 else 48,
                             text=size == 192)
        return tile_html(fig, src(folder, key, 192), 's%d' % size)

    if vid in ('plain', 'toon'):
        big = '<img src="%s" alt="%s">' % (src(folder, key), esc(fig['name']))
    elif vid == 'badge':
        big = badge_svg(fig, key + 'L', src(folder, key), 192)
    else:
        big = tile_html(fig, src(folder, key), 'mid')

    def swatch(theme):
        return ('<div class="sw %s"><div class="cell-s">%s<span>192</span></div><div class="cell-s">%s<span>48</span></div></div>'
                % (theme, small(192), small(48)))
    return ('<div class="cell" data-fig="%s" data-var="%s"><div class="hero plain">%s</div>%s%s</div>'
            % (key, vid, big, swatch('light'), swatch('dark')))


def stands(fig):
    if fig['key'] in STANDS_FOR:
        pick, owner, what = STANDS_FOR[fig['key']]
        return 'In the place of your %s pick (%s), an original of the same type: %s' % (pick, owner, what)
    if SAFE.get(fig['key']) == 'original':
        return 'An original Brick Tracker character, as on the earlier pages, now in the toon style in every variant.'
    return 'As on the earlier pages, now in the toon style in every variant.'


def page_html():
    byk = mf.by_key()
    figs = [byk[k] for k in PICKS]
    head = ['<div class="corner">Figure \\ variant</div>']
    for i, (vid, _f, title, desc) in enumerate(VARIANTS):
        head.append('<div class="colh" data-var="%s"><h3>%d. %s</h3><p>%s</p></div>' % (vid, i + 1, esc(title), esc(desc)))
    rows = []
    for fig in figs:
        rows.append('<div class="rowh" data-fig="%s"><h3>%s</h3>%s<p>%s</p><p class="stand">%s</p></div>'
                    % (fig['key'], esc(fig['name']), tag(fig), esc(fig['blurb']), esc(stands(fig))))
        rows.extend(cell(fig, v) for v in VARIANTS)
    fig_radios = ''.join(
        '<label><input type="radio" name="figure" value="%s" data-label="%s"> %s <span class="sub">(%s)</span></label>'
        % (f['key'], esc(f['name']), esc(f['name']),
           ('original, in place of %s' % esc(STANDS_FOR[f['key']][0])) if f['key'] in STANDS_FOR
           else 'original' if SAFE.get(f['key']) == 'original' else esc(f.get('owner') or 'franchise'))
        for f in figs)
    fig_radios += '<label><input type="radio" name="figure" value="none" data-label="None of these yet"> None of these yet</label>'
    var_radios = ''.join(
        '<label><input type="radio" name="variant" value="%s" data-label="%d. %s"> %d. %s</label>'
        % (vid, i + 1, esc(title), i + 1, esc(title)) for i, (vid, _f, title, _d) in enumerate(VARIANTS))
    var_radios += '<label><input type="radio" name="variant" value="none" data-label="None of these yet"> None of these yet</label>'
    return """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Brick Tracker logo, the toon redraw</title>
<style>%(css)s%(tcss)s
.cell-s{display:flex;flex-direction:column;align-items:center;gap:2px;font-size:10.5px;color:#7a8190}
.sw.dark .cell-s{color:#8d94a3}
</style></head>
<body>
<header><div class="brand"><div class="brick"></div><h1>Brick Tracker logo<small>your four picks as original toon figures, in all four variants</small></h1></div>
<nav><a class="on" href="toon.html">Toon redraw</a><a href="a.html">A</a><a href="b.html">B</a><a href="c.html">C</a><a href="d.html">D</a><a href="shortlist.html">Shortlist</a></nav></header>
<main>
<div class="intro">
<div class="panel"><h2>Your picks from page C, all in the toon style</h2>
<p>On page C you picked Glim the Ghost, Darth Jar-Jar, Batman and Possessed Chef Enzo and asked for them redrawn in the toon
style for all four variants. Each row is one figure; each column is one of the four directions (A to D), now all built on
the toon render (cel shading, Blender 4.5). Every cell shows the figure large, then at 192 px (desktop and Chrome app icon,
shown at 96 css px) and 48 px (favicon), on light and on dark.</p>
<p>As agreed on 28 Nov, the three franchise picks are not copied. Each slot has an original figure of the same type, with its
own outline, colours and emblem, pushed so it reads at a glance even at 48 px: Captain Clutch (a brooding caped guardian of
the night) for Batman, Lord Grumble (a clumsy, comic dark lord) for Darth Jar-Jar, and Chef Gusto (a chef taken over by a
ghost) for Possessed Chef Enzo. Glim stays as he was.</p></div>
<div class="panel note"><h2>About the figures</h2>
<p>All four figures are original Brick Tracker characters. The picks they replace are franchise characters, named on each row
with their owners: Batman (DC), Darth Jar-Jar (Lucasfilm) and Possessed Chef Enzo (LEGO Hidden Side).</p>
<p>An original figure such as Glim is the safe pick for a published app. The minifigure shape itself is a LEGO trademark,
so check that before publishing any of them.</p></div>
</div>
<p class="legend">Pick a figure (question 1) and a variant (question 2) below: the row and the column light up, and the cell
where they meet is your logo.</p>
<div class="matrix">%(head)s%(rows)s</div>

<section class="q panel"><h2>1. Which figure is the logo?</h2>
<p class="hint">One pick.</p>
<div class="radios">%(fig_radios)s</div>
<textarea id="c-figure" placeholder="Optional comment on the figure"></textarea></section>

<section class="q panel"><h2>2. Which variant?</h2>
<p class="hint">One pick: the plain toon bust, the toon with outlines, the round badge or the app icon tile.</p>
<div class="radios">%(var_radios)s</div>
<textarea id="c-variant" placeholder="Optional comment on the variant"></textarea></section>

<section class="q panel"><h2>3. Anything to change?</h2>
<p class="hint">Colours, faces, headgear, framing, the outlines, the badge ring or text, the tile colours.</p>
<textarea id="c-changes" placeholder="Optional comment"></textarea></section>

<section class="q panel"><h2>Additional comments</h2>
<textarea id="c-additional" placeholder="Optional"></textarea>
<div class="copy"><button id="copy-btn" type="button">Copy answers</button><span id="copied"></span></div>
<pre id="manual" style="display:none;white-space:pre-wrap;background:#f4f5f7;padding:10px;border-radius:8px"></pre></section>
</main>
<footer>
<p>Parts: the LDraw.org Parts Library (ldraw.org), licensed CC BY 2.0 and CC BY 4.0; imported with the ImportLDraw add-on for Blender.
Rendered headless in Blender 4.5 (Cycles). Face and torso prints drawn for Brick Tracker by docs/design/logo-minifigs/minifigs.py.</p>
<p>LEGO, the minifigure figurine and Hidden Side are trademarks of the LEGO Group; Star Wars and Jar Jar Binks of Lucasfilm Ltd.;
Batman of DC. None of them sponsors, authorizes or endorses Brick Tracker. The figures on this page are original characters made
for Brick Tracker; the franchise figures they replace (on the earlier pages) carry LEGO, Lucasfilm and DC marks, so an original
figure such as Glim is the safe pick for a published app.</p>
</footer>
<script>%(js)s</script>
</body></html>
""" % dict(css=CSS, tcss=TOON_CSS, head=''.join(head), rows=''.join(rows), fig_radios=fig_radios,
           var_radios=var_radios, js=JS)


def main():
    missing = [] if '--pages-only' in sys.argv else finish_images()
    path = os.path.join(HERE, 'toon.html')
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(page_html())
    print('page', path)
    if missing:
        print('MISSING renders: ' + ', '.join(missing))
    mb = folder_mb()
    print('folder %.1f MB%s' % (mb, ' (OVER %.0f MB)' % LIMIT_MB if mb > LIMIT_MB else ''))


if __name__ == '__main__':
    main()
