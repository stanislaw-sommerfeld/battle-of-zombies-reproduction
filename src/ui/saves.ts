// Save slots screen: load, save, export, import and delete.
// "load" mode is reachable from the title screen and the pause menu,
// "save" mode only from the pause menu.
import type { Game } from "../game.js";
import { MANUAL_SLOTS, type SaveData, type SlotId } from "../save/save.js";
import { getLang, t } from "../i18n/i18n.js";
import { sanitizeLook } from "../character/look.js";
import { drawPortrait } from "../render/character.js";
import { armButton, downloadText, esc, formatDuration, pickTextFile, stamp } from "./dom.js";

export type SavesMode = "load" | "save";

export interface SavesHooks {
  /** A slot was loaded into the game. */
  loaded(): void;
}

export class SavesView {
  private mode: SavesMode = "load";
  private notice = "";
  private onBack: () => void = () => undefined;
  open = false;

  constructor(private root: HTMLElement, private g: Game, private hooks: SavesHooks) {}

  show(mode: SavesMode, onBack: () => void): void {
    this.mode = mode;
    this.onBack = onBack;
    this.notice = "";
    this.open = true;
    this.render();
  }

  back(): void {
    this.open = false;
    this.onBack();
  }

  private slotName(id: SlotId): string {
    return id === "auto" ? t("saves.auto") : t("saves.slot", { n: id });
  }

  private describe(s: SaveData): string {
    const c = this.g.content;
    const look = sanitizeLook(c, s.player.look ?? undefined);
    const sp = c.species[look.species];
    const race = sp?.races.find((r) => r.id === look.race);
    const bits = [
      c.origins[s.player.origin]?.name ?? s.player.origin,
      race && sp ? `${sp.name} · ${race.name}` : "",
      t("hud.level", { n: s.player.level }),
    ].filter(Boolean);
    const zone = s.zone ? c.zones[s.zone]?.name : undefined;
    const when = new Date(s.savedAt).toLocaleString(getLang(), { dateStyle: "medium", timeStyle: "short" });
    return `<div class="slot-line">${bits.map(esc).join(" · ")}</div><div class="slot-meta">${zone ? `${esc(zone)} · ` : ""}${esc(formatDuration(s.playTime))} · ${esc(when)}</div>`;
  }

  render(): void {
    const slots = this.g.slots();
    const rows = slots
      .map((sl) => {
        const d = sl.data;
        const btns: string[] = [];
        if (this.mode === "load" && d) btns.push(`<button data-load="${sl.id}" class="small primary">${t("saves.load")}</button>`);
        if (this.mode === "save" && MANUAL_SLOTS.includes(sl.id)) btns.push(`<button data-save="${sl.id}" class="small primary">${t(d ? "saves.overwrite" : "saves.saveHere")}</button>`);
        if (d) btns.push(`<button data-export="${sl.id}" class="small">${t("saves.export")}</button>`);
        btns.push(`<button data-import="${sl.id}" class="small">${t("saves.import")}</button>`);
        if (d || sl.error) btns.push(`<button data-delete="${sl.id}" class="small danger">${t("saves.delete")}</button>`);
        const body = d
          ? this.describe(d)
          : sl.error
            ? `<div class="slot-error">${esc(t("saves.damaged", { reason: sl.error }))}</div>`
            : `<div class="slot-empty">${t(sl.id === "auto" ? "saves.autoEmpty" : "saves.empty")}</div>`;
        return `<div class="slot-row ${d ? "" : "is-empty"}">
          <canvas class="slot-portrait" width="96" height="96" data-portrait="${sl.id}"></canvas>
          <div class="slot-info"><div class="slot-title">${esc(this.slotName(sl.id))}</div>${body}</div>
          <div class="slot-actions">${btns.join("")}</div>
        </div>`;
      })
      .join("");
    this.root.innerHTML = `<div class="saves sheet">
      <header class="sheet-head"><h2>${t(this.mode === "load" ? "saves.titleLoad" : "saves.titleSave")}</h2><button data-act="back" class="small">${t("common.back")}</button></header>
      <p class="hint">${t("saves.hint")}</p>
      <div class="slot-list">${rows}</div>
      ${this.notice ? `<div class="notice">${esc(this.notice)}</div>` : ""}
    </div>`;
    this.root.classList.remove("hidden");
    for (const sl of slots) {
      const cv = this.root.querySelector<HTMLCanvasElement>(`[data-portrait="${sl.id}"]`);
      if (cv && sl.data) drawPortrait(cv, this.g.content, sanitizeLook(this.g.content, sl.data.player.look ?? undefined));
    }
    this.bind();
  }

  private bind(): void {
    const r = this.root;
    const g = this.g;
    r.querySelector("[data-act=back]")?.addEventListener("click", () => this.back());
    r.querySelectorAll<HTMLElement>("[data-load]").forEach((b) =>
      b.addEventListener("click", () => {
        if (g.loadSlot(b.dataset.load as SlotId)) {
          this.open = false;
          this.hooks.loaded();
        } else {
          this.notice = t("saves.loadFailed");
          this.render();
        }
      }),
    );
    r.querySelectorAll<HTMLElement>("[data-save]").forEach((b) => {
      const id = b.dataset.save as SlotId;
      const run = () => {
        this.notice = g.save(id) ? t("saves.saved", { slot: this.slotName(id) }) : t("toast.saveFailed");
        this.render();
      };
      if (g.slots().find((s) => s.id === id)?.data) armButton(b, t("common.confirm"), run);
      else b.addEventListener("click", run);
    });
    r.querySelectorAll<HTMLElement>("[data-export]").forEach((b) =>
      b.addEventListener("click", () => {
        const id = b.dataset.export as SlotId;
        const text = g.exportSlot(id);
        if (!text) return;
        downloadText(`ash-ledger-save-${id}_${stamp()}.json`, text);
        this.notice = t("saves.exported");
        this.render();
      }),
    );
    r.querySelectorAll<HTMLElement>("[data-import]").forEach((b) => {
      const id = b.dataset.import as SlotId;
      const run = async () => {
        const text = await pickTextFile();
        if (text === undefined) return;
        try {
          g.importToSlot(id, text);
          this.notice = t("saves.imported", { slot: this.slotName(id) });
        } catch (e) {
          this.notice = t("saves.importFailed", { reason: (e as Error).message || t("common.unknownError") });
        }
        this.render();
      };
      // importing over an existing save needs a second click
      if (g.slots().find((s) => s.id === id)?.data) armButton(b, t("saves.confirmReplace"), run);
      else b.addEventListener("click", run);
    });
    r.querySelectorAll<HTMLElement>("[data-delete]").forEach((b) =>
      armButton(b, t("common.confirm"), () => {
        g.deleteSlot(b.dataset.delete as SlotId);
        this.notice = t("saves.deleted");
        this.render();
      }),
    );
  }
}
