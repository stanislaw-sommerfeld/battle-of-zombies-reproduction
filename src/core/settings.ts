// Player settings: language, key bindings, audio and display options.
// Stored apart from saves so they survive new games, and exportable as a file.
import { ACTIONS, DEFAULT_BINDINGS, RESERVED_CODES, type Action } from "./input.js";
import { isLang, type Lang } from "../i18n/i18n.js";

export const SETTINGS_KEY = "ash-ledger.settings";
export const SETTINGS_VERSION = 1;
export const SETTINGS_FILE_FORMAT = "ash-ledger-settings";

export interface Settings {
  version: number;
  language: Lang;
  bindings: Record<Action, string[]>;
  audio: { volume: number; muted: boolean };
  display: {
    /** Multiplies the size of every HUD element. */
    hudScale: number;
    screenShake: boolean;
    minimap: boolean;
    /** Contextual tips (first oil barrel, first echo...). */
    hints: boolean;
  };
}

export interface KeyValueStorage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export function defaultSettings(language: Lang = "en"): Settings {
  return {
    version: SETTINGS_VERSION,
    language,
    bindings: cloneBindings(DEFAULT_BINDINGS),
    audio: { volume: 0.7, muted: false },
    display: { hudScale: 1, screenShake: true, minimap: true, hints: true },
  };
}

export function cloneBindings(b: Record<Action, string[]>): Record<Action, string[]> {
  return Object.fromEntries(ACTIONS.map((a) => [a, [...(b[a] ?? [])]])) as Record<Action, string[]>;
}

const CODE_RE = /^(Mouse[0-4]|[A-Za-z][A-Za-z0-9]{0,24})$/;
const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);

/**
 * Turns anything (an old settings object, an imported file) into valid
 * settings. Unknown fields are dropped, missing ones get defaults, and a key
 * is never bound to two actions.
 */
export function sanitizeSettings(raw: unknown, fallbackLang: Lang = "en"): Settings {
  const d = defaultSettings(fallbackLang);
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Partial<Settings>;
  const out = defaultSettings(isLang(r.language) ? r.language : fallbackLang);
  if (r.bindings && typeof r.bindings === "object") {
    const used = new Set<string>();
    for (const a of ACTIONS) {
      const given = (r.bindings as Record<string, unknown>)[a];
      const codes: unknown[] = Array.isArray(given) ? given : DEFAULT_BINDINGS[a];
      out.bindings[a] = codes
        .filter((c): c is string => typeof c === "string" && CODE_RE.test(c) && !RESERVED_CODES.has(c) && !used.has(c))
        .slice(0, 2);
      out.bindings[a].forEach((c) => used.add(c));
    }
  }
  const au = (r.audio ?? {}) as Partial<Settings["audio"]>;
  out.audio = { volume: num(au.volume, 0, 1, d.audio.volume), muted: bool(au.muted, false) };
  const di = (r.display ?? {}) as Partial<Settings["display"]>;
  out.display = {
    hudScale: num(di.hudScale, 0.75, 1.5, 1),
    screenShake: bool(di.screenShake, true),
    minimap: bool(di.minimap, true),
    hints: bool(di.hints, true),
  };
  return out;
}

/** Binds `code` to `action` in slot 0 or 1, unbinding it everywhere else. Returns the action it was taken from. */
export function rebind(s: Settings, action: Action, slot: number, code: string | undefined): Action | undefined {
  let stolen: Action | undefined;
  if (code)
    for (const a of ACTIONS) {
      const i = s.bindings[a].indexOf(code);
      if (i >= 0 && !(a === action && i === slot)) {
        s.bindings[a].splice(i, 1);
        if (a !== action) stolen = a;
      }
    }
  const list = s.bindings[action];
  if (code) {
    if (slot < list.length) list[slot] = code;
    else list.push(code);
  } else list.splice(slot, 1);
  s.bindings[action] = [...new Set(list)].slice(0, 2);
  return stolen;
}

export class SettingsStore {
  value: Settings;
  private listeners: ((s: Settings) => void)[] = [];

  constructor(private storage: KeyValueStorage, browserLang: string) {
    const fallback: Lang = browserLang.toLowerCase().startsWith("fr") ? "fr" : "en";
    let raw: unknown;
    try {
      raw = JSON.parse(storage.getItem(SETTINGS_KEY) ?? "null");
    } catch {
      raw = null;
    }
    this.value = sanitizeSettings(raw, fallback);
  }

  onChange(fn: (s: Settings) => void): void {
    this.listeners.push(fn);
  }

  /** Persists and notifies. Call after mutating `value`. */
  commit(): void {
    this.value = sanitizeSettings(this.value, this.value.language);
    try {
      this.storage.setItem(SETTINGS_KEY, JSON.stringify(this.value));
    } catch (e) {
      console.warn("Could not store settings:", e);
    }
    for (const fn of this.listeners) fn(this.value);
  }

  replace(s: Settings): void {
    this.value = s;
    this.commit();
  }

  exportFile(): string {
    return JSON.stringify({ format: SETTINGS_FILE_FORMAT, version: SETTINGS_VERSION, exportedAt: new Date().toISOString(), settings: this.value }, null, 2);
  }

  /** Validates an exported settings file. Throws a readable message if it isn't one. */
  static parseFile(text: string): Settings {
    if (text.length > 200_000) throw new Error("file too large");
    const raw = JSON.parse(text) as { format?: string; settings?: unknown };
    if (raw?.format !== SETTINGS_FILE_FORMAT || !raw.settings) throw new Error("not an Ash Ledger settings file");
    return sanitizeSettings(raw.settings);
  }
}
