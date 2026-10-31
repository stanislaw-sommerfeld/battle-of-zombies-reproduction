// Settings screen: language, controls (rebinding), audio, display, and
// settings export/import. Opened from the title screen and the pause menu.
import { ACTIONS, RESERVED_CODES, type Action, type Input } from "../core/input.js";
import { SettingsStore, cloneBindings, defaultSettings, rebind } from "../core/settings.js";
import { DEFAULT_BINDINGS } from "../core/input.js";
import { LANGS, t, type Lang } from "../i18n/i18n.js";
import type { UiKey } from "../i18n/en.js";
import { codeLabel } from "../i18n/keys.js";
import { armButton, downloadText, esc, pickTextFile, stamp } from "./dom.js";

type Tab = "general" | "controls" | "audio" | "display" | "data";
const TABS: Tab[] = ["general", "controls", "audio", "display", "data"];

export interface SettingsHooks {
  setLanguage(lang: Lang): Promise<void>;
  toast(text: string, kind?: string): void;
}

export class SettingsView {
  private tab: Tab = "general";
  private listening?: { action: Action; slot: number };
  private notice = "";
  private onBack: () => void = () => undefined;
  open = false;

  constructor(private root: HTMLElement, private store: SettingsStore, private input: Input, private hooks: SettingsHooks) {}

  show(onBack: () => void): void {
    this.onBack = onBack;
    this.open = true;
    this.notice = "";
    this.render();
  }

  /** Esc: stop listening for a key, else leave the screen. */
  back(): void {
    if (this.listening) {
      this.listening = undefined;
      this.input.capture = undefined;
      return this.render();
    }
    this.open = false;
    this.input.capture = undefined;
    this.onBack();
  }

  private get s() {
    return this.store.value;
  }

  render(): void {
    const tabs = TABS.map((k) => `<button data-tab="${k}" class="${this.tab === k ? "on" : ""}">${t(`settings.tab.${k}` as UiKey)}</button>`).join("");
    this.root.innerHTML = `<div class="settings sheet">
      <header class="sheet-head"><h2>${t("settings.title")}</h2><button data-act="back" class="small">${t("common.back")}</button></header>
      <nav class="tabs">${tabs}</nav>
      <div class="sheet-body">${this.body()}</div>
      ${this.notice ? `<div class="notice">${esc(this.notice)}</div>` : ""}
    </div>`;
    this.root.classList.remove("hidden");
    this.bind();
  }

  private body(): string {
    const s = this.s;
    const check = (id: string, on: boolean, label: string, hint = "") =>
      `<label class="row toggle"><input type="checkbox" data-check="${id}" ${on ? "checked" : ""}/><span class="lbl">${label}${hint ? `<small>${hint}</small>` : ""}</span></label>`;
    switch (this.tab) {
      case "general":
        return `<div class="field"><div class="field-name">${t("settings.language")}</div><div class="choice-row">${LANGS.map(
          (l) => `<button data-lang="${l.id}" class="${s.language === l.id ? "on" : ""}">${esc(l.name)}</button>`,
        ).join("")}</div><p class="hint">${t("settings.languageHint")}</p></div>
        ${check("hints", s.display.hints, t("settings.hints"), t("settings.hintsHint"))}`;
      case "controls": {
        const rows = ACTIONS.map((a) => {
          const codes = s.bindings[a];
          const cell = (slot: number) => {
            const listening = this.listening?.action === a && this.listening.slot === slot;
            const code = codes[slot];
            return `<button class="keycap ${listening ? "listening" : ""} ${code ? "" : "unbound"}" data-bind="${a}" data-slot="${slot}">${
              listening ? t("settings.pressKey") : code ? esc(codeLabel(this.input, code)) : "—"
            }</button>`;
          };
          return `<div class="bind-row"><span class="act">${t(`action.${a}` as UiKey)}</span>${cell(0)}${cell(1)}</div>`;
        }).join("");
        return `<p class="hint">${t("settings.controlsHint")}</p><div class="bind-table">${rows}</div>
          <div class="choice-row"><button data-act="reset-keys">${t("settings.resetKeys")}</button></div>`;
      }
      case "audio":
        return `<div class="field"><div class="field-name">${t("settings.volume")} <b>${Math.round(s.audio.volume * 100)}%</b></div>
          <input type="range" min="0" max="100" step="5" value="${Math.round(s.audio.volume * 100)}" data-range="volume"/></div>
          ${check("muted", s.audio.muted, t("settings.mute"), t("settings.muteHint", { key: codeLabel(this.input, s.bindings.mute[0]) }))}`;
      case "display":
        return `<div class="field"><div class="field-name">${t("settings.hudScale")} <b>${Math.round(s.display.hudScale * 100)}%</b></div>
          <input type="range" min="75" max="150" step="5" value="${Math.round(s.display.hudScale * 100)}" data-range="hudScale"/></div>
          ${check("screenShake", s.display.screenShake, t("settings.shake"))}
          ${check("minimap", s.display.minimap, t("settings.minimap"))}`;
      case "data":
        return `<p class="hint">${t("settings.dataHint")}</p>
          <div class="choice-row"><button data-act="export">${t("settings.export")}</button><button data-act="import">${t("settings.import")}</button></div>
          <div class="choice-row"><button data-act="reset-all" class="danger">${t("settings.resetAll")}</button></div>`;
    }
  }

  private commit(): void {
    this.store.commit();
  }

  private bind(): void {
    const r = this.root;
    r.querySelectorAll<HTMLElement>("[data-tab]").forEach((b) =>
      b.addEventListener("click", () => {
        this.tab = b.dataset.tab as Tab;
        this.listening = undefined;
        this.input.capture = undefined;
        this.notice = "";
        this.render();
      }),
    );
    r.querySelector("[data-act=back]")?.addEventListener("click", () => this.back());
    r.querySelectorAll<HTMLElement>("[data-lang]").forEach((b) =>
      b.addEventListener("click", async () => {
        const lang = b.dataset.lang as Lang;
        this.s.language = lang;
        this.commit();
        await this.hooks.setLanguage(lang);
        this.render();
      }),
    );
    r.querySelectorAll<HTMLInputElement>("[data-check]").forEach((el) =>
      el.addEventListener("change", () => {
        const s = this.s;
        const v = el.checked;
        switch (el.dataset.check) {
          case "hints": s.display.hints = v; break;
          case "muted": s.audio.muted = v; break;
          case "screenShake": s.display.screenShake = v; break;
          case "minimap": s.display.minimap = v; break;
        }
        this.commit();
      }),
    );
    r.querySelectorAll<HTMLInputElement>("[data-range]").forEach((el) => {
      el.addEventListener("input", () => {
        const v = Number(el.value) / 100;
        if (el.dataset.range === "volume") this.s.audio.volume = v;
        else this.s.display.hudScale = v;
        const b = el.previousElementSibling?.querySelector("b");
        if (b) b.textContent = `${el.value}%`;
        this.commit();
      });
    });
    r.querySelectorAll<HTMLElement>("[data-bind]").forEach((b) =>
      b.addEventListener("click", () => {
        const action = b.dataset.bind as Action;
        const slot = Number(b.dataset.slot);
        this.listening = { action, slot };
        this.notice = "";
        this.render();
        // the click that started listening has already finished, so the next input is the new key
        this.input.capture = (code) => this.onCaptured(action, slot, code);
      }),
    );
    const resetKeys = r.querySelector<HTMLElement>("[data-act=reset-keys]");
    if (resetKeys)
      armButton(resetKeys, t("common.confirm"), () => {
        this.s.bindings = cloneBindings(DEFAULT_BINDINGS);
        this.notice = t("settings.keysReset");
        this.commit();
        this.render();
      });
    r.querySelector("[data-act=export]")?.addEventListener("click", () => {
      downloadText(`ash-ledger-settings_${stamp()}.json`, this.store.exportFile());
      this.notice = t("settings.exported");
      this.render();
    });
    r.querySelector("[data-act=import]")?.addEventListener("click", async () => {
      const text = await pickTextFile();
      if (text === undefined) return;
      try {
        const s = SettingsStore.parseFile(text);
        this.store.replace(s);
        await this.hooks.setLanguage(s.language);
        this.notice = t("settings.imported");
      } catch (e) {
        this.notice = t("settings.importFailed", { reason: (e as Error).message || t("common.unknownError") });
      }
      this.render();
    });
    const resetAll = r.querySelector<HTMLElement>("[data-act=reset-all]");
    if (resetAll)
      armButton(resetAll, t("common.confirm"), async () => {
        this.store.replace(defaultSettings(this.s.language));
        this.notice = t("settings.allReset");
        this.render();
      });
  }

  private onCaptured(action: Action, slot: number, code: string): void {
    this.listening = undefined;
    if (code === "Escape") return this.render();
    if (code === "Backspace" || code === "Delete") {
      rebind(this.s, action, slot, undefined);
      this.commit();
      return this.render();
    }
    if (RESERVED_CODES.has(code)) {
      this.notice = t("settings.reserved");
      return this.render();
    }
    const stolen = rebind(this.s, action, slot, code);
    this.notice = stolen ? t("settings.keyMoved", { key: codeLabel(this.input, code), action: t(`action.${stolen}` as UiKey) }) : "";
    this.commit();
    this.render();
  }
}
