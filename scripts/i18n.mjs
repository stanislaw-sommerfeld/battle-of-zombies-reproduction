// Content translations. English text in /data is the source; each other
// language has locales/<lang>.content.json mapping a content path to
// { en: source text when translated, <lang>: translation }.
//
//   node scripts/i18n.mjs sync fr    add new strings, drop removed ones, keep the rest
//   node scripts/i18n.mjs check      list missing and outdated translations
//
// A translation is "outdated" when the English source changed after it was
// written. The game still uses it (better than nothing); `check` lists it.
// Requires a build first (reads dist/js/i18n/content.js).
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bundleData } from "./data-lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const LOCALES_DIR = join(root, "locales");

export function localeFiles() {
  if (!existsSync(LOCALES_DIR)) return [];
  return readdirSync(LOCALES_DIR)
    .filter((f) => f.endsWith(".content.json"))
    .map((f) => ({ lang: f.replace(".content.json", ""), file: join(LOCALES_DIR, f) }));
}

/** path -> translated text, for the game (dist/locales/<lang>.json). */
export function flatten(file, lang) {
  const tr = JSON.parse(readFileSync(file, "utf8"));
  const out = {};
  for (const [path, e] of Object.entries(tr)) if (e[lang]) out[path] = e[lang];
  return out;
}

async function sourceText() {
  const { collectText } = await import(pathToFileURL(join(root, "dist/js/i18n/content.js")).href);
  const { bundle } = bundleData(join(root, "data"));
  return collectText(bundle);
}

/** Missing and outdated entries per language. */
export async function report() {
  const src = await sourceText();
  return localeFiles().map(({ lang, file }) => {
    const tr = JSON.parse(readFileSync(file, "utf8"));
    const missing = [];
    const outdated = [];
    for (const [path, en] of src) {
      const e = tr[path];
      if (!e?.[lang]) missing.push(path);
      else if (e.en !== en) outdated.push(path);
    }
    const unused = Object.keys(tr).filter((p) => !src.has(p));
    return { lang, total: src.size, missing, outdated, unused };
  });
}

async function sync(lang) {
  const src = await sourceText();
  const file = join(LOCALES_DIR, `${lang}.content.json`);
  const old = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const out = {};
  for (const [path, en] of src) out[path] = old[path] ? { ...old[path], en: old[path][lang] ? old[path].en : en } : { en, [lang]: "" };
  writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  const empty = Object.values(out).filter((e) => !e[lang]).length;
  console.log(`${file}: ${Object.keys(out).length} strings, ${empty} untranslated, ${Object.keys(old).length - Object.keys(old).filter((k) => out[k]).length} removed`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, lang] = process.argv.slice(2);
  if (cmd === "sync" && lang) await sync(lang);
  else if (cmd === "check") {
    for (const r of await report()) {
      console.log(`${r.lang}: ${r.total - r.missing.length}/${r.total} translated, ${r.outdated.length} outdated, ${r.unused.length} unused`);
      for (const p of r.missing) console.log(`  missing   ${p}`);
      for (const p of r.outdated) console.log(`  outdated  ${p}`);
    }
  } else {
    console.log("usage: node scripts/i18n.mjs sync <lang> | check");
    process.exit(1);
  }
}
