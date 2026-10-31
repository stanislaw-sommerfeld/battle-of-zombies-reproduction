// DOM user interface: title menu, character creator, saves and settings
// screens, HUD, inventory/character, journal, dialogue, lore reader, trait
// choice, pause and death screens. It reads game state and calls game
// methods; gameplay never touches the DOM.
import type { Game, UiBridge } from "../game.js";
import { RARITY_COLOR } from "../game.js";
import type { AttributeId } from "../data/types.js";
import type { Action, Input } from "../core/input.js";
import type { SettingsStore } from "../core/settings.js";
import { EQUIP_SLOTS, resolveItem, slotFor, type ResolvedItem } from "../items/inventory.js";
import { perkText } from "../effects/perks.js";
import { recomputePlayerStats, useItem } from "../entities/player.js";
import { Minimap } from "./minimap.js";
import { LANGS, getLang, t, tx, type Lang } from "../i18n/i18n.js";
import type { UiKey } from "../i18n/en.js";
import { actionKey, SPELL_ACTION } from "../i18n/keys.js";
import { buildOf, raceOf, speciesOf } from "../character/look.js";
import { drawPortrait } from "../render/character.js";
import { $, esc, escLines, formatDuration } from "./dom.js";
import { SettingsView } from "./settings.js";
import { SavesView, type SavesMode } from "./saves.js";
import { CharacterCreator } from "./creator.js";
import { ICONS } from "./icons.js";

const ATTRS: AttributeId[] = ["might", "finesse", "wits", "resolve"];
const VERSION = "v0.2";

type Screen = "title" | "creator" | "saves" | "settings" | "playing";
type Modal = "none" | "panel" | "dialogue" | "lore" | "trait" | "pause" | "death" | "saves" | "settings";

export interface UiHooks {
  setLanguage(lang: Lang): Promise<void>;
}

export class Ui implements UiBridge {
  screen: Screen = "title";
  modal: Modal = "none";
  private tab: "character" | "journal" = "character";
  private toasts: { el: HTMLElement; t: number }[] = [];
  private zoneBannerT = 0;
  private hud = $("#hud");
  private overlay = $("#overlay");
  private last: Record<string, string> = {};
  private traitOptions: string[] = [];
  onStart?: () => void;
  private minimap: Minimap;
  private settingsView: SettingsView;
  private savesView: SavesView;
  private creator: CharacterCreator;
  private hpGhost = 0;
  private hpGhostDelay = 0;
  private portraitKey = "";
  private lastHp = 0;
  private hurtT = 0;

  constructor(private g: Game, private input: Input, private settings: SettingsStore, private hooks: UiHooks) {
    g.ui = this;
    this.minimap = new Minimap($("#minimap") as HTMLCanvasElement, g);
    this.settingsView = new SettingsView(this.overlay, settings, input, {
      setLanguage: (l) => this.setLanguage(l),
      toast: (text, kind) => this.toast(text, kind),
    });
    this.savesView = new SavesView(this.overlay, g, { loaded: () => this.startPlaying() });
    this.creator = new CharacterCreator(this.overlay, g.content, {
      begin: (origin, look) => {
        g.newGame(origin, look);
        this.startPlaying();
      },
      back: () => this.showTitle(),
      overwritesAutosave: () => !!g.slots().find((s) => s.id === "auto")?.data,
    });
    g.bus.on("Toast", (x) => this.toast(x.text, x.kind));
    g.bus.on("AreaEntered", (a) => this.zoneBanner(a.zone, a.first));
    g.bus.on("GameSaved", (s) => {
      if (this.screen === "playing" && this.modal !== "saves") this.toast(s.slot === "auto" ? t("toast.autosaved") : t("toast.saved"), "save");
    });
    settings.onChange(() => this.applyDisplay());
    window.addEventListener("keydown", (e) => this.onKey(e));
    this.applyDisplay();
    this.showTitle();
  }

  get blocking(): boolean {
    return this.screen !== "playing" || this.modal !== "none";
  }

  private applyDisplay(): void {
    const d = this.settings.value.display;
    document.documentElement.style.setProperty("--hud-scale", String(d.hudScale));
    $("#minimap").parentElement!.classList.toggle("hidden", !d.minimap);
  }

  private async setLanguage(l: Lang): Promise<void> {
    await this.hooks.setLanguage(l);
    this.last = {};
  }

  // ---------------------------------------------------------------- screens

  showTitle(): void {
    this.screen = "title";
    this.modal = "none";
    this.hud.classList.add("hidden");
    const latest = this.g.slots().filter((s) => s.data).sort((a, b) => b.data!.savedAt - a.data!.savedAt)[0];
    const cont = latest?.data
      ? `<button data-act="continue" class="primary"><span>${t("title.continue")}</span><small>${esc(
          [this.g.content.origins[latest.data.player.origin]?.name, t("hud.level", { n: latest.data.player.level }), formatDuration(latest.data.playTime)].filter(Boolean).join(" · "),
        )}</small></button>`
      : "";
    const embers = Array.from({ length: 26 }, (_, i) => `<i style="--x:${(i * 37) % 100}%;--d:${6 + ((i * 7) % 9)}s;--delay:-${(i * 1.3) % 9}s;--s:${1 + (i % 3)}px"></i>`).join("");
    this.overlay.innerHTML = `
      <div class="title-screen">
        <div class="embers" aria-hidden="true">${embers}</div>
        <div class="title-inner">
          <div class="title-mark">✶</div>
          <h1>ASH LEDGER</h1>
          <div class="title-sub">${t("title.subtitle")}</div>
          <p class="tagline">${t("title.tagline")}</p>
          <div class="menu">
            ${cont}
            <button data-act="new" class="${cont ? "" : "primary"}"><span>${t("title.new")}</span></button>
            <button data-act="load" ${latest ? "" : "disabled"}><span>${t("title.load")}</span></button>
            <button data-act="settings"><span>${t("title.settings")}</span></button>
          </div>
          <div class="lang-switch">${LANGS.map((l) => `<button data-lang="${l.id}" class="${getLang() === l.id ? "on" : ""}">${l.id.toUpperCase()}</button>`).join("")}</div>
          <p class="controls-hint">${this.controlsLine()}</p>
          <p class="version">${VERSION} · ${t("title.version")}</p>
        </div>
      </div>`;
    this.overlay.classList.remove("hidden");
    this.bindButtons({
      continue: () => {
        if (this.g.continueGame()) this.startPlaying();
      },
      new: () => {
        this.screen = "creator";
        this.creator.show();
      },
      load: () => this.openSaves("load"),
      settings: () => this.openSettings(),
    });
    this.overlay.querySelectorAll<HTMLElement>("[data-lang]").forEach((b) =>
      b.addEventListener("click", async () => {
        this.settings.value.language = b.dataset.lang as Lang;
        this.settings.commit();
        await this.setLanguage(b.dataset.lang as Lang);
        this.showTitle();
      }),
    );
  }

  private k(a: Action): string {
    return esc(actionKey(this.input, a));
  }

  /** Content text may say {key:spell1}; show the key the player actually bound. */
  private keys(s: string): string {
    return s.replace(/\{key:(\w+)\}/g, (_, a: string) => actionKey(this.input, a as Action));
  }

  private controlsLine(): string {
    const pair = (a: Action, label: UiKey) => `<b>${this.k(a)}</b> ${t(label)}`;
    const move = [this.k("up"), this.k("left"), this.k("down"), this.k("right")].join("");
    return [
      `<b>${move}</b> ${t("action.move")}`,
      pair("light", "action.light"),
      pair("heavy", "action.heavy"),
      pair("dodge", "action.dodge"),
      pair("sprint", "action.sprint"),
      `<b>${this.k("spell1")} / ${this.k("spell2")}</b> ${t("action.spells")}`,
      pair("throw", "action.throw"),
      pair("use", "action.use"),
      pair("interact", "action.interact"),
      pair("inventory", "action.inventory"),
      pair("journal", "action.journal"),
      pair("pause", "action.pause"),
    ].join(" · ");
  }

  private openSettings(): void {
    const fromPause = this.screen === "playing";
    if (fromPause) this.modal = "settings";
    else this.screen = "settings";
    this.overlay.classList.remove("hidden");
    this.settingsView.show(() => (fromPause ? this.openPause() : this.showTitle()));
  }

  private openSaves(mode: SavesMode): void {
    const fromPause = this.screen === "playing";
    if (fromPause) this.modal = "saves";
    else this.screen = "saves";
    this.overlay.classList.remove("hidden");
    this.savesView.show(mode, () => (fromPause ? this.openPause() : this.showTitle()));
  }

  private startPlaying(): void {
    this.screen = "playing";
    this.modal = "none";
    this.overlay.classList.add("hidden");
    this.overlay.innerHTML = "";
    this.hud.classList.remove("hidden");
    this.last = {};
    this.portraitKey = "";
    this.hpGhost = this.g.player.hp;
    this.lastHp = this.g.player.hp;
    this.onStart?.();
  }

  // ---------------------------------------------------------------- modals

  closeModal(): void {
    this.modal = "none";
    this.overlay.classList.add("hidden");
    this.overlay.innerHTML = "";
    if (this.g.dialogue.active) this.g.dialogue.close();
    if (this.g.progress?.pendingTraits > 0 && this.screen === "playing") this.openTraitChoice();
  }

  openDialogue(): void {
    this.modal = "dialogue";
    this.renderDialogue();
  }

  private renderDialogue(): void {
    const v = this.g.dialogue.view();
    if (!v) return this.closeModal();
    this.overlay.classList.remove("hidden");
    this.overlay.innerHTML = `
      <div class="dialogue">
        <div class="speaker">${esc(v.speaker)}</div>
        ${v.lastCheck ? `<div class="check ${v.lastCheckOk ? "ok" : "fail"}">${esc(v.lastCheck)}</div>` : ""}
        <div class="line">${escLines(v.text)}</div>
        <ol class="options">${v.options
          .map((o, i) => `<li><button data-opt="${o.index}"><span class="num">${i + 1}.</span> ${o.check ? `<span class="tag">[${esc(o.check)}]</span> ` : ""}${esc(o.text)}</button></li>`)
          .join("")}</ol>
      </div>`;
    this.overlay.querySelectorAll<HTMLElement>("[data-opt]").forEach((b) => b.addEventListener("click", () => this.chooseOption(Number(b.dataset.opt))));
  }

  private chooseOption(i: number): void {
    this.g.dialogue.choose(i);
    if (this.modal !== "dialogue") return; // an effect opened something else
    if (this.g.dialogue.active) this.renderDialogue();
    else this.closeModal();
  }

  openLore(title: string, text: string): void {
    if (this.modal === "dialogue") {
      // queue after the dialogue closes
      setTimeout(() => this.openLore(title, text), 50);
      return;
    }
    this.modal = "lore";
    this.overlay.classList.remove("hidden");
    this.overlay.innerHTML = `<div class="lore"><h2>${esc(title)}</h2><div class="text">${escLines(this.keys(text))}</div><button data-act="close">${t("common.close")} (${this.k("interact")})</button></div>`;
    this.bindButtons({ close: () => this.closeModal() });
  }

  openTraitChoice(): void {
    const g = this.g;
    if (g.progress.pendingTraits <= 0) return;
    if (this.modal !== "none" && this.modal !== "trait") return;
    const owned = new Set(g.progress.traits);
    const pool = Object.values(g.content.traits).filter((tr) => !owned.has(tr.id) && Object.entries(tr.requires ?? {}).every(([a, v]) => g.attribute(a as AttributeId) >= (v ?? 0)));
    if (!pool.length) {
      g.progress.pendingTraits = 0;
      return;
    }
    if (!this.traitOptions.length || this.traitOptions.some((id) => owned.has(id))) {
      const shuffled = [...pool].sort(() => Math.random() - 0.5);
      this.traitOptions = shuffled.slice(0, 3).map((tr) => tr.id);
    }
    this.modal = "trait";
    this.overlay.classList.remove("hidden");
    this.overlay.innerHTML = `<div class="trait-choice"><h2>${t("trait.title")}</h2><p class="sub">${t("trait.sub")}</p><div class="cards">${this.traitOptions
      .map((id) => {
        const tr = g.content.traits[id];
        return `<button class="card" data-trait="${id}"><h4>${esc(tr.name)}</h4><p>${esc(tr.text)}</p></button>`;
      })
      .join("")}</div></div>`;
    this.overlay.querySelectorAll<HTMLElement>("[data-trait]").forEach((b) =>
      b.addEventListener("click", () => {
        // ignore double clicks / stale buttons
        if (this.modal !== "trait" || !b.isConnected || g.progress.pendingTraits <= 0 || g.progress.traits.includes(b.dataset.trait!)) return;
        g.progress.traits.push(b.dataset.trait!);
        g.progress.pendingTraits--;
        this.traitOptions = [];
        g.invalidatePerks();
        this.toast(t("toast.traitGained", { name: g.content.traits[b.dataset.trait!].name }), "insight");
        this.modal = "none";
        this.overlay.classList.add("hidden");
        if (g.progress.pendingTraits > 0) this.openTraitChoice();
      }),
    );
  }

  showDeath(): void {
    this.modal = "death";
    this.overlay.classList.remove("hidden");
    this.overlay.innerHTML = `<div class="death"><h1>${t("death.title")}</h1><p>${t("death.text")}</p><button data-act="rise" class="primary">${t("death.rise")}</button></div>`;
    this.bindButtons({
      rise: () => {
        if (!this.g.riseFromDeath()) this.g.newGame(this.g.progress.origin, this.g.look);
        this.startPlaying();
      },
    });
  }

  private openPause(): void {
    this.modal = "pause";
    this.overlay.classList.remove("hidden");
    this.overlay.innerHTML = `<div class="pause sheet narrow"><h2>${t("pause.title")}</h2><div class="menu">
      <button data-act="resume" class="primary"><span>${t("pause.resume")}</span></button>
      <button data-act="save"><span>${t("pause.save")}</span></button>
      <button data-act="load"><span>${t("pause.load")}</span></button>
      <button data-act="settings"><span>${t("title.settings")}</span></button>
      <button data-act="title"><span>${t("pause.quit")}</span><small>${t("pause.quitHint")}</small></button></div>
      <div class="controls">${this.controlsLine()}</div></div>`;
    this.bindButtons({
      resume: () => this.closeModal(),
      save: () => this.openSaves("save"),
      load: () => this.openSaves("load"),
      settings: () => this.openSettings(),
      title: () => this.showTitle(),
    });
  }

  private openPanel(tab: "character" | "journal"): void {
    this.tab = tab;
    this.modal = "panel";
    this.overlay.classList.remove("hidden");
    this.renderPanel();
  }

  private renderPanel(): void {
    const g = this.g;
    const pr = g.progress;
    const tabs = `<div class="tabs"><button data-tab="character" class="${this.tab === "character" ? "on" : ""}">${t("panel.character")} (${this.k("inventory")})</button><button data-tab="journal" class="${this.tab === "journal" ? "on" : ""}">${t("panel.journal")} (${this.k("journal")})</button><button data-act="close" class="small">${t("common.close")}</button></div>`;
    let body = "";
    if (this.tab === "character") {
      const eq = EQUIP_SLOTS.map((s) => {
        const it = g.inventory.equippedItem(s);
        return `<div class="slot" data-unequip="${s}"><div class="slot-name">${t(`slot.${s}` as UiKey)}</div>${it ? `<div class="item-name" style="color:${RARITY_COLOR[it.rarity]}">${esc(it.name)}</div>` : `<div class="empty">—</div>`}</div>`;
      }).join("");
      const attrs = ATTRS.map(
        (a) => `<div class="attr" title="${esc(t(`attr.${a}.text` as UiKey))}"><span>${t(`attr.${a}.name` as UiKey)}</span><b>${pr.attributes[a]}</b>${pr.unspent > 0 ? `<button data-attr="${a}" class="small">+</button>` : ""}<small>${t(`attr.${a}.text` as UiKey)}</small></div>`,
      ).join("");
      const traits = pr.traits.map((x) => g.content.traits[x]).filter(Boolean).map((x) => `<li><b>${esc(x.name)}</b> — ${esc(x.text)}</li>`).join("") || `<li class='empty'>${t("panel.noTraits")}</li>`;
      const insights = [...g.insights.learned].map((i) => g.content.insights[i]).filter(Boolean).map((i) => `<li><b>${esc(i.name)}</b> — ${esc(i.text)}</li>`).join("") || `<li class='empty'>${t("panel.noInsights")}</li>`;
      const items = g.inventory.items
        .map((inst) => {
          const r = resolveItem(g.content, inst);
          const eqd = g.inventory.isEquipped(inst.uid);
          return `<div class="item ${eqd ? "equipped" : ""}" data-uid="${inst.uid}" style="border-color:${RARITY_COLOR[r.rarity]}"><span class="glyph" style="color:${r.def.color ?? RARITY_COLOR[r.rarity]}">${esc(r.def.icon ?? "◆")}</span>${inst.count > 1 ? `<span class="count">${inst.count}</span>` : ""}</div>`;
        })
        .join("");
      const sp = speciesOf(g.content, g.look);
      const race = raceOf(g.content, g.look);
      const sex = sp.sexes?.find((s) => s.id === g.look.sex);
      body = `<div class="char">
        <div class="col">
          <div class="who"><canvas id="panel-portrait" width="112" height="112"></canvas><div>
            <h3>${esc(g.content.origins[pr.origin]?.name ?? "")} <span class="xp">${t("hud.level", { n: pr.level })} · ${pr.xp} / ${g.xpForNext()} ${t("hud.xp")}</span></h3>
            <div class="stats">${esc(`${sp.name} · ${race.name}${sex ? ` · ${sex.name}` : ""} · ${g.look.heightCm} cm · ${g.look.weightKg} kg · ${t(buildOf(g.look))}`)}</div>
            <div class="stats">${t("panel.stats", { hp: Math.round(g.player.hp), maxHp: g.player.maxHp, st: g.player.maxStamina, ember: g.player.maxEmber })}</div>
          </div></div>
          <div class="attrs-list">${attrs}</div>
          ${pr.unspent > 0 ? `<div class="unspent">${t("panel.unspent", { n: pr.unspent })}</div>` : ""}
          <h4>${t("panel.equipment")}</h4><div class="slots">${eq}</div>
          <h4>${t("panel.traits")}</h4><ul class="list">${traits}</ul>
          <h4>${t("panel.insights")}</h4><ul class="list">${insights}</ul>
        </div>
        <div class="col">
          <h4>${t("panel.pack")} <span class="hint">${t("panel.packHint")}</span></h4>
          <div class="grid">${items}</div>
          <div class="tooltip" id="tooltip"><span class="empty">${t("panel.hover")}</span></div>
        </div></div>`;
    } else {
      const quests =
        Object.entries(g.quests.progress)
          .map(([id, p]) => {
            const d = g.content.quests[id];
            if (!d) return "";
            const st = p.stage ? d.stages[p.stage] : undefined;
            const out = p.outcome ? d.outcomes[p.outcome] : undefined;
            return `<li class="${p.state}"><b>${esc(d.title)}</b> <span class="state">${t(`questState.${p.state}` as UiKey)}</span><div>${esc(st?.text ?? out?.text ?? d.summary)}</div>${st?.hint ? `<div class="hint">${esc(st.hint)}</div>` : ""}</li>`;
          })
          .join("") || `<li class='empty'>${t("panel.noQuests")}</li>`;
      const lore = [...g.loreRead].map((l) => g.content.lore[l]).filter(Boolean).map((l) => `<li><button class="link" data-lore="${l.id}">${esc(l.title)}</button></li>`).join("") || `<li class='empty'>${t("panel.noLore")}</li>`;
      const fac = Object.entries(g.world.factions).map(([id, v]) => `<li>${esc(g.content.factions[id]?.name ?? id)}: <b>${v > 0 ? "+" : ""}${v}</b></li>`).join("") || `<li class='empty'>${t("panel.noStanding")}</li>`;
      body = `<div class="journal"><div class="col"><h4>${t("panel.quests")}</h4><ul class="list quests">${quests}</ul></div><div class="col"><h4>${t("panel.lore")}</h4><ul class="list">${lore}</ul><h4>${t("panel.standing")}</h4><ul class="list">${fac}</ul><h4>${t("panel.places")}</h4><ul class="list">${[...g.world.discovered].map((z) => `<li>${esc(g.content.zones[z]?.name ?? z)}</li>`).join("")}</ul></div></div>`;
    }
    this.overlay.innerHTML = `<div class="panel sheet">${tabs}${body}</div>`;
    const pp = this.overlay.querySelector<HTMLCanvasElement>("#panel-portrait");
    if (pp) drawPortrait(pp, g.content, g.look);
    this.overlay.querySelectorAll<HTMLElement>("[data-tab]").forEach((b) => b.addEventListener("click", () => this.openPanel(b.dataset.tab as "character" | "journal")));
    this.bindButtons({ close: () => this.closeModal() });
    this.overlay.querySelectorAll<HTMLElement>("[data-attr]").forEach((b) =>
      b.addEventListener("click", () => {
        if (pr.unspent <= 0) return;
        pr.attributes[b.dataset.attr as AttributeId]++;
        pr.unspent--;
        recomputePlayerStats(g);
        this.renderPanel();
      }),
    );
    this.overlay.querySelectorAll<HTMLElement>("[data-unequip]").forEach((b) =>
      b.addEventListener("click", () => {
        g.inventory.unequip(b.dataset.unequip as "weapon");
        g.invalidatePerks();
        recomputePlayerStats(g);
        this.renderPanel();
      }),
    );
    this.overlay.querySelectorAll<HTMLElement>("[data-lore]").forEach((b) =>
      b.addEventListener("click", () => {
        const l = g.content.lore[b.dataset.lore!];
        this.modal = "none";
        this.openLore(l.title, l.text);
      }),
    );
    this.overlay.querySelectorAll<HTMLElement>("[data-uid]").forEach((el) => {
      const uid = Number(el.dataset.uid);
      el.addEventListener("mouseenter", () => {
        const inst = g.inventory.get(uid);
        if (inst) $("#tooltip").innerHTML = this.tooltip(resolveItem(g.content, inst));
      });
      el.addEventListener("click", (ev) => {
        const inst = g.inventory.get(uid);
        if (!inst) return;
        const def = g.content.items[inst.base];
        if ((ev as MouseEvent).shiftKey) {
          if (def.type === "key" || def.type === "page") return this.toast(t("toast.cantDiscard"));
          g.inventory.removeInstance(uid);
          g.pickups.push({ id: Date.now(), pos: { x: g.player.pos.x, y: g.player.pos.y + 14 }, item: inst.base, count: inst.count, affixes: inst.affixes, t: -1.5, dead: false });
        } else if (slotFor(def)) {
          const slot = g.inventory.equip(uid)!;
          g.bus.emit("ItemEquipped", { itemId: def.id, slot });
          recomputePlayerStats(g);
        } else if (def.use) {
          useItem(g, uid);
        } else if (def.type === "page" && def.lore) {
          const l = g.content.lore[def.lore];
          this.modal = "none";
          return this.openLore(l.title, l.text);
        }
        this.renderPanel();
      });
    });
  }

  private tooltip(r: ResolvedItem): string {
    const d = r.def;
    const lines: string[] = [];
    const kind = d.weaponClass ? tx(`weaponClass.${d.weaponClass}`, d.weaponClass) : tx(`itemType.${d.type}`, d.type);
    lines.push(`<div class="tt-name" style="color:${RARITY_COLOR[r.rarity]}">${esc(r.name)}</div><div class="tt-type">${tx(`rarity.${r.rarity}`, r.rarity)} · ${esc(kind)}</div>`);
    if (d.type === "weapon")
      lines.push(
        `<div>${t("tt.weapon", { dmg: r.damage, speed: d.attackSpeed ?? 1, heavy: d.heavyMultiplier ?? 2.2 })}${r.element !== "physical" ? ` (${tx(`element.${r.element}`, r.element)})` : ""}</div>`,
      );
    if (r.maxHealth) lines.push(`<div>${t("tt.maxHealth", { n: r.maxHealth })}</div>`);
    if (d.resist) lines.push(`<div>${t("tt.resist")} ${Object.entries(d.resist).map(([k, v]) => `${tx(`element.${k}`, k)} ${Math.round((v ?? 0) * 100)}%`).join(", ")}</div>`);
    for (const p of r.perks) lines.push(`<div class="perk">✦ ${esc(perkText(p))}</div>`);
    for (const p of r.drawbacks) lines.push(`<div class="drawback">✖ ${esc(perkText(p))}</div>`);
    if (d.description) lines.push(`<div class="desc">${esc(this.keys(d.description))}</div>`);
    if (d.lore) lines.push(`<div class="desc">${t("tt.readable")}</div>`);
    return lines.join("");
  }

  private bindButtons(map: Record<string, () => void>): void {
    this.overlay.querySelectorAll<HTMLElement>("[data-act]").forEach((b) => {
      const fn = map[b.dataset.act!];
      if (fn) b.addEventListener("click", fn);
    });
  }

  private onKey(e: KeyboardEvent): void {
    const k = e.code;
    const a = this.input.actionFor(k);
    const back = k === "Escape";
    // menus outside the game: Esc goes back
    if (this.screen !== "playing") {
      if (!back) return;
      if (this.screen === "settings") this.settingsView.back();
      else if (this.screen === "saves") this.savesView.back();
      else if (this.screen === "creator") this.creator.back();
      return;
    }
    if (this.modal === "settings") {
      if (back) this.settingsView.back();
      return;
    }
    if (this.modal === "saves") {
      if (back) this.savesView.back();
      return;
    }
    if (this.modal === "dialogue") {
      const n = Number(e.key);
      if (n >= 1 && n <= 9) {
        const btns = this.overlay.querySelectorAll<HTMLElement>("[data-opt]");
        btns[n - 1]?.click();
      } else if (back) this.closeModal();
      return;
    }
    if (this.modal === "lore" && (a === "interact" || back || k === "Space")) {
      e.preventDefault();
      return this.closeModal();
    }
    if (this.modal === "death" || this.modal === "trait") return;
    if (a === "mute") {
      const s = this.settings.value;
      s.audio.muted = !s.audio.muted;
      this.settings.commit();
      this.toast(t(s.audio.muted ? "toast.soundOff" : "toast.soundOn"));
    } else if (back || a === "pause") {
      if (this.modal === "none") this.openPause();
      else this.closeModal();
    } else if (a === "inventory") {
      e.preventDefault();
      if (this.modal === "panel" && this.tab === "character") this.closeModal();
      else if (this.modal === "none" || this.modal === "panel") this.openPanel("character");
    } else if (a === "journal") {
      if (this.modal === "panel" && this.tab === "journal") this.closeModal();
      else if (this.modal === "none" || this.modal === "panel") this.openPanel("journal");
    }
  }

  // ---------------------------------------------------------------- HUD

  toast(text: string, kind = "info"): void {
    if (kind === "hint" && !this.settings.value.display.hints) return;
    const box = $("#toasts");
    const el = document.createElement("div");
    el.className = `toast ${kind}`;
    el.textContent = this.keys(text);
    box.appendChild(el);
    this.toasts.push({ el, t: kind === "insight" || kind === "quest" || kind === "hint" ? 7 : 4.5 });
    while (this.toasts.length > 5) this.toasts.shift()!.el.remove();
  }

  private zoneBanner(zoneId: string, first: boolean): void {
    const z = this.g.content.zones[zoneId];
    if (!z) return;
    const ed = this.g.zoneEdict(z.id);
    const el = $("#zone-banner");
    el.innerHTML = `<div class="zrule"></div><div class="zname">${esc(z.name)}</div>${ed && ed.id !== "blank" ? `<div class="zedict">${esc(ed.name)} — ${esc(ed.text)}</div>` : ""}${first && z.description ? `<div class="zdesc">${esc(z.description)}</div>` : ""}<div class="zrule"></div>`;
    el.classList.add("show");
    this.zoneBannerT = first ? 6 : 3;
  }

  private set(id: string, html: string): void {
    if (this.last[id] === html) return;
    this.last[id] = html;
    $(id).innerHTML = html;
  }

  update(dt: number): void {
    this.creator.tick(dt);
    for (const x of this.toasts) {
      x.t -= dt;
      if (x.t < 0.6) x.el.style.opacity = String(Math.max(0, x.t / 0.6));
    }
    this.toasts = this.toasts.filter((x) => (x.t > 0 ? true : (x.el.remove(), false)));
    if (this.zoneBannerT > 0) {
      this.zoneBannerT -= dt;
      if (this.zoneBannerT <= 0) $("#zone-banner").classList.remove("show");
    }
    if (this.screen !== "playing") return;
    const g = this.g;
    const p = g.player;
    this.minimap.update(dt);
    const pct = (a: number, b: number) => `${Math.max(0, Math.min(100, (a / b) * 100)).toFixed(1)}%`;

    // health with a trailing "ghost" that shows how much the last hit took
    if (p.hp < this.lastHp - 0.5) this.hurtT = 0.35;
    this.lastHp = p.hp;
    if (p.hp >= this.hpGhost) {
      this.hpGhost = p.hp;
      this.hpGhostDelay = 0.45;
    } else if ((this.hpGhostDelay -= dt) <= 0) this.hpGhost = Math.max(p.hp, this.hpGhost - p.maxHp * 0.6 * dt);
    $("#hp-fill").style.width = pct(p.hp, p.maxHp);
    $("#hp-ghost").style.width = pct(this.hpGhost, p.maxHp);
    $("#st-fill").style.width = pct(p.stamina, p.maxStamina);
    $("#st-fill").parentElement!.classList.toggle("low", p.stamina < p.maxStamina * 0.25);
    $("#fray-fill").style.width = pct(p.fray, 100);
    this.set("#hp-text", `${Math.ceil(p.hp)} / ${p.maxHp}`);
    this.set("#ember", Array.from({ length: p.maxEmber }, (_, i) => `<span class="pip ${i < Math.floor(p.ember) ? "on" : ""}"></span>`).join(""));
    this.set("#fray-label", p.fray >= 50 ? t("hud.frayed", { n: Math.round(p.fray) }) : t("hud.fray", { n: Math.round(p.fray) }));
    $("#fray").classList.toggle("hot", p.fray >= 50);
    $("#fray").title = t("hud.frayTip");
    $("#ember").title = t("hud.emberTip");
    const pending = g.progress.unspent || g.progress.pendingTraits;
    this.set("#level", `${g.progress.level}${pending ? `<span class="up" title="${esc(t("hud.levelUpTip", { key: actionKey(this.input, "inventory") }))}">▲</span>` : ""}`);
    $("#xp-fill").style.width = pct(g.progress.xp, g.xpForNext());
    this.hurtT = Math.max(0, this.hurtT - dt);
    $("#vitals").classList.toggle("hurt", this.hurtT > 0);
    const vig = $("#vignette");
    vig.classList.toggle("low", p.hp / p.maxHp < 0.3);
    vig.classList.toggle("frayed", p.fray >= 50);

    // portrait, redrawn when the look changes
    const pk = JSON.stringify(g.look);
    if (pk !== this.portraitKey) {
      this.portraitKey = pk;
      drawPortrait($("#portrait") as HTMLCanvasElement, g.content, g.look);
    }

    // ability bar
    const slot = (action: Action, icon: string, name: string, o: { cd?: number; max?: number; cost?: number; na?: boolean; count?: number; color?: string } = {}) => {
      const cd = o.cd ?? 0;
      return `<div class="ab ${cd > 0 ? "cd" : ""} ${o.na ? "na" : ""}" ${o.color ? `style="--accent:${o.color}"` : ""}>
        <div class="ico">${icon}</div><div class="nm">${esc(name)}</div>
        <div class="key">${esc(actionKey(this.input, action))}</div>
        ${o.cost ? `<div class="cost">${o.cost}✶</div>` : ""}${o.count !== undefined ? `<div class="cnt">${o.count}</div>` : ""}
        ${cd > 0 ? `<div class="cdmask" style="--cd:${((cd / (o.max ?? 1)) * 360).toFixed(0)}deg"></div>` : ""}</div>`;
    };
    const ws = g.inventory.equippedItem("weapon");
    const abil = (k: "Q" | "R") => {
      const id = g.progress.abilities.find((x) => g.content.abilities[x]?.key === k);
      const ab = id ? g.content.abilities[id] : undefined;
      if (!ab) return slot(SPELL_ACTION[k], ICONS.empty, "—", { na: true });
      return slot(SPELL_ACTION[k], ab.element === "frost" ? ICONS.frost : ICONS.fire, ab.name, {
        cd: p.cooldowns[ab.id] ?? 0,
        max: ab.cooldown,
        cost: ab.cost,
        na: p.ember < ab.cost,
        color: ab.element === "frost" ? "#9fdcff" : "#ff9a3c",
      });
    };
    const flasks = g.inventory.items.filter((i) => g.content.items[i.base]?.throwable).reduce((s, i) => s + i.count, 0);
    const food = g.inventory.items.filter((i) => g.content.items[i.base]?.use).reduce((s, i) => s + i.count, 0);
    this.set(
      "#abilities",
      slot("light", ICONS.light, ws ? ws.name : t("hud.fists")) +
        slot("heavy", ICONS.heavy, t("hud.heavy")) +
        slot("dodge", ICONS.dodge, t("hud.dodge"), { na: p.stamina < 3 }) +
        `<div class="ab-gap"></div>` +
        abil("Q") +
        abil("R") +
        `<div class="ab-gap"></div>` +
        slot("throw", ICONS.flask, t("hud.flask"), { count: flasks, na: !flasks }) +
        slot("use", ICONS.eat, t("hud.eat"), { count: food, na: !food }),
    );

    // interaction prompt
    const f = g.focus;
    this.set("#prompt", f ? `<span class="key">${esc(actionKey(this.input, "interact"))}</span> ${esc(f.prompt)}` : "");
    $("#prompt").classList.toggle("show", !!f);

    // quest tracker
    const objs = g.quests.objectives();
    this.set("#quests", objs.map((o) => `<div class="q"><div class="qt">${esc(o.title)}</div><div class="qo">${esc(o.text)}</div>${o.hint ? `<div class="qh">${esc(o.hint)}</div>` : ""}</div>`).join(""));

    // zone + edict
    const z = g.currentZone;
    const ed = z ? g.zoneEdict(z.id) : undefined;
    this.set("#zone", z ? `<b>${esc(z.name)}</b>${ed && ed.id !== "blank" ? `<span title="${esc(ed.text)}">${esc(ed.name)}</span>` : `<span class="blank">${t("hud.blank")}</span>`}` : "");

    // statuses on the player
    const st = Object.keys(p.statuses).filter((s) => (p.statuses as Record<string, number>)[s] > 0);
    this.set("#statuses", st.map((s) => `<span class="status ${s}">${esc(tx(`status.${s}`, s))}</span>`).join(""));

    // boss bar
    const boss = g.enemies.find((e) => e.boss && e.awareOfPlayer && !e.dead);
    $("#boss").classList.toggle("show", !!boss);
    if (boss) {
      this.set("#boss-name", esc(boss.def.name));
      $("#boss-fill").style.width = pct(boss.hp, boss.maxHp);
    }
  }
}
