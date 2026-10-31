// Production build: compiles TypeScript to native ES modules and bundles /data.
// No bundler required: browsers load dist/js/main.js as an ES module.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleData } from "./data-lib.mjs";
import { flatten, localeFiles } from "./i18n.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

export function tscCommand() {
  const local = join(root, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc");
  return existsSync(local) ? local : "tsc";
}

export function writeBundle(outDir) {
  const { bundle, errors } = bundleData(join(root, "data"));
  if (errors.length) {
    console.error("Data errors:\n  " + errors.join("\n  "));
    process.exit(1);
  }
  writeFileSync(join(outDir, "data.bundle.json"), JSON.stringify(bundle));
  return bundle;
}

/** Content translations, flattened to path -> text (dist/locales/<lang>.json). */
export function writeLocales(outDir) {
  mkdirSync(join(outDir, "locales"), { recursive: true });
  for (const { lang, file } of localeFiles()) writeFileSync(join(outDir, "locales", `${lang}.json`), JSON.stringify(flatten(file, lang)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  const tsc = spawnSync(tscCommand(), ["-p", join(root, "tsconfig.json")], { stdio: "inherit", shell: process.platform === "win32" });
  if (tsc.status !== 0) process.exit(tsc.status ?? 1);
  cpSync(join(root, "public"), dist, { recursive: true });
  const bundle = writeBundle(dist);
  writeLocales(dist);
  const counts = Object.entries(bundle).map(([k, v]) => `${k}:${Object.keys(v).length}`).join(" ");
  console.log(`Built dist/ (${counts})`);
}
