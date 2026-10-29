// Surface simulation: a cell grid of liquids, fire and steam.
// A handful of rules here produce most of the game's emergent situations
// (burning oil fields, steam cover, frozen ponds, purified ink).
import type { Element, LiquidId } from "../data/types.js";
import type { Rng } from "../core/math.js";

export enum Liquid {
  None = 0,
  Oil = 1,
  Water = 2,
  Ink = 3,
  Ice = 4,
}

export const LIQUID_BY_NAME: Record<LiquidId | "ice", Liquid> = { oil: Liquid.Oil, water: Liquid.Water, ink: Liquid.Ink, ice: Liquid.Ice };

export type Reaction =
  | "ignite_oil"
  | "ink_burn"
  | "ink_purified"
  | "steam"
  | "melt"
  | "grass_fire"
  | "flame"
  | "freeze_water"
  | "extinguish"
  | "fire_spread";

export type ReactionListener = (r: Reaction, cx: number, cy: number) => void;

export class SurfaceGrid {
  readonly liquid: Uint8Array;
  readonly fire: Float32Array; // seconds of burning left
  readonly steam: Float32Array; // seconds of steam left
  readonly flammable: Uint8Array; // 1 = dry grass that can burn once
  readonly age: Float32Array; // time since the liquid appeared (ice melts)
  private active = new Set<number>(); // cells with fire/steam/ice
  listeners: ReactionListener[] = [];
  /** Per-cell fire spread multiplier (edicts). */
  spreadAt: (cx: number, cy: number) => number = () => 1;

  constructor(readonly w: number, readonly h: number, private rng: Rng) {
    const n = w * h;
    this.liquid = new Uint8Array(n);
    this.fire = new Float32Array(n);
    this.steam = new Float32Array(n);
    this.flammable = new Uint8Array(n);
    this.age = new Float32Array(n);
  }

  inBounds(cx: number, cy: number): boolean {
    return cx >= 0 && cy >= 0 && cx < this.w && cy < this.h;
  }
  idx(cx: number, cy: number): number {
    return cy * this.w + cx;
  }
  getLiquid(cx: number, cy: number): Liquid {
    return this.inBounds(cx, cy) ? this.liquid[this.idx(cx, cy)] : Liquid.None;
  }
  isBurning(cx: number, cy: number): boolean {
    return this.inBounds(cx, cy) && this.fire[this.idx(cx, cy)] > 0;
  }
  hasSteam(cx: number, cy: number): boolean {
    return this.inBounds(cx, cy) && this.steam[this.idx(cx, cy)] > 0;
  }

  setLiquid(cx: number, cy: number, l: Liquid): void {
    if (!this.inBounds(cx, cy)) return;
    const i = this.idx(cx, cy);
    this.liquid[i] = l;
    this.age[i] = 0;
    if (l === Liquid.Water || l === Liquid.Ice) {
      if (this.fire[i] > 0) {
        this.fire[i] = 0;
        this.addSteam(cx, cy, 3);
        this.emit("extinguish", cx, cy);
      }
    }
    if (l === Liquid.Ice) this.active.add(i);
  }

  /** Spill a roughly circular puddle. */
  splash(cx: number, cy: number, radius: number, l: Liquid): void {
    const r = Math.ceil(radius);
    for (let y = -r; y <= r; y++)
      for (let x = -r; x <= r; x++) {
        if (x * x + y * y > radius * radius + 0.5) continue;
        if (!this.inBounds(cx + x, cy + y)) continue;
        // don't overwrite deep features with other liquids, but oil floats on water
        this.setLiquid(cx + x, cy + y, l);
      }
  }

  /** Apply an element to one cell; returns the reaction that happened, if any. */
  applyElement(cx: number, cy: number, el: Element): Reaction | undefined {
    if (!this.inBounds(cx, cy)) return;
    if (el === "fire") return this.ignite(cx, cy);
    if (el === "frost") return this.chill(cx, cy);
    return;
  }

  applyElementArea(cx: number, cy: number, radius: number, el: Element): Reaction[] {
    const out: Reaction[] = [];
    const r = Math.ceil(radius);
    for (let y = -r; y <= r; y++)
      for (let x = -r; x <= r; x++) {
        if (x * x + y * y > radius * radius + 0.5) continue;
        const re = this.applyElement(cx + x, cy + y, el);
        if (re) out.push(re);
      }
    return out;
  }

  ignite(cx: number, cy: number, fromSpread = false): Reaction | undefined {
    if (!this.inBounds(cx, cy)) return;
    const i = this.idx(cx, cy);
    if (this.fire[i] > 0) return;
    const l = this.liquid[i];
    let r: Reaction | undefined;
    if (l === Liquid.Oil) {
      this.fire[i] = 5 + this.rng.range(0, 2);
      r = "ignite_oil";
    } else if (l === Liquid.Ink) {
      this.fire[i] = 2.5;
      r = "ink_burn";
    } else if (l === Liquid.Water) {
      this.addSteam(cx, cy, 4);
      r = "steam";
    } else if (l === Liquid.Ice) {
      this.liquid[i] = Liquid.Water;
      this.addSteam(cx, cy, 2);
      r = "melt";
    } else if (this.flammable[i]) {
      this.fire[i] = 2.2 + this.rng.range(0, 1);
      r = "grass_fire";
    } else if (!fromSpread) {
      this.fire[i] = 0.5;
      r = "flame";
    }
    if (this.fire[i] > 0) this.active.add(i);
    if (r) this.emit(fromSpread ? (r === "flame" ? r : "fire_spread") : r, cx, cy);
    return r;
  }

  chill(cx: number, cy: number): Reaction | undefined {
    const i = this.idx(cx, cy);
    if (this.fire[i] > 0) {
      this.fire[i] = 0;
      this.emit("extinguish", cx, cy);
      return "extinguish";
    }
    if (this.steam[i] > 0) this.steam[i] = 0;
    if (this.liquid[i] === Liquid.Water) {
      this.liquid[i] = Liquid.Ice;
      this.age[i] = 0;
      this.active.add(i);
      this.emit("freeze_water", cx, cy);
      return "freeze_water";
    }
    return;
  }

  addSteam(cx: number, cy: number, t: number): void {
    for (let y = -1; y <= 1; y++)
      for (let x = -1; x <= 1; x++) {
        if (!this.inBounds(cx + x, cy + y)) continue;
        const i = this.idx(cx + x, cy + y);
        this.steam[i] = Math.max(this.steam[i], t * (x || y ? 0.7 : 1));
        this.active.add(i);
      }
  }

  update(dt: number): void {
    const spreadCandidates: number[] = [];
    for (const i of [...this.active]) {
      let alive = false;
      if (this.fire[i] > 0) {
        this.fire[i] -= dt;
        alive = true;
        if (this.fire[i] <= 0) {
          this.fire[i] = 0;
          this.burnOut(i);
        } else {
          spreadCandidates.push(i);
        }
      }
      if (this.steam[i] > 0) {
        this.steam[i] = Math.max(0, this.steam[i] - dt);
        alive = alive || this.steam[i] > 0;
      }
      if (this.liquid[i] === Liquid.Ice) {
        this.age[i] += dt;
        if (this.age[i] > 25) this.liquid[i] = Liquid.Water;
        else alive = true;
      }
      if (!alive && this.fire[i] <= 0) this.active.delete(i);
    }
    // fire spreads to flammable neighbours
    for (const i of spreadCandidates) {
      const cx = i % this.w;
      const cy = (i / this.w) | 0;
      const mult = this.spreadAt(cx, cy);
      const p = 2.2 * dt * mult;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!this.inBounds(nx, ny)) continue;
        const j = this.idx(nx, ny);
        if (this.fire[j] > 0) continue;
        const l = this.liquid[j];
        const fuel = l === Liquid.Oil || l === Liquid.Ink || (l === Liquid.None && this.flammable[j]);
        if (fuel && this.rng.chance(p)) this.ignite(nx, ny, true);
      }
    }
  }

  private burnOut(i: number): void {
    const cx = i % this.w;
    const cy = (i / this.w) | 0;
    const l = this.liquid[i];
    if (l === Liquid.Oil) this.liquid[i] = Liquid.None;
    else if (l === Liquid.Ink) {
      this.liquid[i] = Liquid.None;
      this.emit("ink_purified", cx, cy);
    }
    this.flammable[i] = 0;
  }

  activeCells(): Iterable<number> {
    return this.active;
  }

  private emit(r: Reaction, cx: number, cy: number): void {
    for (const l of this.listeners) l(r, cx, cy);
  }
}

const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;
