// Interface strings (t) and content language switching.
// UI dictionaries are compiled in (src/i18n/en.ts, fr.ts) so text is available
// synchronously. Content overlays are fetched once per language.
import { en, type UiKey } from "./en.js";
import { fr } from "./fr.js";
import { applyText, collectText } from "./content.js";

export type Lang = "en" | "fr";
export const LANGS: { id: Lang; name: string }[] = [
  { id: "en", name: "English" },
  { id: "fr", name: "Français" },
];
export const isLang = (v: unknown): v is Lang => LANGS.some((l) => l.id === v);

const DICTS: Record<Lang, Record<string, string>> = { en, fr };
let current: Lang = "en";

export function getLang(): Lang {
  return current;
}

/** Translate an interface string. `{name}` placeholders are filled from params. */
export function t(key: UiKey, params?: Record<string, string | number>): string {
  return format(DICTS[current][key] ?? en[key] ?? key, params);
}

/** Like t, for keys built at runtime (status ids, perk ids...). Falls back to `fallback`. */
export function tx(key: string, fallback: string, params?: Record<string, string | number>): string {
  return format(DICTS[current][key] ?? (en as Record<string, string>)[key] ?? fallback, params);
}

function format(s: string, params?: Record<string, string | number>): string {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

/** Switches the interface language and rewrites content text in place. */
export class ContentLocalizer {
  private source: Map<string, string>;
  private overlays: Partial<Record<Lang, Record<string, string>>> = {};

  constructor(private bundle: object, private fetchOverlay: (lang: Lang) => Promise<Record<string, string>>) {
    this.source = collectText(bundle as Record<string, Record<string, unknown>>);
  }

  async use(lang: Lang): Promise<void> {
    let overlay: Record<string, string> | undefined;
    if (lang !== "en") {
      try {
        overlay = this.overlays[lang] ??= await this.fetchOverlay(lang);
      } catch (e) {
        console.warn(`No content translation for ${lang}; using English text.`, e);
        overlay = undefined;
      }
    }
    current = lang;
    if (typeof document !== "undefined") document.documentElement.lang = lang;
    applyText(this.bundle, this.source, overlay);
  }
}
