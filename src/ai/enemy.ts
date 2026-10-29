// Enemy AI: a small state machine shared by all creatures. Archetypes
// (lunger, brute, spitter, boss, echo) differ in how they move and engage;
// attacks, stats and visuals come from data.
import { angleDiff, angleTo, dist, norm, type Vec } from "../core/math.js";
import type { AttackDef, EnemyDef } from "../data/types.js";
import { statusSpeed } from "../combat/damage.js";
import { enemyStrike, damagePlayer, damageEnemy } from "../combat/combat.js";
import { newId, type Actor, type Enemy } from "../entities/entities.js";
import type { Game } from "../game.js";
import type { GameEvents } from "../core/events.js";
import { evaluate } from "../narrative/rules.js";

export function createEnemy(def: EnemyDef, pos: Vec, spawnId: string, zone: string): Enemy {
  return {
    id: newId(),
    pos: { ...pos },
    kb: { x: 0, y: 0 },
    radius: def.radius,
    hp: def.health,
    maxHp: def.health,
    statuses: {},
    faction: def.faction,
    facing: Math.random() * Math.PI * 2,
    hitFlash: 0,
    stagger: 0,
    dead: false,
    def,
    spawnId,
    zone,
    home: { ...pos },
    ai: "wander",
    aiT: Math.random() * 2,
    cooldowns: {},
    poiseLeft: def.poise,
    strafe: Math.random() < 0.5 ? 1 : -1,
    risen: false,
    panic: 0,
    boss: !!def.boss,
    lastHitByPlayer: false,
    lastElement: "physical",
    awareOfPlayer: false,
  };
}

export function onNoise(g: Game, n: GameEvents["Noise"]): void {
  for (const e of g.enemies) {
    if (e.dead || (e.ai !== "idle" && e.ai !== "wander" && e.ai !== "return")) continue;
    if (dist(e.pos, n) > n.radius) continue;
    e.ai = "investigate";
    e.goal = { x: n.x, y: n.y };
    e.aiT = 6;
  }
}

/** Is `a` visible to `e`? Steam hides anything more than a step away. */
function canSee(g: Game, e: Enemy, a: Actor): boolean {
  const d = dist(e.pos, a.pos);
  if (d > e.def.sight) return false;
  if (d > 40 && g.surfaces.hasSteam(...g.map.cellAt(a.pos))) return false;
  return g.map.lineClear(e.pos, a.pos);
}

function pickTarget(g: Game, e: Enemy): Actor | undefined {
  let best: Actor | undefined;
  let bestD = Infinity;
  const pl = g.player;
  if (!pl.dead && g.hostile(e.faction, pl.faction) && !g.edictAt(pl.pos).sanctuary && canSee(g, e, pl)) {
    best = pl;
    bestD = dist(e.pos, pl.pos) * (e.awareOfPlayer ? 0.6 : 1);
  }
  for (const o of g.enemies) {
    if (o === e || o.dead || !g.hostile(e.faction, o.faction)) continue;
    const d = dist(e.pos, o.pos);
    if (d < bestD && canSee(g, e, o)) {
      best = o;
      bestD = d;
    }
  }
  return best;
}

export function updateEnemy(g: Game, e: Enemy, dt: number): void {
  e.hitFlash = Math.max(0, e.hitFlash - dt);
  for (const k in e.cooldowns) e.cooldowns[k] = Math.max(0, e.cooldowns[k] - dt);
  e.aiT -= dt;

  // knockback
  if (Math.abs(e.kb.x) + Math.abs(e.kb.y) > 1) {
    g.map.move(e.pos, e.radius, e.kb.x * dt, e.kb.y * dt);
    const f = Math.exp(-dt * 9);
    e.kb.x *= f;
    e.kb.y *= f;
  }

  if (e.def.departsWhen && evaluate(e.def.departsWhen, g)) return depart(g, e);

  const sm = statusSpeed(e.statuses);
  if (e.stagger > 0) {
    e.stagger -= dt;
    if (e.stagger <= 0) e.ai = "chase";
    return;
  }
  if (sm <= 0) return; // frozen / stunned

  // burning hounds panic and run
  if (e.def.behavior === "lunger" && e.statuses.burning && !e.attack) {
    e.panic = 0.6;
  }
  if (e.panic > 0) {
    e.panic -= dt;
    const threat = g.player.pos;
    const away = norm({ x: e.pos.x - threat.x, y: e.pos.y - threat.y });
    steer(g, e, { x: e.pos.x + away.x * 100, y: e.pos.y + away.y * 100 }, e.def.speed * 1.1 * sm, dt);
    return;
  }

  if (e.attack) return runAttack(g, e, dt, sm);

  // perception (cheap enough every frame for a few dozen creatures)
  const target = e.target !== undefined ? g.actorById(e.target) : undefined;
  let tgt = target && !target.dead && canSee(g, e, target) ? target : undefined;
  if (!tgt) {
    const seen = pickTarget(g, e);
    if (seen) {
      tgt = seen;
      if (seen === g.player && !e.awareOfPlayer) {
        e.awareOfPlayer = true;
        g.fx.alert(e.pos);
        if (e.def.pack) alertPack(g, e);
      }
      e.target = seen.id;
    }
  }
  if (tgt) {
    e.lastSeen = { ...tgt.pos };
    e.aiT = 3;
    if (e.ai !== "chase") e.ai = "chase";
  } else if (e.ai === "chase") {
    // lost sight: search last known position
    e.ai = "investigate";
    e.goal = e.lastSeen ?? e.home;
    e.aiT = 4;
    e.target = undefined;
  }

  switch (e.ai) {
    case "chase":
      if (tgt) engage(g, e, tgt, dt, sm);
      break;
    case "investigate": {
      const goal = e.goal ?? e.home;
      if (dist(e.pos, goal) > 12) steer(g, e, goal, e.def.speed * 0.7 * sm, dt);
      if (e.aiT <= 0) e.ai = "return";
      break;
    }
    case "return":
      e.awareOfPlayer = false;
      steer(g, e, e.home, e.def.speed * 0.6 * sm, dt);
      if (dist(e.pos, e.home) < 20) e.ai = "wander";
      break;
    case "scavenge": {
      const echo = g.echoes.find((x) => !x.dead && x.id === e.target);
      if (!echo) {
        e.ai = "wander";
        e.target = undefined;
        break;
      }
      steer(g, e, echo.pos, e.def.speed * 0.8 * sm, dt);
      if (dist(e.pos, echo.pos) < e.radius + 8) {
        echo.dead = true;
        e.hp = Math.min(e.maxHp * 1.25, e.hp + 15);
        e.maxHp = Math.max(e.maxHp, e.hp);
        g.fx.text(e.pos, "devours the echo", "#b9a4ff");
        g.bus.emit("EchoEaten", { enemyId: echo.enemyId, byId: e.def.id });
        e.ai = "wander";
        e.target = undefined;
      }
      break;
    }
    case "idle":
    case "wander":
    default: {
      if (e.def.scavenger) {
        const echo = g.echoes.find((x) => !x.dead && dist(x.pos, e.pos) < e.def.sight * 1.4 && g.map.lineClear(e.pos, x.pos));
        if (echo) {
          e.ai = "scavenge";
          e.target = echo.id;
          break;
        }
      }
      if (e.aiT <= 0 || !e.goal) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * 70;
        e.goal = { x: e.home.x + Math.cos(a) * r, y: e.home.y + Math.sin(a) * r };
        e.aiT = 2 + Math.random() * 3;
      }
      if (dist(e.pos, e.goal) > 8) steer(g, e, e.goal, e.def.speed * 0.35 * sm, dt);
    }
  }
}

function alertPack(g: Game, e: Enemy): void {
  for (const o of g.enemies) {
    if (o === e || o.dead || o.def.id !== e.def.id || dist(o.pos, e.pos) > 300) continue;
    o.awareOfPlayer = true;
    o.target = 0;
    o.ai = "chase";
    o.lastSeen = { ...g.player.pos };
  }
  g.fx.text(e.pos, "howls", "#e0c080");
}

function engage(g: Game, e: Enemy, t: Actor, dt: number, sm: number): void {
  const d = dist(e.pos, t.pos);
  const ang = angleTo(e.pos, t.pos);
  e.facing = turn(e.facing, ang, dt * 8);
  // leash: don't chase the player across the whole map
  if (dist(e.pos, e.home) > 520 && t === g.player && !e.boss) {
    e.ai = "return";
    e.target = undefined;
    return;
  }
  const atk = chooseAttack(e, d);
  if (atk && Math.abs(angleDiff(e.facing, ang)) < 0.6 && g.map.lineClear(e.pos, t.pos)) {
    startAttack(g, e, atk, ang);
    return;
  }
  const b = e.def.behavior;
  const speed = e.def.speed * sm;
  if (b === "spitter" || (b === "boss" && e.hp < e.maxHp * 0.5 && d < 90)) {
    // keep distance
    const ideal = 150;
    if (d < ideal * 0.7) steer(g, e, { x: e.pos.x - Math.cos(ang) * 60, y: e.pos.y - Math.sin(ang) * 60 }, speed, dt);
    else if (d > ideal) steer(g, e, t.pos, speed * 0.8, dt);
    else strafe(g, e, t, speed * 0.6, dt);
  } else if (b === "lunger" && d < 120 && d > 60) {
    strafe(g, e, t, speed * 0.9, dt);
    if (Math.random() < dt * 0.6) e.strafe *= -1;
    // creep closer while circling
    steer(g, e, t.pos, speed * 0.3, dt);
  } else {
    steer(g, e, t.pos, speed, dt);
  }
}

function chooseAttack(e: Enemy, d: number): AttackDef | undefined {
  let best: AttackDef | undefined;
  for (const a of e.def.attacks) {
    if ((e.cooldowns[a.id] ?? 0) > 0) continue;
    const r = a.kind === "slam" ? (a.radius ?? 50) * 0.8 : a.range;
    if (d - e.radius > r) continue;
    if (a.kind === "projectile" && d < 50 && e.def.attacks.length > 1) continue;
    if (!best || a.damage > best.damage) best = a;
  }
  return best;
}

function startAttack(g: Game, e: Enemy, atk: AttackDef, ang: number): void {
  e.attack = { def: atk, t: 0, angle: ang, origin: { ...e.pos }, done: false };
  e.ai = "attack";
  if (e.boss || atk.windup > 0.6) g.fx.text(e.pos, "!", "#ff5a4a");
}

function runAttack(g: Game, e: Enemy, dt: number, sm: number): void {
  const at = e.attack!;
  const atk = at.def;
  at.t += dt * Math.min(1, sm + 0.3);
  const target = g.actorById(e.target);
  // track the target during the first part of the windup
  if (!at.done && target && at.t < atk.windup * 0.65) {
    at.angle = turn(at.angle, angleTo(e.pos, target.pos), dt * (atk.kind === "lunge" ? 6 : 3));
    e.facing = at.angle;
  }
  if (!at.done && at.t >= atk.windup) {
    at.done = true;
    if (atk.kind === "lunge") {
      at.dashing = true;
    } else if (atk.kind === "projectile") {
      const dir = { x: Math.cos(at.angle), y: Math.sin(at.angle) };
      g.projectiles.push({
        id: newId(),
        pos: { x: e.pos.x + dir.x * e.radius, y: e.pos.y + dir.y * e.radius },
        vel: { x: dir.x * (atk.speed ?? 220), y: dir.y * (atk.speed ?? 220) },
        radius: 6,
        life: atk.range / (atk.speed ?? 220) + 0.1,
        damage: atk.damage,
        element: atk.element ?? "physical",
        fromPlayer: false,
        faction: e.faction,
        applies: atk.applies ?? [],
        leaves: atk.leaves,
        splash: 1,
        visual: atk.element === "ink" ? "ink" : "bolt",
        color: atk.element === "ink" ? "#6b3fa0" : "#ff7a3c",
        dead: false,
      });
    } else {
      at.origin = atk.kind === "slam" ? { ...e.pos } : at.origin;
      enemyStrike(g, e, atk, at.angle, atk.kind === "slam" ? e.pos : e.pos);
    }
  }
  if (at.dashing) {
    const dashT = at.t - atk.windup;
    const dur = atk.range / (atk.speed ?? 400);
    if (dashT < dur) {
      const sp = atk.speed ?? 400;
      g.map.move(e.pos, e.radius, Math.cos(at.angle) * sp * dt, Math.sin(at.angle) * sp * dt);
      // contact damage once
      const victims: Actor[] = [g.player, ...g.enemies];
      for (const v of victims) {
        if (v === e || v.dead || !g.hostile(e.faction, v.faction)) continue;
        if (dist(v.pos, e.pos) < v.radius + e.radius + 4) {
          at.dashing = false;
          if (v === g.player) {
            damagePlayer(g, atk.damage, atk.element ?? "physical", e.def.id, e);
            if (g.player.invuln <= 0) atk.applies?.forEach((s) => g.applyStatusTo(g.player, s));
          } else damageEnemy(g, v as Enemy, atk.damage, atk.element ?? "physical", { byPlayer: false, from: e.pos, knock: 160, attackerId: e.id });
          break;
        }
      }
    } else at.dashing = false;
  }
  if (at.t >= atk.windup + atk.recover + (atk.kind === "lunge" ? atk.range / (atk.speed ?? 400) : 0)) {
    e.cooldowns[atk.id] = atk.cooldown;
    e.attack = undefined;
    e.ai = "chase";
  }
}

function depart(g: Game, e: Enemy): void {
  e.dead = true;
  if (e.spawnId) g.world.removedSpawns.add(e.spawnId);
  g.fx.death(e.pos, e.def.visual.color, e.def.visual.accent);
  if (e.def.departText) g.toast(e.def.departText);
}

function turn(cur: number, target: number, maxStep: number): number {
  const d = angleDiff(cur, target);
  return cur + Math.max(-maxStep, Math.min(maxStep, d));
}

function strafe(g: Game, e: Enemy, t: Actor, speed: number, dt: number): void {
  const ang = angleTo(t.pos, e.pos) + e.strafe * 0.9;
  const d = dist(t.pos, e.pos);
  steer(g, e, { x: t.pos.x + Math.cos(ang) * d, y: t.pos.y + Math.sin(ang) * d }, speed, dt);
}

/** Moves toward a point, avoiding sanctuary ground and fire, sliding around walls. */
function steer(g: Game, e: Enemy, goal: Vec, speed: number, dt: number): void {
  const dir = norm({ x: goal.x - e.pos.x, y: goal.y - e.pos.y });
  if (dir.x === 0 && dir.y === 0) return;
  // separation from other creatures
  for (const o of g.enemies) {
    if (o === e || o.dead) continue;
    const dx = e.pos.x - o.pos.x;
    const dy = e.pos.y - o.pos.y;
    const dd = Math.hypot(dx, dy);
    const min = e.radius + o.radius + 4;
    if (dd > 0 && dd < min) {
      dir.x += (dx / dd) * 0.8;
      dir.y += (dy / dd) * 0.8;
    }
  }
  const fearsFire = !(e.def.immune ?? []).includes("burning");
  const blocked = (cx: number, cy: number) => g.edictAtCell(cx, cy).sanctuary === true || (fearsFire && g.surfaces.isBurning(cx, cy) && !g.surfaces.isBurning(...g.map.cellAt(e.pos)));
  const n = norm(dir);
  const tile = g.map.def(...g.map.cellAt(e.pos));
  const sp = speed * (tile?.slow ?? 1) * dt;
  const before = { ...e.pos };
  g.map.move(e.pos, e.radius, n.x * sp, n.y * sp, blocked);
  const moved = Math.hypot(e.pos.x - before.x, e.pos.y - before.y);
  if (moved < sp * 0.3) {
    // blocked: try sidestepping
    for (const off of [0.9, -0.9, 1.6, -1.6]) {
      const a = Math.atan2(n.y, n.x) + off * e.strafe;
      g.map.move(e.pos, e.radius, Math.cos(a) * sp, Math.sin(a) * sp, blocked);
      if (Math.hypot(e.pos.x - before.x, e.pos.y - before.y) > sp * 0.3) break;
    }
  }
  if (e.ai !== "attack") e.facing = turn(e.facing, Math.atan2(n.y, n.x), dt * 6);
}
