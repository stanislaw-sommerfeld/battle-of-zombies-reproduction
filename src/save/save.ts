// Versioned save format with slots. Each version bump adds a migration so old
// saves keep working. Saves can be exported to and imported from JSON files.
import type { InventoryData } from "../items/inventory.js";
import type { QuestProgress } from "../quests/quests.js";
import type { WorldStateData } from "../world/worldstate.js";
import type { AttributeId } from "../data/types.js";
import type { CharacterLook } from "../character/look.js";

export const SAVE_VERSION = 2;
export const SAVE_FILE_FORMAT = "ash-ledger-save";
/** Single-save key used before slots existed (version 1). Read once, moved to the autosave slot. */
export const LEGACY_SAVE_KEY = "ash-ledger.save";

export type SlotId = "auto" | "1" | "2" | "3";
export const SLOT_IDS: SlotId[] = ["auto", "1", "2", "3"];
export const MANUAL_SLOTS: SlotId[] = ["1", "2", "3"];
export const slotKey = (id: SlotId) => `ash-ledger.slot.${id}`;
export const isSlotId = (v: unknown): v is SlotId => SLOT_IDS.includes(v as SlotId);

export interface PlayerSave {
  origin: string;
  x: number;
  y: number;
  hp: number;
  ember: number;
  fray: number;
  xp: number;
  level: number;
  unspent: number;
  pendingTraits: number;
  attributes: Record<AttributeId, number>;
  traits: string[];
  abilities: string[];
  waystone: [number, number];
  /** Appearance from the character creator (null in saves from before it existed). */
  look: CharacterLook | null;
}

export interface SaveData {
  version: number;
  savedAt: number;
  region: string;
  /** Zone the player stood in, for the slot list. */
  zone?: string;
  playTime: number;
  player: PlayerSave;
  inventory: InventoryData;
  world: WorldStateData;
  quests: Record<string, QuestProgress>;
  insights: { learned: string[]; counters: Record<string, number> };
  lore: string[];
}

type Migration = (old: any) => any;
/** MIGRATIONS[n] upgrades a save from version n to n + 1. */
const MIGRATIONS: Record<number, Migration> = {
  // v2: character creator. Old characters get a default look when loaded.
  1: (s) => ({ ...s, version: 2, player: { ...s.player, look: null } }),
};

export function migrate(raw: any): SaveData {
  if (!raw || typeof raw.version !== "number") throw new Error("Not an Ash Ledger save");
  let s = raw;
  while (s.version < SAVE_VERSION) {
    const m = MIGRATIONS[s.version];
    if (!m) throw new Error(`No migration from save version ${s.version}`);
    s = m(s);
  }
  if (s.version > SAVE_VERSION) throw new Error(`Save is from a newer version (${s.version})`);
  assertShape(s);
  return s as SaveData;
}

/** Structural check, so a hand-edited or foreign file fails here and not mid-game. */
function assertShape(s: any): void {
  const fail = (what: string) => {
    throw new Error(`Save is damaged (${what})`);
  };
  const isObj = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);
  const isNum = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  const isStrArr = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === "string");
  if (typeof s.region !== "string") fail("region");
  if (!isNum(s.playTime) || !isNum(s.savedAt)) fail("time");
  const p = s.player;
  if (!isObj(p)) fail("player");
  for (const k of ["x", "y", "hp", "ember", "fray", "xp", "level", "unspent", "pendingTraits"]) if (!isNum(p[k])) fail(`player.${k}`);
  if (typeof p.origin !== "string" || !isObj(p.attributes) || !isStrArr(p.traits) || !isStrArr(p.abilities)) fail("player");
  if (!Array.isArray(p.waystone) || p.waystone.length !== 2 || !p.waystone.every(isNum)) fail("player.waystone");
  if (p.look !== null && !isObj(p.look)) fail("player.look");
  if (!isObj(s.inventory) || !Array.isArray(s.inventory.items) || !isObj(s.inventory.equipped)) fail("inventory");
  if (!isObj(s.world) || !isObj(s.quests) || !isObj(s.insights) || !isStrArr(s.insights.learned) || !isStrArr(s.lore)) fail("world");
}

export interface SaveStorage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export function writeSlot(storage: SaveStorage, slot: SlotId, data: SaveData): void {
  storage.setItem(slotKey(slot), JSON.stringify(data));
}

export function readSlot(storage: SaveStorage, slot: SlotId): SaveData | undefined {
  return inspectSlot(storage, slot).data;
}

export interface SlotInfo {
  id: SlotId;
  data?: SaveData;
  /** Set when something is stored but can't be loaded. */
  error?: string;
}

export function inspectSlot(storage: SaveStorage, slot: SlotId): SlotInfo {
  moveLegacySave(storage);
  const raw = storage.getItem(slotKey(slot));
  if (!raw) return { id: slot };
  try {
    return { id: slot, data: migrate(JSON.parse(raw)) };
  } catch (e) {
    console.warn(`Could not load save slot ${slot}:`, e);
    return { id: slot, error: (e as Error).message };
  }
}

export function listSlots(storage: SaveStorage): SlotInfo[] {
  return SLOT_IDS.map((id) => inspectSlot(storage, id));
}

/** Most recently written loadable slot. */
export function latestSlot(storage: SaveStorage): SlotId | undefined {
  let best: SlotInfo | undefined;
  for (const s of listSlots(storage)) if (s.data && (!best?.data || s.data.savedAt > best.data.savedAt)) best = s;
  return best?.id;
}

export function deleteSlot(storage: SaveStorage, slot: SlotId): void {
  storage.removeItem(slotKey(slot));
}

function moveLegacySave(storage: SaveStorage): void {
  const old = storage.getItem(LEGACY_SAVE_KEY);
  if (old === null) return;
  if (!storage.getItem(slotKey("auto"))) storage.setItem(slotKey("auto"), old);
  storage.removeItem(LEGACY_SAVE_KEY);
}

export function exportSaveFile(data: SaveData): string {
  return JSON.stringify({ format: SAVE_FILE_FORMAT, exportedAt: new Date().toISOString(), save: data }, null, 2);
}

/** Reads an exported save (or a bare save object). Throws a readable message on bad input. */
export function parseSaveFile(text: string): SaveData {
  if (text.length > 5_000_000) throw new Error("file too large");
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("not a JSON file");
  }
  if (raw?.format === SAVE_FILE_FORMAT) raw = raw.save;
  else if (raw?.format) throw new Error("not an Ash Ledger save file");
  return migrate(raw);
}
