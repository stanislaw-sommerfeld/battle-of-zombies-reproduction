"""One-off generator for the Cinder Vale ASCII map.

The JSON it writes (data/regions/cinder_vale.json, "map" field) is the source of
truth afterwards: edit the ASCII directly. Re-running this script overwrites the
map rows but keeps zones/spawns/legend from the existing file.

    python3 scripts/gen-cinder-vale.py
"""
import json
import math
import random
from pathlib import Path

W, H = 80, 60
rng = random.Random(1337)
g = [["." for _ in range(W)] for _ in range(H)]


def rect(x, y, w, h, c):
    for yy in range(y, y + h):
        for xx in range(x, x + w):
            if 0 <= xx < W and 0 <= yy < H:
                g[yy][xx] = c


def outline(x, y, w, h, c):
    for xx in range(x, x + w):
        g[y][xx] = c
        g[y + h - 1][xx] = c
    for yy in range(y, y + h):
        g[yy][x] = c
        g[yy][x + w - 1] = c


def disc(cx, cy, r, c, only=None):
    for yy in range(int(cy - r - 1), int(cy + r + 2)):
        for xx in range(int(cx - r - 1), int(cx + r + 2)):
            if 0 <= xx < W and 0 <= yy < H and (xx - cx) ** 2 + (yy - cy) ** 2 <= r * r:
                if only is None or g[yy][xx] in only:
                    g[yy][xx] = c


def scatter(x, y, w, h, c, p, only):
    for yy in range(y, y + h):
        for xx in range(x, x + w):
            if g[yy][xx] in only and rng.random() < p:
                g[yy][xx] = c


# ---- base terrain
scatter(2, 2, W - 4, H - 4, ",", 0.18, ".")

# ---- borders / cliffs
rect(0, 0, W, 2, "#")
rect(0, H - 2, W, 2, "#")
rect(0, 0, 2, H, "#")
rect(W - 2, 0, 2, H, "#")
rect(2, 2, 26, 16, "#")      # north-west highlands
rect(53, 2, 25, 13, "#")     # north-east cliffs behind the Scriptorium

# ---- ridges separating the regions
rect(24, 18, 2, 40, "#")     # west ridge (The Hush)
for y in (37, 38, 39):
    g[y][24] = g[y][25] = "="  # road gap
g[54][24] = g[54][25] = "_"   # hidden crawlspace
rect(54, 15, 2, 43, "#")     # east ridge (Orchard)
for y in (29, 30, 31):
    g[y][54] = g[y][55] = "="
for y in (48, 49):
    g[y][54] = g[y][55] = ","

# ---- Lanternfast (hub)
rect(28, 2, 25, 1, "#")
outline(29, 3, 23, 15, "H")
rect(30, 4, 21, 13, "+")
for x in (39, 40, 41):
    g[17][x] = "="
rect(40, 4, 1, 14, "=")
rect(30, 10, 21, 1, "=")
rect(31, 5, 5, 3, "H")       # houses
rect(45, 5, 5, 3, "H")
rect(31, 13, 4, 3, "H")
rect(46, 13, 4, 2, "H")

# ---- roads
rect(40, 18, 1, 29, "=")
rect(39, 18, 3, 2, "=")
rect(41, 30, 13, 1, "=")
rect(26, 38, 14, 1, "=")

# ---- Ash Crater (start)
disc(40, 50, 5.5, "x", only=",.=#")
for a in range(0, 360, 14):
    x = int(round(40 + math.cos(math.radians(a)) * 6.6))
    y = int(round(50 + math.sin(math.radians(a)) * 6.0))
    if rng.random() < 0.55 and not (38 <= x <= 42 and y < 50):
        g[y][x] = "r"
rect(40, 44, 1, 3, "=")

# first encounter teaching patch: dry grass by the road
rect(36, 39, 4, 4, ",")
rect(42, 35, 3, 3, ",")

# ---- The Hush (west)
rect(2, 18, 22, 40, "_")
scatter(2, 18, 22, 40, ",", 0.08, "_")
for _ in range(46):
    x, y = rng.randint(3, 22), rng.randint(20, 56)
    if g[y][x] in "_," and not (5 <= x <= 17 and 25 <= y <= 35):
        g[y][x] = "g"
rect(26, 38, 1, 1, "=")
rect(14, 38, 10, 1, "=")      # path into the Hush
outline(6, 26, 11, 9, "#")    # chapel
rect(7, 27, 9, 7, "+")
g[34][11] = "+"               # chapel door
g[34][10] = "+"
g[26][9] = "_"                # roof collapse
g[29][6] = "_"
g[31][16] = "#"

# ---- Drowned Orchard (east)
rect(56, 15, 22, 43, "m")
scatter(56, 15, 22, 43, ",", 0.25, "m")
# scriptorium facade (north edge of orchard)
rect(56, 14, 22, 1, "#")
# orchard rows of dead trees
for y in range(18, 57, 4):
    for x in range(58, 77, 4):
        xx, yy = x + rng.randint(-1, 1), y + rng.randint(-1, 0)
        if (xx - 66) ** 2 + (yy - 40) ** 2 > 49 and 56 <= xx < 78:
            g[yy][xx] = "T"
# the spring
disc(66, 40, 5.6, "w")
disc(66, 40, 3.3, "~")
g[40][66] = "."               # the drowned island
# ink around the spring
for yy in range(33, 48):
    for xx in range(59, 74):
        d = math.hypot(xx - 66, yy - 40)
        if 3.0 <= d <= 6.2 and g[yy][xx] in "wm," and rng.random() < 0.8:
            g[yy][xx] = "i"
# channel toward Lanternfast's well (west)
for i, (x, y) in enumerate([(60, 38), (59, 37), (58, 36), (58, 35), (57, 34), (57, 33), (56, 32), (56, 31)]):
    g[y][x] = "w"
# oil seep near the overturned cart
disc(61, 24, 2.2, "o", only="m,")
disc(64, 22, 1.3, "o", only="m,")
# the old cider-house (secret)
outline(70, 20, 7, 7, "#")
rect(71, 21, 5, 5, "+")
g[23][70] = "C"

# corridor to the ridge gap
rect(56, 29, 3, 3, "=")

rows = ["".join(r) for r in g]
path = Path(__file__).resolve().parent.parent / "data" / "regions" / "cinder_vale.json"
data = json.loads(path.read_text()) if path.exists() else {}
data["map"] = rows
path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
print("\n".join(rows))
