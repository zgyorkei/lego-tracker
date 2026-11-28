"""Render Brick Tracker minifigure busts (LT.LOGO.MINIFIGS) in Blender 4.5, headless.

The figures are in minifigs.py: originals made for Brick Tracker, and the franchise
figures the user asked for (LT.LOGO.MINIFIGS.FIX1). The parts come from
the LDraw parts library through the ImportLDraw add-on; the face and torso
prints are drawn by minifigs.py and mapped onto the head (cylindrical UVs) and
the torso front (planar UVs) by this script.

  blender.exe -b --factory-startup --python render_bust.py -- --style A|B
      [--only key,key] [--out DIR] [--res 1024] [--samples N] [--exposure 0]
      [--addon DIR] [--library DIR] [--scratch DIR]
      [--folder NAME] [--view q|front] [--suffix TEXT] [--lines on|off]

--folder writes into <out>/<NAME> instead of <out>/<style>; --view front turns
the camera to face the figure (a check view); --suffix is added to every file
name (previews); --lines off leaves out style B's outlines (LT.LOGO.TOON's plain
toon bust). LT.LOGO.SHORTLIST renders into renders/S, LT.LOGO.TOON into renders/T
(outlined) and renders/TP (plain).

Style A: glossy studio plastic (Cycles, Principled BSDF, area lights, OIDN).
Style B: toon (Cycles, emission shading by a constant ramp on N.L, Freestyle
outlines). Output: <out>/<key>.png, RGBA with a transparent background.
"""
import sys, os, re, math, time, importlib, argparse, tempfile
import bpy
import numpy as np
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import minifigs as mf

ART = os.path.join(os.environ.get('LOCALAPPDATA', ''), 'BrickBudgetArt')


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser(prog='render_bust.py')
    ap.add_argument('--style', choices=['A', 'B', 'AB'], default='A')
    ap.add_argument('--only', default='')
    ap.add_argument('--out', default='')
    ap.add_argument('--res', type=int, default=1024)
    ap.add_argument('--samples', type=int, default=0)
    ap.add_argument('--exposure', type=float, default=0.0)
    ap.add_argument('--addon', default=os.path.join(ART, 'ImportLDraw'))
    ap.add_argument('--library', default=os.path.join(ART, 'ldraw-lib', 'ldraw'))
    ap.add_argument('--scratch', default=os.path.join(tempfile.gettempdir(), 'lt-logo-scratch'))
    ap.add_argument('--diag', action='store_true', help='print the imported objects and materials')
    # LT.LOGO.SHORTLIST: previews and a folder of their own
    ap.add_argument('--folder', default='', help='output subfolder (default: the style letter)')
    ap.add_argument('--view', choices=['q', 'front'], default='q', help='q: the 3/4 view of the pages; front: a check view')
    ap.add_argument('--suffix', default='', help='added to every output file name (previews)')
    # LT.LOGO.TOON: style B without the Freestyle ink lines (the plain toon bust)
    ap.add_argument('--lines', choices=['on', 'off'], default='on', help='style B: draw the outlines (default on)')
    a = ap.parse_args(argv)
    a.base_out = a.out or os.path.join(HERE, 'renders')
    a.base_samples = a.samples
    return a


def for_style(a, style):
    """The arguments for one style: its own output folder and sample count."""
    b = argparse.Namespace(**vars(a))
    b.style = style
    b.out = os.path.join(a.base_out, a.folder or style)
    b.samples = a.base_samples or (80 if style == 'A' else 16)
    return b


# ---------------------------------------------------------------------------
# LDraw model of one bust

LDU = 0.0004                 # ImportLDraw's globalScaleFactor (metres per LDU)
TORSO_CODE, ARM_CODE, HEAD_CODE = 92, 100, 110
ROLE_CODES = [112, 115, 118, 120, 125, 85]
NECK_PARTS = {'6132.dat', '60749.dat', '15428.dat', '20551c01.dat', '4524.dat'}   # beards, a folded-down hood and a cape sit on the torso's neck
NECK_HEADS = {'30371.dat'}   # character heads whose origin is the neck socket (the Gungan head), not the head's top
HEAD_Y = -24.0


def write_ldr(fig, path):
    roles = {}
    lines = ['0 %s' % fig['name'], '0 Name: %s' % os.path.basename(path), '0 Author: Brick Tracker logo script']
    lines.append('1 %d 0 0 0 1 0 0 0 1 0 0 0 1 %s' % (TORSO_CODE, mf.TORSO))
    lines.append('1 %d 15.552 9 0 0.9962 0.0872 0 -0.0872 0.9962 0 0 0 1 3819.dat' % ARM_CODE)
    lines.append('1 %d -15.552 9 0 0.9962 -0.0872 0 0.0872 0.9962 0 0 0 1 3818.dat' % ARM_CODE)
    head = fig.get('head_part') or mf.HEAD
    lines.append('1 %d 0 %g 0 1 0 0 0 1 0 0 0 1 %s' % (HEAD_CODE, 0.0 if head.lower() in NECK_HEADS else HEAD_Y, head))
    for i, gear in enumerate(fig['headgear']):
        part, role = gear[0], gear[1]
        code = ROLE_CODES[i]
        roles[code] = role
        y = 0.0 if part.lower() in NECK_PARTS else HEAD_Y
        lines.append('1 %d 0 %g 0 1 0 0 0 1 0 0 0 1 %s' % (code, y, part))
    with open(path, 'w') as f:
        f.write('\n'.join(lines) + '\n')
    return roles


class Ctx:
    def __init__(s, c): s._c = c
    def report(s, *a): pass
    def __getattr__(s, n): return getattr(s._c, n)


def import_ldr(path, args):
    if args.addon not in sys.path:
        sys.path.insert(0, args.addon)
    from loadldraw import loadldraw
    importlib.reload(loadldraw)          # fresh caches for every figure
    o = loadldraw.Options
    o.ldrawDirectory = args.library
    o.positionObjectOnGroundAtOrigin = False
    o.positionCamera = False
    o.addGroundPlane = False
    o.addWorldEnvironmentTexture = False
    o.setRenderSettings = False
    o.importCameras = False
    o.verbose = 0
    o.studLogoDirectory = os.path.join(args.addon, 'studs')
    o.useLogoStuds = False
    o.resolution = 'High'
    o.numberNodes = True
    o.realScale = 1
    loadldraw.loadFromFile(Ctx(bpy.context), path, True)
    return loadldraw


def world_to_ld(w):
    """World (Blender) coordinates to LDraw figure coordinates (y down, front -z)."""
    return (w[0] / LDU, -w[2] / LDU, w[1] / LDU)


def part_objects():
    out = {}
    for ob in bpy.context.scene.objects:
        if ob.type != 'MESH':
            continue
        m = re.search(r'([0-9a-z]+)\.dat', ob.name.lower()) or re.search(r'([0-9a-z]+)\.dat', ob.data.name.lower())
        key = (m.group(1) + '.dat') if m else ob.name.lower()
        out.setdefault(key, []).append(ob)
    return out


# ---------------------------------------------------------------------------
# UVs for the prints

def uv_layer(ob):
    me = ob.data
    if 'Print' not in me.uv_layers:
        me.uv_layers.new(name='Print')
    return me.uv_layers['Print']


def head_uvs(ob):
    me = ob.data
    mw = ob.matrix_world
    nmat = mw.to_3x3().inverted().transposed()
    uvl = uv_layer(ob).data
    s0, s1 = mf.FACE_RANGE
    t0, t1 = mf.FACE_T
    for poly in me.polygons:
        n = nmat @ poly.normal
        n_ld_y = -n.z / max(n.length, 1e-9)
        loops = list(poly.loop_indices)
        if abs(n_ld_y) > 0.75:
            for li in loops:
                uvl[li].uv = (-5.0, -5.0)
            continue
        angs, ts = [], []
        for li in loops:
            p = world_to_ld(mw @ me.vertices[me.loops[li].vertex_index].co)
            angs.append(math.atan2(p[0], -p[2]))
            ts.append(p[1] - HEAD_Y)
        if max(angs) - min(angs) > math.pi:          # straddles the back seam
            angs = [a + 2 * math.pi if a < 0 else a for a in angs]
        for li, a, t in zip(loops, angs, ts):
            s = mf.FACE_R * a
            uvl[li].uv = ((s - s0) / (s1 - s0), 1.0 - (t - t0) / (t1 - t0))


def torso_uvs(ob):
    me = ob.data
    mw = ob.matrix_world
    nmat = mw.to_3x3().inverted().transposed()
    uvl = uv_layer(ob).data
    x0, x1 = mf.TORSO_X
    y0, y1 = mf.TORSO_Y
    for poly in me.polygons:
        n = nmat @ poly.normal
        n = n / max(n.length, 1e-9)
        front = -n.y                     # world -Y is the figure's front
        for li in poly.loop_indices:
            if front < 0.45:
                uvl[li].uv = (-5.0, -5.0)
                continue
            p = world_to_ld(mw @ me.vertices[me.loops[li].vertex_index].co)
            uvl[li].uv = ((p[0] - x0) / (x1 - x0), 1.0 - (p[1] - y0) / (y1 - y0))


def canvas_images(name, canvas):
    rgba = np.flipud(canvas.rgba_straight()).astype(np.float32)
    H, W = rgba.shape[:2]
    img = bpy.data.images.new(name, W, H, alpha=True)
    img.alpha_mode = 'STRAIGHT'
    img.pixels.foreach_set(rgba.ravel())
    img.pack()
    glow = np.flipud(canvas.glow).astype(np.float32)
    g = np.repeat(glow[..., None], 4, axis=2)
    g[..., 3] = 1.0
    gimg = bpy.data.images.new(name + '_glow', W, H, alpha=True)
    gimg.colorspace_settings.name = 'Non-Color'
    gimg.pixels.foreach_set(g.ravel())
    gimg.pack()
    return img, gimg


# ---------------------------------------------------------------------------
# Materials

def lin(hexc):
    return mf.srgb_to_linear(mf.hex_rgb(hexc)) + (1.0,)


def spec_of(v):
    if isinstance(v, tuple):
        return v[0], v[1]
    return v, 'plastic'


CAM_AZ = math.radians(-30.0)       # camera swings to the figure's right (world -X)
CAM_EL = math.radians(12.0)


def cam_dir():
    """Unit vector from the figure towards the camera."""
    return Vector((math.sin(CAM_AZ), -math.cos(CAM_AZ), math.tan(CAM_EL))).normalized()


TOON_L = Vector((-0.55, -0.62, 0.78)).normalized()     # the toon light: upper left front


def make_material(name, color, kind, style, prints=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nodes, links = nt.nodes, nt.links
    nodes.clear()
    out = nodes.new('ShaderNodeOutputMaterial')
    base = nodes.new('ShaderNodeRGB')
    base.outputs[0].default_value = lin(color)
    col = base.outputs[0]
    glow = None
    if prints is not None:
        img, gimg = prints
        uv = nodes.new('ShaderNodeUVMap')
        uv.uv_map = 'Print'
        tex = nodes.new('ShaderNodeTexImage')
        tex.image = img
        tex.extension = 'CLIP'
        tex.interpolation = 'Linear'
        links.new(uv.outputs[0], tex.inputs[0])
        gtex = nodes.new('ShaderNodeTexImage')
        gtex.image = gimg
        gtex.extension = 'CLIP'
        links.new(uv.outputs[0], gtex.inputs[0])
        mix = nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        links.new(tex.outputs['Alpha'], mix.inputs['Factor'])
        links.new(col, mix.inputs[6])
        links.new(tex.outputs['Color'], mix.inputs[7])
        col = mix.outputs[2]
        glow = gtex.outputs['Color']
        tex_color = tex.outputs['Color']
    if style == 'A':
        bsdf = nodes.new('ShaderNodeBsdfPrincipled')
        links.new(col, bsdf.inputs['Base Color'])
        bsdf.inputs['Roughness'].default_value = 0.2
        bsdf.inputs['IOR'].default_value = 1.54
        bsdf.inputs['Coat Weight'].default_value = 0.25
        bsdf.inputs['Coat Roughness'].default_value = 0.08
        if kind == 'metal':
            bsdf.inputs['Metallic'].default_value = 0.85
            bsdf.inputs['Roughness'].default_value = 0.3
            bsdf.inputs['Coat Weight'].default_value = 0.0
        if kind == 'matte':                      # headphone ear pads
            bsdf.inputs['Roughness'].default_value = 0.55
            bsdf.inputs['Coat Weight'].default_value = 0.0
        if kind == 'neon':                       # LED rings
            bsdf.inputs['Roughness'].default_value = 0.35
            links.new(col, bsdf.inputs['Emission Color'])
            bsdf.inputs['Emission Strength'].default_value = 2.5
        elif kind == 'glow':
            links.new(col, bsdf.inputs['Emission Color'])
            bsdf.inputs['Emission Strength'].default_value = 0.3
        elif glow is not None:
            links.new(tex_color, bsdf.inputs['Emission Color'])
            gm = nodes.new('ShaderNodeMath')
            gm.operation = 'MULTIPLY'
            gm.inputs[1].default_value = 6.0
            links.new(glow, gm.inputs[0])
            links.new(gm.outputs[0], bsdf.inputs['Emission Strength'])
        links.new(bsdf.outputs[0], out.inputs['Surface'])
        return mat
    # style B: flat toon colour from a constant ramp on N.L, a hard highlight on N.H
    geo = nodes.new('ShaderNodeNewGeometry')
    ndl = nodes.new('ShaderNodeVectorMath')
    ndl.operation = 'DOT_PRODUCT'
    links.new(geo.outputs['Normal'], ndl.inputs[0])
    ndl.inputs[1].default_value = TOON_L
    ramp = nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.interpolation = 'CONSTANT'
    els = ramp.color_ramp.elements
    els[0].position = 0.0
    els[0].color = (0.58, 0.58, 0.62, 1)
    els[1].position = 0.22
    els[1].color = (1, 1, 1, 1)
    if kind == 'metal':
        e = els.new(0.75)
        e.color = (1.25, 1.25, 1.25, 1)
    links.new(ndl.outputs['Value'], ramp.inputs[0])
    mul = nodes.new('ShaderNodeMix')
    mul.data_type = 'RGBA'
    mul.blend_type = 'MULTIPLY'
    mul.inputs['Factor'].default_value = 1.0
    links.new(col, mul.inputs[6])
    links.new(ramp.outputs['Color'], mul.inputs[7])
    h = (TOON_L + cam_dir()).normalized()
    ndh = nodes.new('ShaderNodeVectorMath')
    ndh.operation = 'DOT_PRODUCT'
    links.new(geo.outputs['Normal'], ndh.inputs[0])
    ndh.inputs[1].default_value = h
    hl = nodes.new('ShaderNodeMath')
    hl.operation = 'GREATER_THAN'
    hl.inputs[1].default_value = 0.985 if kind != 'metal' else 0.95
    links.new(ndh.outputs['Value'], hl.inputs[0])
    hlk = nodes.new('ShaderNodeMath')
    hlk.operation = 'MULTIPLY'
    hlk.inputs[1].default_value = 0.55
    links.new(hl.outputs[0], hlk.inputs[0])
    add = nodes.new('ShaderNodeMix')
    add.data_type = 'RGBA'
    add.blend_type = 'MIX'
    links.new(hlk.outputs[0], add.inputs['Factor'])
    links.new(mul.outputs[2], add.inputs[6])
    add.inputs[7].default_value = (1, 1, 1, 1)
    em = nodes.new('ShaderNodeEmission')
    links.new(add.outputs[2], em.inputs['Color'])
    em.inputs['Strength'].default_value = 1.0
    final = em.outputs[0]
    if kind in ('glow', 'neon') or glow is not None:
        em2 = nodes.new('ShaderNodeEmission')
        if kind in ('glow', 'neon'):
            links.new(col, em2.inputs['Color'])
            em2.inputs['Strength'].default_value = 0.25 if kind == 'glow' else 0.8
        else:
            links.new(tex_color, em2.inputs['Color'])
            gm = nodes.new('ShaderNodeMath')
            gm.operation = 'MULTIPLY'
            gm.inputs[1].default_value = 0.6
            links.new(glow, gm.inputs[0])
            links.new(gm.outputs[0], em2.inputs['Strength'])
        sm = nodes.new('ShaderNodeAddShader')
        links.new(final, sm.inputs[0])
        links.new(em2.outputs[0], sm.inputs[1])
        final = sm.outputs[0]
    links.new(final, out.inputs['Surface'])
    return mat


def assign_materials(fig, roles, ld, style, face_imgs, torso_imgs):
    parts = part_objects()
    cache = {}
    fallback = {}

    def code_color(code):
        if code == TORSO_CODE:
            return fig['torso'], 'plastic', 'torso'
        if code == ARM_CODE:
            return fig['arms'], 'plastic', 'arms'
        if code == HEAD_CODE:
            return fig['head'], 'plastic', 'head'
        if code in roles:
            c, k = spec_of(fig['colors'][roles[code]])
            return c, k, roles[code]
        if code in fig['colors']:
            c, k = spec_of(fig['colors'][code])
            return c, k, 'c%d' % code
        data = ld.LegoColours.colours.get(code)
        if data:
            r, g, b = [min(1.0, max(0.0, v)) for v in data['colour'][:3]]
            to_s = lambda v: (v * 12.92) if v <= 0.0031308 else (1.055 * v ** (1 / 2.4) - 0.055)
            return '#%02x%02x%02x' % tuple(int(round(to_s(v) * 255)) for v in (r, g, b)), 'plastic', 'c%d' % code
        return '#888888', 'plastic', 'unknown'

    for key, obs in parts.items():
        for ob in obs:
            prints = None
            if key == mf.HEAD.lower():
                head_uvs(ob)
                prints = face_imgs
            elif key == mf.TORSO.lower():
                torso_uvs(ob)
                prints = torso_imgs
            for slot in ob.material_slots:
                m = re.match(r'Material_(\d+)', slot.material.name if slot.material else '')
                code = int(m.group(1)) if m else -1
                color, kind, label = code_color(code)
                pk = 'p' if (prints is not None and code in (TORSO_CODE, HEAD_CODE)) else 'n'
                ck = (label, pk)
                if ck not in cache:
                    cache[ck] = make_material('%s_%s_%s' % (fig['key'], label, pk), color, kind, style,
                                              prints if pk == 'p' else None)
                slot.material = cache[ck]
                fallback[label] = color
    return parts


# ---------------------------------------------------------------------------
# Headphones (LT.LOGO.SHORTLIST): modelled here and fitted to the head and the
# hair, since LDraw's one headphone part (14045) clips on a bare head's stud and
# hangs its cups at jaw height. All sizes in LDU, built in LDraw coordinates.

SKIP_FIT = {mf.TORSO.lower(), '3818.dat', '3819.dat'}


def ld_to_world(p):
    return (p[0] * LDU, p[2] * LDU, -p[1] * LDU)


def surface_points(ob, rng, n=30000):
    """The vertices plus points sampled on the faces (area weighted), in LDraw coordinates."""
    me = ob.data
    me.calc_loop_triangles()
    co = np.empty(len(me.vertices) * 3, np.float64)
    me.vertices.foreach_get('co', co)
    mw = np.array(ob.matrix_world)
    w = co.reshape(-1, 3) @ mw[:3, :3].T + mw[:3, 3]
    out = [w]
    nt = len(me.loop_triangles)
    if nt:
        tri = np.empty(nt * 3, np.int64)
        me.loop_triangles.foreach_get('vertices', tri)
        tri = tri.reshape(-1, 3)
        a, b, c = w[tri[:, 0]], w[tri[:, 1]], w[tri[:, 2]]
        area = 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1)
        if area.sum() > 0:
            idx = rng.choice(nt, size=n, p=area / area.sum())
            u, v = rng.random(n), rng.random(n)
            flip = u + v > 1
            u[flip], v[flip] = 1 - u[flip], 1 - v[flip]
            out.append(a[idx] + (b[idx] - a[idx]) * u[:, None] + (c[idx] - a[idx]) * v[:, None])
    w = np.concatenate(out)
    return np.stack([w[:, 0] / LDU, -w[:, 2] / LDU, w[:, 1] / LDU], axis=1)


def add_mesh(name, verts_ld, faces, mat, parts, group='phones'):
    import bmesh
    me = bpy.data.meshes.new(name)
    me.from_pydata([ld_to_world(v) for v in verts_ld], [], faces)
    me.update()
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.002 * LDU)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=0.002 * LDU)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    try:
        me.set_sharp_from_angle(angle=math.radians(50))
    except Exception:
        pass
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    parts.setdefault(group, []).append(ob)
    return ob


def lathe(profile, x0, side, ear_y, closed=False, seg=72):
    """Revolve [(u, rho)] about the LDraw x axis through (side*x0, ear_y, 0); u runs outwards from the head."""
    n = len(profile)
    verts = []
    for k in range(seg):
        a = 2 * math.pi * k / seg
        ca, sa = math.cos(a), math.sin(a)
        for (u, rho) in profile:
            verts.append((side * (x0 + u), ear_y - rho * ca, rho * sa))
    faces = []
    for k in range(seg):
        k2 = (k + 1) % seg
        for i in range(n if closed else n - 1):
            i2 = (i + 1) % n
            faces.append((k * n + i, k * n + i2, k2 * n + i2, k2 * n + i))
    return verts, faces


def rounded_section(cu, cr, hu, hr, expo=3.0, steps=28):
    """A closed superellipse cross-section [(u, rho)] centred at (cu, cr)."""
    pts = []
    for i in range(steps):
        f = 2 * math.pi * i / steps
        c, s = math.cos(f), math.sin(f)
        pts.append((cu + hu * math.copysign(abs(c) ** (2 / expo), c), cr + hr * math.copysign(abs(s) ** (2 / expo), s)))
    return pts


def build_phones(fig, parts, style):
    spec = fig['phones']
    rng = np.random.default_rng(7)
    head_pts, hair_pts = [], []
    for key, obs in parts.items():
        if key in SKIP_FIT or key == 'phones':
            continue
        for ob in obs:
            (head_pts if key == mf.HEAD.lower() else hair_pts).append(surface_points(ob, rng))
    head = np.concatenate(head_pts)
    hair = np.concatenate(hair_pts) if hair_pts else np.zeros((0, 3))
    allp = np.concatenate([head, hair])
    ear_y = HEAD_Y + mf.EAR_T
    R, D, th, w, q = spec['R'], spec['D'], spec['th'], spec['w'], spec['q']
    c = min(1.3, 0.3 * D)

    near = (np.abs(allp[:, 1] - ear_y) < 0.8 * R) & (np.abs(allp[:, 2]) < 0.8 * R)
    x_in = {s: float((s * allp[near, 0]).max()) + 0.12 for s in (-1, 1)}

    shell_c, shell_k = spec_of(spec['color'])
    m_shell = make_material(fig['key'] + '_phones', shell_c, shell_k, style)
    m_pad = make_material(fig['key'] + '_pads', spec['cushion'], 'matte', style)
    m_cap = m_led = None
    if spec.get('cap'):
        cc, ck = spec_of(spec['cap'])
        m_cap = make_material(fig['key'] + '_cap', cc, ck, style)
    if spec.get('led'):
        m_led = make_material(fig['key'] + '_led', spec['led'], 'neon', style)

    # the cups: a pad ring against the head, the shell, a cap dome or an LED ring outside
    for s in (-1, 1):
        x0 = x_in[s]
        tag = 'L' if s > 0 else 'R'
        v, f = lathe(rounded_section(c / 2, 0.69 * R, c / 2, 0.27 * R, expo=2.6), x0, s, ear_y, closed=True)
        add_mesh('phones_pad' + tag, v, f, m_pad, parts)
        u0, u1 = 0.7 * c, D
        rr = min(1.0, 0.4 * (u1 - u0))
        prof = [(u0, 0.0), (u0, 0.6 * R), (u0, R - 0.25)]
        prof += [(u0 + 0.25 - 0.25 * math.cos(a), R - 0.25 + 0.25 * math.sin(a))
                 for a in np.linspace(0.2, math.pi / 2, 4)]
        prof += [(u1 - rr + rr * math.sin(a), R - rr + rr * math.cos(a)) for a in np.linspace(0, math.pi / 2, 9)]
        prof += [(u1, 0.5 * (R - rr)), (u1, 0.0)]
        v, f = lathe(prof, x0, s, ear_y)
        add_mesh('phones_cup' + tag, v, f, m_shell, parts)
        if m_cap is not None:
            cr, ch = 0.62 * R, 0.6
            dome = [(u1 - 0.1, 0.0), (u1 - 0.1, cr)]
            dome += [(u1 + ch * math.sin(a), cr * math.cos(a)) for a in np.linspace(0, math.pi / 2, 10)]
            v, f = lathe(dome, x0, s, ear_y)
            add_mesh('phones_cap' + tag, v, f, m_cap, parts)
        if m_led is not None:
            v, f = lathe(rounded_section(u1 + 0.06, 0.8 * R, 0.16, 0.075 * R, expo=2.4), x0, s, ear_y, closed=True)
            add_mesh('phones_led' + tag, v, f, m_led, parts)

    # the band: in the plane through the ear axis, leaning back by tilt; its radius
    # follows the head (never into it) and the hair (into the spikes by quantile q)
    tilt = math.radians(spec['tilt'])
    o = np.array([0.0, ear_y, 0.0])
    e_x = np.array([1.0, 0.0, 0.0])
    e_up = np.array([0.0, -math.cos(tilt), math.sin(tilt)])
    nrm = np.cross(e_x, e_up)

    def polar(P):
        d = P - o
        a, b = d @ e_x, d @ e_up
        return np.degrees(np.arctan2(a, b)), np.hypot(a, b), np.abs(d @ nrm)

    TH = np.arange(-90.0, 90.1, 2.0)
    ah, rh, hh = polar(head)
    if len(hair):
        ahr, rhr, hhr = polar(hair)
    slab = w / 2 + 0.4
    raw = np.zeros(len(TH))
    for k, t in enumerate(TH):
        m = (np.abs(ah - t) < 3.0) & (hh < slab)
        r = float(rh[m].max()) if m.any() else 0.0
        if len(hair):
            m2 = (np.abs(ahr - t) < 3.0) & (hhr < slab) & (rhr > r + 0.3)
            if m2.sum() >= 3:
                r = max(r, float(np.quantile(rhr[m2], q)))
        raw[k] = r
    pad = np.pad(raw, 2, mode='edge')
    mx = np.array([pad[i:i + 5].max() for i in range(len(raw))])
    pad = np.pad(mx, 3, mode='edge')
    rad = np.array([pad[i:i + 7].mean() for i in range(len(raw))]) + th / 2 + 0.15
    for k, t in enumerate(TH):
        sm = min(1.0, max(0.0, (abs(t) - 62.0) / 28.0))
        sm = sm * sm * (3 - 2 * sm)
        target = x_in[1 if t > 0 else -1] + D / 2
        rad[k] = rad[k] * (1 - sm) + target * sm
    fine = np.arange(-90.0, 90.01, 1.0)
    rf = np.interp(fine, TH, rad)
    sec = []
    for i in range(20):
        f = 2 * math.pi * i / 20
        cs, sn = math.cos(f), math.sin(f)
        sec.append((math.copysign(abs(cs) ** 0.5, cs), math.copysign(abs(sn) ** 0.5, sn)))
    verts, faces = [], []
    ns = len(sec)
    for j, (t, r) in enumerate(zip(fine, rf)):
        tr = math.radians(t)
        d = math.sin(tr) * e_x + math.cos(tr) * e_up
        P = o + r * d
        for (sx, sy) in sec:
            verts.append(tuple(P + d * (th / 2) * sx + nrm * (w / 2) * sy))
    nf = len(fine)
    for j in range(nf - 1):
        for i in range(ns):
            i2 = (i + 1) % ns
            faces.append((j * ns + i, j * ns + i2, (j + 1) * ns + i2, (j + 1) * ns + i))
    faces.append(tuple(range(ns))[::-1])
    faces.append(tuple((nf - 1) * ns + i for i in range(ns)))
    add_mesh('phones_band', verts, faces, m_shell, parts)
    print('PHONES %s ear_y=%.1f x_in=%.2f/%.2f band top r=%.2f (raw %.2f) head r(0)=%.2f'
          % (fig['key'], ear_y, x_in[-1], x_in[1], rad[len(TH) // 2], raw[len(TH) // 2],
             float(rh[(np.abs(ah) < 3) & (hh < slab)].max()) if ((np.abs(ah) < 3) & (hh < slab)).any() else -1),
          flush=True)


# ---------------------------------------------------------------------------
# Scene: camera, lights, render settings

# ---------------------------------------------------------------------------
# Lightsaber (LT.LOGO.TOON): modelled here, a metal hilt with a dark grip and a
# blade that glows from a pale core to its colour at the rim, in LDraw coordinates.

def revolve(profile, a, u, seg=40):
    """Revolve [(t, rho)] about the axis from LDraw point a along the unit vector u."""
    a, u = np.asarray(a, float), np.asarray(u, float)
    ref = np.array([0.0, 0.0, 1.0]) if abs(u[2]) < 0.9 else np.array([1.0, 0.0, 0.0])
    e1 = np.cross(u, ref)
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(u, e1)
    n = len(profile)
    verts = []
    for k in range(seg):
        f = 2 * math.pi * k / seg
        r = math.cos(f) * e1 + math.sin(f) * e2
        for (t, rho) in profile:
            verts.append(tuple(a + u * t + r * rho))
    faces = []
    for k in range(seg):
        k2 = (k + 1) % seg
        for i in range(n - 1):
            faces.append((k * n + i, k * n + i + 1, k2 * n + i + 1, k2 * n + i))
    return verts, faces


def blade_material(name, color, core):
    """Pure emission, the same in both styles: the pale core where the blade faces the camera, its colour at the rim."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    out = nodes.new('ShaderNodeOutputMaterial')
    lw = nodes.new('ShaderNodeLayerWeight')
    lw.inputs['Blend'].default_value = 0.5
    ramp = nodes.new('ShaderNodeValToRGB')
    els = ramp.color_ramp.elements
    els[0].position, els[0].color = 0.0, lin(core)
    els[1].position, els[1].color = 0.3, lin(color)
    links.new(lw.outputs['Facing'], ramp.inputs[0])
    em = nodes.new('ShaderNodeEmission')
    links.new(ramp.outputs['Color'], em.inputs['Color'])
    em.inputs['Strength'].default_value = 1.0
    links.new(em.outputs[0], out.inputs['Surface'])
    return mat


def build_saber(fig, parts, style):
    """fig['saber']: hilt (the pommel end) and tip, LDraw points; color and core of the blade; r the blade radius."""
    s = fig['saber']
    a, b = np.array(s['hilt'], float), np.array(s['tip'], float)
    length = float(np.linalg.norm(b - a))
    u = (b - a) / length
    r = s.get('r', 1.3)
    hl = s.get('hilt_len', 9.0)
    hr = r * 1.35
    hilt = [(0, 0), (0, hr * 1.1), (1.0, hr * 1.1), (1.2, hr), (hl - 1.4, hr), (hl - 1.2, hr * 1.25), (hl, hr * 1.25), (hl, 0)]
    grip = [(2.2, 0), (2.2, hr * 1.06), (hl - 3.0, hr * 1.06), (hl - 3.0, 0)]
    blade = [(hl - 0.2, 0), (hl - 0.2, r)]
    for g in range(15, 91, 15):              # a rounded tip
        blade.append((length - r + r * math.sin(math.radians(g)), r * math.cos(math.radians(g))))
    key = fig['key']
    v, f = revolve(hilt, a, u)
    add_mesh(key + '_saber_hilt', v, f, make_material(key + '_saber_hilt', s.get('metal', '#b9c0c7'), 'metal', style), parts, 'saber')
    v, f = revolve(grip, a, u)
    add_mesh(key + '_saber_grip', v, f, make_material(key + '_saber_grip', '#2b2b2e', 'plastic', style), parts, 'saber')
    v, f = revolve(blade, a, u)
    add_mesh(key + '_saber_blade', v, f, blade_material(key + '_saber_blade', s['color'], s.get('core', '#ffe8e4')), parts, 'saber')


def setup_scene(args, parts, cut_y=16.0):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = args.samples
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.02
    scene.cycles.use_denoising = args.style == 'A' and args.samples >= 24
    if scene.cycles.use_denoising:
        scene.cycles.denoiser = 'OPENIMAGEDENOISE'
    scene.cycles.max_bounces = 6
    scene.render.film_transparent = True
    scene.render.resolution_x = scene.render.resolution_y = args.res
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.color_depth = '8'
    scene.render.image_settings.compression = 100
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.view_settings.exposure = args.exposure
    scene.render.filter_size = 1.2

    world = bpy.data.worlds.new('w')
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.8, 0.82, 0.86, 1) if args.style == 'A' else (0, 0, 0, 1)
    bg.inputs['Strength'].default_value = 0.35 if args.style == 'A' else 0.0

    # framing: everything above the cut line, seen by an orthographic camera
    d = cam_dir()
    fwd = -d
    up_w = Vector((0, 0, 1))
    right = fwd.cross(up_w).normalized()
    up = right.cross(fwd).normalized()
    cut_w = Vector((0, -10 * LDU, -cut_y * LDU))     # front of the torso at LDraw y=cut_y (16: the usual bust)
    pts = []
    for obs in parts.values():
        for ob in obs:
            mw = ob.matrix_world
            for v in ob.data.vertices:
                w = mw @ v.co
                if w.z >= cut_w.z - 2 * LDU:
                    pts.append(w)
    P = np.array([[p.dot(right), p.dot(up)] for p in pts])
    cut_v = cut_w.dot(up)
    top = P[:, 1].max()
    above = P[P[:, 1] >= cut_v]
    xl, xr = above[:, 0].min(), above[:, 0].max()
    h = (top - cut_v) * 1.04
    w = (xr - xl) * 1.10
    size = max(h, w)
    cx = (xl + xr) / 2
    cy = cut_v + size / 2
    cam_data = bpy.data.cameras.new('cam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = size
    cam_data.clip_start = 0.001
    cam_data.clip_end = 10
    cam = bpy.data.objects.new('cam', cam_data)
    scene.collection.objects.link(cam)
    centre = right * cx + up * cy
    cam.location = centre + d * 1.0
    rot = Matrix((right, up, -fwd)).transposed()
    cam.rotation_euler = rot.to_euler()
    scene.camera = cam

    if args.style == 'A':
        tgt = Vector((0, 0, 4 * LDU))

        def area(name, direction, power, size_m, color=(1, 1, 1)):
            ld = bpy.data.lights.new(name, 'AREA')
            ld.energy = power
            ld.size = size_m
            ld.color = color
            ob = bpy.data.objects.new(name, ld)
            scene.collection.objects.link(ob)
            dist = 0.25
            ob.location = tgt + direction.normalized() * dist
            ob.rotation_euler = (-direction).to_track_quat('-Z', 'Y').to_euler()
            return ob
        # key: upper left front of the camera; fill: right; rim: behind, above
        key_dir = (d * 1.0 - right * 0.9 + up * 0.9)
        fill_dir = (d * 1.0 + right * 1.1 + up * 0.1)
        rim_dir = (-d * 1.0 + right * 0.6 + up * 1.2)
        area('key', key_dir, 0.75, 0.16)
        area('fill', fill_dir, 0.28, 0.22, (0.92, 0.95, 1.0))
        area('rim', rim_dir, 0.6, 0.12, (1.0, 0.97, 0.92))
    elif args.lines == 'on':
        scene.render.use_freestyle = True
        scene.render.line_thickness_mode = 'ABSOLUTE'
        vl = scene.view_layers[0]
        vl.use_freestyle = True
        fs = vl.freestyle_settings
        fs.crease_angle = math.radians(128)
        k = args.res / 1024.0
        while len(fs.linesets) < 2:
            fs.linesets.new('ls%d' % len(fs.linesets))
        outer, inner = fs.linesets[0], fs.linesets[1]
        for ls in (outer, inner):
            ls.select_by_visibility = True
            ls.visibility = 'VISIBLE'
            ls.select_by_edge_types = True
            for attr in ('select_silhouette', 'select_border', 'select_crease', 'select_external_contour',
                         'select_material_boundary', 'select_contour', 'select_suggestive_contour',
                         'select_ridge_valley', 'select_edge_mark'):
                setattr(ls, attr, False)
            if ls.linestyle is None:
                ls.linestyle = bpy.data.linestyles.new(ls.name)
            ls.linestyle.color = (0.04, 0.035, 0.035)
            ls.linestyle.caps = 'ROUND'
        outer.select_external_contour = True
        outer.linestyle.thickness = 7.0 * k
        inner.select_silhouette = True
        inner.select_border = True
        inner.select_crease = True
        inner.linestyle.thickness = 3.0 * k


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def render_one(fig, args):
    t0 = time.time()
    clear_scene()
    os.makedirs(args.scratch, exist_ok=True)
    ldr = os.path.join(args.scratch, fig['key'] + '.ldr')
    roles = write_ldr(fig, ldr)
    ld = import_ldr(ldr, args)
    if args.diag:
        for ob in bpy.context.scene.objects:
            line = 'OBJ %s type=%s parent=%s' % (ob.name, ob.type, ob.parent.name if ob.parent else None)
            if ob.type == 'MESH':
                vs = [world_to_ld(ob.matrix_world @ v.co) for v in ob.data.vertices]
                lo = [round(min(v[i] for v in vs), 2) for i in range(3)]
                hi = [round(max(v[i] for v in vs), 2) for i in range(3)]
                line += ' mats=%s ld_lo=%s ld_hi=%s' % ([s.material.name if s.material else None for s in ob.material_slots], lo, hi)
            print(line, flush=True)
        args.diag = False
    global CAM_EL, CAM_AZ
    CAM_EL = math.radians(fig.get('cam_el', 12.0))      # before the materials: the toon highlight uses it
    CAM_AZ = math.radians(0.0 if args.view == 'front' else -30.0)
    face, torso = mf.new_face(), mf.new_torso()
    fig['prints'](face, torso)
    face_imgs = canvas_images(fig['key'] + '_face', face)
    torso_imgs = canvas_images(fig['key'] + '_torso', torso)
    parts = assign_materials(fig, roles, ld, args.style, face_imgs, torso_imgs)
    if fig.get('phones'):
        build_phones(fig, parts, args.style)
    if fig.get('saber'):
        build_saber(fig, parts, args.style)
    setup_scene(args, parts, fig.get('cut_y', 16.0))
    os.makedirs(args.out, exist_ok=True)
    out = os.path.join(args.out, fig['key'] + args.suffix + '.png')
    bpy.context.scene.render.filepath = out
    t1 = time.time()
    bpy.ops.render.render(write_still=True)
    t2 = time.time()
    print('RENDERED %s style=%s res=%d samples=%d setup=%.1fs render=%.1fs -> %s'
          % (fig['key'], args.style, args.res, args.samples, t1 - t0, t2 - t1, out), flush=True)
    return t2 - t0


def main():
    args = parse_args()
    figs = mf.FIGURES
    if args.only:
        want = [k.strip() for k in args.only.split(',') if k.strip()]
        byk = mf.by_key()
        figs = [byk[k] for k in want]
    for style in args.style:
        sa = for_style(args, style)
        total = 0.0
        for fig in figs:
            total += render_one(fig, sa)
            sa.diag = False
        print('DONE %d figures style=%s in %.1fs' % (len(figs), style, total), flush=True)


main()
