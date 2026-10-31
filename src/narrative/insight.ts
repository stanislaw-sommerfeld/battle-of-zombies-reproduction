// Knowledge as progression. Insights are learned by observing the world
// (events), reading lore or conversation, and grant qualitative perks.
import type { EventBus, EventName } from "../core/events.js";
import type { InsightDef } from "../data/types.js";
import { applyEffects, matches, type EffectHost } from "./rules.js";
import { t } from "../i18n/i18n.js";

export class InsightSystem {
  learned = new Set<string>();
  counters: Record<string, number> = {};
  host!: EffectHost;

  constructor(private defs: Record<string, InsightDef>, private bus: EventBus) {
    bus.onAny((name, payload) => this.onEvent(name, payload));
  }

  has(id: string): boolean {
    return this.learned.has(id);
  }

  grant(id: string): void {
    const def = this.defs[id];
    if (!def || this.learned.has(id)) return;
    this.learned.add(id);
    this.bus.emit("InsightGained", { insightId: id });
    this.bus.emit("Toast", { text: t("toast.insight", { name: def.name, text: def.text }), kind: "insight" });
    if (this.host) {
      if (def.xp) this.host.giveXp(def.xp);
      applyEffects(def.effects, this.host);
    }
  }

  perks(): string[] {
    const out: string[] = [];
    for (const id of this.learned) out.push(...(this.defs[id]?.perks ?? []));
    return out;
  }

  private onEvent(name: EventName, payload: Record<string, unknown>): void {
    if (name === "InsightGained") return;
    for (const id in this.defs) {
      if (this.learned.has(id)) continue;
      const def = this.defs[id];
      def.learnOn?.forEach((l, i) => {
        if (l.event !== name || !matches(payload, l.match)) return;
        const key = `${id}:${i}`;
        this.counters[key] = (this.counters[key] ?? 0) + 1;
        if (this.counters[key] >= (l.count ?? 1)) this.grant(id);
      });
    }
  }

  serialize() {
    return { learned: [...this.learned], counters: { ...this.counters } };
  }
  load(d: { learned: string[]; counters: Record<string, number> }): void {
    this.learned = new Set(d.learned.filter((id) => this.defs[id]));
    this.counters = { ...d.counters };
  }
}
