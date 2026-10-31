// DOM user interface: HUD, title/origin screens, inventory/character, journal,
// dialogue, lore reader, trait choice, pause and death screens.
// It reads game state and calls game methods; gameplay never touches the DOM.
import type { Game, UiBridge } from "../game.js";
import { RARITY_COLOR } from "../game.js";
import type { AttributeId } from "../data/types.js";
import { EQUIP_SLOTS, resolveItem, slotFor, type ResolvedItem } from "../items/inventory.js";
import { perkText } from "../effects/perks.js";
import { recomputePlayerStats, useItem } from "../entities/player.js";
import { Minimap } from "./minimap.js";

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const ATTRS: { id: AttributeId; name: string; text: string }[] = [
  { id: "might", name: "Might", text: "Heavy weapon damage, forcing doors and walls, intimidation." },
  { id: "finesse", name: "Finesse", text: "Attack speed, stamina, dodge cost, critical chance, locks." },
  { id: "wits", name: "Wits", text: "Spell damage, maximum Ember, reading the world." },
  { id: "resolve", name: "Resolve", text: "Maximum health, resisting Fray, holding your nerve." },
];

type Screen = "title" | "origin" | "playing";
type Modal = "none" | "panel" | "dialogue" | "lore" | "trait" | "pause" | "death";

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

  constructor(private g: Game) {
    g.ui = this;
    this.minimap = new Minimap($("#minimap") as HTMLCanvasElement, g);
    g.bus.on("Toast", (t) => this.toast(t.text, t.kind));
    g.bus.on("AreaEntered", (a) => this.zoneBanner(a.zone, a.first));
    g.bus.on("GameSaved", () => this.toast("Saved.", "save"));
    window.addEventListener("keydown", (e) => this.onKey(e));
    this.showTitle();
  }

  get blocking(): boolean {
    return this.screen !== "playing" || this.modal !== "none";
  }

  // ---------------------------------------------------------------- screens

  showTitle(): void {
    this.screen = "title";
    this.modal = "none";
    this.hud.classList.add("hidden");
    const hasSave = this.g.hasSave();
    this.overlay.innerHTML = `
      <div class="title-screen">
        <div class="title-mark">✶</div>
        <h1>ASH LEDGER</h1>
        <p class="tagline">The book that held the world's laws has burned.<br/>Its pages still fall. Where they land, they rule.</p>
        <div class="menu">
          ${hasSave ? `<button data-act="continue" class="primary">Continue</button>` : ""}
          <button data-act="new" class="${hasSave ? "" : "primary"}">New Game</button>
        </div>
        <p class="controls-hint">WASD move · Mouse aim · LMB light · RMB heavy · Space dodge · Shift sprint<br/>Q / R spells · F throw flask · C eat · E interact · I character · J journal · Esc pause</p>
        <p class="version">v0.1 — Milestone 1 vertical slice</p>
      </div>`;
    this.overlay.classList.remove("hidden");
    this.bindButtons({
      continue: () => {
        if (this.g.continueGame()) this.startPlaying();
      },
      new: () => this.showOrigins(),
    });
  }

  private showOrigins(): void {
    this.screen = "origin";
    const cards = Object.values(this.g.content.origins)
      .map(
        (o) => `<button class="origin" data-origin="${o.id}">
          <h3>${esc(o.name)}</h3>
          <p>${esc(o.text)}</p>
          <div class="attrs">${ATTRS.map((a) => `<span>${a.name.slice(0, 3).toUpperCase()} ${o.attributes[a.id]}</span>`).join("")}</div>
          <div class="kit">${o.equip.concat(o.items).map((i) => esc(this.g.content.items[i]?.name ?? i)).join(" · ")}</div>
          ${o.trait ? `<div class="trait">${esc(this.g.content.traits[o.trait]?.name ?? "")}: ${esc(this.g.content.traits[o.trait]?.text ?? "")}</div>` : ""}
        </button>`,
      )
      .join("");
    this.overlay.innerHTML = `<div class="origin-screen"><h2>What do you remember of who you were?</h2><p class="sub">Your name burned with the Ledger. Only habits remain.</p><div class="origins">${cards}</div><button data-act="back" class="small">Back</button></div>`;
    this.overlay.querySelectorAll<HTMLElement>("[data-origin]").forEach((b) =>
      b.addEventListener("click", () => {
        this.g.newGame(b.dataset.origin!);
        this.startPlaying();
      }),
    );
    this.bindButtons({ back: () => this.showTitle() });
  }

  private startPlaying(): void {
    this.screen = "playing";
    this.modal = "none";
    this.overlay.classList.add("hidden");
    this.overlay.innerHTML = "";
    this.hud.classList.remove("hidden");
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
        ${v.lastCheck ? `<div class="check ${v.lastCheck.includes("SUCCESS") ? "ok" : "fail"}">${esc(v.lastCheck)}</div>` : ""}
        <div class="line">${esc(v.text).replace(/\n/g, "<br/>")}</div>
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
    this.overlay.innerHTML = `<div class="lore"><h2>${esc(title)}</h2><div class="text">${esc(text).replace(/\n/g, "<br/>")}</div><button data-act="close">Close (E)</button></div>`;
    this.bindButtons({ close: () => this.closeModal() });
  }

  openTraitChoice(): void {
    const g = this.g;
    if (g.progress.pendingTraits <= 0) return;
    if (this.modal !== "none" && this.modal !== "trait") return;
    const owned = new Set(g.progress.traits);
    const pool = Object.values(g.content.traits).filter((t) => !owned.has(t.id) && Object.entries(t.requires ?? {}).every(([a, v]) => g.attribute(a as AttributeId) >= (v ?? 0)));
    if (!pool.length) {
      g.progress.pendingTraits = 0;
      return;
    }
    if (!this.traitOptions.length || this.traitOptions.some((id) => owned.has(id))) {
      const shuffled = [...pool].sort(() => Math.random() - 0.5);
      this.traitOptions = shuffled.slice(0, 3).map((t) => t.id);
    }
    this.modal = "trait";
    this.overlay.classList.remove("hidden");
    this.overlay.innerHTML = `<div class="trait-choice"><h2>Something in you is rewritten</h2><p class="sub">Choose one trait. It changes how you fight, not just how hard.</p><div class="origins">${this.traitOptions
      .map((id) => {
        const t = g.content.traits[id];
        return `<button class="origin" data-trait="${id}"><h3>${esc(t.name)}</h3><p>${esc(t.text)}</p></button>`;
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
        this.toast(`Trait gained: ${g.content.traits[b.dataset.trait!].name}`, "insight");
        this.modal = "none";
        this.overlay.classList.add("hidden");
        if (g.progress.pendingTraits > 0) this.openTraitChoice();
      }),
    );
  }

  showDeath(): void {
    this.modal = "death";
    this.overlay.classList.remove("hidden");
    this.overlay.innerHTML = `<div class="death"><h1>UNWRITTEN</h1><p>Your outline frays into the Blank. But something in the waystone still remembers your shape.</p><button data-act="rise" class="primary">Rise at the last waystone</button></div>`;
    this.bindButtons({
      rise: () => {
        if (!this.g.continueGame()) this.g.newGame(this.g.progress.origin);
        this.startPlaying();
      },
    });
  }

  private openPause(): void {
    this.modal = "pause";
    this.overlay.classList.remove("hidden");
    this.overlay.innerHTML = `<div class="pause"><h2>Paused</h2><div class="menu">
      <button data-act="resume" class="primary">Resume</button>
      <button data-act="save">Save game</button>
      <button data-act="load">Load last save</button>
      <button data-act="title">Quit to title</button></div>
      <div class="controls">
        <b>Move</b> WASD · <b>Aim</b> mouse · <b>Light</b> LMB (or K) · <b>Heavy</b> RMB (or L) · <b>Dodge</b> Space · <b>Sprint</b> Shift<br/>
        <b>Spells</b> Q / R · <b>Throw flask</b> F · <b>Eat</b> C · <b>Interact / harvest echo</b> E · <b>Character</b> I · <b>Journal</b> J · <b>Mute</b> M
      </div></div>`;
    this.bindButtons({
      resume: () => this.closeModal(),
      save: () => {
        this.g.save();
        this.closeModal();
      },
      load: () => {
        if (this.g.continueGame()) this.closeModal();
      },
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
    const tabs = `<div class="tabs"><button data-tab="character" class="${this.tab === "character" ? "on" : ""}">Character (I)</button><button data-tab="journal" class="${this.tab === "journal" ? "on" : ""}">Journal (J)</button><button data-act="close" class="small">Close</button></div>`;
    let body = "";
    if (this.tab === "character") {
      const eq = EQUIP_SLOTS.map((s) => {
        const it = g.inventory.equippedItem(s);
        return `<div class="slot" data-unequip="${s}"><div class="slot-name">${s}</div>${it ? `<div class="item-name" style="color:${RARITY_COLOR[it.rarity]}">${esc(it.name)}</div>` : `<div class="empty">—</div>`}</div>`;
      }).join("");
      const attrs = ATTRS.map(
        (a) => `<div class="attr" title="${esc(a.text)}"><span>${a.name}</span><b>${pr.attributes[a.id]}</b>${pr.unspent > 0 ? `<button data-attr="${a.id}" class="small">+</button>` : ""}</div>`,
      ).join("");
      const traits = pr.traits.map((t) => g.content.traits[t]).filter(Boolean).map((t) => `<li><b>${esc(t.name)}</b> — ${esc(t.text)}</li>`).join("") || "<li class='empty'>None yet. Traits come with levels.</li>";
      const insights = [...g.insights.learned].map((i) => g.content.insights[i]).filter(Boolean).map((i) => `<li><b>${esc(i.name)}</b> — ${esc(i.text)}</li>`).join("") || "<li class='empty'>You understand nothing of this place yet.</li>";
      const items = g.inventory.items
        .map((inst) => {
          const r = resolveItem(g.content, inst);
          const eqd = g.inventory.isEquipped(inst.uid);
          return `<div class="item ${eqd ? "equipped" : ""}" data-uid="${inst.uid}" style="border-color:${RARITY_COLOR[r.rarity]}"><span class="glyph" style="color:${r.def.color ?? RARITY_COLOR[r.rarity]}">${esc(r.def.icon ?? "◆")}</span>${inst.count > 1 ? `<span class="count">${inst.count}</span>` : ""}</div>`;
        })
        .join("");
      body = `<div class="char">
        <div class="col">
          <h3>Level ${pr.level} <span class="xp">${pr.xp} / ${g.xpForNext()} XP</span></h3>
          <div class="stats">HP ${Math.round(g.player.hp)}/${g.player.maxHp} · Stamina ${g.player.maxStamina} · Ember ${g.player.maxEmber}</div>
          <div class="attrs-list">${attrs}</div>
          ${pr.unspent > 0 ? `<div class="unspent">${pr.unspent} attribute point(s) to spend</div>` : ""}
          <h4>Equipment</h4><div class="slots">${eq}</div>
          <h4>Traits</h4><ul class="list">${traits}</ul>
          <h4>Insights</h4><ul class="list">${insights}</ul>
        </div>
        <div class="col">
          <h4>Pack <span class="hint">click: equip / use · shift-click: drop</span></h4>
          <div class="grid">${items}</div>
          <div class="tooltip" id="tooltip"><span class="empty">Hover an item.</span></div>
        </div></div>`;
    } else {
      const quests = Object.entries(g.quests.progress)
        .map(([id, p]) => {
          const d = g.content.quests[id];
          if (!d) return "";
          const st = p.stage ? d.stages[p.stage] : undefined;
          const out = p.outcome ? d.outcomes[p.outcome] : undefined;
          return `<li class="${p.state}"><b>${esc(d.title)}</b> <span class="state">${p.state}</span><div>${esc(st?.text ?? out?.text ?? d.summary)}</div>${st?.hint ? `<div class="hint">${esc(st.hint)}</div>` : ""}</li>`;
        })
        .join("") || "<li class='empty'>No one has asked anything of you yet.</li>";
      const lore = [...g.loreRead].map((l) => g.content.lore[l]).filter(Boolean).map((l) => `<li><button class="link" data-lore="${l.id}">${esc(l.title)}</button></li>`).join("") || "<li class='empty'>Nothing read.</li>";
      const fac = Object.entries(g.world.factions).map(([id, v]) => `<li>${esc(g.content.factions[id]?.name ?? id)}: <b>${v > 0 ? "+" : ""}${v}</b></li>`).join("") || "<li class='empty'>No one knows you.</li>";
      body = `<div class="journal"><div class="col"><h4>Quests</h4><ul class="list quests">${quests}</ul></div><div class="col"><h4>Pages read</h4><ul class="list">${lore}</ul><h4>Standing</h4><ul class="list">${fac}</ul><h4>Places found</h4><ul class="list">${[...g.world.discovered].map((z) => `<li>${esc(g.content.zones[z]?.name ?? z)}</li>`).join("")}</ul></div></div>`;
    }
    this.overlay.innerHTML = `<div class="panel">${tabs}${body}</div>`;
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
          if (def.type === "key" || def.type === "page") return this.toast("You can't bring yourself to discard this.");
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
    lines.push(`<div class="tt-name" style="color:${RARITY_COLOR[r.rarity]}">${esc(r.name)}</div><div class="tt-type">${r.rarity} ${d.weaponClass ?? d.type}</div>`);
    if (d.type === "weapon") lines.push(`<div>Damage <b>${r.damage}</b> ${r.element !== "physical" ? `(${r.element})` : ""} · Speed ${d.attackSpeed ?? 1} · Heavy ×${d.heavyMultiplier ?? 2.2}</div>`);
    if (r.maxHealth) lines.push(`<div>+${r.maxHealth} max health</div>`);
    if (d.resist) lines.push(`<div>Resist: ${Object.entries(d.resist).map(([k, v]) => `${k} ${Math.round((v ?? 0) * 100)}%`).join(", ")}</div>`);
    for (const p of r.perks) lines.push(`<div class="perk">✦ ${esc(perkText(p))}</div>`);
    for (const p of r.drawbacks) lines.push(`<div class="drawback">✖ ${esc(perkText(p))}</div>`);
    if (d.description) lines.push(`<div class="desc">${esc(d.description)}</div>`);
    if (d.lore) lines.push(`<div class="desc">Readable.</div>`);
    return lines.join("");
  }

  private bindButtons(map: Record<string, () => void>): void {
    this.overlay.querySelectorAll<HTMLElement>("[data-act]").forEach((b) => {
      const fn = map[b.dataset.act!];
      if (fn) b.addEventListener("click", fn);
    });
  }

  private onKey(e: KeyboardEvent): void {
    if (this.screen !== "playing") return;
    const k = e.code;
    if (this.modal === "dialogue") {
      const n = Number(e.key);
      if (n >= 1 && n <= 9) {
        const btns = this.overlay.querySelectorAll<HTMLElement>("[data-opt]");
        btns[n - 1]?.click();
      } else if (k === "Escape") this.closeModal();
      return;
    }
    if (this.modal === "lore" && (k === "KeyE" || k === "Escape" || k === "Space")) {
      e.preventDefault();
      return this.closeModal();
    }
    if (this.modal === "death" || this.modal === "trait") return;
    if (k === "Escape") {
      if (this.modal === "none") this.openPause();
      else this.closeModal();
    } else if (k === "KeyI" || k === "Tab") {
      e.preventDefault();
      if (this.modal === "panel" && this.tab === "character") this.closeModal();
      else if (this.modal === "none" || this.modal === "panel") this.openPanel("character");
    } else if (k === "KeyJ") {
      if (this.modal === "panel" && this.tab === "journal") this.closeModal();
      else if (this.modal === "none" || this.modal === "panel") this.openPanel("journal");
    }
  }

  // ---------------------------------------------------------------- HUD

  toast(text: string, kind = "info"): void {
    const box = $("#toasts");
    const el = document.createElement("div");
    el.className = `toast ${kind}`;
    el.textContent = text;
    box.appendChild(el);
    this.toasts.push({ el, t: kind === "insight" || kind === "quest" || kind === "hint" ? 7 : 4.5 });
    while (this.toasts.length > 5) this.toasts.shift()!.el.remove();
  }

  private zoneBanner(zoneId: string, first: boolean): void {
    const z = this.g.content.zones[zoneId];
    if (!z) return;
    const ed = this.g.zoneEdict(z.id);
    const el = $("#zone-banner");
    el.innerHTML = `<div class="zname">${esc(z.name)}</div>${ed && ed.id !== "blank" ? `<div class="zedict">${esc(ed.name)} — ${esc(ed.text)}</div>` : ""}${first && z.description ? `<div class="zdesc">${esc(z.description)}</div>` : ""}`;
    el.classList.add("show");
    this.zoneBannerT = first ? 6 : 3;
  }

  private set(id: string, html: string): void {
    if (this.last[id] === html) return;
    this.last[id] = html;
    $(id).innerHTML = html;
  }

  update(dt: number): void {
    for (const t of this.toasts) {
      t.t -= dt;
      if (t.t < 0.6) t.el.style.opacity = String(Math.max(0, t.t / 0.6));
    }
    this.toasts = this.toasts.filter((t) => (t.t > 0 ? true : (t.el.remove(), false)));
    if (this.zoneBannerT > 0) {
      this.zoneBannerT -= dt;
      if (this.zoneBannerT <= 0) $("#zone-banner").classList.remove("show");
    }
    if (this.screen !== "playing") return;
    const g = this.g;
    const p = g.player;
    this.minimap.update(dt);
    const pct = (a: number, b: number) => `${Math.max(0, Math.min(100, (a / b) * 100)).toFixed(1)}%`;
    $("#hp-fill").style.width = pct(p.hp, p.maxHp);
    $("#st-fill").style.width = pct(p.stamina, p.maxStamina);
    $("#fray-fill").style.width = pct(p.fray, 100);
    this.set("#hp-text", `${Math.ceil(p.hp)} / ${p.maxHp}`);
    this.set("#ember", Array.from({ length: p.maxEmber }, (_, i) => `<span class="pip ${i < Math.floor(p.ember) ? "on" : ""}"></span>`).join(""));
    this.set("#fray-label", p.fray >= 50 ? `FRAYED ${Math.round(p.fray)} — spells empowered, rupture at 100` : `Fray ${Math.round(p.fray)}`);
    $("#fray").classList.toggle("hot", p.fray >= 50);
    this.set("#level", `Lv ${g.progress.level}${g.progress.unspent || g.progress.pendingTraits ? ` <span class="up">▲ (I)</span>` : ""}`);
    $("#xp-fill").style.width = pct(g.progress.xp, g.xpForNext());

    // ability bar
    const slot = (key: string, name: string, cd = 0, max = 1, extra = "") =>
      `<div class="ab ${cd > 0 ? "cd" : ""}"><div class="key">${key}</div><div class="nm">${esc(name)}</div>${extra}${cd > 0 ? `<div class="cdbar" style="height:${(cd / max) * 100}%"></div>` : ""}</div>`;
    const ws = g.inventory.equippedItem("weapon");
    const abil = (k: "Q" | "R") => {
      const id = g.progress.abilities.find((a) => g.content.abilities[a]?.key === k);
      const a = id ? g.content.abilities[id] : undefined;
      return a ? slot(k, a.name, p.cooldowns[a.id] ?? 0, a.cooldown, `<div class="cost">${a.cost}✶</div>`) : slot(k, "—");
    };
    const flasks = g.inventory.items.filter((i) => g.content.items[i.base]?.throwable).reduce((s, i) => s + i.count, 0);
    const food = g.inventory.items.filter((i) => g.content.items[i.base]?.use).reduce((s, i) => s + i.count, 0);
    this.set(
      "#abilities",
      slot("LMB", ws ? ws.name : "Fists") + slot("RMB", "Heavy") + slot("SPC", "Dodge") + abil("Q") + abil("R") + slot("F", `Flask ×${flasks}`) + slot("C", `Eat ×${food}`),
    );

    // prompt
    const f = g.focus;
    this.set("#prompt", f ? `<span class="key">E</span> ${esc(f.prompt)}` : "");
    $("#prompt").classList.toggle("show", !!f);

    // quest tracker
    const objs = g.quests.objectives();
    this.set("#quests", objs.map((o) => `<div class="q"><div class="qt">${esc(o.title)}</div><div class="qo">${esc(o.text)}</div>${o.hint ? `<div class="qh">${esc(o.hint)}</div>` : ""}</div>`).join(""));

    // zone + edict
    const z = g.currentZone;
    const ed = z ? g.zoneEdict(z.id) : undefined;
    this.set("#zone", z ? `<b>${esc(z.name)}</b>${ed && ed.id !== "blank" ? `<span>${esc(ed.name)}</span>` : ""}` : "");

    // statuses on player
    const st = Object.keys(p.statuses).filter((k) => (p.statuses as Record<string, number>)[k] > 0);
    this.set("#statuses", st.map((s) => `<span class="status ${s}">${s}</span>`).join(""));

    // boss bar
    const boss = g.enemies.find((e) => e.boss && e.awareOfPlayer && !e.dead);
    $("#boss").classList.toggle("show", !!boss);
    if (boss) {
      this.set("#boss-name", esc(boss.def.name));
      $("#boss-fill").style.width = pct(boss.hp, boss.maxHp);
    }
  }
}
