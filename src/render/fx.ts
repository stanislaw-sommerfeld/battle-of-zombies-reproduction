// Visual feedback: particles, floating text, swing arcs, rings, screen shake.
// Gameplay code calls these; the renderer draws them. No gameplay state here.
import type { Vec } from "../core/math.js";

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  kind: "spark" | "smoke" | "glow" | "shard";
  drag: number;
  rise: number;
}

export interface FloatText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  max: number;
  size: number;
  bark?: boolean;
}

export interface Ring {
  x: number;
  y: number;
  r0: number;
  r1: number;
  life: number;
  max: number;
  color: string;
  width: number;
}

export interface SwingArc {
  x: number;
  y: number;
  angle: number;
  reach: number;
  arc: number;
  life: number;
  max: number;
  color: string;
  heavy: boolean;
}

const ELEMENT_COLOR: Record<string, string> = {
  physical: "#f2e8d5",
  fire: "#ff9a3c",
  frost: "#aee8ff",
  ink: "#9b6bd6",
  echo: "#c9b8ff",
};

export class Fx {
  particles: Particle[] = [];
  texts: FloatText[] = [];
  rings: Ring[] = [];
  swings: SwingArc[] = [];
  shakeAmt = 0;
  flash = 0; // full-screen flash (rupture)

  update(dt: number): void {
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy -= p.rise * dt;
      const f = Math.exp(-p.drag * dt);
      p.vx *= f;
      p.vy *= f;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    if (this.particles.length > 1400) this.particles.splice(0, this.particles.length - 1400);
    for (const t of this.texts) {
      t.life -= dt;
      t.y -= (t.bark ? 4 : 28) * dt;
    }
    this.texts = this.texts.filter((t) => t.life > 0);
    for (const r of this.rings) r.life -= dt;
    this.rings = this.rings.filter((r) => r.life > 0);
    for (const s of this.swings) s.life -= dt;
    this.swings = this.swings.filter((s) => s.life > 0);
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 30);
    this.flash = Math.max(0, this.flash - dt * 1.5);
  }

  private burst(pos: Vec, n: number, color: string, speed: number, life: number, size: number, kind: Particle["kind"] = "spark", rise = 0, drag = 4): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.7);
      this.particles.push({ x: pos.x, y: pos.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: life * (0.6 + Math.random() * 0.4), max: life, size: size * (0.6 + Math.random() * 0.6), color, kind, drag, rise });
    }
  }

  shake(n: number): void {
    this.shakeAmt = Math.max(this.shakeAmt, n);
  }

  text(pos: Vec, text: string, color: string, size = 12): void {
    this.texts.push({ x: pos.x + (Math.random() - 0.5) * 10, y: pos.y - 18, text, color, life: 1.3, max: 1.3, size });
  }

  bark(pos: Vec, text: string): void {
    this.texts.push({ x: pos.x, y: pos.y - 30, text, color: "#e9dfc8", life: 4, max: 4, size: 11, bark: true });
  }

  damage(pos: Vec, amount: number, element: string, crit: boolean, isPlayer = false): void {
    this.texts.push({
      x: pos.x + (Math.random() - 0.5) * 14,
      y: pos.y - 16,
      text: String(Math.round(amount)) + (crit ? "!" : ""),
      color: isPlayer ? "#ff5a5a" : ELEMENT_COLOR[element] ?? "#fff",
      life: 0.8,
      max: 0.8,
      size: crit ? 18 : 13,
    });
    this.burst(pos, isPlayer ? 6 : 8, isPlayer ? "#c43a3a" : ELEMENT_COLOR[element] ?? "#fff", 160, 0.35, 2.5);
  }

  swing(pos: Vec, angle: number, reach: number, arc: number, heavy: boolean, element: string): void {
    this.swings.push({ x: pos.x, y: pos.y, angle, reach, arc, life: heavy ? 0.22 : 0.14, max: heavy ? 0.22 : 0.14, color: ELEMENT_COLOR[element] ?? "#fff", heavy });
  }

  debris(pos: Vec, color: string): void {
    this.burst(pos, 12, color, 180, 0.6, 3, "shard", -200, 3);
    this.burst(pos, 6, "rgba(120,110,100,0.5)", 40, 1.2, 10, "smoke", 20, 1);
  }

  death(pos: Vec, color: string, accent: string): void {
    this.burst(pos, 22, color, 200, 0.7, 3.5, "shard", -150, 3);
    this.burst(pos, 10, accent, 60, 1.4, 6, "glow", 30, 1);
    this.rings.push({ x: pos.x, y: pos.y, r0: 6, r1: 40, life: 0.4, max: 0.4, color: accent, width: 3 });
  }

  dodge(pos: Vec): void {
    this.burst(pos, 8, "rgba(200,190,170,0.5)", 60, 0.5, 7, "smoke", 0, 3);
  }

  slam(pos: Vec, r: number): void {
    this.rings.push({ x: pos.x, y: pos.y, r0: 8, r1: r, life: 0.35, max: 0.35, color: "#ffcf9a", width: 5 });
    this.burst(pos, 18, "#9a8a78", 220, 0.5, 3, "shard", -100, 4);
  }

  shatter(pos: Vec): void {
    this.burst(pos, 30, "#d9f4ff", 260, 0.7, 3.5, "shard", -120, 3);
    this.rings.push({ x: pos.x, y: pos.y, r0: 10, r1: 70, life: 0.35, max: 0.35, color: "#bfe9ff", width: 4 });
  }

  alert(pos: Vec): void {
    this.texts.push({ x: pos.x, y: pos.y - 26, text: "!", color: "#ffcf4a", life: 0.9, max: 0.9, size: 20 });
  }

  trail(pos: Vec, color: string): void {
    if (Math.random() < 0.7) this.particles.push({ x: pos.x, y: pos.y, vx: (Math.random() - 0.5) * 20, vy: (Math.random() - 0.5) * 20, life: 0.35, max: 0.35, size: 4, color, kind: "glow", drag: 2, rise: 10 });
  }

  impact(pos: Vec, color: string, visual: string): void {
    this.burst(pos, visual === "flask" ? 16 : 12, color, 150, 0.45, 3, visual === "flask" ? "shard" : "glow", 0, 4);
    this.rings.push({ x: pos.x, y: pos.y, r0: 4, r1: visual === "flask" ? 40 : 26, life: 0.25, max: 0.25, color, width: 3 });
  }

  ember(pos: Vec): void {
    this.particles.push({ x: pos.x + (Math.random() - 0.5) * 14, y: pos.y + (Math.random() - 0.5) * 8, vx: (Math.random() - 0.5) * 20, vy: -30 - Math.random() * 30, life: 0.7, max: 0.7, size: 3, color: Math.random() < 0.5 ? "#ffb347" : "#ff6a2a", kind: "glow", drag: 1, rise: 20 });
  }

  reaction(r: string, pos: Vec): void {
    switch (r) {
      case "ignite_oil":
      case "grass_fire":
        this.burst(pos, 6, "#ffb347", 70, 0.6, 4, "glow", 60, 2);
        break;
      case "steam":
      case "melt":
      case "extinguish":
        this.burst(pos, 8, "rgba(220,230,240,0.55)", 40, 1.6, 12, "smoke", 25, 1);
        break;
      case "freeze_water":
        this.burst(pos, 3, "#e6f8ff", 50, 0.5, 2.5, "shard", 0, 4);
        break;
      case "ink_burn":
        this.burst(pos, 5, "#b48cff", 50, 0.9, 4, "glow", 50, 2);
        break;
      case "ink_purified":
        this.burst(pos, 4, "#f3eadf", 30, 1.2, 3, "glow", 40, 1);
        break;
    }
  }

  rupture(pos: Vec): void {
    this.flash = 0.8;
    this.rings.push({ x: pos.x, y: pos.y, r0: 10, r1: 220, life: 0.7, max: 0.7, color: "#e8e2ff", width: 6 });
    this.burst(pos, 40, "#e8e2ff", 300, 1, 3, "glow", 0, 2);
  }

  rise(pos: Vec): void {
    this.burst(pos, 20, "#c9b8ff", 90, 1, 4, "glow", 60, 2);
    this.rings.push({ x: pos.x, y: pos.y, r0: 30, r1: 4, life: 0.6, max: 0.6, color: "#c9b8ff", width: 3 });
  }

  rest(pos: Vec): void {
    this.rings.push({ x: pos.x, y: pos.y, r0: 10, r1: 120, life: 1, max: 1, color: "#ffd98a", width: 4 });
    this.burst(pos, 30, "#ffd98a", 80, 1.5, 3, "glow", 40, 1);
  }

  harvest(from: Vec, to: Vec): void {
    for (let i = 0; i < 14; i++) {
      const t = Math.random();
      this.particles.push({ x: from.x, y: from.y, vx: (to.x - from.x) * (2 + t), vy: (to.y - from.y) * (2 + t), life: 0.4, max: 0.4, size: 4, color: "#c9b8ff", kind: "glow", drag: 3, rise: 0 });
    }
  }
}
