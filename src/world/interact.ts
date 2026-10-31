// "E" interactions: NPCs, props (chests, pages, waystones, wells...) and echoes.
import { dist } from "../core/math.js";
import type { Echo, Npc, Prop } from "../entities/entities.js";
import type { Game } from "../game.js";
import { applyEffects, evaluate } from "../narrative/rules.js";
import { recomputePlayerStats } from "../entities/player.js";
import { t } from "../i18n/i18n.js";

export type Interactable =
  | { kind: "npc"; npc: Npc; prompt: string; pos: { x: number; y: number } }
  | { kind: "prop"; prop: Prop; prompt: string; pos: { x: number; y: number } }
  | { kind: "echo"; echo: Echo; prompt: string; pos: { x: number; y: number } };

const RANGE = 44;

export function nearestInteractable(g: Game): Interactable | undefined {
  const p = g.player.pos;
  let best: Interactable | undefined;
  let bestD = RANGE;
  for (const n of g.npcs) {
    const d = dist(n.pos, p) - 10;
    if (d < bestD) {
      bestD = d;
      best = { kind: "npc", npc: n, prompt: t("prompt.speak", { name: n.def.name }), pos: n.pos };
    }
  }
  for (const pr of g.props) {
    const it = pr.def.interact;
    if (pr.dead || !it) continue;
    if (pr.used && it.once) continue;
    if (!evaluate(it.if, g)) continue;
    const d = dist(pr.pos, p) - pr.def.radius;
    if (d < bestD) {
      bestD = d;
      best = { kind: "prop", prop: pr, prompt: it.prompt, pos: pr.pos };
    }
  }
  for (const ec of g.echoes) {
    if (ec.dead) continue;
    const d = dist(ec.pos, p);
    if (d < bestD) {
      bestD = d;
      const name = g.content.enemies[ec.enemyId]?.name ?? "creature";
      best = { kind: "echo", echo: ec, prompt: t("prompt.harvest", { name }), pos: ec.pos };
    }
  }
  return best;
}

export function interact(g: Game, it: Interactable): void {
  if (it.kind === "npc") {
    g.bus.emit("NPCSpokenTo", { npcId: it.npc.def.id });
    if (g.dialogue.start(it.npc.def.dialogue, it.npc.def.name)) g.ui?.openDialogue();
    return;
  }
  if (it.kind === "echo") return harvest(g, it.echo);

  const pr = it.prop;
  const def = pr.def;
  const ia = def.interact!;
  const zone = g.zoneAt(pr.pos)?.id ?? "";
  if (def.shape === "waystone") {
    const p = g.player;
    recomputePlayerStats(g);
    p.hp = p.maxHp;
    p.fray = 0;
    p.ember = p.maxEmber;
    p.statuses = {};
    g.progress.waystone = [pr.pos.x, pr.pos.y + 28];
    g.fx.rest(pr.pos);
    g.toast(t("toast.rest"));
  }
  applyEffects(ia.effects, g);
  // spawn params can override what a generic prop (chest, page, corpse) contains
  const loot = (pr.params.loot as string | undefined) ?? ia.loot;
  const lore = (pr.params.lore as string | undefined) ?? ia.lore;
  const dialogue = (pr.params.dialogue as string | undefined) ?? ia.dialogue;
  if (loot) g.dropLoot(loot, { x: pr.pos.x, y: pr.pos.y + 18 });
  if (lore) g.readLore(lore);
  if (dialogue && g.dialogue.start(dialogue, def.name)) g.ui?.openDialogue();
  if (ia.once) {
    pr.used = true;
    g.world.usedSpawns.add(pr.spawnId);
    if (def.shape === "page") {
      pr.dead = true;
      g.world.removedSpawns.add(pr.spawnId);
    }
  }
  g.bus.emit("PropInteracted", { propId: def.id, spawnId: pr.spawnId, zone });
  if (def.shape === "waystone") g.save();
}

export function harvest(g: Game, ec: Echo): void {
  ec.dead = true;
  const inReturn = !!g.edictAt(ec.pos).deadRise;
  const fray = inReturn && g.hasPerk("return_knowing") ? 0 : 10 * g.perkProduct("harvestFrayMult");
  g.addEmber(1);
  g.addFray(fray);
  g.perks().forEach((p) => p.onHarvest?.(g));
  g.fx.harvest(ec.pos, g.player.pos);
  g.fx.text(g.player.pos, t("fx.ember", { n: 1 }), "#ffb35c");
  g.bus.emit("EchoHarvested", { enemyId: ec.enemyId, zone: g.zoneAt(ec.pos)?.id ?? "" });
}
