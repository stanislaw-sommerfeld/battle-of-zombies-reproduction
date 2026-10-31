// Projectiles: spells, enemy spit and thrown flasks. On impact they apply their
// element to the surface grid, which is where most combos come from.
import { dist } from "../core/math.js";
import type { Projectile, Actor, Enemy } from "../entities/entities.js";
import type { Game } from "../game.js";
import { LIQUID_BY_NAME } from "../world/surfaces.js";
import { computeDamage } from "./damage.js";
import { areaHit, breakTile, damageEnemy, damagePlayer, damageProp } from "./combat.js";
import type { HitInfo } from "../effects/perks.js";

export function updateProjectiles(g: Game, dt: number): void {
  for (const p of g.projectiles) {
    if (p.dead) continue;
    p.life -= dt;
    const steps = Math.ceil((Math.hypot(p.vel.x, p.vel.y) * dt) / 8);
    for (let s = 0; s < steps && !p.dead; s++) {
      p.pos.x += (p.vel.x * dt) / steps;
      p.pos.y += (p.vel.y * dt) / steps;
      const [cx, cy] = g.map.cellAt(p.pos);
      if (p.visual !== "flask" && g.map.blocksProjectiles(cx, cy)) {
        // spells can still hit cracked walls
        if (p.element === "physical") breakTile(g, cx, cy);
        impact(g, p);
        break;
      }
      if (p.visual === "flask") continue; // flasks arc over enemies and burst at the target point
      const target = hitActor(g, p);
      if (target) {
        impact(g, p, target);
        break;
      }
      for (const pr of g.props) {
        if (!pr.dead && pr.def.health && dist(pr.pos, p.pos) < pr.def.radius + p.radius) {
          damageProp(g, pr, 1);
          impact(g, p);
          break;
        }
      }
    }
    if (!p.dead && p.life <= 0) impact(g, p);
    if (!p.dead && p.visual !== "flask") g.fx.trail(p.pos, p.color);
  }
}

function hitActor(g: Game, p: Projectile): Actor | undefined {
  const pl = g.player;
  if (!p.fromPlayer && g.hostile(p.faction, pl.faction) && dist(pl.pos, p.pos) < pl.radius + p.radius) return pl;
  for (const e of g.enemies) {
    if (e.dead) continue;
    if (p.fromPlayer ? false : !g.hostile(p.faction, e.faction)) continue;
    if (dist(e.pos, p.pos) < e.radius + p.radius) return e;
  }
  return undefined;
}

function impact(g: Game, p: Projectile, target?: Actor): void {
  p.dead = true;
  const [cx, cy] = g.map.cellAt(p.pos);
  // surface interaction
  if (p.leaves) g.surfaces.splash(cx, cy, p.splash ?? 1, LIQUID_BY_NAME[p.leaves]);
  if (p.element === "fire" || p.element === "frost") g.surfaces.applyElementArea(cx, cy, p.visual === "flask" ? (p.splash ?? 1) : Math.max(0.6, (p.splash ?? 0) * 0.6), p.element);
  g.fx.impact(p.pos, p.color, p.visual);

  if (p.visual === "flask") {
    // thrown liquids coat everything in the splash
    const r = (p.splash ?? 1) * g.map.ts;
    const coat = p.leaves === "oil" ? "oiled" : p.leaves === "water" ? "wet" : p.leaves === "ink" ? "inked" : undefined;
    for (const e of g.enemies) if (!e.dead && dist(e.pos, p.pos) < r + e.radius && coat) g.applyStatusTo(e, coat);
    if (p.damage > 0) areaHit(g, p.pos, r, p.damage, p.element, g.player.faction, true);
    return;
  }

  if (target === g.player) {
    damagePlayer(g, p.damage, p.element, "projectile");
    if (g.player.invuln <= 0) p.applies.forEach((s) => g.applyStatusTo(g.player, s));
  } else if (target) {
    const e = target as Enemy;
    const info: HitInfo = { target: e, heavy: false, element: p.element, fromBehind: false, melee: false, combo: 0 };
    let mult = 1;
    if (p.fromPlayer) for (const pk of g.perks()) if (pk.damageMult) mult *= pk.damageMult(g, info);
    const res = computeDamage({ base: p.damage, element: p.element, resist: e.def.resist, targetStatuses: e.statuses, multiplier: mult });
    p.applies.forEach((s) => g.applyStatusTo(e, s));
    damageEnemy(g, e, res.amount, p.element, { byPlayer: p.fromPlayer, from: p.pos, knock: 120, poise: res.amount * 0.8 });
    if (p.fromPlayer) for (const pk of g.perks()) pk.onHit?.(g, info);
  }
  // spells with splash also hit nearby (small)
  if (p.fromPlayer && (p.splash ?? 0) > 1 && p.ability) {
    for (const e of g.enemies) {
      if (e.dead || e === target || dist(e.pos, p.pos) > (p.splash ?? 1) * g.map.ts * 0.6) continue;
      p.applies.forEach((s) => g.applyStatusTo(e, s));
      damageEnemy(g, e, Math.round(p.damage * 0.4), p.element, { byPlayer: true, from: p.pos, knock: 60 });
    }
  }
  // fire bolts light braziers
  if (p.element === "fire") {
    g.lightBraziers(p.pos);
  }
  g.bus.emit("Noise", { x: p.pos.x, y: p.pos.y, radius: 140, source: "impact" });
}
