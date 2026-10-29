// World rules: "when X happens anywhere, the world remembers Y".
// Independent of quests, so consequences apply even if the player never took
// the related quest (e.g. killing the Matron before meeting the Warden).
import type { EventBus } from "../core/events.js";
import type { Condition, Effect } from "../data/types.js";
import { applyEffects, evaluate, matches, type EffectHost, type RuleContext } from "./rules.js";

export interface WorldRuleDef {
  id: string;
  on: string;
  match?: Record<string, string | number | boolean>;
  if?: Condition;
  effects: Effect[];
  /** Fire only once per playthrough (default true). */
  once?: boolean;
}

export class WorldRules {
  host!: EffectHost & RuleContext;

  constructor(private defs: Record<string, WorldRuleDef>, bus: EventBus) {
    bus.onAny((name, payload) => {
      if (!this.host) return;
      for (const id in this.defs) {
        const r = this.defs[id];
        if (r.on !== name || !matches(payload, r.match)) continue;
        const key = `rule.${id}`;
        if (r.once !== false && this.host.getFlag(key)) continue;
        if (!evaluate(r.if, this.host)) continue;
        if (r.once !== false) this.host.setFlag(key, true);
        applyEffects(r.effects, this.host);
      }
    });
  }
}
