// Data-driven quest state machine. Quests advance only by listening to bus
// events and evaluating conditions, so adding a quest means adding JSON.
import type { EventBus, EventName } from "../core/events.js";
import type { QuestDef, QuestStateId } from "../data/types.js";
import { applyEffects, evaluate, matches, type EffectHost, type RuleContext } from "../narrative/rules.js";

export interface QuestProgress {
  state: QuestStateId;
  stage?: string;
  counters: Record<string, number>;
  outcome?: string;
}

export class QuestSystem {
  progress: Record<string, QuestProgress> = {};
  host!: EffectHost;
  rules!: RuleContext;

  constructor(private defs: Record<string, QuestDef>, private bus: EventBus) {
    bus.onAny((name, payload) => this.onEvent(name, payload));
  }

  state(id: string): QuestStateId {
    return this.progress[id]?.state ?? "inactive";
  }
  stage(id: string): string | undefined {
    return this.progress[id]?.stage;
  }

  start(id: string): void {
    const def = this.defs[id];
    if (!def || this.state(id) !== "inactive") return;
    this.progress[id] = { state: "active", stage: def.start, counters: {} };
    this.bus.emit("QuestStarted", { questId: id });
    this.bus.emit("Toast", { text: `Quest: ${def.title}`, kind: "quest" });
    this.checkImmediate(id);
  }

  setStage(id: string, stage: string): void {
    const p = this.progress[id];
    const def = this.defs[id];
    if (!p || p.state !== "active" || !def?.stages[stage]) return;
    p.stage = stage;
    p.counters = {};
    this.bus.emit("QuestStageChanged", { questId: id, stage });
    this.checkImmediate(id);
  }

  complete(id: string, outcome = "default"): void {
    const def = this.defs[id];
    if (!def) return;
    const p = (this.progress[id] ??= { state: "active", counters: {} });
    if (p.state === "completed" || p.state === "failed") return;
    p.state = "completed";
    p.outcome = outcome;
    p.stage = undefined;
    const o = def.outcomes[outcome];
    if (o) applyEffects(o.effects, this.host);
    this.bus.emit("QuestCompleted", { questId: id, outcome });
    this.bus.emit("Toast", { text: `Completed: ${def.title}${o ? " — " + o.text : ""}`, kind: "quest" });
  }

  fail(id: string): void {
    const p = this.progress[id];
    if (!p || p.state !== "active") return;
    p.state = "failed";
    p.stage = undefined;
  }

  /** Stages whose triggers use the pseudo-event "Check" advance as soon as their condition holds. */
  private checkImmediate(id: string): void {
    this.onEvent("Check" as EventName, {}, id);
  }

  /** Re-evaluates condition-only triggers (call after world state changes). */
  recheck(): void {
    for (const id in this.progress) if (this.progress[id].state === "active") this.checkImmediate(id);
  }

  private onEvent(name: EventName | "Check", payload: Record<string, unknown>, only?: string): void {
    if (!this.host) return;
    for (const id of only ? [only] : Object.keys(this.progress)) {
      const p = this.progress[id];
      if (!p || p.state !== "active" || !p.stage) continue;
      const stage = this.defs[id]?.stages[p.stage];
      if (!stage) continue;
      for (let i = 0; i < stage.triggers.length; i++) {
        const t = stage.triggers[i];
        if (t.event !== name || !matches(payload, t.match) || !evaluate(t.if, this.rules)) continue;
        const key = String(i);
        p.counters[key] = (p.counters[key] ?? 0) + 1;
        if (p.counters[key] < (t.count ?? 1)) continue;
        const stageBefore: string | undefined = p.stage;
        applyEffects(t.effects, this.host);
        if (t.complete) this.complete(id, t.complete);
        else if (t.to) this.setStage(id, t.to);
        // effects may have moved the quest; stop processing the old stage
        if (p.stage !== stageBefore || p.state !== "active") break;
      }
    }
  }

  /** Objectives for the HUD tracker. */
  objectives(): { id: string; title: string; text: string; hint?: string }[] {
    const out = [];
    for (const id in this.progress) {
      const p = this.progress[id];
      const def = this.defs[id];
      if (p.state !== "active" || !p.stage || !def) continue;
      const st = def.stages[p.stage];
      out.push({ id, title: def.title, text: st.text, hint: st.hint });
    }
    return out;
  }

  serialize(): Record<string, QuestProgress> {
    return JSON.parse(JSON.stringify(this.progress));
  }
  load(d: Record<string, QuestProgress>): void {
    this.progress = {};
    for (const id in d) if (this.defs[id]) this.progress[id] = d[id];
  }
}
