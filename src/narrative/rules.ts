// Condition evaluation and effect dispatch shared by every data-driven system
// (dialogue, quests, insights, props, spawns). Pure: depends only on interfaces.
import type { AttributeId, Condition, Effect, LiquidId, QuestStateId } from "../data/types.js";

export interface RuleContext {
  getFlag(key: string): string | number | boolean | undefined;
  itemCount(id: string): number;
  hasInsight(id: string): boolean;
  questState(id: string): QuestStateId;
  questStage(id: string): string | undefined;
  attribute(a: AttributeId): number;
  level(): number;
}

export function evaluate(c: Condition | undefined, ctx: RuleContext): boolean {
  if (!c) return true;
  if ("all" in c) return c.all.every((x) => evaluate(x, ctx));
  if ("any" in c) return c.any.some((x) => evaluate(x, ctx));
  if ("not" in c) return !evaluate(c.not, ctx);
  if ("flag" in c) {
    const v = ctx.getFlag(c.flag);
    if (c.exists !== undefined) return (v !== undefined) === c.exists;
    if (c.eq !== undefined) return v === c.eq;
    if (c.neq !== undefined) return v !== c.neq;
    if (c.gte !== undefined) return typeof v === "number" && v >= c.gte;
    return !!v;
  }
  if ("hasItem" in c) return ctx.itemCount(c.hasItem) >= (c.count ?? 1);
  if ("insight" in c) return ctx.hasInsight(c.insight);
  if ("quest" in c) {
    const states = Array.isArray(c.state) ? c.state : [c.state];
    if (!states.includes(ctx.questState(c.quest))) return false;
    return c.stage === undefined || ctx.questStage(c.quest) === c.stage;
  }
  if ("attr" in c) return ctx.attribute(c.attr) >= c.gte;
  if ("level" in c) return ctx.level() >= c.level;
  return false;
}

export interface EffectHost {
  setFlag(key: string, value: string | number | boolean): void;
  getFlag(key: string): string | number | boolean | undefined;
  giveItem(id: string, count: number): void;
  takeItem(id: string, count: number): void;
  giveXp(n: number): void;
  startQuest(id: string): void;
  setStage(quest: string, stage: string): void;
  completeQuest(id: string, outcome?: string): void;
  failQuest(id: string): void;
  grantInsight(id: string): void;
  learnAbility(id: string): void;
  changeFaction(id: string, delta: number): void;
  toast(text: string): void;
  heal(n: number): void;
  addFray(n: number): void;
  clearLiquid(zone: string, liquid: LiquidId): void;
  emitCustom(name: string, payload?: Record<string, unknown>): void;
}

export function applyEffects(effects: Effect[] | undefined, host: EffectHost): void {
  if (!effects) return;
  for (const e of effects) {
    if ("setFlag" in e) host.setFlag(e.setFlag, e.value);
    else if ("addFlag" in e) host.setFlag(e.addFlag, (Number(host.getFlag(e.addFlag)) || 0) + e.value);
    else if ("giveItem" in e) host.giveItem(e.giveItem, e.count ?? 1);
    else if ("takeItem" in e) host.takeItem(e.takeItem, e.count ?? 1);
    else if ("giveXp" in e) host.giveXp(e.giveXp);
    else if ("startQuest" in e) host.startQuest(e.startQuest);
    else if ("setStage" in e) host.setStage(e.setStage.quest, e.setStage.stage);
    else if ("completeQuest" in e) host.completeQuest(e.completeQuest, e.outcome);
    else if ("failQuest" in e) host.failQuest(e.failQuest);
    else if ("grantInsight" in e) host.grantInsight(e.grantInsight);
    else if ("learnAbility" in e) host.learnAbility(e.learnAbility);
    else if ("faction" in e) host.changeFaction(e.faction, e.delta);
    else if ("toast" in e) host.toast(e.toast);
    else if ("heal" in e) host.heal(e.heal);
    else if ("fray" in e) host.addFray(e.fray);
    else if ("clearLiquid" in e) host.clearLiquid(e.clearLiquid.zone, e.clearLiquid.liquid);
    else if ("emit" in e) host.emitCustom(e.emit, e.payload);
  }
}

/** True when every key in `match` equals the payload field. */
export function matches(payload: Record<string, unknown>, match?: Record<string, unknown>): boolean {
  if (!match) return true;
  for (const k in match) if (payload[k] !== match[k]) return false;
  return true;
}

/** D&D-style check: d20 + attribute modifier vs difficulty class. */
export function skillCheck(attrValue: number, dc: number, d20: number) {
  const total = d20 + attrValue;
  // natural 20 always succeeds, natural 1 always fails
  const success = d20 === 20 || (d20 !== 1 && total >= dc);
  return { roll: d20, total, success };
}
