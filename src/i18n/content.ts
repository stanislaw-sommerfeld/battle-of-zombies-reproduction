// Content localization. English text lives in /data as the source of truth.
// Other languages are flat overlays keyed by a path into the content bundle,
// e.g. "items/rusted_blade/name" or "dialogue/ilse/nodes/intro/options/2/text".
// Overlays are applied in place so entities holding references to definitions
// (enemy.def, npc.def...) pick up the new language without a reload.
// No DOM access here: build scripts import this module too.

/** Object keys whose string values are shown to the player. */
export const TEXT_FIELDS = new Set(["text", "name", "title", "description", "summary", "hint", "prompt", "speaker", "toast", "departText"]);
/** Categories that never hold player-facing text. */
const SKIP_CATEGORIES = new Set(["regions", "loot", "tiles"]);

type Json = unknown;

/** Every translatable string in the bundle, by path. */
export function collectText(bundle: Record<string, Record<string, Json>>): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (node: Json, path: string, key: string) => {
    if (typeof node === "string") {
      if (TEXT_FIELDS.has(key) && node.trim()) out.set(path, node);
      return;
    }
    if (Array.isArray(node)) node.forEach((v, i) => walk(v, `${path}/${i}`, key));
    else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) walk(v, `${path}/${k}`, k);
  };
  for (const [cat, defs] of Object.entries(bundle)) {
    if (SKIP_CATEGORIES.has(cat) || !defs || typeof defs !== "object") continue;
    for (const [id, def] of Object.entries(defs)) walk(def, `${cat}/${id}`, "");
  }
  return out;
}

function setPath(root: Json, path: string, value: string): boolean {
  const parts = path.split("/");
  let node = root as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = node?.[parts[i]];
    if (!next || typeof next !== "object") return false;
    node = next as Record<string, unknown>;
  }
  const last = parts[parts.length - 1];
  if (typeof node[last] !== "string") return false;
  node[last] = value;
  return true;
}

/**
 * Writes `overlay` (or the English source where the overlay has no entry)
 * into the live bundle.
 */
export function applyText(bundle: Json, source: Map<string, string>, overlay: Record<string, string> | undefined): number {
  let n = 0;
  for (const [path, en] of source) if (setPath(bundle, path, overlay?.[path] ?? en)) n++;
  return n;
}

/** Translation file format: path -> { en: source at translation time, fr: text }. */
export type TranslationFile = Record<string, { en: string; [lang: string]: string }>;
