// Collects every JSON file under /data into a single bundle the game loads at boot.
// Layout: data/<category>/<anything>.json, where a file holds one definition
// (an object with an "id") or an array of definitions.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export function bundleData(dataDir) {
  const bundle = {};
  const errors = [];
  for (const category of readdirSync(dataDir)) {
    const catDir = join(dataDir, category);
    if (!statSync(catDir).isDirectory()) continue;
    const entries = (bundle[category] = {});
    for (const file of walk(catDir)) {
      if (!file.endsWith(".json")) continue;
      let parsed;
      try {
        parsed = JSON.parse(readFileSync(file, "utf8"));
      } catch (e) {
        errors.push(`${relative(dataDir, file)}: invalid JSON (${e.message})`);
        continue;
      }
      for (const def of Array.isArray(parsed) ? parsed : [parsed]) {
        if (!def || typeof def.id !== "string") {
          errors.push(`${relative(dataDir, file)}: every definition needs a string "id"`);
          continue;
        }
        if (entries[def.id]) errors.push(`${category}/${def.id}: duplicate id (${relative(dataDir, file)})`);
        entries[def.id] = def;
      }
    }
  }
  return { bundle, errors };
}

function* walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}
