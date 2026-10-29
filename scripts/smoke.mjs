// Headless browser smoke test: boots the built game, starts a new game, plays a
// few seconds of scripted input and fails on any console error.
// Requires playwright-core (not a project dependency):
//   PLAYWRIGHT_CORE=/path/to/playwright-core CHROME=/path/to/chrome node scripts/smoke.mjs
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { serve } from "./serve.mjs";

const pwPath = process.env.PLAYWRIGHT_CORE;
const { chromium } = await import(pwPath ? pathToFileURL(join(pwPath, "index.mjs")).href : "playwright-core");
const port = 4199;
const server = serve([join(process.cwd(), "dist")], port);
const shots = process.env.SHOTS ?? "/tmp";
const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

const wait = (ms) => page.waitForTimeout(ms);
const game = (fn, arg) => page.evaluate(fn, arg);

try {
  await page.goto(`http://localhost:${port}/`);
  await page.waitForSelector(".title-screen");
  await page.screenshot({ path: `${shots}/01-title.png` });
  await page.click("[data-act=new]");
  await page.click(`[data-origin=${process.env.ORIGIN ?? "lamplighter"}]`);
  await wait(1500);
  await page.screenshot({ path: `${shots}/02-start.png` });

  // walk north toward the first hound and fight it
  await page.mouse.move(640, 200);
  await page.keyboard.down("KeyW");
  await wait(1600);
  await page.keyboard.up("KeyW");
  await page.screenshot({ path: `${shots}/03-road.png` });
  for (let i = 0; i < 6; i++) {
    await page.mouse.down({ button: "left" });
    await page.mouse.up({ button: "left" });
    await wait(250);
  }
  await page.keyboard.press("KeyQ");
  await wait(300);
  await page.keyboard.press("KeyF");
  await wait(700);
  await page.screenshot({ path: `${shots}/04-combat.png` });

  const state = await game(() => {
    const g = window.ashLedger.game;
    return {
      hp: g.player.hp,
      pos: g.player.pos,
      zone: g.currentZone?.id,
      enemies: g.enemies.length,
      fray: g.player.fray,
      inventory: g.inventory.items.map((i) => i.base),
    };
  });
  console.log("state after play:", JSON.stringify(state));

  // open inventory and the pause menu to exercise UI
  await page.keyboard.press("KeyI");
  await wait(300);
  await page.screenshot({ path: `${shots}/05-inventory.png` });
  await page.keyboard.press("KeyI");
  await page.keyboard.press("Escape");
  await wait(200);
  await page.screenshot({ path: `${shots}/06-pause.png` });
  await page.keyboard.press("Escape");
} finally {
  await browser.close();
  server.close();
}
if (errors.length) {
  console.error("Console errors:\n  " + errors.join("\n  "));
  process.exit(1);
}
console.log("Smoke test passed. Screenshots in", shots);
