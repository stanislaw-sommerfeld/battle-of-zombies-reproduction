// Runtime entity shapes. Behaviour lives in systems (player.ts, ai/, combat/),
// these are plain data so they're easy to inspect, save and render.
import type { Statuses } from "../combat/damage.js";
import type { AttackDef, EnemyDef, Element, LiquidId, NpcDef, PropDef, StatusId } from "../data/types.js";
import type { Vec } from "../core/math.js";

let nextId = 1;
export const newId = () => nextId++;

export interface Actor {
  id: number;
  pos: Vec;
  kb: Vec; // knockback velocity
  radius: number;
  hp: number;
  maxHp: number;
  statuses: Statuses;
  faction: string;
  facing: number;
  hitFlash: number;
  stagger: number;
  dead: boolean;
}

export type PlayerAction =
  | { kind: "idle" }
  | { kind: "light"; t: number; dur: number; hitAt: number; combo: number; hit: boolean; angle: number }
  | { kind: "heavy"; t: number; dur: number; hitAt: number; hit: boolean; angle: number }
  | { kind: "dodge"; t: number; dur: number; dir: Vec }
  | { kind: "cast"; t: number; dur: number };

export interface Player extends Actor {
  stamina: number;
  maxStamina: number;
  staminaDelay: number;
  ember: number;
  maxEmber: number;
  fray: number;
  action: PlayerAction;
  comboWindow: number;
  comboStep: number;
  invuln: number;
  cooldowns: Record<string, number>;
  critReady: number; // seconds a guaranteed crit stays primed
  sprinting: boolean;
  regenAcc: number;
  emberRegen: number;
}

export type AiState = "idle" | "wander" | "investigate" | "chase" | "attack" | "flee" | "return" | "scavenge" | "stagger";

export interface Enemy extends Actor {
  def: EnemyDef;
  spawnId: string;
  zone: string;
  home: Vec;
  ai: AiState;
  aiT: number;
  target?: number; // actor id (0 = player)
  goal?: Vec;
  attack?: { def: AttackDef; t: number; angle: number; origin: Vec; done: boolean; dashing?: boolean };
  cooldowns: Record<string, number>;
  poiseLeft: number;
  lastSeen?: Vec;
  strafe: number;
  risen: boolean; // already came back once
  panic: number;
  boss: boolean;
  lastHitByPlayer: boolean;
  lastElement: Element;
  awareOfPlayer: boolean;
}

export interface Projectile {
  id: number;
  pos: Vec;
  vel: Vec;
  radius: number;
  life: number;
  damage: number;
  element: Element;
  fromPlayer: boolean;
  faction: string;
  applies: StatusId[];
  leaves?: LiquidId;
  splash?: number; // radius in tiles (flasks)
  ability?: string;
  visual: "bolt" | "frost" | "ink" | "flask";
  color: string;
  dead: boolean;
}

export interface Prop {
  id: number;
  def: PropDef;
  spawnId: string;
  pos: Vec;
  hp: number;
  used: boolean;
  dead: boolean;
  params: Record<string, unknown>;
}

export interface Npc {
  id: number;
  def: NpcDef;
  spawnId: string;
  pos: Vec;
  facing: number;
  barkT: number;
}

export interface Pickup {
  id: number;
  pos: Vec;
  item: string;
  count: number;
  affixes: string[];
  t: number;
  dead: boolean;
}

export interface Echo {
  id: number;
  pos: Vec;
  enemyId: string;
  zone: string;
  life: number;
  rise: number; // seconds until it rises (Edict of Return); Infinity if never
  dead: boolean;
}
