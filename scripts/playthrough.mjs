// Scripted end-to-end check of the vertical slice's main loop, driven through
// the game's debug handle (window.ashLedger). Same env vars as smoke.mjs.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { serve } from "./serve.mjs";

const pw = process.env.PLAYWRIGHT_CORE;
const { chromium } = await import(pw ? pathToFileURL(join(pw, "index.mjs")).href : "playwright-core");
const port = 4198;
const server = serve([join(process.cwd(), "dist")], port);
const shots = process.env.SHOTS ?? "/tmp";
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
const wait = (ms) => page.waitForTimeout(ms);
const ev = (fn, arg) => page.evaluate(fn, arg);
const results = [];
const check = (name, ok, info = "") => {
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${info ? "  (" + info + ")" : ""}`);
};
// Level-ups open a trait choice that pauses the world; pick the first trait.
const pickTraits = () => ev(() => { for (let i = 0; i < 5; i++) document.querySelector("[data-trait]")?.click(); });
// Teleport helper (tile coords)
const tp = async (x, y) => (await pickTraits(), ev(([x, y]) => {
  const g = window.ashLedger.game;
  g.player.pos.x = (x + 0.5) * 32;
  g.player.pos.y = (y + 0.5) * 32;
}, [x, y]));
// choose dialogue option whose text contains `s`
const choose = (s) => ev((s) => {
  const btn = [...document.querySelectorAll("[data-opt]")].find((b) => b.textContent.includes(s));
  if (!btn) return [...document.querySelectorAll("[data-opt]")].map((b) => b.textContent).join(" | ");
  btn.click();
  return true;
}, s);

try {
  await page.goto(`http://localhost:${port}/`);
  await page.waitForSelector(".title-screen");
  await page.click("[data-act=new]");
  await page.click("[data-origin=gravedigger]");
  await wait(500);

  // 1. read the note at the crater
  await tp(38, 51);
  await wait(200);
  await ev(() => window.ashLedger.game.interact());
  await wait(200);
  check("lore page opens", await ev(() => !!document.querySelector(".lore")));
  await page.keyboard.press("KeyE");
  await wait(100);

  // 2. talk to Ilse and accept the quest
  await tp(38, 10);
  await wait(300);
  const focus = await ev(() => window.ashLedger.game.focus?.prompt);
  check("Ilse is interactable", !!focus && focus.includes("Ilse"), focus);
  await ev(() => window.ashLedger.game.interact());
  await wait(200);
  await choose("What happened to the well");
  await choose("I'll find out");
  await choose("[Leave]");
  check("quest started", await ev(() => window.ashLedger.game.quests.state("q_fouled_well") === "active"));
  await page.screenshot({ path: `${shots}/10-hub.png` });

  // 3. go to the spring: stage advances on AreaEntered
  await tp(60, 38);
  await wait(400);
  check("quest advanced at spring", await ev(() => window.ashLedger.game.quests.stage("q_fouled_well") === "deal"));

  // 4. systemic solution: set the ink on fire (as an ember bolt would) and let the Edict of Kindling spread it
  await tp(57, 32);
  await wait(100);
  await ev(() => {
    const g = window.ashLedger.game;
    // make the player untouchable for the test so creatures don't interfere
    g.player.maxHp = 9999;
    g.player.hp = 9999;
    for (const [x, y] of [[63, 35], [61, 39], [66, 36], [70, 41], [64, 44], [69, 37], [62, 42], [71, 38]]) g.surfaces.ignite(x, y);
  });
  await wait(1200);
  await page.screenshot({ path: `${shots}/11-spring-burning.png` });
  for (let i = 0; i < 25; i++) {
    const done = await ev(() => window.ashLedger.game.world.get("spring_state"));
    if (done) break;
    await ev(() => {
      const g = window.ashLedger.game;
      // keep re-igniting any remaining ink, like a player would with more bolts
      const z = g.content.zones.orchard_spring.rect;
      for (let y = z[1]; y < z[1] + z[3]; y++) for (let x = z[0]; x < z[0] + z[2]; x++) if (g.surfaces.getLiquid(x, y) === 3 && Math.random() < 0.15) g.surfaces.ignite(x, y);
    });
    await wait(500);
  }
  const spring = await ev(() => ({ s: window.ashLedger.game.world.get("spring_state"), matron: window.ashLedger.game.enemies.some((e) => e.def.id === "leech_matron"), edict: window.ashLedger.game.edictAtCell(66, 38).id }));
  check("burning the ink cleans the spring", spring.s === "burned_clean", JSON.stringify(spring));
  check("Leech-Mother departs without a fight", !spring.matron);
  check("world scar: spring edict rewritten", spring.edict === "clear_water", spring.edict);
  check("quest moved to report", await ev(() => window.ashLedger.game.quests.stage("q_fouled_well") === "report"));
  check("insight learned from watching ink burn", await ev(() => window.ashLedger.game.insights.has("ink_burns_clean")));
  await page.screenshot({ path: `${shots}/12-spring-clean.png` });

  // 5. secret: heavy attack the cracked wall of the cider house
  await tp(69, 23);
  await ev(() => {
    const g = window.ashLedger.game;
    g.aim = { x: 70.5 * 32, y: 23.5 * 32 };
    window.ashLedger.input.press("heavy");
  });
  await wait(1200);
  check("cracked wall breaks to a heavy blow", await ev(() => window.ashLedger.game.map.get(70, 23) === "planks"));
  await tp(72, 23);
  await wait(200);
  // read the Page of Stillness -> learn Rime Lance
  await ev(() => {
    const g = window.ashLedger.game;
    const pg = g.props.find((p) => p.spawnId === "cider_page");
    g.player.pos = { x: pg.pos.x, y: pg.pos.y + 6 };
  });
  await wait(200);
  await ev(() => window.ashLedger.game.interact());
  await wait(200);
  await page.keyboard.press("KeyE");
  check("Rime Lance learned from the secret page", await ev(() => window.ashLedger.game.progress.abilities.includes("rime_lance")));

  // 6. freeze the deep pool to reach the island
  await tp(62, 40);
  await wait(200);
  await ev(() => {
    const g = window.ashLedger.game;
    for (let x = 62; x <= 66; x++) g.surfaces.chill(x, 40);
  });
  await ev(() => window.ashLedger.input.hold("right", true));
  await wait(1700);
  await ev(() => window.ashLedger.input.hold("right", false));
  const px = await ev(() => window.ashLedger.game.map.cellAt(window.ashLedger.game.player.pos));
  check("frozen deep water is walkable", px[0] >= 65, `player reached tile ${px}`);

  // 7. report to Ilse, take the reward
  await tp(38, 10);
  await wait(200);
  await ev(() => window.ashLedger.game.interact());
  await wait(200);
  await choose("I burned the ink");
  await wait(100);
  await choose("Lanternhook");
  await choose("[Leave]");
  const q = await ev(() => ({ st: window.ashLedger.game.quests.progress.q_fouled_well, hook: window.ashLedger.game.inventory.count("lanternhook"), well: window.ashLedger.game.world.get("well_clean") }));
  check("quest completed with the 'burned' outcome", q.st?.outcome === "burned", JSON.stringify(q.st));
  check("equipment reward received", q.hook === 1);
  check("world reacts: well is clean", q.well === true);
  await wait(200);
  check("world reacts: tinker Odo arrived", await ev(() => window.ashLedger.game.npcs.some((n) => n.def.id === "odo")));
  await page.screenshot({ path: `${shots}/13-hub-after.png` });
  await ev(() => window.ashLedger.game.giveItem("cinder_mark", 10));
  await pickTraits();
  await wait(100);
  await pickTraits();
  await ev(() => {
    const g = window.ashLedger.game;
    const odo = g.npcs.find((n) => n.def.id === "odo");
    g.player.pos = { x: odo.pos.x + 20, y: odo.pos.y };
  });
  await wait(200);
  const oilBefore = await ev(() => window.ashLedger.game.inventory.count("oil_flask"));
  const odoFocus = await ev(() => window.ashLedger.game.focus?.prompt);
  await ev(() => window.ashLedger.game.interact());
  await wait(150);
  check("Odo is interactable", odoFocus?.includes("Odo") ?? false, odoFocus);
  await choose("Show me what you sell");
  await choose("Two oil flasks");
  await choose("[Leave]");
  const shop = await ev(() => ({ oil: window.ashLedger.game.inventory.count("oil_flask"), marks: window.ashLedger.game.inventory.count("cinder_mark") }));
  check("Odo sells flasks for cinder marks", shop.oil === oilBefore + 3 + 2 && shop.marks === 7, JSON.stringify({ oilBefore, ...shop }));

  // 8. save / load round trip
  const before = await ev(() => {
    const g = window.ashLedger.game;
    g.save();
    return { lv: g.progress.level, items: g.inventory.items.length, flags: Object.keys(g.world.flags).length };
  });
  await page.reload();
  await page.waitForSelector("[data-act=continue]");
  await page.click("[data-act=continue]");
  await wait(400);
  const after = await ev(() => {
    const g = window.ashLedger.game;
    return { lv: g.progress.level, items: g.inventory.items.length, flags: Object.keys(g.world.flags).length, wall: g.map.get(70, 23), odo: g.npcs.some((n) => n.def.id === "odo"), explored: g.exploredCount };
  });
  check("minimap exploration is saved", after.explored > 300, String(after.explored));
  check("save/load preserves progress and world changes", before.lv === after.lv && before.items === after.items && before.flags <= after.flags && after.wall === "planks" && after.odo, JSON.stringify(after));

  // 9. the Hush: echoes rise under the Edict of Return
  await tp(18, 38);
  await wait(300);
  await ev(() => {
    const g = window.ashLedger.game;
    g.player.maxHp = 9999;
    g.player.hp = 9999;
    const t = g.enemies.find((e) => e.def.id === "ash_thrall" && Math.hypot(e.pos.x - g.player.pos.x, e.pos.y - g.player.pos.y) < 400);
    if (t) {
      t.lastHitByPlayer = true;
      g.killEnemy(g, t);
    }
  });
  await wait(7000);
  check("an unharvested echo rises in the Hush", await ev(() => window.ashLedger.game.enemies.some((e) => e.risen)));
  await page.screenshot({ path: `${shots}/14-hush.png` });

  // 9b. "The Bell That Counts": silence the bell by lighting both funeral braziers with Ember Bolt
  check("Hush quest starts on discovery", await ev(() => window.ashLedger.game.quests.state("q_hush_bell") !== "inactive"));
  for (const [bx, by] of [[8, 28], [14, 28]]) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const lit = await ev(([bx, by]) => window.ashLedger.game.props.find((p) => p.def.shape === "brazier" && Math.hypot(p.pos.x - (bx + 0.5) * 32, p.pos.y - (by + 0.5) * 32) < 4)?.params.lit, [bx, by]);
      if (lit) break;
      await pickTraits();
      await ev(([bx, by]) => {
        const g = window.ashLedger.game;
        g.player.pos = { x: (bx + 0.5) * 32, y: (by + 3.5) * 32 };
        g.player.ember = g.player.maxEmber;
        g.player.fray = 0;
        g.aim = { x: (bx + 0.5) * 32, y: (by + 0.5) * 32 };
        window.ashLedger.input.press("spell1");
      }, [bx, by]);
      await wait(900);
    }
  }
  await wait(600);
  await page.screenshot({ path: `${shots}/15-chapel-rites.png` });
  const hush = await ev(() => {
    const g = window.ashLedger.game;
    return { q: g.quests.progress.q_hush_bell, warden: g.enemies.some((e) => e.def.id === "bellwarden"), edict: g.edictAtCell(11, 30).id, charm: g.inventory.count("bell_tongue") };
  });
  check("lighting the funeral fires completes the quest peacefully", hush.q?.outcome === "rites", JSON.stringify(hush.q));
  check("Bellwarden lies down instead of fighting", !hush.warden);
  check("world scar: the Hush's Edict of Return breaks", hush.edict === "quiet_return", hush.edict);
  check("rites reward received", hush.charm === 1);

  // 10. death screen
  await ev(() => {
    const g = window.ashLedger.game;
    g.player.invuln = 0;
    g.player.hp = 1;
    g.damagePlayer(g, 50, "physical", "test");
  });
  await wait(300);
  check("death screen appears", await ev(() => !!document.querySelector(".death")));
  await page.click("[data-act=rise]");
  await wait(300);
  check("rising restores the last save", await ev(() => window.ashLedger.game.player.hp > 0 && !window.ashLedger.game.dead));
} finally {
  await browser.close();
  server.close();
}
console.log(results.join("\n"));
if (errors.length) console.error("Console errors:\n  " + errors.join("\n  "));
if (errors.length || results.some((r) => r.startsWith("FAIL"))) process.exit(1);
console.log("Playthrough passed.");
