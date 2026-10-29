import type { AffixDef, ContentBundle, Element, ItemDef } from "../data/types.js";

export interface ItemInstance {
  uid: number;
  base: string;
  count: number;
  affixes: string[];
}

export type EquipSlot = "weapon" | "charm" | "coat";
export const EQUIP_SLOTS: EquipSlot[] = ["weapon", "charm", "coat"];

/** Item definition merged with its affixes: what gameplay code actually reads. */
export interface ResolvedItem {
  inst: ItemInstance;
  def: ItemDef;
  name: string;
  rarity: NonNullable<ItemDef["rarity"]>;
  damage: number;
  element: Element;
  perks: string[];
  drawbacks: string[];
  affixTexts: string[];
  maxHealth: number;
}

export function resolveItem(content: Pick<ContentBundle, "items" | "affixes">, inst: ItemInstance): ResolvedItem {
  const def = content.items[inst.base];
  if (!def) throw new Error(`Unknown item ${inst.base}`);
  const affixes = inst.affixes.map((a) => content.affixes[a]).filter((a): a is AffixDef => !!a);
  let damage = def.damage ?? 0;
  let element: Element = def.element ?? "physical";
  let maxHealth = def.maxHealth ?? 0;
  const perks = [...(def.perks ?? [])];
  const drawbacks = [...(def.drawbacks ?? [])];
  let prefix = "";
  let suffix = "";
  for (const a of affixes) {
    damage *= a.damageMult ?? 1;
    if (a.element) element = a.element;
    maxHealth += a.maxHealth ?? 0;
    perks.push(...(a.perks ?? []));
    drawbacks.push(...(a.drawbacks ?? []));
    if (a.slot === "prefix") prefix = a.name + " ";
    else suffix = " " + a.name;
  }
  const rarity = def.rarity ?? (affixes.length >= 2 ? "rare" : affixes.length === 1 ? "uncommon" : "common");
  return {
    inst,
    def,
    name: prefix + def.name + suffix,
    rarity,
    damage: Math.round(damage),
    element,
    perks,
    drawbacks,
    affixTexts: affixes.map((a) => a.text),
    maxHealth,
  };
}

export function slotFor(def: ItemDef): EquipSlot | undefined {
  return def.type === "weapon" ? "weapon" : def.type === "charm" ? "charm" : def.type === "coat" ? "coat" : undefined;
}

export interface InventoryData {
  nextUid: number;
  items: ItemInstance[];
  equipped: Partial<Record<EquipSlot, number>>;
}

export class Inventory {
  items: ItemInstance[] = [];
  equipped: Partial<Record<EquipSlot, number>> = {};
  private nextUid = 1;
  readonly capacity = 32;

  constructor(private content: Pick<ContentBundle, "items" | "affixes">) {}

  add(base: string, count = 1, affixes: string[] = []): ItemInstance | undefined {
    const def = this.content.items[base];
    if (!def) throw new Error(`Unknown item ${base}`);
    const stackable = (def.stack ?? 1) > 1 && affixes.length === 0;
    if (stackable) {
      const existing = this.items.find((i) => i.base === base && i.affixes.length === 0);
      if (existing) {
        existing.count += count;
        return existing;
      }
    }
    if (this.items.length >= this.capacity) return undefined;
    const inst: ItemInstance = { uid: this.nextUid++, base, count: stackable ? count : 1, affixes: [...affixes] };
    this.items.push(inst);
    // non-stackable items with count > 1 become separate instances
    for (let i = 1; !stackable && i < count; i++) this.add(base, 1, affixes);
    return inst;
  }

  count(base: string): number {
    return this.items.filter((i) => i.base === base).reduce((s, i) => s + i.count, 0);
  }

  remove(base: string, count = 1): boolean {
    if (this.count(base) < count) return false;
    for (const inst of [...this.items]) {
      if (inst.base !== base || count <= 0) continue;
      const take = Math.min(inst.count, count);
      inst.count -= take;
      count -= take;
      if (inst.count <= 0) this.removeInstance(inst.uid);
    }
    return true;
  }

  removeInstance(uid: number): void {
    this.items = this.items.filter((i) => i.uid !== uid);
    for (const s of EQUIP_SLOTS) if (this.equipped[s] === uid) delete this.equipped[s];
  }

  get(uid: number): ItemInstance | undefined {
    return this.items.find((i) => i.uid === uid);
  }

  /** Equips the item in its slot; returns the slot or undefined if not equippable. */
  equip(uid: number): EquipSlot | undefined {
    const inst = this.get(uid);
    if (!inst) return undefined;
    const slot = slotFor(this.content.items[inst.base]);
    if (!slot) return undefined;
    this.equipped[slot] = uid;
    return slot;
  }

  unequip(slot: EquipSlot): void {
    delete this.equipped[slot];
  }

  equippedItem(slot: EquipSlot): ResolvedItem | undefined {
    const uid = this.equipped[slot];
    const inst = uid !== undefined ? this.get(uid) : undefined;
    return inst ? resolveItem(this.content, inst) : undefined;
  }

  isEquipped(uid: number): boolean {
    return EQUIP_SLOTS.some((s) => this.equipped[s] === uid);
  }

  serialize(): InventoryData {
    return { nextUid: this.nextUid, items: this.items.map((i) => ({ ...i, affixes: [...i.affixes] })), equipped: { ...this.equipped } };
  }

  load(d: InventoryData): void {
    // drop items whose definitions were removed from the game since the save
    this.items = d.items.filter((i) => this.content.items[i.base]).map((i) => ({ ...i, affixes: i.affixes.filter((a) => this.content.affixes[a]) }));
    this.equipped = {};
    for (const s of EQUIP_SLOTS) {
      const uid = d.equipped[s];
      if (uid !== undefined && this.get(uid)) this.equipped[s] = uid;
    }
    this.nextUid = Math.max(d.nextUid, ...this.items.map((i) => i.uid + 1), 1);
  }
}
