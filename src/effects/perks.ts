// Perk registry: qualitative effects referenced by id from items, affixes,
// traits and insights. Data says *which* perks; this file says *what they do*.
// To add a perk: add an entry here, then reference its id from any JSON file.
import type { Enemy } from "../entities/entities.js";
import type { Element } from "../data/types.js";
import type { Game } from "../game.js";
import { t, tx } from "../i18n/i18n.js";

export interface HitInfo {
  target: Enemy;
  heavy: boolean;
  element: Element;
  fromBehind: boolean;
  melee: boolean;
  /** Position in the light-attack combo (1-3), 0 for heavies and spells. */
  combo: number;
}

export interface Perk {
  text: string;
  /** Multiplies outgoing damage. */
  damageMult?(g: Game, h: HitInfo): number;
  /** Guaranteed or extra crit. */
  crit?(g: Game, h: HitInfo): boolean;
  onHit?(g: Game, h: HitInfo): void;
  onKill?(g: Game, e: Enemy): void;
  onHarvest?(g: Game): void;
  onDodge?(g: Game): void;
  onPerfectDodge?(g: Game): void;
  /** Multiplies fray gained from any source. */
  frayMult?: number;
  /** Multiplies fray gained from harvesting echoes. */
  harvestFrayMult?: number;
  dodgeCostMult?: number;
  fireproofGround?: boolean;
  flaskRadiusMult?: number;
  lootChanceMult?: number;
  echoLifeMult?: number;
}

const isHound = (e: Enemy) => e.def.id.includes("hound");

export const PERKS: Record<string, Perk> = {
  ignite_on_heavy: {
    text: "Heavy attacks ignite what they strike — and the ground beneath it.",
    onHit(g, h) {
      if (!h.heavy || !h.melee) return;
      g.applyStatusTo(h.target, "burning");
      g.igniteAt(h.target.pos, 0.6);
    },
  },
  kindled_edge: {
    text: "Light attacks have a 1 in 4 chance to set the target burning.",
    onHit(g, h) {
      if (h.melee && !h.heavy && g.rng.chance(0.25)) g.applyStatusTo(h.target, "burning");
    },
  },
  rime_edge: {
    text: "Melee hits chill. Chilling a wet target freezes it solid.",
    onHit(g, h) {
      if (h.melee) g.applyStatusTo(h.target, "chilled");
    },
  },
  shatter: {
    text: "Heavy attacks against frozen enemies shatter the ice, dealing damage to everything nearby.",
    onHit(g, h) {
      if (h.heavy && h.melee && h.target.statuses.frozen) g.shatter(h.target);
    },
  },
  backstab: {
    text: "Attacks from behind deal double damage.",
    damageMult: (_g, h) => (h.fromBehind ? 2 : 1),
  },
  ember_hunger: {
    text: "Killing blows restore 1 Ember.",
    onKill(g) {
      g.addEmber(1);
    },
  },
  unwritten_edge: {
    text: "Each hit adds 2 Fray to you.",
    onHit(g, h) {
      if (h.melee) g.addFray(2);
    },
  },
  echo_eater: {
    text: "Harvesting an echo heals you for 12.",
    onHarvest(g) {
      g.healPlayer(12);
    },
  },
  choir_hunger: {
    text: "Harvesting echoes adds double Fray.",
    harvestFrayMult: 2,
  },
  ashwalker: {
    text: "Burning ground does not harm you.",
    fireproofGround: true,
  },
  hound_lore: {
    text: "Burning Mire Hounds panic: you deal +60% damage to them.",
    damageMult: (_g, h) => (isHound(h.target) && h.target.statuses.burning ? 1.6 : 1),
  },
  thrall_rhythm: {
    text: "A perfect dodge primes your next attack as a guaranteed critical.",
    onPerfectDodge(g) {
      g.player.critReady = 1.5;
    },
  },
  ink_reader: {
    text: "Burning ink near you condenses into Ember.",
  },
  return_knowing: {
    text: "Harvesting echoes under an Edict of Return adds no Fray.",
  },
  smoke_step: {
    text: "Dodging leaves a puff of steam. Enemies inside steam lose sight of you.",
    onDodge(g) {
      g.surfaces.addSteam(...g.map.cellAt(g.player.pos), 2.5);
    },
  },
  flask_master: {
    text: "Thrown flasks splash twice as wide.",
    flaskRadiusMult: 2,
  },
  heavy_hand: {
    text: "Heavy attacks always stagger and knock targets far back.",
  },
  cold_blood: {
    text: "Below 35% health, your hits chill.",
    onHit(g, h) {
      if (g.player.hp < g.player.maxHp * 0.35) g.applyStatusTo(h.target, "chilled");
    },
  },
  scavenger_sense: {
    text: "Creatures drop loot more often and echoes linger twice as long.",
    lootChanceMult: 1.8,
    echoLifeMult: 2,
  },
  steady_mind: {
    text: "You gain 40% less Fray from casting.",
    frayMult: 0.6,
  },
  tolling_blow: {
    text: "The third strike of a light combo tolls like a bell, stunning the target.",
    onHit(g, h) {
      if (h.combo === 3) {
        g.applyStatusTo(h.target, "stunned", 1.1);
        g.fx.text(h.target.pos, t("fx.dong"), "#c9b8ff");
      }
    },
  },
  fray_conduit: {
    text: "Spells cast above 50 Fray deal double damage instead of +50%.",
  },
};

export function perkText(id: string): string {
  return tx(`perk.${id}`, PERKS[id]?.text ?? id);
}
