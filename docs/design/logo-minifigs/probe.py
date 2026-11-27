"""Geometry probe for the Brick Tracker minifig logos (LT.LOGO.MINIFIGS).

Imports one standard minifig bust (torso 973, arms 3819/3818, head 3626c,
cap 3833) through ImportLDraw and prints, per object, its name, parent,
vertex count, materials and world bounds, plus the head's radius per local
height band and the torso's x/y extents per local z. render_bust.py uses
these numbers for the print mapping and the camera framing.

Run headless through the heavy lane:
  blender.exe -b --factory-startup --python probe.py -- <ImportLDraw dir> <ldraw library dir> <scratch dir>
"""
import sys, os, bpy, math
from mathutils import Vector
argv = sys.argv[sys.argv.index("--") + 1:]
addon, library, outdir = argv
sys.path.insert(0, addon)
from loadldraw import loadldraw

class Ctx:
    def __init__(s, c): s._c = c
    def report(s, *a): pass
    def __getattr__(s, n): return getattr(s._c, n)

os.makedirs(outdir, exist_ok=True)
ldr = os.path.join(outdir, "probe.ldr")
with open(ldr, "w") as f:
    f.write("0 probe\n0 Name: probe.ldr\n")
    f.write("1 4 0 0 0 1 0 0 0 1 0 0 0 1 973.dat\n")
    f.write("1 1 15.552 9 0 0.9962 0.0872 0 -0.0872 0.9962 0 0 0 1 3819.dat\n")
    f.write("1 2 -15.552 9 0 0.9962 -0.0872 0 0.0872 0.9962 0 0 0 1 3818.dat\n")
    f.write("1 14 0 -24 0 1 0 0 0 1 0 0 0 1 3626c.dat\n")
    f.write("1 0 0 -24 0 1 0 0 0 1 0 0 0 1 3833.dat\n")

bpy.ops.wm.read_factory_settings(use_empty=True)
o = loadldraw.Options
o.ldrawDirectory = library
o.positionObjectOnGroundAtOrigin = False
o.positionCamera = False
o.addGroundPlane = False
o.addWorldEnvironmentTexture = False
o.setRenderSettings = False
o.importCameras = False
o.verbose = 0
o.studLogoDirectory = os.path.join(addon, "studs")
o.useLogoStuds = False
o.resolution = "High"
loadldraw.loadFromFile(Ctx(bpy.context), ldr, True)

for ob in bpy.context.scene.objects:
    mats = [m.name for m in ob.data.materials] if ob.type == "MESH" else []
    line = "OBJ %s type=%s parent=%s" % (ob.name, ob.type, ob.parent.name if ob.parent else None)
    if ob.type == "MESH":
        vs = [ob.matrix_world @ v.co for v in ob.data.vertices]
        lo = [min(v[i] for v in vs) for i in range(3)]
        hi = [max(v[i] for v in vs) for i in range(3)]
        line += " verts=%d mats=%s lo=%s hi=%s" % (len(vs), mats, [round(x, 3) for x in lo], [round(x, 3) for x in hi])
        line += " loc=%s rot=%s scale=%s" % (tuple(round(x, 3) for x in ob.matrix_world.translation), tuple(round(x, 3) for x in ob.matrix_world.to_euler()), tuple(round(x, 3) for x in ob.matrix_world.to_scale()))
        if "3626" in ob.name:
            # radius per local height band
            loc = [v.co for v in ob.data.vertices]
            print("HEAD local lo", [round(min(v[i] for v in loc), 3) for i in range(3)], "hi", [round(max(v[i] for v in loc), 3) for i in range(3)])
            bands = {}
            for v in loc:
                key = round(v.z, 2)
                r = math.hypot(v.x, v.y)
                bands.setdefault(key, []).append(r)
            for k in sorted(bands):
                print("HEAD band z=%.3f n=%d rmax=%.3f" % (k, len(bands[k]), max(bands[k])))
        if "973" in ob.name:
            loc = [v.co for v in ob.data.vertices]
            print("TORSO local lo", [round(min(v[i] for v in loc), 3) for i in range(3)], "hi", [round(max(v[i] for v in loc), 3) for i in range(3)])
            for zz in sorted(set(round(v.z, 2) for v in loc))[:40]:
                pts = [v for v in loc if abs(v.z - zz) < 0.006]
                print("TORSO z=%.3f x=%.3f..%.3f y=%.3f..%.3f" % (zz, min(p.x for p in pts), max(p.x for p in pts), min(p.y for p in pts), max(p.y for p in pts)))
    print(line)
for m in bpy.data.materials:
    print("MAT", m.name, [n.type for n in m.node_tree.nodes] if m.use_nodes else None)
