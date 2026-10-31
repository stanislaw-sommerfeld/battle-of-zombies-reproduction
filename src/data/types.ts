// Content schema. Everything under /data is validated against these shapes.
// Gameplay code reads definitions; it never hard-codes content.

export type Element = "physical" | "fire" | "frost" | "ink" | "echo";
export type AttributeId = "might" | "finesse" | "wits" | "resolve";
export type StatusId = "burning" | "wet" | "oiled" | "chilled" | "frozen" | "inked" | "stunned";
export type LiquidId = "oil" | "water" | "ink";

/** Generic conditions shared by dialogue, quests, encounters and props. */
export type Condition =
  | { flag: string; eq?: string | number | boolean; neq?: string | number | boolean; gte?: number; exists?: boolean }
  | { hasItem: string; count?: number }
  | { insight: string }
  | { quest: string; state: QuestStateId | QuestStateId[]; stage?: string }
  | { attr: AttributeId; gte: number }
  | { level: number }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

/** Generic effects shared by dialogue, quests, insights, props. */
export type Effect =
  | { setFlag: string; value: string | number | boolean }
  | { addFlag: string; value: number }
  | { giveItem: string; count?: number }
  | { takeItem: string; count?: number }
  | { giveXp: number }
  | { startQuest: string }
  | { setStage: { quest: string; stage: string } }
  | { completeQuest: string; outcome?: string }
  | { failQuest: string }
  | { grantInsight: string }
  | { learnAbility: string }
  | { faction: string; delta: number }
  | { toast: string; kind?: string }
  | { readLore: string }
  | { heal: number }
  | { fray: number }
  | { clearLiquid: { zone: string; liquid: LiquidId } }
  | { emit: string; payload?: Record<string, unknown> };

export interface ItemDef {
  id: string;
  name: string;
  type: "weapon" | "charm" | "coat" | "consumable" | "material" | "key" | "page";
  rarity?: "common" | "uncommon" | "rare" | "relic";
  description?: string;
  lore?: string;
  icon?: string; // glyph shown in UI
  color?: string;
  value?: number;
  stack?: number;
  // weapons
  weaponClass?: "blade" | "hook" | "knife" | "maul";
  damage?: number;
  attackSpeed?: number; // swings per second multiplier
  reach?: number; // px
  arc?: number; // degrees
  heavyMultiplier?: number;
  element?: Element;
  scaling?: Partial<Record<AttributeId, number>>;
  // armor / charm
  maxHealth?: number;
  resist?: Partial<Record<Element, number>>;
  /** Qualitative perks (see src/effects/perks.ts). */
  perks?: string[];
  /** Drawbacks are perks too; listed separately for the tooltip. */
  drawbacks?: string[];
  // consumables
  use?: Effect[];
  throwable?: { liquid?: LiquidId; element?: Element; radius: number; damage?: number };
  rollAffixes?: boolean;
}

export interface AffixDef {
  id: string;
  name: string;
  slot: "prefix" | "suffix";
  appliesTo: ItemDef["type"][];
  weight: number;
  text: string;
  perks?: string[];
  drawbacks?: string[];
  damageMult?: number;
  element?: Element;
  maxHealth?: number;
}

export interface LootTableDef {
  id: string;
  rolls: number;
  /** Chance that each roll yields anything at all. */
  chance?: number;
  entries: { item?: string; table?: string; weight: number; count?: [number, number] }[];
}

export interface AttackDef {
  id: string;
  kind: "melee" | "lunge" | "slam" | "projectile";
  damage: number;
  element?: Element;
  windup: number;
  recover: number;
  range: number;
  radius?: number;
  arc?: number;
  speed?: number; // projectile / lunge
  cooldown: number;
  applies?: StatusId[];
  leaves?: LiquidId; // projectile leaves a puddle
}

export interface EnemyDef {
  id: string;
  name: string;
  behavior: "lunger" | "brute" | "spitter" | "boss" | "echo";
  faction: string;
  health: number;
  speed: number;
  radius: number;
  poise: number; // damage absorbed before staggering
  sight: number;
  attacks: AttackDef[];
  resist?: Partial<Record<Element, number>>;
  /** Statuses this creature never receives. */
  immune?: StatusId[];
  loot?: string;
  xp: number;
  /** Enemy id spawned when its echo rises under an Edict of Return. */
  risesAs?: string;
  /** Creatures that eat echoes / investigate corpses. */
  scavenger?: boolean;
  /** Pack members alert each other. */
  pack?: boolean;
  visual: { shape: "hound" | "thrall" | "leech" | "echo" | "matron"; color: string; accent: string; scale?: number };
  description?: string;
  /** The creature leaves the world (no loot, no echo) once this holds. */
  departsWhen?: Condition;
  departText?: string;
  /** Shown as a health bar at the top of the screen. */
  boss?: boolean;
}

export interface FactionDef {
  id: string;
  name: string;
  hostileTo: string[];
  description?: string;
}

export interface EdictDef {
  id: string;
  name: string;
  text: string;
  fireSpread?: number; // multiplier
  fireDamage?: number; // multiplier
  healing?: number; // multiplier on all healing
  regen?: number; // hp per second
  frayDecay?: number; // fray per second
  deadRise?: boolean;
  sanctuary?: boolean; // hostile creatures will not enter
  ambient: string; // css color for darkness overlay
  darkness: number; // 0..1
  ash?: "down" | "up" | "none";
  fog?: number;
}

export interface ZoneDef {
  id: string;
  name: string;
  edict: string;
  /** World scars: the first matching entry replaces the zone's edict. */
  edictWhen?: { if: Condition; edict: string }[];
  rect: [number, number, number, number]; // tile x, y, w, h
  music?: string;
  discoverXp?: number;
  description?: string;
}

export interface SpawnDef {
  id: string; // unique per region; used to persist kills/opened chests
  kind: "enemy" | "prop" | "npc" | "player";
  ref: string; // enemy id, prop type or npc id
  at: [number, number]; // tile coords
  when?: Condition; // only spawns when true
  params?: Record<string, unknown>;
}

export interface RegionDef {
  id: string;
  name: string;
  tileSize: number;
  legend: Record<string, string>; // char -> tile id
  map: string[];
  zones: string[];
  spawns: SpawnDef[];
}

export interface TileDef {
  id: string;
  solid?: boolean;
  blocksProjectiles?: boolean;
  liquid?: LiquidId;
  flammable?: boolean;
  breakable?: { into: string; requires?: "heavy"; flag?: string };
  slow?: number;
  colors: string[]; // base + variations
  height?: number; // 0 floor, >0 drawn as raised block
  top?: string;
  decor?: "grass" | "stones" | "roots" | "graves" | "planks" | "cobble" | "tree";
}

export interface DialogueOption {
  text: string;
  if?: Condition;
  /** D&D style check: d20 + attribute vs dc. */
  check?: { attr: AttributeId; dc: number };
  effects?: Effect[];
  failEffects?: Effect[];
  goto?: string; // node id, or "end"
  failGoto?: string;
  once?: string; // flag name; option hidden after chosen
}

export interface DialogueNode {
  speaker?: string;
  text: string;
  /** Alternative texts; the first whose condition is true is used. */
  variants?: { if: Condition; text: string }[];
  effects?: Effect[];
  options: DialogueOption[];
}

export interface DialogueDef {
  id: string;
  /** Entry points evaluated in order; first matching wins. */
  entries: { if?: Condition; node: string }[];
  nodes: Record<string, DialogueNode>;
}

export interface NpcDef {
  id: string;
  name: string;
  title?: string;
  dialogue: string;
  faction?: string;
  visual: { color: string; accent: string; lantern?: boolean };
  barks?: (string | { text: string; if: Condition })[];
}

export type QuestStateId = "inactive" | "active" | "completed" | "failed";

export interface QuestTrigger {
  /** Event type from the event bus. */
  event: string;
  /** Payload fields that must match. */
  match?: Record<string, string | number | boolean>;
  if?: Condition;
  /** How many matching events are needed (counted per stage). */
  count?: number;
  to?: string; // next stage id
  complete?: string; // outcome id: completes the quest
  effects?: Effect[];
}

export interface QuestStage {
  text: string;
  /** Optional hint shown under the objective. */
  hint?: string;
  triggers: QuestTrigger[];
}

export interface QuestDef {
  id: string;
  title: string;
  summary: string;
  start: string;
  stages: Record<string, QuestStage>;
  outcomes: Record<string, { text: string; effects?: Effect[] }>;
}

export interface InsightDef {
  id: string;
  name: string;
  text: string;
  /** Learned when an event matching this fires `count` times. */
  learnOn?: { event: string; match?: Record<string, string | number | boolean>; count?: number }[];
  perks?: string[];
  effects?: Effect[];
  xp?: number;
}

export interface LoreDef {
  id: string;
  title: string;
  text: string;
  effects?: Effect[];
}

export interface AbilityDef {
  id: string;
  name: string;
  key: "Q" | "R";
  description: string;
  element: Element;
  cost: number; // ember
  fray: number;
  cooldown: number;
  damage: number;
  speed: number;
  radius: number;
  scaling: Partial<Record<AttributeId, number>>;
  applies?: StatusId[];
}

export interface TraitDef {
  id: string;
  name: string;
  text: string;
  perks: string[];
  requires?: Partial<Record<AttributeId, number>>;
}

export interface OriginDef {
  id: string;
  name: string;
  text: string;
  attributes: Record<AttributeId, number>;
  items: string[];
  equip: string[];
  trait?: string;
}

export interface PropDef {
  id: string;
  name: string;
  shape: "barrel" | "chest" | "page" | "waystone" | "well" | "door" | "brazier" | "edict_stone" | "corpse" | "spring" | "lectern";
  solid?: boolean;
  radius: number;
  health?: number;
  onBreak?: { liquid?: LiquidId; radius?: number; loot?: string };
  interact?: { prompt: string; if?: Condition; effects?: Effect[]; once?: boolean; dialogue?: string; lore?: string; loot?: string };
  light?: { radius: number; color: string; flicker?: number };
}

export interface ContentBundle {
  items: Record<string, ItemDef>;
  affixes: Record<string, AffixDef>;
  loot: Record<string, LootTableDef>;
  enemies: Record<string, EnemyDef>;
  factions: Record<string, FactionDef>;
  edicts: Record<string, EdictDef>;
  zones: Record<string, ZoneDef>;
  regions: Record<string, RegionDef>;
  tiles: Record<string, TileDef>;
  dialogue: Record<string, DialogueDef>;
  npcs: Record<string, NpcDef>;
  quests: Record<string, QuestDef>;
  insights: Record<string, InsightDef>;
  lore: Record<string, LoreDef>;
  abilities: Record<string, AbilityDef>;
  traits: Record<string, TraitDef>;
  origins: Record<string, OriginDef>;
  props: Record<string, PropDef>;
  rules: Record<string, import("../narrative/worldrules.js").WorldRuleDef>;
  species: Record<string, SpeciesDef>;
  cosmetics: Record<string, CosmeticDef>;
}

// ---------------------------------------------------------------- character creation

/** Body features drawn on top of skin (see src/render/character.ts). */
export type BodyFeature = "embers" | "ink_veins" | "gilt" | "glow_eyes";

export interface SexDef {
  id: string;
  name: string;
}

export interface RaceDef {
  id: string;
  name: string;
  text: string;
  skin: string[];
  hair: string[];
  eyes: string[];
  /** Colour of species features (ember cracks, ink veins, gilding). */
  feature?: string;
  /** Shifts the species' height range, in cm. */
  heightOffset?: number;
}

export interface SpeciesDef {
  id: string;
  name: string;
  text: string;
  /** Empty or absent: the species has no sexes and the step is skipped. */
  sexes?: SexDef[];
  races: RaceDef[];
  heightCm: [number, number];
  weightKg: [number, number];
  features?: BodyFeature[];
  /** Head size relative to a human. */
  headScale?: number;
}

export type CosmeticKind = "hair" | "outfit" | "mark" | "palette";

export interface CosmeticDef {
  id: string;
  kind: CosmeticKind;
  name: string;
  /** Drawing routine (hair style, outfit cut, mark pattern). */
  shape?: string;
  /** Limits the option to these species. */
  species?: string[];
  /** Palettes only. */
  colors?: string[];
  /** Outfits only: can the hood be raised? */
  hood?: boolean;
}
