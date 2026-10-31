// Dialogue runner: walks a data-defined node graph, filters options by
// conditions and resolves d20 skill checks. UI-agnostic.
import type { EventBus } from "../core/events.js";
import type { DialogueDef, DialogueNode, DialogueOption } from "../data/types.js";
import { applyEffects, evaluate, skillCheck, type EffectHost, type RuleContext } from "../narrative/rules.js";
import { t } from "../i18n/i18n.js";
import type { UiKey } from "../i18n/en.js";

export interface DialogueView {
  speaker: string;
  text: string;
  options: { index: number; text: string; check?: string }[];
  lastCheck?: string;
  lastCheckOk?: boolean;
}

export class DialogueRunner {
  private def?: DialogueDef;
  private nodeId?: string;
  private lastCheck?: string;
  private lastCheckOk?: boolean;
  speakerFallback = "";

  constructor(
    private defs: Record<string, DialogueDef>,
    private bus: EventBus,
    private rules: RuleContext,
    private host: EffectHost,
    private d20: () => number,
  ) {}

  get active(): boolean {
    return !!this.def && !!this.nodeId;
  }

  start(dialogueId: string, speaker = ""): boolean {
    const def = this.defs[dialogueId];
    if (!def) return false;
    const entry = def.entries.find((e) => evaluate(e.if, this.rules));
    if (!entry) return false;
    this.def = def;
    this.speakerFallback = speaker;
    this.lastCheck = undefined;
    this.enter(entry.node);
    return true;
  }

  private enter(nodeId: string): void {
    if (!this.def || nodeId === "end" || !this.def.nodes[nodeId]) {
      this.def = undefined;
      this.nodeId = undefined;
      return;
    }
    this.nodeId = nodeId;
    applyEffects(this.def.nodes[nodeId].effects, this.host);
  }

  private node(): DialogueNode | undefined {
    return this.def && this.nodeId ? this.def.nodes[this.nodeId] : undefined;
  }

  private visibleOptions(): [DialogueOption, number][] {
    const n = this.node();
    if (!n) return [];
    return n.options
      .map((o, i) => [o, i] as [DialogueOption, number])
      .filter(([o]) => evaluate(o.if, this.rules) && !(o.once && this.host.getFlag(o.once)));
  }

  view(): DialogueView | undefined {
    const n = this.node();
    if (!n) return undefined;
    const variant = n.variants?.find((v) => evaluate(v.if, this.rules));
    const opts = this.visibleOptions();
    return {
      speaker: n.speaker ?? this.speakerFallback,
      text: variant?.text ?? n.text,
      options: (opts.length ? opts : [[{ text: "[Leave]", goto: "end" }, -1] as [DialogueOption, number]]).map(([o, i]) => ({
        index: i,
        text: o.text,
        check: o.check ? t("dialogue.checkTag", { attr: t(`attr.${o.check.attr}.short` as UiKey), dc: o.check.dc }) : undefined,
      })),
      lastCheck: this.lastCheck,
      lastCheckOk: this.lastCheckOk,
    };
  }

  choose(index: number): void {
    const n = this.node();
    if (!n || !this.def) return;
    if (index < 0) return this.enter("end");
    const o = n.options[index];
    if (!o || !evaluate(o.if, this.rules)) return;
    if (o.once) this.host.setFlag(o.once, true);
    this.bus.emit("DialogueChoice", { dialogueId: this.def.id, node: this.nodeId!, option: index });
    if (o.check) {
      const attr = this.rules.attribute(o.check.attr);
      const r = skillCheck(attr, o.check.dc, this.d20());
      this.lastCheck = t("dialogue.checkResult", { attr: t(`attr.${o.check.attr}.name` as UiKey), roll: r.roll, bonus: attr, total: r.total, dc: o.check.dc, result: t(r.success ? "dialogue.success" : "dialogue.failure") });
      this.lastCheckOk = r.success;
      this.bus.emit("SkillCheck", { attr: o.check.attr, dc: o.check.dc, roll: r.roll, total: r.total, success: r.success });
      if (r.success) {
        applyEffects(o.effects, this.host);
        this.enter(o.goto ?? "end");
      } else {
        applyEffects(o.failEffects, this.host);
        this.enter(o.failGoto ?? o.goto ?? "end");
      }
      return;
    }
    this.lastCheck = undefined;
    applyEffects(o.effects, this.host);
    this.enter(o.goto ?? "end");
  }

  close(): void {
    this.def = undefined;
    this.nodeId = undefined;
  }
}
