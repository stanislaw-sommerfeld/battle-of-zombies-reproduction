// Cross-reference checker for /data. Run with `npm run validate` (after a build,
// because it reads the perk registry from dist/js).
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bundleData } from "./data-lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { bundle: c, errors } = bundleData(join(root, "data"));
const { PERKS } = await import(pathToFileURL(join(root, "dist/js/effects/perks.js")).href);
const err = (m) => errors.push(m);
const has = (cat, id, where) => {
  if (!c[cat]?.[id]) err(`${where}: unknown ${cat} "${id}"`);
};

const EVENTS = new Set([
  "EnemyKilled", "EnemyDamaged", "PlayerDamaged", "PlayerDied", "ItemAcquired", "ItemEquipped", "ItemUsed", "AreaEntered",
  "NPCSpokenTo", "DialogueChoice", "SkillCheck", "QuestStarted", "QuestStageChanged", "QuestCompleted", "FactionChanged",
  "WorldStateChanged", "InsightGained", "LoreRead", "StatusApplied", "SurfaceReacted", "PropBroken", "PropInteracted",
  "TileBroken", "EchoHarvested", "EchoRisen", "EchoEaten", "RealityShifted", "PerfectDodge", "AbilityCast", "LevelUp", "Check",
]);

function checkCondition(cond, where) {
  if (!cond) return;
  if (cond.all) return cond.all.forEach((x) => checkCondition(x, where));
  if (cond.any) return cond.any.forEach((x) => checkCondition(x, where));
  if (cond.not) return checkCondition(cond.not, where);
  if (cond.hasItem) has("items", cond.hasItem, where);
  if (cond.insight) has("insights", cond.insight, where);
  if (cond.quest) has("quests", cond.quest, where);
}
function checkEffects(effects, where) {
  for (const e of effects ?? []) {
    if (e.giveItem) has("items", e.giveItem, where);
    if (e.takeItem) has("items", e.takeItem, where);
    if (e.startQuest) has("quests", e.startQuest, where);
    if (e.completeQuest) {
      has("quests", e.completeQuest, where);
      if (e.outcome && !c.quests[e.completeQuest]?.outcomes[e.outcome]) err(`${where}: quest ${e.completeQuest} has no outcome "${e.outcome}"`);
    }
    if (e.grantInsight) has("insights", e.grantInsight, where);
    if (e.readLore) has("lore", e.readLore, where);
    if (e.learnAbility) has("abilities", e.learnAbility, where);
    if (e.faction) has("factions", e.faction, where);
    if (e.clearLiquid) has("zones", e.clearLiquid.zone, where);
  }
}
const perks = (list, where) => (list ?? []).forEach((p) => PERKS[p] || err(`${where}: unknown perk "${p}"`));

for (const i of Object.values(c.items)) {
  perks(i.perks, `item ${i.id}`);
  perks(i.drawbacks, `item ${i.id}`);
  if (i.lore) has("lore", i.lore, `item ${i.id}`);
  checkEffects(i.use, `item ${i.id}`);
}
for (const a of Object.values(c.affixes)) {
  perks(a.perks, `affix ${a.id}`);
  perks(a.drawbacks, `affix ${a.id}`);
}
for (const t of Object.values(c.loot))
  t.entries.forEach((e) => (e.item ? has("items", e.item, `loot ${t.id}`) : e.table ? has("loot", e.table, `loot ${t.id}`) : err(`loot ${t.id}: entry needs item or table`)));
for (const e of Object.values(c.enemies)) {
  has("factions", e.faction, `enemy ${e.id}`);
  if (e.loot) has("loot", e.loot, `enemy ${e.id}`);
  if (e.risesAs) has("enemies", e.risesAs, `enemy ${e.id}`);
  checkCondition(e.departsWhen, `enemy ${e.id}`);
  if (!e.attacks?.length) err(`enemy ${e.id}: needs at least one attack`);
}
for (const f of Object.values(c.factions)) f.hostileTo.forEach((h) => has("factions", h, `faction ${f.id}`));
for (const t of Object.values(c.traits)) perks(t.perks, `trait ${t.id}`);
for (const i of Object.values(c.insights)) {
  perks(i.perks, `insight ${i.id}`);
  checkEffects(i.effects, `insight ${i.id}`);
  (i.learnOn ?? []).forEach((l) => EVENTS.has(l.event) || err(`insight ${i.id}: unknown event ${l.event}`));
}
for (const l of Object.values(c.lore)) checkEffects(l.effects, `lore ${l.id}`);
for (const o of Object.values(c.origins)) {
  [...o.items, ...o.equip].forEach((i) => has("items", i, `origin ${o.id}`));
  if (o.trait) has("traits", o.trait, `origin ${o.id}`);
}
for (const p of Object.values(c.props)) {
  if (p.interact?.lore) has("lore", p.interact.lore, `prop ${p.id}`);
  if (p.interact?.loot) has("loot", p.interact.loot, `prop ${p.id}`);
  if (p.interact?.dialogue) has("dialogue", p.interact.dialogue, `prop ${p.id}`);
  if (p.onBreak?.loot) has("loot", p.onBreak.loot, `prop ${p.id}`);
  checkEffects(p.interact?.effects, `prop ${p.id}`);
}
for (const n of Object.values(c.npcs)) has("dialogue", n.dialogue, `npc ${n.id}`);
for (const d of Object.values(c.dialogue)) {
  const where = `dialogue ${d.id}`;
  d.entries.forEach((e) => {
    checkCondition(e.if, where);
    if (!d.nodes[e.node]) err(`${where}: entry points to missing node "${e.node}"`);
  });
  for (const [nid, n] of Object.entries(d.nodes)) {
    checkEffects(n.effects, `${where}.${nid}`);
    (n.variants ?? []).forEach((v) => checkCondition(v.if, `${where}.${nid}`));
    n.options.forEach((o, i) => {
      const w = `${where}.${nid}[${i}]`;
      checkCondition(o.if, w);
      checkEffects(o.effects, w);
      checkEffects(o.failEffects, w);
      for (const g of [o.goto, o.failGoto]) if (g && g !== "end" && !d.nodes[g]) err(`${w}: goto missing node "${g}"`);
    });
  }
}
for (const q of Object.values(c.quests)) {
  if (!q.stages[q.start]) err(`quest ${q.id}: start stage "${q.start}" missing`);
  for (const [sid, s] of Object.entries(q.stages))
    s.triggers.forEach((t, i) => {
      const w = `quest ${q.id}.${sid}[${i}]`;
      if (!EVENTS.has(t.event)) err(`${w}: unknown event ${t.event}`);
      if (t.to && !q.stages[t.to]) err(`${w}: stage "${t.to}" missing`);
      if (t.complete && !q.outcomes[t.complete]) err(`${w}: outcome "${t.complete}" missing`);
      checkCondition(t.if, w);
      checkEffects(t.effects, w);
    });
  for (const [oid, o] of Object.entries(q.outcomes)) checkEffects(o.effects, `quest ${q.id} outcome ${oid}`);
}
for (const r of Object.values(c.rules ?? {})) {
  if (!EVENTS.has(r.on)) err(`rule ${r.id}: unknown event ${r.on}`);
  checkCondition(r.if, `rule ${r.id}`);
  checkEffects(r.effects, `rule ${r.id}`);
}
for (const z of Object.values(c.zones)) {
  has("edicts", z.edict, `zone ${z.id}`);
  (z.edictWhen ?? []).forEach((w) => {
    has("edicts", w.edict, `zone ${z.id}`);
    checkCondition(w.if, `zone ${z.id}`);
  });
}
for (const r of Object.values(c.regions)) {
  const where = `region ${r.id}`;
  r.zones.forEach((z) => has("zones", z, where));
  const legend = r.legend;
  for (const ch of new Set(r.map.join(""))) if (!legend[ch]) err(`${where}: map char '${ch}' missing from legend`);
  Object.values(legend).forEach((t) => has("tiles", t, where));
  const ids = new Set();
  for (const s of r.spawns) {
    if (ids.has(s.id)) err(`${where}: duplicate spawn id ${s.id}`);
    ids.add(s.id);
    const w = `${where} spawn ${s.id}`;
    if (s.kind === "enemy") has("enemies", s.ref, w);
    if (s.kind === "prop") has("props", s.ref, w);
    if (s.kind === "npc") has("npcs", s.ref, w);
    checkCondition(s.when, w);
    if (s.params?.lore) has("lore", s.params.lore, w);
    if (s.params?.loot) has("loot", s.params.loot, w);
    const [x, y] = s.at;
    const tile = c.tiles[legend[r.map[y]?.[x]]];
    if (!tile) err(`${w}: outside the map`);
    else if (tile.solid) err(`${w}: placed on solid tile ${tile.id} at ${x},${y}`);
  }
}
if (!c.edicts.blank) err("edicts: a 'blank' edict is required");

if (errors.length) {
  console.error(`Data validation failed (${errors.length}):\n  ` + errors.join("\n  "));
  process.exit(1);
}
const counts = Object.entries(c).map(([k, v]) => `${k}:${Object.keys(v).length}`).join(" ");
console.log(`Data OK (${counts})`);
