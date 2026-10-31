// Boot: load settings and the content bundle, pick the language, create the
// game, run the loop.
import type { ContentBundle } from "./data/types.js";
import { Input } from "./core/input.js";
import { SettingsStore } from "./core/settings.js";
import { Game } from "./game.js";
import { Renderer } from "./render/renderer.js";
import { Ui } from "./ui/ui.js";
import { Sfx } from "./audio/sfx.js";
import { ContentLocalizer, type Lang } from "./i18n/i18n.js";

async function boot(): Promise<void> {
  const res = await fetch("data.bundle.json");
  if (!res.ok) throw new Error(`Could not load data.bundle.json (${res.status})`);
  const content = (await res.json()) as ContentBundle;

  const settings = new SettingsStore(window.localStorage, navigator.language || "en");
  const localizer = new ContentLocalizer(content, async (lang: Lang) => {
    const r = await fetch(`locales/${lang}.json`);
    if (!r.ok) throw new Error(`locales/${lang}.json: ${r.status}`);
    return (await r.json()) as Record<string, string>;
  });
  await localizer.use(settings.value.language);

  const canvas = document.getElementById("game") as HTMLCanvasElement;
  const input = new Input(canvas);
  const game = new Game(content, window.localStorage);
  game.input = input;
  const renderer = new Renderer(canvas);
  const sfx = new Sfx(game.bus);
  const apply = () => {
    const s = settings.value;
    input.setBindings(s.bindings);
    sfx.setVolume(s.audio.volume, s.audio.muted);
    renderer.shakeEnabled = s.display.screenShake;
  };
  apply();
  settings.onChange(apply);
  const ui = new Ui(game, input, settings, { setLanguage: (l) => localizer.use(l) });
  ui.onStart = () => {
    renderer.cam = { x: 0, y: 0 };
    game.mapDirty = true;
  };

  // exposed for debugging and automated smoke tests
  (window as unknown as { ashLedger: unknown }).ashLedger = { game, ui, input, renderer, settings, localizer };

  let last = performance.now();
  let wasBlocking = true;
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    // the key that closed a menu must not also act in the world
    if (wasBlocking && !ui.blocking) input.endFrame();
    wasBlocking = ui.blocking;
    if (ui.screen === "playing" && game.player) {
      input.enabled = !ui.blocking;
      // aim: mouse if used, otherwise movement direction
      if (input.mouseActive) game.aim = renderer.screenToWorld(input.mouseX, input.mouseY);
      else {
        const p = game.player;
        const mx = (input.isDown("right") ? 1 : 0) - (input.isDown("left") ? 1 : 0);
        const my = (input.isDown("down") ? 1 : 0) - (input.isDown("up") ? 1 : 0);
        if (mx || my) game.aim = { x: p.pos.x + mx * 60, y: p.pos.y + my * 60 };
        else if (!game.aim.x) game.aim = { x: p.pos.x, y: p.pos.y - 60 };
      }
      if (!ui.blocking) game.update(dt);
      renderer.draw(game, ui.blocking ? 0 : dt);
    }
    ui.update(dt);
    input.endFrame();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  document.getElementById("loading")?.remove();
}

boot().catch((e) => {
  console.error(e);
  const el = document.getElementById("loading");
  if (el) el.textContent = `Failed to start: ${e.message}`;
});
