// Combat resolution between actors, props and breakable terrain.
import { angleDiff, angleTo, dist, type Vec } from "../core/math.js";
import type { AttackDef, Element, StatusId } from "../data/types.js";
import type { HitInfo } from "../effects/perks.js";
import type { Actor, Enemy, Prop } from "../entities/entities.js";
import { newId } from "../entities/entities.js";
import { weaponStats } from "../entities/player.js";
import type { Game } from "../game.js";
import { LIQUID_BY_NAME } from "../world/surfaces.js";
import { computeDamage } from "./damage.js";

export function playerMelee(g: Game, heavy: boolean, angle: number, combo: number): void {
  const p = g.player;
  const ws = weaponStats(g);
  const arc = ws.arc + (combo === 3 ? 0.6 : 0) + (heavy ? 0.3 : 0);
  const reach = ws.reach + (heavy ? 8 : 0);
  let base = ws.damage * (heavy ? ws.heavyMult : 1) * (combo === 3 ? 1.5 : 1);
  let hitAny = false;

  g.fx.swing(p.pos, angle, reach, arc, heavy, ws.element);
  g.bus.emit("Noise", { x: p.pos.x, y: p.pos.y, radius: heavy ? 150 : 100, source: "melee" });

  for (const e of g.enemies) {
    if (e.dead) continue;
    const d = dist(p.pos, e.pos) - e.radius;
    if (d > reach) continue;
    if (Math.abs(angleDiff(angle, angleTo(p.pos, e.pos))) > arc / 2 && d > 8) continue;
    if (!g.map.lineClear(p.pos, e.pos)) continue;
    const fromBehind = Math.abs(angleDiff(e.facing, angleTo(e.pos, p.pos))) > (2 * Math.PI) / 3;
    const info: HitInfo = { target: e, heavy, element: ws.element, fromBehind, melee: true };
    let mult = 1;
    let crit = g.rng.chance(0.03 * g.progress.attributes.finesse);
    if (p.critReady > 0) {
      crit = true;
      p.critReady = 0;
    }
    for (const pk of g.perks()) {
      if (pk.damageMult) mult *= pk.damageMult(g, info);
      if (pk.crit?.(g, info)) crit = true;
    }
    const res = computeDamage({ base, element: ws.element, resist: e.def.resist, targetStatuses: e.statuses, multiplier: mult, heavy, crit });
    const knock = heavy ? (g.hasPerk("heavy_hand") ? 420 : 240) : 90;
    damageEnemy(g, e, res.amount, ws.element, { byPlayer: true, from: p.pos, knock, poise: heavy ? res.amount * 1.6 : res.amount, crit: res.crit, forceStagger: heavy && g.hasPerk("heavy_hand") });
    if (res.shattered) g.shatter(e);
    for (const pk of g.perks()) pk.onHit?.(g, info);
    hitAny = true;
  }

  // props (barrels, crates)
  for (const pr of g.props) {
    if (pr.dead || !pr.def.health) continue;
    const d = dist(p.pos, pr.pos) - pr.def.radius;
    if (d > reach || Math.abs(angleDiff(angle, angleTo(p.pos, pr.pos))) > arc / 2) continue;
    damageProp(g, pr, heavy ? 2 : 1);
    hitAny = true;
  }

  // breakable terrain (cracked walls) needs a heavy blow
  if (heavy) {
    for (const r of [reach * 0.6, reach]) {
      const pt = { x: p.pos.x + Math.cos(angle) * r, y: p.pos.y + Math.sin(angle) * r };
      const [cx, cy] = g.map.cellAt(pt);
      if (breakTile(g, cx, cy)) {
        hitAny = true;
        break;
      }
    }
  } else {
    const pt = { x: p.pos.x + Math.cos(angle) * reach, y: p.pos.y + Math.sin(angle) * reach };
    const [cx, cy] = g.map.cellAt(pt);
    const t = g.map.def(cx, cy);
    if (t?.breakable) g.fx.text(pt, "It cracks... a heavier blow?", "#bbb");
  }

  if (hitAny) {
    g.hitstop = heavy ? 0.085 : 0.045;
    g.fx.shake(heavy ? 6 : 2.5);
  }
  if (ws.element === "fire" && heavy) g.elementAt({ x: p.pos.x + Math.cos(angle) * reach * 0.7, y: p.pos.y + Math.sin(angle) * reach * 0.7 }, "fire", 0.5);
}

export function breakTile(g: Game, cx: number, cy: number): boolean {
  const t = g.map.def(cx, cy);
  if (!t?.breakable) return false;
  g.map.set(cx, cy, t.breakable.into);
  g.world.brokenTiles.push([cx, cy]);
  if (t.breakable.flag) g.world.set(t.breakable.flag, true);
  const pos = { x: (cx + 0.5) * g.map.ts, y: (cy + 0.5) * g.map.ts };
  g.fx.debris(pos, "#8d8478");
  g.fx.shake(8);
  g.bus.emit("TileBroken", { tile: t.id, x: cx, y: cy, zone: g.zoneAtCell(cx, cy)?.id ?? "" });
  g.bus.emit("Noise", { x: pos.x, y: pos.y, radius: 260, source: "rubble" });
  g.mapDirty = true;
  return true;
}

export function damageProp(g: Game, pr: Prop, amount: number): void {
  pr.hp -= amount;
  g.fx.debris(pr.pos, "#6b4b2a");
  if (pr.hp > 0) return;
  pr.dead = true;
  g.world.removedSpawns.add(pr.spawnId);
  const b = pr.def.onBreak;
  if (b?.liquid) {
    const [cx, cy] = g.map.cellAt(pr.pos);
    g.surfaces.splash(cx, cy, b.radius ?? 1.5, LIQUID_BY_NAME[b.liquid]);
  }
  if (b?.loot) g.dropLoot(b.loot, pr.pos);
  g.bus.emit("PropBroken", { propId: pr.def.id, spawnId: pr.spawnId, zone: g.zoneAt(pr.pos)?.id ?? "" });
}

export interface DamageOpts {
  byPlayer: boolean;
  from?: Vec;
  knock?: number;
  poise?: number;
  crit?: boolean;
  forceStagger?: boolean;
  attackerId?: number;
  silent?: boolean;
}

export function damageEnemy(g: Game, e: Enemy, amount: number, element: Element, o: DamageOpts): void {
  if (e.dead || amount <= 0) return;
  e.hp -= amount;
  e.hitFlash = 0.12;
  e.lastHitByPlayer = o.byPlayer || (e.lastHitByPlayer && element === "fire");
  e.lastElement = element;
  if (o.from && o.knock) {
    const a = angleTo(o.from, e.pos);
    const k = o.knock / Math.max(0.6, e.def.radius / 12);
    e.kb.x += Math.cos(a) * k;
    e.kb.y += Math.sin(a) * k;
  }
  e.poiseLeft -= o.poise ?? amount;
  if (e.poiseLeft <= 0 || o.forceStagger) {
    e.poiseLeft = e.def.poise;
    e.stagger = e.boss ? 0.35 : 0.5;
    e.attack = undefined;
    e.ai = "stagger";
  }
  if (!o.silent) g.fx.damage(e.pos, amount, element, !!o.crit);
  g.bus.emit("EnemyDamaged", { enemyId: e.def.id, amount, element, byPlayer: o.byPlayer });
  if (o.byPlayer) {
    e.target = 0;
    e.awareOfPlayer = true;
    e.lastSeen = { ...g.player.pos };
  } else if (o.attackerId !== undefined && o.attackerId !== e.id) {
    e.target = o.attackerId;
  }
  if (e.hp <= 0) killEnemy(g, e);
}

export function killEnemy(g: Game, e: Enemy): void {
  if (e.dead) return;
  e.dead = true;
  const byPlayer = e.lastHitByPlayer;
  if (e.spawnId) g.world.removedSpawns.add(e.spawnId);
  g.fx.death(e.pos, e.def.visual.color, e.def.visual.accent);
  if (byPlayer) {
    g.giveXp(e.def.xp);
    g.perks().forEach((p) => p.onKill?.(g, e));
  }
  if (e.def.loot) g.dropLoot(e.def.loot, e.pos, g.perkProduct("lootChanceMult"));
  if (e.def.behavior !== "echo") {
    const edict = g.edictAt(e.pos);
    const canRise = !!edict.deadRise && !!e.def.risesAs && !e.risen;
    g.echoes.push({
      id: newId(),
      pos: { ...e.pos },
      enemyId: e.def.id,
      zone: e.zone,
      life: 25 * g.perkProduct("echoLifeMult"),
      rise: canRise ? 6 : Infinity,
      dead: false,
    });
  }
  g.bus.emit("EnemyKilled", { enemyId: e.def.id, spawnId: e.spawnId, zone: g.zoneAt(e.pos)?.id ?? "", byPlayer, element: e.lastElement, x: e.pos.x, y: e.pos.y });
  g.bus.emit("Noise", { x: e.pos.x, y: e.pos.y, radius: 220, source: "death" });
  if (e.boss) g.bus.emit("Toast", { text: `${e.def.name} has fallen.`, kind: "boss" });
}

export function damagePlayer(g: Game, amount: number, element: Element, source: string, attacker?: Enemy): void {
  const p = g.player;
  if (g.dead || amount <= 0) return;
  if (p.invuln > 0) {
    if (p.action.kind === "dodge" && attacker) {
      g.bus.emit("PerfectDodge", { attackerId: attacker.def.id });
      g.perks().forEach((pk) => pk.onPerfectDodge?.(g));
      g.fx.text(p.pos, "Perfect dodge", "#e8e2ff");
      p.invuln = 0; // one perfect dodge per roll
    }
    return;
  }
  let resist = 0;
  for (const s of ["coat", "charm"] as const) resist += g.inventory.equippedItem(s)?.def.resist?.[element] ?? 0;
  const res = computeDamage({ base: amount, element, resist: { [element]: Math.min(0.75, resist) }, targetStatuses: p.statuses });
  p.hp -= res.amount;
  p.hitFlash = 0.18;
  g.fx.damage(p.pos, res.amount, element, false, true);
  g.fx.shake(Math.min(10, 3 + res.amount / 4));
  if (attacker && res.amount >= 14) {
    p.stagger = 0.25;
    if (p.action.kind !== "dodge") p.action = { kind: "idle" };
    const a = angleTo(attacker.pos, p.pos);
    p.kb.x += Math.cos(a) * 220;
    p.kb.y += Math.sin(a) * 220;
  }
  g.bus.emit("PlayerDamaged", { amount: res.amount, element, source });
  if (p.hp <= 0) {
    p.hp = 0;
    p.dead = true;
    g.dead = true;
    g.bus.emit("PlayerDied", { zone: g.currentZone?.id ?? "" });
    g.ui?.showDeath();
  }
}

/** Generic area hit used by slams, explosions and shatter. Hits everything hostile to `faction`. */
export function areaHit(g: Game, at: Vec, radius: number, dmg: number, element: Element, faction: string, byPlayer: boolean, applies: StatusId[] = [], attacker?: Enemy): void {
  if (g.hostile(faction, g.player.faction) && dist(at, g.player.pos) < radius + g.player.radius) {
    damagePlayer(g, dmg, element, attacker?.def.id ?? "area", attacker);
    applies.forEach((s) => g.applyStatusTo(g.player, s));
  }
  for (const e of g.enemies) {
    if (e.dead || e === attacker || !g.hostile(faction, e.faction)) continue;
    if (dist(at, e.pos) > radius + e.radius) continue;
    damageEnemy(g, e, dmg, element, { byPlayer, from: at, knock: 160, attackerId: attacker?.id });
    applies.forEach((s) => g.applyStatusTo(e, s));
  }
}

export function shatter(g: Game, e: Enemy): void {
  delete e.statuses.frozen;
  g.fx.shatter(e.pos);
  g.fx.text(e.pos, "SHATTER", "#d9f4ff");
  areaHit(g, e.pos, 70, 18 + g.progress.attributes.might * 3, "frost", g.player.faction, true, ["chilled"]);
  g.bus.emit("SurfaceReacted", { reaction: "shatter", zone: g.zoneAt(e.pos)?.id ?? "", x: e.pos.x, y: e.pos.y });
}

/** Resolves an enemy's attack at its hit frame. */
export function enemyStrike(g: Game, e: Enemy, atk: AttackDef, angle: number, origin: Vec): void {
  const hitTargets: Actor[] = [];
  const consider = (a: Actor) => {
    if (a.dead || a === e) return;
    if (a !== g.player && !g.hostile(e.faction, a.faction)) return;
    if (a === g.player && !g.hostile(e.faction, g.player.faction)) return;
    const d = dist(origin, a.pos) - a.radius;
    if (atk.kind === "slam") {
      if (d <= (atk.radius ?? 50)) hitTargets.push(a);
    } else {
      const arc = ((atk.arc ?? 90) * Math.PI) / 180;
      if (d <= atk.range && (Math.abs(angleDiff(angle, angleTo(origin, a.pos))) <= arc / 2 || d < 6)) hitTargets.push(a);
    }
  };
  consider(g.player);
  for (const o of g.enemies) consider(o);
  for (const t of hitTargets) {
    const dmg = atk.damage;
    if (t === g.player) {
      damagePlayer(g, dmg, atk.element ?? "physical", e.def.id, e);
      if (g.player.invuln <= 0) atk.applies?.forEach((s) => g.applyStatusTo(g.player, s));
    } else {
      damageEnemy(g, t as Enemy, dmg, atk.element ?? "physical", { byPlayer: false, from: e.pos, knock: 150, attackerId: e.id });
      atk.applies?.forEach((s) => g.applyStatusTo(t, s));
    }
  }
  if (atk.kind === "slam") {
    g.fx.slam(origin, atk.radius ?? 50);
    g.fx.shake(5);
    if (atk.element === "fire") g.igniteAt(origin, 1.2);
    if (atk.leaves) g.surfaces.splash(...g.map.cellAt(origin), 1.2, LIQUID_BY_NAME[atk.leaves]);
  }
}
