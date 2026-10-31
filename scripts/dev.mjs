// Development: tsc in watch mode + static server. Data files are re-bundled on every
// page load, so editing /data/*.json only needs a browser refresh.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tscCommand } from "./build.mjs";
import { bundleData } from "./data-lib.mjs";
import { serve } from "./serve.mjs";
import { flatten, localeFiles } from "./i18n.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "dist"), { recursive: true });

spawn(tscCommand(), ["-p", join(root, "tsconfig.json"), "--watch", "--preserveWatchOutput"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

serve([join(root, "public"), join(root, "dist")], Number(process.env.PORT ?? 5173), {
  "/data.bundle.json": () => {
    const { bundle, errors } = bundleData(join(root, "data"));
    if (errors.length) console.error("Data errors:\n  " + errors.join("\n  "));
    return JSON.stringify(bundle);
  },
  // translations are re-read on every request too
  ...Object.fromEntries(localeFiles().map(({ lang, file }) => [`/locales/${lang}.json`, () => JSON.stringify(flatten(file, lang))])),
});
