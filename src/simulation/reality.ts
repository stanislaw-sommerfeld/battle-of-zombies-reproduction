// World simulation tick: actors vs surfaces, status damage, edict rules,
// Fray (risk magic) and echoes (the dead's residue).
import { dist, type Vec } from "../core/math.js";
import { tickStatuses } from "../combat/damage.js";
import { damageEnemy, damagePlayer } from "../combat/combat.js";
import type { Actor, Enemy } from "../entities/entities.js";
import type { Game } from "../game.js";
import { createEnemy } from "../ai/enemy.js";
import { Liquid } from "../world/surfaces.js";
import { evaluate } from "../narrative/rules.js";

const BURN_DPS = 6;

/** Pushes actors out of solid props and NPCs. */
function propCollisions(g: Game): void {
  const solids: { pos: Vec; r: number }[] = [];
  for (const pr of g.props) if (!pr.dead && pr.def.solid) solids.push({ pos: pr.pos, r: pr.def.radius });
  for (const n of g.npcs) solids.push({ pos: n.pos, r: 9 });
  const push = (a: Actor) => {
    for (const s of solids) {
      const dx = a.pos.x - s.pos.x;
      const dy = a.pos.y - s.pos.y;
      const d = Math.hypot(dx, dy);
      const min = a.radius + s.r;
      if (d >= min || d === 0) continue;
      g.map.move(a.pos, a.radius, (dx / d) * (min - d), (dy / d) * (min - d));
    }
  };
  push(g.player);
  for (const e of g.enemies) push(e);
}

export function updateSimulation(g: Game, dt: number): void {
  const p = g.player;
  propCollisions(g);
  surfaceContact(g, p, dt);
  for (const e of g.enemies) if (!e.dead) surfaceContact(g, e, dt);

  edictRules(g, dt);
  updateFray(g, dt);
  updateEchoes(g, dt);
  updatePickups(g, dt);
  updateZone(g);
  for (const n of g.npcs) {
    n.barkT -= dt;
    if (n.barkT <= 0 && dist(n.pos, p.pos) < 160) {
      const lines = (n.def.barks ?? []).filter((b) => typeof b === "string" || evaluate(b.if, g)).map((b) => (typeof b === "string" ? b : b.text));
      if (lines.length) g.fx.bark(n.pos, lines[Math.floor(Math.random() * lines.length)]);
      n.barkT = 9 + Math.random() * 8;
    }
    if (dist(n.pos, p.pos) < 120) n.facing = Math.atan2(p.pos.y - n.pos.y, p.pos.x - n.pos.x);
  }
}

const burnAcc = new WeakMap<Actor, number>();

function surfaceContact(g: Game, a: Actor, dt: number): void {
  const [cx, cy] = g.map.cellAt(a.pos);
  const isPlayer = a === g.player;
  const dodging = isPlayer && g.player.action.kind === "dodge";
  const liquid = g.surfaces.getLiquid(cx, cy);
  if (g.surfaces.isBurning(cx, cy) && !(isPlayer && g.hasPerk("ashwalker"))) {
    if (!a.statuses.burning) g.applyStatusTo(a, "burning");
    else a.statuses.burning = Math.max(a.statuses.burning, 1.5);
  }
  if (!dodging) {
    if (liquid === Liquid.Water) {
      if (!a.statuses.wet) g.applyStatusTo(a, "wet");
      else a.statuses.wet = Math.max(a.statuses.wet, 2);
    } else if (liquid === Liquid.Oil && !a.statuses.oiled && !a.statuses.burning) g.applyStatusTo(a, "oiled");
    else if (liquid === Liquid.Ink && !("def" in a && (a as Enemy).def.immune?.includes("inked"))) {
      if (!a.statuses.inked) g.applyStatusTo(a, "inked");
      else a.statuses.inked = Math.max(a.statuses.inked, 1);
    }
  }
  // a burning creature ignites the oil it runs through
  if (a.statuses.burning && (liquid === Liquid.Oil || liquid === Liquid.Ink)) g.surfaces.ignite(cx, cy);

  tickStatuses(a.statuses, dt);
  if (a.statuses.burning) {
    const edict = g.edictAt(a.pos);
    const acc = (burnAcc.get(a) ?? 0) + BURN_DPS * (edict.fireDamage ?? 1) * dt;
    if (acc >= 3) {
      const dmg = Math.floor(acc);
      burnAcc.set(a, acc - dmg);
      if (isPlayer) damagePlayer(g, dmg, "fire", "burning");
      else {
        const e = a as Enemy;
        damageEnemy(g, e, dmg * (1 - (e.def.resist?.fire ?? 0)), "fire", { byPlayer: e.lastHitByPlayer, poise: 0 });
      }
    } else burnAcc.set(a, acc);
    if (Math.random() < dt * 14) g.fx.ember(a.pos);
  }
}

function edictRules(g: Game, dt: number): void {
  const p = g.player;
  const edict = g.edictAt(p.pos);
  if (edict.regen && p.hp < p.maxHp) {
    p.regenAcc += edict.regen * (edict.healing ?? 1) * dt;
    if (p.regenAcc >= 1) {
      const n = Math.floor(p.regenAcc);
      p.regenAcc -= n;
      p.hp = Math.min(p.maxHp, p.hp + n);
    }
  }
  // ember slowly gathers; much faster near a hearth
  p.emberRegen += dt / (edict.sanctuary ? 3 : 14);
  if (p.emberRegen >= 1) {
    p.emberRegen -= 1;
    g.addEmber(1);
  }
}

function updateFray(g: Game, dt: number): void {
  const p = g.player;
  const edict = g.edictAt(p.pos);
  p.fray = Math.max(0, p.fray - (edict.frayDecay ?? 1) * dt);
  if (p.fray >= 100) rupture(g);
}

/**
 * Blank Rupture: the price of pushing unwritten magic too far. Reality around
 * the player loses its law for a moment, with one of several consequences.
 */
export function rupture(g: Game): void {
  const p = g.player;
  p.fray = 40;
  const zone = g.zoneAt(p.pos)?.id ?? "";
  const roll = g.rng.int(0, 2);
  g.fx.rupture(p.pos);
  g.fx.shake(12);
  let kind = "";
  if (roll === 0) {
    kind = "echo_breach";
    const def = g.content.enemies.hollow_echo;
    for (let i = 0; i < 2; i++) {
      const a = g.rng.range(0, Math.PI * 2);
      const pos = { x: p.pos.x + Math.cos(a) * 90, y: p.pos.y + Math.sin(a) * 90 };
      if (!g.map.overlaps(pos, def.radius)) {
        const e = createEnemy(def, pos, "", zone);
        e.awareOfPlayer = true;
        e.target = 0;
        e.ai = "chase";
        g.enemies.push(e);
      }
    }
    g.toast("BLANK RUPTURE — unwritten things tear through the gap.");
  } else if (roll === 1) {
    kind = "kindling";
    const [cx, cy] = g.map.cellAt(p.pos);
    for (let i = 0; i < 10; i++) {
      const x = cx + g.rng.int(-5, 5);
      const y = cy + g.rng.int(-5, 5);
      if (Math.abs(x - cx) + Math.abs(y - cy) > 1) g.surfaces.splash(x, y, 0.7, Liquid.Oil);
    }
    g.toast("BLANK RUPTURE — the ground weeps oil.");
  } else {
    kind = "stillness";
    for (const e of g.enemies) if (dist(e.pos, p.pos) < 220) g.applyStatusTo(e, "chilled", 4);
    g.applyStatusTo(p, "chilled", 3);
    const [cx, cy] = g.map.cellAt(p.pos);
    g.surfaces.applyElementArea(cx, cy, 4, "frost");
    g.toast("BLANK RUPTURE — time stutters. Everything near you slows, you included.");
  }
  g.bus.emit("RealityShifted", { kind, zone });
}

function updateEchoes(g: Game, dt: number): void {
  for (const ec of g.echoes) {
    if (ec.dead) continue;
    ec.life -= dt;
    if (ec.life <= 0) {
      ec.dead = true;
      continue;
    }
    if (ec.rise !== Infinity) {
      const near = dist(ec.pos, g.player.pos) < 70 && g.hasPerk("return_knowing");
      if (!near) ec.rise -= dt;
      if (ec.rise <= 0) riseEcho(g, ec.pos, ec.enemyId, ec.zone, ec);
    }
  }
}

function riseEcho(g: Game, pos: Vec, enemyId: string, zone: string, ec: { dead: boolean }): void {
  ec.dead = true;
  const base = g.content.enemies[enemyId];
  const def = base?.risesAs ? g.content.enemies[base.risesAs] : undefined;
  if (!def) return;
  const e = createEnemy(def, pos, "", zone);
  e.risen = true;
  g.enemies.push(e);
  g.fx.rise(pos);
  g.fx.text(pos, "it rises", "#c9b8ff");
  g.bus.emit("EchoRisen", { enemyId: def.id, zone });
}

function updatePickups(g: Game, dt: number): void {
  for (const pk of g.pickups) {
    if (pk.dead) continue;
    pk.t += dt;
    const d = dist(pk.pos, g.player.pos);
    if (pk.t > 0.5 && d < 60) {
      // gentle magnet
      pk.pos.x += ((g.player.pos.x - pk.pos.x) / d) * Math.min(d, 220 * dt);
      pk.pos.y += ((g.player.pos.y - pk.pos.y) / d) * Math.min(d, 220 * dt);
    }
    if (pk.t > 0.5 && d < 16) {
      if (g.acquire(pk.item, pk.count, pk.affixes)) pk.dead = true;
      else pk.t = -2;
    }
  }
}

function updateZone(g: Game): void {
  const z = g.zoneAt(g.player.pos);
  if (z?.id === g.currentZone?.id) return;
  g.currentZone = z;
  if (!z) return;
  const first = !g.world.discovered.has(z.id);
  if (first) {
    g.world.discovered.add(z.id);
    if (z.discoverXp) g.giveXp(z.discoverXp);
  }
  g.bus.emit("AreaEntered", { zone: z.id, edict: z.edict, first });
}
