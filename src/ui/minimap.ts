// Minimap with fog of war. Explored cells are tracked in Game.explored and
// saved, so the map remembers where you have been.
import type { Game } from "../game.js";
import { Liquid } from "../world/surfaces.js";

const PX = 2; // pixels per tile

export class Minimap {
  private ctx: CanvasRenderingContext2D;
  private base?: HTMLCanvasElement;
  private t = 0;
  private dirtyKey = "";

  constructor(private canvas: HTMLCanvasElement, private g: Game) {
    this.ctx = canvas.getContext("2d")!;
  }

  private color(cx: number, cy: number): string {
    const g = this.g;
    const d = g.map.def(cx, cy);
    if (!d) return "#000";
    const l = g.surfaces.getLiquid(cx, cy);
    if (l === Liquid.Ink) return "#4a2a66";
    if (l === Liquid.Ice) return "#a9d8ea";
    if (l === Liquid.Water) return d.solid ? "#1d3a52" : "#2f5f7e";
    if (l === Liquid.Oil) return "#4a3e22";
    if (d.decor === "tree" || d.decor === "graves") return "#3a3a34";
    if (d.solid) return "#151417";
    if (d.id === "road") return "#8a8070";
    if (d.id === "planks") return "#6a5236";
    return "#4a453d";
  }

  update(dt: number): void {
    const g = this.g;
    if (!g.map || !g.explored) return;
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.25;
    const w = g.map.w;
    const h = g.map.h;
    if (this.canvas.width !== w * PX) {
      this.canvas.width = w * PX;
      this.canvas.height = h * PX;
    }
    // the static layer only changes when exploration or terrain changes
    const key = `${g.exploredCount}:${g.world.brokenTiles.length}:${Math.floor(g.time / 3)}`;
    if (key !== this.dirtyKey || !this.base) {
      this.dirtyKey = key;
      const b = (this.base ??= document.createElement("canvas"));
      b.width = w * PX;
      b.height = h * PX;
      const x = b.getContext("2d")!;
      x.fillStyle = "#050507";
      x.fillRect(0, 0, b.width, b.height);
      for (let cy = 0; cy < h; cy++)
        for (let cx = 0; cx < w; cx++) {
          if (!g.explored[cy * w + cx]) continue;
          x.fillStyle = this.color(cx, cy);
          x.fillRect(cx * PX, cy * PX, PX, PX);
        }
    }
    const c = this.ctx;
    c.drawImage(this.base, 0, 0);
    const seen = (px: number, py: number) => {
      const [cx, cy] = g.map.cellAt({ x: px, y: py });
      return !!g.explored[cy * w + cx];
    };
    const dot = (px: number, py: number, color: string, r = 2) => {
      c.fillStyle = color;
      c.fillRect(Math.round((px / g.map.ts) * PX - r / 2), Math.round((py / g.map.ts) * PX - r / 2), r, r);
    };
    for (const pr of g.props) {
      if (!seen(pr.pos.x, pr.pos.y)) continue;
      if (pr.def.shape === "waystone") dot(pr.pos.x, pr.pos.y, "#ffcf7a", 4);
      else if (pr.def.shape === "page" || pr.def.shape === "lectern") dot(pr.pos.x, pr.pos.y, "#efe4c8", 3);
      else if (pr.def.shape === "door" || pr.def.shape === "edict_stone") dot(pr.pos.x, pr.pos.y, "#b48cff", 3);
    }
    for (const n of g.npcs) if (seen(n.pos.x, n.pos.y)) dot(n.pos.x, n.pos.y, "#7fd17a", 4);
    for (const e of g.enemies) if (e.boss && e.awareOfPlayer) dot(e.pos.x, e.pos.y, "#ff5a4a", 4);
    const p = g.player.pos;
    dot(p.x, p.y, "#ffffff", 4);
  }
}
