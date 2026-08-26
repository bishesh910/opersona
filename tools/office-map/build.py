#!/usr/bin/env python3
"""opersona office floor generator — composes apps/web/src/office/office-map.json
plus office-theme.json (seat/zone/prop coordinates) from known-good LimeZu tile
stamps. Stamps come from two sources:
  - rects mined from original-office.tmj (vendored, ISC — shahar061/the-office)
  - rects addressed directly in the interiors atlas (gid = 1025 + row*16 + col)
Run:  python3 tools/office-map/build.py   → writes map+theme, renders preview.png
"""
import json, os, copy

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'original-office.tmj')
OUT_MAP = os.path.join(HERE, '..', '..', 'apps', 'web', 'src', 'office', 'office-map.json')
OUT_THEME = os.path.join(HERE, '..', '..', 'apps', 'web', 'src', 'office', 'office-theme.json')
ASSETS = os.path.join(HERE, '..', '..', 'apps', 'web', 'public', 'office-assets')

GID_MASK = 0x1FFFFFFF
CHAIR_GIDS = {289, 305}          # bullpen chair (walkable seat)
TS = 16
W, H = 40, 24

src = json.load(open(SRC))
SW = src['width']
SL = {l['name']: l['data'] for l in src['layers'] if 'data' in l}
FURN = ['furniture-below', 'furniture-above']

def stamp_src(x0, y0, w, h, seat=None, layers=None):
    tiles = []
    for layer in (layers or FURN):
        d = SL[layer]
        for dr in range(h):
            for dc in range(w):
                raw = d[(y0 + dr) * SW + (x0 + dc)]
                if raw:
                    tiles.append((layer, dc, dr, raw))
    return {'w': w, 'h': h, 'seat': seat, 'tiles': tiles}

def stamp_atlas(col, row, w, h, layer='furniture-below', seat=None, skip=()):
    """Rect straight out of interiors.png; skip = (dc,dr) cells to leave empty."""
    tiles = []
    for dr in range(h):
        for dc in range(w):
            if (dc, dr) in skip:
                continue
            tiles.append((layer, dc, dr, 1025 + (row + dr) * 16 + (col + dc)))
    return {'w': w, 'h': h, 'seat': seat, 'tiles': tiles}

# ── stamp library ─────────────────────────────────────────────────────────────
EXEC    = stamp_src(3, 5, 3, 4, seat=(1, 0))      # boss desk, faces DOWN
PC      = stamp_src(19, 4, 3, 4, seat=(1, 2))     # workstation, faces UP
CONF    = stamp_src(3, 15, 7, 4)                  # long table + 8 chairs
CAFE_T  = stamp_src(10, 4, 3, 3)                  # small table, chairs N+S
KITCHEN = stamp_src(9, 1, 7, 3)                   # coffee/counter/fridge/shelf
COPIER  = stamp_src(16, 15, 3, 4)
SOFA_B  = stamp_src(20, 17, 2, 3)                 # blue-grey sofa (side)
BOXES   = stamp_src(25, 18, 2, 3)
COOLER  = stamp_src(26, 1, 2, 2)                  # water cooler
TRASH   = stamp_src(7, 1, 1, 2)
CLOCK   = stamp_src(3, 1, 1, 1)
WINDOW  = stamp_src(5, 1, 2, 2)
PAINT   = stamp_src(21, 1, 2, 2)                  # wall painting
PLANT   = stamp_src(13, 9, 1, 2)                  # tall plant

# atlas stamps (0-based atlas col,row; calibrated against /tmp/stamps_check.png)
RUG_RED   = stamp_atlas(7, 16, 3, 3)              # red/gold rug
RUG_BLUE  = stamp_atlas(11, 12, 3, 4)             # blue rug
CURTAIN   = stamp_atlas(3, 25, 2, 2, layer='furniture-above')  # curtained window
TV_STAND  = stamp_atlas(10, 39, 2, 3)             # presentation screen on stand
POT_PLANT = stamp_atlas(10, 43, 2, 3)             # big potted plant
PALM      = stamp_atlas(13, 43, 2, 3)             # palm plant
BOOKCASE  = stamp_atlas(12, 48, 2, 3)             # wooden double-door bookcase
PSOFA     = stamp_atlas(5, 46, 2, 2)              # purple/gold two-seat sofa
PCHAIR    = stamp_atlas(4, 46, 1, 2)              # purple/gold armchair
BOARD_W   = stamp_src(6, 13, 2, 2)                # whiteboard (wall)
BOARD_B   = stamp_src(11, 13, 2, 2)               # blackboard (wall)

# ── layers ────────────────────────────────────────────────────────────────────
def blank(): return [0] * (W * H)
floor, walls, fb, fa, coll = blank(), blank(), blank(), blank(), blank()
def idx(x, y): return y * W + x
def setw(layer, x, y, gid):
    if 0 <= x < W and 0 <= y < H: layer[idx(x, y)] = gid

# floors: warm sandy weave everywhere; tan in the CEO office; cream in meeting
def fill_floor(x0, y0, x1, y1, a, b, c, d):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            setw(floor, x, y, (a if x % 2 == 0 else b) if y % 2 == 0 else (c if x % 2 == 0 else d))
fill_floor(1, 3, W - 2, H - 2, 833, 834, 849, 850)         # main: sandy weave
fill_floor(1, 3, 9, 9, 777, 778, 793, 794)                 # CEO: tan
fill_floor(11, 3, 22, 9, 781, 782, 797, 798)               # meeting: cream/yellow
fill_floor(25, 3, 38, 9, 801, 802, 817, 818)               # cafe: plain tan

# outer shell
TOP_CAP, TOP_FACE, TOP_BASE = 522, 554, 570
for x in range(1, W - 1):
    setw(walls, x, 0, TOP_CAP); setw(walls, x, 1, TOP_FACE); setw(walls, x, 2, TOP_BASE)
setw(walls, 0, 0, 514); setw(walls, W - 1, 0, 517)
for y in range(1, H - 1):
    setw(walls, 0, y, 530); setw(walls, W - 1, y, 533)
for x in range(1, W - 1): setw(walls, x, H - 1, 579)
setw(walls, 0, H - 1, 578); setw(walls, W - 1, H - 1, 581)

def vwall(col, r0, r1, doors=()):
    for r in range(r0, r1 + 1):
        if r in doors: continue
        setw(walls, col, r, 611 if r == r0 else 643)
def hwall(row, c0, c1, doors=()):
    for c in range(c0, c1 + 1):
        if c in doors: continue
        setw(walls, c, row, TOP_CAP); setw(walls, c, row + 1, TOP_FACE); setw(walls, c, row + 2, TOP_BASE)

PLACED_SEATS = []
def place(stamp, gx, gy):
    for (layer, dc, dr, raw) in stamp['tiles']:
        setw(fb if layer == 'furniture-below' else fa, gx + dc, gy + dr, raw)
    if stamp['seat'] is not None:
        s = (gx + stamp['seat'][0], gy + stamp['seat'][1])
        PLACED_SEATS.append(s); return s
    return None

# ══ ROOMS ═════════════════════════════════════════════════════════════════════
# CEO office: cols 1-9, rows 3-9
vwall(10, 3, 12, doors=(6, 7))
hwall(10, 1, 9, doors=(5,))
ceo = place(EXEC, 3, 4)
place(PLANT, 1, 3); place(PALM, 7, 3)
place(WINDOW, 2, 1); place(WINDOW, 5, 1)
place(PAINT, 8, 1)

# Meeting room: cols 11-22, rows 3-9
vwall(23, 3, 12, doors=(6, 7))
hwall(10, 11, 22, doors=(16, 17))
place(CONF, 13, 4)
# consult meetup seats: two ADJACENT top-row conference chairs, so both faces
# stay visible while they talk (they turn toward each other via sprite flip)
meet1 = (15, 4); meet2 = (16, 4)
PLACED_SEATS.extend([meet1, meet2])
place(WINDOW, 13, 1); place(WINDOW, 16, 1); place(WINDOW, 19, 1)
place(TV_STAND, 11, 7)                           # presentation screen, back of the room

# Kitchen / cafe: cols 24-38, rows 3-9 (open plan, top-right)
place(KITCHEN, 25, 1)
place(COOLER, 36, 1)
cafe_a = place(CAFE_T, 26, 5); cafe_b = place(CAFE_T, 30, 5)
place(TRASH, 38, 3)
place(POT_PLANT, 36, 7)

# Bullpen: rows 12-19, desk pods with plants between
pods = []
for i, sc in enumerate([3, 8, 13, 18]):
    pods.append(place(PC, sc, 11))
for i, sc in enumerate([3, 8, 13, 18]):
    pods.append(place(PC, sc, 16))
place(PLANT, 7, 12); place(PLANT, 17, 12); place(PLANT, 12, 17)

# Lounge: bottom-right, cols 24-38 rows 12-22
place(RUG_RED, 28, 15)
place(PSOFA, 28, 13)
place(PCHAIR, 27, 15); place(PCHAIR, 31, 15)
place(PSOFA, 33, 16)
place(BOOKCASE, 35, 12); place(BOOKCASE, 37, 12)
place(POT_PLANT, 24, 12)
place(PALM, 36, 19)
place(WINDOW, 33, 1); place(PAINT, 35, 1)

# bottom-left utility: copier + boxes + shelf
place(COPIER, 1, 19)
place(BOXES, 5, 20)
place(PLANT, 21, 20)

# ══ COLLISION ═════════════════════════════════════════════════════════════════
WALKABLE_FURN = set(CHAIR_GIDS)
for y in range(H):
    for x in range(W):
        solid = bool(walls[idx(x, y)])
        for fl in (fb, fa):
            g = fl[idx(x, y)] & GID_MASK
            if g and g not in WALKABLE_FURN: solid = True
        if solid: setw(coll, x, y, 1)
# rugs are walkable: clear collision where only rug tiles exist
def clear_rect(x0, y0, w0, h0):
    for y in range(y0, y0 + h0):
        for x in range(x0, x0 + w0):
            setw(coll, x, y, 0)
clear_rect(28, 15, 4, 3)     # lounge rug

# entrance: bottom door at col 20
setw(coll, 20, H - 1, 0); setw(walls, 20, H - 1, 0)
setw(coll, 21, H - 1, 0); setw(walls, 21, H - 1, 0)
for (sx, sy) in PLACED_SEATS: setw(coll, sx, sy, 0)

# ── spawns / zones / theme ───────────────────────────────────────────────────
def pt(name, tile):
    return {'id': 0, 'name': name, 'type': '', 'x': tile[0] * TS, 'y': tile[1] * TS,
            'width': 0, 'height': 0, 'rotation': 0, 'visible': True, 'point': True}
SEATS = {'desk-ceo': ceo}
for i, s in enumerate(pods): SEATS[f'pc-{i+1}'] = s
SEATS['cafe-seat-1'] = (cafe_a[0] if cafe_a else 27, 5)
spawn_objs = [pt(n, t) for n, t in SEATS.items() if t]
# cafe chairs: CAFE_T stamp has chairs N (y+0) and S (y+2) of table at (gx+1)
for i, (gx, gy) in enumerate([(26, 5), (30, 5)]):
    spawn_objs.append(pt(f'cafe-seat-{i*2+1}', (gx + 1, gy)))
    spawn_objs.append(pt(f'cafe-seat-{i*2+2}', (gx + 1, gy + 2)))
    setw(coll, gx + 1, gy, 0); setw(coll, gx + 1, gy + 2, 0)
spawn_objs.append(pt('cafe-stand-coffee', (26, 4)))
spawn_objs.append(pt('cafe-stand-vending', (31, 4)))
spawn_objs.append(pt('meet-1', meet1)); spawn_objs.append(pt('meet-2', meet2))
spawn_objs.append(pt('entrance', (20, 22)))
setw(coll, meet1[0], meet1[1], 0); setw(coll, meet2[0], meet2[1], 0)

zones = [
    {'id': 0, 'name': 'boardroom', 'type': '', 'x': 11 * TS, 'y': 3 * TS, 'width': 12 * TS, 'height': 7 * TS, 'rotation': 0, 'visible': True},
    {'id': 0, 'name': 'cafeteria', 'type': '', 'x': 24 * TS, 'y': 3 * TS, 'width': 15 * TS, 'height': 7 * TS, 'rotation': 0, 'visible': True},
]

theme = {
    'primarySeatNames': ['desk-ceo'] + [f'pc-{i+1}' for i in range(len(pods))],
    'cafeSeatNames': ['cafe-seat-1', 'cafe-seat-2', 'cafe-seat-3', 'cafe-seat-4'],
    'cafeStands': [['cafe-stand-coffee', 'coffee'], ['cafe-stand-vending', 'vending']],
    'meetSeats': [{'name': 'meet-1', 'facing': 'down'}, {'name': 'meet-2', 'facing': 'down'}],
    'coffee': {'trayTile': {'x': 26, 'y': 2}, 'trayStand': {'x': 26, 'y': 3},
               'machineStand': {'x': 25, 'y': 3}, 'sinkTile': {'x': 28, 'y': 2}, 'sinkStand': {'x': 28, 'y': 3}},
    'errandSpots': [
        {'kind': 'water', 'stand': {'x': 1, 'y': 5}, 'facing': 'up', 'fx': {'x': 1, 'y': 4}, 'duration': 4.5, 'bossOnly': True},
        {'kind': 'water', 'stand': {'x': 7, 'y': 13}, 'facing': 'up', 'fx': {'x': 7, 'y': 12}, 'duration': 4.5},
        {'kind': 'water', 'stand': {'x': 17, 'y': 13}, 'facing': 'up', 'fx': {'x': 17, 'y': 12}, 'duration': 4.5},
        {'kind': 'water', 'stand': {'x': 24, 'y': 14}, 'facing': 'up', 'fx': {'x': 24, 'y': 13}, 'duration': 4.5},
        {'kind': 'window', 'stand': {'x': 13, 'y': 3}, 'facing': 'up', 'fx': {'x': 13, 'y': 1}, 'duration': 5},
        {'kind': 'dispenser', 'stand': {'x': 36, 'y': 3}, 'facing': 'up', 'fx': {'x': 36, 'y': 2}, 'duration': 3.5},
        {'kind': 'fridge', 'stand': {'x': 30, 'y': 3}, 'facing': 'up', 'fx': {'x': 30, 'y': 2}, 'duration': 3.2},
        {'kind': 'bin', 'stand': {'x': 37, 'y': 4}, 'facing': 'right', 'fx': {'x': 38, 'y': 4}, 'duration': 2.6},
    ],
    'monitor': {'offTopLeftGid': 365, 'onGids': [[367, 0, 0], [368, 1, 0], [383, 0, 1], [384, 1, 1]]},
}

# ── write ────────────────────────────────────────────────────────────────────
def tilelayer(name, data, lid):
    return {'data': data, 'height': H, 'id': lid, 'name': name, 'opacity': 1,
            'type': 'tilelayer', 'visible': True, 'width': W, 'x': 0, 'y': 0}
def objlayer(name, objs, lid):
    return {'draworder': 'topdown', 'id': lid, 'name': name, 'objects': objs,
            'opacity': 1, 'type': 'objectgroup', 'visible': True, 'x': 0, 'y': 0}
out = copy.deepcopy(src)
out['width'] = W; out['height'] = H
out['layers'] = [
    tilelayer('floor', floor, 1), tilelayer('walls', walls, 2),
    tilelayer('furniture-below', fb, 3), tilelayer('furniture-above', fa, 4),
    tilelayer('collision', coll, 5),
    objlayer('spawn-points', spawn_objs, 6), objlayer('zones', zones, 7),
]
out['nextlayerid'] = 8; out['nextobjectid'] = 1
json.dump(out, open(OUT_MAP, 'w'), indent=1)
json.dump(theme, open(OUT_THEME, 'w'), indent=1)
print('wrote map + theme:', W, 'x', H, ',', len(PLACED_SEATS), 'seats')

# ── preview render ───────────────────────────────────────────────────────────
try:
    from PIL import Image
    sheets = [(1, Image.open(os.path.join(ASSETS, 'office-tileset.png')).convert('RGBA')),
              (513, Image.open(os.path.join(ASSETS, 'a5-office-floors-walls.png')).convert('RGBA')),
              (1025, Image.open(os.path.join(ASSETS, 'interiors.png')).convert('RGBA'))]
    im = Image.new('RGBA', (W * 16, H * 16), (25, 26, 32, 255))
    for data in (floor, walls, fb, fa):
        for i, raw in enumerate(data):
            if not raw: continue
            gid = raw & GID_MASK
            fg, sh = next((fg, sh) for fg, sh in reversed(sheets) if gid >= fg)
            loc = gid - fg
            t = sh.crop(((loc % 16) * 16, (loc // 16) * 16, (loc % 16) * 16 + 16, (loc // 16) * 16 + 16))
            if raw & 0x80000000: t = t.transpose(Image.FLIP_LEFT_RIGHT)
            if raw & 0x40000000: t = t.transpose(Image.FLIP_TOP_BOTTOM)
            im.alpha_composite(t, ((i % W) * 16, (i // W) * 16))
    im.resize((im.width * 2, im.height * 2), Image.NEAREST).save('/tmp/office_preview.png')
    print('preview: /tmp/office_preview.png')
except Exception as e:
    print('preview skipped:', e)
