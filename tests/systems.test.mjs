// Unit tests for deterministic systems. Run with `npm test` (builds first).
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { bundleData } from "../scripts/data-lib.mjs";

const js = (p) => import(new URL(`../dist/js/${p}`, import.meta.url).href);
const { applyStatus, computeDamage } = await js("combat/damage.js");
const { SurfaceGrid, Liquid } = await js("world/surfaces.js");
const { Rng } = await js("core/math.js");
const { Inventory, resolveItem } = await js("items/inventory.js");
const { rollLoot } = await js("items/loot.js");
const { EventBus } = await js("core/events.js");
const { QuestSystem } = await js("quests/quests.js");
const { evaluate, applyEffects, skillCheck } = await js("narrative/rules.js");
const { migrate, SAVE_VERSION, writeSave, readSave } = await js("save/save.js");
const { bundle: content } = bundleData(join(import.meta.dirname, "..", "data"));

test("fire on a wet target fizzles; frost on a wet target freezes; oil flares", () => {
  const s = { wet: 5 };
  assert.equal(applyStatus(s, "burning"), "fizzled");
  assert.equal(s.burning, undefined);
  const t = { wet: 5 };
  assert.equal(applyStatus(t, "chilled"), "froze");
  assert.ok(t.frozen > 0);
  const o = { oiled: 5 };
  assert.equal(applyStatus(o, "burning"), "flared");
  assert.ok(o.burning >= 8);
  assert.equal(applyStatus({}, "burning", 4, ["burning"]), "immune");
});

test("damage respects resistances, oil and frozen shatter", () => {
  assert.equal(computeDamage({ base: 10, element: "fire", resist: { fire: 0.5 } }).amount, 5);
  assert.equal(computeDamage({ base: 10, element: "fire", targetStatuses: { oiled: 1 } }).amount, 15);
  const sh = computeDamage({ base: 10, element: "physical", heavy: true, targetStatuses: { frozen: 1 } });
  assert.equal(sh.amount, 20);
  assert.ok(sh.shattered);
});

test("surfaces: burning oil spreads and burns out, ink purifies, water steams, frost makes ice", () => {
  const g = new SurfaceGrid(10, 1, new Rng(1));
  const seen = [];
  g.listeners.push((r) => seen.push(r));
  for (let x = 0; x < 5; x++) g.setLiquid(x, 0, Liquid.Oil);
  g.setLiquid(6, 0, Liquid.Ink);
  g.setLiquid(8, 0, Liquid.Water);
  g.ignite(0, 0);
  for (let i = 0; i < 400; i++) g.update(0.05);
  for (let x = 0; x < 5; x++) assert.equal(g.getLiquid(x, 0), Liquid.None, `oil at ${x} should have burned away`);
  assert.ok(seen.includes("fire_spread"));
  g.ignite(6, 0);
  for (let i = 0; i < 100; i++) g.update(0.05);
  assert.equal(g.getLiquid(6, 0), Liquid.None);
  assert.ok(seen.includes("ink_purified"));
  assert.equal(g.ignite(8, 0), "steam");
  assert.ok(g.hasSteam(8, 0));
  assert.equal(g.chill(8, 0), "freeze_water");
  assert.equal(g.getLiquid(8, 0), Liquid.Ice);
});

test("inventory stacks consumables, equips gear and survives serialization", () => {
  const inv = new Inventory(content);
  inv.add("ashbread", 2);
  inv.add("ashbread", 3);
  assert.equal(inv.items.length, 1);
  assert.equal(inv.count("ashbread"), 5);
  const blade = inv.add("iron_hatchet", 1, ["kindled", "of_shattering"]);
  assert.equal(inv.equip(blade.uid), "weapon");
  const r = resolveItem(content, blade);
  assert.equal(r.name, "Kindled Iron Hatchet of Shattering");
  assert.deepEqual(r.perks.sort(), ["kindled_edge", "shatter"]);
  assert.ok(inv.remove("ashbread", 5));
  assert.equal(inv.count("ashbread"), 0);
  const copy = new Inventory(content);
  copy.load(JSON.parse(JSON.stringify(inv.serialize())));
  assert.equal(copy.equippedItem("weapon").name, r.name);
});

test("loot rolls are deterministic for a seed and only produce known items", () => {
  const a = rollLoot(content, "chapel_hoard", new Rng(42));
  const b = rollLoot(content, "chapel_hoard", new Rng(42));
  assert.deepEqual(a, b);
  assert.ok(a.length > 0);
  for (const d of a) assert.ok(content.items[d.item]);
  for (let s = 1; s < 200; s++) for (const d of rollLoot(content, "gear_any", new Rng(s))) assert.ok(d.affixes.length <= 2);
});

test("conditions and skill checks", () => {
  const ctx = {
    getFlag: (k) => ({ a: 3, b: "x" })[k],
    itemCount: () => 1,
    hasInsight: (i) => i === "known",
    questState: () => "active",
    questStage: () => "deal",
    attribute: () => 4,
    level: () => 2,
  };
  assert.ok(evaluate({ all: [{ flag: "a", gte: 2 }, { flag: "b", eq: "x" }, { insight: "known" }] }, ctx));
  assert.ok(!evaluate({ not: { quest: "q", state: "active", stage: "deal" } }, ctx));
  assert.ok(evaluate({ flag: "missing", exists: false }, ctx));
  assert.ok(skillCheck(4, 12, 8).success);
  assert.ok(!skillCheck(4, 12, 7).success);
  assert.ok(skillCheck(0, 30, 20).success, "natural 20 always succeeds");
  assert.ok(!skillCheck(20, 2, 1).success, "natural 1 always fails");
});

test("the well quest advances from events and branches on world state", () => {
  const bus = new EventBus();
  const flags = {};
  const q = new QuestSystem(content.quests, bus);
  const host = {
    setFlag: (k, v) => {
      flags[k] = v;
      bus.emit("WorldStateChanged", { key: k, value: v });
    },
    getFlag: (k) => flags[k],
    giveXp() {}, giveItem() {}, takeItem() {}, toast() {}, heal() {}, addFray() {}, clearLiquid() {}, emitCustom() {},
    grantInsight() {}, learnAbility() {}, changeFaction() {},
    startQuest: (id) => q.start(id),
    setStage: (a, b) => q.setStage(a, b),
    completeQuest: (a, b) => q.complete(a, b),
    failQuest: (a) => q.fail(a),
  };
  q.host = host;
  q.rules = { getFlag: (k) => flags[k], itemCount: () => 0, hasInsight: () => false, questState: (i) => q.state(i), questStage: (i) => q.stage(i), attribute: () => 2, level: () => 1 };
  q.start("q_fouled_well");
  assert.equal(q.stage("q_fouled_well"), "find_spring");
  bus.emit("AreaEntered", { zone: "orchard_spring", edict: "kindling", first: true });
  assert.equal(q.stage("q_fouled_well"), "deal");
  host.setFlag("spring_state", "burned_clean");
  assert.equal(q.stage("q_fouled_well"), "report");
  applyEffects([{ completeQuest: "q_fouled_well", outcome: "burned" }], host);
  assert.equal(q.state("q_fouled_well"), "completed");
  assert.equal(flags.well_clean, true);
});

test("quest started after the problem was already solved skips straight to reporting", () => {
  const bus = new EventBus();
  const flags = { spring_state: "leech_slain" };
  const q = new QuestSystem(content.quests, bus);
  q.host = { getFlag: (k) => flags[k], setFlag() {}, toast() {} };
  q.rules = { getFlag: (k) => flags[k], itemCount: () => 0, hasInsight: () => false, questState: (i) => q.state(i), questStage: (i) => q.stage(i), attribute: () => 2, level: () => 1 };
  q.start("q_fouled_well");
  assert.equal(q.stage("q_fouled_well"), "report");
});

test("saves round-trip and reject unknown versions", () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  const data = { version: SAVE_VERSION, savedAt: 1, region: "cinder_vale", playTime: 3, player: {}, inventory: {}, world: {}, quests: {}, insights: {}, lore: [] };
  writeSave(storage, data);
  assert.deepEqual(readSave(storage), data);
  assert.throws(() => migrate({ version: SAVE_VERSION + 1 }));
  assert.throws(() => migrate({}));
});

test("flow field routes around a wall through the gap", async () => {
  const { TileMap } = await js("world/tilemap.js");
  const { PathField } = await js("ai/pathfield.js");
  const region = {
    id: "t", tileSize: 32, legend: { "#": "rock", ".": "ash" }, zones: [], spawns: [],
    map: ["#######", "#.....#", "#.###.#", "#..#..#", "#######"],
  };
  const map = new TileMap(region, content.tiles);
  const pf = new PathField(map);
  pf.update({ x: 4.5 * 32, y: 3.5 * 32 }); // target on the right of the wall
  let pos = { x: 1.5 * 32, y: 3.5 * 32 }; // creature on the left
  const visited = [];
  for (let i = 0; i < 12; i++) {
    const step = pf.nextStep(pos);
    if (!step) break;
    pos = step;
    visited.push(map.cellAt(pos).join(","));
  }
  assert.ok(visited.includes("3,1"), `path should go over the top of the wall: ${visited}`);
  assert.equal(visited.at(-1), "4,3");
});

test("explored bitmap survives encode/decode", async () => {
  const { encodeBits, decodeBits } = await js("game.js");
  const bits = new Uint8Array(4800);
  for (let i = 0; i < bits.length; i += 7) bits[i] = 1;
  assert.deepEqual(decodeBits(encodeBits(bits), bits.length), bits);
  assert.equal(decodeBits("", 10).reduce((a, b) => a + b, 0), 0);
});
