// Game: owns the world state and wires systems together. Behaviour lives in
// subsystem modules (player, ai, combat, simulation); this class is the hub
// that implements the data-rule interfaces (RuleContext / EffectHost).
import { EventBus } from "./core/events.js";
import { Rng, dist, type Vec } from "./core/math.js";
import type { Input } from "./core/input.js";
import type { AttributeId, ContentBundle, EdictDef, Element, LiquidId, QuestStateId, RegionDef, StatusId, ZoneDef } from "./data/types.js";
import { applyStatus } from "./combat/damage.js";
import { DialogueRunner } from "./dialogue/dialogue.js";
import { PERKS, type Perk } from "./effects/perks.js";
import { newId, type Echo, type Enemy, type Npc, type Pickup, type Player, type Prop, type Projectile, type Actor } from "./entities/entities.js";
import { Inventory, resolveItem } from "./items/inventory.js";
import { rollLoot } from "./items/loot.js";
import { InsightSystem } from "./narrative/insight.js";
import { applyEffects, evaluate, type EffectHost, type RuleContext } from "./narrative/rules.js";
import { QuestSystem } from "./quests/quests.js";
import { SAVE_VERSION, readSave, writeSave, type SaveData, type SaveStorage } from "./save/save.js";
import { Liquid, LIQUID_BY_NAME, SurfaceGrid } from "./world/surfaces.js";
import { TileMap } from "./world/tilemap.js";
import { WorldState } from "./world/worldstate.js";
import { Fx } from "./render/fx.js";
import { updatePlayer, createPlayer, recomputePlayerStats } from "./entities/player.js";
import { updateEnemy, createEnemy, onNoise } from "./ai/enemy.js";
import { updateProjectiles } from "./combat/projectiles.js";
import { killEnemy, damageEnemy, damagePlayer, shatter } from "./combat/combat.js";
import { updateSimulation } from "./simulation/reality.js";
import { interact, nearestInteractable, type Interactable } from "./world/interact.js";
import { WorldRules } from "./narrative/worldrules.js";
import { PathField } from "./ai/pathfield.js";

export interface UiBridge {
  openDialogue(): void;
  openLore(title: string, text: string): void;
  openTraitChoice(): void;
  showDeath(): void;
}

export interface PlayerProgress {
  origin: string;
  xp: number;
  level: number;
  unspent: number;
  pendingTraits: number;
  attributes: Record<AttributeId, number>;
  traits: string[];
  abilities: string[];
  waystone: [number, number];
}

export const PLAYER_FACTION = "unwritten";

export class Game implements EffectHost, RuleContext {
  bus = new EventBus();
  rng = new Rng((Date.now() ^ 0x5eed) >>> 0);
  world: WorldState;
  quests: QuestSystem;
  insights: InsightSystem;
  inventory: Inventory;
  dialogue: DialogueRunner;
  rules: WorldRules;
  fx = new Fx();
  ui?: UiBridge;
  input!: Input;
  aim: Vec = { x: 0, y: 0 };

  region!: RegionDef;
  map!: TileMap;
  paths!: PathField;
  /** 1 per explored tile. */
  explored!: Uint8Array;
  exploredCount = 0;
  private pathRefresh = 0;
  surfaces!: SurfaceGrid;
  private zoneGrid!: Int16Array;
  private zoneList: ZoneDef[] = [];
  private initialInk: Record<string, number> = {};

  player!: Player;
  progress!: PlayerProgress;
  enemies: Enemy[] = [];
  projectiles: Projectile[] = [];
  props: Prop[] = [];
  npcs: Npc[] = [];
  pickups: Pickup[] = [];
  echoes: Echo[] = [];
  loreRead = new Set<string>();

  time = 0;
  playTime = 0;
  hitstop = 0;
  /** Set when terrain changes so the renderer rebuilds its cached ground layer. */
  mapDirty = true;
  currentZone?: ZoneDef;
  dead = false;
  focus?: Interactable;
  private perkCache?: Set<string>;

  constructor(public content: ContentBundle, private storage: SaveStorage) {
    this.world = new WorldState(this.bus);
    this.quests = new QuestSystem(content.quests, this.bus);
    this.insights = new InsightSystem(content.insights, this.bus);
    this.inventory = new Inventory(content);
    this.dialogue = new DialogueRunner(content.dialogue, this.bus, this, this, () => this.rng.int(1, 20));
    this.quests.host = this;
    this.quests.rules = this;
    this.insights.host = this;
    this.bus.on("InsightGained", () => this.invalidatePerks());
    this.bus.on("ItemEquipped", () => this.invalidatePerks());
    this.bus.on("WorldStateChanged", () => {
      this.quests.recheck();
      this.refreshEdicts();
      this.syncSpawns();
    });
    this.rules = new WorldRules(content.rules ?? {}, this.bus);
    this.rules.host = this;
    this.bus.on("Noise", (n) => onNoise(this, n));
  }

  // ---------------------------------------------------------------- setup

  newGame(originId: string): void {
    const origin = this.content.origins[originId];
    this.resetState();
    this.progress = {
      origin: originId,
      xp: 0,
      level: 1,
      unspent: 0,
      pendingTraits: 0,
      attributes: { ...origin.attributes },
      traits: origin.trait ? [origin.trait] : [],
      abilities: ["ember_bolt"],
      waystone: [0, 0],
    };
    for (const id of origin.items) this.inventory.add(id, 1);
    for (const id of origin.equip) {
      const inst = this.inventory.add(id, 1);
      if (inst) this.inventory.equip(inst.uid);
    }
    this.loadRegion("cinder_vale", undefined);
    this.progress.waystone = [this.player.pos.x, this.player.pos.y];
    recomputePlayerStats(this);
    this.player.hp = this.player.maxHp;
    this.save();
  }

  loadSave(s: SaveData): void {
    this.resetState();
    this.world.load(s.world);
    this.inventory.load(s.inventory);
    this.quests.load(s.quests);
    this.insights.load(s.insights);
    this.loreRead = new Set(s.lore);
    this.playTime = s.playTime;
    const p = s.player;
    this.progress = {
      origin: p.origin,
      xp: p.xp,
      level: p.level,
      unspent: p.unspent,
      pendingTraits: p.pendingTraits,
      attributes: { ...p.attributes },
      traits: p.traits.filter((t) => this.content.traits[t]),
      abilities: p.abilities.filter((a) => this.content.abilities[a]),
      waystone: p.waystone,
    };
    this.loadRegion(s.region, { x: p.x, y: p.y });
    recomputePlayerStats(this);
    this.player.hp = Math.min(p.hp, this.player.maxHp);
    this.player.ember = p.ember;
    this.player.fray = p.fray;
  }

  continueGame(): boolean {
    const s = readSave(this.storage);
    if (!s) return false;
    this.loadSave(s);
    return true;
  }

  hasSave(): boolean {
    return !!readSave(this.storage);
  }

  private resetState(): void {
    this.world.load({ flags: {}, removedSpawns: [], usedSpawns: [], brokenTiles: [], discovered: [], factions: {} });
    this.inventory.load({ nextUid: 1, items: [], equipped: {} });
    this.quests.load({});
    this.insights.load({ learned: [], counters: {} });
    this.loreRead.clear();
    this.enemies = [];
    this.projectiles = [];
    this.props = [];
    this.npcs = [];
    this.pickups = [];
    this.echoes = [];
    this.fx = new Fx();
    this.time = 0;
    this.playTime = 0;
    this.dead = false;
    this.currentZone = undefined;
    this.dialogue.close();
    this.invalidatePerks();
  }

  private loadRegion(id: string, at?: Vec): void {
    const region = this.content.regions[id];
    this.region = region;
    this.map = new TileMap(region, this.content.tiles);
    for (const [cx, cy] of this.world.brokenTiles) {
      const into = this.map.def(cx, cy)?.breakable?.into;
      if (into) this.map.set(cx, cy, into);
    }
    this.surfaces = new SurfaceGrid(this.map.w, this.map.h, new Rng(this.rng.int(1, 1e9)));
    for (let cy = 0; cy < this.map.h; cy++)
      for (let cx = 0; cx < this.map.w; cx++) {
        const d = this.map.def(cx, cy)!;
        if (d.liquid) this.surfaces.liquid[this.surfaces.idx(cx, cy)] = LIQUID_BY_NAME[d.liquid];
        if (d.flammable) this.surfaces.flammable[this.surfaces.idx(cx, cy)] = 1;
      }
    // deep water becomes walkable when frozen
    this.map.walkable = (cx, cy) => this.map.get(cx, cy) === "deep_water" && this.surfaces.getLiquid(cx, cy) === Liquid.Ice;
    this.paths = new PathField(this.map);
    this.explored = decodeBits(this.world.explored, this.map.w * this.map.h);
    this.exploredCount = this.explored.reduce((s, v) => s + v, 0);
    this.buildZones();
    this.refreshEdicts();
    this.surfaces.spreadAt = (cx, cy) => this.edictAtCell(cx, cy).fireSpread ?? 1;
    this.surfaces.listeners.push((r, cx, cy) => this.onReaction(r, cx, cy));
    for (const z of this.zoneList) this.initialInk[z.id] = this.countLiquid(z.id, Liquid.Ink);
    for (const z of this.zoneList) if (this.world.get(`ink_cleared_${z.id}`)) this.clearLiquid(z.id, "ink");

    this.spawned.clear();
    const s = region.spawns.find((x) => x.kind === "player");
    const start = s ? { x: (s.at[0] + 0.5) * region.tileSize, y: (s.at[1] + 0.5) * region.tileSize } : { x: 64, y: 64 };
    this.player = createPlayer(at ?? start);
    this.syncSpawns();
  }

  private spawned = new Set<string>();

  /**
   * Spawns everything whose `when` condition holds and that hasn't been removed.
   * Runs on load and whenever world state changes, so decisions can make NPCs,
   * props or creatures appear without any scripting.
   */
  syncSpawns(): void {
    if (!this.region) return;
    const ts = this.region.tileSize;
    for (const s of this.region.spawns) {
      if (s.kind === "player" || this.spawned.has(s.id)) continue;
      if (this.world.removedSpawns.has(s.id) || !evaluate(s.when, this)) continue;
      this.spawned.add(s.id);
      this.spawn(s.kind, s.ref, { x: (s.at[0] + 0.5) * ts, y: (s.at[1] + 0.5) * ts }, s.id, { ...(s.params ?? {}) });
    }
  }

  spawn(kind: "enemy" | "prop" | "npc", ref: string, pos: Vec, spawnId: string, params: Record<string, unknown> = {}): void {
    if (kind === "enemy") {
      const def = this.content.enemies[ref];
      if (!def) return console.warn("Unknown enemy", ref);
      this.enemies.push(createEnemy(def, pos, spawnId, this.zoneAt(pos)?.id ?? ""));
    } else if (kind === "prop") {
      const def = this.content.props[ref];
      if (!def) return console.warn("Unknown prop", ref);
      if (this.world.get(`lit_${spawnId}`)) params.lit = true;
      this.props.push({ id: newId(), def, spawnId, pos, hp: def.health ?? 1, used: this.world.usedSpawns.has(spawnId), dead: false, params });
    } else {
      const def = this.content.npcs[ref];
      if (!def) return console.warn("Unknown npc", ref);
      this.npcs.push({ id: newId(), def, spawnId, pos, facing: Math.PI / 2, barkT: 4 + Math.random() * 6 });
    }
  }

  // ---------------------------------------------------------------- zones & edicts

  private buildZones(): void {
    this.zoneList = this.region.zones.map((z) => this.content.zones[z]).filter(Boolean);
    this.zoneGrid = new Int16Array(this.map.w * this.map.h).fill(-1);
    this.zoneList.forEach((z, i) => {
      const [x, y, w, h] = z.rect;
      for (let cy = y; cy < y + h; cy++) for (let cx = x; cx < x + w; cx++) if (cx >= 0 && cy >= 0 && cx < this.map.w && cy < this.map.h) this.zoneGrid[cy * this.map.w + cx] = i;
    });
  }

  zoneAtCell(cx: number, cy: number): ZoneDef | undefined {
    if (cx < 0 || cy < 0 || cx >= this.map.w || cy >= this.map.h) return undefined;
    const i = this.zoneGrid[cy * this.map.w + cx];
    return i >= 0 ? this.zoneList[i] : undefined;
  }
  zoneAt(p: Vec): ZoneDef | undefined {
    return this.zoneAtCell(...this.map.cellAt(p));
  }
  /** Recomputes each zone's governing edict (world scars can rewrite them). */
  refreshEdicts(): void {
    if (!this.zoneList.length) return;
    this.zoneEdicts = this.zoneList.map((z) => {
      const alt = z.edictWhen?.find((w) => evaluate(w.if, this));
      return this.content.edicts[alt?.edict ?? z.edict] ?? this.content.edicts.blank;
    });
  }
  private zoneEdicts: EdictDef[] = [];

  /** The law currently governing a zone, after world scars. */
  zoneEdict(zoneId: string): EdictDef | undefined {
    const i = this.zoneList.findIndex((z) => z.id === zoneId);
    return i >= 0 ? this.zoneEdicts[i] : undefined;
  }

  edictAtCell(cx: number, cy: number): EdictDef {
    if (cx < 0 || cy < 0 || cx >= this.map.w || cy >= this.map.h) return this.content.edicts.blank;
    const i = this.zoneGrid[cy * this.map.w + cx];
    return i >= 0 ? this.zoneEdicts[i] : this.content.edicts.blank;
  }
  edictAt(p: Vec): EdictDef {
    return this.edictAtCell(...this.map.cellAt(p));
  }

  countLiquid(zoneId: string, l: Liquid): number {
    const z = this.content.zones[zoneId];
    if (!z) return 0;
    let n = 0;
    const [x, y, w, h] = z.rect;
    for (let cy = y; cy < y + h; cy++) for (let cx = x; cx < x + w; cx++) if (this.surfaces.getLiquid(cx, cy) === l) n++;
    return n;
  }

  private inkTick = 0;
  private onReaction(r: string, cx: number, cy: number): void {
    const zone = this.zoneAtCell(cx, cy)?.id ?? "";
    const pos = { x: (cx + 0.5) * this.map.ts, y: (cy + 0.5) * this.map.ts };
    this.fx.reaction(r, pos);
    if (r !== "steam" && r !== "melt" && r !== "extinguish" && r !== "freeze_water" && r !== "ink_purified") this.lightBraziers(pos, 30);
    if (r === "fire_spread" || r === "flame") return; // too frequent to broadcast
    this.bus.emit("SurfaceReacted", { reaction: r, zone, x: cx, y: cy });
    if (r === "ink_burn" && this.hasPerk("ink_reader") && this.time > this.inkTick && dist(pos, this.player.pos) < 6 * this.map.ts) {
      this.inkTick = this.time + 3;
      this.addEmber(1);
      this.fx.text(this.player.pos, "+1 Ember", "#ffb35c");
    }
    // ink burned off a spring leaves clean water behind
    if (r === "ink_purified" && this.map.get(cx, cy) === "ink_water") this.surfaces.setLiquid(cx, cy, Liquid.Water);
    if (r === "ink_purified" && zone && !this.world.get(`ink_cleared_${zone}`)) {
      const initial = this.initialInk[zone] ?? 0;
      if (initial >= 6 && this.countLiquid(zone, Liquid.Ink) <= initial * 0.2) {
        this.clearLiquid(zone, "ink");
        this.world.set(`ink_cleared_${zone}`, true);
        this.bus.emit("RealityShifted", { kind: "ink_cleared", zone });
        this.toast(`The ink in ${this.content.zones[zone]?.name ?? zone} burns away. The water runs clear.`);
      }
    }
  }

  // ---------------------------------------------------------------- loop

  update(dt: number): void {
    if (this.dead) {
      this.fx.update(dt);
      return;
    }
    if (this.hitstop > 0) {
      this.hitstop -= dt;
      this.fx.update(dt);
      return;
    }
    this.time += dt;
    this.playTime += dt;
    updatePlayer(this, dt);
    this.reveal();
    // terrain can change (broken walls, frozen pools), so force a rebuild now and then
    this.pathRefresh -= dt;
    this.paths.update(this.player.pos, this.pathRefresh <= 0);
    if (this.pathRefresh <= 0) this.pathRefresh = 1;
    for (const e of this.enemies) if (!e.dead) updateEnemy(this, e, dt);
    updateProjectiles(this, dt);
    this.surfaces.update(dt);
    updateSimulation(this, dt);
    this.focus = nearestInteractable(this);
    this.fx.update(dt);
    this.enemies = this.enemies.filter((e) => !e.dead);
    this.projectiles = this.projectiles.filter((p) => !p.dead);
    this.pickups = this.pickups.filter((p) => !p.dead);
    this.echoes = this.echoes.filter((e) => !e.dead);
    this.props = this.props.filter((p) => !p.dead);
  }

  interact(): void {
    if (this.focus) interact(this, this.focus);
  }

  // ---------------------------------------------------------------- actors helpers

  actorById(id: number | undefined): Actor | undefined {
    if (id === undefined) return undefined;
    if (id === 0) return this.player;
    return this.enemies.find((e) => e.id === id);
  }

  hostile(a: string, b: string): boolean {
    if (a === b) return false;
    return !!this.content.factions[a]?.hostileTo.includes(b) || !!this.content.factions[b]?.hostileTo.includes(a);
  }

  applyStatusTo(a: Actor, s: StatusId, duration?: number): void {
    const immune = "def" in a ? ((a as Enemy).def.immune ?? []) : [];
    const outcome = applyStatus(a.statuses, s, duration, immune);
    if (outcome === "immune") return;
    const isPlayer = a === this.player;
    if (outcome === "fizzled") {
      this.surfaces.addSteam(...this.map.cellAt(a.pos), 2);
      this.fx.text(a.pos, "fizzle", "#cfe3ee");
    } else if (outcome === "froze") {
      this.fx.text(a.pos, "FROZEN", "#bfe9ff");
    } else if (outcome === "flared") {
      this.fx.text(a.pos, "FLARE", "#ff9d3c");
    }
    const applied = outcome === "froze" ? "frozen" : outcome === "fizzled" ? "steam" : s;
    if (outcome !== "refreshed")
      this.bus.emit("StatusApplied", { targetId: isPlayer ? "player" : (a as Enemy).def.id, status: applied, isPlayer });
  }

  /** Lights unlit braziers near a point (any fire source). Remembered by the world. */
  lightBraziers(p: Vec, radius = 40): void {
    for (const pr of this.props) {
      if (pr.def.shape !== "brazier" || pr.params.lit || dist(pr.pos, p) > radius) continue;
      pr.params.lit = true;
      this.fx.reaction("ignite_oil", pr.pos);
      this.world.set(`lit_${pr.spawnId}`, true);
      this.bus.emit("PropInteracted", { propId: pr.def.id, spawnId: pr.spawnId, zone: this.zoneAt(pr.pos)?.id ?? "" });
    }
  }

  igniteAt(p: Vec, radiusTiles: number): void {
    const [cx, cy] = this.map.cellAt(p);
    this.surfaces.applyElementArea(cx, cy, radiusTiles, "fire");
  }

  shatter(e: Enemy): void {
    shatter(this, e);
  }

  damageEnemy = damageEnemy;
  damagePlayer = damagePlayer;
  killEnemy = killEnemy;

  // ---------------------------------------------------------------- perks

  invalidatePerks(): void {
    this.perkCache = undefined;
  }

  perkIds(): Set<string> {
    if (this.perkCache) return this.perkCache;
    const s = new Set<string>();
    for (const slot of ["weapon", "charm", "coat"] as const) {
      const it = this.inventory.equippedItem(slot);
      it?.perks.forEach((p) => s.add(p));
      it?.drawbacks.forEach((p) => s.add(p));
    }
    for (const t of this.progress?.traits ?? []) this.content.traits[t]?.perks.forEach((p) => s.add(p));
    this.insights.perks().forEach((p) => s.add(p));
    return (this.perkCache = s);
  }

  hasPerk(id: string): boolean {
    return this.perkIds().has(id);
  }

  perks(): Perk[] {
    return [...this.perkIds()].map((id) => PERKS[id]).filter(Boolean);
  }

  perkProduct(key: "frayMult" | "harvestFrayMult" | "dodgeCostMult" | "flaskRadiusMult" | "lootChanceMult" | "echoLifeMult"): number {
    return this.perks().reduce((m, p) => m * (p[key] ?? 1), 1);
  }

  // ---------------------------------------------------------------- resources

  addEmber(n: number): void {
    this.player.ember = Math.max(0, Math.min(this.player.maxEmber, this.player.ember + n));
  }

  addFray(n: number): void {
    const mult = n > 0 ? this.perkProduct("frayMult") * (1 - Math.min(0.5, this.progress.attributes.resolve * 0.04)) : 1;
    this.player.fray = Math.max(0, this.player.fray + n * mult);
  }

  healPlayer(n: number): void {
    const amount = n * (this.edictAt(this.player.pos).healing ?? 1);
    if (amount < 0) {
      damagePlayer(this, -amount, "echo", "edict");
      return;
    }
    const before = this.player.hp;
    this.player.hp = Math.min(this.player.maxHp, this.player.hp + amount);
    if (this.player.hp - before >= 1) this.fx.text(this.player.pos, `+${Math.round(this.player.hp - before)}`, "#7dff9a");
  }

  xpForNext(): number {
    return 100 * this.progress.level;
  }

  // ---------------------------------------------------------------- loot

  dropLoot(table: string, at: Vec, chanceMult = 1): void {
    const t = this.content.loot[table];
    if (!t) return;
    const tbl = chanceMult !== 1 && t.chance !== undefined ? { ...t, chance: Math.min(1, t.chance * chanceMult) } : t;
    const drops = rollLoot({ ...this.content, loot: { ...this.content.loot, [table]: tbl } }, table, this.rng);
    drops.forEach((d, i) => {
      const a = (i / Math.max(1, drops.length)) * Math.PI * 2 + this.rng.next();
      this.pickups.push({
        id: newId(),
        pos: { x: at.x + Math.cos(a) * 14, y: at.y + Math.sin(a) * 14 },
        item: d.item,
        count: d.count,
        affixes: d.affixes,
        t: 0,
        dead: false,
      });
    });
  }

  acquire(item: string, count: number, affixes: string[] = []): boolean {
    const def = this.content.items[item];
    if (!def) return false;
    const inst = this.inventory.add(item, count, affixes);
    if (!inst) {
      this.toast("Your pack is full.");
      return false;
    }
    const r = resolveItem(this.content, inst);
    this.bus.emit("ItemAcquired", { itemId: item, count, rarity: r.rarity });
    this.fx.text(this.player.pos, `${r.name}${count > 1 ? " ×" + count : ""}`, RARITY_COLOR[r.rarity]);
    if (def.type === "page" && def.lore) this.readLore(def.lore);
    return true;
  }

  readLore(id: string): void {
    const l = this.content.lore[id];
    if (!l) return;
    const first = !this.loreRead.has(id);
    this.loreRead.add(id);
    this.ui?.openLore(l.title, l.text);
    if (first) {
      applyEffects(l.effects, this);
      this.bus.emit("LoreRead", { loreId: id });
    }
  }

  // ---------------------------------------------------------------- save

  private reveal(): void {
    const [px, py] = this.map.cellAt(this.player.pos);
    const r = 7;
    for (let y = py - r; y <= py + r; y++)
      for (let x = px - r; x <= px + r; x++) {
        if (x < 0 || y < 0 || x >= this.map.w || y >= this.map.h || (x - px) ** 2 + (y - py) ** 2 > r * r) continue;
        const i = y * this.map.w + x;
        if (!this.explored[i]) {
          this.explored[i] = 1;
          this.exploredCount++;
        }
      }
  }

  makeSave(): SaveData {
    const p = this.player;
    this.world.explored = encodeBits(this.explored);
    return {
      version: SAVE_VERSION,
      savedAt: Date.now(),
      region: this.region.id,
      playTime: this.playTime,
      player: {
        ...this.progress,
        attributes: { ...this.progress.attributes },
        x: p.pos.x,
        y: p.pos.y,
        hp: p.hp,
        ember: p.ember,
        fray: p.fray,
      },
      inventory: this.inventory.serialize(),
      world: this.world.serialize(),
      quests: this.quests.serialize(),
      insights: this.insights.serialize(),
      lore: [...this.loreRead],
    };
  }

  save(): void {
    writeSave(this.storage, this.makeSave());
    this.bus.emit("GameSaved", { slot: "auto" });
  }

  // ---------------------------------------------------------------- RuleContext

  getFlag(key: string) {
    if (key.startsWith("faction.")) return this.world.factions[key.slice(8)] ?? 0;
    return this.world.get(key);
  }
  itemCount(id: string): number {
    return this.inventory.count(id);
  }
  hasInsight(id: string): boolean {
    return this.insights.has(id);
  }
  questState(id: string): QuestStateId {
    return this.quests.state(id);
  }
  questStage(id: string): string | undefined {
    return this.quests.stage(id);
  }
  attribute(a: AttributeId): number {
    return this.progress.attributes[a] ?? 0;
  }
  level(): number {
    return this.progress.level;
  }

  // ---------------------------------------------------------------- EffectHost

  setFlag(key: string, value: string | number | boolean): void {
    this.world.set(key, value);
  }
  giveItem(id: string, count: number): void {
    this.acquire(id, count);
  }
  takeItem(id: string, count: number): void {
    this.inventory.remove(id, count);
    this.invalidatePerks();
  }
  giveXp(n: number): void {
    this.progress.xp += n;
    this.fx.text({ x: this.player.pos.x, y: this.player.pos.y - 20 }, `+${n} XP`, "#d9c38a");
    while (this.progress.xp >= this.xpForNext()) {
      this.progress.xp -= this.xpForNext();
      this.progress.level++;
      this.progress.unspent++;
      this.progress.pendingTraits++;
      this.bus.emit("LevelUp", { level: this.progress.level });
      this.toast(`Level ${this.progress.level}. Choose a trait and spend an attribute point (I).`);
      recomputePlayerStats(this);
      this.player.hp = this.player.maxHp;
    }
  }
  startQuest(id: string): void {
    this.quests.start(id);
  }
  setStage(quest: string, stage: string): void {
    this.quests.setStage(quest, stage);
  }
  completeQuest(id: string, outcome?: string): void {
    this.quests.complete(id, outcome);
  }
  failQuest(id: string): void {
    this.quests.fail(id);
  }
  grantInsight(id: string): void {
    this.insights.grant(id);
  }
  learnAbility(id: string): void {
    const a = this.content.abilities[id];
    if (!a || this.progress.abilities.includes(id)) return;
    this.progress.abilities = this.progress.abilities.filter((x) => this.content.abilities[x]?.key !== a.key);
    this.progress.abilities.push(id);
    this.toast(`New ability [${a.key}]: ${a.name} — ${a.description}`);
  }
  changeFaction(id: string, delta: number): void {
    this.world.changeFaction(id, delta);
    const f = this.content.factions[id];
    this.toast(`${f?.name ?? id}: ${delta > 0 ? "+" : ""}${delta} standing`);
  }
  toast(text: string, kind?: string): void {
    this.bus.emit("Toast", { text, kind });
  }
  heal(n: number): void {
    this.healPlayer(n);
  }
  clearLiquid(zoneId: string, liquid: LiquidId): void {
    const z = this.content.zones[zoneId];
    if (!z) return;
    const l = LIQUID_BY_NAME[liquid];
    const [x, y, w, h] = z.rect;
    for (let cy = y; cy < y + h; cy++)
      for (let cx = x; cx < x + w; cx++) if (this.surfaces.getLiquid(cx, cy) === l) this.surfaces.setLiquid(cx, cy, this.map.get(cx, cy).includes("water") ? Liquid.Water : Liquid.None);
  }
  emitCustom(name: string, payload?: Record<string, unknown>): void {
    if (name === "RealityShifted") this.bus.emit("RealityShifted", { kind: String(payload?.kind ?? ""), zone: String(payload?.zone ?? "") });
    else console.warn("Unknown custom event", name);
  }
  elementAt(p: Vec, el: Element, radiusTiles = 0.6): void {
    const [cx, cy] = this.map.cellAt(p);
    this.surfaces.applyElementArea(cx, cy, radiusTiles, el);
  }
}

export const RARITY_COLOR: Record<string, string> = {
  common: "#d8d2c4",
  uncommon: "#7fd17a",
  rare: "#6fb3ff",
  relic: "#ffb347",
};

/** Packs a 0/1 array into base64 (compact enough for localStorage). */
export function encodeBits(bits: Uint8Array): string {
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) if (bits[i]) bytes[i >> 3] |= 1 << (i & 7);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function decodeBits(b64: string, n: number): Uint8Array {
  const out = new Uint8Array(n);
  if (!b64) return out;
  try {
    const s = atob(b64);
    for (let i = 0; i < n; i++) out[i] = (s.charCodeAt(i >> 3) >> (i & 7)) & 1;
  } catch {
    /* corrupt or missing: start unexplored */
  }
  return out;
}
