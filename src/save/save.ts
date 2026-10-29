// Versioned save format. Each version bump adds a migration so old saves keep working.
import type { InventoryData } from "../items/inventory.js";
import type { QuestProgress } from "../quests/quests.js";
import type { WorldStateData } from "../world/worldstate.js";
import type { AttributeId } from "../data/types.js";

export const SAVE_VERSION = 1;
export const SAVE_KEY = "ash-ledger.save";

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
}

export interface SaveData {
  version: number;
  savedAt: number;
  region: string;
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
  // 1: (s) => ({ ...s, version: 2, newField: default }),
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
  return s as SaveData;
}

export interface SaveStorage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export function writeSave(storage: SaveStorage, data: SaveData): void {
  storage.setItem(SAVE_KEY, JSON.stringify(data));
}

export function readSave(storage: SaveStorage): SaveData | undefined {
  const raw = storage.getItem(SAVE_KEY);
  if (!raw) return undefined;
  try {
    return migrate(JSON.parse(raw));
  } catch (e) {
    console.warn("Could not load save:", e);
    return undefined;
  }
}
