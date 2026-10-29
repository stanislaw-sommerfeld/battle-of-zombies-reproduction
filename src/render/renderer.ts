// Canvas renderer: cached procedural ground, surfaces, y-sorted entities,
// readable telegraphs, then a darkness/light pass and atmospheric particles.
import { clamp, hash2, lerp, type Vec } from "../core/math.js";
import type { Enemy, Npc, Prop, Player } from "../entities/entities.js";
import type { Game } from "../game.js";
import { RARITY_COLOR } from "../game.js";
import { resolveItem } from "../items/inventory.js";
import { Liquid } from "../world/surfaces.js";
import { weaponStats } from "../entities/player.js";

interface Ambient {
  x: number;
  y: number;
  vx: number;
  vy: number;
  s: number;
  a: number;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private ground?: HTMLCanvasElement;
  private dark: HTMLCanvasElement;
  private dctx: CanvasRenderingContext2D;
  private glow: HTMLCanvasElement;
  private gctx: CanvasRenderingContext2D;
  cam: Vec = { x: 0, y: 0 };
  scale = 2;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private ash: Ambient[] = [];
  private fog: Ambient[] = [];
  private darkness = 0.5;
  private ambient = [10, 12, 18];
  private t = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    this.dark = document.createElement("canvas");
    this.dctx = this.dark.getContext("2d")!;
    this.glow = document.createElement("canvas");
    this.gctx = this.glow.getContext("2d")!;
    this.resize();
    window.addEventListener("resize", () => this.resize());
    for (let i = 0; i < 140; i++) this.ash.push({ x: Math.random(), y: Math.random(), vx: 0, vy: 0, s: 0.5 + Math.random() * 1.6, a: 0.2 + Math.random() * 0.5 });
    for (let i = 0; i < 18; i++) this.fog.push({ x: Math.random(), y: Math.random(), vx: 0.004 + Math.random() * 0.01, vy: 0, s: 120 + Math.random() * 200, a: 0.05 + Math.random() * 0.08 });
  }

  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = this.canvas.clientWidth || window.innerWidth;
    this.h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.dark.width = Math.ceil(this.w / 2);
    this.dark.height = Math.ceil(this.h / 2);
    this.glow.width = Math.ceil(this.w / 2);
    this.glow.height = Math.ceil(this.h / 2);
    // show roughly 17 tiles vertically, more on wide screens
    this.scale = clamp(this.h / (32 * 16), 1.2, 3);
  }

  screenToWorld(sx: number, sy: number): Vec {
    return { x: (sx - this.w / 2) / this.scale + this.cam.x, y: (sy - this.h / 2) / this.scale + this.cam.y };
  }

  // ------------------------------------------------------------- ground cache

  private buildGround(g: Game): void {
    const ts = g.map.ts;
    const c = (this.ground ??= document.createElement("canvas"));
    c.width = g.map.w * ts;
    c.height = g.map.h * ts;
    const x = c.getContext("2d")!;
    for (let cy = 0; cy < g.map.h; cy++) for (let cx = 0; cx < g.map.w; cx++) this.drawTile(g, x, cx, cy);
    // raised blocks second so their faces overlap the floor below
    for (let cy = 0; cy < g.map.h; cy++) for (let cx = 0; cx < g.map.w; cx++) this.drawRaised(g, x, cx, cy);
    g.mapDirty = false;
  }

  private drawTile(g: Game, x: CanvasRenderingContext2D, cx: number, cy: number): void {
    const ts = g.map.ts;
    const d = g.map.def(cx, cy);
    if (!d) return;
    const h = hash2(cx, cy, 7);
    x.fillStyle = d.colors[Math.floor(h * d.colors.length)];
    x.fillRect(cx * ts, cy * ts, ts, ts);
    // soft noise blotches give the ground texture
    // subtle grit: small dark specks only (large light blobs read as bubbles)
    for (let i = 0; i < 4; i++) {
      const hx = hash2(cx, cy, 11 + i);
      const hy = hash2(cy, cx, 23 + i);
      x.fillStyle = `rgba(0,0,0,${0.05 + hash2(cx, cy, 40 + i) * 0.06})`;
      x.fillRect(cx * ts + hx * ts, cy * ts + hy * ts, 1 + hash2(cx, cy, 50 + i) * 2, 1 + hash2(cy, cx, 60 + i) * 2);
    }
    const px = cx * ts;
    const py = cy * ts;
    switch (d.decor) {
      case "grass":
        x.strokeStyle = "rgba(150,140,90,0.55)";
        x.lineWidth = 1;
        for (let i = 0; i < 6; i++) {
          const gx = px + hash2(cx, cy, 60 + i) * ts;
          const gy = py + hash2(cx, cy, 70 + i) * ts;
          x.beginPath();
          x.moveTo(gx, gy);
          x.lineTo(gx + (hash2(cx, cy, 80 + i) - 0.5) * 5, gy - 4 - hash2(cx, cy, 90 + i) * 5);
          x.stroke();
        }
        break;
      case "stones":
        if (h < 0.35) {
          x.fillStyle = "rgba(90,86,80,0.8)";
          x.beginPath();
          x.ellipse(px + hash2(cx, cy, 3) * ts, py + hash2(cx, cy, 4) * ts, 3, 2, 0, 0, Math.PI * 2);
          x.fill();
        }
        break;
      case "cobble":
        x.strokeStyle = "rgba(0,0,0,0.25)";
        x.lineWidth = 1;
        for (let i = 0; i < 2; i++)
          for (let j = 0; j < 2; j++) x.strokeRect(px + i * 16 + (j % 2) * 4 + 1, py + j * 16 + 1, 14, 14);
        break;
      case "planks":
        x.strokeStyle = "rgba(0,0,0,0.3)";
        for (let i = 0; i < 4; i++) {
          x.beginPath();
          x.moveTo(px, py + i * 8 + 0.5);
          x.lineTo(px + ts, py + i * 8 + 0.5);
          x.stroke();
        }
        break;
      case "roots":
        x.strokeStyle = "rgba(40,28,20,0.6)";
        x.lineWidth = 2;
        x.beginPath();
        x.moveTo(px + h * ts, py);
        x.quadraticCurveTo(px + ts / 2, py + ts / 2, px + hash2(cx, cy, 5) * ts, py + ts);
        x.stroke();
        break;
    }
  }

  private drawRaised(g: Game, x: CanvasRenderingContext2D, cx: number, cy: number): void {
    const ts = g.map.ts;
    const d = g.map.def(cx, cy);
    if (!d?.height) return;
    const px = cx * ts;
    const py = cy * ts;
    const hgt = d.height;
    const h = hash2(cx, cy, 3);
    if (d.decor === "tree") {
      // dead tree: shadow, trunk, gnarled crown silhouette
      x.fillStyle = "rgba(0,0,0,0.35)";
      x.beginPath();
      x.ellipse(px + ts / 2 + 6, py + ts * 0.8, 14, 6, 0, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = "#2a1f18";
      x.fillRect(px + ts / 2 - 3, py + ts * 0.2, 6, ts * 0.65);
      x.strokeStyle = "#2a1f18";
      x.lineWidth = 3;
      for (let i = 0; i < 4; i++) {
        const a = -Math.PI / 2 + (hash2(cx, cy, 100 + i) - 0.5) * 2.4;
        const l = 10 + hash2(cx, cy, 110 + i) * 10;
        x.beginPath();
        x.moveTo(px + ts / 2, py + ts * 0.3);
        x.lineTo(px + ts / 2 + Math.cos(a) * l, py + ts * 0.3 + Math.sin(a) * l);
        x.stroke();
      }
      return;
    }
    if (d.decor === "graves") {
      x.fillStyle = "rgba(0,0,0,0.35)";
      x.fillRect(px + 8, py + 20, 18, 6);
      x.fillStyle = d.top ?? d.colors[0];
      x.beginPath();
      x.moveTo(px + 9, py + 24);
      x.lineTo(px + 9, py + 10);
      x.arc(px + 16, py + 10, 7, Math.PI, 0);
      x.lineTo(px + 23, py + 24);
      x.fill();
      x.fillStyle = "rgba(0,0,0,0.3)";
      x.fillRect(px + 13, py + 12, 6, 2);
      return;
    }
    // block: dark south face, then top face offset upward
    const below = g.map.def(cx, cy + 1);
    if (!below?.height) {
      x.fillStyle = shade(d.colors[0], -0.45);
      x.fillRect(px, py + ts - hgt, ts, hgt);
      x.fillStyle = "rgba(0,0,0,0.25)";
      x.fillRect(px, py + ts, ts, 6);
    }
    x.fillStyle = d.top ?? shade(d.colors[0], 0.1);
    x.fillRect(px, py - hgt, ts, ts);
    // texture: bricks / cracks
    x.strokeStyle = "rgba(0,0,0,0.22)";
    x.lineWidth = 1;
    const top = py - hgt;
    for (let r = 0; r < 3; r++) {
      x.beginPath();
      x.moveTo(px, top + r * 11 + 8);
      x.lineTo(px + ts, top + r * 11 + 8);
      x.stroke();
    }
    if (d.breakable) {
      x.strokeStyle = "rgba(20,10,5,0.85)";
      x.lineWidth = 2;
      x.beginPath();
      x.moveTo(px + 6, top + 4);
      x.lineTo(px + 14, top + 14);
      x.lineTo(px + 10, top + 22);
      x.lineTo(px + 20, top + 28);
      x.stroke();
    } else if (h < 0.25) {
      x.fillStyle = "rgba(80,100,60,0.35)"; // moss
      x.beginPath();
      x.arc(px + h * 80, top + 6, 5, 0, Math.PI * 2);
      x.fill();
    }
  }

  // ------------------------------------------------------------- frame

  draw(g: Game, dt: number): void {
    this.t += dt;
    if (g.mapDirty || !this.ground) this.buildGround(g);
    const ctx = this.ctx;
    const p = g.player;
    // camera leads slightly toward the aim point
    const lead = { x: (g.aim.x - p.pos.x) * 0.18, y: (g.aim.y - p.pos.y) * 0.18 };
    const tx = p.pos.x + clamp(lead.x, -80, 80);
    const ty = p.pos.y + clamp(lead.y, -60, 60);
    const k = 1 - Math.exp(-dt * 6);
    this.cam.x = this.cam.x === 0 ? tx : lerp(this.cam.x, tx, k);
    this.cam.y = this.cam.y === 0 ? ty : lerp(this.cam.y, ty, k);
    const shake = g.fx.shakeAmt;
    const sx = (Math.random() - 0.5) * shake;
    const sy = (Math.random() - 0.5) * shake;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = "#07080b";
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.setTransform(this.dpr * this.scale, 0, 0, this.dpr * this.scale, this.dpr * (this.w / 2 - this.cam.x * this.scale + sx), this.dpr * (this.h / 2 - this.cam.y * this.scale + sy));
    ctx.imageSmoothingEnabled = false;

    const view = this.viewRect();
    ctx.drawImage(this.ground!, view.x0, view.y0, view.x1 - view.x0, view.y1 - view.y0, view.x0, view.y0, view.x1 - view.x0, view.y1 - view.y0);
    ctx.imageSmoothingEnabled = true;

    this.drawSurfaces(g, view);
    this.drawTelegraphs(g);
    this.drawEntities(g);
    this.drawSteam(g, view);
    this.drawFx(g);
    this.drawLighting(g, view, dt);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawAtmosphere(g, dt);
    this.drawScreenFx(g);
  }

  private viewRect() {
    const hw = this.w / 2 / this.scale + 40;
    const hh = this.h / 2 / this.scale + 60;
    const gw = this.ground!.width;
    const gh = this.ground!.height;
    return {
      x0: clamp(Math.floor(this.cam.x - hw), 0, gw),
      y0: clamp(Math.floor(this.cam.y - hh), 0, gh),
      x1: clamp(Math.ceil(this.cam.x + hw), 0, gw),
      y1: clamp(Math.ceil(this.cam.y + hh), 0, gh),
    };
  }

  private drawSurfaces(g: Game, v: ReturnType<Renderer["viewRect"]>): void {
    const ctx = this.ctx;
    const ts = g.map.ts;
    const s = g.surfaces;
    const t = this.t;
    for (let cy = Math.floor(v.y0 / ts); cy < Math.ceil(v.y1 / ts); cy++)
      for (let cx = Math.floor(v.x0 / ts); cx < Math.ceil(v.x1 / ts); cx++) {
        const i = s.idx(cx, cy);
        const l = s.liquid[i];
        const px = cx * ts;
        const py = cy * ts;
        const deep = g.map.get(cx, cy) === "deep_water";
        if (l === Liquid.Water) {
          ctx.fillStyle = deep ? "rgba(20,46,70,0.85)" : "rgba(50,90,120,0.45)";
          ctx.fillRect(px, py, ts, ts);
          const w = Math.sin(t * 2 + cx * 0.9 + cy * 1.3);
          ctx.fillStyle = `rgba(160,200,230,${0.06 + w * 0.04})`;
          ctx.fillRect(px + 4, py + 10 + w * 3, ts - 8, 2);
        } else if (l === Liquid.Oil) {
          ctx.fillStyle = "rgba(60,48,20,0.42)";
          ctx.fillRect(px, py, ts, ts);
          ctx.fillStyle = `hsla(${(t * 40 + cx * 30 + cy * 20) % 360},70%,60%,0.16)`;
          ctx.beginPath();
          ctx.ellipse(px + ts / 2, py + ts / 2, ts * 0.3, ts * 0.15, 0.4, 0, Math.PI * 2);
          ctx.fill();
        } else if (l === Liquid.Ink) {
          ctx.fillStyle = "rgba(40,14,60,0.72)";
          ctx.fillRect(px, py, ts, ts);
          const pulse = 0.12 + Math.sin(t * 3 + cx + cy * 0.7) * 0.08;
          ctx.fillStyle = `rgba(140,90,210,${pulse})`;
          ctx.beginPath();
          ctx.arc(px + ts / 2 + Math.sin(t + cx) * 5, py + ts / 2, 4, 0, Math.PI * 2);
          ctx.fill();
        } else if (l === Liquid.Ice) {
          ctx.fillStyle = "rgba(200,235,250,0.7)";
          ctx.fillRect(px, py, ts, ts);
          ctx.strokeStyle = "rgba(255,255,255,0.5)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(px + hash2(cx, cy, 1) * ts, py);
          ctx.lineTo(px + hash2(cx, cy, 2) * ts, py + ts);
          ctx.stroke();
        }
        if (s.fire[i] > 0) {
          const f = s.fire[i];
          const flick = 0.75 + Math.sin(t * 18 + cx * 7 + cy * 3) * 0.25;
          const grd = ctx.createRadialGradient(px + ts / 2, py + ts / 2, 2, px + ts / 2, py + ts / 2, ts * 0.75);
          grd.addColorStop(0, `rgba(255,220,120,${0.9 * flick})`);
          grd.addColorStop(0.5, `rgba(255,110,30,${0.6 * flick})`);
          grd.addColorStop(1, "rgba(120,20,0,0)");
          ctx.fillStyle = grd;
          ctx.fillRect(px - 8, py - 8, ts + 16, ts + 16);
          if (Math.random() < 0.25) g.fx.ember({ x: px + Math.random() * ts, y: py + Math.random() * ts });
          if (f < 0.6) {
            ctx.fillStyle = "rgba(20,15,10,0.3)";
            ctx.fillRect(px, py, ts, ts);
          }
        }
      }
  }

  private drawSteam(g: Game, v: ReturnType<Renderer["viewRect"]>): void {
    const ctx = this.ctx;
    const ts = g.map.ts;
    const s = g.surfaces;
    for (const i of s.activeCells()) {
      const st = s.steam[i];
      if (st <= 0) continue;
      const cx = i % s.w;
      const cy = (i / s.w) | 0;
      const px = cx * ts + ts / 2;
      const py = cy * ts + ts / 2;
      if (px < v.x0 - ts || px > v.x1 + ts || py < v.y0 - ts || py > v.y1 + ts) continue;
      const a = Math.min(0.55, st * 0.18);
      const grd = ctx.createRadialGradient(px, py, 2, px, py, ts);
      grd.addColorStop(0, `rgba(225,230,235,${a})`);
      grd.addColorStop(1, "rgba(225,230,235,0)");
      ctx.fillStyle = grd;
      ctx.fillRect(px - ts, py - ts - Math.sin(this.t + cx) * 4, ts * 2, ts * 2);
    }
  }

  private drawTelegraphs(g: Game): void {
    const ctx = this.ctx;
    for (const e of g.enemies) {
      const at = e.attack;
      if (!at || at.done) continue;
      const k = clamp(at.t / at.def.windup, 0, 1);
      const a = at.def;
      ctx.save();
      ctx.fillStyle = `rgba(255,60,40,${0.12 + k * 0.2})`;
      ctx.strokeStyle = `rgba(255,90,60,${0.5 + k * 0.4})`;
      ctx.lineWidth = 1.5;
      if (a.kind === "slam") {
        const r = a.radius ?? 50;
        ctx.beginPath();
        ctx.arc(e.pos.x, e.pos.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(e.pos.x, e.pos.y, r * k, 0, Math.PI * 2);
        ctx.fill();
      } else if (a.kind === "lunge") {
        ctx.translate(e.pos.x, e.pos.y);
        ctx.rotate(at.angle);
        ctx.fillRect(0, -e.radius, (a.range + e.radius) * k, e.radius * 2);
        ctx.strokeRect(0, -e.radius, a.range + e.radius, e.radius * 2);
      } else if (a.kind === "melee") {
        const arc = ((a.arc ?? 90) * Math.PI) / 180;
        ctx.beginPath();
        ctx.moveTo(e.pos.x, e.pos.y);
        ctx.arc(e.pos.x, e.pos.y, (a.range + e.radius) * (0.4 + 0.6 * k), at.angle - arc / 2, at.angle + arc / 2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (a.kind === "projectile") {
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(e.pos.x, e.pos.y);
        ctx.lineTo(e.pos.x + Math.cos(at.angle) * a.range * k, e.pos.y + Math.sin(at.angle) * a.range * k);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  private drawEntities(g: Game): void {
    type D = { y: number; f: () => void };
    const list: D[] = [];
    for (const pr of g.props) list.push({ y: pr.pos.y, f: () => this.drawProp(g, pr) });
    for (const pk of g.pickups) list.push({ y: pk.pos.y - 10, f: () => this.drawPickup(g, pk.pos, pk.item, pk.affixes, pk.t) });
    for (const ec of g.echoes) list.push({ y: ec.pos.y, f: () => this.drawEcho(ec.pos, ec.rise, ec.life) });
    for (const n of g.npcs) list.push({ y: n.pos.y, f: () => this.drawNpc(n) });
    for (const e of g.enemies) list.push({ y: e.pos.y, f: () => this.drawEnemy(g, e) });
    if (!g.player.dead) list.push({ y: g.player.pos.y, f: () => this.drawPlayer(g, g.player) });
    for (const pj of g.projectiles) list.push({ y: pj.pos.y + 100, f: () => this.drawProjectile(pj.pos, pj.color, pj.visual, pj.radius) });
    list.sort((a, b) => a.y - b.y);
    for (const d of list) d.f();
    // interaction highlight
    if (g.focus) {
      const ctx = this.ctx;
      const f = g.focus.pos;
      ctx.strokeStyle = `rgba(255,230,170,${0.5 + Math.sin(this.t * 5) * 0.3})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(f.x, f.y + 8, 16, 7, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private shadow(x: number, y: number, r: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(0,0,0,0.38)";
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.7, r * 1.1, r * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawPlayer(g: Game, p: Player): void {
    const ctx = this.ctx;
    const { x, y } = p.pos;
    const a = p.action;
    this.shadow(x, y, 10);
    const ws = weaponStats(g);
    const bob = Math.sin(this.t * 10) * (p.sprinting ? 1.5 : 0.6);
    // weapon arc during swings
    let wAngle = p.facing + 0.9;
    if (a.kind === "light" || a.kind === "heavy") {
      const k = clamp(a.t / a.hitAt, 0, 1);
      const after = clamp((a.t - a.hitAt) / 0.12, 0, 1);
      const side = a.kind === "light" && a.combo === 2 ? -1 : 1;
      const spread = ws.arc / 2 + 0.3;
      wAngle = a.angle + side * (k < 1 ? lerp(-spread * 0.4, -spread, k) : lerp(-spread, spread, after));
    } else if (a.kind === "dodge") {
      ctx.globalAlpha = 0.6;
    }
    const weaponColor = ws.element === "fire" ? "#ffb070" : ws.element === "frost" ? "#d3f2ff" : "#cfc6b4";
    const wl = ws.weaponClass === "knife" ? 13 : ws.weaponClass === "maul" ? 22 : 18;
    const drawWeapon = () => {
      ctx.strokeStyle = weaponColor;
      ctx.lineWidth = ws.weaponClass === "maul" ? 4 : 2.5;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(wAngle) * 6, y - 4 + Math.sin(wAngle) * 6);
      ctx.lineTo(x + Math.cos(wAngle) * (6 + wl), y - 4 + Math.sin(wAngle) * (6 + wl));
      ctx.stroke();
      if (ws.weaponClass === "hook") {
        ctx.beginPath();
        ctx.arc(x + Math.cos(wAngle) * (6 + wl), y - 4 + Math.sin(wAngle) * (6 + wl), 4, wAngle, wAngle + Math.PI);
        ctx.stroke();
      }
    };
    if (Math.sin(wAngle) < 0) drawWeapon();
    // cloak
    ctx.fillStyle = p.hitFlash > 0 ? "#fff" : "#3b4a4f";
    ctx.beginPath();
    ctx.moveTo(x - 10, y + 8);
    ctx.quadraticCurveTo(x - 11, y - 8 + bob, x, y - 14 + bob);
    ctx.quadraticCurveTo(x + 11, y - 8 + bob, x + 10, y + 8);
    ctx.closePath();
    ctx.fill();
    // hood with face direction
    ctx.fillStyle = p.hitFlash > 0 ? "#fff" : "#26323a";
    ctx.beginPath();
    ctx.arc(x, y - 12 + bob, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e8d7b0";
    ctx.beginPath();
    ctx.arc(x + Math.cos(p.facing) * 3, y - 12 + bob + Math.sin(p.facing) * 2, 1.6, 0, Math.PI * 2);
    ctx.fill();
    // lantern at the belt
    ctx.fillStyle = "#ffcf7a";
    ctx.beginPath();
    ctx.arc(x - 6, y + 2, 2.2, 0, Math.PI * 2);
    ctx.fill();
    if (Math.sin(wAngle) >= 0) drawWeapon();
    ctx.globalAlpha = 1;
    this.drawStatuses(p.pos, p.statuses, 10);
    if (p.critReady > 0) {
      ctx.strokeStyle = "rgba(230,220,255,0.8)";
      ctx.beginPath();
      ctx.arc(x, y - 4, 15, 0, Math.PI * 2);
      ctx.stroke();
    }
    // heavy windup glint
    if (a.kind === "heavy" && !a.hit) {
      const k = a.t / a.hitAt;
      ctx.strokeStyle = `rgba(255,240,200,${k})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y - 4, 18 - k * 6, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawStatuses(pos: Vec, st: Record<string, number | undefined>, r: number): void {
    const ctx = this.ctx;
    const { x, y } = pos;
    if (st.frozen) {
      ctx.fillStyle = "rgba(190,235,255,0.55)";
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.beginPath();
      ctx.moveTo(x - r - 3, y + r);
      ctx.lineTo(x - r, y - r - 8);
      ctx.lineTo(x + r * 0.2, y - r - 12);
      ctx.lineTo(x + r + 3, y - r - 4);
      ctx.lineTo(x + r + 2, y + r);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    let i = 0;
    const icon = (c: string) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(x - 8 + i * 6, y - r - 16, 2.4, 0, Math.PI * 2);
      ctx.fill();
      i++;
    };
    if (st.burning) icon("#ff7a2a");
    if (st.wet) icon("#5fb0ff");
    if (st.oiled) icon("#7a6a40");
    if (st.chilled) icon("#bfe9ff");
    if (st.inked) icon("#9b6bd6");
  }

  private drawEnemy(g: Game, e: Enemy): void {
    const ctx = this.ctx;
    const v = e.def.visual;
    const sc = v.scale ?? 1;
    const { x, y } = e.pos;
    const flash = e.hitFlash > 0;
    const body = flash ? "#ffffff" : e.statuses.frozen ? "#bfe0ee" : v.color;
    const accent = v.accent;
    const f = e.facing;
    const moving = e.ai !== "idle";
    const step = Math.sin(this.t * 14 + e.id) * (moving ? 1 : 0);
    if (v.shape !== "echo") this.shadow(x, y, e.radius);
    ctx.save();
    ctx.translate(x, y);
    if (e.attack && !e.attack.done) {
      // windup: shudder
      const k = e.attack.t / e.attack.def.windup;
      ctx.translate((Math.random() - 0.5) * k * 2, (Math.random() - 0.5) * k * 2);
    }
    switch (v.shape) {
      case "hound": {
        ctx.rotate(f);
        ctx.strokeStyle = shade(body, -0.3);
        ctx.lineWidth = 2.5 * sc;
        for (const [lx, ly] of [[6, 5], [6, -5], [-6, 5], [-6, -5]]) {
          ctx.beginPath();
          ctx.moveTo(lx * sc, ly * sc * 0.6);
          ctx.lineTo((lx + step * 2 * Math.sign(lx)) * sc, ly * sc * 1.4);
          ctx.stroke();
        }
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.ellipse(0, 0, 13 * sc, 6.5 * sc, 0, 0, Math.PI * 2);
        ctx.fill();
        // spine ridge
        ctx.strokeStyle = shade(body, -0.4);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-10 * sc, 0);
        ctx.lineTo(8 * sc, 0);
        ctx.stroke();
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.ellipse(13 * sc, 0, 6 * sc, 5 * sc, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath(); // ears
        ctx.moveTo(11 * sc, -4 * sc);
        ctx.lineTo(9 * sc, -9 * sc);
        ctx.lineTo(14 * sc, -5 * sc);
        ctx.moveTo(11 * sc, 4 * sc);
        ctx.lineTo(9 * sc, 9 * sc);
        ctx.lineTo(14 * sc, 5 * sc);
        ctx.fill();
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(16 * sc, -2 * sc, 1.4 * sc, 0, Math.PI * 2);
        ctx.arc(16 * sc, 2 * sc, 1.4 * sc, 0, Math.PI * 2);
        ctx.fill();
        // tail
        ctx.strokeStyle = body;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-12 * sc, 0);
        ctx.lineTo(-19 * sc, step * 3);
        ctx.stroke();
        break;
      }
      case "thrall": {
        const s = sc;
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.ellipse(0, -6 * s, 13 * s, 15 * s, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(Math.cos(f) * 4 * s, -20 * s, 6 * s, 0, Math.PI * 2);
        ctx.fill();
        // arms, raised when winding up
        const raise = e.attack && !e.attack.done ? e.attack.t / e.attack.def.windup : 0;
        ctx.strokeStyle = shade(body, -0.25);
        ctx.lineWidth = 5 * s;
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(side * 11 * s, -12 * s);
          ctx.lineTo(side * 15 * s, (2 - raise * 26) * s);
          ctx.stroke();
        }
        // glowing cracks
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-5 * s, -14 * s);
        ctx.lineTo(0, -6 * s);
        ctx.lineTo(-3 * s, 2 * s);
        ctx.moveTo(5 * s, -12 * s);
        ctx.lineTo(3 * s, -4 * s);
        ctx.stroke();
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(Math.cos(f) * 6 * s, -21 * s, 1.6 * s, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "leech":
      case "matron": {
        const s = sc;
        ctx.rotate(f);
        for (let i = 3; i >= 0; i--) {
          const wob = Math.sin(this.t * 6 + i + e.id) * 2 * s;
          ctx.fillStyle = i === 0 ? body : shade(body, -0.12 * i);
          ctx.beginPath();
          ctx.arc(-i * 8 * s, wob, (9 - i * 1.3) * s, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(6 * s, 0, 3.5 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(160,110,230,0.5)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, 0, 10 * s, -1, 1);
        ctx.stroke();
        break;
      }
      case "echo": {
        const flick = 0.55 + Math.sin(this.t * 13 + e.id) * 0.2;
        ctx.globalAlpha = flick;
        ctx.fillStyle = flash ? "#fff" : body;
        ctx.beginPath();
        ctx.moveTo(-10 * sc, 10 * sc);
        ctx.quadraticCurveTo(-12 * sc, -12 * sc, 0, -20 * sc);
        ctx.quadraticCurveTo(12 * sc, -12 * sc, 10 * sc, 10 * sc);
        for (let i = 0; i < 4; i++) ctx.lineTo((10 - i * 6.6) * sc, (6 + (i % 2) * 6 + Math.sin(this.t * 8 + i) * 2) * sc);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(-3 * sc + Math.cos(f) * 2, -10 * sc, 1.8 * sc, 0, Math.PI * 2);
        ctx.arc(3 * sc + Math.cos(f) * 2, -10 * sc, 1.8 * sc, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        break;
      }
    }
    ctx.restore();
    this.drawStatuses(e.pos, e.statuses, e.radius);
    if (e.ai === "investigate") {
      ctx.fillStyle = "#e0d080";
      ctx.font = "bold 10px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("?", x, y - e.radius - 18);
    }
    // health bar
    if ((e.hp < e.maxHp || e.awareOfPlayer) && !e.boss) {
      const w = Math.max(20, e.radius * 2.2);
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(x - w / 2, y - e.radius - 12, w, 3);
      ctx.fillStyle = e.risen ? "#b9a4ff" : "#d0423a";
      ctx.fillRect(x - w / 2, y - e.radius - 12, (w * Math.max(0, e.hp)) / e.maxHp, 3);
    }
  }

  private drawNpc(n: Npc): void {
    const ctx = this.ctx;
    const { x, y } = n.pos;
    this.shadow(x, y, 10);
    ctx.fillStyle = n.def.visual.color;
    ctx.beginPath();
    ctx.moveTo(x - 10, y + 8);
    ctx.quadraticCurveTo(x - 11, y - 8, x, y - 14);
    ctx.quadraticCurveTo(x + 11, y - 8, x + 10, y + 8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = n.def.visual.accent;
    ctx.beginPath();
    ctx.arc(x, y - 12, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e8d7b0";
    ctx.beginPath();
    ctx.arc(x + Math.cos(n.facing) * 3, y - 12 + Math.sin(n.facing) * 2, 1.5, 0, Math.PI * 2);
    ctx.fill();
    if (n.def.visual.lantern) {
      ctx.strokeStyle = "#3a2c1c";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + 9, y - 4);
      ctx.lineTo(x + 13, y - 10);
      ctx.stroke();
      ctx.fillStyle = "#ffcf7a";
      ctx.beginPath();
      ctx.arc(x + 13, y - 6, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawProp(g: Game, pr: Prop): void {
    const ctx = this.ctx;
    const { x, y } = pr.pos;
    const t = this.t;
    switch (pr.def.shape) {
      case "barrel":
        this.shadow(x, y, 9);
        ctx.fillStyle = "#5a3b22";
        ctx.fillRect(x - 8, y - 16, 16, 20);
        ctx.fillStyle = "#3e2817";
        ctx.fillRect(x - 8, y - 12, 16, 2);
        ctx.fillRect(x - 8, y - 2, 16, 2);
        ctx.fillStyle = "#2a1d12";
        ctx.beginPath();
        ctx.ellipse(x, y - 16, 8, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#c9a24a";
        ctx.font = "bold 7px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("OIL", x, y - 5);
        break;
      case "chest":
        this.shadow(x, y, 11);
        ctx.fillStyle = "#4a3320";
        ctx.fillRect(x - 11, y - 10, 22, 14);
        ctx.fillStyle = pr.used ? "#2a1d12" : "#6a4a2c";
        if (pr.used) ctx.fillRect(x - 11, y - 20, 22, 8);
        else ctx.fillRect(x - 11, y - 14, 22, 6);
        ctx.fillStyle = "#c9a24a";
        ctx.fillRect(x - 2, y - 10, 4, 4);
        break;
      case "page": {
        const b = Math.sin(t * 2.5 + pr.id) * 3;
        ctx.fillStyle = "rgba(255,220,150,0.25)";
        ctx.beginPath();
        ctx.arc(x, y - 10 + b, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.save();
        ctx.translate(x, y - 10 + b);
        ctx.rotate(Math.sin(t + pr.id) * 0.2);
        ctx.fillStyle = "#e9dcc0";
        ctx.fillRect(-5, -7, 10, 13);
        ctx.fillStyle = "#6b5a40";
        for (let i = 0; i < 4; i++) ctx.fillRect(-3, -5 + i * 3, 6, 1);
        ctx.restore();
        break;
      }
      case "waystone":
        this.shadow(x, y, 10);
        ctx.fillStyle = "#4a4a52";
        ctx.beginPath();
        ctx.moveTo(x - 8, y + 4);
        ctx.lineTo(x - 5, y - 30);
        ctx.lineTo(x + 5, y - 34);
        ctx.lineTo(x + 8, y + 4);
        ctx.fill();
        ctx.fillStyle = `rgba(255,210,120,${0.6 + Math.sin(t * 2) * 0.3})`;
        ctx.fillRect(x - 1.5, y - 24, 3, 12);
        ctx.fillRect(x - 4, y - 19, 8, 2);
        break;
      case "well": {
        const clean = g.world.get("well_clean") === true;
        this.shadow(x, y, 16);
        ctx.fillStyle = "#5c5750";
        ctx.beginPath();
        ctx.arc(x, y - 4, 16, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = clean ? "#2f6d8f" : "#24102f";
        ctx.beginPath();
        ctx.arc(x, y - 4, 11, 0, Math.PI * 2);
        ctx.fill();
        if (!clean) {
          ctx.fillStyle = `rgba(150,90,220,${0.3 + Math.sin(t * 3) * 0.15})`;
          ctx.beginPath();
          ctx.arc(x + Math.sin(t) * 4, y - 4, 3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.strokeStyle = "#3a2c1c";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - 14, y - 4);
        ctx.lineTo(x - 14, y - 26);
        ctx.lineTo(x + 14, y - 26);
        ctx.lineTo(x + 14, y - 4);
        ctx.stroke();
        break;
      }
      case "door":
        ctx.fillStyle = "#1b1620";
        ctx.fillRect(x - 16, y - 30, 32, 34);
        ctx.strokeStyle = `rgba(150,90,220,${0.5 + Math.sin(t * 1.5) * 0.3})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x - 14, y - 26);
        ctx.bezierCurveTo(x - 4, y - 18, x + 6, y - 22, x + 14, y - 8);
        ctx.moveTo(x - 12, y);
        ctx.bezierCurveTo(x - 2, y - 12, x + 4, y - 4, x + 12, y - 26);
        ctx.stroke();
        break;
      case "brazier": {
        this.shadow(x, y, 8);
        ctx.fillStyle = "#3a3430";
        ctx.fillRect(x - 2, y - 12, 4, 14);
        ctx.fillStyle = "#4e4640";
        ctx.beginPath();
        ctx.ellipse(x, y - 12, 9, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        if (pr.params.lit) {
          const fl = Math.sin(t * 20 + pr.id) * 2;
          ctx.fillStyle = "#ff9a3c";
          ctx.beginPath();
          ctx.moveTo(x - 6, y - 13);
          ctx.quadraticCurveTo(x, y - 30 + fl, x + 6, y - 13);
          ctx.fill();
          ctx.fillStyle = "#ffe08a";
          ctx.beginPath();
          ctx.moveTo(x - 3, y - 13);
          ctx.quadraticCurveTo(x, y - 22 + fl, x + 3, y - 13);
          ctx.fill();
        }
        break;
      }
      case "edict_stone":
        this.shadow(x, y, 14);
        ctx.fillStyle = "#2b2a30";
        ctx.beginPath();
        ctx.moveTo(x - 12, y + 4);
        ctx.lineTo(x - 9, y - 40);
        ctx.lineTo(x + 2, y - 48);
        ctx.lineTo(x + 11, y - 38);
        ctx.lineTo(x + 12, y + 4);
        ctx.fill();
        ctx.strokeStyle = `rgba(255,190,120,${0.5 + Math.sin(t * 1.3) * 0.4})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x - 5, y - 32);
        ctx.lineTo(x + 5, y - 32);
        ctx.moveTo(x, y - 36);
        ctx.lineTo(x, y - 18);
        ctx.moveTo(x - 4, y - 24);
        ctx.lineTo(x + 4, y - 20);
        ctx.stroke();
        if (Math.random() < 0.3) g.fx.particles.push({ x: x + (Math.random() - 0.5) * 40, y: y + 10, vx: 0, vy: -20, life: 2.5, max: 2.5, size: 2, color: "#b9b0a4", kind: "spark", drag: 0, rise: 6 });
        break;
      case "corpse":
        ctx.fillStyle = "rgba(0,0,0,0.3)";
        ctx.beginPath();
        ctx.ellipse(x, y + 2, 14, 5, 0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#4b4038";
        ctx.beginPath();
        ctx.ellipse(x, y, 12, 5, 0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#6b5a4a";
        ctx.beginPath();
        ctx.arc(x + 11, y + 2, 4, 0, Math.PI * 2);
        ctx.fill();
        break;
      case "spring":
        ctx.fillStyle = "#3d3a36";
        ctx.fillRect(x - 6, y - 18, 12, 20);
        ctx.fillStyle = "#57514a";
        ctx.fillRect(x - 8, y - 20, 16, 4);
        ctx.fillStyle = `rgba(140,200,230,${0.4 + Math.sin(t * 2) * 0.2})`;
        ctx.fillRect(x - 2, y - 14, 4, 8);
        break;
    }
  }

  private drawPickup(g: Game, pos: Vec, item: string, affixes: string[], t: number): void {
    const ctx = this.ctx;
    const def = g.content.items[item];
    if (!def) return;
    const r = resolveItem(g.content, { uid: 0, base: item, count: 1, affixes });
    const col = RARITY_COLOR[r.rarity];
    const b = Math.sin(this.t * 4 + pos.x) * 2;
    if (r.rarity !== "common") {
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
      ctx.lineTo(pos.x, pos.y - 40);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(pos.x, pos.y + 4, 6, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = def.color ?? col;
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y - 10 + b);
    ctx.lineTo(pos.x + 5, pos.y - 4 + b);
    ctx.lineTo(pos.x, pos.y + 2 + b);
    ctx.lineTo(pos.x - 5, pos.y - 4 + b);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    if (t < 0.4) g.fx.trail(pos, col);
  }

  private drawEcho(pos: Vec, rise: number, life: number): void {
    const ctx = this.ctx;
    const pulse = 0.5 + Math.sin(this.t * 6 + pos.x) * 0.25;
    const danger = rise !== Infinity;
    const col = danger ? (rise < 2 ? "255,120,200" : "200,160,255") : "200,185,255";
    const grd = ctx.createRadialGradient(pos.x, pos.y - 8, 1, pos.x, pos.y - 8, 14);
    grd.addColorStop(0, `rgba(${col},${0.9 * pulse * Math.min(1, life / 3)})`);
    grd.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y - 8, 14, 0, Math.PI * 2);
    ctx.fill();
    if (danger) {
      ctx.strokeStyle = `rgba(${col},0.7)`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y - 8, 12, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * Math.max(0, rise)) / 6);
      ctx.stroke();
    }
  }

  private drawProjectile(pos: Vec, color: string, visual: string, r: number): void {
    const ctx = this.ctx;
    if (visual === "flask") {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y - 10, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath();
      ctx.ellipse(pos.x, pos.y + 2, 4, 2, 0, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    const grd = ctx.createRadialGradient(pos.x, pos.y, 1, pos.x, pos.y, r * 2.4);
    grd.addColorStop(0, "#fff");
    grd.addColorStop(0.35, color);
    grd.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, r * 2.4, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawFx(g: Game): void {
    const ctx = this.ctx;
    for (const s of g.fx.swings) {
      const k = s.life / s.max;
      ctx.strokeStyle = s.color;
      ctx.globalAlpha = k * 0.8;
      ctx.lineWidth = s.heavy ? 7 : 4;
      ctx.beginPath();
      ctx.arc(s.x, s.y - 4, s.reach * 0.85, s.angle - s.arc / 2, s.angle + s.arc / 2);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.globalAlpha = k * 0.4;
      ctx.beginPath();
      ctx.arc(s.x, s.y - 4, s.reach * 0.6, s.angle - s.arc / 2, s.angle + s.arc / 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    for (const r of g.fx.rings) {
      const k = 1 - r.life / r.max;
      ctx.strokeStyle = r.color;
      ctx.globalAlpha = 1 - k;
      ctx.lineWidth = r.width;
      ctx.beginPath();
      ctx.arc(r.x, r.y, lerp(r.r0, r.r1, k), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const p of g.fx.particles) {
      const k = p.life / p.max;
      ctx.globalAlpha = p.kind === "smoke" ? k * 0.5 : k;
      ctx.fillStyle = p.color;
      if (p.kind === "shard") ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.kind === "smoke" ? p.size * (2 - k) : p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "center";
    for (const t of g.fx.texts) {
      const k = t.life / t.max;
      ctx.globalAlpha = Math.min(1, k * 2);
      ctx.font = `${t.bark ? "italic " : "bold "}${t.size}px Georgia, serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0,0,0,0.75)";
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------- light

  private drawLighting(g: Game, v: ReturnType<Renderer["viewRect"]>, dt: number): void {
    const edict = g.edictAt(g.player.pos);
    const target = hexToRgb(edict.ambient);
    const k = 1 - Math.exp(-dt * 1.5);
    this.darkness = lerp(this.darkness, edict.darkness, k);
    for (let i = 0; i < 3; i++) this.ambient[i] = lerp(this.ambient[i], target[i], k);

    const d = this.dctx;
    const W = this.dark.width;
    const H = this.dark.height;
    const s = this.scale / 2;
    const toS = (p: Vec) => ({ x: (p.x - this.cam.x) * s + W / 2, y: (p.y - this.cam.y) * s + H / 2 });
    d.globalCompositeOperation = "source-over";
    d.clearRect(0, 0, W, H);
    d.fillStyle = `rgba(${this.ambient.map((c) => Math.round(c)).join(",")},${this.darkness})`;
    d.fillRect(0, 0, W, H);
    d.globalCompositeOperation = "destination-out";
    const gl = this.gctx;
    gl.clearRect(0, 0, W, H);
    const light = (p: Vec, r: number, intensity: number, color?: string) => {
      const q = toS(p);
      const rr = r * s;
      if (q.x < -rr || q.y < -rr || q.x > W + rr || q.y > H + rr) return;
      const grd = d.createRadialGradient(q.x, q.y, 0, q.x, q.y, rr);
      grd.addColorStop(0, `rgba(0,0,0,${intensity})`);
      grd.addColorStop(0.55, `rgba(0,0,0,${intensity * 0.6})`);
      grd.addColorStop(1, "rgba(0,0,0,0)");
      d.fillStyle = grd;
      d.fillRect(q.x - rr, q.y - rr, rr * 2, rr * 2);
      if (color) {
        const g2 = gl.createRadialGradient(q.x, q.y, 0, q.x, q.y, rr * 0.7);
        g2.addColorStop(0, color);
        g2.addColorStop(1, "rgba(0,0,0,0)");
        gl.fillStyle = g2;
        gl.fillRect(q.x - rr, q.y - rr, rr * 2, rr * 2);
      }
    };
    const flick = 0.92 + Math.sin(this.t * 9) * 0.04 + Math.sin(this.t * 23) * 0.03;
    light(g.player.pos, 210 * flick, 1, "rgba(255,190,110,0.10)");
    const ts = g.map.ts;
    let fires = 0;
    for (const i of g.surfaces.activeCells()) {
      if (g.surfaces.fire[i] <= 0 || fires > 90) continue;
      const cx = i % g.surfaces.w;
      const cy = (i / g.surfaces.w) | 0;
      const px = cx * ts + ts / 2;
      const py = cy * ts + ts / 2;
      if (px < v.x0 || px > v.x1 || py < v.y0 || py > v.y1) continue;
      fires++;
      light({ x: px, y: py }, 90 + Math.random() * 10, 0.9, "rgba(255,120,40,0.22)");
    }
    for (const pr of g.props) {
      const l = pr.def.light;
      if (l && (pr.def.shape !== "brazier" || pr.params.lit)) light(pr.pos, l.radius * (l.flicker ? flick : 1), 1, l.color);
      if (pr.def.shape === "page") light(pr.pos, 50, 0.6, "rgba(255,220,150,0.12)");
    }
    for (const n of g.npcs) if (n.def.visual.lantern) light(n.pos, 140 * flick, 0.9, "rgba(255,190,110,0.10)");
    for (const ec of g.echoes) light(ec.pos, 60, 0.7, "rgba(180,150,255,0.18)");
    for (const p of g.projectiles) if (p.visual !== "flask") light(p.pos, 90, 0.9, p.element === "frost" ? "rgba(150,220,255,0.25)" : "rgba(255,140,60,0.3)");
    for (const e of g.enemies) if (e.def.visual.shape === "echo" || e.statuses.burning) light(e.pos, 60, 0.6, e.statuses.burning ? "rgba(255,120,40,0.2)" : "rgba(180,150,255,0.15)");
    for (const pk of g.pickups) light(pk.pos, 40, 0.5);

    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.drawImage(this.dark, 0, 0, this.w, this.h);
    ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(this.glow, 0, 0, this.w, this.h);
    ctx.globalCompositeOperation = "source-over";
  }

  private drawAtmosphere(g: Game, dt: number): void {
    const ctx = this.ctx;
    const edict = g.edictAt(g.player.pos);
    const dir = edict.ash === "up" ? -1 : edict.ash === "none" ? 0 : 1;
    if (dir !== 0) {
      for (const a of this.ash) {
        a.y += (dir * 0.02 * a.s + 0) * dt;
        a.x += Math.sin(this.t * 0.5 + a.s * 10) * 0.004 * dt;
        if (a.y > 1.05) a.y -= 1.1;
        if (a.y < -0.05) a.y += 1.1;
        if (a.x > 1) a.x -= 1;
        if (a.x < 0) a.x += 1;
        // parallax with camera
        const sx = (((a.x * this.w - this.cam.x * 0.3 * a.s) % this.w) + this.w) % this.w;
        const sy = (((a.y * this.h - this.cam.y * 0.3 * a.s) % this.h) + this.h) % this.h;
        ctx.fillStyle = `rgba(200,190,180,${a.a})`;
        ctx.fillRect(sx, sy, a.s * 1.4, a.s * 1.4);
      }
    }
    const fog = edict.fog ?? 0;
    if (fog > 0) {
      for (const f of this.fog) {
        f.x += f.vx * dt;
        if (f.x > 1.3) f.x -= 1.6;
        const sx = f.x * this.w - ((this.cam.x * 0.5) % this.w);
        const sy = f.y * this.h - ((this.cam.y * 0.5) % this.h);
        for (const [ox, oy] of [[0, 0], [this.w, 0], [0, this.h], [this.w, this.h]]) {
          const x = ((sx + ox) % (this.w * 1.3)) - this.w * 0.15;
          const y = ((sy + oy) % (this.h * 1.3)) - this.h * 0.15;
          const grd = ctx.createRadialGradient(x, y, 0, x, y, f.s);
          grd.addColorStop(0, `rgba(170,175,190,${f.a * fog})`);
          grd.addColorStop(1, "rgba(170,175,190,0)");
          ctx.fillStyle = grd;
          ctx.fillRect(x - f.s, y - f.s, f.s * 2, f.s * 2);
        }
      }
    }
  }

  private drawScreenFx(g: Game): void {
    const ctx = this.ctx;
    // vignette
    const grd = ctx.createRadialGradient(this.w / 2, this.h / 2, this.h * 0.35, this.w / 2, this.h / 2, this.h * 0.95);
    grd.addColorStop(0, "rgba(0,0,0,0)");
    grd.addColorStop(1, "rgba(0,0,0,0.6)");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, this.w, this.h);
    const p = g.player;
    if (p.hp < p.maxHp * 0.3 && !p.dead) {
      ctx.fillStyle = `rgba(120,0,0,${0.12 + Math.sin(this.t * 4) * 0.06})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }
    if (p.fray >= 50) {
      ctx.strokeStyle = `rgba(220,210,255,${(p.fray - 50) / 100})`;
      ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, this.w - 6, this.h - 6);
    }
    if (g.fx.flash > 0) {
      ctx.fillStyle = `rgba(235,230,255,${g.fx.flash * 0.6})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }
  }
}

function hexToRgb(hex: string): number[] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function shade(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  const f = (c: number) => Math.round(clamp(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt, 0, 255));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
