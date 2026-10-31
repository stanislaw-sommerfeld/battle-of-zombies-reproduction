// Persistent world memory: every fact the world remembers about the player's
// actions lives here and is serialized in the save file.
import type { EventBus } from "../core/events.js";

export type FlagValue = string | number | boolean;

export interface WorldStateData {
  flags: Record<string, FlagValue>;
  removedSpawns: string[]; // killed enemies, looted chests, broken barrels
  usedSpawns: string[]; // one-shot interactions consumed
  brokenTiles: [number, number][];
  discovered: string[];
  factions: Record<string, number>;
  /** Base64 bitmap of explored tiles (minimap). Optional: older saves lack it. */
  explored?: string;
}

export class WorldState {
  flags: Record<string, FlagValue> = {};
  removedSpawns = new Set<string>();
  usedSpawns = new Set<string>();
  brokenTiles: [number, number][] = [];
  discovered = new Set<string>();
  factions: Record<string, number> = {};
  explored = "";

  constructor(private bus?: EventBus) {}

  get(key: string): FlagValue | undefined {
    return this.flags[key];
  }

  set(key: string, value: FlagValue): void {
    if (this.flags[key] === value) return;
    this.flags[key] = value;
    this.bus?.emit("WorldStateChanged", { key, value });
  }

  changeFaction(id: string, delta: number): number {
    const v = (this.factions[id] ?? 0) + delta;
    this.factions[id] = v;
    this.bus?.emit("FactionChanged", { factionId: id, value: v, delta });
    return v;
  }

  serialize(): WorldStateData {
    return {
      flags: { ...this.flags },
      removedSpawns: [...this.removedSpawns],
      usedSpawns: [...this.usedSpawns],
      brokenTiles: this.brokenTiles.map((t) => [t[0], t[1]] as [number, number]),
      discovered: [...this.discovered],
      factions: { ...this.factions },
      explored: this.explored,
    };
  }

  load(d: WorldStateData): void {
    this.flags = { ...d.flags };
    this.removedSpawns = new Set(d.removedSpawns);
    this.usedSpawns = new Set(d.usedSpawns);
    this.brokenTiles = d.brokenTiles.map((t) => [t[0], t[1]]);
    this.discovered = new Set(d.discovered);
    this.factions = { ...d.factions };
    this.explored = d.explored ?? "";
  }
}
