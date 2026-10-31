// Character creator: origin > species > race > sex (if the species has any)
// > body > appearance > clothing > summary, with a live, rotatable preview.
import type { ContentBundle } from "../data/types.js";
import { buildOf, clothColors, cosmeticsFor, defaultLook, heightRange, raceOf, randomLook, sanitizeLook, speciesOf, type CharacterLook } from "../character/look.js";
import { drawCharacter } from "../render/character.js";
import { t } from "../i18n/i18n.js";
import type { UiKey } from "../i18n/en.js";
import { esc } from "./dom.js";

type Step = "origin" | "species" | "race" | "sex" | "body" | "look" | "clothes" | "summary";
const ALL_STEPS: Step[] = ["origin", "species", "race", "sex", "body", "look", "clothes", "summary"];
const ATTR_IDS = ["might", "finesse", "wits", "resolve"] as const;

export interface CreatorHooks {
  begin(origin: string, look: CharacterLook): void;
  back(): void;
  /** True when starting will replace an existing autosave. */
  overwritesAutosave(): boolean;
}

export class CharacterCreator {
  private step: Step = "origin";
  private origin: string;
  private look: CharacterLook;
  private facing = Math.PI / 2;
  private time = 0;
  private walk = 0;
  private preview?: HTMLCanvasElement;
  open = false;

  constructor(private root: HTMLElement, private c: ContentBundle, private hooks: CreatorHooks) {
    this.origin = Object.keys(c.origins)[0];
    this.look = defaultLook(c);
  }

  show(): void {
    this.step = "origin";
    this.open = true;
    this.render();
  }

  private steps(): Step[] {
    const sp = speciesOf(this.c, this.look);
    return ALL_STEPS.filter((s) => s !== "sex" || !!sp.sexes?.length);
  }

  back(): void {
    const st = this.steps();
    const i = st.indexOf(this.step);
    if (i <= 0) {
      this.open = false;
      this.hooks.back();
    } else {
      this.step = st[i - 1];
      this.render();
    }
  }

  private next(): void {
    const st = this.steps();
    const i = st.indexOf(this.step);
    if (i >= st.length - 1) {
      this.open = false;
      this.hooks.begin(this.origin, sanitizeLook(this.c, this.look));
      return;
    }
    this.step = st[i + 1];
    this.render();
  }

  private set(patch: Partial<CharacterLook>): void {
    this.look = sanitizeLook(this.c, { ...this.look, ...patch });
  }

  render(): void {
    const st = this.steps();
    const idx = st.indexOf(this.step);
    const nav = st
      .map((s, i) => `<button data-step="${s}" class="${s === this.step ? "on" : i < idx ? "done" : ""}"><span class="n">${i + 1}</span>${t(`cc.step.${s}` as UiKey)}</button>`)
      .join("");
    const last = idx === st.length - 1;
    this.root.innerHTML = `<div class="creator sheet">
      <header class="sheet-head"><div><h2>${t("cc.title")}</h2><p class="sub">${t("cc.subtitle")}</p></div></header>
      <nav class="cc-steps">${nav}</nav>
      <div class="cc-body">
        <section class="cc-choices">${this.stepBody()}</section>
        <aside class="cc-preview">
          <canvas id="cc-canvas" width="280" height="300"></canvas>
          <div class="cc-rotate"><button data-rot="-1" class="small">‹ ${t("cc.rotate")}</button><button data-rot="1" class="small">${t("cc.rotate")} ›</button></div>
          <div class="cc-summary">${this.summary()}</div>
        </aside>
      </div>
      <footer class="sheet-foot">
        <button data-act="back">${idx === 0 ? t("common.back") : t("cc.previous")}</button>
        <button data-act="random" title="${t("cc.randomHint")}">${t("cc.random")}</button>
        <button data-act="next" class="primary">${last ? t("cc.begin") : t("cc.next")}</button>
      </footer>
    </div>`;
    this.root.classList.remove("hidden");
    this.preview = this.root.querySelector<HTMLCanvasElement>("#cc-canvas") ?? undefined;
    this.bind();
    this.drawPreview();
  }

  private swatches(field: keyof CharacterLook, colors: string[]): string {
    const cur = this.look[field];
    return `<div class="swatches">${colors.map((col) => `<button class="sw ${cur === col ? "on" : ""}" style="--c:${col}" data-set="${field}" data-val="${col}" aria-label="${col}"></button>`).join("")}</div>`;
  }

  private chips(field: keyof CharacterLook, items: { id: string; name: string }[]): string {
    const cur = this.look[field];
    return `<div class="chips">${items.map((it) => `<button class="chip ${cur === it.id ? "on" : ""}" data-set="${field}" data-val="${esc(it.id)}">${esc(it.name)}</button>`).join("")}</div>`;
  }

  private stepBody(): string {
    const c = this.c;
    const look = this.look;
    const sp = speciesOf(c, look);
    const race = raceOf(c, look);
    const field = (label: string, inner: string) => `<div class="field"><div class="field-name">${label}</div>${inner}</div>`;
    switch (this.step) {
      case "origin":
        return `<h3>${t("cc.originQ")}</h3><p class="sub">${t("cc.originSub")}</p><div class="cards">${Object.values(c.origins)
          .map((o) => {
            const trait = o.trait ? c.traits[o.trait] : undefined;
            return `<button class="card ${this.origin === o.id ? "on" : ""}" data-origin="${o.id}">
              <h4>${esc(o.name)}</h4><p>${esc(o.text)}</p>
              <div class="attrs">${ATTR_IDS.map((a) => `<span title="${t(`attr.${a}.name` as UiKey)}">${t(`attr.${a}.short` as UiKey)} <b>${o.attributes[a]}</b></span>`).join("")}</div>
              <div class="kit">${o.equip.concat(o.items).map((i) => esc(c.items[i]?.name ?? i)).join(" · ")}</div>
              ${trait ? `<div class="trait">✦ ${esc(trait.name)} — ${esc(trait.text)}</div>` : ""}
            </button>`;
          })
          .join("")}</div>`;
      case "species":
        return `<h3>${t("cc.speciesQ")}</h3><p class="sub">${t("cc.provisional")}</p><div class="cards">${Object.values(c.species)
          .map(
            (s) => `<button class="card ${s.id === sp.id ? "on" : ""}" data-species="${s.id}"><h4>${esc(s.name)}</h4><p>${esc(s.text)}</p>
              <div class="kit">${s.sexes?.length ? s.sexes.map((x) => esc(x.name)).join(" · ") : t("cc.noSexes")} · ${s.heightCm[0]}–${s.heightCm[1]} cm</div></button>`,
          )
          .join("")}</div>`;
      case "race":
        return `<h3>${t("cc.raceQ", { species: sp.name })}</h3><div class="cards">${sp.races
          .map(
            (r) => `<button class="card ${r.id === race.id ? "on" : ""}" data-race="${r.id}"><h4>${esc(r.name)}</h4><p>${esc(r.text)}</p>
              <div class="mini-swatches">${r.skin.map((col) => `<i style="background:${col}"></i>`).join("")}</div></button>`,
          )
          .join("")}</div>`;
      case "sex":
        return `<h3>${t("cc.sexQ")}</h3>${this.chips("sex", sp.sexes ?? [])}<p class="hint">${t("cc.sexHint")}</p>`;
      case "body": {
        const hr = heightRange(sp, race);
        return `<h3>${t("cc.bodyQ")}</h3>
          ${field(`${t("cc.height")} <b data-out="height">${look.heightCm} cm</b>`, `<input type="range" min="${hr[0]}" max="${hr[1]}" value="${look.heightCm}" data-range="heightCm"/>`)}
          ${field(`${t("cc.weight")} <b data-out="weight">${look.weightKg} kg</b>`, `<input type="range" min="${sp.weightKg[0]}" max="${sp.weightKg[1]}" value="${look.weightKg}" data-range="weightKg"/>`)}
          <p class="hint">${t("cc.build")} : <b data-out="build">${t(buildOf(look))}</b>. ${t("cc.bodyHint")}</p>`;
      }
      case "look":
        return `<h3>${t("cc.lookQ")}</h3>
          ${field(t("cc.skin"), this.swatches("skin", race.skin))}
          ${field(t("cc.hair"), this.chips("hair", cosmeticsFor(c, "hair", sp.id)))}
          ${field(t("cc.hairColor"), this.swatches("hairColor", race.hair))}
          ${field(t("cc.eyes"), this.swatches("eyes", race.eyes))}
          ${field(t("cc.mark"), this.chips("mark", cosmeticsFor(c, "mark", sp.id)))}`;
      case "clothes": {
        const outfit = c.cosmetics[look.outfit];
        return `<h3>${t("cc.clothesQ")}</h3>
          ${field(t("cc.outfit"), this.chips("outfit", cosmeticsFor(c, "outfit", sp.id)))}
          ${field(t("cc.primary"), this.swatches("clothPrimary", clothColors(c)))}
          ${field(t("cc.secondary"), this.swatches("clothSecondary", clothColors(c)))}
          ${outfit?.hood ? `<label class="row toggle"><input type="checkbox" data-hood ${look.hood ? "checked" : ""}/><span class="lbl">${t("cc.hood")}</span></label>` : ""}
          <p class="hint">${t("cc.clothesHint")}</p>`;
      }
      case "summary":
        return `<h3>${t("cc.summaryQ")}</h3><p class="lead">${t("cc.summaryText")}</p>${this.summary(true)}
          ${this.hooks.overwritesAutosave() ? `<p class="warn">${t("cc.overwriteWarn")}</p>` : ""}`;
    }
  }

  private summary(long = false): string {
    const c = this.c;
    const look = this.look;
    const sp = speciesOf(c, look);
    const race = raceOf(c, look);
    const sex = sp.sexes?.find((s) => s.id === look.sex);
    const o = c.origins[this.origin];
    const rows: [string, string][] = [
      [t("cc.step.origin"), o?.name ?? ""],
      [t("cc.step.species"), `${sp.name} · ${race.name}${sex ? ` · ${sex.name}` : ""}`],
      [t("cc.step.body"), `${look.heightCm} cm · ${look.weightKg} kg · ${t(buildOf(look))}`],
    ];
    if (long)
      rows.push(
        [t("cc.hair"), c.cosmetics[look.hair]?.name ?? ""],
        [t("cc.mark"), c.cosmetics[look.mark]?.name ?? ""],
        [t("cc.outfit"), `${c.cosmetics[look.outfit]?.name ?? ""}${c.cosmetics[look.outfit]?.hood && look.hood ? ` · ${t("cc.hoodUp")}` : ""}`],
      );
    return `<dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`;
  }

  private bind(): void {
    const r = this.root;
    r.querySelector("[data-act=back]")?.addEventListener("click", () => this.back());
    r.querySelector("[data-act=next]")?.addEventListener("click", () => this.next());
    r.querySelector("[data-act=random]")?.addEventListener("click", () => {
      // dice keep the origin, and the species once past that step
      const keep = ALL_STEPS.indexOf(this.step) > ALL_STEPS.indexOf("species") ? this.look.species : undefined;
      this.look = randomLook(this.c, Math.random, keep);
      this.render();
    });
    r.querySelectorAll<HTMLElement>("[data-step]").forEach((b) =>
      b.addEventListener("click", () => {
        this.step = b.dataset.step as Step;
        this.render();
      }),
    );
    r.querySelectorAll<HTMLElement>("[data-rot]").forEach((b) =>
      b.addEventListener("click", () => {
        this.facing += (Math.PI / 2) * Number(b.dataset.rot);
      }),
    );
    r.querySelectorAll<HTMLElement>("[data-origin]").forEach((b) =>
      b.addEventListener("click", () => {
        this.origin = b.dataset.origin!;
        this.render();
      }),
    );
    r.querySelectorAll<HTMLElement>("[data-species]").forEach((b) =>
      b.addEventListener("click", () => {
        if (b.dataset.species === this.look.species) return;
        this.look = defaultLook(this.c, b.dataset.species);
        this.render();
      }),
    );
    r.querySelectorAll<HTMLElement>("[data-race]").forEach((b) =>
      b.addEventListener("click", () => {
        // a new race brings its own palettes; keep everything else
        const race = speciesOf(this.c, this.look).races.find((x) => x.id === b.dataset.race)!;
        this.set({ race: race.id, skin: race.skin[0], hairColor: race.hair[0], eyes: race.eyes[0] });
        this.render();
      }),
    );
    r.querySelectorAll<HTMLElement>("[data-set]").forEach((b) =>
      b.addEventListener("click", () => {
        this.set({ [b.dataset.set!]: b.dataset.val } as Partial<CharacterLook>);
        this.render();
      }),
    );
    r.querySelector<HTMLInputElement>("[data-hood]")?.addEventListener("change", (e) => {
      this.set({ hood: (e.target as HTMLInputElement).checked });
      this.render();
    });
    r.querySelectorAll<HTMLInputElement>("[data-range]").forEach((el) =>
      el.addEventListener("input", () => {
        this.set({ [el.dataset.range!]: Number(el.value) } as Partial<CharacterLook>);
        // update labels in place so the slider keeps focus while dragging
        const out = (k: string, v: string) => {
          const o = r.querySelector(`[data-out=${k}]`);
          if (o) o.textContent = v;
        };
        out("height", `${this.look.heightCm} cm`);
        out("weight", `${this.look.weightKg} kg`);
        out("build", t(buildOf(this.look)));
        const sum = r.querySelector(".cc-summary");
        if (sum) sum.innerHTML = this.summary();
      }),
    );
  }

  /** Called every frame while open: animates the preview. */
  tick(dt: number): void {
    if (!this.open) return;
    this.time += dt;
    this.walk += dt * 6;
    this.drawPreview();
  }

  private drawPreview(): void {
    const cv = this.preview;
    if (!cv || !cv.isConnected) return;
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    // floor glow
    const grd = ctx.createRadialGradient(cv.width / 2, cv.height * 0.86, 4, cv.width / 2, cv.height * 0.86, cv.width * 0.45);
    grd.addColorStop(0, "rgba(255,170,90,0.22)");
    grd.addColorStop(1, "rgba(255,170,90,0)");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, cv.width, cv.height);
    const k = 6;
    ctx.setTransform(k, 0, 0, k, cv.width / 2, cv.height * 0.86 - 9 * k);
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.beginPath();
    ctx.ellipse(0, 9, 11, 3.2, 0, 0, Math.PI * 2);
    ctx.fill();
    // hair and face are hidden by a raised hood, so show it lowered while choosing them
    const look = this.step === "look" ? { ...this.look, hood: false } : this.look;
    drawCharacter(ctx, this.c, look, 0, 0, { facing: this.facing, bob: Math.sin(this.time * 2.2) * 0.35, t: this.time, lantern: true });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}
