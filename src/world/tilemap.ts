// Tile grid parsed from an ASCII map in /data/regions. Handles collision and line of sight.
import type { RegionDef, TileDef } from "../data/types.js";
import type { Vec } from "../core/math.js";

export class TileMap {
  readonly w: number;
  readonly h: number;
  readonly ts: number;
  private tiles: string[];

  constructor(region: RegionDef, private defs: Record<string, TileDef>) {
    this.ts = region.tileSize;
    this.h = region.map.length;
    this.w = Math.max(...region.map.map((r) => r.length));
    this.tiles = new Array(this.w * this.h);
    const fallback = region.legend["#"] ?? Object.values(region.legend)[0];
    for (let y = 0; y < this.h; y++) {
      const row = region.map[y];
      for (let x = 0; x < this.w; x++) {
        const ch = row[x] ?? "#";
        const id = region.legend[ch] ?? fallback;
        if (!defs[id]) throw new Error(`Region ${region.id}: tile "${id}" (char '${ch}') has no definition`);
        this.tiles[y * this.w + x] = id;
      }
    }
  }

  get(cx: number, cy: number): string {
    if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) return "void";
    return this.tiles[cy * this.w + cx];
  }
  def(cx: number, cy: number): TileDef | undefined {
    return this.defs[this.get(cx, cy)];
  }
  set(cx: number, cy: number, id: string): void {
    if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) return;
    this.tiles[cy * this.w + cx] = id;
  }
  /** Lets systems make solid tiles passable (e.g. frozen deep water). */
  walkable?: (cx: number, cy: number) => boolean;

  solid(cx: number, cy: number): boolean {
    const d = this.def(cx, cy);
    if (!d) return true;
    return !!d.solid && !this.walkable?.(cx, cy);
  }
  blocksProjectiles(cx: number, cy: number): boolean {
    const d = this.def(cx, cy);
    return !d || (d.blocksProjectiles ?? !!d.solid);
  }
  cellAt(p: Vec): [number, number] {
    return [Math.floor(p.x / this.ts), Math.floor(p.y / this.ts)];
  }

  /**
   * Moves a circle by (dx, dy), sliding along solid tiles. Axis-separated, which
   * is robust and cheap for tile worlds. `extraSolid` lets AI treat hazards as walls.
   */
  move(p: Vec, r: number, dx: number, dy: number, extraSolid?: (cx: number, cy: number) => boolean): void {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / (this.ts * 0.4)));
    const sx = dx / steps;
    const sy = dy / steps;
    for (let i = 0; i < steps; i++) {
      p.x += sx;
      if (this.overlaps(p, r, extraSolid)) p.x -= sx;
      p.y += sy;
      if (this.overlaps(p, r, extraSolid)) p.y -= sy;
    }
  }

  overlaps(p: Vec, r: number, extraSolid?: (cx: number, cy: number) => boolean): boolean {
    const ts = this.ts;
    const x0 = Math.floor((p.x - r) / ts);
    const x1 = Math.floor((p.x + r) / ts);
    const y0 = Math.floor((p.y - r) / ts);
    const y1 = Math.floor((p.y + r) / ts);
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++) {
        if (!this.solid(cx, cy) && !extraSolid?.(cx, cy)) continue;
        const nx = Math.max(cx * ts, Math.min(p.x, cx * ts + ts));
        const ny = Math.max(cy * ts, Math.min(p.y, cy * ts + ts));
        if ((p.x - nx) ** 2 + (p.y - ny) ** 2 < r * r) return true;
      }
    return false;
  }

  /** Line of sight test, sampling every quarter tile. */
  lineClear(a: Vec, b: Vec): boolean {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.ceil(d / (this.ts / 4));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const cx = Math.floor((a.x + (b.x - a.x) * t) / this.ts);
      const cy = Math.floor((a.y + (b.y - a.y) * t) / this.ts);
      if (this.blocksProjectiles(cx, cy)) return false;
    }
    return true;
  }
}
