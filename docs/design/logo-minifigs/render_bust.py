"""Render Brick Tracker minifigure busts (LT.LOGO.MINIFIGS) in Blender 4.5, headless.

Every figure is an original character (see minifigs.py). The parts come from
the LDraw parts library through the ImportLDraw add-on; the face and torso
prints are drawn by minifigs.py and mapped onto the head (cylindrical UVs) and
the torso front (planar UVs) by this script.

  blender.exe -b --factory-startup --python render_bust.py -- --style A|B
      [--only key,key] [--out DIR] [--res 1024] [--samples N] [--exposure 0]
      [--addon DIR] [--library DIR] [--scratch DIR]

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
    a = ap.parse_args(argv)
    a.base_out = a.out or os.path.join(HERE, 'renders')
    a.base_samples = a.samples
    return a


def for_style(a, style):
    """The arguments for one style: its own output folder and sample count."""
    b = argparse.Namespace(**vars(a))
    b.style = style
    b.out = os.path.join(a.base_out, style)
    b.samples = a.base_samples or (80 if style == 'A' else 16)
    return b


# ---------------------------------------------------------------------------
# LDraw model of one bust

LDU = 0.0004                 # ImportLDraw's globalScaleFactor (metres per LDU)
TORSO_CODE, ARM_CODE, HEAD_CODE = 92, 100, 110
ROLE_CODES = [112, 115, 118, 120, 125, 85]
NECK_PARTS = {'6132.dat', '60749.dat'}      # beards sit on the torso's neck, not on the head
HEAD_Y = -24.0


def write_ldr(fig, path):
    roles = {}
    lines = ['0 %s' % fig['name'], '0 Name: %s' % os.path.basename(path), '0 Author: Brick Tracker logo script']
    lines.append('1 %d 0 0 0 1 0 0 0 1 0 0 0 1 %s' % (TORSO_CODE, mf.TORSO))
    lines.append('1 %d 15.552 9 0 0.9962 0.0872 0 -0.0872 0.9962 0 0 0 1 3819.dat' % ARM_CODE)
    lines.append('1 %d -15.552 9 0 0.9962 -0.0872 0 0.0872 0.9962 0 0 0 1 3818.dat' % ARM_CODE)
    lines.append('1 %d 0 %g 0 1 0 0 0 1 0 0 0 1 %s' % (HEAD_CODE, HEAD_Y, mf.HEAD))
    for i, (part, role) in enumerate(fig['headgear']):
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
        if kind == 'glow':
            links.new(col, bsdf.inputs['Emission Color'])
            bsdf.inputs['Emission Strength'].default_value = 0.9
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
    if kind == 'glow' or glow is not None:
        em2 = nodes.new('ShaderNodeEmission')
        if kind == 'glow':
            links.new(col, em2.inputs['Color'])
            em2.inputs['Strength'].default_value = 0.25
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
# Scene: camera, lights, render settings

def setup_scene(args, parts):
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
    cut_w = Vector((0, -10 * LDU, -16 * LDU))        # front of the torso at LDraw y=16
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
    else:
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
    face, torso = mf.new_face(), mf.new_torso()
    fig['prints'](face, torso)
    face_imgs = canvas_images(fig['key'] + '_face', face)
    torso_imgs = canvas_images(fig['key'] + '_torso', torso)
    parts = assign_materials(fig, roles, ld, args.style, face_imgs, torso_imgs)
    setup_scene(args, parts)
    os.makedirs(args.out, exist_ok=True)
    out = os.path.join(args.out, fig['key'] + '.png')
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
