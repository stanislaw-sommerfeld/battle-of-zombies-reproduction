// Flow field toward the player: a breadth-first distance map over walkable
// tiles, rebuilt only when the player changes tile. Any creature chasing the
// player without line of sight steps to the neighbouring cell with the lowest
// distance, so packs flow around walls and through gaps instead of sticking.
import type { Vec } from "../core/math.js";
import type { TileMap } from "../world/tilemap.js";

const RADIUS = 26; // tiles
const UNREACHED = 0x7fff;
const DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
] as const;

export class PathField {
  private dist: Int16Array;
  private queue: Int32Array;
  private ox = -1;
  private oy = -1;

  constructor(private map: TileMap) {
    this.dist = new Int16Array(map.w * map.h).fill(UNREACHED);
    this.queue = new Int32Array(map.w * map.h);
  }

  /** Rebuilds when the target moved to a new tile (or `force`). */
  update(target: Vec, force = false): void {
    const [tx, ty] = this.map.cellAt(target);
    if (!force && tx === this.ox && ty === this.oy) return;
    this.ox = tx;
    this.oy = ty;
    const { w, h } = this.map;
    this.dist.fill(UNREACHED);
    if (tx < 0 || ty < 0 || tx >= w || ty >= h) return;
    let head = 0;
    let tail = 0;
    this.dist[ty * w + tx] = 0;
    this.queue[tail++] = ty * w + tx;
    while (head < tail) {
      const i = this.queue[head++];
      const cx = i % w;
      const cy = (i / w) | 0;
      const d = this.dist[i];
      if (d >= RADIUS) continue;
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (this.dist[j] !== UNREACHED || this.map.solid(nx, ny)) continue;
        // no corner cutting through walls
        if (dx && dy && (this.map.solid(cx + dx, cy) || this.map.solid(cx, cy + dy))) continue;
        this.dist[j] = d + 1;
        this.queue[tail++] = j;
      }
    }
  }

  distanceAt(cx: number, cy: number): number {
    if (cx < 0 || cy < 0 || cx >= this.map.w || cy >= this.map.h) return UNREACHED;
    return this.dist[cy * this.map.w + cx];
  }

  /** Centre of the best neighbouring cell to move toward, or undefined if unreachable. */
  nextStep(from: Vec): Vec | undefined {
    const [cx, cy] = this.map.cellAt(from);
    let best = this.distanceAt(cx, cy);
    let bx = -1;
    let by = -1;
    for (const [dx, dy] of DIRS) {
      const d = this.distanceAt(cx + dx, cy + dy);
      if (d < best) {
        if (dx && dy && (this.map.solid(cx + dx, cy) || this.map.solid(cx, cy + dy))) continue;
        best = d;
        bx = cx + dx;
        by = cy + dy;
      }
    }
    if (bx < 0) return undefined;
    const ts = this.map.ts;
    return { x: (bx + 0.5) * ts, y: (by + 0.5) * ts };
  }
}
