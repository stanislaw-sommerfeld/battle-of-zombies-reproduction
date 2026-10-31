// Player controller: movement, stamina, light/heavy combos, dodge, spells, flasks.
import { angleTo, clamp, norm, type Vec } from "../core/math.js";
import { statusSpeed } from "../combat/damage.js";
import { playerMelee } from "../combat/combat.js";
import type { Game } from "../game.js";
import { PLAYER_FACTION } from "../game.js";
import { applyEffects } from "../narrative/rules.js";
import { newId, type Player } from "./entities.js";
import { t } from "../i18n/i18n.js";
import { actionKey, SPELL_ACTION } from "../i18n/keys.js";

export const PLAYER_SPEED = 150;
const COST = { light: 11, heavy: 26, dodge: 22, sprint: 16 };

export function createPlayer(pos: Vec): Player {
  return {
    id: 0,
    pos: { ...pos },
    kb: { x: 0, y: 0 },
    radius: 10,
    hp: 100,
    maxHp: 100,
    statuses: {},
    faction: PLAYER_FACTION,
    facing: -Math.PI / 2,
    hitFlash: 0,
    stagger: 0,
    dead: false,
    stamina: 100,
    maxStamina: 100,
    staminaDelay: 0,
    ember: 3,
    maxEmber: 4,
    fray: 0,
    action: { kind: "idle" },
    comboWindow: 0,
    comboStep: 0,
    invuln: 0,
    cooldowns: {},
    critReady: 0,
    sprinting: false,
    regenAcc: 0,
    emberRegen: 0,
  };
}

export function recomputePlayerStats(g: Game): void {
  const a = g.progress.attributes;
  const p = g.player;
  let bonusHp = 0;
  for (const s of ["weapon", "charm", "coat"] as const) bonusHp += g.inventory.equippedItem(s)?.maxHealth ?? 0;
  const oldMax = p.maxHp;
  p.maxHp = 70 + a.resolve * 10 + bonusHp;
  if (p.maxHp > oldMax) p.hp += p.maxHp - oldMax;
  p.hp = Math.min(p.hp, p.maxHp);
  p.maxStamina = 85 + a.finesse * 6;
  p.maxEmber = 3 + Math.floor(a.wits / 2);
  p.ember = Math.min(p.ember, p.maxEmber);
  g.invalidatePerks();
}

export function weaponStats(g: Game) {
  const w = g.inventory.equippedItem("weapon");
  const a = g.progress.attributes;
  const d = w?.def;
  let scale = 1;
  for (const [k, v] of Object.entries(d?.scaling ?? { might: 0.5 })) scale += (v ?? 0) * (a[k as keyof typeof a] ?? 0) * 0.07;
  return {
    item: w,
    damage: (w?.damage ?? 5) * scale,
    speed: (d?.attackSpeed ?? 1) * (1 + a.finesse * 0.03),
    reach: d?.reach ?? 46,
    arc: ((d?.arc ?? 110) * Math.PI) / 180,
    heavyMult: d?.heavyMultiplier ?? 2.2,
    element: w?.element ?? "physical",
    weaponClass: d?.weaponClass ?? "blade",
  };
}

export function updatePlayer(g: Game, dt: number): void {
  const p = g.player;
  const inp = g.input;
  const ws = weaponStats(g);

  // timers
  p.hitFlash = Math.max(0, p.hitFlash - dt);
  p.invuln = Math.max(0, p.invuln - dt);
  p.comboWindow = Math.max(0, p.comboWindow - dt);
  p.critReady = Math.max(0, p.critReady - dt);
  p.stagger = Math.max(0, p.stagger - dt);
  for (const k in p.cooldowns) p.cooldowns[k] = Math.max(0, p.cooldowns[k] - dt);
  if (p.comboWindow <= 0) p.comboStep = 0;

  // facing follows the aim point
  const aimAngle = angleTo(p.pos, g.aim);

  // movement input
  let mx = 0;
  let my = 0;
  if (inp.enabled) {
    if (inp.isDown("left")) mx -= 1;
    if (inp.isDown("right")) mx += 1;
    if (inp.isDown("up")) my -= 1;
    if (inp.isDown("down")) my += 1;
  }
  const move = norm({ x: mx, y: my });
  const moving = mx !== 0 || my !== 0;

  const act = p.action;
  const canAct = p.stagger <= 0 && statusSpeed(p.statuses) > 0;
  const recoverable = act.kind === "idle" || ((act.kind === "light" || act.kind === "heavy") && act.hit && act.t > act.hitAt + 0.06);

  // ---- start actions
  if (inp.enabled && canAct) {
    if (inp.wasPressed("dodge") && (act.kind !== "dodge") && recoverable) {
      const cost = COST.dodge * g.perkProduct("dodgeCostMult") * (1 - g.progress.attributes.finesse * 0.03);
      if (spend(p, cost)) {
        const dir = moving ? move : { x: Math.cos(aimAngle), y: Math.sin(aimAngle) };
        p.action = { kind: "dodge", t: 0, dur: 0.3, dir };
        p.invuln = 0.26;
        g.perks().forEach((pk) => pk.onDodge?.(g));
        g.fx.dodge(p.pos);
      }
    } else if (inp.wasPressed("heavy") && recoverable && act.kind !== "heavy") {
      if (spend(p, COST.heavy)) {
        const s = ws.speed;
        p.action = { kind: "heavy", t: 0, dur: 0.78 / s, hitAt: 0.46 / s, hit: false, angle: aimAngle };
      }
    } else if (inp.wasPressed("light") && (recoverable || (act.kind === "light" && act.hit))) {
      if (spend(p, COST.light)) {
        const combo = p.comboWindow > 0 ? (p.comboStep % 3) + 1 : 1;
        p.comboStep = combo;
        const s = ws.speed * (ws.weaponClass === "knife" ? 1.3 : 1);
        p.action = { kind: "light", t: 0, dur: (combo === 3 ? 0.5 : 0.36) / s, hitAt: (combo === 3 ? 0.16 : 0.1) / s, hit: false, combo, angle: aimAngle };
      }
    } else if ((inp.wasPressed("spell1") || inp.wasPressed("spell2")) && recoverable) {
      const key = inp.wasPressed("spell1") ? "Q" : "R";
      castAbility(g, key, aimAngle);
    } else if (inp.wasPressed("throw") && recoverable) {
      throwFlask(g);
    } else if (inp.wasPressed("use")) {
      useConsumable(g);
    }
    if (inp.wasPressed("interact")) g.interact();
  }

  // ---- progress current action
  const a = p.action;
  let speedMult = 1;
  if (a.kind === "light" || a.kind === "heavy") {
    a.t += dt;
    speedMult = a.kind === "light" ? 0.35 : 0.12;
    if (!a.hit && a.t >= a.hitAt) {
      a.hit = true;
      // aim may be adjusted during windup
      a.angle = aimAngle;
      playerMelee(g, a.kind === "heavy", a.angle, a.kind === "light" ? a.combo : 0);
      p.comboWindow = a.kind === "light" ? 0.55 : 0;
      // small lunge forward
      const lunge = a.kind === "heavy" ? 90 : 50;
      p.kb.x += Math.cos(a.angle) * lunge;
      p.kb.y += Math.sin(a.angle) * lunge;
    }
    if (a.t >= a.dur) p.action = { kind: "idle" };
  } else if (a.kind === "dodge") {
    a.t += dt;
    const sp = 420 * (1 - a.t / a.dur) + 120;
    g.map.move(p.pos, p.radius, a.dir.x * sp * dt, a.dir.y * sp * dt);
    if (a.t >= a.dur) p.action = { kind: "idle" };
  } else if (a.kind === "cast") {
    a.t += dt;
    speedMult = 0.4;
    if (a.t >= a.dur) p.action = { kind: "idle" };
  }

  // facing
  if (p.action.kind === "idle" || p.action.kind === "cast") p.facing = aimAngle;
  else if (p.action.kind === "light" || p.action.kind === "heavy") p.facing = p.action.angle;

  // ---- walking
  if (p.action.kind !== "dodge") {
    const tile = g.map.def(...g.map.cellAt(p.pos));
    let speed = PLAYER_SPEED * speedMult * statusSpeed(p.statuses) * (tile?.slow ?? 1);
    p.sprinting = !!(inp.enabled && inp.isDown("sprint") && moving && p.action.kind === "idle" && p.stamina > 1);
    if (p.sprinting) {
      speed *= 1.6;
      p.stamina -= COST.sprint * dt;
      p.staminaDelay = 0.4;
    }
    if (p.stagger > 0) speed *= 0.2;
    g.map.move(p.pos, p.radius, move.x * speed * dt, move.y * speed * dt);
  }

  // knockback decay
  if (Math.abs(p.kb.x) + Math.abs(p.kb.y) > 1) {
    g.map.move(p.pos, p.radius, p.kb.x * dt, p.kb.y * dt);
    const f = Math.exp(-dt * 10);
    p.kb.x *= f;
    p.kb.y *= f;
  }

  // ---- stamina regen
  p.staminaDelay = Math.max(0, p.staminaDelay - dt);
  if (p.staminaDelay <= 0 && p.action.kind === "idle") p.stamina = Math.min(p.maxStamina, p.stamina + 38 * dt);
  p.stamina = clamp(p.stamina, 0, p.maxStamina);
}

function spend(p: Player, cost: number): boolean {
  // allow acting into exhaustion if at least a bit of stamina remains
  if (p.stamina <= 2) return false;
  p.stamina -= cost;
  p.staminaDelay = 0.65;
  return true;
}

export function castAbility(g: Game, key: "Q" | "R", angle: number): void {
  const p = g.player;
  const id = g.progress.abilities.find((x) => g.content.abilities[x]?.key === key);
  const ab = id ? g.content.abilities[id] : undefined;
  if (!ab) {
    g.toast(key === "R" ? t("toast.noAbilityR", { key: actionKey(g.input, SPELL_ACTION[key]) }) : t("toast.noAbility"));
    return;
  }
  if ((p.cooldowns[ab.id] ?? 0) > 0) return;
  if (p.ember < ab.cost) {
    g.fx.text(p.pos, t("fx.noEmber"), "#ff8a5c");
    return;
  }
  p.ember -= ab.cost;
  p.cooldowns[ab.id] = ab.cooldown;
  const a = g.progress.attributes;
  let dmg = ab.damage;
  for (const [k, v] of Object.entries(ab.scaling)) dmg *= 1 + (v ?? 0) * (a[k as keyof typeof a] ?? 0) * 0.08;
  // Risk magic: high fray amplifies spells
  if (p.fray >= 50) dmg *= g.hasPerk("fray_conduit") ? 2 : 1.5;
  g.addFray(ab.fray);
  p.action = { kind: "cast", t: 0, dur: 0.22 };
  const dir = { x: Math.cos(angle), y: Math.sin(angle) };
  g.projectiles.push({
    id: newId(),
    pos: { x: p.pos.x + dir.x * 14, y: p.pos.y + dir.y * 14 },
    vel: { x: dir.x * ab.speed, y: dir.y * ab.speed },
    radius: 6,
    // spells burst at the aim point (or on the first thing they hit)
    life: clamp(Math.hypot(g.aim.x - p.pos.x, g.aim.y - p.pos.y) / ab.speed, 0.08, 1.4),
    damage: dmg,
    element: ab.element,
    fromPlayer: true,
    faction: p.faction,
    applies: ab.applies ?? [],
    splash: ab.radius,
    ability: ab.id,
    visual: ab.element === "frost" ? "frost" : "bolt",
    color: ab.element === "frost" ? "#aee8ff" : "#ff8a3c",
    dead: false,
  });
  g.bus.emit("AbilityCast", { abilityId: ab.id, element: ab.element });
  g.bus.emit("Noise", { x: p.pos.x, y: p.pos.y, radius: 160, source: "spell" });
}

export function throwFlask(g: Game): void {
  const p = g.player;
  const inst = g.inventory.items.find((i) => g.content.items[i.base]?.throwable);
  if (!inst) {
    g.fx.text(p.pos, t("fx.noFlasks"), "#aaa");
    return;
  }
  const def = g.content.items[inst.base];
  const th = def.throwable!;
  g.inventory.remove(inst.base, 1);
  const tx = g.aim.x - p.pos.x;
  const ty = g.aim.y - p.pos.y;
  const d = Math.min(Math.hypot(tx, ty), 7 * g.map.ts);
  const dir = norm({ x: tx, y: ty });
  const speed = 380;
  g.projectiles.push({
    id: newId(),
    pos: { ...p.pos },
    vel: { x: dir.x * speed, y: dir.y * speed },
    radius: 5,
    life: Math.max(0.12, d / speed),
    damage: th.damage ?? 0,
    element: th.element ?? "physical",
    fromPlayer: true,
    faction: p.faction,
    applies: [],
    leaves: th.liquid,
    splash: th.radius * g.perkProduct("flaskRadiusMult"),
    visual: "flask",
    color: def.color ?? "#c9a24a",
    dead: false,
  });
  p.action = { kind: "cast", t: 0, dur: 0.2 };
  g.bus.emit("ItemUsed", { itemId: def.id });
}

export function useConsumable(g: Game): void {
  const inst = g.inventory.items.find((i) => g.content.items[i.base]?.type === "consumable" && g.content.items[i.base]?.use);
  if (!inst) {
    g.fx.text(g.player.pos, t("fx.nothingToEat"), "#aaa");
    return;
  }
  useItem(g, inst.uid);
}

export function useItem(g: Game, uid: number): void {
  const inst = g.inventory.get(uid);
  if (!inst) return;
  const def = g.content.items[inst.base];
  if (!def.use) return;
  g.inventory.remove(def.id, 1);
  applyEffects(def.use, g);
  g.bus.emit("ItemUsed", { itemId: def.id });
}
