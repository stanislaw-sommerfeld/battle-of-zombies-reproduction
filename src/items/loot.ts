// Loot rolling: weighted tables that may nest, plus affixes for gear.
// Deterministic given an Rng, so it is unit-testable.
import type { ContentBundle } from "../data/types.js";
import type { Rng } from "../core/math.js";

export interface LootDrop {
  item: string;
  count: number;
  affixes: string[];
}

type LootContent = Pick<ContentBundle, "loot" | "items" | "affixes">;

export function rollLoot(content: LootContent, tableId: string, rng: Rng, depth = 0): LootDrop[] {
  const table = content.loot[tableId];
  if (!table || depth > 5) return [];
  const out: LootDrop[] = [];
  for (let r = 0; r < table.rolls; r++) {
    if (table.chance !== undefined && !rng.chance(table.chance)) continue;
    const e = rng.weighted(table.entries);
    if (!e) continue;
    if (e.table) {
      out.push(...rollLoot(content, e.table, rng, depth + 1));
    } else if (e.item) {
      const count = e.count ? rng.int(e.count[0], e.count[1]) : 1;
      out.push({ item: e.item, count, affixes: rollAffixes(content, e.item, rng) });
    }
  }
  return out;
}

/** Gear marked `rollAffixes` gets 0-2 affixes: at most one prefix and one suffix. */
export function rollAffixes(content: LootContent, itemId: string, rng: Rng): string[] {
  const def = content.items[itemId];
  if (!def?.rollAffixes) return [];
  const roll = rng.next();
  const n = roll < 0.45 ? 0 : roll < 0.85 ? 1 : 2;
  const pool = Object.values(content.affixes).filter((a) => a.appliesTo.includes(def.type));
  const chosen: string[] = [];
  const usedSlots = new Set<string>();
  for (let i = 0; i < n; i++) {
    const options = pool.filter((a) => !usedSlots.has(a.slot));
    const a = rng.weighted(options);
    if (!a) break;
    chosen.push(a.id);
    usedSlots.add(a.slot);
  }
  return chosen;
}
